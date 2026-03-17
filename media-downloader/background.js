/* ============================================================
   Media Downloader — Background Service Worker
   Uses btch-downloader (via offscreen document) to grab media
   from supported social platforms, then saves to Downloads.
   ============================================================ */

const SUPPORTED_DOMAINS = [
  'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'facebook.com', 'fb.watch', 'twitter.com', 'x.com',
  'pinterest.com', 'pin.it', 'spotify.com', 'soundcloud.com',
  'threads.net', 'capcut.com', 'drive.google.com', 'mediafire.com',
  'douyin.com', 'xiaohongshu.com', 'snackvideo.com', 'cocofun.com'
];

/* ---------- Download History (in-memory, shown in popup) ---------- */

let history = []; // { id, url, filename, status, error, timestamp }
const MAX_HISTORY = 30;

function addHistory(entry) {
  history.unshift({ timestamp: Date.now(), ...entry });
  if (history.length > MAX_HISTORY) history.pop();
}

function updateHistory(id, updates) {
  const item = history.find(h => h.id === id);
  if (item) Object.assign(item, updates);
}

/* ---------- Persistent Failure Log (chrome.storage.local) ---------- */

const MAX_LOG_ENTRIES = 200;

async function logFailure({ url, filename, error, method }) {
  try {
    const { failureLog = [] } = await chrome.storage.local.get('failureLog');
    failureLog.unshift({
      timestamp: new Date().toISOString(),
      url: url || '',
      filename: filename || '',
      error: error || 'Unknown error',
      method: method || 'unknown'
    });
    if (failureLog.length > MAX_LOG_ENTRIES) failureLog.length = MAX_LOG_ENTRIES;
    await chrome.storage.local.set({ failureLog });
  } catch (_) {
    // Storage write failed — nothing we can do
  }
}

/* ---------- Badge Status ---------- */

let badgeClearTimer = null;

function setBadge(state, text) {
  clearTimeout(badgeClearTimer);

  if (state === 'processing') {
    chrome.action.setBadgeText({ text: text ?? '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#4A90D9' });
  } else if (state === 'success') {
    chrome.action.setBadgeText({ text: text ?? '' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    // Auto-clear — only visible briefly to confirm
    badgeClearTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } else if (state === 'error') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
    // Stay visible a bit longer for errors
    badgeClearTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/* ---------- Context Menu Setup ---------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'download-media',
    title: 'Download Media',
    contexts: ['link', 'video', 'audio', 'image', 'page']
  });
  chrome.contextMenus.create({
    id: 'download-text',
    title: 'Download Text',
    contexts: ['selection']
  });
});

/* ---------- Toast (send to active tab) ---------- */

let activeTabId = null;

function toast(id, text, status) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { type: 'toast', id, text, status }).catch(() => {});
}

/* ---------- yt-dlp Domains (prefer native yt-dlp over btch-downloader) ---------- */

const YTDLP_DOMAINS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
  'twitch.tv', 'reddit.com', 'bilibili.com'
];

function isYtdlpDomain(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return YTDLP_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}

/* ---------- Context Menu Click Handler ---------- */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'download-text') {
    const text = info.selectionText;
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const reader = new FileReader();
    reader.onloadend = () => {
      const host = new URL(tab.url).hostname.replace(/^www\./, '').split('.')[0];
      const snippet = text.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') || 'text';
      const filename = `${host}_${snippet}.txt`;
      // No toast — text downloads are instant
      chrome.downloads.download({ url: reader.result, filename, saveAs: false });
    };
    reader.readAsDataURL(blob);
    return;
  }

  if (info.menuItemId !== 'download-media') return;

  activeTabId = tab?.id || null;

  let url = info.linkUrl || info.srcUrl || info.pageUrl;
  // blob: URLs can't be downloaded — use the page URL instead (e.g. YouTube video player)
  if (url && url.startsWith('blob:')) url = info.pageUrl;
  if (!url) {
    const id = crypto.randomUUID();
    addHistory({ id, url: '(none)', filename: '', status: 'error', error: 'No URL detected' });
    logFailure({ url: '(none)', filename: '', error: 'No URL detected', method: 'context-menu' });
    toast(id, 'No URL detected', 'error');
    return;
  }

  // Direct media file — download immediately
  if (!isSupportedUrl(url) && !isYtdlpDomain(url)) {
    if (isDirectMediaUrl(url)) {
      const id = crypto.randomUUID();
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download';
      addHistory({ id, url, filename: name, status: 'downloading' });
      toast(id, 'Downloading ' + name, 'downloading');
      downloadFile(url, name, id);
      return;
    }
    // Try yt-dlp as last resort for any unknown URL
    downloadWithYtdlp(url);
    return;
  }

  // YouTube/Vimeo/etc — go straight to yt-dlp (better quality + format handling)
  if (isYtdlpDomain(url)) {
    downloadWithYtdlp(url);
    return;
  }

  // Other supported platforms — try btch-downloader, fall back to yt-dlp
  const jobId = crypto.randomUUID();
  addHistory({ id: jobId, url, filename: '', status: 'processing', error: null });
  toast(jobId, 'Fetching media...', 'processing');

  try {
    await ensureOffscreenDocument();
    const response = await sendToOffscreen({ action: 'download', url });

    if (!response || response.error) {
      // btch-downloader failed — try yt-dlp
      toast(jobId, '', 'dismiss');
      history = history.filter(h => h.id !== jobId);
      downloadWithYtdlp(url);
      return;
    }

    const downloadUrls = extractDownloadUrls(response.data, url);
    if (downloadUrls.length === 0) {
      // No media found — try yt-dlp
      toast(jobId, '', 'dismiss');
      history = history.filter(h => h.id !== jobId);
      downloadWithYtdlp(url);
      return;
    }

    // Dismiss the processing toast, show downloading
    toast(jobId, '', 'dismiss');
    history = history.filter(h => h.id !== jobId);

    const count = downloadUrls.length;
    const batchId = crypto.randomUUID();
    toast(batchId, `Downloading ${count} file${count > 1 ? 's' : ''}...`, 'downloading');

    for (const dl of downloadUrls) {
      const dlId = crypto.randomUUID();
      addHistory({ id: dlId, url: dl.url, filename: dl.filename, status: 'downloading', _batchId: batchId, _batchTotal: count });
      downloadFile(dl.url, dl.filename, dlId);
    }
  } catch (err) {
    // btch-downloader threw — try yt-dlp
    toast(jobId, '', 'dismiss');
    history = history.filter(h => h.id !== jobId);
    downloadWithYtdlp(url);
  }
});

/* ---------- yt-dlp via Native Messaging ---------- */

const YTDLP_HOST = 'com.mediadownloader.ytdlp';
const ytdlpPorts = new Map(); // jobId -> native port
const ytdlpLastPct = new Map(); // jobId -> last percentage number

function downloadWithYtdlp(url) {
  // Block if a yt-dlp download is already running
  if (ytdlpPorts.size > 0) {
    const warnId = crypto.randomUUID();
    toast(warnId, 'Download already in progress', 'error');
    return;
  }

  const jobId = crypto.randomUUID();
  addHistory({ id: jobId, url, filename: '', status: 'processing', error: null });
  toast(jobId, 'Starting download...', 'processing');

  let port;
  try {
    port = chrome.runtime.connectNative(YTDLP_HOST);
  } catch (e) {
    updateHistory(jobId, { status: 'error', error: 'Downloader not installed' });
    logFailure({ url, filename: '', error: 'Downloader not installed', method: 'ytdlp' });
    toast(jobId, 'Downloader not installed', 'error');
    return;
  }

  port.onMessage.addListener((msg) => {
    if (msg.status === 'started') {
      toast(jobId, 'Downloading...', 'downloading');
      updateHistory(jobId, { status: 'downloading' });
    } else if (msg.status === 'progress') {
      const num = parseInt(msg.progress, 10) || 0;
      const prev = ytdlpLastPct.get(jobId) || 0;
      if (num <= prev) return; // only allow forward progress
      ytdlpLastPct.set(jobId, num);
      toast(jobId, num + '%', 'downloading');
    } else if (msg.status === 'done') {
      updateHistory(jobId, { status: 'done', filename: msg.filename || '' });
      toast(jobId, 'Download completed', 'done');
      ytdlpPorts.delete(jobId);
      ytdlpLastPct.delete(jobId);
    } else if (msg.status === 'error') {
      updateHistory(jobId, { status: 'error', error: msg.error });
      logFailure({ url, filename: '', error: msg.error, method: 'ytdlp' });
      toast(jobId, msg.error, 'error');
      ytdlpPorts.delete(jobId);
      ytdlpLastPct.delete(jobId);
    }
  });

  port.onDisconnect.addListener(() => {
    ytdlpPorts.delete(jobId);
    ytdlpLastPct.delete(jobId);
    // Check lastError to suppress "Unchecked runtime.lastError" warning
    const lastErr = chrome.runtime.lastError;
    const item = history.find(h => h.id === jobId);
    if (item && item.status !== 'done' && item.status !== 'error') {
      const err = lastErr?.message || 'yt-dlp host disconnected';
      updateHistory(jobId, { status: 'error', error: err });
      logFailure({ url, filename: '', error: err, method: 'ytdlp' });
      toast(jobId, err, 'error');
    }
  });

  port.postMessage({ url });

  // Store port so we can cancel
  ytdlpPorts.set(jobId, port);
}

/* ---------- Track Download Completion/Failure ---------- */

const downloadIdMap = new Map();

function markDone(historyId) {
  updateHistory(historyId, { status: 'done' });
  const item = history.find(h => h.id === historyId);
  if (item?._batchId) {
    checkBatch(item._batchId);
  } else {
    toast(historyId, 'Saved to Downloads', 'done');
  }
}

function markFailed(historyId, err) {
  updateHistory(historyId, { status: 'error', error: err });
  const item = history.find(h => h.id === historyId);
  logFailure({ url: item?.url, filename: item?.filename, error: err, method: 'download' });
  if (item?._batchId) {
    checkBatch(item._batchId);
  } else {
    toast(historyId, err, 'error');
  }
}

function checkBatch(batchId) {
  const items = history.filter(h => h._batchId === batchId);
  const allSettled = items.every(h => h.status === 'done' || h.status === 'error');
  if (!allSettled) return;
  const doneCount = items.filter(h => h.status === 'done').length;
  const errCount = items.filter(h => h.status === 'error').length;
  if (errCount > 0) {
    toast(batchId, `${doneCount} saved, ${errCount} failed`, errCount === items.length ? 'error' : 'done');
  } else {
    toast(batchId, `${doneCount} file${doneCount > 1 ? 's' : ''} saved`, 'done');
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  const historyId = downloadIdMap.get(delta.id);
  if (!historyId) return;

  if (delta.state) {
    if (delta.state.current === 'complete') {
      downloadIdMap.delete(delta.id);
      markDone(historyId);
    } else if (delta.state.current === 'interrupted') {
      downloadIdMap.delete(delta.id);
      markFailed(historyId, delta.error?.current || 'Download interrupted');
    }
  }
  if (delta.error) {
    downloadIdMap.delete(delta.id);
    markFailed(historyId, delta.error.current);
  }
});

/* ---------- Popup Communication ---------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cancel') {
    const id = message.id;
    // Cancel yt-dlp
    const port = ytdlpPorts.get(id);
    if (port) { port.disconnect(); ytdlpPorts.delete(id); }
    // Cancel Chrome downloads in this batch or single
    for (const [dlId, histId] of downloadIdMap) {
      const item = history.find(h => h.id === histId);
      if (histId === id || item?._batchId === id) {
        chrome.downloads.cancel(dlId);
        downloadIdMap.delete(dlId);
      }
    }
    // Mark cancelled
    const items = history.filter(h => h.id === id || h._batchId === id);
    for (const item of items) {
      if (item.status !== 'done' && item.status !== 'error') {
        updateHistory(item.id, { status: 'error', error: 'Cancelled' });
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === 'getHistory') {
    sendResponse({ history });
    return false;
  }
  if (message.action === 'clearHistory') {
    history = [];
    setBadge('clear');
    sendResponse({ ok: true });
    return false;
  }
  // Forward download requests to offscreen
  return false;
});

/* ---------- Offscreen Document Management ---------- */

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Load btch-downloader browser bundle to process media URLs'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

function sendToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/* ---------- URL Helpers ---------- */

function isSupportedUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SUPPORTED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

function isDirectMediaUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(mp4|webm|mp3|ogg|wav|m4a|jpg|jpeg|png|gif|webp|svg|mov|avi|mkv)(\?|$)/.test(path);
  } catch {
    return false;
  }
}

/* ---------- Extract Download URLs from Response ---------- */

function makeFolderName(data, sourceUrl) {
  const title = data?.title || data?.title_audio || data?.result?.title;
  if (title) {
    return sanitizePath(title);
  }
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./, '').split('.')[0];
    const slug = u.pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    return slug ? `${host}_${slug}` : host;
  } catch {
    return 'download';
  }
}

function sanitizePath(str) {
  return str
    .replace(/[^a-zA-Z0-9 _-]/g, '')                     // only safe ASCII chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
}

function extractDownloadUrls(data, sourceUrl) {
  if (!data) return [];

  const folder = makeFolderName(data, sourceUrl);
  const seen = new Set();
  const results = [];

  function add(url, filename) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({ url, filename: `${folder}/${filename}` });
  }

  // TikTok: video[] and audio[]
  if (data.video) {
    const videos = Array.isArray(data.video) ? data.video : [data.video];
    videos.forEach((v, i) => {
      const url = typeof v === 'string' ? v : v?.url;
      const ext = guessExtension(url, 'mp4'); // photo carousels return .jpeg in video[]
      add(url, buildFilename(data.title || 'tiktok', ext, i));
    });
  }
  if (data.audio && results.length === 0) {
    const audios = Array.isArray(data.audio) ? data.audio : [data.audio];
    audios.forEach((a, i) => {
      const url = typeof a === 'string' ? a : a?.url;
      add(url, buildFilename(data.title_audio || data.title || 'audio', 'mp3', i));
    });
  }

  // Instagram / Pinterest / SoundCloud / Threads / etc: result[]
  if (data.result && Array.isArray(data.result)) {
    for (const item of data.result) {
      if (item.url) {
        add(item.url, buildFilename('instagram', guessExtension(item.url, 'mp4'), results.length));
      }
      if (item.image && !item.url) {
        add(item.image, buildFilename(item.title || 'pinterest', 'jpg', results.length));
      }
      if (item.video_url) {
        add(item.video_url, buildFilename(item.title || 'pinterest', 'mp4', results.length));
      }
      if (item.downloadUrl) {
        add(item.downloadUrl, item.filename || 'download');
      }
      if (item.downloadMp3) {
        add(item.downloadMp3, buildFilename(item.title || 'soundcloud', 'mp3', results.length));
      }
      if (item.type === 'image' && item.image) {
        add(item.image, buildFilename('threads', 'jpg', results.length));
      }
      if (item.type === 'video' && item.video) {
        add(item.video, buildFilename('threads', 'mp4', results.length));
      }
      if (item.downloads && Array.isArray(item.downloads)) {
        for (const dl of item.downloads) {
          const dlUrl = typeof dl === 'string' ? dl : dl?.url;
          add(dlUrl, buildFilename(item.title || 'xhs', guessExtension(dlUrl, 'jpg'), results.length));
        }
      }
      if (item.formats && Array.isArray(item.formats)) {
        const best = item.formats[0];
        if (best?.url) add(best.url, buildFilename(item.title || 'spotify', 'mp3', results.length));
      }
    }
  }

  // YouTube
  if (data.mp4 && Array.isArray(data.mp4)) {
    const best = data.mp4[0];
    if (best?.url) add(best.url, buildFilename(data.title || 'youtube', 'mp4'));
  }
  if (data.mp3 && Array.isArray(data.mp3) && results.length === 0) {
    const best = data.mp3[0];
    if (best?.url) add(best.url, buildFilename(data.title || 'youtube', 'mp3'));
  }

  // Twitter
  if (data.url && typeof data.url === 'string') {
    add(data.url, buildFilename(data.title || 'twitter', guessExtension(data.url, 'mp4')));
  }

  // Facebook
  if (data.HD) {
    add(data.HD, buildFilename('facebook_hd', 'mp4'));
  } else if (data.Normal_video) {
    add(data.Normal_video, buildFilename('facebook', 'mp4'));
  }

  // CapCut
  if (data.originalVideoUrl) {
    add(data.originalVideoUrl, buildFilename(data.title || 'capcut', 'mp4'));
  }

  // Douyin
  if (data.links && Array.isArray(data.links)) {
    const best = data.links[0];
    const linkUrl = typeof best === 'string' ? best : best?.url;
    add(linkUrl, buildFilename(data.title || 'douyin', 'mp4'));
  }

  // Cocofun
  add(data.no_watermark, buildFilename('cocofun', 'mp4'));
  if (!data.no_watermark && data.watermark) {
    add(data.watermark, buildFilename('cocofun_wm', 'mp4'));
  }

  // SnackVideo
  if (data.videoUrl) {
    add(data.videoUrl, buildFilename(data.title || 'snackvideo', 'mp4'));
  }

  // Fallback: nested result object
  if (results.length === 0 && data.result && !Array.isArray(data.result)) {
    const r = data.result;
    add(r.downloadUrl, r.filename || 'download');
    add(r.url, buildFilename('download', guessExtension(r.url, 'mp4')));
    add(r.video, buildFilename('download', 'mp4'));
    add(r.image, buildFilename('download', 'jpg'));
    add(r.downloadMp3, buildFilename(r.title || 'download', 'mp3'));
    add(r.no_watermark, buildFilename('download', 'mp4'));
    add(r.videoUrl, buildFilename(r.title || 'download', 'mp4'));
  }

  return results;
}

/* ---------- Filename Helpers ---------- */

function buildFilename(title, ext, index) {
  let name = sanitizePath(title).replace(/\s+/g, '_');
  if (!name) name = 'download';
  if (index > 0) name += `_${index + 1}`;
  return `${name}.${ext}`;
}

function guessExtension(url, fallback) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/\.(mp4|webm|mp3|ogg|wav|m4a|jpg|jpeg|png|gif|webp|mov)(\?|$)/);
    return match ? match[1] : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Download ---------- */

function downloadFile(url, filename, historyId) {
  const options = { url };
  if (filename) options.filename = filename;
  chrome.downloads.download(options, (downloadId) => {
    if (chrome.runtime.lastError) {
      // Retry with safe fallback filename
      if (filename) {
        const ext = filename.match(/\.(\w+)$/)?.[1] || 'bin';
        const safeName = `download_${Date.now()}.${ext}`;
        chrome.downloads.download({ url, filename: safeName }, (retryId) => {
          if (chrome.runtime.lastError) {
            if (historyId) markFailed(historyId, chrome.runtime.lastError.message);
          } else if (retryId && historyId) {
            downloadIdMap.set(retryId, historyId);
          } else if (historyId) {
            markFailed(historyId, 'Download rejected by browser');
          }
        });
      } else if (historyId) {
        markFailed(historyId, chrome.runtime.lastError.message);
      }
    } else if (downloadId && historyId) {
      downloadIdMap.set(downloadId, historyId);
    } else if (historyId) {
      markFailed(historyId, 'Download rejected by browser');
    }
  });
}
