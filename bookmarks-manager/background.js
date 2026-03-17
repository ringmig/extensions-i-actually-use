/* ══════════════════════════════════════════════════════════
   Bookmarks Manager — Background Thumbnail Capture Engine
   ══════════════════════════════════════════════════════════ */

const DB_NAME = 'bm-thumbnails';
const DB_VERSION = 1;
const STORE = 'thumbs';
const THUMBNAIL_TTL = Infinity; // Never expire — manual refresh only
const CAPTURE_DELAY = 5000; // wait for rendering after load
const CAPTURE_TIMEOUT = 15000; // max wait for page load
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 900;

// ═══════════════════════════════════
// IndexedDB
// ═══════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getThumbnail(url) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function saveThumbnail(url, dataUrl) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ url, dataUrl, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function getAllThumbnails() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

// ═══════════════════════════════════
// Capture Queue
// ═══════════════════════════════════

let queue = [];
let isCapturing = false;
let captureWindowId = null;
let totalQueued = 0;
let totalDone = 0;

function broadcastProgress() {
  chrome.runtime.sendMessage({
    type: 'capture-progress',
    done: totalDone,
    total: totalQueued,
    remaining: queue.length,
  }).catch(() => {}); // ignore if no listener
}

function broadcastComplete() {
  chrome.runtime.sendMessage({
    type: 'capture-all-done',
  }).catch(() => {});
}

async function processQueue() {
  if (isCapturing || queue.length === 0) {
    if (queue.length === 0 && totalQueued > 0) {
      broadcastComplete();
      totalQueued = 0;
      totalDone = 0;
    }
    return;
  }

  isCapturing = true;
  const { url, bookmarkId } = queue.shift();

  try {
    const dataUrl = await captureUrl(url);
    if (dataUrl) {
      await saveThumbnail(url, dataUrl);
      // Notify new tab page
      chrome.runtime.sendMessage({
        type: 'thumbnail-ready',
        url,
        bookmarkId,
        dataUrl,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[BM] Capture failed:', url, e.message);
  }

  totalDone++;
  broadcastProgress();
  isCapturing = false;

  // Small delay between captures
  if (queue.length > 0) {
    setTimeout(processQueue, 300);
  } else {
    broadcastComplete();
    totalQueued = 0;
    totalDone = 0;
  }
}

// ═══════════════════════════════════
// Screenshot Capture
// ═══════════════════════════════════

async function captureUrl(url) {
  let win;

  try {
    // Create popup window — must be focused for Chrome to render content
    win = await chrome.windows.create({
      url,
      type: 'popup',
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      focused: true,
    });

    captureWindowId = win.id;
    const tabId = win.tabs[0].id;

    // Wait for page load (or timeout)
    await Promise.race([
      waitForLoad(tabId),
      sleep(CAPTURE_TIMEOUT),
    ]);

    // Extra time for images/fonts/JS rendering
    await sleep(CAPTURE_DELAY);

    // Capture the visible tab of that window
    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
      format: 'jpeg',
      quality: 70,
    });

    return dataUrl;
  } catch (e) {
    console.warn('[BM] captureUrl error:', e.message);
    return null;
  } finally {
    // Always clean up
    if (win) {
      try {
        await chrome.windows.remove(win.id);
      } catch {}
    }
    captureWindowId = null;
  }
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}



// ═══════════════════════════════════
// Message Handling
// ═══════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture-request') {
    // Queue bookmarks for capture
    const items = msg.bookmarks || [];
    for (const item of items) {
      // Skip duplicates in queue
      if (!queue.some((q) => q.url === item.url)) {
        queue.push(item);
      }
    }
    totalQueued = queue.length + totalDone;
    broadcastProgress();
    processQueue();
    sendResponse({ queued: items.length });
    return true;
  }

  if (msg.type === 'get-thumbnails-batch') {
    // Return cached thumbnails for a list of URLs
    (async () => {
      const results = {};
      for (const url of msg.urls) {
        const thumb = await getThumbnail(url);
        if (thumb && (Date.now() - thumb.timestamp < THUMBNAIL_TTL)) {
          results[url] = thumb.dataUrl;
        }
      }
      sendResponse(results);
    })();
    return true; // async
  }

  if (msg.type === 'get-queue-status') {
    sendResponse({
      queueLength: queue.length,
      isCapturing,
      totalQueued,
      totalDone,
    });
    return true;
  }

  if (msg.type === 'clear-thumbnail') {
    (async () => {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(msg.url);
      sendResponse({ ok: true });
    })();
    return true;
  }
});
