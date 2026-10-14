// Toolbar click or right-click menu: one fullscreen window holding grid.html.
// Its framing rules die with its tab.
const openGrid = () => chrome.windows.create({ url: 'grid.html', type: 'popup', state: 'fullscreen' })

const contexts = ['page', 'frame', 'link', 'selection', 'image']
const REMOVE_ELEMENT = 'chrome://extensions/?id=jcgpghgjhhahcefnfpbncdmhhddedhnk' // Click to Remove Element

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open', title: 'Öppna Four Panes', contexts })
  chrome.contextMenus.create({ id: 'remove-element', title: 'Click to Remove Element: inställningar', contexts })
})

chrome.action.onClicked.addListener(openGrid)
chrome.contextMenus.onClicked.addListener(({ menuItemId }) =>
  menuItemId === 'remove-element' ? chrome.tabs.create({ url: REMOVE_ELEMENT }) : openGrid())

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }))
