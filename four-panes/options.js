// Saves on every change; a homepage that is not a valid URL keeps the previous one.
import { load, toHome } from './settings.js'

const $ = (id) => document.getElementById(id)
let cfg = await load()

const fill = () => {
  cfg.panes.forEach((u, i) => { $('p' + i).value = u })
  $('gap').value = cfg.gap
  $('color').value = cfg.color
}
fill()

async function save() {
  cfg = {
    panes: cfg.panes.map((old, i) => toHome($('p' + i).value) ?? old),
    gap: Math.max(0, Math.round(Number($('gap').value)) || 0),
    color: $('color').value,
  }
  await chrome.storage.sync.set(cfg)
  fill()
  $('status').textContent = 'Sparat. Gäller nästa gång du öppnar rutorna.'
}

document.querySelectorAll('input').forEach((el) => el.addEventListener('change', save))
