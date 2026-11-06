// Draws the manager over the file:/// directory listing. Runs in the
// extension's isolated world, which shares the page's IndexedDB.
(() => {
  const ask = msg => chrome.runtime.sendMessage(msg);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const size = b => b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`;
  const when = t => t
    ? 'Opened ' + new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Last opened not recorded';
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // The viewer's source file in its repo; it is not meant to be used as a canvas
  const MASTER = '/HTML Image Viewer/image-viewer.html';
  // Missing files first: they are what this page is for
  const RANK = { missing: 0, unknown: 1, found: 2 };

  document.head.replaceChildren();
  document.title = 'Canvas Manager';
  document.documentElement.lang = 'en';
  document.body.className = 'cm';
  document.body.innerHTML = `
    <header>
      <div>
        <h1>Canvases</h1>
        <p class="summary" aria-live="polite"></p>
      </div>
      <div class="head-actions">
        <button class="btn" data-act="copy-storage" title="Paste it in Finder with Cmd+Shift+G. Look, but do not delete files there: the canvases would break.">Copy storage path</button>
        <button class="btn" data-act="refresh">Refresh</button>
      </div>
    </header>
    <main></main>`;
  const main = document.querySelector('main');
  const summary = document.querySelector('.summary');
  let rows = [];

  async function load() {
    summary.textContent = 'Reading the canvases saved in Chrome';
    // Shown again if it ever holds images, so nothing sits hidden in storage
    rows = (await store.list()).filter(r => !(r.path?.endsWith(MASTER) && r.images + r.videos === 0));
    const known = rows.filter(r => r.path);
    const found = await ask({ type: 'exists', paths: known.map(r => r.path) });
    known.forEach((r, i) => r.status = found[i] ? 'found' : 'missing');
    rows.forEach(r => r.status ??= 'unknown');
    rows.sort((a, b) => RANK[a.status] - RANK[b.status] || (b.opened || 0) - (a.opened || 0));
    render();
  }

  function render() {
    const total = rows.reduce((n, r) => n + r.bytes, 0);
    const missing = rows.filter(r => r.status === 'missing').length;
    summary.textContent = rows.length
      ? `${rows.length} ${rows.length === 1 ? 'canvas' : 'canvases'}, ${size(total)} in Chrome${missing ? `, ${missing} with the file missing` : ''}`
      : '';
    if (!rows.length) {
      main.innerHTML = `
        <div class="empty">
          <div class="disc" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg></div>
          <h2>No saved canvases</h2>
          <p>A canvas appears here once an HTML Image Viewer file has been opened in Chrome.</p>
        </div>`;
      return;
    }
    main.innerHTML = `<ul class="list">${rows.map(row).join('')}</ul>`;
  }

  function row(r, i) {
    const status = {
      found: '<span class="chip">File found</span>',
      missing: '<span class="chip bad">File missing</span>',
      unknown: '<span class="chip warn" title="Opened before the viewer started recording where it lives. Open the file once and it shows here.">Location unknown</span>',
    }[r.status];
    const path = r.path
      ? `<span class="path" title="${esc(r.path)}">${esc(r.path.replace(/^\/Users\/[^/]+/, '~'))}</span>`
      : '<span class="path none">Open the file once to record where it lives</span>';
    const contents = [count(r.images, 'image'), r.videos && count(r.videos, 'video'), size(r.bytes)].filter(Boolean).join(', ');
    return `
      <li class="row ${r.status}" data-i="${i}">
        <div class="lead">${r.status === 'found' ? `<button class="btn primary" data-act="open" data-i="${i}">Open</button>` : ''}</div>
        <div class="name">
          <div class="title"><strong>${esc(r.file)}</strong>${r.legacy ? '<span class="tag">Old format</span>' : ''}</div>
          ${path}
        </div>
        <div class="meta">${contents}<span class="dim">${esc(when(r.opened))}</span></div>
        <div class="status">${status}</div>
        <div class="actions">
          <button class="btn" data-act="rename" data-i="${i}">Rename</button>
          <button class="btn danger" data-act="delete" data-i="${i}">Delete</button>
        </div>
        <p class="note" role="status"></p>
      </li>`;
  }

  const noteFor = i => main.querySelector(`.row[data-i="${i}"] .note`);

  // A tab with the canvas open would write its old copy back over the change
  async function blockedBy(...files) {
    const open = await ask({ type: 'openFiles' });
    return files.find(f => open.includes(f));
  }

  async function remove(btn, i) {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Click again to delete';
      setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete'; }, 3000);
      return;
    }
    const r = rows[i];
    const tab = await blockedBy(r.file);
    if (tab) return noteFor(i).textContent = `Close the tab with ${tab} first.`;
    await store.remove(r.db);
    load();
  }

  function startRename(i) {
    const actions = main.querySelector(`.row[data-i="${i}"] .actions`);
    actions.innerHTML = `
      <input class="field" value="${esc(rows[i].file)}" aria-label="New file name" spellcheck="false">
      <button class="btn" data-act="save" data-i="${i}">Save</button>
      <button class="btn" data-act="cancel">Cancel</button>`;
    const field = actions.querySelector('input');
    field.focus();
    field.setSelectionRange(0, field.value.replace(/\.html?$/i, '').length);
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') save(i, field.value);
      if (e.key === 'Escape') render();
    });
  }

  async function save(i, value) {
    const r = rows[i];
    const note = noteFor(i);
    let file = value.trim();
    if (!file || file.includes('/')) return note.textContent = 'Type a file name, without a folder.';
    if (!/\.html?$/i.test(file)) file += '.html';
    if (file === r.file && !r.legacy) return render();
    const taken = rows.find(o => o.db === store.nameFor(file));
    if (taken && taken.images + taken.videos > 0) {
      return note.textContent = `${file} already has ${count(taken.images + taken.videos, 'item')}. Delete that canvas first.`;
    }
    const tab = await blockedBy(r.file, file);
    if (tab) return note.textContent = `Close the tab with ${tab} first.`;
    await store.rename(r.db, file, r.path, r.opened);
    load();
  }

  // Chrome does not tell an extension its profile folder; 'Default' is the
  // first profile, others show theirs under Profile Path in chrome://version.
  const STORAGE = '~/Library/Application Support/Google/Chrome/Default/IndexedDB/file__0.indexeddb.blob';
  async function copyStorage(btn) {
    await navigator.clipboard.writeText(STORAGE);
    btn.textContent = 'Copied';
    setTimeout(() => btn.textContent = 'Copy storage path', 2000);
  }

  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    ({
      refresh: load,
      'copy-storage': () => copyStorage(btn),
      open: () => ask({ type: 'open', path: rows[i].path }),
      delete: () => remove(btn, i),
      rename: () => startRename(i),
      save: () => save(i, btn.parentElement.querySelector('input').value),
      cancel: render,
    })[btn.dataset.act]();
  });

  load().catch(err => summary.textContent = `Could not read the canvases: ${err.message}`);
})();
