// Shared by every extension page. Every read falls back field by field.
export const DEFAULTS = { panes: Array(4).fill('https://www.google.com/'), gap: 2, color: '#3a3a3c' }

// A typed homepage: https:// is added when missing.
export const toHome = (s) => {
  s = String(s ?? '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try { return new URL(s).href } catch { return null }
}

// What was typed in the URL bar: an address, or else a Google search.
export const toUrl = (text) => {
  const t = text.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (/^(localhost|[^\s/]+\.[^\s/]+)(:\d+)?(\/\S*)?$/i.test(t)) return 'https://' + t
  return 'https://www.google.com/search?q=' + encodeURIComponent(t)
}

export async function load() {
  const raw = await chrome.storage.sync.get(DEFAULTS)
  return {
    panes: DEFAULTS.panes.map((d, i) => toHome(raw.panes?.[i]) ?? d),
    gap: Number.isFinite(raw.gap) && raw.gap >= 0 ? raw.gap : DEFAULTS.gap,
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULTS.color,
  }
}
