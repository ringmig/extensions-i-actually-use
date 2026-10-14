// Runs in every frame but only acts in a pane: a direct child of grid.html.
(() => {
  const grid = chrome.runtime.getURL('').slice(0, -1)
  const anc = location.ancestorOrigins
  if (window.parent !== window.top || anc?.[0] !== grid) return

  const tell = (fourPanes) => window.top.postMessage({ fourPanes, url: location.href }, grid)

  addEventListener('keydown', (e) => {
    if (!e.metaKey) return
    const k = e.key.toLowerCase()
    const run =
      k === 'l' && !e.shiftKey ? () => tell('l') :
      k === 'h' && e.shiftKey ? () => tell('home') :
      k === 'r' && e.shiftKey ? () => tell('allhome') :
      k === 'r' ? () => location.reload() :
      e.key === '[' ? () => history.back() :
      e.key === ']' ? () => history.forward() : null
    if (run) { e.preventDefault(); e.stopImmediatePropagation(); run() }
  }, true)

  // A link that wants a new window opens in the same pane.
  addEventListener('click', (e) => {
    const a = e.target.closest?.('a[target]')
    if (a && !/^_(self|parent|top)$/i.test(a.target)) a.target = '_self'
  }, true)
})()
