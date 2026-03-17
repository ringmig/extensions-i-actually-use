(() => {
  const IDLE_MS = 3000;
  let timer = null;
  let style = null;

  function hideCursor() {
    if (style) return;
    style = document.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: none !important; }';
    document.documentElement.appendChild(style);
  }

  function showCursor() {
    if (!style) return;
    style.remove();
    style = null;
  }

  function resetTimer() {
    showCursor();
    clearTimeout(timer);
    timer = setTimeout(hideCursor, IDLE_MS);
  }

  document.addEventListener('mousemove', resetTimer, { capture: true });
  document.addEventListener('mousedown', resetTimer, { capture: true });
  document.addEventListener('scroll', resetTimer, { capture: true });

  // Start the timer immediately (cursor hidden if user doesn't move for 3s)
  timer = setTimeout(hideCursor, IDLE_MS);
})();
