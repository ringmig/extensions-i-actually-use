/* ══════════════════════════════════════════════════════════
   Bookmarks Manager — Custom Add/Edit Modal
   Swallows Cmd/Ctrl+D and puts our own dialog in its place.

   Chrome's own bookmark bubble is browser UI and cannot be restyled, but the
   keystroke that opens it is delivered to the page first: preventDefault on the
   keydown stops Chrome from ever showing it. Clicking the star icon is still
   browser chrome and stays Chrome's.

   The dialog lives in a closed shadow root so the host page's stylesheet cannot
   reach it and ours cannot leak out.
   ══════════════════════════════════════════════════════════ */

(() => {
  if (window.__bmModalLoaded) return;
  window.__bmModalLoaded = true;

  let host = null;
  let root = null;
  let folders = [];
  let recent = [];
  let existing = null;
  let selectedId = null;
  let deleteArmed = false;
  let scrollLock = null;

  // Folder picker
  let byId = new Map();
  let kids = new Map(); // parentId (null at the top) → child folders
  let cwd = null;       // the folder whose children are listed
  let query = '';
  let active = 0;
  let rows = [];

  // Values lifted from the manager's :root so both surfaces stay one design.
  // Inter is not loaded here — a webfont in an injected shadow root is subject
  // to the host page's CSP — so the system stack carries the type.
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      overscroll-behavior: contain;
      font: 400 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #F0F0F0;
      animation: fade 0.12s ease;
    }
    @keyframes fade { from { opacity: 0 } }

    .dialog {
      width: min(440px, calc(100vw - 32px));
      background: #111111;
      border: 1px solid #1E1E1E;
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
      padding: 22px;
      display: flex; flex-direction: column; gap: 16px;
      animation: rise 0.16s ease;
    }
    @keyframes rise { from { transform: translateY(-8px); opacity: 0 } }

    @media (prefers-reduced-motion: reduce) {
      .backdrop, .dialog { animation: none; }
    }

    h2 { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }

    label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #8A8A8A; }

    input[type="text"] {
      background: #000000;
      border: 1px solid #1E1E1E;
      border-radius: 8px;
      padding: 10px 12px;
      color: #F0F0F0;
      font: inherit;
      min-height: 44px;
    }
    input[type="text"]:focus { outline: 2px solid #4A9EFF; outline-offset: 1px; }

    /* Folder picker — one level at a time, search across all of them.
       Never a native select. */
    .field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #8A8A8A; }
    .picker { position: relative; font-size: 14px; color: #F0F0F0; }
    .picker-btn {
      width: 100%; min-height: 44px;
      background: #000000; border: 1px solid #1E1E1E; border-radius: 8px;
      padding: 10px 12px; color: #F0F0F0; font: inherit;
      display: flex; align-items: center; gap: 8px;
      cursor: pointer; text-align: left;
    }
    .picker-btn:hover { background: #191919; border-color: #333; }
    .picker-btn:focus-visible { outline: 2px solid #4A9EFF; outline-offset: 1px; }
    .picker-btn .value { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .picker-btn .chev { color: #4A4A4A; flex-shrink: 0; }
    .crumb { color: #8A8A8A; }

    .pop {
      position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 2;
      background: #191919; border: 1px solid #333; border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .pop[hidden] { display: none; }

    input.search {
      background: none; border: none; border-bottom: 1px solid #333; border-radius: 0;
      padding: 11px 12px; min-height: 0;
    }
    input.search:focus { outline: none; border-bottom-color: #4A9EFF; }
    input.search::placeholder { color: #4A4A4A; }

    .trail {
      display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
      padding: 6px 8px; border-bottom: 1px solid #333;
      font-size: 12px; color: #4A4A4A;
    }
    .trail[hidden] { display: none; }
    .trail button {
      background: none; border: none; border-radius: 4px; padding: 2px 6px;
      color: #8A8A8A; font: inherit; cursor: pointer;
    }
    .trail button:hover { background: #222222; color: #F0F0F0; }
    .trail button:last-of-type { color: #F0F0F0; }

    .list {
      max-height: 360px; overflow-y: auto; padding: 4px;
      /* Don't hand the scroll on to the page when the list bottoms out */
      overscroll-behavior: contain;
    }
    .row {
      display: flex; align-items: center; gap: 8px; min-height: 36px;
      padding: 0 10px; border-radius: 6px; cursor: pointer;
    }
    .row.active { background: #222222; }
    .row .icon { color: #4A4A4A; flex-shrink: 0; }
    .row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .name mark {
      background: none; color: inherit; font-weight: 600;
      text-decoration: underline; text-underline-offset: 3px;
    }
    .row[aria-selected="true"] .name, .row[aria-selected="true"] .icon { color: #4A9EFF; }
    .row .path {
      flex: 1; min-width: 0; text-align: right; font-size: 12px; color: #8A8A8A;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      /* rtl clips the far end of the path, so the nearest parent stays readable */
      direction: rtl;
    }
    .row .gap { flex: 1; }
    .row .count { font-size: 12px; color: #4A4A4A; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    /* Going into a folder is half the interaction: a full-height target out
       to the row's edge, not a small icon */
    .row .enter {
      width: 44px; align-self: stretch; margin-right: -10px; flex-shrink: 0;
      display: grid; place-items: center;
      background: rgba(255, 255, 255, 0.06); color: #F0F0F0;
      border: none; border-left: 1px solid #333; border-radius: 0 6px 6px 0;
      cursor: pointer;
    }
    .row .enter:hover { background: rgba(255, 255, 255, 0.14); }
    .empty { padding: 16px 10px; color: #8A8A8A; }
    .hint {
      padding: 7px 12px; border-top: 1px solid #333;
      font-size: 11px; color: #4A4A4A; white-space: pre;
    }

    /* Quick picks: the folders most recently bookmarked into, one click away */
    .recent { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -8px; }
    .chip {
      min-height: 32px; padding: 0 12px;
      background: #000000; border: 1px solid #1E1E1E; border-radius: 16px;
      color: #8A8A8A; font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
      /* Grow to share each wrapped row evenly; min-width lets the ellipsis work */
      flex: 1 1 auto; min-width: 0; max-width: 100%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip:hover { background: #191919; border-color: #333; color: #F0F0F0; }
    .chip:focus-visible { outline: 2px solid #4A9EFF; outline-offset: 1px; }
    .chip[aria-pressed="true"] {
      border-color: #4A9EFF; color: #4A9EFF; background: rgba(74, 158, 255, 0.12);
    }

    .actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .spacer { flex: 1; }

    button.act {
      min-height: 44px; padding: 0 18px;
      border-radius: 8px; border: 1px solid transparent;
      font: 500 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
    }
    button.act:focus-visible { outline: 2px solid #4A9EFF; outline-offset: 1px; }
    .ghost { background: none; border-color: #1E1E1E; color: #8A8A8A; }
    .ghost:hover { background: #191919; color: #F0F0F0; }
    .primary { background: #4A9EFF; color: #000000; font-weight: 600; }
    .primary:hover { filter: brightness(1.1); }
    .danger { background: none; border-color: #1E1E1E; color: #FF4A4A; }
    .danger:hover { background: rgba(255, 74, 74, 0.1); }
    .danger.armed { background: #FF4A4A; color: #000000; border-color: #FF4A4A; }
  `;

  // ── Keystroke ──

  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if ((e.key || '').toLowerCase() !== 'd') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (host) close(); else open();
  }, true);

  // ── Open / close ──

  async function open() {
    let state;
    try {
      state = await chrome.runtime.sendMessage({
        type: 'bm-modal-state',
        url: location.href,
      });
    } catch {
      return; // extension reloaded — let the next press try again
    }
    if (!state) return;

    folders = state.folders || [];
    recent = state.recent || [];
    existing = state.existing || null;
    selectedId = existing ? existing.parentId : (folders[0] && folders[0].id);
    deleteArmed = false;

    byId = new Map(folders.map((f) => [f.id, f]));
    kids = new Map();
    for (const f of folders) {
      if (!kids.has(f.parentId)) kids.set(f.parentId, []);
      kids.get(f.parentId).push(f);
    }

    render(existing ? existing.title : document.title);
  }

  function lockScroll() {
    const html = document.documentElement;
    const body = document.body;
    scrollLock = { html: html.style.overflow, body: body ? body.style.overflow : null };
    html.style.overflow = 'hidden';
    if (body) body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (!scrollLock) return;
    document.documentElement.style.overflow = scrollLock.html;
    if (document.body && scrollLock.body !== null) {
      document.body.style.overflow = scrollLock.body;
    }
    scrollLock = null;
  }

  function close() {
    if (host) host.remove();
    host = null;
    root = null;
    unlockScroll();
  }

  function render(title) {
    host = document.createElement('div');
    host.style.cssText = 'all: initial;';
    root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Bokmärke">
        <h2>${existing ? 'Redigera bokmärke' : 'Nytt bokmärke'}</h2>

        <label>Namn
          <input type="text" id="title" spellcheck="false">
        </label>

        <label>Webbadress
          <input type="text" id="url" spellcheck="false">
        </label>

        <!-- A div, not a label: a label forwards every click inside it to the button -->
        <div class="field">Mapp
          <div class="picker">
            <button type="button" class="picker-btn" id="picker"
                    aria-haspopup="listbox" aria-expanded="false">
              <span class="value" id="picker-label"></span>
              <svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"
                   stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M3 4.5 6 7.5 9 4.5"/>
              </svg>
            </button>
            <div class="pop" id="pop" hidden>
              <input type="text" class="search" id="search" placeholder="Sök mapp"
                     spellcheck="false" autocomplete="off" aria-label="Sök mapp">
              <div class="trail" id="trail" hidden></div>
              <div class="list" id="list" role="listbox"></div>
              <div class="hint" id="hint"></div>
            </div>
          </div>
        </div>

        <div class="recent" id="recent" role="group" aria-label="Senaste mappar"></div>

        <div class="actions">
          ${existing ? '<button type="button" class="act danger" id="remove">Ta bort</button>' : ''}
          <span class="spacer"></span>
          <button type="button" class="act ghost" id="cancel">Avbryt</button>
          <button type="button" class="act primary" id="save">Spara</button>
        </div>
      </div>
    `;

    root.append(style, backdrop);
    (document.body || document.documentElement).appendChild(host);
    lockScroll();

    const $ = (sel) => root.getElementById(sel);
    $('title').value = title || '';
    $('url').value = existing ? existing.url : location.href;
    renderPicker();

    backdrop.addEventListener('mousedown', (e) => {
      // A click outside the open list closes the list, not the whole dialog
      if (!$('pop').hidden) {
        if (!e.target.closest('.picker')) closePicker();
        return;
      }
      if (e.target === backdrop) close();
    });

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') save();
    });

    $('cancel').addEventListener('click', close);
    $('save').addEventListener('click', save);
    if (existing) $('remove').addEventListener('click', remove);
    $('picker').addEventListener('click', togglePicker);
    $('search').addEventListener('input', (e) => {
      query = e.target.value;
      active = 0;
      renderList();
    });
    $('search').addEventListener('keydown', pickerKeys);

    // Sites with a smooth-scroll library (Lenis, Locomotive, Framer) intercept
    // wheel events on window and move the page themselves, so the native scroll
    // our list relies on never happens. Scrolling it by hand cannot be stolen.
    $('list').addEventListener('wheel', (e) => {
      const list = $('list');
      const step = e.deltaMode === 1 ? e.deltaY * 16
                 : e.deltaMode === 2 ? e.deltaY * list.clientHeight
                 : e.deltaY;
      list.scrollTop += step;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    $('title').focus();
    $('title').select();
  }

  // ── Folder picker ──

  const FOLDER_ICON = '<svg class="icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.5 3.5a1 1 0 0 1 1-1h2.6l1.3 1.5h5.1a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/></svg>';
  const ENTER_ICON = '<svg width="14" height="14" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 6.5 5 3.5 8"/></svg>';

  function fullPath(f) {
    return [...f.path, f.label].join(' › ');
  }

  function renderChips() {
    const row = root.getElementById('recent');
    row.innerHTML = '';
    const lines = new Map(); // offsetTop → chips on that line
    for (const r of recent) {
      const f = byId.get(r.id);
      if (!f) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = f.label;
      chip.title = fullPath(f);
      chip.setAttribute('aria-pressed', String(f.id === selectedId));
      // A quick pick is the whole action: choose the folder and it is saved.
      // The dropdown is for when you want to look before committing.
      chip.addEventListener('click', () => {
        selectedId = f.id;
        save();
      });
      row.appendChild(chip);
      // Two rows, never a third: a name too long for what is left of row two
      // is dropped and the next candidate gets its chance.
      const top = chip.offsetTop;
      if (!lines.has(top) && lines.size === 2) { chip.remove(); continue; }
      if (!lines.has(top)) lines.set(top, []);
      lines.get(top).push(chip);
    }
    // A chip alone on its row keeps its own width instead of spanning the dialog
    for (const line of lines.values()) {
      if (line.length === 1) line[0].style.flexGrow = '0';
    }
  }

  function renderPicker() {
    const sel = byId.get(selectedId);
    const label = root.getElementById('picker-label');
    label.textContent = '';
    if (sel && sel.path.length) {
      const crumb = document.createElement('span');
      crumb.className = 'crumb';
      crumb.textContent = sel.path.join(' › ') + ' › ';
      label.append(crumb);
    }
    label.append(sel ? sel.label : 'Bokmärkesfältet');
    renderChips();
  }

  // Typing searches every folder by name and path; an empty field browses
  // the current level, with the level itself first so it can be chosen.
  function buildRows() {
    const q = query.trim().toLowerCase();
    if (q) {
      const terms = q.split(/\s+/);
      const rank = (f) => {
        const name = f.label.toLowerCase();
        return name.startsWith(terms[0]) ? 0 : name.includes(terms[0]) ? 1 : 2;
      };
      return folders
        .filter((f) => {
          const hay = fullPath(f).toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length)
        .map((f) => ({ f, path: true, mark: terms[0] }));
    }
    const out = (kids.get(cwd) || []).map((f) => ({ f, enter: kids.has(f.id) }));
    if (cwd) out.unshift({ f: byId.get(cwd), here: true });
    return out;
  }

  function renderTrail(show) {
    const trail = root.getElementById('trail');
    trail.hidden = !show;
    if (!show) return;
    trail.innerHTML = '';
    const chain = [];
    for (let f = byId.get(cwd); f; f = byId.get(f.parentId)) chain.unshift(f);
    const add = (text, id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.textContent = text;
      b.addEventListener('click', () => {
        cwd = id;
        active = 0;
        renderList();
        root.getElementById('search').focus();
      });
      if (trail.children.length) trail.append('›');
      trail.append(b);
    };
    add('Alla', null);
    for (const f of chain) add(f.label, f.id);
  }

  function renderList() {
    const browsing = !query.trim();
    renderTrail(browsing);
    root.getElementById('hint').textContent = browsing
      ? '↑↓ flytta   → gå in   ← upp   Enter välj'
      : '↑↓ flytta   Enter välj';

    rows = buildRows();
    active = Math.max(0, Math.min(active, rows.length - 1));

    const list = root.getElementById('list');
    list.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = browsing ? 'Inga undermappar här' : `Ingen mapp matchar "${query.trim()}"`;
      list.append(empty);
      return;
    }

    rows.forEach((row, i) => {
      const { f } = row;
      const el = document.createElement('div');
      el.className = 'row' + (i === active ? ' active' : '');
      el.role = 'option';
      el.setAttribute('aria-selected', String(f.id === selectedId));
      el.insertAdjacentHTML('beforeend', FOLDER_ICON);

      const name = document.createElement('span');
      name.className = 'name';
      const text = row.here ? `Spara i ${f.label}` : f.label;
      const at = row.mark ? text.toLowerCase().indexOf(row.mark) : -1;
      if (at < 0) {
        name.textContent = text;
      } else {
        const mark = document.createElement('mark');
        mark.textContent = text.slice(at, at + row.mark.length);
        name.append(text.slice(0, at), mark, text.slice(at + row.mark.length));
      }
      el.append(name);

      if (row.path && f.path.length) {
        const p = document.createElement('span');
        p.className = 'path';
        const bdi = document.createElement('bdi');
        bdi.textContent = f.path.join(' › ');
        p.append(bdi);
        el.append(p);
      } else {
        el.insertAdjacentHTML('beforeend', '<span class="gap"></span>');
      }
      if (f.count) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = f.count;
        el.append(c);
      }
      if (row.enter) {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = 'enter';
        b.title = 'Visa undermappar';
        b.innerHTML = ENTER_ICON;
        b.addEventListener('click', (e) => { e.stopPropagation(); enterFolder(f); });
        el.append(b);
      }

      el.addEventListener('click', () => choose(f));
      el.addEventListener('mousemove', () => {
        if (active === i) return;
        const was = list.querySelector('.row.active');
        if (was) was.classList.remove('active');
        el.classList.add('active');
        active = i;
      });
      list.append(el);
    });
    const current = list.querySelector('.row.active');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  function choose(f) {
    selectedId = f.id;
    closePicker();
    renderPicker();
    root.getElementById('picker').focus();
  }

  function enterFolder(f) {
    cwd = f.id;
    active = 0;
    renderList();
    root.getElementById('search').focus();
  }

  function togglePicker() {
    const pop = root.getElementById('pop');
    if (!pop.hidden) { closePicker(); return; }
    // Open on the level the chosen folder sits in, with it highlighted. A
    // top-level choice opens the bookmarks bar itself: that is where the
    // folders are, the level above it is two rows.
    const sel = byId.get(selectedId);
    cwd = (sel && sel.parentId) || (byId.has('1') ? '1' : null);
    query = '';
    root.getElementById('search').value = '';
    active = Math.max(0, buildRows().findIndex((r) => !r.here && r.f.id === selectedId));
    pop.hidden = false;
    root.getElementById('picker').setAttribute('aria-expanded', 'true');
    renderList();
    root.getElementById('search').focus();
  }

  function closePicker() {
    root.getElementById('pop').hidden = true;
    root.getElementById('picker').setAttribute('aria-expanded', 'false');
  }

  // Handled keys stop here so the dialog's own Enter-saves and Escape-closes
  // do not fire while the list is open.
  function pickerKeys(e) {
    const row = rows[active];
    const browsing = !query.trim();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active += e.key === 'ArrowDown' ? 1 : -1;
      renderList();
    } else if (e.key === 'Enter') {
      if (row) choose(row.f);
    } else if (e.key === 'Escape') {
      closePicker();
      root.getElementById('picker').focus();
    } else if (browsing && e.key === 'ArrowRight') {
      if (row && row.enter) enterFolder(row.f);
    } else if (browsing && e.key === 'ArrowLeft') {
      if (cwd) {
        const from = cwd;
        cwd = byId.get(from).parentId;
        active = Math.max(0, buildRows().findIndex((r) => !r.here && r.f.id === from));
        renderList();
      }
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // ── Save / remove ──

  async function save() {
    const title = root.getElementById('title').value.trim();
    const url = root.getElementById('url').value.trim();
    if (!url) return;

    await chrome.runtime.sendMessage({
      type: 'bm-modal-save',
      id: existing ? existing.id : null,
      parentId: selectedId,
      title,
      url,
    });
    close();
  }

  // Two clicks instead of a confirm dialog: the first arms, the second deletes
  async function remove() {
    const btn = root.getElementById('remove');
    if (!deleteArmed) {
      deleteArmed = true;
      btn.classList.add('armed');
      btn.textContent = 'Säker?';
      setTimeout(() => {
        if (!root) return;
        deleteArmed = false;
        btn.classList.remove('armed');
        btn.textContent = 'Ta bort';
      }, 3000);
      return;
    }
    await chrome.runtime.sendMessage({ type: 'bm-modal-remove', id: existing.id });
    close();
  }
})();
