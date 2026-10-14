// The right-clicked element is caught at document_start on window in the capture
// phase, before page scripts can swallow the event (see ../CLAUDE.md). Hiding
// rather than removing keeps undo trivial and stops frameworks re-inserting it.
(() => {
  let target = null
  const hidden = []

  const catchTarget = (e) => {
    if (e.type === 'mousedown' && e.button !== 2) return
    target = e.composedPath()[0]
  }
  window.addEventListener('mousedown', catchTarget, true)
  window.addEventListener('contextmenu', catchTarget, true)

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg === 'hide' && target instanceof Element && target !== document.documentElement && target !== document.body) {
      hidden.push([target, target.style.getPropertyValue('display'), target.style.getPropertyPriority('display')])
      target.style.setProperty('display', 'none', 'important')
      target = null
    } else if (msg === 'undo' && hidden.length) {
      const [el, value, priority] = hidden.pop()
      el.style.setProperty('display', value, priority)
    }
  })
})()
