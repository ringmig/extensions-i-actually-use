/* ============================================================
   Media Downloader — Background Service Worker
   Uses btch-downloader (via offscreen document) to grab media
   from supported social platforms, then saves to Downloads.
   ============================================================ */
// Flip on to trace the fallback chain in the service worker console. Off by
// default: the download-state trace fires on every bytesReceived delta.
const DEBUG = false;
const dbg = (...args) => { if (DEBUG) console.log(...args); };


const DOWNLOAD_SUBFOLDER = 'chrome-downloads';

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

/* ---------- Inline SVG Download (data URL) ---------- */

function downloadInlineSvg(svgInfo, tab) {
  let host = 'svg';
  try {
    host = new URL(tab?.url || '').hostname.replace(/^www\./, '').split('.')[0] || 'svg';
  } catch {}

  const idPart = svgInfo.id ? sanitizePath(svgInfo.id).replace(/\s+/g, '_') : '';
  const baseName = idPart || 'logo';
  const filename = `${host}_${baseName}.svg`;

  const id = crypto.randomUUID();
  addHistory({ id, url: tab?.url || '', filename, status: 'downloading' });
  toast(id, 'Downloading ' + filename, 'downloading');

  // Service workers can't use URL.createObjectURL on Blobs in MV3,
  // so use a data URL. encodeURIComponent handles any character safely.
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgInfo.svg);
  downloadFile(dataUrl, filename, id);
}

/* ---------- TikTok Image Reel Scraping (DOM-based fallback) ---------- */

async function scrapeTikTokCarousel(tabId, sourceUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'scrape-tiktok-images' });
    const images = response?.images;
    if (!images || images.length === 0) return [];

    // Build download list from scraped URLs
    let title = 'tiktok';
    try {
      const slug = new URL(sourceUrl).pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
      if (slug) title = slug;
    } catch {}
    const folder = sanitizePath(title) || 'tiktok';

    return images.map((url, i) => {
      const ext = guessExtension(url, 'jpeg');
      const name = `${folder}/${folder}_${i + 1}.${ext}`;
      return { url, filename: name };
    });
  } catch {
    return [];
  }
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
      // No toast — text downloads are instant
      downloadFile(reader.result, `${host}_${snippet}.txt`);
    };
    reader.readAsDataURL(blob);
    return;
  }

  if (info.menuItemId !== 'download-media') return;

  activeTabId = tab?.id || null;

  dbg('[mdl] download-media clicked', {
    pageUrl: info.pageUrl,
    linkUrl: info.linkUrl,
    srcUrl: info.srcUrl,
    mediaType: info.mediaType,
    tabUrl: tab?.url
  });

  // Inline SVG check — must run BEFORE URL extraction.
  // For inline <svg> elements wrapped in <a>, info.linkUrl points at the
  // anchor's href (often the page URL), not the SVG. Ask the content script
  // what was actually right-clicked.
  //
  // Skipped when Chrome already pointed at real media (srcUrl/mediaType) or
  // when we're on a media platform — otherwise a UI icon (TikTok's volume
  // control, a play button) beats the actual photo/video the user aimed at.
  const skipSvgProbe = !!info.srcUrl || !!info.mediaType ||
    isSupportedUrl(tab?.url || '') || isYtdlpDomain(tab?.url || '');
  if (activeTabId && !skipSvgProbe) {
    try {
      const svgInfo = await chrome.tabs.sendMessage(activeTabId, { type: 'get-right-clicked-svg' });
      if (svgInfo && svgInfo.svg) {
        downloadInlineSvg(svgInfo, tab);
        return;
      }
    } catch {
      // Content script not loaded (chrome:// page, etc.) — fall through
    }
  }

  // Instagram-specific: Chrome's context-menu info is unreliable on Instagram —
  // feed images often expose only the page URL (https://www.instagram.com/),
  // which makes btch-downloader and yt-dlp both fail. Ask the content script
  // to walk the DOM from the right-clicked element to the surrounding post
  // permalink (/p/, /reel/, /tv/) and use that instead.
  let resolvedUrl = null;
  let gridImage = null;
  const onInstagram = isInstagramUrl(tab?.url || '');
  if (activeTabId && onInstagram) {
    try {
      const igResult = await chrome.tabs.sendMessage(activeTabId, { type: 'get-instagram-post-url' });
      dbg('[mdl] instagram post-url lookup →', igResult);
      if (igResult?.url) resolvedUrl = igResult.url;
      if (igResult?.image) gridImage = igResult.image;
    } catch (e) {
      dbg('[mdl] instagram post-url lookup failed:', e?.message || e);
    }
  }
  // The content script can be missing (tab opened before the extension
  // reloaded) or the DOM can have moved again. Chrome's own srcUrl still
  // points at the CDN file whenever the right-click landed on the image.
  if (onInstagram && !gridImage && isInstagramCdnImage(info.srcUrl)) {
    dbg('[mdl] instagram: falling back to info.srcUrl');
    gridImage = info.srcUrl;
  }

  // A photo tile in a profile grid or the /tagged/ tab: the image on screen is
  // what the user aimed at, and it is already a CDN file we can fetch. Neither
  // btch-downloader nor yt-dlp can improve on it, and both fail outright when
  // the fallback chain ends up handing them the profile page URL.
  if (gridImage) {
    const id = crypto.randomUUID();
    const shortcode = resolvedUrl?.match(/\/p\/([^/]+)/)?.[1] || 'post';
    const name = `instagram_${shortcode}.${guessExtension(gridImage, 'jpg')}`;
    dbg('[mdl] instagram grid tile → direct CDN image', name);
    addHistory({ id, url: gridImage, filename: name, status: 'downloading' });
    toast(id, 'Downloading ' + name, 'downloading');
    downloadFile(gridImage, name, id);
    return;
  }

  // A profile, /tagged/ or explore page is not a post: yt-dlp can only fail on
  // it, slowly. Say what Chrome actually handed over so the next report names
  // the cause instead of repeating "Download Failed".
  if (onInstagram && !resolvedUrl && !info.linkUrl && !info.srcUrl && !isInstagramPostUrl(info.pageUrl)) {
    const id = crypto.randomUUID();
    const seen = `link=${info.linkUrl || '-'} src=${info.srcUrl || '-'} media=${info.mediaType || '-'} ctx=${info.contexts || '-'}`;
    addHistory({ id, url: info.pageUrl, filename: '', status: 'error', error: 'Right-click the image itself' });
    logFailure({ url: info.pageUrl, filename: '', error: `No media under cursor (${seen})`, method: 'context-menu' });
    toast(id, 'Right-click the image itself', 'error');
    return;
  }

  let url = resolvedUrl || info.linkUrl || info.srcUrl || info.pageUrl;
  dbg('[mdl] resolved url →', url, resolvedUrl ? '(from DOM walk)' : '(from context info)');
  // blob: URLs can't be downloaded — use the page URL instead (e.g. YouTube video player)
  if (url && url.startsWith('blob:')) url = info.pageUrl;
  // On a TikTok post page, a right-clicked carousel slide resolves to a single
  // CDN image. Use the post URL so the whole carousel gets picked up instead.
  if (isTikTokUrl(tab?.url || '') && !isTikTokUrl(url) && /\/(photo|video)\//.test(tab.url)) {
    url = tab.url;
  }
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

  // A TikTok video goes straight to yt-dlp too. btch-downloader answers with a
  // dl.tiktokio.com proxy URL whose token the browser cannot fetch
  // (NETWORK_FAILED), and the carousel fallback that then kicks in has no
  // carousel to find, so its size-based pass collects the feed's thumbnails
  // instead. btch-downloader earns its round trip on photo posts only.
  if (isTikTokVideoPost(url)) {
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
    dbg('[mdl] btch-downloader response →', response);

    if (!response || response.error) {
      // btch-downloader failed — try TikTok DOM scraping, then yt-dlp
      if (isTikTokUrl(url) && !isTikTokVideoPost(url) && activeTabId) {
        const scraped = await scrapeTikTokCarousel(activeTabId, url);
        if (scraped.length > 0) {
          toast(jobId, '', 'dismiss');
          history = history.filter(h => h.id !== jobId);
          startBatchDownload(scraped);
          return;
        }
      }
      toast(jobId, '', 'dismiss');
      history = history.filter(h => h.id !== jobId);
      downloadWithYtdlp(url);
      return;
    }

    const downloadUrls = extractDownloadUrls(response.data, url);
    dbg('[mdl] extracted download URLs →', downloadUrls.length, downloadUrls);
    if (downloadUrls.length === 0) {
      // No media from btch-downloader — try TikTok DOM scraping, then yt-dlp
      if (isTikTokUrl(url) && !isTikTokVideoPost(url) && activeTabId) {
        const scraped = await scrapeTikTokCarousel(activeTabId, url);
        if (scraped.length > 0) {
          toast(jobId, '', 'dismiss');
          history = history.filter(h => h.id !== jobId);
          startBatchDownload(scraped);
          return;
        }
      }
      toast(jobId, '', 'dismiss');
      history = history.filter(h => h.id !== jobId);
      downloadWithYtdlp(url);
      return;
    }

    // Dismiss the processing toast, start downloads
    toast(jobId, '', 'dismiss');
    history = history.filter(h => h.id !== jobId);
    startBatchDownload(downloadUrls);
  } catch (err) {
    // btch-downloader threw — try TikTok DOM scraping, then yt-dlp
    if (isTikTokUrl(url) && !isTikTokVideoPost(url) && activeTabId) {
      const scraped = await scrapeTikTokCarousel(activeTabId, url);
      if (scraped.length > 0) {
        toast(jobId, '', 'dismiss');
        history = history.filter(h => h.id !== jobId);
        startBatchDownload(scraped);
        return;
      }
    }
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
  dbg('[mdl] yt-dlp invoked with url →', url);
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
      console.error('[mdl] yt-dlp error for', url, '→', msg.error);
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
  console.error('[mdl] download failed:', err, '— file:', item?.filename, 'url:', item?.url);
  logFailure({ url: item?.url, filename: item?.filename, error: err, method: 'download' });
  if (item?._batchId) {
    checkBatch(item._batchId);
  } else {
    toast(historyId, err, 'error');
  }
}

function startBatchDownload(downloadUrls) {
  const count = downloadUrls.length;
  const batchId = crypto.randomUUID();
  toast(batchId, `Downloading ${count} file${count > 1 ? 's' : ''}...`, 'downloading');

  for (const dl of downloadUrls) {
    const dlId = crypto.randomUUID();
    addHistory({ id: dlId, url: dl.url, filename: dl.filename, status: 'downloading', _batchId: batchId, _batchTotal: count });
    downloadFile(dl.url, dl.filename, dlId);
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
  dbg('[mdl] download state change', delta.id, {
    state: delta.state?.current,
    error: delta.error?.current,
    paused: delta.paused?.current,
    bytes: delta.bytesReceived?.current
  });

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

// btch-downloader routes Instagram media through d.rapidcdn.app, which
// frequently returns SERVER_FAILED. The proxy URL contains a JWT whose
// payload has the real Instagram CDN URL — decode it and use that directly.
function unwrapRapidCdnUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'd.rapidcdn.app') return null;
    const token = u.searchParams.get('token');
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    return payload?.url || null;
  } catch (e) {
    console.warn('[mdl] rapidcdn JWT decode failed:', e?.message);
    return null;
  }
}

function isInstagramUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h === 'instagram.com' || h.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

function isInstagramPostUrl(url) {
  try {
    return /^\/(?:[^/]+\/)?(p|reel|tv)\//.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Instagram serves its media from cdninstagram.com / fbcdn.net. A right-click
// that landed on the image gives us that URL directly — no API in between.
function isInstagramCdnImage(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)) return false;
    return /\.(jpg|jpeg|png|webp|heic)$/.test(u.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function isSupportedUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SUPPORTED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

// A short vm.tiktok.com link says nothing about its contents, so only an
// explicit /video/ counts as "not a carousel" — everything else keeps the
// btch-downloader and scrape path.
function isTikTokVideoPost(url) {
  return isTikTokUrl(url) && /\/video\//.test(url);
}

function isTikTokUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h === 'tiktok.com' || h.endsWith('.tiktok.com');
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
  // sanitizePath drops everything non-ASCII, so an emoji/CJK-only caption
  // yields '' — fall through to the URL instead of returning an empty folder
  // (which made every file land loose in chrome-downloads/).
  const title = data?.title || data?.title_audio || data?.result?.title;
  const fromTitle = title ? sanitizePath(title).replace(/\s+/g, '_') : '';
  if (fromTitle) return fromTitle;
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./, '').split('.')[0];
    const slug = u.pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    return slug ? `${host}_${slug}` : (host || 'download');
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

  // TikTok: video[] (may contain images for carousels), images[], and audio[]
  if (data.video) {
    const videos = Array.isArray(data.video) ? data.video : [data.video];
    videos.forEach((v, i) => {
      const url = typeof v === 'string' ? v : v?.url;
      const ext = guessExtension(url, 'mp4'); // photo carousels return .jpeg in video[]
      add(url, buildFilename(data.title || 'tiktok', ext, i));
    });
  }
  // TikTok image reels sometimes return images in a separate field
  if (data.images) {
    const images = Array.isArray(data.images) ? data.images : [data.images];
    images.forEach((img, i) => {
      const url = typeof img === 'string' ? img : (img?.url || img?.originCover || img?.dynamic);
      const ext = guessExtension(url, 'jpeg');
      add(url, buildFilename(data.title || 'tiktok', ext, results.length));
    });
  }
  // Audio only when no images/videos were found AND response has no image data
  // Skip audio for TikTok — image reels sometimes only return the music track
  // when btch-downloader fails to extract images; let it fall through to yt-dlp instead
  if (data.audio && results.length === 0 && !data.images && !isTikTokUrl(sourceUrl)) {
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

// Strip path components that Chrome rejects or that silently flatten the
// download: empty segments, and leading/trailing dots or spaces.
function safeRelPath(path) {
  return path
    .split('/')
    .map(seg => seg.replace(/^[.\s]+|[.\s]+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/* ---------- Filename ownership ----------
   Any other extension with a downloads.onDeterminingFilename listener gets to
   name EVERY download, ours included — "Snag - Save Image As" did exactly that,
   which is why files landed loose in ~/Downloads under their raw CDN names
   instead of chrome-downloads/<post>/. Claim the name back for our own
   downloads; anything we didn't start is left to whoever else cares. */
const claimedNames = new Map(); // url -> intended relative path

function claimFilename(url, filename) {
  claimedNames.set(url, filename);
  // Don't leak if the event never fires (download rejected, user cancelled)
  setTimeout(() => claimedNames.delete(url), 60000);
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Exact test first: anything another extension started is none of our
  // business, whatever its URL happens to look like.
  if (item.byExtensionId !== chrome.runtime.id) return;
  const wanted = claimedNames.get(item.url) || claimedNames.get(item.finalUrl);
  if (!wanted) return; // ours, but unnamed — let Chrome decide
  claimedNames.delete(item.url);
  claimedNames.delete(item.finalUrl);
  dbg('[mdl] claiming filename →', wanted);
  suggest({ filename: wanted, conflictAction: 'uniquify' });
});

function downloadFile(url, filename, historyId) {
  const unwrapped = unwrapRapidCdnUrl(url);
  if (unwrapped) {
    dbg('[mdl] unwrapped rapidcdn JWT → using direct CDN url');
    url = unwrapped;
  }
  const options = { url };
  if (filename) {
    options.filename = safeRelPath(`${DOWNLOAD_SUBFOLDER}/${filename}`);
    claimFilename(url, options.filename);
  }
  dbg('[mdl] chrome.downloads.download →', options.filename, url.slice(0, 100));
  chrome.downloads.download(options, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('[mdl] download API rejected:', chrome.runtime.lastError.message, '— retrying with safe filename');
      // Retry with safe fallback filename
      if (filename) {
        const ext = filename.match(/\.(\w+)$/)?.[1] || 'bin';
        const safeName = `${DOWNLOAD_SUBFOLDER}/download_${Date.now()}.${ext}`;
        claimFilename(url, safeName);
        chrome.downloads.download({ url, filename: safeName }, (retryId) => {
          if (chrome.runtime.lastError) {
            console.error('[mdl] download retry failed:', chrome.runtime.lastError.message, 'url:', url);
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
