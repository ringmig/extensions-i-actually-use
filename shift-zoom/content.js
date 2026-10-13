(() => {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let lastTarget = null;
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  function getTarget() {
    return document.fullscreenElement || document.documentElement;
  }

  function clear(el) {
    el.style.translate = '';
    el.style.scale = '';
    el.style.transformOrigin = '';
  }

  // Chrome's UA sheet sets `transform: none !important` on :fullscreen, which beats inline
  // styles. The individual translate/scale properties are not reset, so use those.
  function applyTransform() {
    const target = getTarget();
    if (lastTarget && lastTarget !== target) clear(lastTarget);
    lastTarget = target;
    target.style.transformOrigin = '0 0';
    target.style.translate = `${tx}px ${ty}px`;
    target.style.scale = scale;
  }

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    clear(getTarget());
    if (lastTarget) clear(lastTarget);
    lastTarget = null;
  }

  // Reset zoom when entering/exiting fullscreen to avoid stuck transforms
  document.addEventListener('fullscreenchange', () => {
    if (scale > 1) reset();
  });

  window.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return;
    // In an iframe, only zoom when its content is fullscreen (embedded players)
    if (window !== window.top && !document.fullscreenElement) return;
    e.preventDefault();
    e.stopPropagation();

    // macOS remaps shift+scroll Y to X, so check both axes
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;

    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.pow(0.997, raw)));
    if (newScale === scale) return;

    const mx = e.clientX;
    const my = e.clientY;
    const ratio = newScale / scale;

    tx = mx - (mx - tx) * ratio;
    ty = my - (my - ty) * ratio;
    scale = newScale;

    if (scale <= MIN_SCALE + 0.001) {
      reset();
    } else {
      applyTransform();
    }
  }, { passive: false, capture: true });

  // Escape to reset zoom
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scale > 1) {
      e.preventDefault();
      e.stopPropagation();
      reset();
    }
  }, { capture: true });
})();
