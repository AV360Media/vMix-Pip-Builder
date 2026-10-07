/* ========================= FIELD BINDING, OBJECT LIST, SELECTION ========================= */
// ---------------- path helpers ----------------
function getPath(o, p) { var s = p.split('.'); for (var i = 0; i < s.length; i++) { if (o == null) return undefined; o = o[s[i]]; } return o; }
function setPath(o, p, v) {
  var s = p.split('.');
  for (var i = 0; i < s.length - 1; i++) { if (o == null || typeof o !== 'object') return false; o = o[s[i]]; }
  if (o == null || typeof o !== 'object') return false;
  o[s[s.length - 1]] = v; return true;
}

// ---------------- field builders ----------------
function attrs(path, o) {
  o = o || {};
  var a = ' data-b="' + path + '"' + (o.doc ? ' data-scope="doc"' : '');
  if (o.k) a += ' data-k="' + o.k + '"';
  if (o.rebuild) a += ' data-rebuild="1"';
  if (o.special) a += ' data-special="' + o.special + '"';
  if (o.numval) a += ' data-num="1"';
  if (o.title) a += ' title="' + esc(o.title) + '"';
  return a;
}
function fNum(label, path, o) {
  o = o || {};
  return '<div class="f"><label>' + label + '</label><input type="number"' + attrs(path, o) + ' step="' + (o.step || 1) + '"' + (o.min != null ? ' min="' + o.min + '"' : '') + (o.max != null ? ' max="' + o.max + '"' : '') + '></div>';
}
function fChk(label, path, o) { return '<label class="f inline"' + (o && o.title ? ' title="' + esc(o.title) + '"' : '') + '><input type="checkbox"' + attrs(path, o) + '>' + label + '</label>'; }
function fSel(label, path, opts, o) {
  return '<div class="f"><label>' + label + '</label><select' + attrs(path, o) + '>' + opts.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'; }).join('') + '</select></div>';
}
function fTxt(label, path, o) { o = o || {}; return '<div class="f"' + (o.span ? ' style="grid-column:span ' + o.span + '"' : '') + '><label>' + label + '</label><input type="' + (o.type || 'text') + '"' + attrs(path, o) + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' spellcheck="false"></div>'; }
function fColor(label, path, o) { return '<div class="f"><label>' + label + '</label><div class="colorf"><input type="color"' + attrs(path, o) + '><input type="text"' + attrs(path, o) + ' maxlength="7" spellcheck="false"></div></div>'; }
function sec(title, body, right) { return '<div class="sec"><div class="sh">' + title + (right ? '<span class="r">' + right + '</span>' : '') + '</div><div class="sb">' + body + '</div></div>'; }
// Collapsible section; open/closed is remembered per id. defOpen applies until the user toggles it.
function csec(id, title, body, defOpen, summary) {
  var open = ui.secs && id in ui.secs ? ui.secs[id] : defOpen;
  return '<details class="sec" data-sec="' + id + '"' + (open ? ' open' : '') + '><summary class="sh">' + title + (summary ? '<span class="sum">' + summary + '</span>' : '') + '</summary><div class="sb">' + body + '</div></details>';
}
function row(cls, inner) { return '<div class="row ' + (cls || '') + '">' + inner + '</div>'; }
function btn(label, act, extra) { return '<button data-act="' + act + '"' + (extra || '') + '>' + label + '</button>'; }

// ---------------- field sync ----------------
function modelFor(el) { return el.dataset.scope === 'doc' ? doc : firstSel(); }
function syncFields() {
  $$('#tabBody [data-b]').forEach(function (el) {
    if (el === document.activeElement && el.type !== 'checkbox') return;
    var m = modelFor(el); if (!m) return;
    var v = getPath(m, el.dataset.b);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'number') { if (v == null || v === '') { el.value = ''; return; } var k = +el.dataset.k || 1; el.value = fmt(v * k, 3); }
    else if (el.type === 'color') el.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
    else el.value = v == null ? '' : v;
    // mixed values across a multi-selection
    if (el.dataset.scope !== 'doc' && sel.length > 1 && el.type !== 'color') {
      var mixed = selObjs().some(function (o) { return JSON.stringify(getPath(o, el.dataset.b)) !== JSON.stringify(v); });
      if (mixed && el.type !== 'checkbox') { el.value = ''; el.placeholder = 'mixed'; }
      if (el.type === 'checkbox') el.indeterminate = mixed;
    }
  });
  updateSelStatus();
}
function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') { var v = parseFloat(el.value); if (!isFinite(v)) return undefined; var k = +el.dataset.k || 1; v /= k; if (el.min !== '') v = Math.max(+el.min / k, v); if (el.max !== '') v = Math.min(+el.max / k, v); return v; }
  if (el.type === 'color') return el.value;
  if (el.dataset.num) { var n = parseFloat(el.value); return isFinite(n) ? n : 0; }
  if (el.type === 'text' && el.maxLength === 7) { var c = el.value.trim(); if (c[0] !== '#') c = '#' + c; return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? (c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c).toLowerCase() : undefined; }
  return el.value;
}
var arMemo = {}; // proportions captured at the first keystroke of a W/H edit
function applyField(el, live) {
  var v = readField(el); if (v === undefined) return;
  var path = el.dataset.b;
  if (el.dataset.scope === 'doc') { setPath(doc, path, v); }
  else {
    var so = selObjs(); if (!so.length) return;
    so.forEach(function (o) {
      if (el.dataset.special === 'radius' && linkRadii || el.dataset.special === 'radiusAll') { o.radii = [v, v, v, v]; return; }
      if (el.dataset.special === 'crop') { // move just that edge over the fixed picture
        var P = sourceRect(o), side = path.slice(-1), bx = { x: o.x, y: o.y, w: o.w, h: o.h };
        if (side === 'l') { var R = bx.x + bx.w; bx.x = Math.min(P.x + v * P.w, R - 8); bx.w = R - bx.x; }
        if (side === 'r') bx.w = Math.max(8, P.x + P.w * (1 - v) - bx.x);
        if (side === 't') { var B = bx.y + bx.h; bx.y = Math.min(P.y + v * P.h, B - 8); bx.h = B - bx.y; }
        if (side === 'b') bx.h = Math.max(8, P.y + P.h * (1 - v) - bx.y);
        setCropFromBox(o, P, bx);
        return;
      }
      if ((path === 'w' || path === 'h') && aspectLocked(null, o) && o.w > 0 && o.h > 0) { // keep proportions from the size before this edit
        var ar = arMemo[o.id] || (arMemo[o.id] = lockRatio(o, o.w, o.h));
        if (path === 'w') { o.w = v; o.h = Math.max(1, ui.snap ? Math.round(v / ar) : v / ar); } else { o.h = v; o.w = Math.max(1, ui.snap ? Math.round(v * ar) : v * ar); }
        if (!live) delete arMemo[o.id];
        return;
      }
      setPath(o, path, v);
    });
  }
  // keep twin colour inputs in step
  $$('#tabBody [data-b="' + path + '"]').forEach(function (t) { if (t !== el && t.type !== 'number' && t.type !== 'checkbox') t.value = v; });
  if (el.dataset.special === 'radius' && linkRadii || el.dataset.special === 'radiusAll' || el.dataset.special === 'crop') syncFields();
  if (live) { requestRender(true); draw(); refreshComputed(); }
  else {
    if (path === 'name' || path === 'slot' || path === 'slotNum' || path === 'plane') buildObjList();
    if (path.indexOf('src.') === 0 || path === 'slot') cardCache = {};
    commit();
    if (el.dataset.rebuild) buildTab();
    draw();
  }
}
var tb = $('#tabBody');
tb.addEventListener('click', function (e) { var sm = e.target.closest('summary'), d = sm && sm.parentElement; if (d && d.dataset.sec) { ui.secs[d.dataset.sec] = !d.open; saveUi(); } });
tb.addEventListener('input', function (e) { var el = e.target; if (!el.dataset.b || el.type === 'checkbox' || el.tagName === 'SELECT') return; applyField(el, true); });
tb.addEventListener('change', function (e) { var el = e.target; if (!el.dataset.b) return; applyField(el, false); });
tb.addEventListener('change', function (e) {
  if (e.target.id !== 'shapeSel' || !e.target.value) return;
  selObjs().forEach(function (o) { setShape(o, e.target.value); });
  commit(); buildObjList(); buildTab(); draw();
});
tb.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]'); if (!b) return;
  var fn = ACTIONS[b.dataset.act]; if (fn) fn(b);
});

// ---------------- object list ----------------
var TYPE_LABEL = { rrect: 'Rounded', ellipse: 'Ellipse', rect: 'Rect', line: 'Line' };
// ---------------- shape switching ----------------
var SHAPES = [['rect', 'Rectangle'], ['rounded', 'Rounded corners'], ['squircle', 'Squircle'], ['ellipse', 'Ellipse'], ['circle', 'Circle']];
function shapeKey(o) {
  if (o.type === 'line') return 'line';
  if (o.type === 'rect') return 'rect';
  if (o.type === 'ellipse') return Math.abs(o.w - o.h) < 0.5 ? 'circle' : 'ellipse';
  if (o.cornerStyle === 'squircle') return 'squircle';
  return o.radii.some(function (r) { return r > 0; }) ? 'rounded' : 'rect';
}
function shapeLabel(o) { var k = shapeKey(o); return k === 'line' ? 'Line' : k === 'rect' ? 'Rect' : k === 'rounded' ? 'Rounded' : k === 'squircle' ? 'Squircle' : k === 'circle' ? 'Circle' : 'Ellipse'; }
// Change an object's shape in place. Corner radii are kept on the object, so switching back restores them.
function setShape(o, k) {
  if (o.type === 'line') return;
  var noR = !o.radii.some(function (r) { return r > 0; }), m = Math.min(o.w, o.h);
  if (k === 'rect') o.type = 'rect';
  else if (k === 'rounded' || k === 'squircle') {
    o.type = 'rrect'; o.cornerStyle = k === 'squircle' ? 'squircle' : 'round';
    if (k === 'squircle' && (+o.smooth || 0) < 4) o.smooth = 5;
    if (noR) { var r = Math.round(k === 'squircle' ? m * 0.2 : Math.max(4, 24 * doc.canvas.h / 1080)); o.radii = [r, r, r, r]; }
  } else if (k === 'ellipse') o.type = 'ellipse';
  else if (k === 'circle') {
    var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    o.type = 'ellipse'; o.w = o.h = m; o.x = cx - m / 2; o.y = cy - m / 2;
    if (ui.snap) { o.x = Math.round(o.x); o.y = Math.round(o.y); }
  }
}
function buildObjList() {
  var L = $('#objList'), html = '';
  for (var i = doc.objects.length - 1; i >= 0; i--) {
    var o = doc.objects[i], s = sel.indexOf(o.id) >= 0;
    html += '<div class="orow' + (s ? ' sel' : '') + (o.hidden ? ' hid' : '') + '" data-id="' + o.id + '" draggable="true">' +
      '<span class="ic' + (o.hidden ? '' : ' act') + '" data-t="hidden" title="Show / hide">' + (o.hidden ? '◌' : '●') + '</span>' +
      '<span class="ic' + (o.locked ? ' act' : '') + '" data-t="locked" title="Lock">' + (o.locked ? '🔒' : '○') + '</span>' +
      (o.slot ? '<span class="badge" title="Video slot, vMix layer ' + PIPE.layerOf(doc, o) + '">' + (o.slotNum || '·') + '·L' + PIPE.layerOf(doc, o) + '</span>' : '<span class="badge deco" title="Decoration on the ' + (o.plane === 'front' ? 'front mask' : 'back plate') + '">' + (o.plane === 'front' ? 'FR' : 'BK') + '</span>') +
      '<span class="oname" title="Double-click to rename">' + esc(o.name || shapeLabel(o)) + '</span><span class="note">' + shapeLabel(o) + '</span></div>';
  }
  L.innerHTML = html || '<div class="note" style="padding:6px 8px">No objects. Pick a shape tool or a template (T).</div>';
}
var objList = $('#objList'), dragRow = null;
objList.addEventListener('click', function (e) {
  var r = e.target.closest('.orow'); if (!r) return;
  var id = r.dataset.id, t = e.target.closest('[data-t]');
  if (t) { var o = objById(id); o[t.dataset.t] = !o[t.dataset.t]; if (t.dataset.t === 'locked' && o.locked) sel = sel.filter(function (x) { return x !== id; }); commit(); buildObjList(); buildTab(); draw(); return; }
  if (e.shiftKey || e.ctrlKey || e.metaKey) { var i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); }
  else sel = [id];
  selectionChanged(); draw();
});
objList.addEventListener('dblclick', function (e) {
  var r = e.target.closest('.orow'); if (!r || e.target.closest('[data-t]')) return;
  var o = objById(r.dataset.id), n = r.querySelector('.oname');
  var inp = document.createElement('input'); inp.value = o.name || ''; inp.style.flex = '1';
  n.replaceWith(inp); inp.focus(); inp.select();
  function done(ok) { if (ok) { o.name = inp.value.trim() || o.name; cardCache = {}; commit(); } buildObjList(); buildTab(); draw(); }
  inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); ev.stopPropagation(); });
  inp.addEventListener('blur', function () { done(true); });
});
objList.addEventListener('dragstart', function (e) { var r = e.target.closest('.orow'); if (!r) return; dragRow = r.dataset.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragRow); } catch (x) { } });
objList.addEventListener('dragover', function (e) { var r = e.target.closest('.orow'); if (!r || !dragRow) return; e.preventDefault(); $$('.orow.drop').forEach(function (x) { x.classList.remove('drop'); }); r.classList.add('drop'); });
objList.addEventListener('drop', function (e) {
  var r = e.target.closest('.orow'); if (!r || !dragRow) return; e.preventDefault();
  var from = objById(dragRow), to = objById(r.dataset.id); dragRow = null;
  if (!from || !to || from === to) { buildObjList(); return; }
  doc.objects.splice(doc.objects.indexOf(from), 1);
  doc.objects.splice(doc.objects.indexOf(to) + 1, 0, from); // list is top-first, so dropping on a row puts it above that row
  commit(); buildObjList(); draw();
});
objList.addEventListener('dragend', function () { dragRow = null; $$('.orow.drop').forEach(function (x) { x.classList.remove('drop'); }); });

// ---------------- selection ----------------
var lastSelKey = '';
function selectionChanged(light) {
  var key = sel.join(',');
  if (cropId && (sel.length !== 1 || sel[0] !== cropId)) cropId = null;
  if (key !== lastSelKey) { lastSelKey = key; buildTab(); }
  $$('#objList .orow').forEach(function (r) { r.classList.toggle('sel', sel.indexOf(r.dataset.id) >= 0); });
  $('#alignGrp').classList.toggle('hidden', !sel.length);
  updateSelStatus();
  if (!light) draw();
}
function updateSelStatus() {
  var so = selObjs(), el = $('#stSel');
  if (!so.length) { el.innerHTML = ''; return; }
  if (so.length > 1) { var bb = bboxOf(so); el.innerHTML = 'Sel <b>' + so.length + ' objects</b> ' + fmt(bb.w, 1) + '×' + fmt(bb.h, 1) + ' @ ' + fmt(bb.x, 1) + ',' + fmt(bb.y, 1); return; }
  var o = so[0]; el.innerHTML = 'Sel <b>' + esc(o.name || shapeLabel(o)) + '</b> ' + fmt(o.w, 2) + '×' + fmt(o.h, 2) + ' @ ' + fmt(o.x, 2) + ',' + fmt(o.y, 2);
}
