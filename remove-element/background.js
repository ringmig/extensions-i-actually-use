const contexts = ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection']

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'hide', title: 'Ta bort det här', contexts })
  chrome.contextMenus.create({ id: 'undo', title: 'Ångra senaste borttagning', contexts })
})

// Sent to the frame that was right-clicked, so elements inside iframes work too.
chrome.contextMenus.onClicked.addListener(({ menuItemId, frameId }, tab) =>
  chrome.tabs.sendMessage(tab.id, menuItemId, { frameId }).catch(() => {}))
