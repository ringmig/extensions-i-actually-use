// Toolbar click or right-click menu: one fullscreen window holding grid.html.
// Its framing rules die with its tab.
const openGrid = () => chrome.windows.create({ url: 'grid.html', type: 'popup', state: 'fullscreen' })

chrome.runtime.onInstalled.addListener(() =>
  chrome.contextMenus.create({ id: 'open', title: 'Öppna Four Panes', contexts: ['page', 'frame', 'link', 'selection', 'image'] }))

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
