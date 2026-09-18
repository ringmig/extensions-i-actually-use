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

// ═══════════════════════════════════
// Custom Bookmark Modal
// ═══════════════════════════════════

// Content scripts have no chrome.bookmarks, so the modal asks for everything
// here. Folders come back flattened with a depth so the picker can indent them.
async function folderList() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.url) continue;
      if (n.id !== '0') out.push({ id: n.id, label: n.title || 'Bokmärken', depth });
      if (n.children) walk(n.children, n.id === '0' ? depth : depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

// Folders most recently bookmarked into. Derived from Chrome's own recent list
// rather than a stored history, so it is useful on the first run and needs no
// extra state — saves made through this modal land there like any other.
function recentFolders(folders, recent, limit = 5) {
  const byId = new Map(folders.map((f) => [f.id, f.label]));
  const out = [];
  for (const b of recent) {
    if (!b.parentId || !byId.has(b.parentId)) continue;
    if (out.some((f) => f.id === b.parentId)) continue;
    out.push({ id: b.parentId, label: byId.get(b.parentId) });
    if (out.length === limit) break;
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'bm-modal-state') {
    (async () => {
      const [folders, hits, recent] = await Promise.all([
        folderList(),
        chrome.bookmarks.search({ url: msg.url }),
        chrome.bookmarks.getRecent(60),
      ]);
      const hit = hits.find((h) => h.url === msg.url) || null;
      sendResponse({
        folders,
        recent: recentFolders(folders, recent),
        existing: hit && { id: hit.id, title: hit.title, url: hit.url, parentId: hit.parentId },
      });
    })();
    return true;
  }

  if (msg.type === 'bm-modal-save') {
    (async () => {
      if (msg.id) {
        await chrome.bookmarks.update(msg.id, { title: msg.title, url: msg.url });
        await chrome.bookmarks.move(msg.id, { parentId: msg.parentId });
      } else {
        await chrome.bookmarks.create({
          parentId: msg.parentId,
          title: msg.title,
          url: msg.url,
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'bm-modal-remove') {
    chrome.bookmarks.remove(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }
});

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
