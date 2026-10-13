// Self-check for toast.js DOM logic: TikTok image filtering + SVG hit-test.
// Run: node test-toast.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import vm from 'node:vm';

const src = readFileSync(new URL('./toast.js', import.meta.url), 'utf8');

function img(src, { w = 1080, clientWidth = 500, clientHeight = 500 } = {}) {
  return { src, naturalWidth: w, clientWidth, clientHeight };
}

function load(imgs, rightClick) {
  let onMessage;
  const winListeners = [];
  const sandbox = {
    URL, console, location: { origin: 'https://www.instagram.com' },
    window: { addEventListener: (t, fn) => winListeners.push([t, fn]) },
    document: {
      addEventListener() {}, getElementById: () => null,
      head: { appendChild() {} }, documentElement: {}, body: {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      querySelectorAll: () => imgs,
    },
    chrome: { runtime: { onMessage: { addListener: (fn) => { onMessage = fn; } } } },
    XMLSerializer: class { serializeToString(n) { return `<svg id="${n.id}"/>`; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  if (rightClick) {
    for (const [type, fn] of winListeners) if (type === 'contextmenu') fn(rightClick);
  }
  return (msg) => { let out; onMessage(msg, null, (r) => { out = r; }); return out; };
}

const CDN = 'https://p16-photomode-va.tiktokcdn-us.com/obj';

// 1. photomode slides: junk excluded, highest resolution per slide kept
let send = load([
  img(`${CDN}/${'a'.repeat(24)}~tplv-photomode-image.jpeg`, { w: 1080 }),
  img(`${CDN}/${'a'.repeat(24)}~tplv-photomode-small.jpeg`, { w: 300 }),
  img(`${CDN}/${'b'.repeat(24)}~tplv-photomode-image.jpeg`, { w: 1080 }),
  img('https://p16-sign.tiktokcdn-us.com/obj/tos-avt-0068/avatar~100x100.jpeg', { w: 100 }),
  img('https://static.example.com/volume-icon.svg', { w: 24 }),
]);
let images = send({ type: 'scrape-tiktok-images' }).images;
assert.deepStrictEqual([...images], [
  `${CDN}/${'a'.repeat(24)}~tplv-photomode-image.jpeg`,
  `${CDN}/${'b'.repeat(24)}~tplv-photomode-image.jpeg`,
]);

// 2. no photomode marker → size fallback on CDN images, icons still excluded
send = load([
  img('https://p19-sign.tiktokcdn-us.com/obj/slide-one.jpeg', { w: 1080 }),
  img('https://p19-sign.tiktokcdn-us.com/obj/tiny-badge.png', { w: 32, clientWidth: 32, clientHeight: 32 }),
  img('https://p19-sign.tiktokcdn-us.com/obj/tos-avt-x/avatar.jpeg', { w: 1080 }),
]);
assert.deepStrictEqual([...send({ type: 'scrape-tiktok-images' }).images],
  ['https://p19-sign.tiktokcdn-us.com/obj/slide-one.jpeg']);

// 3. SVG hit-test: a wrapper's off-cursor icon (mute button) is not returned...
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
const fakeSvg = (id, r) => ({
  tagName: 'svg', id, getBoundingClientRect: () => r,
  cloneNode: () => ({ id, getAttribute: () => null, setAttribute() {} }),
});
const muteIcon = fakeSvg('mute', rect(0, 400, 24, 424));
const wrapper = (svgs) => ({
  tagName: 'DIV', parentNode: null,
  querySelectorAll: () => svgs, querySelector: () => svgs[0],
  getBoundingClientRect: () => rect(0, 0, 500, 500),
});
send = load([], { type: 'contextmenu', target: wrapper([muteIcon]), clientX: 250, clientY: 250 });
assert.strictEqual(send({ type: 'get-right-clicked-svg' }).svg, null);

// ...but an SVG actually under the cursor still is (logo case)
const logo = fakeSvg('logo', rect(200, 200, 300, 300));
send = load([], { type: 'contextmenu', target: wrapper([muteIcon, logo]), clientX: 250, clientY: 250 });
assert.strictEqual(send({ type: 'get-right-clicked-svg' }).id, 'logo');

// 4. Instagram /tagged/ grid: tiles link to /<username>/p/<code>/, and a photo
// tile hands back the CDN image the user actually clicked.
const igTile = (href, imgSrc) => {
  const image = { tagName: 'IMG', src: imgSrc, getBoundingClientRect: () => rect(0, 0, 300, 300) };
  const anchor = {
    tagName: 'A', getAttribute: (k) => (k === 'href' ? href : null),
    querySelector: () => image, querySelectorAll: () => [],
    parentNode: null, getBoundingClientRect: () => rect(0, 0, 300, 300),
  };
  image.parentNode = anchor;
  return image;
};

send = load([], { type: 'contextmenu', target: igTile('/_digital_jungle/p/Dc-14PogoJ9/', 'https://scontent.cdninstagram.com/v/x.jpg'), clientX: 150, clientY: 150 });
assert.deepStrictEqual({ ...send({ type: 'get-instagram-post-url' }) }, {
  url: 'https://www.instagram.com/p/Dc-14PogoJ9/',
  image: 'https://scontent.cdninstagram.com/v/x.jpg',
});

// A reel tile shows only a poster frame — keep the permalink, drop the image
send = load([], { type: 'contextmenu', target: igTile('/mothership_se/reel/DdHN0n6CSHd/', 'https://scontent.cdninstagram.com/v/poster.jpg'), clientX: 150, clientY: 150 });
assert.deepStrictEqual({ ...send({ type: 'get-instagram-post-url' }) }, {
  url: 'https://www.instagram.com/reel/DdHN0n6CSHd/',
  image: null,
});

console.log('ok');
