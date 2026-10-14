// Click: open four windows tiled 2x2 over the screen the last focused window is on.
// Click again while they are open: re-tile and bring them to the front.
import { load } from './settings.js'

const cells = ({ left, top, width, height }, gap) => {
  const w = Math.floor((width - gap) / 2), h = Math.floor((height - gap) / 2)
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([c, r]) => ({
    left: left + c * (w + gap), top: top + r * (h + gap), width: w, height: h,
  }))
}

async function targetWorkArea() {
  const displays = await chrome.system.display.getInfo()
  const win = await chrome.windows.getLastFocused().catch(() => null)
  if (win) {
    const x = win.left + win.width / 2, y = win.top + win.height / 2
    const hit = displays.find(({ bounds: b }) => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height)
    if (hit) return hit.workArea
  }
  return (displays.find((d) => d.isPrimary) ?? displays[0]).workArea
}

async function aliveIds() {
  const { ids = [] } = await chrome.storage.session.get('ids')
  const open = new Set((await chrome.windows.getAll()).map((w) => w.id))
  return ids.length === 4 && ids.every((id) => open.has(id)) ? ids : null
}

chrome.action.onClicked.addListener(async () => {
  const [cfg, area, ids] = await Promise.all([load(), targetWorkArea(), aliveIds()])
  const boxes = cells(area, cfg.gap)
  if (ids) {
    for (const [i, id] of ids.entries()) await chrome.windows.update(id, { ...boxes[i], state: 'normal', focused: true })
    return
  }
  const type = cfg.bare ? 'popup' : 'normal'
  const wins = []
  for (const [i, box] of boxes.entries()) wins.push(await chrome.windows.create({ url: cfg.panes[i], type, ...box }))
  // macOS may clamp the size on create; set it once more now that all four exist.
  for (const [i, w] of wins.entries()) await chrome.windows.update(w.id, boxes[i])
  await chrome.storage.session.set({ ids: wins.map((w) => w.id) })
})
