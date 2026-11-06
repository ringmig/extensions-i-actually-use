// HTML Image Viewer keeps one IndexedDB database per canvas, with the keys
// 'state' (images, pan, zoom) and 'meta' (path and time last opened).
// Database names: 'infiniteCanvas@<file name>' now, 'infiniteCanvas:<full path>'
// before 2026-11, plain 'infiniteCanvas' before that.
var store = (() => {
  const PREFIX = 'infiniteCanvas';

  const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  function open(name) {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    return request(req);
  }

  const read = (db, key) => db.objectStoreNames.contains('kv')
    ? request(db.transaction('kv').objectStore('kv').get(key))
    : null;

  async function list() {
    const out = [];
    for (const { name } of await indexedDB.databases()) {
      if (name !== PREFIX && !name.startsWith(PREFIX + '@') && !name.startsWith(PREFIX + ':')) continue;
      const db = await open(name);
      const state = await read(db, 'state');
      const meta = await read(db, 'meta');
      db.close();
      const items = Object.values(state?.images || {});
      const format = name[PREFIX.length] || '';
      const rest = name.slice(PREFIX.length + 1);
      out.push({
        db: name,
        file: format === '@' ? rest : format === ':' ? rest.split('/').pop() : 'image-viewer.html',
        legacy: format !== '@',
        path: meta?.path ?? (format === ':' ? rest : null),
        opened: meta?.opened ?? null,
        images: items.filter(i => !i.video).length,
        videos: items.filter(i => i.video).length,
        // Pasted and dropped images are base64 data: URLs, a third larger than the file
        bytes: items.reduce((n, i) => n + (i.src?.startsWith('data:') ? i.src.length * 0.75 : 0), 0),
      });
    }
    return out;
  }

  // Waits while a tab still has the database open, which is why callers
  // check for open tabs first.
  const remove = name => request(indexedDB.deleteDatabase(name));

  // A page cannot rename the file on disk, so the canvas assumes the file was
  // (or will be) renamed in the same folder.
  async function rename(name, file, path, opened) {
    const target = PREFIX + '@' + file;
    const source = await open(name);
    const state = await read(source, 'state');
    source.close();
    const db = await open(target);
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(state, 'state');
    if (path) tx.objectStore('kv').put({ path: path.slice(0, path.lastIndexOf('/') + 1) + file, opened }, 'meta');
    else tx.objectStore('kv').delete('meta');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await remove(name);
  }

  return { list, remove, rename, nameFor: file => PREFIX + '@' + file };
})();
