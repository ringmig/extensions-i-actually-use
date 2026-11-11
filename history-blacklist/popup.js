// ============================================================
//  Unhistory - Popup UI
// ============================================================

const ruleType = document.getElementById("ruleType");
const rulePattern = document.getElementById("rulePattern");
const addBtn = document.getElementById("addBtn");
const rulesList = document.getElementById("rulesList");
const countEl = document.getElementById("count");
const enabledToggle = document.getElementById("enabled");
const clearBtn = document.getElementById("clearBtn");
const hint = document.getElementById("hint");

const hints = {
  keyword: "Matches any URL containing this text",
  domain: "Matches exact domain and subdomains (e.g. reddit.com)",
  regex: "JavaScript regex tested against full URL"
};

// ---- Load state ----
async function load() {
  const data = await chrome.storage.sync.get({ rules: [], enabled: true });
  enabledToggle.checked = data.enabled;
  renderRules(data.rules);
}

// ---- Render rules list ----
function renderRules(rules) {
  if (rules.length === 0) {
    rulesList.innerHTML = '<div class="empty">No rules yet. Add keywords or domains to blacklist.</div>';
    countEl.textContent = "0 rules";
    return;
  }

  rulesList.innerHTML = rules.map((rule, i) => `
    <div class="rule-item">
      <span class="rule-type ${rule.type}">${rule.type}</span>
      <span class="rule-pattern" title="${escapeHtml(rule.pattern)}">${escapeHtml(rule.pattern)}</span>
      <button class="delete-btn" data-index="${i}">&times;</button>
    </div>
  `).join("");

  countEl.textContent = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Add rule ----
addBtn.addEventListener("click", async () => {
  const pattern = rulePattern.value.trim();
  if (!pattern) return;

  // Validate regex
  if (ruleType.value === "regex") {
    try { new RegExp(pattern); } catch {
      rulePattern.style.borderColor = "#f44336";
      setTimeout(() => rulePattern.style.borderColor = "", 1500);
      return;
    }
  }

  const data = await chrome.storage.sync.get({ rules: [] });
  const rules = data.rules;

  // Prevent duplicates
  if (rules.some(r => r.type === ruleType.value && r.pattern === pattern)) {
    rulePattern.value = "";
    return;
  }

  rules.push({ type: ruleType.value, pattern });
  await chrome.storage.sync.set({ rules });

  rulePattern.value = "";
  renderRules(rules);
});

// Enter key to add
rulePattern.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});

// ---- Delete rule ----
rulesList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  const index = parseInt(btn.dataset.index);
  const data = await chrome.storage.sync.get({ rules: [] });
  data.rules.splice(index, 1);
  await chrome.storage.sync.set({ rules: data.rules });
  renderRules(data.rules);
});

// ---- Toggle enabled ----
enabledToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

// ---- Update hint text ----
ruleType.addEventListener("change", () => {
  hint.textContent = hints[ruleType.value] || "";
});

// ---- Clear matching history now ----
clearBtn.addEventListener("click", async () => {
  const data = await chrome.storage.sync.get({ rules: [] });
  if (data.rules.length === 0) return;

  clearBtn.textContent = "Clearing...";
  clearBtn.disabled = true;

  // Search and delete for each rule
  const results = await chrome.history.search({ text: "", maxResults: 5000 });
  let deleted = 0;

  for (const item of results) {
    const lower = item.url.toLowerCase();
    for (const rule of data.rules) {
      let match = false;
      const pattern = rule.pattern.toLowerCase();

      if (rule.type === "keyword" && lower.includes(pattern)) match = true;
      else if (rule.type === "domain") {
        try {
          const hostname = new URL(item.url).hostname;
          if (hostname === pattern || hostname.endsWith("." + pattern)) match = true;
        } catch {}
      } else if (rule.type === "regex") {
        try { if (new RegExp(rule.pattern, "i").test(item.url)) match = true; } catch {}
      }

      if (match) {
        await chrome.history.deleteUrl({ url: item.url });
        deleted++;
        break;
      }
    }
  }

  clearBtn.textContent = `Cleared ${deleted} entries`;
  setTimeout(() => {
    clearBtn.textContent = "Clear history now";
    clearBtn.disabled = false;
  }, 2000);
});

// ---- Init ----
load();
