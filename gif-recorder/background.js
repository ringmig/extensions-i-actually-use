/**
 * GIF Recorder - Background Service Worker
 * Uses tabCapture for continuous stream (no rate limit).
 */

let activeTabId = null;
let isRecording = false;

// ── Context Menu ──

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gif-recorder',
    title: 'Record Area as GIF',
    contexts: ['all'] // fullscreen targets are usually video/canvas/image, not 'page'
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'gif-recorder') return;

  if (isRecording) {
    stopRecording(tab.id);
    return;
  }

  if (activeTabId) return;
  activeTabId = tab.id;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/gifenc.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (err) {
    console.error('Inject failed:', err);
    activeTabId = null;
  }
});

// ── Extension icon click = stop ──

chrome.action.onClicked.addListener((tab) => {
  if (isRecording) stopRecording(tab.id);
});

// ── Messages ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === 'request-stream') {
    isRecording = true;
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
    chrome.contextMenus.update('gif-recorder', { title: 'Stop GIF Recording' });

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        console.error('tabCapture error:', chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ streamId });
      }
    });
    return true; // async response
  }

  if (msg.type === 'stop-recording') {
    stopRecording(tabId);
  }

  if (msg.type === 'download-gif') {
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename || 'recording.gif',
      saveAs: false
    });
  }

  if (msg.type === 'capture-cancelled' || msg.type === 'encoding-done') {
    activeTabId = null;
  }
});

function stopRecording(tabId) {
  if (!isRecording) return;
  isRecording = false;
  chrome.action.setBadgeText({ text: '' });
  chrome.contextMenus.update('gif-recorder', { title: 'Record Area as GIF' });
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'stop-recording' });
}
