/* ══════════════════════════════════════════════════════════
   Bookmarks Manager — App Logic + Thumbnail Support
   ══════════════════════════════════════════════════════════ */

(() => {
  // ═══════════════════════════════════
  // Remove Chrome's injected new-tab UI
  // ═══════════════════════════════════

  function removeChromeBanner() {
    for (const el of document.body.children) {
      if (el.id !== 'app' && el.id !== 'context-menu' && el.id !== 'edit-dialog' && !el.matches('script, link')) {
        el.remove();
      }
    }
  }
  removeChromeBanner();
  new MutationObserver(removeChromeBanner).observe(document.body, { childList: true });

  // ═══════════════════════════════════
  // State
  // ═══════════════════════════════════

  let currentFolderId = '1'; // Bookmarks Bar
  let viewMode = localStorage.getItem('bm-view') || 'grid';
  let contextTarget = null;
  let editingNode = null;
  let dragTarget = null;
  let isCreatingFolder = false;
  let thumbnailCache = {}; // url -> dataUrl (in-memory for current render)

  // ═══════════════════════════════════
  // DOM References
  // ═══════════════════════════════════

  const $ = (sel) => document.querySelector(sel);
  const content = $('#content');
  const breadcrumbs = $('#breadcrumbs');
  const searchInput = $('#search');
  const gridBtn = $('#grid-view');
  const compactBtn = $('#compact-view');
  const listBtn = $('#list-view');
  const contextMenu = $('#context-menu');
  const editDialog = $('#edit-dialog');
  const editHeading = $('#edit-heading');
  const editTitle = $('#edit-title');
  const editUrl = $('#edit-url');
  const editUrlLabel = $('#edit-url-label');
  const addFolderBtn = $('#add-folder-btn');
  const captureStatus = $('#capture-status');
  const captureFill = $('#capture-fill');
  const captureText = $('#capture-text');

  // ═══════════════════════════════════
  // Utilities
  // ═══════════════════════════════════

  function getFaviconUrl(pageUrl) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '64');
    return url.toString();
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function getShortDomain(url) {
    const domain = getDomain(url);
    // Strip common TLDs for clean display
    return domain.replace(/\.(com|org|net|io|dev|co|se|app|me|tv|live|ai|gg|xyz|info|site)$/, '');
  }

  function stringToHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // SVG icons (Lucide-style)
  const FOLDER_ICON_LG = `<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>
  </svg>`;

  const FOLDER_ICON_SM = `<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>
  </svg>`;

  const GLOBE_ICON_LG = `<svg class="favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
    <path d="M2 12h20"/>
  </svg>`;

  const GLOBE_ICON_SM = `<svg class="favicon-svg-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
    <path d="M2 12h20"/>
  </svg>`;

  // ═══════════════════════════════════
  // Chrome Bookmarks API Wrappers
  // ═══════════════════════════════════

  function getChildren(folderId) {
    return chrome.bookmarks.getChildren(folderId);
  }

  function getNode(id) {
    return chrome.bookmarks.get(id).then((r) => r[0]);
  }

  function searchBookmarks(query) {
    return chrome.bookmarks.search(query);
  }

  async function getBreadcrumbPath(folderId) {
    const path = [];
    let id = folderId;
    while (id && id !== '0') {
      const node = await getNode(id);
      path.unshift({ id: node.id, title: node.title || 'Root' });
      id = node.parentId;
    }
    return path;
  }

  // ═══════════════════════════════════
  // Thumbnails — Fetch & Request
  // ═══════════════════════════════════

  async function loadThumbnails(urls) {
    if (urls.length === 0) return;
    try {
      const cached = await chrome.runtime.sendMessage({
        type: 'get-thumbnails-batch',
        urls,
      });
      if (cached) {
        Object.assign(thumbnailCache, cached);
      }
    } catch {}
  }

  function requestCaptures(bookmarks) {
    const items = bookmarks
      .filter((b) => b.url && !thumbnailCache[b.url])
      .map((b) => ({ url: b.url, bookmarkId: b.id }));

    if (items.length === 0) return;

    chrome.runtime.sendMessage({
      type: 'capture-request',
      bookmarks: items,
    }).catch(() => {});
  }

  // ═══════════════════════════════════
  // Rendering — Breadcrumbs
  // ═══════════════════════════════════

  function renderBreadcrumbs(path) {
    breadcrumbs.innerHTML = '';

    const home = document.createElement('a');
    home.textContent = 'Bookmarks';
    home.href = '#';
    home.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('0');
    });
    breadcrumbs.appendChild(home);

    for (const item of path) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      breadcrumbs.appendChild(sep);

      if (item.id === currentFolderId) {
        const span = document.createElement('span');
        span.className = 'current';
        span.textContent = item.title;
        breadcrumbs.appendChild(span);
      } else {
        const link = document.createElement('a');
        link.textContent = item.title;
        link.href = '#';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigateTo(item.id);
        });
        breadcrumbs.appendChild(link);
      }
    }
  }

  // ═══════════════════════════════════
  // Rendering — Favicon Helper
  // ═══════════════════════════════════

  function addFavicon(container, url, size) {
    const isLarge = size === 'lg';
    const img = document.createElement('img');
    img.className = 'favicon';
    img.src = getFaviconUrl(url);
    img.alt = '';
    img.addEventListener('error', () => {
      img.outerHTML = isLarge ? GLOBE_ICON_LG : GLOBE_ICON_SM;
    });
    img.addEventListener('load', () => {
      if (img.naturalWidth <= 32) {
        img.outerHTML = isLarge ? GLOBE_ICON_LG : GLOBE_ICON_SM;
      }
    });
    container.appendChild(img);
  }

  // ═══════════════════════════════════
  // Rendering — Grid Cards
  // ═══════════════════════════════════

  function createCard(node) {
    const isFolder = !node.url;
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = node.id;
    el.draggable = true;

    if (isFolder) {
      el.innerHTML = `
        ${FOLDER_ICON_LG}
        <div class="title">${escapeHtml(node.title || 'Untitled')}</div>
        <div class="item-count">${node._childCount ?? ''} items</div>
      `;
      el.addEventListener('click', () => navigateTo(node.id));
    } else {
      const domain = getDomain(node.url);
      const thumb = thumbnailCache[node.url];

      if (thumb) {
        // Thumbnail card
        el.classList.add('has-thumb');
        el.style.backgroundImage = `url(${thumb})`;

        const thumbName = node.title || getShortDomain(node.url);
        el.innerHTML = `
          <div class="thumb-info">
            <img class="thumb-favicon" src="${getFaviconUrl(node.url)}" alt=""
                 onerror="this.style.display='none'">
            <div class="title">${escapeHtml(thumbName)}</div>
          </div>
        `;
      } else {
        // Fallback: favicon + color tint
        const hue = stringToHue(domain);
        el.style.background = `linear-gradient(145deg, hsl(${hue}, 20%, 13%), hsl(${hue}, 12%, 9%))`;

        const displayName = node.title || getShortDomain(node.url);
        addFavicon(el, node.url, 'lg');
        el.insertAdjacentHTML('beforeend', `
          <div class="title">${escapeHtml(displayName)}</div>
          <div class="domain">${escapeHtml(getShortDomain(node.url))}</div>
        `);
      }

      if (node.url) {
        el.dataset.url = node.url;
      }

      el.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          chrome.tabs.create({ url: node.url, active: false });
        } else {
          window.location.href = node.url;
        }
      });

      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          chrome.tabs.create({ url: node.url, active: false });
        }
      });
    }

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, node);
    });

    setupDrag(el, node);
    return el;
  }

  // ═══════════════════════════════════
  // Rendering — List Items
  // ═══════════════════════════════════

  function createListItem(node) {
    const isFolder = !node.url;
    const el = document.createElement('div');
    el.className = 'list-item';
    el.dataset.id = node.id;
    el.draggable = true;

    if (isFolder) {
      el.innerHTML = `
        ${FOLDER_ICON_SM}
        <div class="title">${escapeHtml(node.title || 'Untitled')}</div>
        <div class="domain">${node._childCount ?? ''} items</div>
      `;
      el.addEventListener('click', () => navigateTo(node.id));
    } else {
      const domain = getDomain(node.url);

      addFavicon(el, node.url, 'sm');
      const displayName = node.title || getShortDomain(node.url);
      el.insertAdjacentHTML('beforeend', `
        <div class="title">${escapeHtml(displayName)}</div>
        <div class="domain">${escapeHtml(getShortDomain(node.url))}</div>
      `);

      if (node.url) {
        el.dataset.url = node.url;
      }

      el.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          chrome.tabs.create({ url: node.url, active: false });
        } else {
          window.location.href = node.url;
        }
      });

      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          chrome.tabs.create({ url: node.url, active: false });
        }
      });
    }

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, node);
    });

    setupDrag(el, node);
    return el;
  }

  // ═══════════════════════════════════
  // Rendering — Main
  // ═══════════════════════════════════

  function render(items) {
    content.innerHTML = '';

    const folders = items.filter((n) => !n.url).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const bookmarks = items.filter((n) => n.url).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const sorted = [...folders, ...bookmarks];

    if (sorted.length === 0) {
      content.className = '';
      content.innerHTML = '<div class="empty">No bookmarks here</div>';
      return;
    }

    if (viewMode === 'grid' || viewMode === 'compact') {
      content.className = viewMode === 'compact' ? 'grid compact' : 'grid';
      for (const node of sorted) {
        content.appendChild(createCard(node));
      }
    } else {
      content.className = 'list';
      for (const node of sorted) {
        content.appendChild(createListItem(node));
      }
    }

    fitRows();
  }

  // Cards default to 4:3, which leaves the last visible row sliced in half at the
  // fold. Round to the nearest whole number of rows that fits and stretch them to
  // fill, so the row count decides the aspect rather than the other way around.
  const DENSITY = {
    grid: { gap: 16, minCardH: 140 },
    compact: { gap: 10, minCardH: 78 },
  };

  function fitRows() {
    content.style.removeProperty('--card-h');
    const density = DENSITY[viewMode];
    if (!density) return;

    const card = content.firstElementChild;
    if (!card) return;

    const { gap, minCardH } = density;
    const top = content.getBoundingClientRect().top + window.scrollY;
    const avail = window.innerHeight - top - gap;
    const ideal = card.getBoundingClientRect().width * 3 / 4;
    if (avail <= 0 || ideal <= 0) return;

    const rows = Math.max(1, Math.round((avail + gap) / (ideal + gap)));
    const h = Math.max(minCardH, (avail - (rows - 1) * gap) / rows);
    content.style.setProperty('--card-h', h + 'px');
  }

  let fitPending = false;
  window.addEventListener('resize', () => {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(() => { fitPending = false; fitRows(); });
  });

  // ═══════════════════════════════════
  // Navigation
  // ═══════════════════════════════════

  async function navigateTo(folderId) {
    currentFolderId = folderId;
    searchInput.value = '';

    const children = await getChildren(folderId);

    // Get child counts for subfolders
    const countPromises = children
      .filter((c) => !c.url)
      .map(async (c) => {
        const grandchildren = await getChildren(c.id);
        c._childCount = grandchildren.length;
      });
    await Promise.all(countPromises);

    // Load cached thumbnails for bookmarks in this folder
    const urls = children.filter((c) => c.url).map((c) => c.url);
    await loadThumbnails(urls);

    const path = await getBreadcrumbPath(folderId);
    renderBreadcrumbs(path);
    render(children);

    // Thumbnails are manual-only — use right-click "Refresh Preview"
  }

  // ═══════════════════════════════════
  // Search
  // ═══════════════════════════════════

  let searchTimeout;

  function handleSearch(query) {
    clearTimeout(searchTimeout);

    if (!query.trim()) {
      navigateTo(currentFolderId);
      return;
    }

    searchTimeout = setTimeout(async () => {
      const results = await searchBookmarks(query);

      const urls = results.filter((r) => r.url).map((r) => r.url);
      await loadThumbnails(urls);

      breadcrumbs.innerHTML = `<span class="current">Search: "${escapeHtml(query)}"</span>`;
      render(results);
    }, 200);
  }

  // ═══════════════════════════════════
  // Capture Progress
  // ═══════════════════════════════════

  function showCaptureProgress(done, total) {
    if (total <= 0) {
      captureStatus.classList.add('hidden');
      return;
    }
    captureStatus.classList.remove('hidden');
    const pct = Math.round((done / total) * 100);
    captureFill.style.width = pct + '%';
    captureText.textContent = `Generating previews... ${done}/${total}`;
  }

  // ═══════════════════════════════════
  // Context Menu
  // ═══════════════════════════════════

  function showContextMenu(e, node) {
    contextTarget = node;
    contextMenu.classList.remove('hidden');

    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    const openBtn = contextMenu.querySelector('[data-action="open"]');
    const openTabBtn = contextMenu.querySelector('[data-action="open-tab"]');
    const refreshBtn = contextMenu.querySelector('[data-action="refresh-thumb"]');
    if (!node.url) {
      openBtn.style.display = 'none';
      refreshBtn.style.display = 'none';
      openTabBtn.textContent = 'Open Folder';
    } else {
      openBtn.style.display = '';
      refreshBtn.style.display = '';
      openTabBtn.textContent = 'Open in New Tab';
    }
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextTarget = null;
  }

  function handleContextAction(action) {
    if (!contextTarget) return;
    const node = contextTarget;
    hideContextMenu();

    switch (action) {
      case 'open':
        if (node.url) window.location.href = node.url;
        break;
      case 'open-tab':
        if (node.url) {
          chrome.tabs.create({ url: node.url });
        } else {
          navigateTo(node.id);
        }
        break;
      case 'edit':
        showEditDialog(node);
        break;
      case 'refresh-thumb':
        if (node.url) {
          // Clear cached thumbnail and re-capture
          chrome.runtime.sendMessage({ type: 'clear-thumbnail', url: node.url }).catch(() => {});
          delete thumbnailCache[node.url];
          requestCaptures([node]);
        }
        break;
      case 'delete':
        deleteBookmark(node);
        break;
    }
  }

  // ═══════════════════════════════════
  // Edit Dialog
  // ═══════════════════════════════════

  function showEditDialog(node) {
    isCreatingFolder = false;
    editingNode = node;
    editHeading.textContent = node.url ? 'Edit Bookmark' : 'Edit Folder';
    editTitle.value = node.title;

    if (node.url) {
      editUrl.value = node.url;
      editUrlLabel.style.display = '';
    } else {
      editUrl.value = '';
      editUrlLabel.style.display = 'none';
    }

    editDialog.classList.remove('hidden');
    editTitle.focus();
    editTitle.select();
  }

  function showCreateFolderDialog() {
    isCreatingFolder = true;
    editingNode = null;
    editHeading.textContent = 'New Folder';
    editTitle.value = '';
    editUrl.value = '';
    editUrlLabel.style.display = 'none';

    editDialog.classList.remove('hidden');
    editTitle.focus();
  }

  function hideEditDialog() {
    editDialog.classList.add('hidden');
    editingNode = null;
    isCreatingFolder = false;
  }

  async function saveEdit() {
    if (isCreatingFolder) {
      const title = editTitle.value.trim();
      if (!title) return;
      await chrome.bookmarks.create({ parentId: currentFolderId, title });
      hideEditDialog();
      navigateTo(currentFolderId);
      return;
    }

    if (!editingNode) return;

    const changes = { title: editTitle.value };
    if (editingNode.url) changes.url = editUrl.value;

    await chrome.bookmarks.update(editingNode.id, changes);
    hideEditDialog();

    if (searchInput.value.trim()) {
      handleSearch(searchInput.value);
    } else {
      navigateTo(currentFolderId);
    }
  }

  async function deleteBookmark(node) {
    if (!node.url) {
      await chrome.bookmarks.removeTree(node.id);
    } else {
      await chrome.bookmarks.remove(node.id);
    }

    if (searchInput.value.trim()) {
      handleSearch(searchInput.value);
    } else {
      navigateTo(currentFolderId);
    }
  }

  // ═══════════════════════════════════
  // Drag & Drop
  // ═══════════════════════════════════

  function setupDrag(el, node) {
    el.addEventListener('dragstart', (e) => {
      dragTarget = node;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragTarget = null;
      for (const d of document.querySelectorAll('.drag-over, .drag-into')) {
        d.classList.remove('drag-over', 'drag-into');
      }
    });

    const isFolder = !node.url;

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragTarget && dragTarget.id !== node.id) {
        el.classList.add(isFolder ? 'drag-into' : 'drag-over');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over', 'drag-into');
    });

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over', 'drag-into');

      if (!dragTarget || dragTarget.id === node.id) return;

      try {
        if (isFolder) {
          // Dropping onto a folder moves the item into it, not next to it.
          // Chrome rejects moving a folder into its own descendant.
          await chrome.bookmarks.move(dragTarget.id, { parentId: node.id });
        } else {
          const children = await getChildren(currentFolderId);
          const targetIndex = children.findIndex((c) => c.id === node.id);
          if (targetIndex < 0) return;
          await chrome.bookmarks.move(dragTarget.id, {
            parentId: currentFolderId,
            index: targetIndex,
          });
        }
        navigateTo(currentFolderId);
      } catch (err) {
        console.warn('Move failed:', err);
      }
    });
  }

  // ═══════════════════════════════════
  // View Toggle
  // ═══════════════════════════════════

  function setView(mode) {
    viewMode = mode;
    localStorage.setItem('bm-view', mode);
    gridBtn.classList.toggle('active', mode === 'grid');
    compactBtn.classList.toggle('active', mode === 'compact');
    listBtn.classList.toggle('active', mode === 'list');

    if (searchInput.value.trim()) {
      handleSearch(searchInput.value);
    } else {
      navigateTo(currentFolderId);
    }
  }

  // ═══════════════════════════════════
  // Live Thumbnail Updates
  // ═══════════════════════════════════

  function updateCardThumbnail(url, dataUrl) {
    thumbnailCache[url] = dataUrl;

    // Find card with this URL and hot-swap to thumbnail view
    const card = content.querySelector(`.card[data-url="${CSS.escape(url)}"]`);
    if (card && !card.classList.contains('has-thumb')) {
      card.classList.add('has-thumb');
      card.style.backgroundImage = `url(${dataUrl})`;
      card.style.background = ''; // clear gradient
      card.style.backgroundImage = `url(${dataUrl})`;
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'top center';

      // Replace inner content with thumb-info
      const title = card.querySelector('.title')?.textContent || '';
      const faviconSrc = getFaviconUrl(url);

      // Remove old content — use existing title if set, else clean domain
      const cardTitle = card.querySelector('.title')?.textContent || '';
      const liveDisplayName = cardTitle && cardTitle !== 'Untitled' ? cardTitle : getShortDomain(url);
      card.innerHTML = `
        <div class="thumb-info">
          <img class="thumb-favicon" src="${faviconSrc}" alt=""
               onerror="this.style.display='none'">
          <div class="title">${escapeHtml(liveDisplayName)}</div>
        </div>
      `;
    }
  }

  // ═══════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════

  searchInput.addEventListener('input', (e) => handleSearch(e.target.value));

  gridBtn.addEventListener('click', () => setView('grid'));
  compactBtn.addEventListener('click', () => setView('compact'));
  listBtn.addEventListener('click', () => setView('list'));
  addFolderBtn.addEventListener('click', showCreateFolderDialog);

  for (const btn of contextMenu.querySelectorAll('button')) {
    btn.addEventListener('click', () => handleContextAction(btn.dataset.action));
  }

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  $('#edit-cancel').addEventListener('click', hideEditDialog);
  $('#edit-save').addEventListener('click', saveEdit);
  editDialog.addEventListener('click', (e) => {
    if (e.target === editDialog) hideEditDialog();
  });

  editTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
  });
  editUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
  });

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      hideEditDialog();
      searchInput.blur();
      return;
    }

    if (
      document.activeElement === searchInput ||
      document.activeElement === editTitle ||
      document.activeElement === editUrl
    ) {
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
      return;
    }

    if (e.key === 'Backspace' && currentFolderId !== '0') {
      e.preventDefault();
      const node = await getNode(currentFolderId);
      if (node.parentId) navigateTo(node.parentId);
    }
  });

  // Listen for bookmark changes
  chrome.bookmarks.onCreated.addListener(() => navigateTo(currentFolderId));
  chrome.bookmarks.onRemoved.addListener(() => navigateTo(currentFolderId));
  chrome.bookmarks.onChanged.addListener(() => navigateTo(currentFolderId));
  chrome.bookmarks.onMoved.addListener(() => navigateTo(currentFolderId));

  // Listen for thumbnail capture results from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'thumbnail-ready') {
      updateCardThumbnail(msg.url, msg.dataUrl);
    }
    if (msg.type === 'capture-progress') {
      showCaptureProgress(msg.done, msg.total);
    }
    if (msg.type === 'capture-all-done') {
      captureStatus.classList.add('hidden');
    }
  });

  // ═══════════════════════════════════
  // Init
  // ═══════════════════════════════════

  gridBtn.classList.toggle('active', viewMode === 'grid');
  compactBtn.classList.toggle('active', viewMode === 'compact');
  listBtn.classList.toggle('active', viewMode === 'list');

  navigateTo('1'); // Open Bookmarks Bar by default
})();
