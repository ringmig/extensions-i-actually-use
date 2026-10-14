// Click: one fullscreen window holding grid.html. Its framing rules die with its tab.
chrome.action.onClicked.addListener(() =>
  chrome.windows.create({ url: 'grid.html', type: 'popup', state: 'fullscreen' }))

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }))
