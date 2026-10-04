/* ========================= TEMPLATES, FILES, EXPORT, SEND, INIT ========================= */
// ---------------- templates ----------------
// Designed on a 1920x1080 grid, then scaled to the canvas.
function bgObject() {
  var b = PIPE.newObject('rect', 0, 0, 1920, 1080, { name: 'Background', slot: false, locked: true });
  b.style.stroke.enabled = false; b.style.shadows = []; b.style.knockout = false;
  b.style.fill = { enabled: true, type: 'linear', color: '#141821', alpha: 1, angle: 160, cx: 50, cy: 50, size: 100, stops: [{ pos: 0, color: '#1c2333', alpha: 1 }, { pos: 100, color: '#090b10', alpha: 1 }] };
  return b;
}
function slotObj(n, name, x, y, w, h) { var o = PIPE.newObject('rrect', x, y, w, h, { name: name, slotNum: n }); return o; }
var TEMPLATES = [
  { id: 'pip', name: 'Single PIP corner', note: 'Overlay over program. Transparent surround: round the video with vMix layer border radius.', make: function () { return [slotObj(1, 'PIP', 1280, 692, 576, 324)]; } },
  { id: 'sbs', name: 'Side by side', make: function () { return [bgObject(), slotObj(1, 'Cam 1', 60, 293, 880, 495), slotObj(2, 'Cam 2', 980, 293, 880, 495)]; } },
  { id: 'quad', name: '2 × 2', make: function () { return [bgObject(), slotObj(1, 'Cam 1', 112, 56, 832, 468), slotObj(2, 'Cam 2', 976, 56, 832, 468), slotObj(3, 'Cam 3', 112, 556, 832, 468), slotObj(4, 'Cam 4', 976, 556, 832, 468)]; } },
  { id: 'three', name: '3 up', make: function () { return [bgObject(), slotObj(1, 'Cam 1', 48, 374, 592, 333), slotObj(2, 'Cam 2', 664, 374, 592, 333), slotObj(3, 'Cam 3', 1280, 374, 592, 333)]; } },
  { id: 'speaker', name: 'Speaker + slides', make: function () {
    var bar = PIPE.newObject('line', 1344, 497, 512, 6, { name: 'Accent bar', slot: false, caps: 'round' }); bar.style.fill.color = '#3d9bff'; bar.style.fill.alpha = 1;
    return [bgObject(), slotObj(1, 'Slides', 64, 189, 1248, 702), slotObj(2, 'Remote Speaker', 1344, 189, 512, 288), bar];
  } },
  { id: 'blank', name: 'Blank', make: function () { return []; } }
];
function scaleObj(o, k, ox, oy) {
  o.x = o.x * k + (ox || 0); o.y = o.y * k + (oy || 0); o.w *= k; o.h *= k;
  o.radii = o.radii.map(function (r) { return r * k; });
  var s = o.style; s.stroke.width *= k; s.feather *= k;
  s.shadows.concat(s.innerShadows).forEach(function (sh) { sh.x *= k; sh.y *= k; sh.blur *= k; sh.spread *= k; });
  s.glow.blur *= k; s.glow.spread *= k;
}
function roundObj(o) { ['x', 'y', 'w', 'h'].forEach(function (p) { o[p] = Math.round(o[p] * 100) / 100; }); }
function templateObjects(t) {
  var objs = t.make(), W = doc.canvas.w, H = doc.canvas.h, k = Math.min(W / 1920, H / 1080), ox = (W - 1920 * k) / 2, oy = (H - 1080 * k) / 2;
  objs.forEach(function (o) {
    if (o.name === 'Background') { o.w = W; o.h = H; o.x = 0; o.y = 0; scaleObj(o, 1); return; }
    scaleObj(o, k, ox, oy); if (ui.snap) { o.x = Math.round(o.x); o.y = Math.round(o.y); o.w = Math.round(o.w); o.h = Math.round(o.h); } roundObj(o);
  });
  return objs;
}
function loadTemplate(t) {
  doc.objects = templateObjects(t); sel = [];
  if (t.id === 'pip') doc.frontMask.surround = 'backplate';
  cardCache = {}; commit(); buildAll(); fitView();
  $('#tplDlg').close();
  toast(t.note || ('Loaded "' + t.name + '"'), false, t.note ? 7000 : 2600);
}
function openTemplates() {
  var g = $('#tplGrid'); g.innerHTML = '';
  TEMPLATES.forEach(function (t) {
    var card = document.createElement('div'); card.className = 'tcard';
    var c = document.createElement('canvas'); c.width = 320; c.height = 180;
    var x = c.getContext('2d'), k = 320 / 1920;
    x.fillStyle = '#000'; x.fillRect(0, 0, 320, 180);
    t.make().forEach(function (o) {
      if (o.name === 'Background') { x.fillStyle = '#1a2030'; x.fillRect(0, 0, 320, 180); return; }
      x.fillStyle = o.slot ? '#2f6fb5' : '#3d9bff'; x.strokeStyle = '#fff'; x.lineWidth = 1;
      x.beginPath(); if (x.roundRect) x.roundRect(o.x * k, o.y * k, o.w * k, o.h * k, Math.min(4, o.radii[0] * k)); else x.rect(o.x * k, o.y * k, o.w * k, o.h * k);
      x.fill(); if (o.slot) x.stroke();
    });
    card.appendChild(c); var d = document.createElement('div'); d.textContent = t.name; card.appendChild(d);
    card.addEventListener('click', function () { loadTemplate(t); });
    g.appendChild(card);
  });
  $('#tplDlg').showModal();
}
function openHelp() { $('#keyList').innerHTML = SHORTCUTS.map(function (s) { return '<kbd>' + esc(s[0]) + '</kbd><span>' + esc(s[1]) + '</span>'; }).join(''); $('#helpDlg').showModal(); }
$$('dialog [data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });

// ---------------- canvas size ----------------
function setCanvasSize(w, h, scaleObjs) {
  w = Math.round(PIPE.clamp(+w || 1920, 16, 8192)); h = Math.round(PIPE.clamp(+h || 1080, 16, 8192));
  var ow = doc.canvas.w, oh = doc.canvas.h;
  if (w === ow && h === oh) return;
  var same = Math.abs(w / h - ow / oh) < 0.001;
  if (scaleObjs && same) {
    var k = w / ow;
    doc.objects.forEach(function (o) { scaleObj(o, k); roundObj(o); });
    var hl = doc.frontMask.highlight; hl.width *= k; hl.blur *= k;
  }
  if (doc.vmix.outW === ow && doc.vmix.outH === oh) { doc.vmix.outW = w; doc.vmix.outH = h; }
  doc.canvas.w = w; doc.canvas.h = h;
  cardCache = {}; commit(); buildAll(); fitView();
  toast('Canvas ' + w + ' × ' + h + (scaleObjs && same ? ' (objects scaled ×' + fmt(k, 3) + ')' : ''));
}
function syncCanvasUi() {
  var key = doc.canvas.w + 'x' + doc.canvas.h, ps = $('#canvasPreset');
  ps.value = ['1920x1080', '3840x2160', '1280x720'].indexOf(key) >= 0 ? key : 'custom';
  $('#customWH').classList.toggle('hidden', ps.value !== 'custom');
  $('#cw').value = doc.canvas.w; $('#ch').value = doc.canvas.h;
  $('#dims').textContent = doc.canvas.w + ' × ' + doc.canvas.h + ' px';
  $('#stCanvas').textContent = doc.canvas.w + '×' + doc.canvas.h;
}
$('#canvasPreset').addEventListener('change', function (e) {
  var v = e.target.value;
  if (v === 'custom') { $('#customWH').classList.remove('hidden'); return; }
  var p = v.split('x'); setCanvasSize(+p[0], +p[1], true);
});
$('#applyWH').addEventListener('click', function () { setCanvasSize($('#cw').value, $('#ch').value, true); });

// ---------------- file IO ----------------
function download(name, data, mime) {
  var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}
function baseName() { return (doc.exportOpts.baseName || 'pip').replace(/[^\w\-. ]+/g, '_'); }
function projectJson() { var d = PIPE.clone(doc); d.vmix.pass = ''; d.savedAt = new Date().toISOString(); d.builder = PIPE.VERSION; return JSON.stringify(d, null, 2); }
function saveProject() { download(baseName() + '_project.json', projectJson(), 'application/json'); toast('Project saved'); }
function readFile(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); }); }
$('#fileOpen').addEventListener('change', function (e) {
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  readFile(f).then(function (t) {
    var d = JSON.parse(t);
    if (!d || !d.canvas || !Array.isArray(d.objects)) throw new Error('Not a PIP Builder project');
    doc = PIPE.migrate(d); sel = []; cardCache = {}; commit(); buildAll(); fitView(); toast('Opened ' + f.name);
  }).catch(function (err) { toast('Could not open: ' + err.message, true); });
});
$('#filePresets').addEventListener('change', function (e) {
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  readFile(f).then(function (t) {
    var d = JSON.parse(t), inc = Array.isArray(d) ? d : d.presets;
    if (!Array.isArray(inc)) throw new Error('No presets in file');
    var list = userPresets();
    inc.forEach(function (p) { if (p && p.name && p.style) { list = list.filter(function (x) { return x.name !== p.name; }); list.push({ name: p.name, style: p.style, corners: p.corners }); } });
    setUserPresets(list); buildTab(); toast('Imported ' + inc.length + ' preset(s)');
  }).catch(function (err) { toast('Could not import: ' + err.message, true); });
});
$('#fileSample').addEventListener('change', function (e) {
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  var im = new Image();
  im.onload = function () { sampleImg = im; ui.bg = 'sample'; $('#bgMode').value = 'sample'; draw(); toast('Sample frame ' + im.naturalWidth + '×' + im.naturalHeight + ' loaded'); };
  im.onerror = function () { toast('Could not load that image', true); };
  im.src = URL.createObjectURL(f);
});

// ---------------- export ----------------
var exporting = false;
function renderExport() {
  return job({ type: 'export', doc: PIPE.clone(doc), opt: { scale: 1, dither: doc.exportOpts.dither, edgePad: doc.exportOpts.edgePad } });
}
function guard(fn) {
  return function () {
    if (exporting) { toast('Export already running'); return Promise.resolve(); }
    exporting = true; toast('Rendering ' + doc.canvas.w + '×' + doc.canvas.h + ' at full quality…', false, 60000);
    return Promise.resolve().then(fn).catch(function (err) { console.error(err); toast('Export failed: ' + err.message, true); }).then(function () { exporting = false; });
  };
}
var exportPlane = function (which) {
  return guard(function () {
    return renderExport().then(function (m) {
      download(baseName() + (which === 'back' ? '_backplate.png' : '_frontmask.png'), new Uint8Array(which === 'back' ? m.backPng : m.frontPng), 'image/png');
      toast((which === 'back' ? 'Back plate' : 'Front mask') + ' exported · ' + m.W + '×' + m.H + ' · ' + m.ms + ' ms');
    });
  })();
};
// Flattened reference: background, back plate, sources at their vMix positions, front mask.
function composePreview(m) {
  var W = m.W, H = m.H, c = document.createElement('canvas'); c.width = W; c.height = H;
  var g = c.getContext('2d');
  var bgImg = ui.bg === 'sample' ? sampleImg : ui.bg === 'camera' ? camVideo() : null;
  g.fillStyle = ui.bg === 'dark' ? '#1c1f26' : '#000'; g.fillRect(0, 0, W, H);
  if (bgImg) drawCover(g, bgImg, imgSize(bgImg), 0, 0, W, H);
  return Promise.all([toBitmap(m.back, W, H), toBitmap(m.front, W, H)]).then(function (bm) {
    g.drawImage(bm[0], 0, 0);
    g.imageSmoothingQuality = 'high';
    drawSources(g, 1);
    g.drawImage(bm[1], 0, 0);
    var px = g.getImageData(0, 0, W, H).data;
    return job({ type: 'png', px: px.buffer, W: W, H: H }, [px.buffer]).then(function (r) { return new Uint8Array(r.png); });
  });
}
function exportPreviewOnly() {
  return guard(function () { return renderExport().then(composePreview).then(function (png) { download(baseName() + '_preview.png', png, 'image/png'); toast('Preview exported'); }); })();
}
function exportPack() {
  return guard(function () {
    return renderExport().then(function (m) {
      return composePreview(m).then(function (prev) {
        var aw = 1024, ah = 256;
        return PIPE.encodePNG(PIPE.alphaTest(aw, ah), aw, ah).then(function (alpha) {
          var b = baseName();
          var zip = PIPE.makeZip([
            { name: b + '_backplate.png', data: new Uint8Array(m.backPng) },
            { name: b + '_frontmask.png', data: new Uint8Array(m.frontPng) },
            { name: b + '_preview.png', data: prev },
            { name: b + '_project.json', data: projectJson() },
            { name: 'vMix_setup.txt', data: PIPE.setupText(doc) },
            { name: 'alpha_test.png', data: alpha }
          ]);
          download(b + '_pack.zip', zip, 'application/zip');
          toast('Export Pack saved · ' + m.W + '×' + m.H + ' · ' + (zip.length / 1048576).toFixed(1) + ' MB');
        });
      });
    });
  })();
}
$('#exportMenuBtn').addEventListener('click', function (e) {
  var m = $('#exportMenu'), r = e.target.getBoundingClientRect();
  m.style.left = Math.min(r.left, window.innerWidth - 240) + 'px'; m.style.top = (r.bottom + 4) + 'px'; m.classList.toggle('open'); e.stopPropagation();
});
document.addEventListener('click', function () { $('#exportMenu').classList.remove('open'); });
$('#exportMenu').addEventListener('click', function (e) {
  var b = e.target.closest('[data-exp]'); if (!b) return;
  var k = b.dataset.exp;
  if (k === 'back' || k === 'front') exportPlane(k);
  else if (k === 'preview') exportPreviewOnly();
  else if (k === 'pack') exportPack();
  else if (k === 'setup') download('vMix_setup.txt', PIPE.setupText(doc), 'text/plain');
  else if (k === 'alpha') PIPE.encodePNG(PIPE.alphaTest(1024, 256), 1024, 256).then(function (p) { download('alpha_test.png', p, 'image/png'); });
});
$('#packBtn').addEventListener('click', function () { exportPack(); });
$('#saveBtn').addEventListener('click', saveProject);
$('#openBtn').addEventListener('click', function () { $('#fileOpen').click(); });

// ---------------- send to vMix ----------------
function relayBase() { return (doc.vmix.relay || 'http://127.0.0.1:8089').replace(/\/+$/, ''); }
function sendCommands(cmds) {
  if (!cmds.length) return;
  if (doc.vmix.sendMode === 'relay') {
    return fetch(relayBase() + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: cmds.map(function (c) { return c.url; }), user: doc.vmix.user || '', pass: session.pass || '' }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var bad = (res.results || []).filter(function (x) { return !x.ok; });
        if (!bad.length) toast('vMix accepted all ' + cmds.length + ' commands');
        else toast(bad.length + ' of ' + cmds.length + ' failed. First: ' + bad[0].status + ' ' + (bad[0].error || bad[0].body || ''), true, 9000);
      })
      .catch(function (err) { toast('Relay not reachable at ' + relayBase() + ' (' + err.message + '). Start it with: node vmix-relay.js', true, 9000); });
  }
  var i = 0, failed = 0;
  function next() {
    if (i >= cmds.length) { toast(failed ? failed + ' of ' + cmds.length + ' could not be sent. Check host/port, or use the relay helper.' : 'Sent ' + cmds.length + ' commands. Direct mode cannot confirm; check vMix.', !!failed, 7000); return; }
    var c = cmds[i++];
    return fetch(c.url, { mode: 'no-cors', cache: 'no-store' }).catch(function () { failed++; }).then(function () { return new Promise(function (r) { setTimeout(r, 25); }); }).then(next);
  }
  return next();
}
function relayPing() {
  fetch(relayBase() + '/ping').then(function (r) { return r.json(); }).then(function (j) { toast('Relay OK (v' + j.version + '), forwarding to vMix'); })
    .catch(function (err) { toast('Relay not reachable at ' + relayBase() + '. Start it with: node vmix-relay.js', true, 8000); });
}
// Read vMix's XML state through the relay and compare the layer values.
function verifyReadBack() {
  var out = $('#verifyOut'); if (out) out.innerHTML = '<p class="note">Reading vMix state…</p>';
  fetch(relayBase() + '/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: doc.vmix.host, port: doc.vmix.port, user: doc.vmix.user || '', pass: session.pass || '' }) })
    .then(function (r) { if (!r.ok) throw new Error('relay ' + r.status); return r.text(); })
    .then(function (xml) {
      var x = new DOMParser().parseFromString(xml, 'text/xml'), inputs = Array.prototype.slice.call(x.getElementsByTagName('input'));
      var want = String(doc.vmix.input), inp = inputs.filter(function (n) { return n.getAttribute('title') === want || n.getAttribute('number') === want || n.getAttribute('key') === want || n.getAttribute('shortTitle') === want; })[0];
      if (!inp) throw new Error('input "' + want + '" not found in vMix (' + inputs.length + ' inputs)');
      var byKey = {}; inputs.forEach(function (n) { byKey[n.getAttribute('key')] = n.getAttribute('title'); });
      var ov = Array.prototype.slice.call(inp.getElementsByTagName('overlay'));
      var slots = PIPE.sortedSlots(doc), rows = [];
      ov.forEach(function (n) {
        var L = +n.getAttribute('index') + 1, a = {};
        [n].concat(Array.prototype.slice.call(n.getElementsByTagName('*'))).forEach(function (el) { for (var i = 0; i < el.attributes.length; i++) a[el.tagName + '.' + el.attributes[i].name] = el.attributes[i].value; });
        var s = slots.filter(function (o) { return PIPE.layerOf(doc, o) === L; })[0], cmp = '';
        if (s) {
          var vm = PIPE.vmixFor(doc, s), checks = [];
          function find(names) { for (var k in a) { var nm = k.split('.')[1]; if (names.indexOf(nm) >= 0) return +a[k]; } return null; }
          [['zoomX', vm.zoom], ['zoomY', vm.zoom], ['panX', vm.panX], ['panY', vm.panY], ['X1', vm.crop[0]], ['Y1', vm.crop[1]], ['X2', vm.crop[2]], ['Y2', vm.crop[3]]].forEach(function (c) {
            var got = find([c[0], c[0].toLowerCase(), 'crop' + c[0]]); if (got === null || isNaN(got)) return;
            checks.push((Math.abs(got - c[1]) < 0.0005 ? '✓ ' : '✗ ') + c[0] + ' ' + fmt(got, 4) + (Math.abs(got - c[1]) < 0.0005 ? '' : ' (want ' + fmt(c[1], 4) + ')'));
          });
          cmp = checks.length ? checks.join('  ') : 'no position values reported';
        }
        rows.push('<tr><td>L' + L + '</td><td style="text-align:left">' + esc(byKey[n.getAttribute('key')] || n.getAttribute('key')) + '</td><td style="text-align:left;white-space:normal">' + esc(cmp || Object.keys(a).map(function (k) { return k + '=' + a[k]; }).join(' ')) + '</td></tr>');
      });
      if (out) out.innerHTML = sec('Read back from vMix · ' + esc(want), rows.length ? '<table class="vt"><tr><th>Layer</th><th style="text-align:left">Source</th><th style="text-align:left">Values</th></tr>' + rows.join('') + '</table>' : '<p class="note">No layers reported on this input.</p>');
    })
    .catch(function (err) { if (out) out.innerHTML = '<div class="warnbox error">Read back failed: ' + esc(err.message) + '</div>'; });
}

// ---------------- top bar wiring ----------------
function setTool(t) { tool = t; $$('#tools [data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); }); cvs.style.cursor = t === 'select' ? 'default' : t === 'hand' ? 'grab' : 'crosshair'; }
function setView(v) { ui.view = v; $$('#viewSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); }); saveUi(); draw(); }
$$('#tools [data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
$$('#tools [data-align]').forEach(function (b) { b.addEventListener('click', function () { align(b.dataset.align); }); });
$('#tplBtn').addEventListener('click', openTemplates);
$('#dupBtn').addEventListener('click', function () { duplicate(20, 20); });
$('#delBtn').addEventListener('click', deleteSel);
$('#helpBtn').addEventListener('click', openHelp);
$('#upBtn').addEventListener('click', function () { reorder(1); });
$('#downBtn').addEventListener('click', function () { reorder(-1); });
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$$('#viewSeg button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
$$('#tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
$('#bgMode').addEventListener('change', function (e) {
  ui.bg = e.target.value; saveUi();
  if (ui.bg === 'sample' && !sampleImg) $('#fileSample').click();
  if (ui.bg === 'camera') startCamera(); else stopCamera();
  draw();
});
$('#loadSample').addEventListener('click', function () { $('#fileSample').click(); });
function startCamera() {
  if (camStream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Camera not available in this browser', true); return; }
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
    camStream = s; var v = $('#camVideo'); v.srcObject = s; v.play(); draw();
  }).catch(function (err) { toast('Camera blocked: ' + err.message, true); ui.bg = 'dark'; $('#bgMode').value = 'dark'; draw(); });
}
function stopCamera() { if (!camStream || ui.sampleInSlots) return; camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; $('#camVideo').srcObject = null; }
function bindToggle(id, key) { var el = $(id); el.checked = !!ui[key]; el.addEventListener('change', function () { ui[key] = el.checked; saveUi(); draw(); }); }
bindToggle('#snapOn', 'snap'); bindToggle('#showGrid', 'showGrid'); bindToggle('#showGuides', 'guides'); bindToggle('#showSources', 'sources'); bindToggle('#sampleInSlots', 'sampleInSlots');
$('#gridSize').addEventListener('change', function (e) { ui.grid = +e.target.value; saveUi(); draw(); });
$('#safeMode').addEventListener('change', function (e) { ui.safe = e.target.value; saveUi(); draw(); });

function buildAll() { syncCanvasUi(); buildObjList(); lastSelKey = '?'; selectionChanged(); updateUndoButtons(); draw(); }

// ---------------- init ----------------
(function init() {
  if (TESTBUILD) {
    document.title = 'TEST · ' + document.title;
    $('#top .brand').insertAdjacentHTML('afterend', '<span class="testtag" title="index.test.html: autosave, presets and settings are kept apart from production">TEST BUILD</span>');
  }
  try { var u = JSON.parse(lsGet(LS_UI) || 'null'); if (u) for (var k in u) ui[k] = u[k]; } catch (e) { }
  if (ui.bg === 'sample' || ui.bg === 'camera') ui.bg = 'checker';
  $('#bgMode').value = ui.bg; $('#gridSize').value = String(ui.grid); $('#safeMode').value = ui.safe;
  ['#snapOn', '#showGrid', '#showGuides', '#showSources', '#sampleInSlots'].forEach(function (id, i) { $(id).checked = !!ui[['snap', 'showGrid', 'guides', 'sources', 'sampleInSlots'][i]]; });
  var restored = false, auto = lsGet(LS_AUTO);
  if (auto) { try { doc = PIPE.migrate(JSON.parse(auto)); restored = true; } catch (e) { } }
  if (!restored) { doc = PIPE.newDoc(1920, 1080); doc.objects = templateObjects(TEMPLATES[1]); }
  initWorker();
  setTool('select'); setView(ui.view || 'combined'); setTab('object');
  commit(); buildAll();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas(); fitView();
  requestRender(false);
  if (restored) toast('Restored your last session from autosave');
  // test hooks (used by the automated checks; harmless otherwise)
  window.__pip = { testBuild: TESTBUILD, keys: { auto: LS_AUTO, presets: LS_PRESETS, ui: LS_UI }, get doc() { return doc; }, set doc(d) { doc = PIPE.migrate(d); commit(); buildAll(); }, sel: function (ids) { sel = ids; selectionChanged(); }, render: R, exportPack: exportPack, undo: undo, redo: redo, hist: hist, setCanvasSize: setCanvasSize, loadTemplate: function (i) { loadTemplate(TEMPLATES[i]); }, view: view };
})();
