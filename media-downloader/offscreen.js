/* ============================================================
   Offscreen Document — Runs btch-downloader in a DOM context
   Receives messages from the service worker, calls the library,
   and sends back the response data.
   ============================================================ */

const TIMEOUT_MS = 15000; // 15s — if the API hasn't responded, give up

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'download') return false;

  processDownload(message.url)
    .then(data => sendResponse({ data }))
    .catch(err => sendResponse({ error: err.message || 'Download processing failed' }));

  return true;
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out — API did not respond')), ms))
  ]);
}

async function processDownload(url) {
  const btch = window.btch;
  if (!btch) throw new Error('btch-downloader library not loaded');

  const hostname = new URL(url).hostname.replace(/^www\./, '');

  const router = {
    'instagram.com':    () => btch.igdl(url),
    'tiktok.com':       () => btch.ttdl(url),
    'youtube.com':      () => btch.youtube(url),
    'youtu.be':         () => btch.youtube(url),
    'facebook.com':     () => btch.fbdown(url),
    'fb.watch':         () => btch.fbdown(url),
    'twitter.com':      () => btch.twitter(url),
    'x.com':            () => btch.twitter(url),
    'pinterest.com':    () => btch.pinterest(url),
    'pin.it':           () => btch.pinterest(url),
    'spotify.com':      () => btch.spotify(url),
    'soundcloud.com':   () => btch.soundcloud(url),
    'threads.net':      () => btch.threads(url),
    'capcut.com':       () => btch.capcut(url),
    'drive.google.com': () => btch.gdrive(url),
    'mediafire.com':    () => btch.mediafire(url),
    'douyin.com':       () => btch.douyin(url),
    'xiaohongshu.com':  () => btch.xiaohongshu(url),
    'snackvideo.com':   () => btch.snackvideo(url),
    'cocofun.com':      () => btch.cocofun(url),
  };

  const handler = Object.entries(router).find(([domain]) =>
    hostname === domain || hostname.endsWith('.' + domain)
  );

  let result;
  if (handler) {
    result = await withTimeout(handler[1](), TIMEOUT_MS);
  } else if (btch.aio) {
    result = await withTimeout(btch.aio(url), TIMEOUT_MS);
  } else {
    throw new Error('Unsupported platform');
  }

  // Check for API error responses
  if (result?.status === false) {
    throw new Error(result?.message || 'API returned an error');
  }

  // Check for empty results
  const hasData = result?.video?.length || result?.audio?.length ||
    result?.mp4?.length || result?.mp3?.length ||
    result?.url || result?.HD || result?.Normal_video ||
    result?.originalVideoUrl || result?.videoUrl || result?.no_watermark ||
    (result?.result && (Array.isArray(result.result) ? result.result.length > 0 : true));

  if (!hasData) {
    throw new Error('API returned empty — this post may be private or unavailable');
  }

  return result;
}
