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

  // Chrome does not run other extensions' content scripts in frames of an extension
  // page, so shift-zoom and auto-hide-cursor are copied in here, from ../shift-zoom
  // and ../auto-hide-cursor.

  // Shift + scroll zooms the pane towards the pointer, Esc resets.
  let scale = 1, tx = 0, ty = 0, zoomed = null
  // pane-main.js fakes fullscreen in the page world, which this world cannot see: it marks the element.
  const target = () => document.querySelector('[data-pane-fs]') || document.documentElement
  const clear = (el) => { el.style.translate = el.style.scale = el.style.transformOrigin = '' }
  const resetZoom = () => { scale = 1; tx = ty = 0; if (zoomed) clear(zoomed); zoomed = null }
  document.addEventListener('fullscreenchange', resetZoom)
  addEventListener('wheel', (e) => {
    if (!e.shiftKey) return
    e.preventDefault(); e.stopPropagation()
    // macOS remaps shift+scroll Y to X, so check both axes
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const next = Math.min(5, Math.max(1, scale * Math.pow(0.997, raw)))
    if (next === scale) return
    const r = next / scale
    tx = e.clientX - (e.clientX - tx) * r
    ty = e.clientY - (e.clientY - ty) * r
    scale = next
    if (scale <= 1.001) return resetZoom()
    const el = target()
    if (zoomed && zoomed !== el) clear(zoomed)
    zoomed = el
    // Individual translate/scale, because :fullscreen resets transform with !important.
    Object.assign(el.style, { transformOrigin: '0 0', translate: `${tx}px ${ty}px`, scale })
  }, { passive: false, capture: true })
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scale > 1) { e.preventDefault(); e.stopPropagation(); resetZoom() }
  }, true)

  // The pointer hides after three seconds at rest.
  const hide = document.createElement('style')
  hide.textContent = '*, *::before, *::after { cursor: none !important; }'
  let idle
  const wake = () => {
    hide.remove()
    clearTimeout(idle)
    idle = setTimeout(() => document.documentElement.append(hide), 3000)
  }
  for (const t of ['mousemove', 'mousedown', 'scroll']) document.addEventListener(t, wake, true)
  wake()
})()
