// ===================================================================
//  TRANSCRIBE — Toast notification system (content script)
//  Injected into YouTube & TikTok pages
// ===================================================================

(() => {
  // Idempotency guard — prevents double-init when injected programmatically
  // on tabs that already have the content_scripts version loaded
  if (window.__trnToastInit) return;
  window.__trnToastInit = true;

  const PREFIX = '__trn';
  const toasts = new Map();
  let container = null;

  // Inject keyframe animation into page
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ${PREFIX}-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }
  `;
  document.head.appendChild(style);

  function getContainer() {
    if (container && document.body.contains(container)) return container;

    container = document.createElement('div');
    container.id = `${PREFIX}-toasts`;
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: '8px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      fontFamily: '-apple-system, system-ui, "Segoe UI", sans-serif'
    });
    document.body.appendChild(container);
    return container;
  }

  function createToast(id, text, status) {
    const el = document.createElement('div');
    el.dataset.id = id;
    Object.assign(el.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 14px',
      width: 'fit-content',
      minWidth: '85px',
      maxWidth: '340px',
      background: 'rgba(20, 20, 20, 0.92)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      color: '#fff',
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '1',
      pointerEvents: 'auto',
      transform: 'translateX(120%)',
      opacity: '0',
      transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
      userSelect: 'none'
    });

    // Status dot
    const dot = document.createElement('div');
    dot.className = `${PREFIX}-dot`;
    Object.assign(dot.style, {
      width: '8px',
      height: '8px',
      minWidth: '8px',
      borderRadius: '50%',
      flexShrink: '0'
    });
    el.appendChild(dot);

    // Text label
    const label = document.createElement('span');
    Object.assign(label.style, {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums'
    });
    el.appendChild(label);

    applyStatus(el, text, status);

    getContainer().appendChild(el);
    toasts.set(id, el);

    // Slide in (double rAF for proper transition trigger)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
      });
    });
  }

  function applyStatus(el, text, status) {
    const dot = el.querySelector(`.${PREFIX}-dot`);
    const label = el.querySelector('span');

    if (label) label.textContent = text;

    if (dot) {
      const colors = {
        processing: '#4A90D9',
        done: '#4CAF50',
        error: '#F44336'
      };
      dot.style.background = colors[status] || '#4A90D9';
      dot.style.animation = status === 'processing'
        ? `${PREFIX}-pulse 1s infinite`
        : 'none';
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
      // Clean up container if empty
      if (toasts.size === 0 && container) {
        container.remove();
        container = null;
      }
    }, 300);
  }

  // Handle fetch requests from background (avoids CORS/cookie issues)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'fetch-url') {
      fetch(msg.url)
        .then(r => r.text())
        .then(text => sendResponse({ ok: true, text }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // keep channel open for async response
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
    } else {
      createToast(id, text, status);
    }

    // Auto-dismiss on completion states
    if (status === 'done' || status === 'error') {
      setTimeout(() => removeToast(id), 2500);
    }
  });
})();
