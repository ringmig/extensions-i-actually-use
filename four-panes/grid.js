// Four iframes. Sites refuse to be framed, so this tab, and only this tab, gets
// a session rule that strips X-Frame-Options and CSP from its sub-frames before
// the first pane loads. Frame-busting scripts are stopped by the sandbox, which
// leaves out allow-top-navigation.
import { load, toUrl } from './settings.js'

const cfg = await load()
const { id: tabId } = await chrome.tabs.getCurrent()
await chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [tabId],
  addRules: [{
    id: tabId, priority: 1,
    condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
    action: { type: 'modifyHeaders', responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' },
    ] },
  }],
})

const main = document.querySelector('main')
Object.assign(main.style, { gap: cfg.gap + 'px', background: cfg.color })

let active = 0 // the pane under the pointer
const panes = cfg.panes.map((home, i) => {
  const cell = document.createElement('div')
  cell.className = 'cell'
  cell.innerHTML = `<iframe allow="autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox
    allow-modals allow-downloads allow-presentation allow-storage-access-by-user-activation"></iframe>
    <form><input spellcheck="false" autocomplete="off"></form>`
  const [frame, form, input] = ['iframe', 'form', 'input'].map((s) => cell.querySelector(s))
  frame.src = home
  frame.addEventListener('mouseenter', () => { active = i })
  form.addEventListener('submit', (e) => { e.preventDefault(); frame.src = toUrl(input.value); close(i) })
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(i) })
  input.addEventListener('blur', () => close(i))
  main.append(cell)
  return { frame, form, input, home }
})

function openBar(i, url) {
  const p = panes[i]
  p.input.value = url || p.frame.src
  p.form.classList.add('open')
  p.input.focus(); p.input.select()
}
function close(i) {
  if (!panes[i].form.classList.contains('open')) return
  panes[i].form.classList.remove('open')
  panes[i].frame.focus()
}

// Keys pressed inside a pane arrive from pane.js; keys pressed on this page, here.
const act = (i, key, url) => {
  if (key === 'l') openBar(i, url)
  else if (key === 'home') panes[i].frame.src = panes[i].home
  else if (key === 'allhome') panes.forEach((p) => { p.frame.src = p.home })
}
addEventListener('message', (e) => {
  const i = panes.findIndex((p) => p.frame.contentWindow === e.source)
  if (i >= 0 && e.data?.fourPanes) act(i, e.data.fourPanes, e.data.url)
})
addEventListener('keydown', (e) => {
  if (!e.metaKey || e.target.tagName === 'INPUT') return
  const key = e.key.toLowerCase() === 'l' ? 'l' : e.key.toLowerCase() === 'h' && e.shiftKey ? 'home' : e.key === 'R' && e.shiftKey ? 'allhome' : null
  if (key) { e.preventDefault(); act(active, key) }
})

// Cmd+W cannot be caught, so closing asks first: a stray press must not drop four panes.
addEventListener('beforeunload', (e) => e.preventDefault())
