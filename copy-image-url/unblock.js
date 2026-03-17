// Unblock right-click on all pages
// Runs in MAIN world so overrides affect the page's actual JS context

(function () {
  // 1. Capture-phase listener: intercept contextmenu before any page handler
  //    runs, preventing them from calling preventDefault()
  document.addEventListener(
    "contextmenu",
    (e) => { e.stopImmediatePropagation(); },
    { capture: true }
  );

  // 2. Kill oncontextmenu property assignments
  for (const proto of [HTMLElement.prototype, Document.prototype, window.constructor.prototype]) {
    const desc = Object.getOwnPropertyDescriptor(proto, "oncontextmenu");
    if (desc && desc.set) {
      const origSet = desc.set;
      Object.defineProperty(proto, "oncontextmenu", {
        ...desc,
        set() { origSet.call(this, null); },
      });
    }
  }

  // 3. Remove inline oncontextmenu attrs
  function cleanDom() {
    document.querySelectorAll("[oncontextmenu]").forEach((el) => {
      el.removeAttribute("oncontextmenu");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", cleanDom);
  } else {
    cleanDom();
  }

  const obs = new MutationObserver(() => cleanDom());
  const startObserver = () => {
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }

  // 4. CSS overrides (user-select) handled by styles.css via manifest
})();
