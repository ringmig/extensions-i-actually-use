// Saves on every change; an address that is not a valid URL keeps the previous one.
import { load, toUrl } from './settings.js'

const $ = (id) => document.getElementById(id)
const status = $('status')
let cfg = await load()

const fill = () => {
  cfg.panes.forEach((u, i) => { $('p' + i).value = u })
  $('gap').value = cfg.gap
  $('bare').checked = cfg.bare
}
fill()

async function save() {
  const panes = cfg.panes.map((old, i) => toUrl($('p' + i).value) ?? old)
  const gap = Math.max(0, Math.round(Number($('gap').value)) || 0)
  cfg = { panes, gap, bare: $('bare').checked }
  await chrome.storage.sync.set(cfg)
  fill()
  status.textContent = 'Sparat. Gäller nästa gång du öppnar rutorna.'
}

document.querySelectorAll('input').forEach((el) => el.addEventListener('change', save))
