// Toolbar button, shortcut and the right-click entry all toggle picking in the top frame.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: 'pick', title: 'Remove Element', contexts: ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection'] }))
})

const pick = (tab) => chrome.tabs.sendMessage(tab.id, 'pick', { frameId: 0 }).catch(() => {})
chrome.action.onClicked.addListener(pick)
chrome.contextMenus.onClicked.addListener((_, tab) => pick(tab))

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (typeof msg.picking === 'boolean' && sender.tab)
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.picking ? 'PÅ' : '' })
})
chrome.action.setBadgeBackgroundColor({ color: '#ff453a' })

// A reload ends picking, so the badge goes with it.
chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status === 'loading') chrome.action.setBadgeText({ tabId, text: '' })
})
