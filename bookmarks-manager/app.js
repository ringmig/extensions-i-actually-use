/* ══════════════════════════════════════════════════════════
   Bookmarks Manager — App Logic + Thumbnail Support
   ══════════════════════════════════════════════════════════ */

(() => {
  // ═══════════════════════════════════
  // Remove Chrome's injected new-tab UI
  // ═══════════════════════════════════

  function removeChromeBanner() {
    for (const el of document.body.children) {
      if (el.id !== 'app' && el.id !== 'context-menu' && el.id !== 'edit-dialog' && el.id !== 'toast' && el.id !== 'bm-modal' && !el.matches('script, link')) {
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
  let sortAZ = localStorage.getItem('bm-sort') === 'az';
  let contextTarget = null;
  let editingNode = null;
  let dragTarget = null;
  let renderedFolderId = null;
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
  const sortBtn = $('#sort-az');
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

  function escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeFolderName(name) {
    const sanitized = (name || 'Bookmarks')
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .replace(/^\.+/, '');
    return sanitized || 'Bookmarks';
  }

  let toastTimeout;
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2400);
  }

  async function copyToClipboard(text, btn = null) {
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        success = true;
      }
    } catch {
      // Fallback below
    }

    if (!success) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        success = document.execCommand('copy');
        ta.remove();
      } catch {}
    }

    if (success) {
      showToast('Copied URL to clipboard');
      if (btn) {
        setButtonCopiedState(btn);
      }
    } else {
      showToast('Failed to copy URL');
    }
  }

  function setButtonCopiedState(btn) {
    btn.classList.add('copied');
    btn.title = 'Copied!';
    btn.setAttribute('aria-label', 'Copied!');
    const copyIcon = btn.querySelector('.copy-icon');
    const checkIcon = btn.querySelector('.check-icon');
    if (copyIcon && checkIcon) {
      copyIcon.classList.add('hidden');
      checkIcon.classList.remove('hidden');
    }
    clearTimeout(btn._copiedTimeout);
    btn._copiedTimeout = setTimeout(() => {
      btn.classList.remove('copied');
      btn.title = 'Copy URL';
      btn.setAttribute('aria-label', 'Copy URL');
      if (copyIcon && checkIcon) {
        copyIcon.classList.remove('hidden');
        checkIcon.classList.add('hidden');
      }
    }, 1500);
  }

  function createCopyButton(url) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-url-btn';
    btn.title = 'Copy URL';
    btn.setAttribute('aria-label', 'Copy URL');
    btn.draggable = false;
    btn.innerHTML = `${COPY_ICON_SVG}${CHECK_ICON_SVG}`;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(url, btn);
    });

    btn.addEventListener('auxclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    return btn;
  }

  function generateBookmarksHtml(rootNode) {
    const lines = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file.',
      '     It will be read and overwritten.',
      '     DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      `<TITLE>${escapeAttr(rootNode.title || 'Bookmarks')}</TITLE>`,
      `<H1>${escapeAttr(rootNode.title || 'Bookmarks')}</H1>`,
      '<DL><p>'
    ];

    function formatTimestamp(ms) {
      return ms ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
    }

    function walk(node, indent) {
      const spaces = ' '.repeat(indent);
      if (node.url) {
        const addDate = formatTimestamp(node.dateAdded);
        const title = escapeAttr(node.title || node.url);
        const url = escapeAttr(node.url);
        lines.push(`${spaces}<DT><A HREF="${url}" ADD_DATE="${addDate}">${title}</A>`);
      } else {
        const addDate = formatTimestamp(node.dateAdded);
        const modDate = formatTimestamp(node.dateGroupModified || node.dateAdded);
        const title = escapeAttr(node.title || 'Folder');
        lines.push(`${spaces}<DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${modDate}">${title}</H3>`);
        lines.push(`${spaces}<DL><p>`);
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            walk(child, indent + 4);
          }
        }
        lines.push(`${spaces}</DL><p>`);
      }
    }

    if (rootNode.id === '0') {
      if (rootNode.children) {
        for (const child of rootNode.children) {
          walk(child, 4);
        }
      }
    } else {
      walk(rootNode, 4);
    }

    lines.push('</DL><p>');
    return lines.join('\n');
  }

  async function exportBookmarks(node) {
    try {
      const folderId = node.id;
      let title = node.title;

      if (!title) {
        if (folderId === '0') {
          title = 'Bookmarks';
        } else {
          const fresh = await getNode(folderId).catch(() => null);
          title = fresh?.title || 'Bookmarks';
        }
      }

      const [tree] = await chrome.bookmarks.getSubTree(folderId);
      if (!tree) {
        showToast('Folder not found');
        return;
      }

      if (!tree.title && title) {
        tree.title = title;
      }

      const htmlContent = generateBookmarksHtml(tree);
      const safeFolder = sanitizeFolderName(title);
      const filename = `${safeFolder}/bookmarks.html`;

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url: blobUrl,
          filename,
          saveAs: false,
          conflictAction: 'uniquify'
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(downloadId);
          }
        });
      });

      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      showToast(`Exported "${title}" to Downloads/${safeFolder}/`);
    } catch (err) {
      console.error('Export failed:', err);
      showToast('Export failed: ' + (err.message || 'Unknown error'));
    }
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

  const COPY_ICON_SVG = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
  </svg>`;

  const CHECK_ICON_SVG = `<svg class="check-icon hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
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
    home.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, { id: '0', title: 'Bookmarks' });
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
        span.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e, { id: item.id, title: item.title, isCurrentFolder: true });
        });
        breadcrumbs.appendChild(span);
      } else {
        const link = document.createElement('a');
        link.textContent = item.title;
        link.href = '#';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigateTo(item.id);
        });
        link.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e, item);
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
            <img class="thumb-favicon" src="${getFaviconUrl(node.url)}" alt="">
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
        el.appendChild(createCopyButton(node.url));
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
        el.appendChild(createCopyButton(node.url));
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

    // Custom order is Chrome's own order, untouched, so a drop lands exactly where shown
    // Sort by what the card shows: untitled bookmarks display their domain
    const label = (n) => n.title || (n.url ? getShortDomain(n.url) : '');
    const byTitle = (a, b) => label(a).localeCompare(label(b), 'sv', { sensitivity: 'base', numeric: true });
    const sorted = sortAZ
      ? [...items.filter((n) => !n.url).sort(byTitle), ...items.filter((n) => n.url).sort(byTitle)]
      : items;

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
    // Re-rendering the same folder (a move, an edit) must not replay the entry fade
    const refresh = folderId === renderedFolderId;
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
    content.classList.toggle('no-anim', refresh);
    renderedFolderId = folderId;

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
      renderedFolderId = null;
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

    const openBtn = contextMenu.querySelector('[data-action="open"]');
    const openTabBtn = contextMenu.querySelector('[data-action="open-tab"]');
    const copyUrlBtn = contextMenu.querySelector('[data-action="copy-url"]');
    const newFolderBtn = contextMenu.querySelector('[data-action="new-folder"]');
    const exportBtn = contextMenu.querySelector('[data-action="export"]');
    const refreshBtn = contextMenu.querySelector('[data-action="refresh-thumb"]');
    const editBtn = contextMenu.querySelector('[data-action="edit"]');
    const moveUpBtn = contextMenu.querySelector('[data-action="move-up"]');
    const deleteBtn = contextMenu.querySelector('[data-action="delete"]');
    const separator = contextMenu.querySelector('.ctx-separator');

    if (!node.url) {
      openBtn.style.display = 'none';
      if (copyUrlBtn) copyUrlBtn.style.display = 'none';
      refreshBtn.style.display = 'none';
      if (exportBtn) exportBtn.style.display = '';

      if (node.isCurrentFolder) {
        openTabBtn.style.display = 'none';
        if (newFolderBtn) newFolderBtn.style.display = '';
        editBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
        if (separator) separator.style.display = 'none';
      } else {
        openTabBtn.style.display = '';
        openTabBtn.textContent = 'Open Folder';
        if (newFolderBtn) newFolderBtn.style.display = 'none';
        editBtn.style.display = '';
        deleteBtn.style.display = '';
        if (separator) separator.style.display = '';
      }
    } else {
      openBtn.style.display = '';
      openTabBtn.style.display = '';
      openTabBtn.textContent = 'Open in New Tab';
      if (copyUrlBtn) copyUrlBtn.style.display = '';
      if (newFolderBtn) newFolderBtn.style.display = 'none';
      if (exportBtn) exportBtn.style.display = 'none';
      refreshBtn.style.display = '';
      editBtn.style.display = '';
      deleteBtn.style.display = '';
      if (separator) separator.style.display = '';
    }

    // The root's direct children (Bar, Other, Mobile) have no folder above that can hold items
    moveUpBtn.style.display = !node.isCurrentFolder && node.parentId && !isTopLevel(node.parentId) ? '' : 'none';

    const menuWidth = contextMenu.offsetWidth || 180;
    const menuHeight = contextMenu.offsetHeight || 220;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    contextMenu.style.left = Math.max(10, x) + 'px';
    contextMenu.style.top = Math.max(10, y) + 'px';
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
      case 'copy-url':
        if (node.url) {
          copyToClipboard(node.url);
        }
        break;
      case 'new-folder':
        showCreateFolderDialog();
        break;
      case 'export':
        exportBookmarks(node);
        break;
      case 'edit':
        // Bookmarks get the save modal, which can also change the folder
        if (node.url) window.bmEditBookmark(node.id);
        else showEditDialog(node);
        break;
      case 'move-up':
        moveToGrandparent(node);
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

  function isTopLevel(folderId) {
    return folderId === '0' || folderId === '1' || folderId === '2' || folderId === '3';
  }

  // Lands right after the folder it came out of, so it is easy to find
  async function moveToGrandparent(node) {
    try {
      const [parent] = await chrome.bookmarks.get(node.parentId);
      await chrome.bookmarks.move(node.id, { parentId: parent.parentId, index: parent.index + 1 });
    } catch (err) {
      console.warn('Move failed:', err);
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
      for (const d of document.querySelectorAll('.drop-before, .drop-after, .drag-into')) {
        clearDrop(d);
      }
    });

    const isFolder = !node.url;

    el.addEventListener('dragover', (e) => {
      if (!dragTarget || dragTarget.id === node.id) return;
      const zone = dropZone(e, el, isFolder);
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDrop(el);
      el.classList.add(zone === 'into' ? 'drag-into' : `drop-${zone}`);
    });

    el.addEventListener('dragleave', () => clearDrop(el));

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDrop(el);

      if (!dragTarget || dragTarget.id === node.id) return;
      const zone = dropZone(e, el, isFolder);

      try {
        if (zone === 'into') {
          // Chrome rejects moving a folder into its own descendant.
          await chrome.bookmarks.move(dragTarget.id, { parentId: node.id });
        } else if (zone) {
          // Index is a slot in the current list; Chrome compensates when moving down
          // within the same parent.
          const children = await getChildren(currentFolderId);
          const targetIndex = children.findIndex((c) => c.id === node.id);
          if (targetIndex < 0) return;
          await chrome.bookmarks.move(dragTarget.id, {
            parentId: currentFolderId,
            index: zone === 'after' ? targetIndex + 1 : targetIndex,
          });
        }
        // onMoved re-renders
      } catch (err) {
        console.warn('Move failed:', err);
      }
    });
  }

  function clearDrop(el) {
    el.classList.remove('drop-before', 'drop-after', 'drag-into');
  }

  // Edges of a card mean "beside", the middle of a folder means "into".
  // Search results have no single parent and A-Z ignores position, so only folder drops apply there.
  function dropZone(e, el, isFolder) {
    const r = el.getBoundingClientRect();
    const t = viewMode === 'list'
      ? (e.clientY - r.top) / r.height
      : (e.clientX - r.left) / r.width;
    if (isFolder && t > 0.25 && t < 0.75) return 'into';
    if (sortAZ || searchInput.value.trim()) return isFolder ? 'into' : null;
    return t < 0.5 ? 'before' : 'after';
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
          <img class="thumb-favicon" src="${faviconSrc}" alt="">
          <div class="title">${escapeHtml(liveDisplayName)}</div>
        </div>
      `;
      card.appendChild(createCopyButton(url));
    }
  }

  // ═══════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════

  // CSP forbids inline onerror; error events don't bubble, so catch them in capture phase
  document.addEventListener('error', (e) => {
    if (e.target.classList?.contains('thumb-favicon')) e.target.style.display = 'none';
  }, true);

  searchInput.addEventListener('input', (e) => handleSearch(e.target.value));

  sortBtn.addEventListener('click', () => {
    sortAZ = !sortAZ;
    localStorage.setItem('bm-sort', sortAZ ? 'az' : 'custom');
    sortBtn.classList.toggle('active', sortAZ);
    if (searchInput.value.trim()) handleSearch(searchInput.value);
    else navigateTo(currentFolderId);
  });
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

  content.addEventListener('contextmenu', async (e) => {
    if (e.target.closest('.card, .list-item')) return;
    e.preventDefault();
    let title = 'Bookmarks';
    if (currentFolderId !== '0') {
      const node = await getNode(currentFolderId).catch(() => null);
      title = node?.title || 'Bookmarks';
    }
    showContextMenu(e, { id: currentFolderId, title, isCurrentFolder: true });
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
  sortBtn.classList.toggle('active', sortAZ);

  navigateTo('1'); // Open Bookmarks Bar by default
})();
