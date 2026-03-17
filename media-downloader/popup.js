const list = document.getElementById('list');
const clearBtn = document.getElementById('clear');

function render(history) {
  if (!history || history.length === 0) {
    list.innerHTML = '<div class="empty">No downloads yet.<br>Right-click a link or media to start.</div>';
    return;
  }

  list.innerHTML = history.map(item => {
    const label = item.filename || shortUrl(item.url);
    const statusClass = item.status;
    let statusText = '';
    if (item.status === 'processing') statusText = 'Fetching media URL...';
    else if (item.status === 'downloading') statusText = 'Downloading...';
    else if (item.status === 'done') statusText = 'Saved to Downloads';
    else if (item.status === 'error') statusText = item.error || 'Failed';

    return `
      <div class="item">
        <div class="dot ${statusClass}"></div>
        <div class="info">
          <div class="filename" title="${esc(item.url)}">${esc(label)}</div>
          <div class="status-text ${item.status === 'error' ? 'error' : ''}">${esc(statusText)}</div>
        </div>
        <div class="time">${timeAgo(item.timestamp)}</div>
      </div>
    `;
  }).join('');
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname;
    return u.hostname + path;
  } catch {
    return url?.slice(0, 40) || '(unknown)';
  }
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'now';
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// Load history
chrome.runtime.sendMessage({ action: 'getHistory' }, (res) => {
  render(res?.history || []);
});

// Auto-refresh while open
const interval = setInterval(() => {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (res) => {
    if (chrome.runtime.lastError) return;
    render(res?.history || []);
  });
}, 1000);

// Clear
clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
    render([]);
  });
});
