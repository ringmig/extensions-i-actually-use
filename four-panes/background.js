// Toolbar click or right-click menu: one fullscreen window holding grid.html.
// Its framing rules die with its tab.
const openGrid = () => chrome.windows.create({ url: 'grid.html', type: 'popup', state: 'fullscreen' })

chrome.runtime.onInstalled.addListener(() =>
  chrome.contextMenus.create({ id: 'open', title: 'Open Four Panes', contexts: ['page', 'frame', 'link', 'selection', 'image'] }))

chrome.action.onClicked.addListener(openGrid)
chrome.contextMenus.onClicked.addListener(openGrid)

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }))

// Remove Element cannot reach the panes and forwards its toolbar button, shortcut
// and menu here. A right-click names its pane; the others mean the pane under the pointer.
chrome.runtime.onMessageExternal.addListener((msg) => {
  if (msg?.removeElement !== 'pick') return
  const { tabId, frameId } = msg
  const underPointer = () => chrome.runtime.sendMessage({ removeElement: 'pick', tabId }).catch(() => {})
  if (frameId > 0) chrome.tabs.sendMessage(tabId, 'pick', { frameId }).catch(underPointer)
  else underPointer()
})

// Until 3.4 removals lived in local storage; move them to sync once.
chrome.runtime.onInstalled.addListener(async () => {
  const { panes, gap, color, ...old } = await chrome.storage.local.get(null)
  if (!Object.keys(old).length) return
  const synced = await chrome.storage.sync.get(Object.keys(old))
  await chrome.storage.sync.set(Object.fromEntries(Object.entries(old).filter(([k]) => !synced[k])))
  await chrome.storage.local.remove(Object.keys(old))
})
