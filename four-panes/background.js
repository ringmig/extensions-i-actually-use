// Toolbar click or right-click menu: one fullscreen window holding grid.html.
// Its framing rules die with its tab.
const openGrid = () => chrome.windows.create({ url: 'grid.html', type: 'popup', state: 'fullscreen' })

chrome.runtime.onInstalled.addListener(() =>
  chrome.contextMenus.create({ id: 'open', title: 'Öppna Four Panes', contexts: ['page', 'frame', 'link', 'selection', 'image'] }))

chrome.action.onClicked.addListener(openGrid)
chrome.contextMenus.onClicked.addListener(openGrid)

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }))
