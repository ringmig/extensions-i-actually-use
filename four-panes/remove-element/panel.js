// The panel shown while picking. Lives in a shadow root so no page CSS reaches it.
// Loaded before content.js in the same content-script world; createPanel is global there.
// Icons from Lucide (ISC license, https://lucide.dev).
const ICON = {
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevron: '<path d="m18 15-6-6-6 6"/>',
}
// Overlays live in the top layer as manual popovers, the only place above a
// fullscreen element. Showing one again moves it to the top of that layer.
function raise(node) {
  if (!node.isConnected) document.documentElement.append(node)
  node.popover = 'manual'
  try { if (node.matches(':popover-open')) node.hidePopover(); node.showPopover() } catch {}
}

const svg = (name) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`

const PANEL_CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
:host([data-side="left"]) { right: auto; left: 16px; }
:host {
  --bg: oklch(0.985 0.002 260 / 0.97); --fg: oklch(0.22 0.01 260); --muted: oklch(0.52 0.01 260);
  --line: oklch(0.9 0.004 260); --well: oklch(0.955 0.003 260); --hover: oklch(0.93 0.004 260);
  --accent: oklch(0.63 0.22 27); --accent-soft: oklch(0.63 0.22 27 / 0.12);
  --shadow: 0 12px 40px oklch(0 0 0 / 0.18), 0 2px 6px oklch(0 0 0 / 0.08);
}
@media (prefers-color-scheme: dark) { :host {
  --bg: oklch(0.2 0.006 260 / 0.97); --fg: oklch(0.96 0.003 260); --muted: oklch(0.68 0.008 260);
  --line: oklch(0.3 0.006 260); --well: oklch(0.25 0.006 260); --hover: oklch(0.29 0.006 260);
  --accent: oklch(0.68 0.2 27); --accent-soft: oklch(0.68 0.2 27 / 0.16);
  --shadow: 0 12px 40px oklch(0 0 0 / 0.5), 0 2px 6px oklch(0 0 0 / 0.3);
} }
* { box-sizing: border-box; margin: 0; }
.panel {
  width: 340px; max-width: calc(100vw - 32px); background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  backdrop-filter: blur(16px); font: 13px/1.4 system-ui, -apple-system, sans-serif; overflow: hidden;
}
header { display: flex; align-items: center; padding: 2px; }
h1 { font-size: 13px; font-weight: 600; white-space: nowrap; }
.host, .badge { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host { flex: 1; }
button.toggle {
  flex: 1; display: flex; place-items: initial; align-items: center; justify-content: flex-start; gap: 8px;
  width: auto; min-width: 0; padding: 0 10px 0 12px; color: var(--fg); font: inherit; text-align: left;
}
.toggle svg { flex: none; margin-left: auto; color: var(--muted); transition: transform 160ms; }
.panel:not(.collapsed) .toggle svg { transform: rotate(180deg); }
.panel.collapsed { width: auto; }
.collapsed .host, .collapsed .list-head, .collapsed ul, .panel:not(.collapsed) .badge { display: none; }
.list-head { display: flex; justify-content: space-between; padding: 10px 14px 4px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
ul { list-style: none; padding: 0 0 4px; max-height: 232px; overflow-y: auto; }
li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; min-height: 44px; padding-left: 14px; padding-right: 2px; }
li + li { border-top: 1px solid var(--line); }
.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; }
li.shown .label { color: var(--muted); }
li.empty { display: block; min-height: 0; padding: 6px 14px 14px; color: var(--muted); }
button {
  display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); cursor: pointer; transition: background-color 120ms, color 120ms;
}
button:hover { background: var(--hover); color: var(--fg); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
button.armed { background: var(--accent-soft); color: var(--accent); }
li.shown .eye { color: var(--fg); }
@media (prefers-reduced-motion: reduce) { button, .toggle svg { transition: none; } }
`

function createPanel({ host, onToggle, onDelete, onClose }) {
  const el = document.createElement('remove-element-panel')
  // Inline !important beats any page rule on the host, e.g. Reddit-style `:not(:defined) { visibility: hidden }`.
  el.style.cssText = 'display:block!important;visibility:visible!important;opacity:1!important'
  const root = el.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${PANEL_CSS}</style>
    <section class="panel collapsed" role="dialog" aria-label="Remove Element">
      <header><button class="toggle" aria-expanded="false" title="Visa listan"><h1>Remove Element</h1>
        <span class="host"></span><span class="badge"></span>${svg('chevron')}</button>
        <button class="close" aria-label="Stäng (Esc)" title="Stäng (Esc)">${svg('x')}</button></header>
      <div class="list-head"><span>Dolt här</span><span class="count"></span></div>
      <ul></ul>
    </section>`
  const $ = (s) => root.querySelector(s)
  $('.host').textContent = host
  $('.close').addEventListener('click', onClose)
  // Starts folded to a single row so it covers as little of the page as possible.
  $('.toggle').addEventListener('click', () => {
    const open = $('.panel').classList.toggle('collapsed') === false
    $('.toggle').setAttribute('aria-expanded', open)
    $('.toggle').title = open ? 'Dölj listan' : 'Visa listan'
  })

  // Delete takes two clicks: the first arms the button, the second removes the item.
  let armed = null, disarm
  $('ul').addEventListener('click', (e) => {
    const btn = e.target.closest('button'), li = btn?.closest('li')
    if (!li) return
    const i = Number(li.dataset.i)
    if (btn.classList.contains('eye')) return onToggle(i)
    if (armed === btn) { clearTimeout(disarm); armed = null; return onDelete(i) }
    if (armed) armed.classList.remove('armed')
    armed = btn
    btn.classList.add('armed')
    btn.setAttribute('aria-label', 'Klicka igen för att ta bort från listan')
    clearTimeout(disarm)
    disarm = setTimeout(() => { btn.classList.remove('armed'); btn.setAttribute('aria-label', 'Ta bort från listan'); armed = null }, 2500)
  })

  return {
    el,
    show() { raise(el) },
    raise() { if (el.isConnected) raise(el) },
    hide() { el.remove() },
    contains: (e) => e.composedPath().includes(el),
    rect: () => el.getBoundingClientRect(),
    flip() { el.dataset.side = el.dataset.side === 'left' ? 'right' : 'left' },
    setItems(items) {
      armed = null
      $('.count').textContent = items.length ? String(items.length) : ''
      $('.badge').textContent = items.length ? `${items.length} dolda` : ''
      const ul = $('ul')
      if (!items.length) { ul.innerHTML = '<li class="empty">Klicka på något på sidan för att dölja det.</li>'; return }
      ul.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${it.shown ? 'shown' : ''}">
          <span class="label"></span>
          <button class="eye" aria-pressed="${it.shown}"></button>
          <button class="del" aria-label="Ta bort från listan" title="Ta bort från listan">${svg('trash')}</button>
        </li>`).join('')
      ul.querySelectorAll('li').forEach((li, i) => {
        const it = items[i], eye = li.querySelector('.eye'), label = li.querySelector('.label')
        label.textContent = label.title = it.label
        eye.innerHTML = svg(it.shown ? 'eye' : 'eyeOff')
        eye.title = eye.ariaLabel = it.shown ? 'Dölj igen' : 'Visa'
      })
    },
  }
}
