// Self-check for transcript filenames. Plain node, no runner:
//   node test-filename.mjs   →  prints "ok", exits 0
//
// Runs background.js's naming helpers in a sandbox rather than duplicating them,
// so the test fails if the real functions drift.

import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./background.js', import.meta.url), 'utf8');

let onDeterminingFilename = null;

const ctx = vm.createContext({
  chrome: {
    runtime: { id: 'ourid', onMessage: { addListener() {} }, onInstalled: { addListener() {} } },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} } },
    downloads: {
      download() {},
      onDeterminingFilename: { addListener(fn) { onDeterminingFilename = fn; } },
    },
  },
  console,
  URL,
  setTimeout,
  fetch: () => { throw new Error('no network in test'); },
});
vm.runInContext(src, ctx);

const { sanitizeFilename, transcriptFilename, sourceSlug, claimFilename } = ctx;

const yt = new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const tt = new URL('https://www.tiktok.com/@someone/video/7412345678901234567');

// The title is the filename when there is one
assert.strictEqual(
  transcriptFilename('How transformers actually work', yt),
  'How transformers actually work.txt'
);

// Illegal characters go, the title survives
assert.strictEqual(
  transcriptFilename('Q4: revenue/costs <draft>', yt),
  'Q4 revenuecosts draft.txt'
);

// The reported bug: a title that sanitises to nothing must not yield ".txt",
// because Chrome then substitutes its own generic name
assert.strictEqual(transcriptFilename('///', yt), 'youtube_dQw4w9WgXcQ.txt');
assert.strictEqual(transcriptFilename('', tt), 'tiktok_7412345678901234567.txt');
assert.strictEqual(transcriptFilename(undefined, tt), 'tiktok_7412345678901234567.txt');

// A caption that is only hashtags is not a title
assert.strictEqual(transcriptFilename('#fyp #foryou #viral', tt), 'tiktok_7412345678901234567.txt');

// ...but hashtags trailing a real title are trimmed off it
assert.strictEqual(
  transcriptFilename('Making sourdough #baking #fyp', tt),
  'Making sourdough.txt'
);

// Leading and trailing dots break the name on disk
assert.strictEqual(sanitizeFilename('...hidden'), 'hidden');
assert.strictEqual(sanitizeFilename('trailing.'), 'trailing');

// Long titles are cut without leaving a trailing dot or space behind
const long = 'a'.repeat(200);
assert.strictEqual(sanitizeFilename(long).length, 120);
assert.strictEqual(sanitizeFilename('x'.repeat(119) + ' yz').length, 119);

// A URL with no usable id still names the file after the site
assert.strictEqual(sourceSlug(new URL('https://www.youtube.com/')), 'youtube');

// ── Filename ownership: the actual cause of the generic "download.txt" ──

assert.ok(onDeterminingFilename, 'the extension must register a filename listener');

// Our own download gets its name back
claimFilename('Making sourdough.txt');
let suggested = null;
onDeterminingFilename({ url: 'data:text/plain;charset=utf-8,hello', byExtensionId: 'ourid' }, (s) => { suggested = s; });
// Field by field: the object is created inside the vm realm, so its prototype
// is not the host's and deepStrictEqual would fail on that alone
assert.strictEqual(suggested.filename, 'Making sourdough.txt');
assert.strictEqual(suggested.conflictAction, 'uniquify');

// The claim is spent — a second download must not inherit it
suggested = null;
onDeterminingFilename({ url: 'data:text/plain;charset=utf-8,again', byExtensionId: 'ourid' }, (s) => { suggested = s; });
assert.strictEqual(suggested, null);

// A sibling extension's download is left alone even while our claim is pending.
// This is the case that broke: Media Downloader started an mp4, Transcribe bid
// on it, and Chrome handed the loser an error instead of a file.
claimFilename('Mine.txt');
suggested = null;
onDeterminingFilename({ url: 'data:text/plain;charset=utf-8,theirs', byExtensionId: 'someone-else' }, (s) => { suggested = s; });
assert.strictEqual(suggested, null, 'must abstain on another extension\'s download');

// ...and so is a plain page download nobody claimed
suggested = null;
onDeterminingFilename({ url: 'https://example.com/photo.jpg', byExtensionId: undefined }, (s) => { suggested = s; });
assert.strictEqual(suggested, null, 'must abstain on downloads we did not start');

console.log('ok');
