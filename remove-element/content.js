// Removed elements are saved per host as CSS selectors and hidden by one style
// sheet from document_start, so they never flash in and stay gone when a
// framework re-renders them. The right-clicked element is caught on window in
// the capture phase at document_start, before page scripts can swallow it (../CLAUDE.md).
(() => {
  const host = location.hostname || location.href
  let selectors = []
  const sheet = document.createElement('style')
  const render = () => {
    sheet.textContent = selectors.map((s) => `${s} { display: none !important; }`).join('\n')
    if (!sheet.isConnected) document.documentElement.append(sheet)
  }
  const save = () => { render(); chrome.storage.local.set({ [host]: selectors }) }
  chrome.storage.local.get(host).then((r) => { selectors = r[host] ?? []; render() })

  // ponytail: positional selectors anchored at the nearest stable id; a site that
  // reshuffles its markup loses them. Upgrade: store several candidates per element.
  function selectorFor(el) {
    const parts = []
    for (; el && el !== document.documentElement; el = el.parentElement) {
      if (el.id && !/\d{3,}|^[a-z]{1,2}\d|:/.test(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id))
        return parts.join(' > ')
      }
      let i = 1
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++
      parts.unshift(`${el.localName}:nth-of-type(${i})`)
    }
    return ['html', ...parts].join(' > ')
  }

  const removable = (el) => el instanceof Element && el !== document.documentElement && el !== document.body
  const hide = (el) => {
    if (!removable(el)) return
    selectors.push(selectorFor(el))
    save()
  }
  const undo = () => { if (selectors.length) { selectors.pop(); save() } }
  const reset = () => { selectors = []; save() }

  // Quick removal of the right-clicked element.
  let rightClicked = null
  const catchTarget = (e) => {
    if (e.type === 'mousedown' && e.button !== 2) return
    rightClicked = e.composedPath()[0]
  }
  window.addEventListener('mousedown', catchTarget, true)
  window.addEventListener('contextmenu', catchTarget, true)

  // Picking mode: the element under the pointer is outlined; arrow up widens to
  // the parent, arrow down narrows back, click removes, Esc ends.
  let picking = false, current = null, trail = []
  const box = document.createElement('div')
  const label = document.createElement('div')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;' +
    'border:2px solid #ff453a;background:rgba(255,69,58,.15);border-radius:3px;transition:all 60ms linear'
  label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;max-width:90vw;overflow:hidden;' +
    'text-overflow:ellipsis;white-space:nowrap;padding:4px 8px;border-radius:6px;background:#1c1c1e;color:#fff;' +
    'font:12px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)'

  const describe = (el) => el.localName + (el.id ? '#' + el.id : '') +
    [...el.classList].slice(0, 2).map((c) => '.' + c).join('')
  function draw() {
    if (!current) { box.remove(); label.remove(); return }
    const r = current.getBoundingClientRect()
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    label.textContent = `${describe(current)}   ↑ större  ↓ mindre  klick tar bort  ⌘Z ångra  Esc klar`
    Object.assign(label.style, { left: Math.max(4, r.left) + 'px', top: (r.top > 30 ? r.top - 28 : Math.min(innerHeight - 28, r.bottom + 4)) + 'px' })
    document.documentElement.append(box, label)
  }
  const point = (el) => { current = removable(el) ? el : null; trail = []; draw() }

  const onMove = (e) => { const el = e.composedPath()[0]; if (el !== current && !trail.includes(el)) point(el) }
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation() }
  const onClick = (e) => {
    swallow(e)
    if (!current) return
    hide(current)
    current = null; trail = []; draw()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { swallow(e); stop() }
    else if (e.key === 'ArrowUp' && current && removable(current.parentElement)) { swallow(e); trail.push(current); current = current.parentElement; draw() }
    else if (e.key === 'ArrowDown' && trail.length) { swallow(e); current = trail.pop(); draw() }
    else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { swallow(e); undo(); draw() }
  }
  const redraw = () => draw()
  const LISTEN = [['mousemove', onMove], ['click', onClick], ['mousedown', swallow], ['mouseup', swallow],
    ['pointerdown', swallow], ['pointerup', swallow], ['keydown', onKey], ['scroll', redraw]]

  function start() {
    if (picking) return
    picking = true
    for (const [t, f] of LISTEN) window.addEventListener(t, f, true)
    chrome.runtime.sendMessage({ picking: true })
  }
  function stop() {
    if (!picking) return
    picking = false
    for (const [t, f] of LISTEN) window.removeEventListener(t, f, true)
    current = null; trail = []; draw()
    chrome.runtime.sendMessage({ picking: false })
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg === 'pick') picking ? stop() : start()
    else if (msg === 'hide') { hide(rightClicked); rightClicked = null }
    else if (msg === 'undo') undo()
    else if (msg === 'reset') reset()
  })
})()
