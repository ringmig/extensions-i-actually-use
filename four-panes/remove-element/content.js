// Hidden elements are saved per host as CSS selectors and hidden by one style
// sheet from document_start, so they never flash in and stay gone when a
// framework re-renders them. Picking runs in the top frame only.
(() => {
  // A Four Panes pane is a whole page in an extension's iframe: treat it as a tab.
  const isPane = window.parent === window.top && !!location.ancestorOrigins?.[0]?.startsWith('chrome-extension://')
  // Bundled into Four Panes, this copy only serves the panes; the standalone extension has every other tab.
  if (chrome.runtime.getManifest().name !== 'Remove Element' && !isPane) return
  const top = window === window.top || isPane
  const host = location.hostname || location.href
  const tell = (picking) => chrome.runtime.sendMessage({ picking }).catch(() => {})
  let items = [] // { sel, label, shown }
  let panel = null

  const sheet = document.createElement('style')
  const render = () => {
    sheet.textContent = items.filter((i) => !i.shown).map((i) => `${i.sel} { display: none !important; }`).join('\n')
    if (!sheet.isConnected) document.documentElement.append(sheet)
    panel?.setItems(items)
  }
  const save = () => { render(); chrome.storage.local.set({ [host]: items }) }
  chrome.storage.local.get(host).then((r) => {
    // 1.x stored bare selector strings.
    items = (r[host] ?? []).map((i) => typeof i === 'string' ? { sel: i, label: i, shown: false } : i)
    render()
  })

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
  const describe = (el) => el.localName + (el.id ? '#' + el.id : '') +
    [...el.classList].slice(0, 2).map((c) => '.' + c).join('')
  const removable = (el) => el instanceof Element && el !== document.documentElement && el !== document.body

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
  async function poof(el) {
    const item = { sel: selectorFor(el), label: describe(el), shown: false }
    // fill: forwards holds the faded state until the style sheet has taken over, so nothing flashes back.
    const anim = reduceMotion.matches ? null : el.animate(
      [{ opacity: 1, scale: 1, filter: 'blur(0)' }, { opacity: 0, scale: 0.92, filter: 'blur(4px)' }],
      { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    // An animation that never ticks (hidden tab, no frames) must not keep the element.
    await Promise.race([anim?.finished.catch(() => {}), new Promise((r) => setTimeout(r, 220))])
    items.push(item)
    save()
    anim?.cancel()
  }

  // Picking: the element under the pointer is outlined, a click hides it, Esc ends.
  let picking = false, current = null
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;' +
    'border:2px solid #ff453a;background:rgba(255,69,58,.12);border-radius:4px'
  function draw() {
    if (!current) return box.remove()
    const r = current.getBoundingClientRect()
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    document.documentElement.append(box)
    // Keep the panel off the element being pointed at.
    const p = panel.rect()
    if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top && r.width < innerWidth * 0.6) panel.flip()
  }

  const inPanel = (e) => panel.contains(e)
  const swallow = (e) => { if (!inPanel(e)) { e.preventDefault(); e.stopImmediatePropagation() } }
  const onMove = (e) => {
    if (inPanel(e)) { current = null; return draw() }
    const el = e.composedPath()[0]
    if (el !== current) { current = removable(el) ? el : null; draw() }
  }
  const onClick = (e) => {
    if (inPanel(e)) return
    swallow(e)
    const el = current
    current = null; draw()
    if (el) poof(el)
  }
  const onKey = (e) => { if (e.key === 'Escape') { swallow(e); stop() } }
  const redraw = () => current && draw()
  const LISTEN = [['mousemove', onMove], ['click', onClick], ['mousedown', swallow], ['mouseup', swallow],
    ['pointerdown', swallow], ['pointerup', swallow], ['auxclick', swallow], ['keydown', onKey], ['scroll', redraw]]

  function start() {
    if (picking) return
    picking = true
    panel ??= createPanel({
      host,
      onToggle: (i) => { items[i].shown = !items[i].shown; save() },
      onDelete: (i) => { items.splice(i, 1); save() },
      onClose: stop,
    })
    panel.setItems(items)
    panel.show()
    for (const [t, f] of LISTEN) window.addEventListener(t, f, true)
    tell(true)
  }
  function stop() {
    if (!picking) return
    picking = false
    for (const [t, f] of LISTEN) window.removeEventListener(t, f, true)
    current = null; draw()
    panel.hide()
    tell(false)
  }

  const toggle = () => picking ? stop() : start()
  if (top) chrome.runtime.onMessage.addListener((msg) => { if (msg === 'pick') toggle() })
  // Four Panes' grid asks the pane under the pointer directly.
  if (isPane) addEventListener('message', (e) => { if (e.source === window.parent && e.data?.removeElement === 'pick') toggle() })
})()
