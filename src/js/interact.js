/* ========================= HIT TESTING, POINTER, OBJECT OPS, KEYBOARD ========================= */
// ---------------- hit testing ----------------
function hitObject(x, y) {
  var tol = 4 / view.zoom;
  for (var i = doc.objects.length - 1; i >= 0; i--) {
    var o = doc.objects[i];
    if (o.hidden || o.locked) continue;
    if (x < o.x - tol || x > o.x + o.w + tol || y < o.y - tol || y > o.y + o.h + tol) continue;
    var sp = PIPE.shapeOf(o, 0, 1);
    if (!sp || PIPE.sd(sp, x, y) <= tol) return o;
  }
  return null;
}
function hitHandle(x, y) {
  var so = selObjs(); if (so.length !== 1 || so[0].locked) return null;
  var r = 7 / view.zoom, hs = handlesOf(so[0]);
  for (var i = 0; i < hs.length; i++) if (Math.abs(hs[i].x - x) <= r && Math.abs(hs[i].y - y) <= r) return hs[i].n;
  return null;
}
var CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

// ---------------- snapping ----------------
function snapVal(v) { if (!ui.snap) return v; var g = Math.max(1, +ui.grid || 1); return Math.round(v / g) * g; }
function snapTargets(exclude) {
  var xs = [0, doc.canvas.w / 2, doc.canvas.w], ys = [0, doc.canvas.h / 2, doc.canvas.h];
  if (ui.safe !== 'off') {
    var pr = ui.safe === 'modern' ? [0.93, 0.90] : [0.90, 0.80];
    pr.forEach(function (p) { var mw = doc.canvas.w * (1 - p) / 2, mh = doc.canvas.h * (1 - p) / 2; xs.push(mw, doc.canvas.w - mw); ys.push(mh, doc.canvas.h - mh); });
  }
  doc.objects.forEach(function (o) {
    if (o.hidden || exclude.indexOf(o.id) >= 0) return;
    xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  });
  return { xs: xs, ys: ys };
}
// Given candidate edges, find the best offset to a target within threshold.
function bestSnap(cands, targets) {
  var th = 6 / view.zoom, best = null;
  cands.forEach(function (c) { targets.forEach(function (t) { var d = t - c; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, v: t }; }); });
  return best;
}

// ---------------- pointer ----------------
var spaceDown = false;
cvs.addEventListener('pointerdown', function (e) {
  cvs.setPointerCapture(e.pointerId);
  var p = toCanvas(e);
  if (e.button === 1 || e.button === 2 || tool === 'hand' || spaceDown) {
    drag = { kind: 'pan', sx: p.sx, sy: p.sy, ox: view.ox, oy: view.oy }; cvs.style.cursor = 'grabbing'; e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  if (tool !== 'select') {
    var sx0 = snapVal(p.x), sy0 = snapVal(p.y);
    drag = { kind: 'create', type: tool, x0: sx0, y0: sy0, obj: null };
    return;
  }
  var hnd = hitHandle(p.x, p.y), co = cropSlot();
  if (co) {
    if (hnd) { drag = { kind: 'crop', h: hnd, P: sourceRect(co), start: { x: co.x, y: co.y, w: co.w, h: co.h }, id: co.id, moved: false }; return; }
    if (p.x >= co.x && p.x <= co.x + co.w && p.y >= co.y && p.y <= co.y + co.h) { drag = { kind: 'cropPan', P: sourceRect(co), px: p.x, py: p.y, id: co.id, moved: false }; return; }
    endCrop();
  }
  if (hnd) {
    var o = firstSel();
    drag = { kind: 'resize', h: hnd, start: { x: o.x, y: o.y, w: o.w, h: o.h }, px: p.x, py: p.y, id: o.id, moved: false };
    return;
  }
  var hit = hitObject(p.x, p.y);
  if (hit) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      var i = sel.indexOf(hit.id);
      if (i >= 0) sel.splice(i, 1); else sel.push(hit.id);
      selectionChanged();
      if (sel.indexOf(hit.id) < 0) return;
    } else if (sel.indexOf(hit.id) < 0) { sel = [hit.id]; selectionChanged(); }
    var movers = selObjs().filter(function (o) { return !o.locked; });
    if (e.altKey && movers.length) { // alt-drag duplicates
      movers = duplicate(0, 0, true);
    }
    drag = { kind: 'move', dup: e.altKey, px: p.x, py: p.y, starts: movers.map(function (o) { return { id: o.id, x: o.x, y: o.y }; }), bb: bboxOf(movers), moved: false };
    return;
  }
  if (!e.shiftKey) { sel = []; selectionChanged(); }
  drag = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey, base: sel.slice() };
});
cvs.addEventListener('pointermove', function (e) {
  var p = toCanvas(e);
  $('#stCursor').textContent = (p.x >= 0 && p.y >= 0 && p.x < doc.canvas.w && p.y < doc.canvas.h) ? Math.floor(p.x) + ', ' + Math.floor(p.y) : Math.floor(p.x) + ', ' + Math.floor(p.y) + ' (outside)';
  if (!drag) {
    if (tool === 'select' && !spaceDown) {
      var hn = hitHandle(p.x, p.y), ho = hn ? null : hitObject(p.x, p.y);
      cvs.style.cursor = hn ? CURSORS[hn] : ho ? 'move' : 'default';
      var hid = ho ? ho.id : null; if (hid !== hover) { hover = hid; draw(); }
    } else cvs.style.cursor = (tool === 'hand' || spaceDown) ? 'grab' : 'crosshair';
    return;
  }
  if (drag.kind === 'pan') { view.ox = drag.ox + (p.sx - drag.sx); view.oy = drag.oy + (p.sy - drag.sy); draw(); return; }
  if (drag.kind === 'marquee') {
    drag.x1 = p.x; drag.y1 = p.y;
    var mx0 = Math.min(drag.x0, drag.x1), mx1 = Math.max(drag.x0, drag.x1), my0 = Math.min(drag.y0, drag.y1), my1 = Math.max(drag.y0, drag.y1);
    var hits = doc.objects.filter(function (o) { return !o.hidden && !o.locked && o.x < mx1 && o.x + o.w > mx0 && o.y < my1 && o.y + o.h > my0; }).map(function (o) { return o.id; });
    sel = drag.add ? drag.base.concat(hits.filter(function (id) { return drag.base.indexOf(id) < 0; })) : hits;
    selectionChanged(true); draw(); return;
  }
  if (drag.kind === 'create') {
    var x1 = snapVal(p.x), y1 = snapVal(p.y), dx = x1 - drag.x0, dy = y1 - drag.y0;
    if (!drag.obj && Math.abs(dx) * view.zoom < 3 && Math.abs(dy) * view.zoom < 3) return;
    var dar = drawAspect(drag.type, e);
    if (dar) { // keep the box's shape: the larger drag axis wins
      if (Math.abs(dx) / dar >= Math.abs(dy)) dy = (dy < 0 ? -1 : 1) * Math.abs(dx) / dar; else dx = (dx < 0 ? -1 : 1) * Math.abs(dy) * dar;
      if (ui.snap) { dx = Math.round(dx); dy = (dy < 0 ? -1 : 1) * Math.round(Math.abs(dx) / dar); }
    }
    var rx = dx < 0 ? drag.x0 + dx : drag.x0, ry = dy < 0 ? drag.y0 + dy : drag.y0, rw = Math.max(1, Math.abs(dx)), rh = Math.max(1, Math.abs(dy));
    if (!drag.obj) { drag.obj = createObject(drag.type, rx, ry, rw, rh); doc.objects.push(drag.obj); sel = [drag.obj.id]; selectionChanged(); }
    var ob = drag.obj; ob.x = rx; ob.y = ry; ob.w = rw; ob.h = rh;
    if (drag.type === 'line') { if (Math.abs(dx) >= Math.abs(dy)) { ob.h = ob.h < 1 ? 6 : Math.min(ob.h, 6); ob.y = drag.y0 - ob.h / 2; } else { ob.w = Math.min(ob.w, 6); ob.x = drag.x0 - ob.w / 2; } }
    syncFields(); requestRender(true); draw(); return;
  }
  if (drag.kind === 'move') {
    var ddx = p.x - drag.px, ddy = p.y - drag.py;
    if (!drag.moved && Math.abs(ddx) * view.zoom < 2 && Math.abs(ddy) * view.zoom < 2) return;
    drag.moved = true;
    if (e.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
    var nb = { x: drag.bb.x + ddx, y: drag.bb.y + ddy };
    guidesNow = [];
    if (ui.snap) {
      nb.x = snapVal(nb.x); nb.y = snapVal(nb.y);
      var T = snapTargets(drag.starts.map(function (s) { return s.id; }));
      var sx = bestSnap([nb.x, nb.x + drag.bb.w / 2, nb.x + drag.bb.w], T.xs);
      var sy = bestSnap([nb.y, nb.y + drag.bb.h / 2, nb.y + drag.bb.h], T.ys);
      if (sx) { nb.x += sx.d; guidesNow.push({ axis: 'x', v: sx.v }); }
      if (sy) { nb.y += sy.d; guidesNow.push({ axis: 'y', v: sy.v }); }
    }
    var offx = nb.x - drag.bb.x, offy = nb.y - drag.bb.y;
    drag.starts.forEach(function (s) { var o = objById(s.id); o.x = s.x + offx; o.y = s.y + offy; });
    syncFields(); requestRender(true); draw(); return;
  }
  if (drag.kind === 'crop') { // move the slot edges over a fixed picture; the crop follows
    var oc = objById(drag.id), P0 = drag.P, sc = drag.start, hc = drag.h, MIN = 8;
    var cL = sc.x, cT = sc.y, cR = sc.x + sc.w, cB = sc.y + sc.h, qx = snapVal(p.x), qy = snapVal(p.y);
    if (hc.indexOf('w') >= 0) cL = Math.max(P0.x, Math.min(qx, cR - MIN));
    if (hc.indexOf('e') >= 0) cR = Math.min(P0.x + P0.w, Math.max(qx, cL + MIN));
    if (hc.indexOf('n') >= 0) cT = Math.max(P0.y, Math.min(qy, cB - MIN));
    if (hc.indexOf('s') >= 0) cB = Math.min(P0.y + P0.h, Math.max(qy, cT + MIN));
    setCropFromBox(oc, P0, { x: cL, y: cT, w: cR - cL, h: cB - cT });
    drag.moved = true; syncFields(); requestRender(true); draw(); return;
  }
  if (drag.kind === 'cropPan') { // slide the picture under the slot
    var op = objById(drag.id), Pp = drag.P;
    var nx = Pp.x + (p.x - drag.px), ny = Pp.y + (p.y - drag.py);
    if (ui.snap) { nx = Math.round(nx); ny = Math.round(ny); }
    nx = Math.min(op.x, Math.max(op.x + op.w - Pp.w, nx)); ny = Math.min(op.y, Math.max(op.y + op.h - Pp.h, ny));
    setCropFromBox(op, { x: nx, y: ny, w: Pp.w, h: Pp.h }, { x: op.x, y: op.y, w: op.w, h: op.h });
    drag.moved = true; syncFields(); requestRender(true); draw(); return;
  }
  if (drag.kind === 'resize') {
    var o2 = objById(drag.id), st = drag.start, h = drag.h;
    var L = st.x, T2 = st.y, Rr = st.x + st.w, B = st.y + st.h;
    var px = p.x, py = p.y;
    if (ui.snap) { px = snapVal(px); py = snapVal(py); }
    guidesNow = [];
    if (ui.snap) {
      var TT = snapTargets([o2.id]);
      if (h.indexOf('w') >= 0 || h.indexOf('e') >= 0) { var gx = bestSnap([px], TT.xs); if (gx) { px += gx.d; guidesNow.push({ axis: 'x', v: gx.v }); } }
      if (h.indexOf('n') >= 0 || h.indexOf('s') >= 0) { var gy = bestSnap([py], TT.ys); if (gy) { py += gy.d; guidesNow.push({ axis: 'y', v: gy.v }); } }
    }
    if (h.indexOf('w') >= 0) L = Math.min(px, Rr - 1);
    if (h.indexOf('e') >= 0) Rr = Math.max(px, L + 1);
    if (h.indexOf('n') >= 0) T2 = Math.min(py, B - 1);
    if (h.indexOf('s') >= 0) B = Math.max(py, T2 + 1);
    var cx = st.x + st.w / 2, cy = st.y + st.h / 2;
    if (e.altKey) { // resize from centre
      var hw = Math.max(Math.abs(Rr - cx), Math.abs(L - cx)), hh = Math.max(Math.abs(B - cy), Math.abs(T2 - cy));
      if (h === 'n' || h === 's') hw = st.w / 2; if (h === 'e' || h === 'w') hh = st.h / 2;
      L = cx - hw; Rr = cx + hw; T2 = cy - hh; B = cy + hh;
    }
    if (aspectLocked(e, o2)) { // keep proportions: corners fit inside the pointer, edges scale the other side about its centre
      var ar = lockRatio(o2, st.w, st.h), nw = Rr - L, nh = B - T2, byH = h === 'n' || h === 's';
      if (h.length === 2) { byH = nw / nh > ar; if (byH) nw = nh * ar; else nh = nw / ar; }
      else if (byH) nw = nh * ar; else nh = nw / ar;
      if (ui.snap) { if (byH) { nh = Math.max(1, Math.round(nh)); nw = Math.max(1, Math.round(nh * ar)); } else { nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nw / ar)); } }
      if (e.altKey) { L = cx - nw / 2; T2 = cy - nh / 2; }
      else {
        L = h.indexOf('w') >= 0 ? st.x + st.w - nw : h.indexOf('e') >= 0 ? st.x : cx - nw / 2;
        T2 = h.indexOf('n') >= 0 ? st.y + st.h - nh : h.indexOf('s') >= 0 ? st.y : cy - nh / 2;
      }
      if (ui.snap) { L = Math.round(L); T2 = Math.round(T2); }
      Rr = L + nw; B = T2 + nh;
    }
    o2.x = L; o2.y = T2; o2.w = Rr - L; o2.h = B - T2;
    drag.moved = true;
    syncFields(); requestRender(true); draw();
  }
});
function endDrag() {
  if (!drag) return;
  var k = drag.kind, d = drag;
  drag = null; guidesNow = [];
  cvs.style.cursor = 'default';
  if (k === 'create') {
    if (!d.obj) { // click without drag: default size, centred on click
      var dw = d.type === 'line' ? 400 : d.type === 'ellipse' ? 360 : 640, dh = d.type === 'line' ? 6 : d.type === 'ellipse' ? 360 : 360;
      var o = createObject(d.type, snapVal(d.x0 - dw / 2), snapVal(d.y0 - dh / 2), dw, dh);
      doc.objects.push(o); sel = [o.id];
    }
    setTool('select'); selectionChanged(); commit(); buildObjList();
  } else if (k === 'move' || k === 'resize') { if (d.moved || d.dup) commit(); if (d.dup) buildObjList(); }
  else if (k === 'crop' || k === 'cropPan') { if (d.moved) { commit(); buildTab(); } }
  else if (k === 'marquee') selectionChanged();
  draw();
}
cvs.addEventListener('pointerup', endDrag);
cvs.addEventListener('pointercancel', endDrag);
cvs.addEventListener('contextmenu', function (e) { e.preventDefault(); });
cvs.addEventListener('pointerleave', function () { $('#stCursor').textContent = '–'; if (hover) { hover = null; draw(); } });
cvs.addEventListener('wheel', function (e) {
  e.preventDefault();
  var r = cvs.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey || !e.shiftKey && Math.abs(e.deltaX) < 1 && e.deltaMode === 0 && Math.abs(e.deltaY) >= 1) {
    var f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
    zoomAt(view.zoom * f, e.clientX - r.left, e.clientY - r.top);
  } else { view.ox -= e.shiftKey ? e.deltaY : e.deltaX; view.oy -= e.shiftKey ? 0 : e.deltaY; draw(); }
}, { passive: false });

// ---------------- object ops ----------------
function nextSlotNum() { var m = 0; doc.objects.forEach(function (o) { if (o.slot) m = Math.max(m, o.slotNum || 0); }); return m + 1; }
// ---------------- crop ----------------
// Whole (uncropped) source picture of a slot, in canvas px, as vMix places it.
function sourceRect(o) { var vm = PIPE.vmixFor(doc, o), kx = doc.canvas.w / vm.outW, ky = doc.canvas.h / vm.outH; return { x: vm.placed.x * kx, y: vm.placed.y * ky, w: vm.placed.w * kx, h: vm.placed.h * ky }; }
// Make the slot exactly rect b over picture P: the picture keeps its size and position, the crop follows.
function setCropFromBox(o, P, b) {
  function f(v) { return v < 1e-9 ? 0 : v; }
  function g(v) { var r = Math.round(v); return Math.abs(v - r) < 1e-6 ? r : v; } // keep whole pixels whole after float clamping
  b = { x: g(b.x), y: g(b.y), w: g(b.w), h: g(b.h) };
  o.x = b.x; o.y = b.y; o.w = b.w; o.h = b.h;
  o.src.crop = { l: f((b.x - P.x) / P.w), t: f((b.y - P.y) / P.h), r: f((P.x + P.w - b.x - b.w) / P.w), b: f((P.y + P.h - b.y - b.h) / P.h) };
}
function cropSlot() { var o = cropId && sel.length === 1 ? objById(cropId) : null; return o && o.id === sel[0] ? o : null; }
function startCrop() {
  var o = firstSel();
  if (!o || sel.length !== 1 || !o.slot || o.locked) { toast('Select one unlocked video slot to crop it.'); return; }
  cropId = o.id; setTool('select'); buildTab(); draw();
  toast('Crop: drag the orange edges to trim the picture, drag inside to move it. Enter or Esc when done.', false, 6000);
}
function endCrop() { if (!cropId) return; cropId = null; buildTab(); draw(); }
function toggleCrop() { if (cropSlot()) endCrop(); else startCrop(); }

// Proportion lock (on by default). Shift flips it for the current drag. Lines never lock.
function aspectLocked(e, o) { return (ui.lockAspect !== false) !== !!(e && e.shiftKey) && (!o || o.type !== 'line'); }
// Ratio to hold while locked: a slot within 1 % of its source shape snaps to the exact source ratio, so 16:9 boxes don't drift after rounding.
function lockRatio(o, w, h) {
  var r = w / h, sa = o.slot ? PIPE.croppedAspect(o.src) : 0;
  return sa && Math.abs(r / sa - 1) < 0.01 ? sa : r;
}
function drawAspect(type, e) {
  if (type === 'line') return 0;
  if (type === 'rrect' || type === 'squircle') return aspectLocked(e) ? 16 / 9 : 0;
  return e.shiftKey ? 1 : 0; // ellipse / rectangle: Shift draws a circle or square
}
function setLockAspect(on) {
  ui.lockAspect = !!on; saveUi();
  $$('[data-lockar]').forEach(function (b) { b.classList.toggle('on', ui.lockAspect); b.setAttribute('aria-pressed', ui.lockAspect); b.title = ui.lockAspect ? 'Proportions locked: resizing keeps the shape (hold Shift to break it for one drag). Click to unlock.' : 'Proportions unlocked: width and height change freely. Click to lock.'; });
  $$('[data-lockar] .lt').forEach(function (t) { t.textContent = ui.lockAspect ? 'Ratio locked' : 'Ratio unlocked'; });
}
function createObject(type, x, y, w, h) {
  var t = type === 'squircle' ? 'rrect' : type;
  var o = PIPE.newObject(t, x, y, w, h);
  if (type === 'squircle') { o.cornerStyle = 'squircle'; o.smooth = 5; o.radii = [64, 64, 64, 64]; }
  if (type === 'line') o.caps = 'round';
  if (o.slot) { o.slotNum = nextSlotNum(); o.name = 'Slot ' + o.slotNum; }
  else o.name = type === 'line' ? 'Divider' : 'Rectangle';
  return o;
}
function duplicate(dx, dy, keepSelection) {
  var so = selObjs(); if (!so.length) return [];
  var made = [];
  so.forEach(function (o) {
    var c = PIPE.clone(o); c.id = PIPE.uid(); c.x += dx; c.y += dy; c.locked = false;
    if (c.slot) { c.slotNum = nextSlotNum(); c.name = (o.name || 'Slot') + ' copy'; c.src.layer = 0; }
    else c.name = (o.name || 'Object') + ' copy';
    doc.objects.splice(doc.objects.indexOf(o) + 1 + made.length, 0, c); made.push(c);
  });
  sel = made.map(function (o) { return o.id; });
  selectionChanged();
  if (!keepSelection) commit();
  buildObjList();
  return made;
}
function deleteSel() {
  var so = selObjs().filter(function (o) { return !o.locked; }); if (!so.length) return;
  doc.objects = doc.objects.filter(function (o) { return so.indexOf(o) < 0; });
  sel = []; selectionChanged(); commit(); buildObjList();
}
function nudge(dx, dy) {
  var so = selObjs().filter(function (o) { return !o.locked; }); if (!so.length) return;
  so.forEach(function (o) { o.x += dx; o.y += dy; });
  syncFields(); requestRender(true); draw();
  clearTimeout(nudge.t); nudge.t = setTimeout(commit, 350);
}
function align(mode) {
  var so = selObjs().filter(function (o) { return !o.locked; }); if (!so.length) return;
  if (mode === 'disth' || mode === 'distv') {
    if (so.length < 3) { toast('Select 3 or more objects to distribute.'); return; }
    var hz = mode === 'disth', s = so.slice().sort(function (a, b) { return hz ? a.x - b.x : a.y - b.y; });
    var bb = bboxOf(s), total = s.reduce(function (t, o) { return t + (hz ? o.w : o.h); }, 0), gap = ((hz ? bb.w : bb.h) - total) / (s.length - 1);
    var pos = hz ? bb.x : bb.y;
    s.forEach(function (o) { if (hz) { o.x = snapVal(pos); pos += o.w + gap; } else { o.y = snapVal(pos); pos += o.h + gap; } });
  } else {
    var ref = so.length === 1 ? { x: 0, y: 0, w: doc.canvas.w, h: doc.canvas.h } : bboxOf(so);
    so.forEach(function (o) {
      if (mode === 'left') o.x = ref.x; if (mode === 'right') o.x = ref.x + ref.w - o.w; if (mode === 'hcenter') o.x = ref.x + (ref.w - o.w) / 2;
      if (mode === 'top') o.y = ref.y; if (mode === 'bottom') o.y = ref.y + ref.h - o.h; if (mode === 'vcenter') o.y = ref.y + (ref.h - o.h) / 2;
    });
    if (so.length === 1) toast('Aligned to canvas');
  }
  syncFields(); commit(); draw();
}
function reorder(dir) { // dir: 1 forward, -1 backward, 2 front, -2 back
  var so = selObjs(); if (!so.length) return;
  var arr = doc.objects;
  if (dir === 2 || dir === -2) {
    var rest = arr.filter(function (o) { return so.indexOf(o) < 0; });
    doc.objects = dir === 2 ? rest.concat(so) : so.concat(rest);
  } else {
    var idxs = so.map(function (o) { return arr.indexOf(o); }).sort(function (a, b) { return dir > 0 ? b - a : a - b; });
    idxs.forEach(function (i) { var j = i + dir; if (j < 0 || j >= arr.length || so.indexOf(arr[j]) >= 0) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; });
  }
  commit(); buildObjList(); draw();
}
function toggleProp(p) {
  var so = selObjs(); if (!so.length) return;
  var v = !so[0][p]; so.forEach(function (o) { o[p] = v; });
  if (p === 'hidden' || p === 'locked') draw();
  commit(); buildObjList(); buildTab();
}
function selectAll() { sel = doc.objects.filter(function (o) { return !o.hidden && !o.locked; }).map(function (o) { return o.id; }); selectionChanged(); draw(); }

// ---------------- keyboard ----------------
function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' && !/^(checkbox|radio|button|color|range)$/.test(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
document.addEventListener('keydown', function (e) {
  var mod = e.ctrlKey || e.metaKey, k = e.key;
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); saveProject(); return; }
  if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); $('#fileOpen').click(); return; }
  if (mod && (k === 'e' || k === 'E')) { e.preventDefault(); exportPack(); return; }
  if (typing(e)) { if (k === 'Escape') e.target.blur(); return; }
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicate(20, 20); return; }
  if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(); return; }
  if (mod && (k === 'l' || k === 'L')) { e.preventDefault(); toggleProp('locked'); return; }
  if (mod && (k === 'h' || k === 'H')) { e.preventDefault(); toggleProp('hidden'); return; }
  if (mod && k === ']') { e.preventDefault(); reorder(e.shiftKey ? 2 : 1); return; }
  if (mod && k === '[') { e.preventDefault(); reorder(e.shiftKey ? -2 : -1); return; }
  if (mod && (k === '0')) { e.preventDefault(); fitView(); return; }
  if (mod && (k === '1')) { e.preventDefault(); zoomAt(1, view.cw / 2, view.ch / 2); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(view.zoom * 1.25, view.cw / 2, view.ch / 2); return; }
  if (mod && (k === '-')) { e.preventDefault(); zoomAt(view.zoom / 1.25, view.cw / 2, view.ch / 2); return; }
  if (mod) return;
  var step = e.shiftKey ? 10 : 1;
  if (k === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); return; }
  if (k === 'ArrowRight') { e.preventDefault(); nudge(step, 0); return; }
  if (k === 'ArrowUp') { e.preventDefault(); nudge(0, -step); return; }
  if (k === 'ArrowDown') { e.preventDefault(); nudge(0, step); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if ((k === 'Escape' || k === 'Enter') && cropSlot()) { endCrop(); return; }
  if (k === 'Escape') { sel = []; selectionChanged(); setTool('select'); draw(); return; }
  if (k === 'c' || k === 'C') { toggleCrop(); return; }
  if (k === ' ') { if (!spaceDown) { spaceDown = true; cvs.style.cursor = 'grab'; } e.preventDefault(); return; }
  var map = { v: 'select', h: 'hand', r: 'rrect', q: 'squircle', e: 'ellipse', m: 'rect', l: 'line' };
  if (map[k.toLowerCase()]) { setTool(map[k.toLowerCase()]); return; }
  if (k === '1' || k === '2' || k === '3') { setView(['back', 'front', 'combined'][+k - 1]); return; }
  if (k === 't' || k === 'T') { openTemplates(); return; }
  if (k === 'k' || k === 'K') { setLockAspect(!ui.lockAspect); toast(ui.lockAspect ? 'Proportions locked' : 'Proportions unlocked'); return; }
  if (k === 'g' || k === 'G') { ui.showGrid = !ui.showGrid; $('#showGrid').checked = ui.showGrid; saveUi(); draw(); return; }
  if (k === '?') { openHelp(); return; }
});
document.addEventListener('keyup', function (e) { if (e.key === ' ') { spaceDown = false; cvs.style.cursor = 'default'; } });
var SHORTCUTS = [
  ['V / H', 'Select tool / pan tool (or hold Space and drag)'], ['R  Q  E  M  L', 'Rounded rect, squircle, ellipse, rectangle, line'],
  ['Arrows', 'Nudge 1 px'], ['Shift + Arrows', 'Nudge 10 px'], ['Ctrl+D', 'Duplicate'], ['Alt + drag', 'Duplicate while moving'], ['Del / Backspace', 'Delete'],
  ['Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+A', 'Select all'], ['Shift + click', 'Add to selection'],
  ['Ctrl+] / Ctrl+[', 'Bring forward / send backward (add Shift: to front / back)'], ['Ctrl+L / Ctrl+H', 'Lock / hide'],
  ['K', 'Lock / unlock box proportions'], ['C', 'Crop the selected slot (Enter or Esc when done)'], ['Shift + resize', 'Break (or keep) proportions for one drag'], ['Alt + drag handle', 'Resize from centre'], ['Shift + drag', 'Constrain move to one axis'],
  ['1  2  3', 'View back plate / front mask / combined'], ['G', 'Toggle grid'], ['T', 'Templates'],
  ['Ctrl+0 / Ctrl+1', 'Fit / 100%'], ['Ctrl+ +/-, wheel', 'Zoom'], ['Ctrl+S / Ctrl+O', 'Save / open project'], ['Ctrl+E', 'Export Pack'], ['Esc', 'Deselect']
];
