// ===================================================================
//  TRANSCRIBE — One-click video transcript downloader
//  Supports: YouTube, YouTube Shorts, TikTok
// ===================================================================

let activeTabId = null;
let busy = false;

// ===================================================================
//  CONTEXT MENU
// ===================================================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'transcribe',
    title: 'Transcribe',
    contexts: ['page', 'video', 'link'],
    documentUrlPatterns: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://www.tiktok.com/*',
      'https://*.tiktok.com/*'
    ]
  });
});

// Handle both icon click and context menu click
chrome.action.onClicked.addListener((tab) => transcribe(tab));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'transcribe') transcribe(tab);
});


// ===================================================================
//  MAIN FLOW
// ===================================================================

async function transcribe(tab) {
  activeTabId = tab.id;

  // Ensure toast content script is loaded (handles tabs opened before install)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['toast.js']
    });
  } catch (e) {
    console.warn('[Transcribe] Could not inject toast:', e.message);
  }

  if (busy) {
    toast('warn', 'Transcribe already in progress', 'error');
    return;
  }

  busy = true;
  const jobId = 'job-' + Date.now();

  try {
    toast(jobId, 'Fetching transcript...', 'processing');

    const url = new URL(tab.url);
    let result;

    if (url.hostname.includes('youtube.com')) {
      result = await handleYouTube(tab, url);
    } else if (url.hostname.includes('tiktok.com')) {
      result = await handleTikTok(tab, url);
    } else {
      toast(jobId, 'Unsupported site', 'error');
      return;
    }

    if (!result?.text) throw new Error('No transcript found');

    // Download as .txt
    const filename = sanitizeFilename(result.title || 'transcript') + '.txt';
    await chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(result.text),
      filename,
      saveAs: false
    });

    toast(jobId, 'Saved to Downloads', 'done');

  } catch (err) {
    console.error('[Transcribe]', err.message);
    toast(jobId, err.message, 'error');
  } finally {
    busy = false;
  }
}


// ===================================================================
//  TOAST (sends message to content script)
// ===================================================================

function toast(id, text, status) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, {
    type: 'toast',
    id,
    text,
    status
  }).catch(() => {});
}


// ===================================================================
//  YOUTUBE (regular videos + Shorts)
//  Uses InnerTube API (same approach as youtube-transcript-api library)
//  Page baseUrls are stale — InnerTube returns fresh, working URLs
// ===================================================================

async function handleYouTube(tab, url) {
  let videoId;
  if (url.pathname.startsWith('/shorts/')) {
    videoId = url.pathname.split('/shorts/')[1].split(/[/?#]/)[0];
  } else if (url.searchParams.has('v')) {
    videoId = url.searchParams.get('v');
  } else {
    const m = url.pathname.match(/(?:embed|v)\/([a-zA-Z0-9_-]{11})/);
    videoId = m?.[1];
  }
  if (!videoId) throw new Error('No video ID found');

  // Run InnerTube API call + transcript fetch from the page's MAIN world
  // (service worker fetch gets rejected by YouTube due to extension Origin header)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [videoId],
    func: async (videoId) => {
      try {
        const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

        // Step 1: Get fresh caption tracks from InnerTube player API
        const playerRes = await fetch(
          'https://www.youtube.com/youtubei/v1/player?key=' + API_KEY,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: {
                client: { clientName: 'ANDROID', clientVersion: '20.10.38' }
              },
              videoId
            })
          }
        );
        if (!playerRes.ok) return { error: 'YouTube API failed (' + playerRes.status + ')' };

        const playerData = await playerRes.json();

        if (playerData?.playabilityStatus?.status !== 'OK') {
          return { error: playerData?.playabilityStatus?.reason || 'Video unavailable' };
        }

        const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks?.length) return { error: 'No captions available' };

        const title = playerData?.videoDetails?.title || videoId;

        // Pick best track (prefer manual EN > auto EN > any EN > first)
        const track =
          tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
          tracks.find(t => t.languageCode === 'en') ||
          tracks.find(t => t.languageCode?.startsWith('en')) ||
          tracks[0];

        // Step 2: Fetch transcript XML (strip &fmt=srv3 like youtube-transcript-api)
        const transcriptUrl = track.baseUrl.replace('&fmt=srv3', '');
        const res = await fetch(transcriptUrl);
        if (!res.ok) return { error: 'Transcript fetch failed (' + res.status + ')' };

        const xml = await res.text();
        if (!xml) return { error: 'Transcript response is empty' };

        // Parse XML transcript
        const entries = [...xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)];
        if (!entries.length) return { error: 'Transcript is empty' };

        const fmt = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = Math.floor(sec % 60);
          return h > 0
            ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
            : m + ':' + String(s).padStart(2, '0');
        };

        const decode = (text) => text
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
          .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();

        const lines = entries.map(([, start, text]) =>
          '[' + fmt(parseFloat(start)) + '] ' + decode(text)
        );

        return { title, text: lines.join('\n') };
      } catch (e) {
        return { error: e.message };
      }
    }
  });

  if (result?.error) throw new Error(result.error);
  if (!result?.text) throw new Error('No transcript found');
  return result;
}


// ===================================================================
//  TIKTOK
//  Strategy: 3 extraction methods tried in order
//    1. Hydration element (fast, works on fresh page loads)
//    2. TikTok web API (works after SPA navigation)
//    3. Service worker HTML fetch (last resort)
// ===================================================================

async function handleTikTok(tab, url) {
  // Method 1: Content script extracts from hydration element + fetches subtitle
  // (must run from page origin to avoid CORS on TikTok CDN)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: ttExtractAndFetch
  });

  if (result?.subtitleText) return ttParseResult(result);

  // Method 2: TikTok web API — works after SPA navigation when hydration is stale
  const videoId = ttExtractVideoId(url);
  if (videoId) {
    const [{ result: apiResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [videoId],
      func: ttFetchFromApi
    });
    if (apiResult?.subtitleText) return ttParseResult(apiResult);
  }

  // Method 3: Service worker fetches page HTML directly
  const fetched = await ttExtractFromFetch(tab.url);
  if (fetched?.subtitleText) return ttParseResult(fetched);

  throw new Error('No captions available');
}

// Extract video ID from TikTok URL
function ttExtractVideoId(url) {
  const m = url.pathname.match(/\/video\/(\d+)/);
  return m?.[1] || null;
}

function ttParseResult({ subtitleText, format, title }) {
  let lines;
  if (format === 'webvtt') {
    lines = parseWebVTT(subtitleText);
  } else {
    try {
      const json = JSON.parse(subtitleText);
      lines = (json.utterances || []).map(u =>
        `[${formatTime(u.start_time / 1000)}] ${u.text}`
      );
    } catch {
      lines = [subtitleText];
    }
  }

  if (!lines.length) throw new Error('Transcript is empty');
  return { title: title || 'tiktok', text: lines.join('\n') };
}

// Method 1: Runs in content script context — extracts from hydration element
// and fetches subtitle file from page origin (no CORS)
async function ttExtractAndFetch() {
  try {
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el) return null;

    const data = JSON.parse(el.textContent);
    const vd = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail'];
    if (!vd || vd.statusCode !== 0) return null;

    const item = vd.itemInfo?.itemStruct;
    if (!item?.video) return null;

    let subtitleUrl = null;
    let format = 'webvtt';
    const title = item.desc || '';

    // Primary: subtitleInfos
    const subs = item.video.subtitleInfos;
    if (subs?.length) {
      const s = subs.find(x => x.LanguageCodeName?.startsWith('eng')) || subs[0];
      subtitleUrl = s.Url || s.url;
      format = (s.Format || s.format || 'webvtt').toLowerCase();
    }

    // Fallback: claInfo.captionInfos (camelCase) or cla_info.caption_infos (legacy)
    if (!subtitleUrl) {
      const claInfo = item.video.claInfo || item.video.cla_info;
      const caps = claInfo?.captionInfos || claInfo?.caption_infos;
      if (caps?.length) {
        const c = caps.find(x =>
          x.languageCode === 'en' || x.languageCode?.startsWith('eng')
        ) || caps[0];
        subtitleUrl = c.url || c.urlList?.[0];
        format = (c.captionFormat || 'webvtt').toLowerCase();
      }
    }

    if (!subtitleUrl) return { title, subtitleText: null };

    // Fetch from page context — no CORS issue
    const res = await fetch(subtitleUrl);
    const subtitleText = await res.text();

    return { subtitleText, format, title };
  } catch {
    return null;
  }
}

// Method 2: Runs in MAIN world — calls TikTok's internal web API
// Works after SPA navigation when hydration element has stale data
async function ttFetchFromApi(videoId) {
  try {
    const apiUrl = 'https://www.tiktok.com/api/item/detail/?itemId=' + videoId;
    const res = await fetch(apiUrl);
    if (!res.ok) return null;

    const json = await res.json();
    const item = json?.itemInfo?.itemStruct;
    if (!item?.video) return null;

    let subtitleUrl = null;
    let format = 'webvtt';
    const title = item.desc || '';

    const subs = item.video.subtitleInfos;
    if (subs?.length) {
      const s = subs.find(x => x.LanguageCodeName?.startsWith('eng')) || subs[0];
      subtitleUrl = s.Url || s.url;
      format = (s.Format || s.format || 'webvtt').toLowerCase();
    }

    if (!subtitleUrl) {
      const claInfo = item.video.claInfo || item.video.cla_info;
      const caps = claInfo?.captionInfos || claInfo?.caption_infos;
      if (caps?.length) {
        const c = caps.find(x =>
          x.languageCode === 'en' || x.languageCode?.startsWith('eng')
        ) || caps[0];
        subtitleUrl = c.url || c.urlList?.[0];
        format = (c.captionFormat || 'webvtt').toLowerCase();
      }
    }

    if (!subtitleUrl) return null;

    const subRes = await fetch(subtitleUrl);
    const subtitleText = await subRes.text();

    return { subtitleText, format, title };
  } catch {
    return null;
  }
}

// Method 3: Service worker fetches page HTML, extracts subtitle URL
// Last resort — may fail due to CORS on subtitle CDN or bot detection on page
async function ttExtractFromFetch(pageUrl) {
  try {
    const res = await fetch(pageUrl);
    const html = await res.text();

    const match = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const vd = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail'];
    if (!vd || vd.statusCode !== 0) return null;

    const item = vd.itemInfo?.itemStruct;
    if (!item?.video) return null;

    const title = item.desc || '';
    let subtitleUrl = null;
    let format = 'webvtt';

    const subs = item.video.subtitleInfos;
    if (subs?.length) {
      const s = subs.find(x => x.LanguageCodeName?.startsWith('eng')) || subs[0];
      subtitleUrl = s.Url || s.url;
      format = (s.Format || s.format || 'webvtt').toLowerCase();
    }

    if (!subtitleUrl) {
      const claInfo = item.video.claInfo || item.video.cla_info;
      const caps = claInfo?.captionInfos || claInfo?.caption_infos;
      if (caps?.length) {
        const c = caps.find(x =>
          x.languageCode === 'en' || x.languageCode?.startsWith('eng')
        ) || caps[0];
        subtitleUrl = c.url || c.urlList?.[0];
        format = (c.captionFormat || 'webvtt').toLowerCase();
      }
    }

    if (!subtitleUrl) return null;

    const subRes = await fetch(subtitleUrl);
    const subtitleText = await subRes.text();

    return { subtitleText, format, title };
  } catch {
    return null;
  }
}


// ===================================================================
//  WEBVTT PARSER
// ===================================================================

function parseWebVTT(vtt) {
  const lines = vtt.split('\n');
  const cues = [];
  let i = 0;

  while (i < lines.length && !lines[i].includes('-->')) i++;

  while (i < lines.length) {
    if (lines[i].includes('-->')) {
      const startStr = lines[i].split('-->')[0].trim();
      const ts = formatTime(parseVTTTime(startStr));
      i++;

      const parts = [];
      while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
        const line = lines[i].trim();
        if (!/^\d+$/.test(line)) parts.push(line);
        i++;
      }
      if (parts.length) cues.push(`[${ts}] ${parts.join(' ')}`);
    } else {
      i++;
    }
  }
  return cues;
}

function parseVTTTime(ts) {
  const p = ts.split(':').map(s => parseFloat(s));
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || 0;
}


// ===================================================================
//  UTILITIES
// ===================================================================

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
