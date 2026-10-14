// Shared by background.js and options.js. Every read falls back field by field.
export const DEFAULTS = { panes: Array(4).fill('https://www.google.com/'), gap: 0, bare: false }

export const toUrl = (s) => {
  s = String(s ?? '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try { return new URL(s).href } catch { return null }
}

export async function load() {
  const raw = await chrome.storage.sync.get(DEFAULTS)
  return {
    panes: DEFAULTS.panes.map((d, i) => toUrl(raw.panes?.[i]) ?? d),
    gap: Number.isFinite(raw.gap) && raw.gap >= 0 ? raw.gap : DEFAULTS.gap,
    bare: raw.bare === true,
  }
}
