/* ========================= STATE, HISTORY, RENDER, VIEW ========================= */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
/* index.test.html shares an origin with index.html once published (and Chrome gives every local
   file one origin), so the test build keeps its autosave, presets and settings under their own
   keys: a test build can never touch production data */
var TESTBUILD = /\.test\.html$/.test(location.pathname);
var KP = TESTBUILD ? 'test:' : '';
var LS_AUTO = KP + 'vmixPipBuilder.autosave.v1', LS_PRESETS = KP + 'vmixPipBuilder.stylePresets.v1', LS_UI = KP + 'vmixPipBuilder.ui.v1';
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var fmt = PIPE.fmt;

// ---------------- state ----------------
var doc = PIPE.newDoc(1920, 1080);
var sel = [];               // selected object ids
var tool = 'select';
var tab = 'object';
var ui = { view: 'combined', bg: 'checker', snap: true, grid: 1, showGrid: false, guides: true, safe: 'off', sources: true, sampleInSlots: false, lockAspect: true, secs: {} };
var session = { pass: '' };  // never saved
var sampleImg = null, camStream = null;
var linkRadii = true;
var cropId = null;          // slot being cropped on the canvas, or null

function objById(id) { for (var i = 0; i < doc.objects.length; i++) if (doc.objects[i].id === id) return doc.objects[i]; return null; }
function selObjs() { return sel.map(objById).filter(Boolean); }
function firstSel() { return selObjs()[0] || null; }

// ---------------- toast ----------------
var toastT;
function toast(msg, isErr, ms) {
  var t = $('#toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, ms || (isErr ? 6000 : 2600));
}

// ---------------- history + autosave ----------------
var hist = { stack: [], idx: -1, max: 120 };
var saveT = null, lastSaved = null;
function commit() {
  var s = JSON.stringify(doc);
  if (hist.idx >= 0 && hist.stack[hist.idx] === s) return;
  hist.stack = hist.stack.slice(0, hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > hist.max) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  scheduleAutosave();
  updateUndoButtons();
  requestRender(false);
  refreshComputed();
}
function restore(s) {
  doc = PIPE.migrate(JSON.parse(s));
  sel = sel.filter(function (id) { return objById(id); });
  buildAll();
  scheduleAutosave();
  requestRender(false);
}
function undo() { if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
function updateUndoButtons() {
  $('#undoBtn').disabled = hist.idx <= 0; $('#redoBtn').disabled = hist.idx >= hist.stack.length - 1;
  $('#undoBtn').title = 'Undo (Ctrl+Z) · ' + hist.idx + ' step' + (hist.idx === 1 ? '' : 's') + ' available';
}
function scheduleAutosave() {
  clearTimeout(saveT);
  saveT = setTimeout(function () {
    if (lsSet(LS_AUTO, JSON.stringify(doc))) { lastSaved = new Date(); $('#stSave').innerHTML = 'Autosaved <b>' + lastSaved.toLocaleTimeString() + '</b>'; }
    else $('#stSave').innerHTML = '<span class="err">Autosave unavailable (browser storage blocked). Save the JSON.</span>';
  }, 400);
}
function saveUi() { lsSet(LS_UI, JSON.stringify(ui)); }

// ---------------- render manager ----------------
var R = { worker: null, busy: false, dirty: false, interactive: false, idleT: null, back: null, front: null, scale: 1, W: 0, H: 0, ms: 0, warnings: [], seq: 0, jobs: {} };
function engineSource() { return $('#engine-src').textContent; }
function workerSource() {
  return engineSource() + '\n;(' + function () {
    self.onmessage = function (e) {
      var m = e.data;
      try {
        if (m.type === 'render') {
          var r = PIPE.render(m.doc, m.opt), tr = [], out = { id: m.id, type: 'render', W: r.W, H: r.H, scale: r.scale, ms: r.ms, warnings: r.warnings };
          if (r.back) { out.back = r.back.buffer; tr.push(out.back); }
          if (r.front) { out.front = r.front.buffer; tr.push(out.front); }
          self.postMessage(out, tr);
        } else if (m.type === 'export') {
          var t0 = Date.now(), rr = PIPE.render(m.doc, m.opt);
          Promise.all([PIPE.encodePNG(rr.back, rr.W, rr.H), PIPE.encodePNG(rr.front, rr.W, rr.H)]).then(function (pngs) {
            var o = { id: m.id, type: 'export', W: rr.W, H: rr.H, backPng: pngs[0].buffer, frontPng: pngs[1].buffer, back: rr.back.buffer, front: rr.front.buffer, warnings: rr.warnings, ms: Date.now() - t0 };
            self.postMessage(o, [o.backPng, o.frontPng, o.back, o.front]);
          }).catch(function (err) { self.postMessage({ id: m.id, type: 'error', error: String(err && err.message || err) }); });
        } else if (m.type === 'png') {
          PIPE.encodePNG(new Uint8ClampedArray(m.px), m.W, m.H).then(function (p) { self.postMessage({ id: m.id, type: 'png', png: p.buffer }, [p.buffer]); });
        }
      } catch (err) { self.postMessage({ id: m.id, type: 'error', error: String(err && err.message || err) }); }
    };
  }.toString() + ')();';
}
function initWorker() {
  try {
    var url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    R.worker = new Worker(url);
    R.worker.onmessage = onWorkerMsg;
    R.worker.onerror = function (e) { console.warn('Render worker failed, using main thread', e); R.worker = null; R.busy = false; pump(); };
  } catch (e) { R.worker = null; console.warn('No worker, rendering on main thread', e); }
}
// Run a job in the worker (or inline). Returns a promise.
function job(msg, transfer) {
  return new Promise(function (resolve, reject) {
    var id = ++R.seq; msg.id = id;
    if (R.worker) { R.jobs[id] = { resolve: resolve, reject: reject }; R.worker.postMessage(msg, transfer || []); return; }
    setTimeout(function () {
      try {
        if (msg.type === 'render') { var r = PIPE.render(msg.doc, msg.opt); resolve({ type: 'render', W: r.W, H: r.H, scale: r.scale, ms: r.ms, warnings: r.warnings, back: r.back && r.back.buffer, front: r.front && r.front.buffer }); }
        else if (msg.type === 'export') {
          var t0 = Date.now(), rr = PIPE.render(msg.doc, msg.opt);
          Promise.all([PIPE.encodePNG(rr.back, rr.W, rr.H), PIPE.encodePNG(rr.front, rr.W, rr.H)]).then(function (p) {
            resolve({ type: 'export', W: rr.W, H: rr.H, backPng: p[0].buffer, frontPng: p[1].buffer, back: rr.back.buffer, front: rr.front.buffer, warnings: rr.warnings, ms: Date.now() - t0 });
          }, reject);
        } else if (msg.type === 'png') { PIPE.encodePNG(new Uint8ClampedArray(msg.px), msg.W, msg.H).then(function (p) { resolve({ png: p.buffer }); }, reject); }
      } catch (e) { reject(e); }
    }, 0);
  });
}
function onWorkerMsg(e) {
  var m = e.data, j = R.jobs[m.id];
  if (!j) return;
  delete R.jobs[m.id];
  if (m.type === 'error') j.reject(new Error(m.error)); else j.resolve(m);
}
function idleScale() {
  var z = view.zoom * (window.devicePixelRatio || 1);
  return z >= 0.75 ? 1 : z >= 0.375 ? 0.5 : 0.25;
}
function interactiveScale() {
  var s = Math.min(1, 1100 / Math.max(doc.canvas.w, doc.canvas.h));
  return Math.min(s, idleScale());
}
function requestRender(interactive) {
  R.dirty = true; R.interactive = !!interactive;
  clearTimeout(R.idleT);
  if (interactive) R.idleT = setTimeout(function () { requestRender(false); }, 220);
  pump();
}
function pump() {
  if (R.busy || !R.dirty) return;
  R.dirty = false; R.busy = true;
  var scale = R.interactive ? interactiveScale() : idleScale();
  var snapshot = JSON.parse(JSON.stringify(doc));
  job({ type: 'render', doc: snapshot, opt: { scale: scale, dither: doc.exportOpts.dither, edgePad: false } }).then(function (m) {
    return Promise.all([toBitmap(m.back, m.W, m.H), toBitmap(m.front, m.W, m.H)]).then(function (bm) {
      R.back = bm[0]; R.front = bm[1]; R.scale = m.scale; R.W = m.W; R.H = m.H; R.ms = m.ms; R.warnings = m.warnings || [];
      updateRenderStatus(); updateWarnings(); draw();
    });
  }).catch(function (err) { console.error(err); toast('Render failed: ' + err.message, true); })
    .then(function () { R.busy = false; pump(); });
}
function toBitmap(buf, W, H) {
  if (!buf) return Promise.resolve(null);
  var id = new ImageData(new Uint8ClampedArray(buf), W, H);
  if (window.createImageBitmap) return createImageBitmap(id);
  var c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(id, 0, 0); return Promise.resolve(c);
}
function updateRenderStatus() {
  var lbl = R.scale >= 1 ? 'full res' : (R.scale === 0.5 ? '½ res' : R.scale === 0.25 ? '¼ res' : Math.round(R.scale * 100) + '%');
  $('#stRender').innerHTML = 'Render <b>' + R.ms + ' ms</b> ' + lbl;
  $('#badge').textContent = R.W + '×' + R.H + ' render · ' + lbl;
}

// ---------------- view ----------------
var view = { zoom: 0.5, ox: 0, oy: 0, cw: 0, ch: 0 };
var cvs = $('#view'), ctx = cvs.getContext('2d');
function resizeCanvas() {
  var r = cvs.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  view.cw = r.width; view.ch = r.height;
  cvs.width = Math.round(r.width * dpr); cvs.height = Math.round(r.height * dpr);
  draw();
}
function fitView() {
  var pad = 40, z = Math.min((view.cw - pad * 2) / doc.canvas.w, (view.ch - pad * 2) / doc.canvas.h);
  view.zoom = Math.max(0.02, z);
  view.ox = (view.cw - doc.canvas.w * view.zoom) / 2; view.oy = (view.ch - doc.canvas.h * view.zoom) / 2;
  afterZoom();
}
function zoomAt(z, sx, sy) {
  z = PIPE.clamp(z, 0.02, 32);
  var cx = (sx - view.ox) / view.zoom, cy = (sy - view.oy) / view.zoom;
  view.zoom = z; view.ox = sx - cx * z; view.oy = sy - cy * z;
  afterZoom();
}
function afterZoom() {
  $('#stZoom').textContent = Math.round(view.zoom * 100) + '%';
  draw();
  var want = idleScale();
  if (want !== R.scale) requestRender(false);
}
function toCanvas(e) {
  var r = cvs.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.zoom, y: (e.clientY - r.top - view.oy) / view.zoom, sx: e.clientX - r.left, sy: e.clientY - r.top };
}

// ---------------- test cards for sources ----------------
var cardCache = {};
var CARD_COLORS = ['#2f6fb5', '#b5512f', '#3a9a5b', '#8a49b5', '#b59a2f', '#2f9fb5', '#b52f6c', '#5b6b7a', '#7aa12f', '#a1612f'];
function testCard(o, idx) {
  var A = PIPE.aspectOf(o.src), key = o.id + '|' + A.toFixed(4) + '|' + o.name + '|' + idx;
  if (cardCache[key]) return cardCache[key];
  var W = A >= 1 ? 960 : Math.round(960 * A), H = Math.round(W / A);
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var g = c.getContext('2d'), col = CARD_COLORS[idx % CARD_COLORS.length];
  var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, col); gr.addColorStop(1, '#111'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  for (var i = 1; i < 16; i++) { g.beginPath(); g.moveTo(W * i / 16 + 0.5, 0); g.lineTo(W * i / 16 + 0.5, H); g.stroke(); }
  for (var j = 1; j < 9; j++) { g.beginPath(); g.moveTo(0, H * j / 9 + 0.5); g.lineTo(W, H * j / 9 + 0.5); g.stroke(); }
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);
  g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.32, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
  g.beginPath(); g.moveTo(W / 2 - 20, H / 2); g.lineTo(W / 2 + 20, H / 2); g.moveTo(W / 2, H / 2 - 20); g.lineTo(W / 2, H / 2 + 20); g.stroke();
  // corner markers to check crop
  g.fillStyle = '#ffd400'; var m = Math.min(W, H) * 0.06; g.fillRect(0, 0, m, m); g.fillRect(W - m, 0, m, m); g.fillRect(0, H - m, m, m); g.fillRect(W - m, H - m, m, m);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 ' + Math.round(H * 0.11) + 'px system-ui, sans-serif'; g.fillText(o.name || 'Source', W / 2, H * 0.36);
  g.font = Math.round(H * 0.06) + 'px ui-monospace, monospace'; g.fillText((o.src.aspect === 'custom' ? o.src.cw + ':' + o.src.ch : o.src.aspect) + ' · ' + (o.src.mode || 'fill'), W / 2, H * 0.66);
  cardCache[key] = c;
  return c;
}
function camVideo() { var v = $('#camVideo'); return camStream && v.readyState >= 2 ? v : null; }
function sourceImageFor(o, idx) {
  if (ui.sampleInSlots) { var v = camVideo(); if (ui.bg === 'camera' && v) return v; if (sampleImg) return sampleImg; if (v) return v; }
  return testCard(o, idx);
}
function imgSize(im) { return im.videoWidth ? { w: im.videoWidth, h: im.videoHeight } : { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }; }
// Draw each slot's source exactly where the displayed vMix values put it. k = canvas px -> target px.
function drawSources(g, k) {
  var slots = PIPE.sortedSlots(doc).slice().sort(function (a, b) { return PIPE.layerOf(doc, a) - PIPE.layerOf(doc, b); });
  slots.forEach(function (o, i) {
    var vm = PIPE.vmixFor(doc, o), sx = doc.canvas.w / vm.outW, sy = doc.canvas.h / vm.outH;
    var im = sourceImageFor(o, PIPE.sortedSlots(doc).indexOf(o)), s = imgSize(im);
    if (!s.w || !s.h) return;
    var c = vm.crop;
    var vx = vm.visible.x * sx * k, vy = vm.visible.y * sy * k, vw = vm.visible.w * sx * k, vh = vm.visible.h * sy * k;
    if (vw <= 0 || vh <= 0) return;
    try { g.drawImage(im, c[0] * s.w, c[1] * s.h, (c[2] - c[0]) * s.w, (c[3] - c[1]) * s.h, vx, vy, vw, vh); } catch (e) { }
  });
}

// ---------------- drawing ----------------
var checkerPat = null;
function checker() {
  if (checkerPat) return checkerPat;
  var c = document.createElement('canvas'); c.width = c.height = 16;
  var g = c.getContext('2d'); g.fillStyle = '#2a2d33'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#3a3e46'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  checkerPat = ctx.createPattern(c, 'repeat'); return checkerPat;
}
var drag = null, hover = null, guidesNow = [];
var rafPending = false;
function draw() { if (!rafPending) { rafPending = true; requestAnimationFrame(drawNow); } }
function drawNow() {
  rafPending = false;
  var dpr = window.devicePixelRatio || 1, W = doc.canvas.w, H = doc.canvas.h, z = view.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0b0e'; ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // background
  var x0 = view.ox, y0 = view.oy, w = W * z, h = H * z;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  var bgImg = ui.bg === 'sample' ? sampleImg : ui.bg === 'camera' ? camVideo() : null;
  if (ui.bg === 'checker' || ((ui.bg === 'sample' || ui.bg === 'camera') && !bgImg)) { ctx.fillStyle = checker(); ctx.fillRect(x0, y0, w, h); }
  else if (ui.bg === 'dark') { ctx.fillStyle = '#1c1f26'; ctx.fillRect(x0, y0, w, h); }
  else if (ui.bg === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(x0, y0, w, h); }
  if (bgImg) { var s = imgSize(bgImg); ctx.fillStyle = '#000'; ctx.fillRect(x0, y0, w, h); drawCover(ctx, bgImg, s, x0, y0, w, h); }
  ctx.imageSmoothingEnabled = z * dpr < 2;
  ctx.imageSmoothingQuality = 'high';
  if (ui.view !== 'front' && R.back) ctx.drawImage(R.back, x0, y0, w, h);
  if (ui.view === 'combined' && ui.sources) {
    ctx.save(); ctx.translate(x0, y0); ctx.imageSmoothingEnabled = true; drawSources(ctx, z); ctx.restore();
  }
  if (ui.view !== 'back' && R.front) ctx.drawImage(R.front, x0, y0, w, h);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  // canvas edge
  ctx.strokeStyle = '#4a5160'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x0) - 0.5, Math.round(y0) - 0.5, Math.round(w) + 1, Math.round(h) + 1);
  drawOverlays(x0, y0, w, h, z);
  if (camStream) draw(); // keep live camera moving
}
function drawCover(g, im, s, x, y, w, h) {
  var k = Math.max(w / s.w, h / s.h), dw = s.w * k, dh = s.h * k;
  g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function drawOverlays(x0, y0, w, h, z) {
  var W = doc.canvas.w, H = doc.canvas.h;
  function X(v) { return x0 + v * z; } function Y(v) { return y0 + v * z; }
  ctx.save();
  // pixel / snap grid
  if (ui.showGrid) {
    var gs = Math.max(1, +ui.grid);
    var step = gs; while (step * z < 6) step *= 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = 0; gx <= W; gx += step) { var px = Math.round(X(gx)) + 0.5; ctx.moveTo(px, y0); ctx.lineTo(px, y0 + h); }
    for (var gy = 0; gy <= H; gy += step) { var py = Math.round(Y(gy)) + 0.5; ctx.moveTo(x0, py); ctx.lineTo(x0 + w, py); }
    ctx.stroke();
  }
  if (ui.safe !== 'off') {
    var pr = ui.safe === 'modern' ? [0.93, 0.90] : [0.90, 0.80];
    [['Action safe', pr[0], 'rgba(255,212,0,.65)'], ['Title safe', pr[1], 'rgba(0,220,255,.65)']].forEach(function (s) {
      var mw = W * (1 - s[1]) / 2, mh = H * (1 - s[1]) / 2;
      ctx.strokeStyle = s[2]; ctx.setLineDash([6, 4]); ctx.strokeRect(Math.round(X(mw)) + 0.5, Math.round(Y(mh)) + 0.5, Math.round(W * s[1] * z), Math.round(H * s[1] * z));
      ctx.setLineDash([]); ctx.fillStyle = s[2]; ctx.font = '10px system-ui'; ctx.fillText(s[0] + ' ' + Math.round(s[1] * 100) + '%', X(mw) + 4, Y(mh) + 12);
    });
  }
  if (ui.guides) {
    ctx.strokeStyle = 'rgba(255,80,200,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(Math.round(X(W / 2)) + 0.5, y0); ctx.lineTo(Math.round(X(W / 2)) + 0.5, y0 + h);
    ctx.moveTo(x0, Math.round(Y(H / 2)) + 0.5); ctx.lineTo(x0 + w, Math.round(Y(H / 2)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  }
  // slot labels + outlines for hidden-in-view things
  doc.objects.forEach(function (o) {
    if (o.hidden) return;
    var isSel = sel.indexOf(o.id) >= 0;
    if (o.slot) {
      var lbl = (o.slotNum ? o.slotNum + ' ' : '') + (o.name || 'Slot') + '  L' + PIPE.layerOf(doc, o);
      ctx.font = '600 11px system-ui'; var tw = ctx.measureText(lbl).width;
      var lx = X(o.x) + 6, ly = Y(o.y) + 6;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(lx, ly, tw + 10, 17);
      ctx.fillStyle = '#cfe3ff'; ctx.fillText(lbl, lx + 5, ly + 12.5);
    }
    if (hover === o.id && !isSel) { ctx.strokeStyle = 'rgba(61,155,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(X(o.x)) + 0.5, Math.round(Y(o.y)) + 0.5, Math.round(o.w * z), Math.round(o.h * z)); }
  });
  // crop mode: the whole source picture, faint outside the slot, with its outline
  var co = cropSlot();
  if (co) {
    var P = sourceRect(co), im = sourceImageFor(co, PIPE.sortedSlots(doc).indexOf(co));
    ctx.save(); ctx.beginPath(); ctx.rect(X(P.x), Y(P.y), P.w * z, P.h * z); ctx.rect(X(co.x), Y(co.y), co.w * z, co.h * z); ctx.clip('evenodd');
    ctx.globalAlpha = 0.35; try { ctx.drawImage(im, X(P.x), Y(P.y), P.w * z, P.h * z); } catch (e) { }
    ctx.restore();
    ctx.strokeStyle = '#ffb020'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.strokeRect(Math.round(X(P.x)) + 0.5, Math.round(Y(P.y)) + 0.5, Math.round(P.w * z), Math.round(P.h * z)); ctx.setLineDash([]);
  }
  // selection
  var so = selObjs();
  so.forEach(function (o) {
    ctx.strokeStyle = o.locked ? '#f0b43c' : '#3d9bff'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(X(o.x)) + 0.5, Math.round(Y(o.y)) + 0.5, Math.round(o.w * z), Math.round(o.h * z));
  });
  if (so.length === 1 && !so[0].locked) {
    handlesOf(so[0]).forEach(function (hd) {
      if (co) { // crop handles: thick orange bars along the edge
        ctx.fillStyle = '#ffb020'; var hz = hd.n.length === 2, bw = hz ? 14 : (hd.n === 'n' || hd.n === 's' ? 22 : 5), bh = hz ? 14 : (hd.n === 'n' || hd.n === 's' ? 5 : 22);
        if (hz) { var dx = hd.n.indexOf('w') >= 0 ? 1 : -1, dy = hd.n.indexOf('n') >= 0 ? 1 : -1; ctx.fillRect(X(hd.x) - (dx < 0 ? 14 : 0) - (dx > 0 ? 2 : -2), Y(hd.y) - (dy > 0 ? 2 : 3), 14, 5); ctx.fillRect(X(hd.x) - (dx > 0 ? 2 : 3), Y(hd.y) - (dy < 0 ? 14 : 0) - (dy > 0 ? 2 : -2), 5, 14); }
        else ctx.fillRect(X(hd.x) - bw / 2, Y(hd.y) - bh / 2, bw, bh);
        return;
      }
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3d9bff';
      ctx.fillRect(X(hd.x) - 4, Y(hd.y) - 4, 8, 8); ctx.strokeRect(X(hd.x) - 4 + 0.5, Y(hd.y) - 4 + 0.5, 7, 7);
    });
    var o = so[0], dl = (co ? 'CROP  ' : '') + Math.round(o.w) + ' × ' + Math.round(o.h) + '  @ ' + fmt(o.x, 1) + ', ' + fmt(o.y, 1);
    ctx.font = '11px ui-monospace,monospace'; var dw = ctx.measureText(dl).width;
    ctx.fillStyle = co ? '#c77d00' : '#3d9bff'; ctx.fillRect(X(o.x), Y(o.y + o.h) + 6, dw + 10, 16);
    ctx.fillStyle = '#fff'; ctx.fillText(dl, X(o.x) + 5, Y(o.y + o.h) + 18);
  } else if (so.length > 1) {
    var bb = bboxOf(so); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#9cc8ff';
    ctx.strokeRect(Math.round(X(bb.x)) + 0.5, Math.round(Y(bb.y)) + 0.5, Math.round(bb.w * z), Math.round(bb.h * z)); ctx.setLineDash([]);
  }
  // snapping guides
  ctx.strokeStyle = '#ff3fb4'; ctx.lineWidth = 1;
  guidesNow.forEach(function (gd) {
    ctx.beginPath();
    if (gd.axis === 'x') { var gxp = Math.round(X(gd.v)) + 0.5; ctx.moveTo(gxp, y0 - 20); ctx.lineTo(gxp, y0 + h + 20); }
    else { var gyp = Math.round(Y(gd.v)) + 0.5; ctx.moveTo(x0 - 20, gyp); ctx.lineTo(x0 + w + 20, gyp); }
    ctx.stroke();
  });
  if (drag && drag.kind === 'marquee') {
    var mx = Math.min(drag.x0, drag.x1), my = Math.min(drag.y0, drag.y1);
    ctx.fillStyle = 'rgba(61,155,255,.12)'; ctx.strokeStyle = '#3d9bff';
    ctx.fillRect(X(mx), Y(my), Math.abs(drag.x1 - drag.x0) * z, Math.abs(drag.y1 - drag.y0) * z);
    ctx.strokeRect(X(mx) + 0.5, Y(my) + 0.5, Math.abs(drag.x1 - drag.x0) * z, Math.abs(drag.y1 - drag.y0) * z);
  }
  ctx.restore();
}
function bboxOf(list) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  list.forEach(function (o) { x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h); });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function handlesOf(o) {
  var xs = [o.x, o.x + o.w / 2, o.x + o.w], ys = [o.y, o.y + o.h / 2, o.y + o.h], out = [];
  var names = [['nw', 'n', 'ne'], ['w', '', 'e'], ['sw', 's', 'se']];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) if (names[r][c]) out.push({ n: names[r][c], x: xs[c], y: ys[r] });
  return out;
}
