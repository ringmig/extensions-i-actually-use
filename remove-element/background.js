// Toolbar button, shortcut and the right-click entry all toggle picking in the top frame.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: 'pick', title: 'Remove Element', contexts: ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection'] }))
})

// Four Panes' grid is an extension page, where this extension's scripts never run.
// Nothing answers there, so the request goes to Four Panes, which bundles a copy.
// Its id is fixed by the key in its manifest.
const FOUR_PANES = 'pagdgihehgjihhedbfdlgekkekkjlabc'
const pick = (tab, frameId = 0) => chrome.tabs.sendMessage(tab.id, 'pick', { frameId: 0 })
  .catch(() => chrome.runtime.sendMessage(FOUR_PANES, { removeElement: 'pick', tabId: tab.id, frameId }).catch(() => {}))
chrome.action.onClicked.addListener((tab) => pick(tab))
chrome.contextMenus.onClicked.addListener(({ frameId }, tab) => pick(tab, frameId))

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (typeof msg.picking === 'boolean' && sender.tab)
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.picking ? 'PÅ' : '' })
})
chrome.action.setBadgeBackgroundColor({ color: '#ff453a' })

// A reload ends picking, so the badge goes with it.
chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status === 'loading') chrome.action.setBadgeText({ tabId, text: '' })
})

// Until 3.4 removals lived in local storage; move them to sync once.
chrome.runtime.onInstalled.addListener(async () => {
  const { panes, gap, color, ...old } = await chrome.storage.local.get(null)
  if (!Object.keys(old).length) return
  const synced = await chrome.storage.sync.get(Object.keys(old))
  await chrome.storage.sync.set(Object.fromEntries(Object.entries(old).filter(([k]) => !synced[k])))
  await chrome.storage.local.remove(Object.keys(old))
})
