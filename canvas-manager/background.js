// The canvases live in the IndexedDB of the file:// origin, which only a
// file:// page can open. So the manager is drawn into a file:// tab (the
// directory listing of /), and this worker does what that page may not:
// check whether a file exists and which files are open in tabs.
const MANAGER = 'file:///?canvas-manager';

chrome.action.onClicked.addListener(async () => {
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    return;
  }
  const [open] = (await chrome.tabs.query({ url: 'file:///*' })).filter(t => t.url.startsWith(MANAGER));
  if (open) {
    chrome.tabs.update(open.id, { active: true });
    chrome.windows.update(open.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: MANAGER });
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url?.startsWith(MANAGER)) return;
  chrome.scripting.insertCSS({ target: { tabId }, files: ['manager.css'] });
  chrome.scripting.executeScript({ target: { tabId }, files: ['store.js', 'manager.js'] });
});

const fileUrl = path => 'file://' + path.split('/').map(encodeURIComponent).join('/');

async function exists(path) {
  try {
    await fetch(fileUrl(path));
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'exists') {
    Promise.all(msg.paths.map(exists)).then(reply);
  } else if (msg.type === 'openFiles') {
    chrome.tabs.query({ url: 'file:///*' }).then(tabs => reply(
      tabs.filter(t => !t.url.startsWith(MANAGER))
        .map(t => decodeURIComponent(new URL(t.url).pathname).split('/').pop())));
  } else if (msg.type === 'open') {
    chrome.tabs.create({ url: fileUrl(msg.path) });
  }
  return true;
});
