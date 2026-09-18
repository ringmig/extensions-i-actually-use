/* ============================================================
   Toast Overlay — Content Script
   Shows a small floating notification on the active page
   when downloads are processing, complete, or failed.
   ============================================================ */

(() => {
  let container = null;
  const toasts = new Map(); // id -> element

  function getContainer() {
    if (container && document.body.contains(container)) return container;

    container = document.createElement('div');
    container.id = '__media-dl-toasts';
    const s = container.style;
    s.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 8px;
      pointer-events: none;
      font-family: -apple-system, system-ui, sans-serif;
    `;
    document.body.appendChild(container);
    return container;
  }

  function createToast(id, text, status) {
    const el = document.createElement('div');
    el.dataset.id = id;
    el.style.cssText = `
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(20, 20, 20, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #e8e8e8;
      font-size: 13px;
      line-height: 1.3;
      max-width: 340px;
      width: fit-content;
      min-width: 85px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      opacity: 0;
    `;

    const dot = document.createElement('div');
    dot.className = '__mdl-dot';
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    `;

    const label = document.createElement('span');
    label.style.cssText = `
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    `;

    const closeBtn = document.createElement('div');
    closeBtn.className = '__mdl-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.style.cssText = `
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      color: #888;
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      display: none;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    `;
    closeBtn.addEventListener('mouseover', () => { closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseout', () => { closeBtn.style.color = '#888'; });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'cancel', id });
      removeToast(id);
    });

    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(closeBtn);

    applyStatus(el, text, status);
    getContainer().appendChild(el);
    toasts.set(id, el);

    // Slide in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
      });
    });

    return el;
  }

  function applyStatus(el, text, status) {
    const dot = el.querySelector('.__mdl-dot');
    const label = el.querySelector('span');
    const close = el.querySelector('.__mdl-close');
    label.textContent = text;

    const active = status === 'processing' || status === 'downloading';
    if (close) close.style.display = active ? 'flex' : 'none';

    if (status === 'processing') {
      dot.style.background = '#4A90D9';
      dot.style.animation = '__mdl-pulse 1s infinite';
    } else if (status === 'downloading') {
      dot.style.background = '#4A90D9';
      dot.style.animation = '__mdl-pulse 1s infinite';
    } else if (status === 'done') {
      dot.style.background = '#4CAF50';
      dot.style.animation = 'none';
    } else if (status === 'error') {
      dot.style.background = '#F44336';
      dot.style.animation = 'none';
    }
  }

  function removeToast(id) {
    const el = toasts.get(id);
    if (!el) return;
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      toasts.delete(id);
      if (toasts.size === 0 && container) {
        container.remove();
        container = null;
      }
    }, 300);
  }

  // Inject pulse animation. We may run at document_start before <head>
  // exists, so defer until DOM is ready.
  function injectPulseStyle() {
    if (document.getElementById('__mdl-pulse-style')) return;
    const style = document.createElement('style');
    style.id = '__mdl-pulse-style';
    style.textContent = `
      @keyframes __mdl-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.head) {
    injectPulseStyle();
  } else {
    document.addEventListener('DOMContentLoaded', injectPulseStyle, { once: true });
  }

  /* ---------- Inline SVG capture ---------- */
  // Track the most recent right-click target so the background can ask
  // "what was just right-clicked?" — needed because Chrome's context menu
  // info object has no field for the actual DOM element.
  //
  // We listen on BOTH mousedown (button=2) and contextmenu, in capture phase,
  // on window (highest in propagation chain) — mousedown fires first and is
  // rarely blocked, contextmenu is the canonical event. Combined with
  // run_at: document_start, this guarantees we register before any page JS.
  let lastRightClickTarget = null;
  let lastRightClickPos = null;
  function captureRightClick(e) {
    if (e.type === 'mousedown' && e.button !== 2) return;
    lastRightClickTarget = e.target;
    lastRightClickPos = { x: e.clientX, y: e.clientY };
  }
  window.addEventListener('mousedown', captureRightClick, true);
  window.addEventListener('contextmenu', captureRightClick, true);

  function findSvgElement(el) {
    if (!el) return null;
    // Walk up: did we click on an SVG child (path/g/text/etc.)?
    let node = el;
    while (node && node !== document.body && node !== document.documentElement && node !== document) {
      if (node.tagName && node.tagName.toLowerCase() === 'svg') return node;
      node = node.parentNode;
    }
    // Walk down: did we click on an <a> or small wrapper that contains an SVG?
    // Skip body/html to avoid grabbing a random SVG when the click missed.
    // The SVG must sit under the cursor — otherwise a big container (a video
    // player) hands back whatever icon it happens to contain (mute button).
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag && tag !== 'body' && tag !== 'html' && el.querySelectorAll) {
      for (const child of el.querySelectorAll('svg')) {
        if (isUnderCursor(child)) return child;
      }
    }
    return null;
  }

  function isUnderCursor(el) {
    if (!lastRightClickPos) return false;
    const r = el.getBoundingClientRect();
    const { x, y } = lastRightClickPos;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function serializeSvg(svgEl) {
    const clone = svgEl.cloneNode(true);
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!clone.getAttribute('xmlns:xlink')) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    // If the original SVG has no width/height attrs, inline the rendered size
    // so the saved file opens at the size the user actually saw.
    const rect = svgEl.getBoundingClientRect();
    if (!clone.getAttribute('width') && rect.width > 0) {
      clone.setAttribute('width', Math.round(rect.width));
    }
    if (!clone.getAttribute('height') && rect.height > 0) {
      clone.setAttribute('height', Math.round(rect.height));
    }
    return new XMLSerializer().serializeToString(clone);
  }

  // Walk up from the right-clicked element to find an Instagram post URL.
  // Chrome's context-menu info is unreliable on Instagram — feed images
  // often expose only the page URL because the click target sits above the
  // <img> (or the image is rendered as a background-image). The DOM still
  // knows which post it belongs to: each post is wrapped in <article>, and
  // a permalink anchor (/p/, /reel/, /tv/) lives inside it. Profile grids
  // skip the <article> and use the anchor as the tile wrapper.
  function findInstagramPostUrl(el) {
    if (!el) return null;
    const matchPost = (href) => {
      try {
        const u = new URL(href, location.origin);
        const m = u.pathname.match(/^\/(p|reel|tv)\/([^/?#]+)/);
        return m ? `${u.origin}/${m[1]}/${m[2]}/` : null;
      } catch { return null; }
    };
    // Walk up looking for an enclosing <article> (feed/post pages)
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.tagName && node.tagName.toLowerCase() === 'article') {
        const links = node.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
        for (const a of links) {
          const found = matchPost(a.getAttribute('href'));
          if (found) return found;
        }
        break;
      }
      node = node.parentNode;
    }
    // Walk up looking for an enclosing post anchor (profile grid tiles)
    node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.tagName && node.tagName.toLowerCase() === 'a' && node.getAttribute('href')) {
        const found = matchPost(node.getAttribute('href'));
        if (found) return found;
      }
      node = node.parentNode;
    }
    return null;
  }

  // Scrape TikTok carousel images from the DOM when requested.
  // Two passes: the reliable `photomode` marker first, then a size-based
  // fallback for when TikTok renames its CDN paths again. Both passes exclude
  // site chrome — avatars, emoji, badges — by host and rendered size.
  const TT_JUNK = /avt|avatar|emoji|sticker|badge|logo|100x100|obj\/tos-.*-avt/i;

  function scrapeTikTokImages() {
    const photomode = [];
    const large = [];
    for (const img of document.querySelectorAll('img')) {
      let u;
      try { u = new URL(img.src); } catch { continue; }
      if (!/tiktokcdn|byteimg|ibyteimg/.test(u.hostname)) continue;
      if (TT_JUNK.test(u.pathname)) continue;
      const w = img.naturalWidth || 0;
      const shown = Math.min(img.clientWidth, img.clientHeight);
      const entry = { url: img.src, w, key: dedupeKey(u) };
      if (u.pathname.includes('photomode')) photomode.push(entry);
      else if (w >= 400 && shown >= 200) large.push(entry);
    }
    return bestPerSlide(photomode.length ? photomode : large);
  }

  // Same slide is rendered at several resolutions; the hex id in the path is
  // stable across them. Fall back to the pathname when there's no id.
  function dedupeKey(u) {
    const m = u.pathname.match(/\/([a-f0-9]{20,})[~.]/);
    return m ? m[1] : u.pathname;
  }

  function bestPerSlide(entries) {
    const byKey = {};
    for (const e of entries) {
      if (!byKey[e.key] || e.w > byKey[e.key].w) byKey[e.key] = e;
    }
    return Object.values(byKey).map(v => v.url);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'scrape-tiktok-images') {
      sendResponse({ images: scrapeTikTokImages() });
      return false;
    }
    if (msg.type === 'get-instagram-post-url') {
      sendResponse({ url: findInstagramPostUrl(lastRightClickTarget) });
      return false;
    }
    if (msg.type === 'get-right-clicked-svg') {
      const svg = findSvgElement(lastRightClickTarget);
      if (!svg) {
        sendResponse({ svg: null });
        return false;
      }
      try {
        sendResponse({
          svg: serializeSvg(svg),
          id: svg.id || null
        });
      } catch (e) {
        sendResponse({ svg: null, error: String(e) });
      }
      return false;
    }
    if (msg.type !== 'toast') return;

    const { id, text, status } = msg;

    if (status === 'dismiss') {
      removeToast(id);
      return;
    }

    const existing = toasts.get(id);
    if (existing) {
      applyStatus(existing, text, status);

      // Auto-dismiss success/error after delay
      if (status === 'done' || status === 'error') {
        setTimeout(() => removeToast(id), 2000);
      }
    } else {
      createToast(id, text, status);

      if (status === 'done' || status === 'error') {
        setTimeout(() => removeToast(id), 2000);
      }
    }
  });
})();
