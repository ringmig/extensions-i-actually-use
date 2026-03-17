const list = document.getElementById("list");
const input = document.getElementById("input");
const addBtn = document.getElementById("addBtn");
const status = document.getElementById("status");

let saveTimer = null;

function showSaved() {
  status.classList.add("visible");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => status.classList.remove("visible"), 1500);
}

function normalizeHost(raw) {
  raw = raw.trim().toLowerCase();
  // Strip protocol and path — keep just the host
  try { raw = new URL(raw.includes("://") ? raw : "https://" + raw).hostname; } catch (_) {}
  return raw.replace(/^www\./, "");
}

function renderList(blacklist) {
  if (blacklist.length === 0) {
    list.innerHTML = '<div class="empty">No sites blocked</div>';
    return;
  }

  list.innerHTML = blacklist.map((host, i) => `
    <div class="item">
      <span class="item-host" title="${host}">${host}</span>
      <button class="item-remove" data-index="${i}" title="Remove">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join("");
}

function save(blacklist) {
  chrome.storage.sync.set({ blacklist }, () => {
    showSaved();
    // Notify background to re-sync content scripts
    chrome.runtime.sendMessage({ type: "blacklist-updated", blacklist });
  });
}

function addEntry() {
  const host = normalizeHost(input.value);
  if (!host) return;

  chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
    if (blacklist.includes(host)) {
      input.value = "";
      return;
    }
    const updated = [...blacklist, host];
    renderList(updated);
    save(updated);
    input.value = "";
  });
}

list.addEventListener("click", (e) => {
  const btn = e.target.closest(".item-remove");
  if (!btn) return;
  const idx = parseInt(btn.dataset.index, 10);

  chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
    const updated = blacklist.filter((_, i) => i !== idx);
    renderList(updated);
    save(updated);
  });
});

addBtn.addEventListener("click", addEntry);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addEntry();
});

// Init
chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
  renderList(blacklist);
  input.focus();
});
