// Chrome decides the "image" context from the TOPMOST element under the cursor.
// Sites that layer a transparent overlay over their images (Pinterest, Instagram)
// therefore hand Chrome a div or an <a>, the context is never "image", and the
// menu item never appears. Record what is really under the pointer instead.
//
// Listens on mousedown as well as contextmenu because unblock.js calls
// stopImmediatePropagation on contextmenu in the MAIN world, and the two scripts'
// registration order is not guaranteed. mousedown always gets through.

(function () {
  function imageUrlOf(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";

    if (tag === "img") {
      const src = el.currentSrc || el.src;
      if (src) return src;
    }
    if (tag === "image" && el.href && el.href.baseVal) {
      return new URL(el.href.baseVal, location.href).href;
    }
    if (tag === "video" && el.poster) return el.poster;

    const bg = getComputedStyle(el).backgroundImage;
    const match = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
    // Inline SVG data URIs are icons and decorations, never the image wanted
    if (match && !match[1].startsWith("data:image/svg")) {
      return new URL(match[1], location.href).href;
    }
    return null;
  }

  function imageUnder(x, y) {
    // elementsFromPoint returns the stack top-down, so the overlay is checked
    // first and the image beneath it is found right after.
    for (const el of document.elementsFromPoint(x, y)) {
      const url = imageUrlOf(el);
      if (url) return url;
    }
    return null;
  }

  function capture(e) {
    if (e.type === "mousedown" && e.button !== 2) return;
    const url = imageUnder(e.clientX, e.clientY);
    try {
      chrome.runtime.sendMessage({ type: "right-click-image", url }).catch(() => {});
    } catch (_) {
      // Extension context invalidated (reload) — nothing to do
    }
  }

  window.addEventListener("mousedown", capture, true);
  window.addEventListener("contextmenu", capture, true);
})();
