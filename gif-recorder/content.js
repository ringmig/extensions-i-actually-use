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

  // ── Styles ──

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .grc-overlay {
      position:fixed!important;inset:0!important;
      cursor:crosshair!important;z-index:2147483646!important;
      background:rgba(0,0,0,0.3)!important;
      margin:0!important;padding:0!important;border:none!important;
    }
    .grc-sel {
      position:fixed!important;border:2px dashed #fff!important;
      box-shadow:0 0 0 9999px rgba(0,0,0,0.5)!important;
      pointer-events:none!important;z-index:2147483647!important;
      display:none!important;background:transparent!important;
    }
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
    .grc-enc {
      position:fixed!important;inset:0!important;
      background:rgba(0,0,0,0.7)!important;display:none!important;
      align-items:center!important;justify-content:center!important;
      z-index:2147483647!important;
    }
    .grc-enc.grc-on{display:flex!important}
    .grc-enc-box {
      background:#1a1a1a!important;border-radius:12px!important;
      padding:28px 36px!important;color:#fff!important;text-align:center!important;
      font:14px/1.6 -apple-system,system-ui,sans-serif!important;
    }
    .grc-bar{width:220px!important;height:6px!important;background:rgba(255,255,255,0.1)!important;border-radius:3px!important;margin-top:14px!important;overflow:hidden!important}
    .grc-fill{height:100%!important;background:#fff!important;border-radius:3px!important;width:0%!important;transition:width .1s!important}
  `;
  document.documentElement.appendChild(styleEl);

  // ── Build UI ──

  const overlay = mk('div', 'grc-overlay');
  const selBox = mk('div', 'grc-sel');
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

  // Encoding overlay
  const progFill = mk('div', 'grc-fill');
  const progBar = mk('div', 'grc-bar');
  progBar.appendChild(progFill);
  const progText = mk('div');
  progText.style.cssText = 'color:rgba(255,255,255,0.5)!important;font-size:12px!important;margin-top:8px!important';
  const encBox = mk('div', 'grc-enc-box');
  encBox.innerHTML = '<div>Encoding GIF...</div>';
  encBox.append(progBar, progText);
  const encOverlay = mk('div', 'grc-enc');
  encOverlay.appendChild(encBox);

  // Mount into fullscreen element if active, otherwise documentElement
  const mount = document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
  mount.append(overlay, selBox, hint, recPanel, stopBar, encOverlay);

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

    sizeLabel.textContent = w + ' x ' + h;
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

    // Hide cursor on entire page during recording
    const cursorStyle = document.createElement('style');
    cursorStyle.id = 'grc-hide-cursor';
    cursorStyle.textContent = '* { cursor: none !important; }';
    document.documentElement.appendChild(cursorStyle);

    stopBar.classList.add('grc-on');
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
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: response.streamId
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

    const streamScaleX = videoEl.videoWidth / window.innerWidth;
    const streamScaleY = videoEl.videoHeight / window.innerHeight;

    // Source rectangle in video coords (full stream resolution)
    const srcX = Math.round(selection.x * streamScaleX);
    const srcY = Math.round(selection.y * streamScaleY);
    const srcW = Math.round(selection.w * streamScaleX);
    const srcH = Math.round(selection.h * streamScaleY);

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

      // Hide stop bar for clean capture, grab frame, show it back
      stopBar.style.visibility = 'hidden';
      ctx.drawImage(videoEl,
        srcX, srcY, srcW, srcH,
        0, 0, w, h
      );
      stopBar.style.visibility = '';

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

    if (frames.length === 0) { cleanup(); return; }

    // Remove all UI — encode silently
    [overlay, selBox, hint, recPanel, stopBar, encOverlay].forEach(el => { try { el.remove(); } catch (_) {} });

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

      // Yield periodically to keep page responsive
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
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

  function blockClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
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
    [overlay, selBox, hint, recPanel, stopBar, encOverlay, styleEl].forEach(el => {
      try { el.remove(); } catch (_) {}
    });
    const cs = document.getElementById('grc-hide-cursor');
    if (cs) cs.remove();
    frames = [];
    selection = null;
    state = 'selecting';
    window.__gifRecorderActive = false;
    chrome.runtime.sendMessage({ type: 'capture-cancelled' });
  }
})();
