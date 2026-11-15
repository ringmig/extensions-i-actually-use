// YouTube's player swallows right-click (preventDefault + its own menu), so
// Chrome's menu, and the Transcribe item in it, never shows over the video.
// Runs in MAIN world at document_start, so this window capture listener is
// registered before any of YouTube's. Shift+right-click still gets YouTube's menu.
window.addEventListener('contextmenu', (e) => {
  if (e.shiftKey) return;
  if (e.target instanceof Element && e.target.closest('.html5-video-player')) {
    e.stopImmediatePropagation();
  }
}, true);
