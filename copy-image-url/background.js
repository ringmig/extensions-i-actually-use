// ─── Context menu ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "copy-image-url",
    title: "Copy Image URL",
    contexts: ["image"],
  });

  chrome.contextMenus.create({
    id: "open-image-tab",
    title: "Open Image in New Tab",
    contexts: ["image"],
  });

});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "copy-image-url") {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (url) => {
        navigator.clipboard.writeText(url).then(
          () => showToast("Image URL copied!"),
          () => showToast("Failed to copy URL")
        );

        function showToast(msg) {
          const t = document.createElement("div");
          t.textContent = msg;
          t.className = "copy-img-url-toast";
          document.body.appendChild(t);
          requestAnimationFrame(() => t.classList.add("copy-img-url-toast--show"));
          setTimeout(() => {
            t.classList.remove("copy-img-url-toast--show");
            setTimeout(() => t.remove(), 200);
          }, 1500);
        }
      },
      args: [info.srcUrl],
    });
  }

  if (info.menuItemId === "open-image-tab") {
    chrome.tabs.create({ url: info.srcUrl });
  }
});

// ─── Dynamic content script registration ─────────────────────────────────────

// Hosts that should never be unblocked regardless of user blacklist
const ALWAYS_EXCLUDED = ["*://remotedesktop.google.com/*"];

function buildExcludeMatches(blacklist) {
  const patterns = blacklist.flatMap((host) => [
    `*://${host}/*`,
    `*://*.${host}/*`,
  ]);
  return [...ALWAYS_EXCLUDED, ...patterns];
}

async function syncScripts(blacklist) {
  const excludeMatches = buildExcludeMatches(blacklist);

  const scriptDefs = [
    {
      id: "copy-img-url-css",
      matches: ["<all_urls>"],
      excludeMatches,
      css: ["styles.css"],
      runAt: "document_start",
      allFrames: true,
    },
    {
      id: "copy-img-url-js",
      matches: ["<all_urls>"],
      excludeMatches,
      js: ["unblock.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
    },
  ];

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((s) => s.id));

  const toRegister = scriptDefs.filter((s) => !registeredIds.has(s.id));
  const toUpdate = scriptDefs.filter((s) => registeredIds.has(s.id));

  if (toRegister.length > 0) {
    await chrome.scripting.registerContentScripts(toRegister);
  }
  if (toUpdate.length > 0) {
    await chrome.scripting.updateContentScripts(toUpdate);
  }
}

// ─── Listen for blacklist changes from popup ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "blacklist-updated") {
    syncScripts(msg.blacklist);
  }
});

// Re-sync on service worker startup (covers browser restarts)
chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
  syncScripts(blacklist);
});
