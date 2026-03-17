// ============================================================
//  History Blacklist - Background Service Worker
//  Monitors navigation and removes matching URLs from history
// ============================================================

/** Check if a URL matches any blacklist rule */
function urlMatchesBlacklist(url, rules) {
  const lower = url.toLowerCase();
  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase();
    if (rule.type === "keyword") {
      if (lower.includes(pattern)) return true;
    } else if (rule.type === "domain") {
      try {
        const hostname = new URL(url).hostname;
        if (hostname === pattern || hostname.endsWith("." + pattern)) return true;
      } catch { /* invalid URL, skip */ }
    } else if (rule.type === "regex") {
      try {
        if (new RegExp(rule.pattern, "i").test(url)) return true;
      } catch { /* invalid regex, skip */ }
    }
  }
  return false;
}

/** Delete a URL from history */
async function scrubUrl(url) {
  try {
    await chrome.history.deleteUrl({ url });
  } catch { /* URL may already be gone */ }
}

/** Get blacklist rules from storage */
async function getRules() {
  const data = await chrome.storage.sync.get({ rules: [], enabled: true });
  return data;
}

// ----- Listen for page visits via history API -----
chrome.history.onVisited.addListener(async (result) => {
  const { rules, enabled } = await getRules();
  if (!enabled || rules.length === 0) return;

  if (urlMatchesBlacklist(result.url, rules)) {
    await scrubUrl(result.url);
  }
});

// ----- Also catch via webNavigation for faster response -----
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only

  const { rules, enabled } = await getRules();
  if (!enabled || rules.length === 0) return;

  if (urlMatchesBlacklist(details.url, rules)) {
    await scrubUrl(details.url);
  }
});

// ----- Catch URL bar typing via onBeforeNavigate (earliest hook) -----
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const { rules, enabled } = await getRules();
  if (!enabled || rules.length === 0) return;

  if (urlMatchesBlacklist(details.url, rules)) {
    // Small delay then delete - catches the history entry as it's created
    setTimeout(() => scrubUrl(details.url), 100);
    setTimeout(() => scrubUrl(details.url), 500);
    setTimeout(() => scrubUrl(details.url), 1500);
  }
});

// ----- Tab URL change listener (catches SPA navigations) -----
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const { rules, enabled } = await getRules();
  if (!enabled || rules.length === 0) return;

  if (urlMatchesBlacklist(changeInfo.url, rules)) {
    await scrubUrl(changeInfo.url);
    setTimeout(() => scrubUrl(changeInfo.url), 300);
  }
});

// ----- Periodic cleanup sweep (catches anything that slipped through) -----
chrome.alarms.create("history-sweep", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "history-sweep") return;

  const { rules, enabled } = await getRules();
  if (!enabled || rules.length === 0) return;

  // Search history for each keyword/domain rule
  for (const rule of rules) {
    if (rule.type === "keyword" || rule.type === "domain") {
      const results = await chrome.history.search({
        text: rule.pattern,
        maxResults: 100
      });
      for (const item of results) {
        if (urlMatchesBlacklist(item.url, rules)) {
          await scrubUrl(item.url);
        }
      }
    } else if (rule.type === "regex") {
      // For regex, do a broad search and filter
      const results = await chrome.history.search({
        text: "",
        maxResults: 500
      });
      for (const item of results) {
        if (urlMatchesBlacklist(item.url, rules)) {
          await scrubUrl(item.url);
        }
      }
    }
  }
});

// ----- Clean existing history on rule changes -----
chrome.storage.onChanged.addListener(async (changes) => {
  if (!changes.rules) return;

  const newRules = changes.rules.newValue || [];
  if (newRules.length === 0) return;

  // Sweep existing history against new rules
  const results = await chrome.history.search({ text: "", maxResults: 1000 });
  for (const item of results) {
    if (urlMatchesBlacklist(item.url, newRules)) {
      await scrubUrl(item.url);
    }
  }
});
