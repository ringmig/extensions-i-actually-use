// ─── Context menu ────────────────────────────────────────────────────────────

// Sites that cover their images with a transparent layer never give Chrome an
// "image" context, so the items have to be offered in the contexts an overlay
// does produce. picker.js supplies the URL that Chrome could not see.
const MENU_CONTEXTS = ["image", "link", "page", "video"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "copy-image-url",
    title: "Copy Image URL",
    contexts: MENU_CONTEXTS,
  });

  chrome.contextMenus.create({
    id: "open-image-tab",
    title: "Open Image in New Tab",
    contexts: MENU_CONTEXTS,
  });

});

// Last image found under the pointer, reported by picker.js on right-click
let lastRightClickImage = null;

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const imageUrl = info.srcUrl || lastRightClickImage;

  if (info.menuItemId === "copy-image-url") {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (url) => {
        if (!url) {
          showToast("No image here");
        } else {
          navigator.clipboard.writeText(url).then(
            () => showToast("Image URL copied!"),
            () => showToast("Failed to copy URL")
          );
        }

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
      args: [imageUrl || null],
    });
  }

  if (info.menuItemId === "open-image-tab" && imageUrl) {
    chrome.tabs.create({ url: imageUrl });
  }
});

// ─── Dynamic content script registration ─────────────────────────────────────

// Hosts that should never be unblocked regardless of user blacklist
const ALWAYS_EXCLUDED = [
  "*://remotedesktop.google.com/*",
  "*://drive.google.com/*",
  // unblock.js stopImmediatePropagation:ar varje contextmenu i capture-fas, vilket
  // (mindmap-canvasen, projekt-sidebaren, dashboardkorten, budgetcellerna).
  // Devservrar: att avblockera högerklick på sin egen maskin fyller ingen funktion,
  // men det bryter varje custom contextmenu man sitter och utvecklar.
  // Match patterns saknar portbegrepp, så detta täcker alla portar.
  "*://localhost/*",
  "*://127.0.0.1/*",
  // Lokala filer är också egna sidor, och har ingen host att lägga i svartlistan.
  "file:///*",
];

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
      css: ["unblock.css"],
      runAt: "document_start",
      allFrames: true,
      // about:blank / blob: / srcdoc frames have no matchable URL of their own
      matchOriginAsFallback: true,
    },
    {
      id: "copy-img-url-js",
      matches: ["<all_urls>"],
      excludeMatches,
      js: ["unblock.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      matchOriginAsFallback: true,
    },
  ];

  // The picker and the toast styles carry no unblocking, so they run everywhere —
  // copying an image URL must work on the sites kept off the blacklist too.
  scriptDefs.push({
    id: "copy-img-url-picker",
    matches: ["<all_urls>"],
    js: ["picker.js"],
    css: ["styles.css"],
    runAt: "document_start",
    allFrames: true,
    matchOriginAsFallback: true,
  });

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
  if (msg.type === "right-click-image") {
    lastRightClickImage = msg.url || null;
  }

  if (msg.type === "blacklist-updated") {
    syncScripts(msg.blacklist);
  }
});

// Re-sync on service worker startup (covers browser restarts)
chrome.storage.sync.get({ blacklist: [] }, ({ blacklist }) => {
  syncScripts(blacklist);
});
