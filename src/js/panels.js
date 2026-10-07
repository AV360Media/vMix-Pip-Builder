/* ========================= PROPERTY TABS, PRESETS, ACTIONS ========================= */
// ---------------- tabs ----------------
function setTab(t) { tab = t; $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); }); buildTab(); }
function buildTab() {
  var html = '';
  if (tab === 'object') html = tabObject();
  else if (tab === 'style') html = tabStyle();
  else if (tab === 'vmix') html = tabVmix();
  else if (tab === 'mask') html = tabMask();
  else html = tabProject();
  tb.innerHTML = html;
  syncFields();
  refreshComputed();
}
function noSel(msg) { return '<p class="note">' + (msg || 'Click a box on the canvas, or in the list above, to edit it.') + '</p>' + '<p class="note">Start from <b>Layouts…</b> in the top bar (T), or draw a box with the tools on the left.</p>'; }
var LOCK_SVG = '<svg class="lk-on" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/></svg><svg class="lk-off" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 017.5-2"/></svg>';
function lockArBtn() { return '<div class="f"><label>&nbsp;</label><button class="tog' + (ui.lockAspect ? ' on' : '') + '" data-lockar data-act="lockAr" aria-pressed="' + !!ui.lockAspect + '">' + LOCK_SVG + '<span class="lt"></span></button></div>'; }

function tabObject() {
  var o = firstSel(); if (!o) return noSel();
  var multi = sel.length > 1, h = '', asp = o.src.aspect === 'custom' ? 'source' : o.src.aspect;
  h += sec(multi ? sel.length + ' objects selected' : o.slot ? 'Video slot' : 'Decoration',
    row('c2', fTxt('Name', 'name') + (o.slot ? fNum('Slot number', 'slotNum', { min: 0, max: 99 }) : fSel('Drawn on', 'plane', [['back', 'Back plate (behind video)'], ['front', 'Front mask (over video)']], { rebuild: 1 }))) +
    fChk('A vMix source sits here' + (o.slot ? ' (layer ' + PIPE.layerOf(doc, o) + ')' : ''), 'slot', { rebuild: 1, title: 'Untick for a decoration: a shape that gets no vMix layer.' }));
  h += sec('Size and position', row('sizerow', fNum('Width', 'w', { step: 1, min: 1 }) + lockArBtn() + fNum('Height', 'h', { step: 1, min: 1 })) +
    row('c2', fNum('X (left)', 'x', { step: 1 }) + fNum('Y (top)', 'y', { step: 1 })) +
    row('c3', btn('Centre H', 'centerH') + btn('Centre V', 'centerV') + btn('Match ' + esc(asp), 'match169', ' title="Set the height so the box matches its source shape"')) +
    '<div class="note">' + (ui.lockAspect ? 'Ratio locked: resizing keeps the shape. Hold Shift while dragging to break it once.' : 'Ratio unlocked: width and height change freely.') + ' Right / bottom edge: <span id="edgeInfo"></span></div>');
  if (o.type === 'rrect') {
    h += sec('Corners', row('', fNum('Top L', 'radii.0', { min: 0, special: 'radius' }) + fNum('Top R', 'radii.1', { min: 0, special: 'radius' }) + fNum('Bot R', 'radii.2', { min: 0, special: 'radius' }) + fNum('Bot L', 'radii.3', { min: 0, special: 'radius' })) +
      row('c3', '<label class="f inline"><input type="checkbox" id="linkR"' + (linkRadii ? ' checked' : '') + '>Link corners</label>' + fSel('Corner shape', 'cornerStyle', [['round', 'Circular'], ['squircle', 'Squircle']], { rebuild: 1 }) + (o.cornerStyle === 'squircle' ? fNum('Smoothness', 'smooth', { min: 2, max: 12, step: 0.5, title: '2 = circular, 4-5 = squircle, higher = squarer' }) : '')));
  }
  if (o.type === 'line') h += sec('Line', row('c2', fSel('Ends', 'caps', [['butt', 'Square'], ['round', 'Round']])) + '<div class="note">Thickness is the shorter of width and height.</div>');
  if (o.type === 'ellipse') h += sec('Ellipse', btn('Make circle (W = H)', 'circle'));
  return h;
}

// --- style presets ---
var BUILTIN_PRESETS = [
  { name: 'Clean white frame', builtin: true, style: (function () { var s = PIPE.defaultStyle(); return s; })() },
  { name: 'Soft float (no border)', builtin: true, style: (function () { var s = PIPE.defaultStyle(); s.stroke.enabled = false; s.shadows = [{ enabled: true, x: 0, y: 24, blur: 80, spread: -8, color: '#000000', opacity: 0.6 }, { enabled: true, x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.35 }]; return s; })() },
  { name: 'Accent glow', builtin: true, style: (function () { var s = PIPE.defaultStyle(); s.stroke = { enabled: true, width: 3, color: '#3d9bff', alpha: 1, align: 'outside' }; s.glow = { enabled: true, blur: 40, spread: 2, color: '#3d9bff', opacity: 0.7 }; s.shadows = []; return s; })() },
  { name: 'Shadow only', builtin: true, style: (function () { var s = PIPE.defaultStyle(); s.shadowOnly = true; s.stroke.enabled = false; return s; })() },
  { name: 'Inset bevel', builtin: true, style: (function () { var s = PIPE.defaultStyle(); s.stroke = { enabled: true, width: 2, color: '#ffffff', alpha: 0.35, align: 'inside' }; s.innerShadows = [{ enabled: true, x: 0, y: 6, blur: 18, spread: 0, color: '#000000', opacity: 0.55 }]; return s; })() },
  { name: 'Flat plate (decoration)', builtin: true, style: (function () { var s = PIPE.defaultStyle(); s.knockout = false; s.stroke.enabled = false; s.shadows = []; s.fill = { enabled: true, type: 'linear', color: '#1a1f2b', alpha: 1, angle: 160, cx: 50, cy: 50, size: 100, stops: [{ pos: 0, color: '#1d2536', alpha: 1 }, { pos: 100, color: '#0a0c11', alpha: 1 }] }; return s; })() }
];
function userPresets() { try { var a = JSON.parse(lsGet(LS_PRESETS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function setUserPresets(a) { if (!lsSet(LS_PRESETS, JSON.stringify(a))) toast('Browser storage is blocked, so presets will not persist. Use Export presets.', true); }
function allPresets() { return BUILTIN_PRESETS.concat(userPresets()); }
var presetPick = 0;

function shadowItem(kind, sh, i) {
  var p = 'style.' + kind + '.' + i + '.';
  return '<div class="item">' + row('c2', fChk('On', p + 'enabled') + '<span style="text-align:right">' + btn('Remove', 'rm-' + kind, ' data-i="' + i + '"') + '</span>') +
    row('', fNum('X', p + 'x') + fNum('Y', p + 'y') + fNum('Blur', p + 'blur', { min: 0 }) + fNum('Spread', p + 'spread')) +
    row('c2', fColor('Colour', p + 'color') + fNum('Opacity %', p + 'opacity', { k: 100, min: 0, max: 100 })) + '</div>';
}
function tabStyle() {
  var o = firstSel(); if (!o) return noSel();
  var st = o.style, h = '', pres = allPresets();
  h += csec('stPresets', 'Style presets', row('c2', '<div class="f"><label>Preset</label><select id="presetSel">' + pres.map(function (p, i) { return '<option value="' + i + '"' + (i === presetPick ? ' selected' : '') + '>' + esc(p.name) + (p.builtin ? '' : ' ★') + '</option>'; }).join('') + '</select></div>' + '<div class="f"><label>&nbsp;</label>' + btn('Apply to selection', 'presetApply') + '</div>') +
    row('', btn('Save…', 'presetSave', ' title="Save this object\'s look as a new preset"') + btn('Delete', 'presetDel') + btn('Export…', 'presetExport') + btn('Import…', 'presetImport')) +
    '<div class="note">★ = yours. Saved in this browser; Export to move them between machines. Presets also carry corner radii.</div>', true);
  var f = st.fill;
  var fillBody = row('c2', fChk('Fill on', 'style.fill.enabled') + fSel('Type', 'style.fill.type', [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']], { rebuild: 1 }));
  if (f.type === 'solid' || !f.type) fillBody += row('c2', fColor('Colour', 'style.fill.color') + fNum('Opacity %', 'style.fill.alpha', { k: 100, min: 0, max: 100 }));
  else {
    fillBody += f.type === 'linear' ? row('c2', fNum('Angle °', 'style.fill.angle', { title: 'CSS convention: 0 = to top, 90 = to right, 180 = to bottom' }) + fNum('Opacity %', 'style.fill.alpha', { k: 100, min: 0, max: 100 }))
      : row('', fNum('Centre X %', 'style.fill.cx') + fNum('Centre Y %', 'style.fill.cy') + fNum('Size %', 'style.fill.size', { min: 1 }) + fNum('Opacity %', 'style.fill.alpha', { k: 100, min: 0, max: 100 }));
    (f.stops || []).forEach(function (s, i) {
      var p = 'style.fill.stops.' + i + '.';
      fillBody += '<div class="item">' + row('', fNum('Stop %', p + 'pos', { min: 0, max: 100 }) + fColor('Colour', p + 'color') + fNum('Alpha %', p + 'alpha', { k: 100, min: 0, max: 100 }) + '<div class="f"><label>&nbsp;</label>' + (f.stops.length > 2 ? btn('✕', 'rmStop', ' data-i="' + i + '"') : '') + '</div>') + '</div>';
    });
    fillBody += btn('+ Add stop', 'addStop');
  }
  h += csec('stFill', 'Fill', fillBody, true, f.enabled ? '' : 'off');
  h += csec('stStroke', 'Border', row('c2', fChk('Border on', 'style.stroke.enabled') + fSel('Align', 'style.stroke.align', [['inside', 'Inside'], ['center', 'Centre'], ['outside', 'Outside']])) +
    row('c3', fNum('Width', 'style.stroke.width', { min: 0, step: 0.5 }) + fColor('Colour', 'style.stroke.color') + fNum('Opacity %', 'style.stroke.alpha', { k: 100, min: 0, max: 100 })) +
    (o.slot && doc.frontMask.includeStroke ? '<div class="note">Slot borders are drawn in the front mask (over the video). Change this on the Mask tab.</div>' : ''), true, st.stroke.enabled ? fmt(st.stroke.width) + ' px' : 'off');
  h += csec('stShadows', 'Drop shadows', (st.shadows || []).map(function (s, i) { return shadowItem('shadows', s, i); }).join('') +
    row('c2', btn('+ Add shadow', 'add-shadows') + '<span class="note">Blur matches CSS box-shadow (σ = blur ÷ 2).</span>'), true, (st.shadows || []).length ? st.shadows.length + '' : 'none');
  var nIn = (st.innerShadows || []).length;
  h += csec('stInner', 'Inner shadows', (st.innerShadows || []).map(function (s, i) { return shadowItem('innerShadows', s, i); }).join('') + btn('+ Add inner shadow', 'add-innerShadows') +
    (o.slot && doc.frontMask.includeInner ? '<div class="note">Slot inner shadows are drawn in the front mask, over the video.</div>' : '<div class="note">Inner shadows on a slot sit under the video unless the Mask tab moves them to the front mask.</div>'), nIn > 0, nIn ? nIn + '' : 'none');
  h += csec('stGlow', 'Outer glow', row('c2', fChk('Glow on', 'style.glow.enabled') + fColor('Colour', 'style.glow.color')) + row('c3', fNum('Blur', 'style.glow.blur', { min: 0 }) + fNum('Spread', 'style.glow.spread') + fNum('Opacity %', 'style.glow.opacity', { k: 100, min: 0, max: 100 })), !!st.glow.enabled, st.glow.enabled ? '' : 'off');
  h += csec('stEdges', 'Knockout, shadow only, feather', row('c2', fNum('Soft edge feather px', 'style.feather', { min: 0, step: 0.5 }) + '<span></span>') +
    row('c2', fChk('Knockout', 'style.knockout', { title: 'Clear the fill and everything beneath inside the shape, so the source shows through cleanly.' }) + fChk('Shadow only', 'style.shadowOnly', { title: 'Draw only shadows and glow. No fill or border.' })) +
    '<div class="note">Knockout cuts a clean hole in the back plate where the source sits. Shadow only keeps just the shadows and glow.</div>', false, [st.knockout ? 'knockout' : '', st.shadowOnly ? 'shadow only' : '', st.feather ? 'feather ' + fmt(st.feather) : ''].filter(Boolean).join(', '));
  h += csec('stCss', 'CSS box-shadow', '<textarea id="cssShadow" rows="2" placeholder="0 16px 48px rgba(0,0,0,.55), inset 0 2px 6px #0008" spellcheck="false"></textarea>' + row('c2', btn('Apply to selection', 'cssApply') + btn('Copy as CSS', 'cssCopy')), false, 'paste or copy');
  return h;
}

function tabVmix() {
  var v = doc.vmix, o = firstSel(), h = '';
  var conn = csec('vmConn', 'vMix connection', row('c2', fTxt('vMix host', 'vmix.host', { doc: 1 }) + fNum('Port', 'vmix.port', { doc: 1, min: 1, max: 65535 })) +
    row('c2', fTxt('Back plate input (name / number)', 'vmix.input', { doc: 1 }) + fTxt('Front mask input', 'vmix.maskInput', { doc: 1 })) +
    row('c2', fNum('Front mask layer (0 = auto)', 'vmix.maskLayer', { doc: 1, min: 0, max: 10 }) + fSel('Position method', 'vmix.method', [['zoompan', 'Zoom + Pan + Crop'], ['rectangle', 'Rectangle (px) + Crop']], { doc: 1 })) +
    row('c3', fNum('Output W', 'vmix.outW', { doc: 1, min: 16, max: 8192 }) + fNum('Output H', 'vmix.outH', { doc: 1, min: 16, max: 8192 }) + '<div class="f"><label>&nbsp;</label>' + btn('= canvas', 'outMatch') + '</div>') +
    '<div class="note">Output size = vMix Settings &gt; Display preset resolution. Pixel values (Rectangle) use it; zoom and pan do not depend on it.</div>' +
    row('c2', fSel('Send via', 'vmix.sendMode', [['direct', 'Direct (fire and forget)'], ['relay', 'Relay helper (confirmed)']], { doc: 1, rebuild: 1 }) + (v.sendMode === 'relay' ? fTxt('Relay URL', 'vmix.relay', { doc: 1 }) : '<span></span>')) +
    (v.sendMode === 'relay' ? row('c2', fTxt('Web Controller user', 'vmix.user', { doc: 1, ph: 'only if a password is set' }) + '<div class="f"><label>Password (not saved)</label><input type="password" id="vmPass" value="' + esc(session.pass) + '"></div>') + row('c3', btn('Test relay', 'relayPing') + btn('Read back', 'verify') + '<span></span>') : '<div class="note">Direct sends from this page cannot see vMix\'s reply (no CORS headers), and Chrome may block LAN addresses. Use the relay helper for confirmation, read back and password support.</div>'), false, esc(v.host + ':' + v.port) + ' · ' + (v.sendMode === 'relay' ? 'relay' : 'direct'));
  h += '<div id="vmSrc">' + (o && o.slot && sel.length === 1 ? sourceSection(o) : !o ? '<p class="note">Click a video slot to set its source and see its vMix values.</p>' : '') + '</div><div id="vmComputed"></div>';
  h += conn + '<div id="verifyOut"></div>';
  return h;
}
function sourceSection(o) {
  return sec('Source for "' + esc(o.name || 'Slot') + '"', row('c2', fTxt('vMix source input', 'src.source', { ph: 'e.g. Cam 1 or 3' }) + fNum('Layer (0 = auto)', 'src.layer', { min: 0, max: 10 })) +
    row('c3', fSel('Source aspect', 'src.aspect', Object.keys(PIPE.ASPECTS).map(function (k) { return [k, k]; }).concat([['custom', 'Custom']]), { rebuild: 1 }) +
      fSel('Placement', 'src.mode', [['fill', 'Fill (crop)'], ['fit', 'Fit (letterbox)']]) + '<span></span>') +
    (o.src.aspect === 'custom' ? row('c2', fNum('Aspect W', 'src.cw', { min: 0.01, step: 0.01 }) + fNum('Aspect H', 'src.ch', { min: 0.01, step: 0.01 })) : ''));
}
function cmdList(cmds) {
  return cmds.map(function (c, i) { return '<div class="cmd"><code title="' + esc(c.url) + '">' + esc(c.url) + '</code><button data-act="copyUrl" data-url="' + esc(c.url) + '">Copy</button></div>'; }).join('');
}
function refreshComputed() {
  var box = $('#vmComputed');
  if (box) {
    var o = firstSel(), h = '', v = doc.vmix;
    if (o && o.slot && sel.length === 1) {
      var vm = PIPE.vmixFor(doc, o), cmds = PIPE.slotCommands(doc, o);
      h += sec('vMix values · Layer ' + vm.layer, '<div class="kv">' +
        kv('Zoom', fmt(vm.zoom), 'SetLayer' + vm.layer + 'Zoom · 1 = 100%') + kv('PanX', fmt(vm.panX), '-2…2, + = right') + kv('PanY', fmt(vm.panY), '-2…2, + = up') +
        kv('Crop X1 Y1', fmt(vm.crop[0]) + ', ' + fmt(vm.crop[1]), '0 = none') + kv('Crop X2 Y2', fmt(vm.crop[2]) + ', ' + fmt(vm.crop[3]), '1 = none') +
        kv('Rectangle', [vm.placed.x, vm.placed.y, vm.placed.w, vm.placed.h].map(function (n) { return fmt(n, 2); }).join(', '), 'X,Y,W,H output px, uncropped') +
        kv('Visible', fmt(vm.visible.x, 2) + ', ' + fmt(vm.visible.y, 2) + '  ' + fmt(vm.visible.w, 2) + '×' + fmt(vm.visible.h, 2), 'what the video covers') + '</div>' +
        cmdList(cmds) + row('c2', btn('Copy slot', 'copySlot') + btn('Send slot to vMix', 'sendSlot')));
    } else if (o && !o.slot) h += '<p class="note">"' + esc(o.name) + '" is a decoration. Tick "Video slot" on the Object tab to place a source in it.</p>';
    var groups = PIPE.allCommands(doc);
    h += sec('All slots', '<table class="vt"><tr><th>Slot</th><th>L</th><th>Zoom</th><th>PanX</th><th>PanY</th><th>Crop</th></tr>' +
      PIPE.sortedSlots(doc).map(function (s) { var m = PIPE.vmixFor(doc, s); return '<tr><td>' + esc(PIPE.slotLabel(s)) + '</td><td>' + m.layer + '</td><td>' + fmt(m.zoom, 4) + '</td><td>' + fmt(m.panX, 4) + '</td><td>' + fmt(m.panY, 4) + '</td><td>' + m.crop.map(function (n) { return fmt(n, 3); }).join(',') + '</td></tr>'; }).join('') +
      '<tr><td>Front mask</td><td>' + PIPE.maskLayerOf(doc) + '</td><td>1</td><td>0</td><td>0</td><td>0,0,1,1</td></tr></table>' +
      row('c3', btn('Copy all', 'copyAll') + btn('Send all', 'sendAll') + btn('Setup text', 'copySetup')) +
      '<div class="note">Commands include SetLayer to assign each source when a source input is named, and LayerOn.</div>');
    box.innerHTML = h;
    syncFieldsIn(box);
  }
  var ei = $('#edgeInfo'); if (ei) { var so = firstSel(); if (so) ei.textContent = fmt(so.x + so.w, 2) + ', ' + fmt(so.y + so.h, 2) + '  ·  centre ' + fmt(so.x + so.w / 2, 2) + ', ' + fmt(so.y + so.h / 2, 2); }
  updateWarnings();
}
function syncFieldsIn(root) {
  $$('[data-b]', root).forEach(function (el) {
    var m = modelFor(el); if (!m) return; var v = getPath(m, el.dataset.b);
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'number') el.value = v == null ? '' : fmt(v * (+el.dataset.k || 1), 3); else el.value = v == null ? '' : v;
  });
}
function kv(k, v, n) { return '<span class="k">' + k + '</span><span class="v">' + v + '</span><span class="note">' + (n || '') + '</span>'; }

function tabMask() {
  var fm = doc.frontMask, h = '';
  h += sec('Front mask surround', fSel('Material outside the slot window', 'frontMask.surround', [['backplate', 'Back plate art (recommended)'], ['color', 'Solid colour'], ['none', 'None (borders only)']], { doc: 1, rebuild: 1 }) +
    (fm.surround === 'color' ? row('c3', fColor('Colour', 'frontMask.color', { doc: 1 }) + fNum('Opacity %', 'frontMask.alpha', { doc: 1, k: 100, min: 0, max: 100 }) + fSel('Covers', 'frontMask.scope', [['slots', 'Video areas'], ['canvas', 'Whole canvas']], { doc: 1 })) : '') +
    '<div class="note">' + (fm.surround === 'backplate' ? 'Copies the back plate into the video area outside each slot window, so the video corners take the back plate\'s look. Only covers pixels the video occupies, so nothing is doubled.' : fm.surround === 'color' ? 'A solid colour outside the windows. "Whole canvas" makes the mask a full frame graphic with holes.' : 'No surround: the mask carries only borders, inner shadows and highlights. Video corners stay square.') + '</div>');
  h += sec('Drawn over the video', fChk('Slot borders in the front mask', 'frontMask.includeStroke', { doc: 1, rebuild: 1 }) + fChk('Slot inner shadows in the front mask', 'frontMask.includeInner', { doc: 1, rebuild: 1 }) +
    '<div class="note">When on, these are left out of the back plate so nothing doubles up.</div>');
  h += csec('mkHi', 'Inner edge highlight', row('c2', fChk('On', 'frontMask.highlight.enabled', { doc: 1 }) + fColor('Colour', 'frontMask.highlight.color', { doc: 1 })) +
    row('c3', fNum('Width', 'frontMask.highlight.width', { doc: 1, min: 0, step: 0.5 }) + fNum('Blur', 'frontMask.highlight.blur', { doc: 1, min: 0 }) + fNum('Opacity %', 'frontMask.highlight.opacity', { doc: 1, k: 100, min: 0, max: 100 })) +
    '<div class="note">A soft light line just inside every slot edge, over the video.</div>', !!fm.highlight.enabled, fm.highlight.enabled ? '' : 'off');
  h += sec('Checks', '<div id="warnList"></div>');
  return h;
}
function allWarnings() { return (R.warnings || []).concat(PIPE.lint(doc)); }
function updateWarnings() {
  var w = allWarnings(), el = $('#stWarn'), errs = w.filter(function (x) { return x.level === 'error'; }).length;
  el.innerHTML = w.length ? '<span class="' + (errs ? 'err' : 'warn') + '" id="warnLink">⚠ ' + w.length + ' check' + (w.length > 1 ? 's' : '') + '</span>' : '<span style="color:var(--ok)">✓ checks pass</span>';
  var wl = $('#warnList');
  if (wl) wl.innerHTML = w.length ? w.map(function (x) { return '<div class="warnbox' + (x.level === 'error' ? ' error' : '') + '" data-wid="' + (x.id || '') + '">' + esc(x.msg) + '</div>'; }).join('') : '<div class="note">No problems found.</div>';
}
$('#stWarn').addEventListener('click', function () { setTab('mask'); });
tb.addEventListener('click', function (e) { var w = e.target.closest('[data-wid]'); if (w && w.dataset.wid && objById(w.dataset.wid)) { sel = [w.dataset.wid]; selectionChanged(); } });

function tabProject() {
  var h = '';
  h += sec('Export', row('c2', fTxt('File name prefix', 'exportOpts.baseName', { doc: 1 }) + '<span></span>') +
    fChk('Dither (stops banding in soft shadows and gradients)', 'exportOpts.dither', { doc: 1 }) + fChk('Edge colour padding (safe if vMix scales the PNG)', 'exportOpts.edgePad', { doc: 1 }) +
    row('c2', btn('Export Pack (ZIP)', 'pack', ' class="primary"') + btn('Back plate PNG', 'expBack')) + row('c2', btn('Front mask PNG', 'expFront') + btn('Preview PNG', 'expPreview')) +
    '<div class="note">All PNGs are exactly ' + doc.canvas.w + '×' + doc.canvas.h + ' px, 8-bit straight (non-premultiplied) alpha, no gamma or colour profile chunks.</div>');
  h += sec('Canvas', row('c3', '<div class="f"><label>Width</label><input type="number" id="pW" min="16" max="8192" value="' + doc.canvas.w + '"></div><div class="f"><label>Height</label><input type="number" id="pH" min="16" max="8192" value="' + doc.canvas.h + '"></div><div class="f"><label>&nbsp;</label>' + btn('Apply size', 'applySize') + '</div>') +
    '<label class="f inline"><input type="checkbox" id="pScale" checked>Scale objects and styles with the canvas (same aspect only)</label>');
  h += sec('Project file', row('c3', btn('New…', 'newDoc') + btn('Open…', 'open') + btn('Save', 'save')) + row('c2', btn('Layouts…', 'templates') + btn('Clear autosave', 'clearAuto')) +
    '<div class="note">Autosave keeps the current project in this browser after every change. Save the JSON for anything you need to keep.</div>');
  h += csec('prKeys', 'Keyboard shortcuts', '<div class="keys">' + SHORTCUTS.slice(0, 8).map(function (s) { return '<kbd>' + s[0] + '</kbd><span>' + s[1] + '</span>'; }).join('') + '</div>' + btn('All shortcuts', 'help'), false);
  return h;
}

// ---------------- actions ----------------
function copyText(t, what) {
  function ok() { toast((what || 'Copied') + ' to clipboard'); }
  if (navigator.clipboard && window.isSecureContext !== false) { navigator.clipboard.writeText(t).then(ok, function () { fallbackCopy(t) ? ok() : toast('Copy failed', true); }); }
  else fallbackCopy(t) ? ok() : toast('Copy failed', true);
}
function fallbackCopy(t) { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var r = false; try { r = document.execCommand('copy'); } catch (e) { } ta.remove(); return r; }
function newShadow(inner) { return { enabled: true, x: 0, y: inner ? 4 : 12, blur: inner ? 12 : 40, spread: 0, color: '#000000', opacity: 0.5 }; }
var ACTIONS = {
  lockAr: function () { setLockAspect(!ui.lockAspect); buildTab(); },
  centerH: function () { selObjs().forEach(function (o) { o.x = (doc.canvas.w - o.w) / 2; }); syncFields(); commit(); },
  centerV: function () { selObjs().forEach(function (o) { o.y = (doc.canvas.h - o.h) / 2; }); syncFields(); commit(); },
  match169: function () { selObjs().forEach(function (o) { var a = PIPE.aspectOf(o.src); o.h = Math.round(o.w / a); }); syncFields(); commit(); },
  circle: function () { selObjs().forEach(function (o) { var m = Math.min(o.w, o.h); o.w = o.h = m; }); syncFields(); commit(); },
  toFront: function () { reorder(2); }, toBack: function () { reorder(-2); }, fwd: function () { reorder(1); }, bwd: function () { reorder(-1); },
  dup: function () { duplicate(20, 20); }, del: function () { deleteSel(); },
  'add-shadows': function () { selObjs().forEach(function (o) { o.style.shadows.push(newShadow(false)); }); commit(); buildTab(); },
  'add-innerShadows': function () { selObjs().forEach(function (o) { o.style.innerShadows.push(newShadow(true)); }); commit(); buildTab(); },
  'rm-shadows': function (b) { var i = +b.dataset.i; selObjs().forEach(function (o) { o.style.shadows.splice(i, 1); }); commit(); buildTab(); },
  'rm-innerShadows': function (b) { var i = +b.dataset.i; selObjs().forEach(function (o) { o.style.innerShadows.splice(i, 1); }); commit(); buildTab(); },
  addStop: function () { selObjs().forEach(function (o) { o.style.fill.stops.push({ pos: 50, color: '#808080', alpha: 1 }); }); commit(); buildTab(); },
  rmStop: function (b) { var i = +b.dataset.i; selObjs().forEach(function (o) { if (o.style.fill.stops.length > 2) o.style.fill.stops.splice(i, 1); }); commit(); buildTab(); },
  presetApply: function () {
    var p = allPresets()[+$('#presetSel').value]; if (!p) return;
    selObjs().forEach(function (o) { var keepKO = o.slot; o.style = PIPE.clone(p.style); if (!keepKO && !p.builtin) { } if (p.corners && o.type === 'rrect') { o.radii = p.corners.radii.slice(); o.cornerStyle = p.corners.cornerStyle; o.smooth = p.corners.smooth; } });
    commit(); buildTab(); toast('Applied "' + p.name + '"');
  },
  presetSave: function () {
    var o = firstSel(); if (!o) return;
    var name = prompt('Preset name (e.g. Client Brand):', 'Client Brand'); if (!name) return;
    var list = userPresets().filter(function (p) { return p.name !== name; });
    var p = { name: name, style: PIPE.clone(o.style) };
    if (o.type === 'rrect') p.corners = { radii: o.radii.slice(), cornerStyle: o.cornerStyle, smooth: o.smooth };
    list.push(p); setUserPresets(list); presetPick = BUILTIN_PRESETS.length + list.length - 1; buildTab(); toast('Saved preset "' + name + '"');
  },
  presetDel: function () {
    var i = +$('#presetSel').value, p = allPresets()[i]; if (!p) return;
    if (p.builtin) { toast('Built-in presets cannot be deleted.'); return; }
    if (!confirm('Delete preset "' + p.name + '"?')) return;
    var list = userPresets().filter(function (x) { return x.name !== p.name; }); setUserPresets(list); presetPick = 0; buildTab();
  },
  presetExport: function () { download('pip_style_presets.json', JSON.stringify({ app: 'vmix-pip-builder', presets: userPresets() }, null, 2), 'application/json'); },
  presetImport: function () { $('#filePresets').click(); },
  cssApply: function () {
    var parsed = parseBoxShadow($('#cssShadow').value); if (!parsed) { toast('Could not read that box-shadow.', true); return; }
    selObjs().forEach(function (o) { o.style.shadows = parsed.outer; o.style.innerShadows = parsed.inner; });
    commit(); buildTab(); toast('Applied ' + (parsed.outer.length + parsed.inner.length) + ' shadow(s)');
  },
  cssCopy: function () { var o = firstSel(); if (o) copyText(toBoxShadow(o.style), 'CSS box-shadow copied'); },
  outMatch: function () { doc.vmix.outW = doc.canvas.w; doc.vmix.outH = doc.canvas.h; commit(); buildTab(); },
  copyUrl: function (b) { copyText(b.dataset.url, 'URL copied'); },
  copySlot: function () { var o = firstSel(); if (o) copyText(PIPE.slotCommands(doc, o).map(function (c) { return c.url; }).join('\n'), 'Slot commands copied'); },
  copyAll: function () { copyText(PIPE.allCommands(doc).map(function (g) { return '# ' + g.label + '\n' + g.cmds.map(function (c) { return c.url; }).join('\n'); }).join('\n\n'), 'All commands copied'); },
  copySetup: function () { copyText(PIPE.setupText(doc), 'Setup text copied'); },
  sendSlot: function () { var o = firstSel(); if (o) sendCommands(PIPE.slotCommands(doc, o)); },
  sendAll: function () { var all = []; PIPE.allCommands(doc).forEach(function (g) { all = all.concat(g.cmds); }); sendCommands(all); },
  relayPing: function () { relayPing(); },
  verify: function () { verifyReadBack(); },
  applySize: function () { setCanvasSize(+$('#pW').value, +$('#pH').value, $('#pScale').checked); },
  pack: function () { exportPack(); }, expBack: function () { exportPlane('back'); }, expFront: function () { exportPlane('front'); }, expPreview: function () { exportPreviewOnly(); },
  newDoc: function () { if (!confirm('Start a new blank project? (Undo can bring the current one back.)')) return; var d = PIPE.newDoc(doc.canvas.w, doc.canvas.h); d.vmix = doc.vmix; d.frontMask = PIPE.newDoc().frontMask; doc = d; sel = []; commit(); buildAll(); fitView(); },
  open: function () { $('#fileOpen').click(); }, save: function () { saveProject(); }, templates: function () { openTemplates(); },
  clearAuto: function () { try { localStorage.removeItem(LS_AUTO); } catch (e) { } toast('Autosave cleared (it will save again on the next change).'); },
  help: function () { openHelp(); }
};
tb.addEventListener('change', function (e) {
  if (e.target.id === 'presetSel') presetPick = +e.target.value;
  if (e.target.id === 'linkR') linkRadii = e.target.checked;
  if (e.target.id === 'vmPass') session.pass = e.target.value;
});
tb.addEventListener('input', function (e) { if (e.target.id === 'vmPass') session.pass = e.target.value; });

// ---------------- CSS box-shadow ----------------
function splitTop(s) { var out = [], d = 0, cur = ''; for (var i = 0; i < s.length; i++) { var c = s[i]; if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur); return out; }
function cssColor(t) {
  t = t.trim().toLowerCase();
  if (t === 'black') return ['#000000', 1]; if (t === 'white') return ['#ffffff', 1]; if (t === 'transparent') return ['#000000', 0];
  var m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) { var hx = m[1]; if (hx.length === 3 || hx.length === 4) hx = hx.split('').map(function (c) { return c + c; }).join(''); var a = hx.length === 8 ? parseInt(hx.slice(6), 16) / 255 : 1; return ['#' + hx.slice(0, 6), a]; }
  m = t.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    var p = m[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    var ch = p.slice(0, 3).map(function (v) { return v.indexOf('%') > 0 ? Math.round(parseFloat(v) * 2.55) : Math.round(+v); });
    var al = p[3] != null ? (p[3].indexOf('%') > 0 ? parseFloat(p[3]) / 100 : +p[3]) : 1;
    return ['#' + ch.map(function (v) { return ('0' + PIPE.clamp(v, 0, 255).toString(16)).slice(-2); }).join(''), al];
  }
  return null;
}
function parseBoxShadow(s) {
  if (!s || !s.trim()) return null;
  s = s.replace(/^\s*box-shadow\s*:\s*/i, '').replace(/;\s*$/, '');
  var outer = [], inner = [], ok = true;
  splitTop(s).forEach(function (part) {
    var inset = /\binset\b/i.test(part); part = part.replace(/\binset\b/ig, ' ');
    var col = ['#000000', 1], cm = part.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|\bblack\b|\bwhite\b|\btransparent\b)/i);
    if (cm) { var c = cssColor(cm[1]); if (c) col = c; part = part.replace(cm[1], ' '); }
    var n = part.trim().split(/\s+/).filter(Boolean).map(function (v) { return parseFloat(v); });
    if (n.length < 2 || n.some(isNaN)) { ok = false; return; }
    var sh = { enabled: true, x: n[0], y: n[1], blur: n[2] || 0, spread: n[3] || 0, color: col[0], opacity: col[1] };
    (inset ? inner : outer).push(sh);
  });
  return ok && (outer.length || inner.length) ? { outer: outer, inner: inner } : null;
}
function toBoxShadow(st) {
  function one(s, inset) { var c = PIPE.parseColor(s.color); return (inset ? 'inset ' : '') + s.x + 'px ' + s.y + 'px ' + s.blur + 'px ' + s.spread + 'px rgba(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ',' + fmt(s.opacity, 3) + ')'; }
  var parts = (st.shadows || []).filter(function (s) { return s.enabled !== false; }).map(function (s) { return one(s, false); }).concat((st.innerShadows || []).filter(function (s) { return s.enabled !== false; }).map(function (s) { return one(s, true); }));
  return 'box-shadow: ' + (parts.join(', ') || 'none') + ';';
}
