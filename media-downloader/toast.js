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

  // Inject pulse animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes __mdl-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }
  `;
  document.head.appendChild(style);

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg) => {
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
