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

    /* Folder picker — a real listbox, never a native select */
    .picker { position: relative; }
    .picker-btn {
      width: 100%; min-height: 44px;
      background: #000000; border: 1px solid #1E1E1E; border-radius: 8px;
      padding: 10px 12px; color: #F0F0F0; font: inherit;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      cursor: pointer; text-align: left;
    }
    .picker-btn:hover { background: #191919; border-color: #333; }
    .picker-btn:focus-visible { outline: 2px solid #4A9EFF; outline-offset: 1px; }
    .picker-btn .chev { color: #4A4A4A; flex-shrink: 0; }

    .picker-list {
      position: absolute; left: 0; right: 0; top: calc(100% + 4px);
      max-height: 240px; overflow-y: auto;
      /* Don't hand the scroll on to the page when the list bottoms out */
      overscroll-behavior: contain;
      background: #191919; border: 1px solid #333; border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      padding: 4px; z-index: 2;
    }
    .picker-list[hidden] { display: none; }
    .opt {
      display: block; width: 100%; min-height: 36px;
      background-color: transparent; border: none; border-radius: 6px;
      color: #F0F0F0; font: inherit; text-align: left;
      padding: 8px 10px; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      /* One hairline per ancestor level; renderPicker sets how many via background-size */
      background-image: repeating-linear-gradient(90deg, #333 0 1px, transparent 1px 16px);
      background-position: 15px 0;
      background-repeat: no-repeat;
      background-size: 0 100%;
    }
    .opt:hover { background-color: #222222; }
    .opt[aria-selected="true"] { background-color: #2A2A2A; color: #4A9EFF; }
    .opt:focus-visible { outline: 2px solid #4A9EFF; outline-offset: -2px; }

    /* Quick picks: the folders most recently bookmarked into, one click away */
    .recent { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -8px; }
    .chip {
      min-height: 32px; padding: 0 12px;
      background: #000000; border: 1px solid #1E1E1E; border-radius: 16px;
      color: #8A8A8A; font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
      /* Grow to share each wrapped row evenly; min-width lets the ellipsis work */
      flex: 1 1 auto; min-width: 0;
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

        <label>Mapp
          <div class="picker">
            <button type="button" class="picker-btn" id="picker"
                    aria-haspopup="listbox" aria-expanded="false">
              <span id="picker-label"></span>
              <svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"
                   stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M3 4.5 6 7.5 9 4.5"/>
              </svg>
            </button>
            <div class="picker-list" id="list" role="listbox" hidden></div>
          </div>
        </label>

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

  function folderName(id) {
    const f = folders.find((x) => x.id === id);
    return f ? f.label : 'Bokmärkesfältet';
  }

  function renderChips() {
    const row = root.getElementById('recent');
    row.innerHTML = '';
    for (const f of recent) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = f.label;
      chip.setAttribute('aria-pressed', String(f.id === selectedId));
      // A quick pick is the whole action: choose the folder and it is saved.
      // The dropdown is for when you want to look before committing.
      chip.addEventListener('click', () => {
        selectedId = f.id;
        save();
      });
      row.appendChild(chip);
    }
  }

  function renderPicker() {
    root.getElementById('picker-label').textContent = folderName(selectedId);
    renderChips();

    const list = root.getElementById('list');
    list.innerHTML = '';
    for (const f of folders) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'opt';
      opt.role = 'option';
      opt.dataset.id = f.id;
      opt.setAttribute('aria-selected', String(f.id === selectedId));
      opt.textContent = f.label;
      opt.style.paddingLeft = (10 + f.depth * 16) + 'px';
      opt.style.backgroundSize = (f.depth * 16) + 'px 100%';
      opt.addEventListener('click', () => {
        selectedId = f.id;
        closePicker();
        renderPicker();
        root.getElementById('picker').focus();
      });
      list.appendChild(opt);
    }
  }

  function togglePicker() {
    const list = root.getElementById('list');
    if (list.hidden) {
      list.hidden = false;
      root.getElementById('picker').setAttribute('aria-expanded', 'true');
      const current = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
      if (current) { current.focus(); current.scrollIntoView({ block: 'nearest' }); }
      list.addEventListener('keydown', pickerKeys);
    } else {
      closePicker();
    }
  }

  function closePicker() {
    const list = root.getElementById('list');
    list.hidden = true;
    list.removeEventListener('keydown', pickerKeys);
    root.getElementById('picker').setAttribute('aria-expanded', 'false');
  }

  function pickerKeys(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const opts = [...root.getElementById('list').querySelectorAll('.opt')];
    const i = opts.indexOf(root.activeElement);
    const next = opts[e.key === 'ArrowDown' ? Math.min(i + 1, opts.length - 1) : Math.max(i - 1, 0)];
    if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
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
