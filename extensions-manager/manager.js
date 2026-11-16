import { capture, matches, changes, loadProfiles, saveProfiles } from './profiles.js';

const $ = (s) => document.querySelector(s);
const content = $('#content');
const menu = $('#context-menu');
const nameDialog = $('#name-dialog');

const SELF = chrome.runtime.id;
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let exts = [];
let profiles = [];
let view = store.get('em-view', 'grid');
let filter = store.get('em-filter', 'all');
let query = '';
let firstRender = true;

const toggleable = () => exts.filter((e) => e.mayDisable);

async function load() {
  const all = await chrome.management.getAll();
  exts = all
    .filter((e) => e.type === 'extension' && e.id !== SELF)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  render();
}

// ── Rendering ───────────────────────────────

function iconUrl(e) {
  const icons = [...(e.icons || [])].sort((a, b) => a.size - b.size);
  return (icons.find((i) => i.size >= 48) || icons.at(-1))?.url;
}

function iconEl(e) {
  const url = iconUrl(e);
  const fallback = () => {
    const d = document.createElement('div');
    d.className = 'icon icon-fallback';
    d.textContent = (e.name.trim()[0] || '?').toUpperCase();
    return d;
  };
  if (!url) return fallback();
  const img = document.createElement('img');
  img.className = 'icon';
  img.alt = '';
  img.src = url;
  img.onerror = () => img.replaceWith(fallback());
  return img;
}

function text(cls, value) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = value;
  return el;
}

function item(e) {
  const el = document.createElement('button');
  el.className = `${view === 'grid' ? 'card' : 'list-item'} ${e.enabled ? 'on' : 'off'}`;
  el.dataset.id = e.id;
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-checked', e.enabled);
  if (!e.mayDisable) {
    el.classList.add('locked');
    el.setAttribute('aria-disabled', 'true');
    el.title = 'Installed by policy, cannot be turned off';
  } else {
    el.title = e.description || e.name;
  }
  const sw = document.createElement('span');
  sw.className = 'switch';
  sw.setAttribute('aria-hidden', 'true');

  el.append(iconEl(e), text('name', e.name));
  if (view === 'list') el.append(text('desc', e.description || ''));
  el.append(text('meta', `v${e.version}`), sw);
  return el;
}

function emptyState(title, line) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `<div class="empty-disc"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg></div>`;
  wrap.append(Object.assign(document.createElement('h2'), { textContent: title }));
  if (line) wrap.append(Object.assign(document.createElement('p'), { textContent: line }));
  return wrap;
}

function render() {
  const q = query.trim().toLowerCase();
  const shown = exts.filter((e) =>
    (filter === 'all' || (filter === 'on') === e.enabled) &&
    (!q || `${e.name} ${e.description} ${e.id}`.toLowerCase().includes(q)));

  // Re-rendering after a toggle must not steal keyboard focus or replay the fade
  const focusedId = document.activeElement?.dataset?.id;

  const box = document.createElement('div');
  box.className = view === 'grid' ? 'grid' : 'list';
  if (!firstRender) box.classList.add('no-anim');
  firstRender = false;
  box.append(...shown.map(item));

  content.replaceChildren(shown.length ? box : emptyState(
    exts.length === 0 ? 'No other extensions installed' :
      q ? `Nothing matches "${query.trim()}"` :
        filter === 'on' ? 'Every extension is off' : 'Every extension is on',
    q ? 'Search looks in names and descriptions.' : ''));

  if (focusedId) content.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();

  for (const b of document.querySelectorAll('#filter button')) {
    const f = b.dataset.filter;
    b.classList.toggle('active', f === filter);
    b.querySelector('.n').textContent =
      f === 'all' ? exts.length : exts.filter((e) => e.enabled === (f === 'on')).length;
  }
  $('#grid-view').classList.toggle('active', view === 'grid');
  $('#list-view').classList.toggle('active', view === 'list');

  renderProfiles();
}

function renderProfiles() {
  const nav = $('#profiles');
  const chips = profiles.map((p) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.profile = p.id;
    b.textContent = p.name;
    const active = matches(p, exts);
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
    b.title = active ? 'Active' : 'Apply this profile';
    return b;
  });
  const add = document.createElement('button');
  add.className = 'chip add';
  add.id = 'add-profile';
  add.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></svg>`;
  add.append(profiles.length ? 'Save current' : 'Save current as profile');
  nav.replaceChildren(...chips, add);
}

// ── Actions ─────────────────────────────────

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

async function toggle(id) {
  const e = exts.find((x) => x.id === id);
  if (!e?.mayDisable) return;
  try {
    await chrome.management.setEnabled(id, !e.enabled);
    toast(`${e.name} ${e.enabled ? 'off' : 'on'}`);
  } catch (err) {
    toast(`Could not change ${e.name}: ${err.message}`);
  }
  // The onEnabled/onDisabled listeners reload the list
}

async function applyProfile(p) {
  const todo = changes(p, toggleable());
  if (!todo.length) return toast(`${p.name} is already active`);
  const results = await Promise.allSettled(todo.map(([id, on]) => chrome.management.setEnabled(id, on)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  toast(failed ? `${p.name}: ${failed} of ${todo.length} could not change` :
    `${p.name}: ${todo.length} changed`);
}

// ── Context menu ────────────────────────────

function openMenu(x, y, entries) {
  menu.replaceChildren(...entries.map((en) => {
    if (en === '-') return Object.assign(document.createElement('div'), { className: 'ctx-separator' });
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.textContent = en.label;
    if (en.danger) b.className = 'danger';
    b.onclick = () => {
      // Destructive entries take two clicks instead of a confirm dialog
      if (en.confirm && !b.classList.contains('armed')) {
        b.classList.add('armed');
        b.textContent = en.confirm;
        return;
      }
      menu.hidePopover();
      en.run();
    };
    return b;
  }));
  menu.showPopover();
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.querySelector('button')?.focus();
}

function extensionMenu(e) {
  const entries = [];
  if (e.mayDisable) entries.push({ label: e.enabled ? 'Turn off' : 'Turn on', run: () => toggle(e.id) });
  entries.push({ label: 'Turn off all others', run: () => soloExtension(e) });
  if (e.optionsUrl) entries.push({ label: 'Options', run: () => chrome.tabs.create({ url: e.optionsUrl }) });
  entries.push({ label: 'Details', run: () => chrome.tabs.create({ url: `chrome://extensions/?id=${e.id}` }) });
  if (e.homepageUrl) entries.push({ label: 'Homepage', run: () => chrome.tabs.create({ url: e.homepageUrl }) });
  if (e.mayDisable) {
    entries.push('-', {
      label: 'Uninstall', danger: true,
      // Chrome shows its own confirmation and cannot be told not to
      run: () => chrome.management.uninstall(e.id, { showConfirmDialog: true }).catch(() => {}),
    });
  }
  return entries;
}

// For bisecting which extension breaks a page: this one on, the rest off.
function soloExtension(e) {
  applyProfile({
    name: `Only ${e.name}`,
    on: [e.id],
    off: toggleable().filter((x) => x.id !== e.id).map((x) => x.id),
  });
}

function profileMenu(p) {
  return [
    { label: 'Apply', run: () => applyProfile(p) },
    {
      label: 'Update to current', run: async () => {
        Object.assign(p, capture(toggleable()));
        await saveProfiles(profiles);
        renderProfiles();
        toast(`${p.name} updated`);
      },
    },
    '-',
    {
      label: 'Delete profile', danger: true, confirm: 'Click again to delete',
      run: async () => {
        profiles = profiles.filter((x) => x !== p);
        await saveProfiles(profiles);
        renderProfiles();
        toast(`${p.name} deleted`);
      },
    },
  ];
}

// ── Events ──────────────────────────────────

content.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-id]');
  if (el) toggle(el.dataset.id);
});

content.addEventListener('contextmenu', (ev) => {
  const el = ev.target.closest('[data-id]');
  if (!el) return;
  ev.preventDefault();
  const e = exts.find((x) => x.id === el.dataset.id);
  const r = el.getBoundingClientRect();
  // A keyboard-opened menu reports 0,0: anchor it to the item instead
  openMenu(ev.clientX || r.left + 12, ev.clientY || r.top + 12, extensionMenu(e));
});

$('#profiles').addEventListener('click', (ev) => {
  if (ev.target.closest('#add-profile')) {
    $('#profile-name').value = '';
    nameDialog.showModal();
    return;
  }
  const chip = ev.target.closest('[data-profile]');
  if (chip) applyProfile(profiles.find((p) => p.id === chip.dataset.profile));
});

$('#profiles').addEventListener('contextmenu', (ev) => {
  const chip = ev.target.closest('[data-profile]');
  if (!chip) return;
  ev.preventDefault();
  const r = chip.getBoundingClientRect();
  openMenu(ev.clientX || r.left, ev.clientY || r.bottom + 4,
    profileMenu(profiles.find((p) => p.id === chip.dataset.profile)));
});

$('#name-cancel').onclick = () => nameDialog.close();
nameDialog.addEventListener('close', async () => {
  if (nameDialog.returnValue !== 'save') return;
  nameDialog.returnValue = '';
  const name = $('#profile-name').value.trim();
  if (!name) return;
  profiles.push({ id: crypto.randomUUID(), name, ...capture(toggleable()) });
  await saveProfiles(profiles);
  renderProfiles();
  toast(`Saved ${name}`);
});

$('#search').addEventListener('input', (ev) => { query = ev.target.value; render(); });

$('#filter').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  store.set('em-filter', filter);
  render();
});

for (const [id, v] of [['#grid-view', 'grid'], ['#list-view', 'list']]) {
  $(id).onclick = () => { view = v; store.set('em-view', v); render(); };
}

document.addEventListener('keydown', (ev) => {
  const typing = ev.target.matches('input');
  if (ev.key === '/' && !typing) { ev.preventDefault(); $('#search').focus(); }
  if (ev.key === 'Escape' && typing && query) { ev.target.value = query = ''; render(); }
});

for (const evt of ['onEnabled', 'onDisabled', 'onInstalled', 'onUninstalled']) {
  chrome.management[evt].addListener(load);
}

profiles = await loadProfiles();
await load();
$('#search').focus();
