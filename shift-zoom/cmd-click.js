// Cmd+click (Ctrl+click off macOS) on a link always opens a new tab.
// Sites that route clicks themselves call preventDefault without checking the
// modifier and navigate in place. Registered on window in the capture phase at
// document_start, this runs before any page listener: stopping the event there
// leaves the browser's own default, which is the new tab.
(() => {
  const isMac = navigator.platform.includes('Mac');

  window.addEventListener('click', (e) => {
    if (e.button !== 0 || !(isMac ? e.metaKey : e.ctrlKey)) return;
    // composedPath sees through shadow roots, closest() does not
    const link = e.composedPath().find((el) => el instanceof HTMLAnchorElement && el.href);
    if (!link || !/^https?:/.test(link.href)) return;
    e.stopImmediatePropagation();
  }, true);
})();
