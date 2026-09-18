const current = document.getElementById("current");
const currentHost = document.getElementById("currentHost");
const currentBtn = document.getElementById("currentBtn");
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

// ── Current site ──────────────────────────────────────────────────────────
// The list only ever accepted a hand-typed domain, which is a poor way to say
// "give this site its own menu back" while you are standing on it.

let activeHost = null;

function renderCurrent(blacklist) {
  if (!activeHost) return;
  const off = blacklist.includes(activeHost);
  current.hidden = false;
  currentHost.innerHTML = "";
  currentHost.append(
    document.createTextNode(activeHost),
    Object.assign(document.createElement("span"), {
      textContent: off ? "Right-click left alone here" : "Right-click unblocked here",
    })
  );
  currentBtn.textContent = off ? "Unblock" : "Leave alone";
  currentBtn.setAttribute("aria-pressed", String(off));
}

currentBtn.addEventListener("click", () => {
  if (!activeHost) return;
  chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
    const updated = blacklist.includes(activeHost)
      ? blacklist.filter((h) => h !== activeHost)
      : [...blacklist, activeHost];
    renderList(updated);
    renderCurrent(updated);
    save(updated);
    // A registered content script only changes on the next load, so the site
    // keeps behaving the old way until the tab is reloaded.
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.reload(tab.id);
    });
  });
});

// Init
chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
  renderList(blacklist);
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    try {
      // http/https only — there is nothing to unblock on chrome:// or a file
      const u = new URL(tab?.url || "");
      if (u.protocol === "http:" || u.protocol === "https:") {
        activeHost = normalizeHost(u.hostname);
        renderCurrent(blacklist);
      }
    } catch (_) {}
  });
  input.focus();
});
