/**
 * GIF Recorder - Content Script
 * Strictly button-driven: Select → REC → STOP → Encode → Download
 * No keyboard shortcuts (Escape conflicts with fullscreen).
 */

(() => {
  if (window.__gifRecorderActive) return;
  window.__gifRecorderActive = true;

  const TARGET_FPS = 10;
  const MAX_SECONDS = 30;

  let state = 'selecting'; // selecting | selected | recording | encoding
  let selection = null;
  let frames = [];
  let dragStart = null;
  let mediaStream = null;
  let captureTimer = null;
  let videoEl = null;
  let cursorWatch = null;

  // ── Styles ──

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .grc-overlay {
      position:fixed!important;inset:0!important;
      cursor:crosshair!important;z-index:2147483646!important;
      background:rgba(0,0,0,0.3)!important;
      margin:0!important;padding:0!important;border:none!important;
    }
    /* outline (not border) so the element box IS the captured rect, to the pixel */
    .grc-sel {
      position:fixed!important;border:none!important;
      outline:2px dashed #fff!important;outline-offset:0!important;
      box-shadow:0 0 0 9999px rgba(0,0,0,0.5)!important;
      pointer-events:none!important;z-index:2147483647!important;
      display:none!important;background:transparent!important;
    }
    /* Recording frame: outline sits OUTSIDE the box, plus a 3px offset, so it
       survives the stream's downscaling without bleeding into the crop. */
    .grc-frame {
      position:fixed!important;pointer-events:none!important;
      background:transparent!important;border:none!important;
      outline:2px solid #ff3b30!important;outline-offset:3px!important;
      margin:0!important;padding:0!important;display:none!important;
      z-index:2147483645!important;
    }
    .grc-frame.grc-on{display:block!important}
    /* Stand-in pointer drawn while the real one is hidden; hotspot = top-left */
    .grc-cursor {
      position:fixed!important;width:20px!important;height:28px!important;
      pointer-events:none!important;z-index:2147483647!important;
      display:none!important;margin:0!important;padding:0!important;
      background:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 28"><path d="M3 2 L3 22 L8.2 17 L11.6 25.4 L15.2 23.8 L11.8 15.6 L18 15.6 Z" fill="%23fff" stroke="%23000" stroke-width="1.4" stroke-linejoin="round"/></svg>') no-repeat!important;
      background-size:contain!important;
    }
    .grc-cursor.grc-on{display:block!important}
    .grc-sel.grc-on{display:block!important}
    .grc-hint {
      position:fixed!important;bottom:40px!important;left:50%!important;
      transform:translateX(-50%)!important;
      background:rgba(0,0,0,0.8)!important;color:#fff!important;
      padding:10px 20px!important;border-radius:8px!important;
      font:14px/1.4 -apple-system,system-ui,sans-serif!important;
      pointer-events:none!important;z-index:2147483647!important;
    }
    .grc-panel {
      position:fixed!important;display:none!important;gap:8px!important;
      z-index:2147483647!important;
      background:rgba(0,0,0,0.85)!important;border-radius:8px!important;
      padding:6px 10px!important;box-shadow:0 4px 20px rgba(0,0,0,0.4)!important;
    }
    .grc-panel.grc-on{display:flex!important;align-items:center!important}
    .grc-btn {
      border:none!important;border-radius:6px!important;
      padding:6px 14px!important;cursor:pointer!important;
      font:600 13px/1 -apple-system,system-ui,sans-serif!important;
      display:flex!important;align-items:center!important;gap:6px!important;
    }
    .grc-btn:hover{opacity:0.85!important}
    .grc-btn-rec{background:#ff3b30!important;color:#fff!important}
    .grc-btn-stop{background:#ff3b30!important;color:#fff!important;border-radius:20px!important}
    .grc-btn-x{background:rgba(255,255,255,0.15)!important;color:#fff!important}
    .grc-dot{width:8px!important;height:8px!important;border-radius:50%!important;background:#fff!important;display:inline-block!important}
    .grc-sq{width:8px!important;height:8px!important;border-radius:2px!important;background:#fff!important;display:inline-block!important}
    .grc-sz{color:rgba(255,255,255,0.6)!important;font:12px/1 monospace!important;padding:0 6px!important}
    .grc-timer{color:#ff3b30!important;font:600 13px/1 monospace!important;min-width:44px!important}
    .grc-stop-bar {
      position:fixed!important;top:12px!important;left:50%!important;
      transform:translateX(-50%)!important;
      background:rgba(0,0,0,0.85)!important;border-radius:20px!important;
      padding:6px 16px!important;display:none!important;
      align-items:center!important;gap:10px!important;
      z-index:2147483647!important;box-shadow:0 4px 20px rgba(0,0,0,0.4)!important;
    }
    .grc-stop-bar.grc-on{display:flex!important}
    .grc-saving {
      position:fixed!important;top:16px!important;right:16px!important;
      display:none!important;align-items:center!important;gap:10px!important;
      background:rgba(0,0,0,0.85)!important;color:#fff!important;
      border-radius:20px!important;padding:8px 16px!important;
      font:600 13px/1 -apple-system,system-ui,sans-serif!important;
      z-index:2147483647!important;box-shadow:0 4px 20px rgba(0,0,0,0.4)!important;
      pointer-events:none!important;
    }
    .grc-saving.grc-on{display:flex!important}
    .grc-spin {
      width:12px!important;height:12px!important;border-radius:50%!important;
      border:2px solid rgba(255,255,255,0.25)!important;border-top-color:#fff!important;
      animation:grc-spin .7s linear infinite!important;
    }
    @keyframes grc-spin{to{transform:rotate(360deg)}}
  `;
  document.documentElement.appendChild(styleEl);

  // ── Build UI ──

  const overlay = mk('div', 'grc-overlay');
  const selBox = mk('div', 'grc-sel');
  const recFrame = mk('div', 'grc-frame');
  const fakeCursor = mk('div', 'grc-cursor');
  const hint = mk('div', 'grc-hint', 'Click and drag to select area');

  // REC / Cancel panel
  const sizeLabel = mk('span', 'grc-sz');
  const btnRec = mk('button', 'grc-btn grc-btn-rec');
  btnRec.innerHTML = '<span class="grc-dot"></span>REC';
  const btnCancel = mk('button', 'grc-btn grc-btn-x', 'Cancel');
  const recPanel = mk('div', 'grc-panel');
  recPanel.append(sizeLabel, btnRec, btnCancel);

  // STOP bar
  const timer = mk('span', 'grc-timer', '00:00');
  const btnStop = mk('button', 'grc-btn grc-btn-stop');
  btnStop.innerHTML = '<span class="grc-sq"></span>STOP';
  const stopBar = mk('div', 'grc-stop-bar');
  stopBar.append(btnStop, timer);

  // Saving badge (encoding a long capture takes a while)
  const savingText = mk('span', null, 'Saving GIF...');
  const savingBadge = mk('div', 'grc-saving');
  savingBadge.append(mk('span', 'grc-spin'), savingText);

  // Mount into fullscreen element if active, otherwise documentElement
  const mount = document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
  mount.append(overlay, selBox, hint, recPanel, stopBar, savingBadge);

  // ── Drag selection ──

  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (state !== 'selecting' && state !== 'selected') return;
    e.preventDefault();
    e.stopPropagation();

    state = 'selecting';
    recPanel.classList.remove('grc-on');
    dragStart = { x: e.clientX, y: e.clientY };

    selBox.style.left = e.clientX + 'px';
    selBox.style.top = e.clientY + 'px';
    selBox.style.width = '0px';
    selBox.style.height = '0px';
    selBox.classList.add('grc-on');

    document.addEventListener('mousemove', onDrag, true);
    document.addEventListener('mouseup', onDragEnd, true);
  });

  function onDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    selBox.style.left = x + 'px';
    selBox.style.top = y + 'px';
    selBox.style.width = Math.abs(e.clientX - dragStart.x) + 'px';
    selBox.style.height = Math.abs(e.clientY - dragStart.y) + 'px';
  }

  function onDragEnd(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    document.removeEventListener('mousemove', onDrag, true);
    document.removeEventListener('mouseup', onDragEnd, true);

    // Block the click event that fires after mouseup (would hit the video player)
    document.addEventListener('click', blockClick, true);
    setTimeout(() => document.removeEventListener('click', blockClick, true), 50);

    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);

    if (w < 20 || h < 20) {
      selBox.classList.remove('grc-on');
      return;
    }

    selection = { x, y, w, h };
    state = 'selected';
    hint.style.display = 'none';

    sizeLabel.textContent = w + ' x ' + h +
      (stopBarTop(selection) === null ? '  ·  stop via toolbar icon' : '');
    const panelTop = y + h + 10;
    recPanel.style.left = x + 'px';
    recPanel.style.top = (panelTop + 50 > window.innerHeight ? y - 46 : panelTop) + 'px';
    recPanel.classList.add('grc-on');
  }

  // ── Button handlers ──

  // Block pointer/mouse events from leaking through to the page (e.g. pausing video)
  // Don't block 'click' in capture — let it reach our buttons normally
  [recPanel, stopBar].forEach(panel => {
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'touchstart', 'touchend']
      .forEach(evt => panel.addEventListener(evt, blockClick));
  });

  btnRec.addEventListener('click', (e) => {
    blockClick(e);
    if (state !== 'selected') return;
    startRecording();
  });

  btnCancel.addEventListener('click', (e) => {
    blockClick(e);
    cleanup();
  });

  btnStop.addEventListener('click', (e) => {
    blockClick(e);
    if (state !== 'recording') return;
    stopRecording();
  });

  // ── Recording ──

  let timerInterval = null;

  async function startRecording() {
    state = 'recording';
    frames = [];

    // Remove ALL selection UI from DOM so tabCapture doesn't see it
    overlay.remove();
    selBox.remove();
    hint.remove();
    recPanel.remove();

    // Visible frame traces the selection from just outside it
    recFrame.style.left = selection.x + 'px';
    recFrame.style.top = selection.y + 'px';
    recFrame.style.width = selection.w + 'px';
    recFrame.style.height = selection.h + 'px';
    mount.appendChild(recFrame);
    recFrame.classList.add('grc-on');

    // Tab capture paints the page's CSS cursor into the stream. Toggling it at
    // the rect's edge always loses a frame or two to the pointer, so the real
    // cursor stays hidden for the whole recording and we draw a stand-in that
    // vanishes the moment its own pixels would touch the recorded rect.
    const cursorStyle = document.createElement('style');
    cursorStyle.id = 'grc-hide-cursor';
    cursorStyle.textContent = '*, *::before, *::after { cursor: none !important; }';
    document.documentElement.appendChild(cursorStyle);
    mount.appendChild(fakeCursor);

    const PAD = 4; // keeps the stand-in clear of the crop edge
    cursorWatch = (e) => {
      if (!selection) return;
      fakeCursor.style.left = e.clientX + 'px';
      fakeCursor.style.top = e.clientY + 'px';
      const overlaps =
        e.clientX < selection.x + selection.w + PAD && e.clientX + 20 > selection.x - PAD &&
        e.clientY < selection.y + selection.h + PAD && e.clientY + 28 > selection.y - PAD;
      fakeCursor.classList.toggle('grc-on', !overlaps);
    };
    document.addEventListener('mousemove', cursorWatch, true);

    // The stop bar is inside the captured tab, so it may only live outside the
    // crop rect. No room = no bar; toolbar icon and right-click still stop.
    const barTop = stopBarTop(selection);
    if (barTop !== null) {
      stopBar.style.setProperty('top', barTop + 'px', 'important'); // beats the sheet's !important
      stopBar.classList.add('grc-on');
    }
    timer.textContent = '00:00';

    const startTime = Date.now();
    timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000);
      timer.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 500);

    // Request tabCapture stream
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'request-stream' }, resolve);
    });

    if (!response || response.error) {
      console.error('Stream error:', response?.error);
      stopBar.classList.remove('grc-on');
      cleanup();
      return;
    }

    try {
      // Cap at the viewport's own device pixels: same aspect ratio as the
      // viewport means Chrome scales uniformly and never letterboxes, so
      // video pixels map to CSS pixels by a single known factor.
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: response.streamId,
            maxWidth: Math.round(window.innerWidth * devicePixelRatio),
            maxHeight: Math.round(window.innerHeight * devicePixelRatio)
          }
        }
      });
    } catch (err) {
      console.error('getUserMedia failed:', err);
      stopBar.classList.remove('grc-on');
      cleanup();
      return;
    }

    videoEl = document.createElement('video');
    videoEl.srcObject = mediaStream;
    videoEl.muted = true;

    await new Promise(resolve => {
      videoEl.onloadedmetadata = () => videoEl.play().then(resolve);
    });

    // The stream is the whole viewport; crop the selection out of it.
    const scaleX = videoEl.videoWidth / window.innerWidth;
    const scaleY = videoEl.videoHeight / window.innerHeight;
    console.log('[gif-recorder] stream', videoEl.videoWidth + 'x' + videoEl.videoHeight,
      'viewport', window.innerWidth + 'x' + window.innerHeight,
      'scale', scaleX.toFixed(4), scaleY.toFixed(4));
    if (Math.abs(scaleX - scaleY) > 0.01) {
      console.warn('[gif-recorder] stream is letterboxed — crop will be off', scaleX, scaleY);
    }

    // Round the edges, not the size: rounding x and w apart can push the right
    // edge a pixel past the selection and pull the frame's outline into shot.
    const srcX = Math.round(selection.x * scaleX);
    const srcY = Math.round(selection.y * scaleY);
    const srcW = Math.round((selection.x + selection.w) * scaleX) - srcX;
    const srcH = Math.round((selection.y + selection.h) * scaleY) - srcY;

    // Output size (cap at 1200px wide)
    const maxDim = 1200;
    const downscale = srcW > maxDim ? maxDim / srcW : 1;
    const w = Math.round(srcW * downscale);
    const h = Math.round(srcH * downscale);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w;
    cropCanvas.height = h;
    const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });

    const maxFrames = MAX_SECONDS * TARGET_FPS;

    captureTimer = setInterval(() => {
      if (state !== 'recording') return;

      ctx.drawImage(videoEl, srcX, srcY, srcW, srcH, 0, 0, w, h);
      frames.push({ imageData: ctx.getImageData(0, 0, w, h), time: Date.now() });
      if (frames.length >= maxFrames) stopRecording();
    }, 1000 / TARGET_FPS);
  }

  function stopRecording() {
    if (state !== 'recording') return;
    state = 'encoding';

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    videoEl = null;

    chrome.runtime.sendMessage({ type: 'stop-recording' });
    stopBar.classList.remove('grc-on');
    restoreCursor();

    if (frames.length === 0) { cleanup(); return; }

    // Remove all UI but the saving badge
    [overlay, selBox, recFrame, fakeCursor, hint, recPanel, stopBar].forEach(el => { try { el.remove(); } catch (_) {} });
    savingText.textContent = 'Saving GIF...';
    savingBadge.classList.add('grc-on');

    setTimeout(encodeGIF, 50);
  }

  // ── GIF Encoding ──

  async function encodeGIF() {
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    const w = frames[0].imageData.width;
    const h = frames[0].imageData.height;
    const gif = GIFEncoder();

    for (let i = 0; i < frames.length; i++) {
      const rgba = frames[i].imageData.data;
      let delayMs = 100;
      if (i < frames.length - 1) delayMs = frames[i + 1].time - frames[i].time;
      delayMs = Math.max(20, Math.min(delayMs, 1000));

      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, w, h, { palette, delay: delayMs, dispose: 0 });

      // Yield periodically to keep page responsive, and report progress
      if (i % 5 === 0) {
        savingText.textContent = 'Saving GIF... ' + Math.round((i + 1) / frames.length * 100) + '%';
        await new Promise(r => setTimeout(r, 0));
      }
    }

    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });

    // Download directly via blob URL (avoids 64MB messaging limit)
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const fn = 'recording_' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + '_' + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds()) + '.gif';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fn;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    chrome.runtime.sendMessage({ type: 'encoding-done' });
    cleanup();
  }

  // ── Messages ──

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'stop-recording' && state === 'recording') stopRecording();
  });

  // ── Utils ──

  function restoreCursor() {
    if (cursorWatch) { document.removeEventListener('mousemove', cursorWatch, true); cursorWatch = null; }
    fakeCursor.remove();
    const cs = document.getElementById('grc-hide-cursor');
    if (cs) cs.remove();
  }

  function blockClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // Top offset for the stop bar in a free horizontal band, or null if the
  // selection leaves no room for it outside the crop rect.
  function stopBarTop(sel) {
    const BAR = 40, GAP = 12;
    if (window.innerHeight - (sel.y + sel.h) >= BAR + GAP) return sel.y + sel.h + GAP;
    if (sel.y >= BAR + GAP) return sel.y - BAR - GAP;
    return null;
  }

  function mk(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  }

  function cleanup() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    videoEl = null;
    restoreCursor();
    [overlay, selBox, recFrame, fakeCursor, hint, recPanel, stopBar, savingBadge, styleEl].forEach(el => {
      try { el.remove(); } catch (_) {}
    });
    frames = [];
    selection = null;
    state = 'selecting';
    window.__gifRecorderActive = false;
    chrome.runtime.sendMessage({ type: 'capture-cancelled' });
  }
})();
