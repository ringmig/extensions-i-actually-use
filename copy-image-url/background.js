// ─── Context menu ────────────────────────────────────────────────────────────

// Sites that cover their images with a transparent layer never give Chrome an
// "image" context, so the items have to be offered in the contexts an overlay
// does produce. picker.js supplies the URL that Chrome could not see.
const MENU_CONTEXTS = ["image", "link", "page", "video"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "copy-image",
    title: "Copy Image",
    contexts: MENU_CONTEXTS,
  });

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const imageUrl = info.srcUrl || lastRightClickImage;

  if (info.menuItemId === "copy-image") {
    // Fetched here, not in the page: host_permissions lift CORS for the service
    // worker, which is what lets this work on sites whose own "Copy image" fails.
    const png = imageUrl ? await toPngDataUrl(imageUrl) : null;
    inject(tab, (png, url) => {
      if (!png) return showToast(url ? "Could not copy image" : "No image here");
      fetch(png)
        .then((r) => r.blob())
        // The URL rides along as text, so pasting into a text field still works
        .then((blob) => navigator.clipboard.write([new ClipboardItem({
          "image/png": blob,
          "text/plain": new Blob([url], { type: "text/plain" }),
        })]))
        .then(() => showToast("Image copied!"), () => showToast("Failed to copy image"));
    }, [png, imageUrl || null]);
  }

  if (info.menuItemId === "copy-image-url") {
    inject(tab, (url) => {
      if (!url) return showToast("No image here");
      navigator.clipboard.writeText(url).then(
        () => showToast("Image URL copied!"),
        () => showToast("Failed to copy URL")
      );
    }, [imageUrl || null]);
  }

  if (info.menuItemId === "open-image-tab" && imageUrl) {
    chrome.tabs.create({ url: imageUrl });
  }
});

// Runs fn in the tab after defining showToast() there; both calls share the
// extension's isolated world, so the global is visible to fn.
async function inject(tab, fn, args) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      self.showToast = (msg) => {
        const t = document.createElement("div");
        t.textContent = msg;
        t.className = "copy-img-url-toast";
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add("copy-img-url-toast--show"));
        setTimeout(() => {
          t.classList.remove("copy-img-url-toast--show");
          setTimeout(() => t.remove(), 200);
        }, 1500);
      };
    },
  });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args });
}

// The clipboard only takes PNG, so every format is redrawn as one
async function toPngDataUrl(url) {
  try {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await png.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return "data:image/png;base64," + btoa(bin);
  } catch (e) {
    console.warn("[copy-image] could not load", url, e.message);
    return null;
  }
}

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
