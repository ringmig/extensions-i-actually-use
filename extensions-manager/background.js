// chrome://extensions cannot be overridden, so the manager is its own tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
});
