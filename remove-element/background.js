// Menu, toolbar button and shortcut only relay commands; the page does the work.
const contexts = ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection']
const MENU = {
  pick: 'Välj saker att ta bort…',
  hide: 'Ta bort det här',
  undo: 'Ångra senaste borttagning',
  reset: 'Visa allt borttaget på den här sajten igen',
}

chrome.runtime.onInstalled.addListener(() => {
  for (const [id, title] of Object.entries(MENU)) chrome.contextMenus.create({ id, title, contexts })
})

const send = (tabId, msg, frameId = 0) => chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => {})

chrome.action.onClicked.addListener((tab) => send(tab.id, 'pick'))
// hide goes to the frame that was right-clicked; picking runs in the top frame.
chrome.contextMenus.onClicked.addListener(({ menuItemId, frameId }, tab) =>
  send(tab.id, menuItemId, menuItemId === 'pick' ? 0 : frameId))

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (typeof msg.picking === 'boolean' && sender.tab)
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.picking ? 'PÅ' : '' })
})
chrome.action.setBadgeBackgroundColor({ color: '#ff453a' })
// A reload ends picking mode, so the badge goes with it.
chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status === 'loading') chrome.action.setBadgeText({ tabId, text: '' })
})
