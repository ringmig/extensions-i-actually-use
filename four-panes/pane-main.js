// Page world of a pane: fullscreen fills the pane instead of the screen, and
// window.open loads in the pane. Panes are found by the extension-origin
// ancestor, the only thing this world can see.
(() => {
  const anc = location.ancestorOrigins
  if (window.parent !== window.top || !anc?.[0]?.startsWith('chrome-extension://')) return

  window.open = (url) => { if (url) location.href = new URL(url, location.href).href; return window }

  // ponytail: CSS fullscreen; an element under a transformed ancestor or a player
  // in a nested iframe only fills its own box. Upgrade: per-site fixes if it bites.
  let el = null
  const css = document.createElement('style')
  css.textContent = `[data-pane-fs]{position:fixed!important;inset:0!important;width:100vw!important;
    height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;
    z-index:2147483647!important;background:#000!important}`
  const changed = (t) => {
    for (const type of ['fullscreenchange', 'webkitfullscreenchange'])
      t.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
  }
  const enter = function () {
    if (el) el.removeAttribute('data-pane-fs')
    el = this
    document.documentElement.append(css)
    el.setAttribute('data-pane-fs', '')
    queueMicrotask(() => changed(el))
    return Promise.resolve()
  }
  const exit = () => {
    if (!el) return Promise.resolve()
    const t = el
    t.removeAttribute('data-pane-fs')
    el = null
    queueMicrotask(() => changed(t))
    return Promise.resolve()
  }
  Element.prototype.requestFullscreen = Element.prototype.webkitRequestFullscreen = enter
  Document.prototype.exitFullscreen = Document.prototype.webkitExitFullscreen = exit
  for (const name of ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement'])
    Object.defineProperty(Document.prototype, name, { get: () => el, configurable: true })
  for (const name of ['fullscreenEnabled', 'webkitFullscreenEnabled'])
    Object.defineProperty(Document.prototype, name, { get: () => true, configurable: true })
  for (const name of ['fullscreen', 'webkitIsFullScreen'])
    Object.defineProperty(Document.prototype, name, { get: () => !!el, configurable: true })
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && el) exit() }, true)
})()
