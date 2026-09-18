// Self-check for background.js download paths: every batch file must land in
// its own post folder, never loose in chrome-downloads/.
// Run: node test-background.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import vm from 'node:vm';

const src = readFileSync(new URL('./background.js', import.meta.url), 'utf8');

const listener = () => ({ addListener() {} });
const downloads = [];
let onDetermining = null;
const sandbox = {
  URL, console: { ...console, log() {} }, crypto, setTimeout, clearTimeout,
  chrome: {
    runtime: { id: 'ourid', onInstalled: listener(), onMessage: listener(), lastError: null, getURL: (p) => p },
    contextMenus: { onClicked: listener(), removeAll(_, cb) { cb && cb(); }, create() {} },
    downloads: {
      onChanged: listener(),
      onDeterminingFilename: { addListener(fn) { onDetermining = fn; } },
      download(opts, cb) { downloads.push(opts.filename); cb && cb(1); },
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    tabs: { sendMessage: async () => ({}) },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  },
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const { makeFolderName, extractDownloadUrls, startBatchDownload, isTikTokVideoPost } = sandbox;

// A video post must never take the btch-downloader / carousel-scrape path:
// that is what downloaded the feed's thumbnails instead of the video
assert.strictEqual(isTikTokVideoPost('https://www.tiktok.com/@user/video/7412345678'), true);
assert.strictEqual(isTikTokVideoPost('https://www.tiktok.com/@user/photo/7412345678'), false);
// An opaque short link keeps the old path — its contents are unknown
assert.strictEqual(isTikTokVideoPost('https://vm.tiktok.com/ZGJabcdef/'), false);
assert.strictEqual(isTikTokVideoPost('https://youtube.com/watch?v=x'), false);
const POST = 'https://www.tiktok.com/@user/photo/7412345678';

// Emoji-only caption sanitizes to '' — must fall back to the URL, not ''
assert.strictEqual(makeFolderName({ title: '🔥🔥🔥' }, POST), 'tiktok_user_photo_7412345678');
assert.strictEqual(makeFolderName({}, POST), 'tiktok_user_photo_7412345678');
assert.strictEqual(makeFolderName({ title: 'Min bild' }, POST), 'Min_bild');
assert.strictEqual(makeFolderName({}, 'not a url'), 'download');

// btch-downloader carousel with an emoji caption → all files under one folder
const urls = extractDownloadUrls({
  title: '🔥🔥🔥',
  result: [
    { downloadUrl: 'https://tikio.com/a.jpg', filename: 'tikio_a.jpg' },
    { downloadUrl: 'https://tikio.com/b.jpg', filename: 'tikio_b.jpg' },
  ],
}, POST);
startBatchDownload(urls);
assert.deepStrictEqual([...downloads], [
  'chrome-downloads/tiktok_user_photo_7412345678/tikio_a.jpg',
  'chrome-downloads/tiktok_user_photo_7412345678/tikio_b.jpg',
]);

// A rival onDeterminingFilename extension must not rename our downloads:
// we claim the path back for URLs we started ourselves.
const suggested = [];
onDetermining({ url: 'https://tikio.com/a.jpg', finalUrl: 'https://tikio.com/a.jpg', byExtensionId: 'ourid' },
  (s) => suggested.push(s));
assert.deepStrictEqual({ ...suggested[0] },
  { filename: 'chrome-downloads/tiktok_user_photo_7412345678/tikio_a.jpg', conflictAction: 'uniquify' });

// Someone else's download is left alone (no suggestion at all)
suggested.length = 0;
onDetermining({ url: 'https://example.com/other.jpg', finalUrl: '', byExtensionId: 'ourid' },
  (s) => suggested.push(s));
assert.strictEqual(suggested.length, 0);

// Even a URL we did claim is left alone when another extension started that
// download — bidding on a sibling's file hands its owner an error, not a file
suggested.length = 0;
onDetermining({ url: 'https://tikio.com/b.jpg', finalUrl: 'https://tikio.com/b.jpg', byExtensionId: 'someone-else' },
  (s) => suggested.push(s));
assert.strictEqual(suggested.length, 0, 'must abstain on another extension\'s download');

// Path segments Chrome chokes on are cleaned: trailing dot, empty segment
assert.strictEqual(sandbox.safeRelPath('chrome-downloads/internal docs./a.jpg'),
  'chrome-downloads/internal docs/a.jpg');
assert.strictEqual(sandbox.safeRelPath('chrome-downloads//a.jpg'), 'chrome-downloads/a.jpg');

console.log('ok');
