// Test suite for a built copy of the app. Usage:
//   node tests/run.mjs [index.test.html] [--quick] [--require-browser]
// Static checks, then the render engine in Node (exports decoded and checked pixel by pixel,
// vMix values round-tripped), then the real page in Chromium through Playwright (editing,
// Export Pack, presets, save/open, autosave, sending to a stand-in vMix and the relay).
// --quick skips the browser. Without Playwright installed the browser part is skipped, unless
// --require-browser (or CI) is set, in which case that is a failure.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = resolve(root, args.find(a => !a.startsWith('--')) || 'index.test.html');
const QUICK = args.includes('--quick');
const REQUIRE_BROWSER = args.includes('--require-browser') || !!process.env.CI;
const OUT = join(root, 'test-output');
mkdirSync(OUT, { recursive: true });

let passed = 0; const failures = [];
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failures.push(msg); console.log('  ✗ ' + msg); } }
function section(t) { console.log('\n' + t); }

// ---------- PNG and ZIP readers (independent of the app's writers) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function decodePNG(buf) {
  buf = Buffer.from(buf);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let i = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, crcOk = true; const idat = [], chunks = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i), t = buf.toString('latin1', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + n);
    if (buf.readUInt32BE(i + 8 + n) !== crc32(buf.subarray(i + 4, i + 8 + n))) crcOk = false;
    chunks.push(t);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
    if (t === 'IDAT') idat.push(d);
    i += 12 + n;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2) || il) throw new Error('unsupported PNG ' + bd + '/' + ct + '/' + il);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = raw[s + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  let rgba = px;
  if (bpp === 3) { rgba = new Uint8Array(w * h * 4); for (let p = 0; p < w * h; p++) { rgba[p * 4] = px[p * 3]; rgba[p * 4 + 1] = px[p * 3 + 1]; rgba[p * 4 + 2] = px[p * 3 + 2]; rgba[p * 4 + 3] = 255; } }
  return { w, h, px: rgba, chunks, crcOk, colorType: ct };
}
function readZip(buf) {
  buf = Buffer.from(buf);
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no zip directory');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const files = {}; let crcOk = true;
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (method !== 0) throw new Error('compressed entry ' + name);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    if (crc32(data) !== crc) crcOk = false;
    files[name] = data; p += 46 + nl + xl + cl;
  }
  return { files, crcOk };
}

// ---------- pack checks (shared by the engine-built and the browser-exported packs) ----------
const ASP = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '21:9': 21 / 9, '17:9 (DCI)': 256 / 135, '3:2': 1.5, '5:4': 1.25 };
function checkPack(zipBuf, label) {
  const z = readZip(zipBuf), names = Object.keys(z.files);
  ok(z.crcOk, `${label}: zip entries pass CRC`);
  const pj = names.find(n => n.endsWith('_project.json'));
  ok(!!pj && names.includes('vMix_setup.txt') && names.includes('alpha_test.png'), `${label}: pack has ${names.length} files: ${names.join(', ')}`);
  if (!pj) return;
  const base = pj.slice(0, -'_project.json'.length), doc = JSON.parse(z.files[pj].toString('utf8'));
  const W = doc.canvas.w, H = doc.canvas.h, img = {};
  for (const k of ['backplate', 'frontmask', 'preview']) {
    const d = decodePNG(z.files[`${base}_${k}.png`]); img[k] = d;
    ok(d.w === W && d.h === H && d.colorType === 6 && d.crcOk, `${label}: ${k}.png is ${d.w}x${d.h} RGBA 8-bit (canvas ${W}x${H})`);
    ok(!d.chunks.some(c => ['gAMA', 'iCCP', 'sRGB', 'cHRM'].includes(c)), `${label}: ${k}.png has no gamma or colour-profile chunks`);
  }
  const back = img.backplate.px, front = img.frontmask.px, A = (px, x, y) => px[(y * W + x) * 4 + 3];
  const fm = doc.frontMask, slots = doc.objects.filter(o => o.slot && !o.hidden);
  for (const o of slots) {
    if (![o.x, o.y, o.w, o.h].every(Number.isInteger)) continue;
    const { x, y, w, h } = o, st = o.style, cx = x + (w >> 1), cy = y + (h >> 1), tol = o.type === 'ellipse' ? 1 : 0;
    if (st.knockout) {
      const v = [A(back, x, cy), A(back, x + w - 1, cy), A(back, cx, y), A(back, cx, y + h - 1)];
      ok(Math.max(...v) <= tol, `${label}: ${o.name}: back plate is clear right up to the slot edge [${v}]`);
    }
    if (!(fm.includeInner && st.innerShadows && st.innerShadows.length) && !fm.highlight.enabled) {
      const v = [A(front, x, cy), A(front, x + w - 1, cy), A(front, cx, y), A(front, cx, y + h - 1)];
      ok(Math.max(...v) <= tol, `${label}: ${o.name}: front mask window is clear at the slot edge [${v}]`);
    }
    const s = st.stroke;
    if (fm.includeStroke && s.enabled && s.align === 'outside' && s.width >= 2) {
      const want = Math.round(s.alpha * 255), v = [A(front, x - 1, cy), A(front, x + w, cy), A(front, cx, y - 1), A(front, cx, y + h)];
      ok(v.every(a => Math.abs(a - want) <= 1), `${label}: ${o.name}: border starts on the first pixel outside the slot [${v}] (alpha ${want})`);
      const i = (cy * W + x - 1) * 4, col = '#' + [0, 1, 2].map(c => front[i + c].toString(16).padStart(2, '0')).join('');
      ok(col === s.color.toLowerCase(), `${label}: ${o.name}: border colour is exact (${col})`);
    }
    if (fm.surround === 'backplate' && o.type === 'rrect' && Math.min(...o.radii) >= 8 && o.src.mode === 'fill' && A(back, x, y) === 255) {
      const i = (y * W + x) * 4, same = [0, 1, 2, 3].every(c => front[i + c] === back[i + c]);
      ok(same, `${label}: ${o.name}: front mask covers the video corner with the exact back plate pixel`);
    }
  }
  // straight alpha: pixels that are only shadow keep the exact shadow colour, however faint
  const cols = new Set(); doc.objects.forEach(o => o.style.shadows.forEach(sh => { if (sh.enabled !== false) cols.add(sh.color.toLowerCase()); }));
  if (cols.size === 1 && !doc.objects.some(o => o.style.glow.enabled)) {
    const cov = new Uint8Array(W * H);
    for (const o of doc.objects) {
      if (o.hidden) continue; const p = o.style.stroke.width + 2;
      for (let yy = Math.max(0, Math.floor(o.y - p)); yy < Math.min(H, Math.ceil(o.y + o.h + p + 1)); yy++) cov.fill(1, yy * W + Math.max(0, Math.floor(o.x - p)), yy * W + Math.min(W, Math.ceil(o.x + o.w + p + 1)));
    }
    const want = [...cols][0], wr = parseInt(want.slice(1, 3), 16), wg = parseInt(want.slice(3, 5), 16), wb = parseInt(want.slice(5, 7), 16);
    let n = 0, faint = 0, err = 0;
    for (let p = 0; p < W * H; p++) {
      const a = back[p * 4 + 3]; if (cov[p] || a === 0 || a === 255) continue;
      n++; if (a <= 8) faint++;
      err = Math.max(err, Math.abs(back[p * 4] - wr), Math.abs(back[p * 4 + 1] - wg), Math.abs(back[p * 4 + 2] - wb));
    }
    if (n) ok(err === 0, `${label}: ${n} shadow-only pixels (${faint} at alpha 1-8) keep the exact shadow colour (max error ${err})`);
  }
  if (doc.exportOpts.edgePad) {
    let t = 0, nonBlack = 0;
    for (let p = 0; p < W * H; p++) if (back[p * 4 + 3] === 0) { t++; if (back[p * 4] || back[p * 4 + 1] || back[p * 4 + 2]) nonBlack++; }
    if (t && t < W * H) ok(true, `${label}: ${t} transparent pixels carry padded edge colour (${nonBlack} non-black)`);
  }
  // the values printed in vMix_setup.txt put each source exactly on its slot
  const txt = z.files['vMix_setup.txt'].toString('utf8'), OW = doc.vmix.outW, OH = doc.vmix.outH;
  for (const o of slots) {
    const esc = o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = txt.match(new RegExp(esc + '\\s+\\(Layer (\\d+)[^\\n]*\\r?\\n\\s+Zoom (\\S+)\\s+PanX (\\S+)\\s+PanY (\\S+)\\r?\\n\\s+Crop X1 (\\S+)\\s+Y1 (\\S+)\\s+X2 (\\S+)\\s+Y2 (\\S+)'));
    if (!m) { ok(false, `${label}: ${o.name}: values found in vMix_setup.txt`); continue; }
    const L = +m[1], [zm, px, py, c1, c2, c3, c4] = m.slice(2).map(Number);
    const a = o.src.aspect === 'custom' ? o.src.cw / o.src.ch : ASP[o.src.aspect];
    const [fw, fh] = a >= OW / OH ? [OW, OW / a] : [OH * a, OH], pw = fw * zm, ph = fh * zm;
    const ccx = OW / 2 + px * OW / 2, ccy = OH / 2 - py * OH / 2;
    const vis = [ccx - pw / 2 + c1 * pw, ccy - ph / 2 + c2 * ph, (c3 - c1) * pw, (c4 - c2) * ph];
    const t = [o.x * OW / W, o.y * OH / H, o.w * OW / W, o.h * OH / H];
    if (o.src.mode !== 'fit') {
      const e = Math.max(...vis.map((v, i) => Math.abs(v - t[i])));
      ok(e < 0.01, `${label}: ${o.name} (layer ${L}): setup-text Zoom ${zm} PanX ${px} PanY ${py} Crop ${c1},${c2},${c3},${c4} lands on the slot within ${e.toFixed(5)} px`);
    } else {
      const inside = vis[0] >= t[0] - 0.01 && vis[1] >= t[1] - 0.01 && vis[0] + vis[2] <= t[0] + t[2] + 0.01 && vis[1] + vis[3] <= t[1] + t[3] + 0.01;
      ok(inside && Math.min(Math.abs(vis[2] - t[2]), Math.abs(vis[3] - t[3])) < 0.01, `${label}: ${o.name} (layer ${L}): fit mode sits inside the slot and touches two edges`);
    }
    const urls = txt.split(/\s+/).filter(u => u.includes('Function=SetLayer' + L));
    ok(urls.length >= 2 && urls.every(u => u.startsWith('http://') && u.includes('&Input=')), `${label}: ${o.name}: ${urls.length} SetLayer${L} API URLs`);
  }
  const at = decodePNG(z.files['alpha_test.png']);
  ok(at.px[3] === 0 && at.px[(at.w - 1) * 4 + 3] === 255, `${label}: alpha_test.png ramps 0 to 255`);
  return doc;
}

// ---------- 1. static ----------
section('Static: ' + basename(target));
ok(existsSync(target), 'file exists');
if (!existsSync(target)) finish();
const html = readFileSync(target, 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
ok(scripts.length === 2, `${scripts.length} inline scripts (render engine and app)`);
scripts.forEach((m, i) => { try { new vm.Script(m[2], { filename: 'script' + i }); ok(true, `script ${i + 1} parses`); } catch (e) { ok(false, `script ${i + 1} parses: ${e.message}`); } });
ok(!/<script[^>]+\ssrc=|<link[^>]+href=["']?https?:/i.test(html), 'no external scripts or stylesheets (works offline)');
ok(!/<!--#include /.test(html), 'no unbuilt include markers');
const engineSrc = (html.match(/<script id="engine-src">([\s\S]*?)<\/script>/) || [])[1];
ok(!!engineSrc, 'render engine block present');

// ---------- 2. engine ----------
section('Engine (Node)');
const PIPE = new Function(engineSrc + '\nreturn PIPE;')();
{
  // documented vMix conventions
  const d = PIPE.newDoc(1920, 1080);
  const tr = PIPE.newObject('rrect', 960, 0, 960, 540, { name: 'TR' });
  const v = PIPE.vmixFor(d, tr);
  ok(v.zoom === 0.5 && v.panX === 0.5 && v.panY === 0.5 && v.crop.join() === '0,0,1,1', 'top-right quarter = Zoom 0.5, PanX 0.5, PanY 0.5 (Pan 2 = one frame, PanY + = up)');
  const full = PIPE.newObject('rrect', 0, 0, 1920, 1080); full.src.aspect = '4:3';
  const v2 = PIPE.vmixFor(d, full);
  ok(Math.abs(v2.zoom - 4 / 3) < 1e-12 && v2.crop.map(n => +n.toFixed(6)).join() === '0,0.125,1,0.875', '4:3 source filling 16:9 = Zoom 1.3333, Crop 0,0.125,1,0.875 (X2/Y2 1 = no crop)');
  full.src.mode = 'fit'; const v3 = PIPE.vmixFor(d, full);
  ok(v3.zoom === 1 && v3.crop.join() === '0,0,1,1' && v3.visible.w === 1440, '4:3 source fit in 16:9 = Zoom 1, pillarboxed to 1440 px');
  // round trip over sizes, aspects and modes
  let worst = 0, n = 0, fitBad = 0;
  for (const [CW, CH, OW, OH] of [[1280, 720, 1280, 720], [1920, 1080, 1920, 1080], [3840, 2160, 3840, 2160], [3840, 2160, 1920, 1080], [1920, 1080, 3840, 2160]]) {
    const dd = PIPE.newDoc(CW, CH); dd.vmix.outW = OW; dd.vmix.outH = OH;
    for (const asp of Object.keys(PIPE.ASPECTS)) for (const mode of ['fill', 'fit']) for (const [x, y, w, h] of [[37, 41, 640, 360], [CW - 513, CH - 300, 480, 270], [100, 80, 333, 777], [0, 0, CW, CH]]) {
      const o = PIPE.newObject('rrect', x, y, w, h); o.src.aspect = asp; o.src.mode = mode;
      const r = PIPE.vmixFor(dd, o), vis = PIPE.vmixVisibleRect(OW, OH, PIPE.aspectOf(o.src), +PIPE.fmt(r.zoom), +PIPE.fmt(r.panX), +PIPE.fmt(r.panY), r.crop.map(c => +PIPE.fmt(c)));
      const t = [x * OW / CW, y * OH / CH, w * OW / CW, h * OH / CH]; n++;
      if (mode === 'fill') worst = Math.max(worst, Math.abs(vis.x - t[0]), Math.abs(vis.y - t[1]), Math.abs(vis.w - t[2]), Math.abs(vis.h - t[3]));
      else if (vis.x < t[0] - 0.01 || vis.y < t[1] - 0.01 || vis.x + vis.w > t[0] + t[2] + 0.01 || vis.y + vis.h > t[1] + t[3] + 0.01) fitBad++;
    }
  }
  ok(worst < 0.01 && fitBad === 0, `${n} slot/aspect/mode/resolution cases round-trip through the 6-decimal values (worst ${worst.toFixed(5)} px)`);
  // source crop
  const cs = PIPE.newObject('rrect', 480, 0, 960, 1080); cs.src.crop = { l: 0.25, t: 0, r: 0.25, b: 0 };
  const vc = PIPE.vmixFor(d, cs);
  ok(Math.abs(vc.zoom - 1) < 1e-9 && Math.abs(vc.panX) < 1e-9 && Math.abs(vc.panY) < 1e-9 && vc.crop.map(n => +n.toFixed(6)).join() === '0.25,0,0.75,1', 'cropping 25 % off each side of a 16:9 source fills a centred 960x1080 box at Zoom 1, Pan 0, Crop 0.25,0,0.75,1');
  const cs2 = PIPE.newObject('rrect', 100, 100, 600, 400); cs2.src.crop = { l: 0.1, t: 0.2, r: 0, b: 0 };
  const vc2 = PIPE.vmixFor(d, cs2);
  ok(vc2.crop[0] >= 0.1 - 1e-9 && vc2.crop[1] >= 0.2 - 1e-9 && Math.abs(vc2.visible.x - 100) < 1e-6 && Math.abs(vc2.visible.w - 600) < 1e-6 && Math.abs(vc2.visible.h - 400) < 1e-6, 'an off-centre crop still fills the box exactly, with the user crop inside the vMix crop');
  let cworst = 0, cn = 0, keepWorst = 0, fitAsp = 0, rng = 7;
  const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (const [CW, CH, OW, OH] of [[1920, 1080, 1920, 1080], [3840, 2160, 1920, 1080], [1280, 720, 1280, 720]]) {
    const dd = PIPE.newDoc(CW, CH); dd.vmix.outW = OW; dd.vmix.outH = OH;
    for (let i = 0; i < 60; i++) {
      const asp = Object.keys(PIPE.ASPECTS)[i % 8], mode = i % 3 ? 'fill' : 'fit';
      const o = PIPE.newObject('rrect', Math.round(rnd() * CW * 0.5), Math.round(rnd() * CH * 0.5), Math.round(80 + rnd() * CW * 0.4), Math.round(60 + rnd() * CH * 0.4));
      o.src.aspect = asp; o.src.mode = mode; o.src.crop = { l: rnd() * 0.3, t: rnd() * 0.3, r: rnd() * 0.3, b: rnd() * 0.3 };
      const r = PIPE.vmixFor(dd, o), vis = PIPE.vmixVisibleRect(OW, OH, PIPE.aspectOf(o.src), +PIPE.fmt(r.zoom), +PIPE.fmt(r.panX), +PIPE.fmt(r.panY), r.crop.map(c => +PIPE.fmt(c)));
      const t = [o.x * OW / CW, o.y * OH / CH, o.w * OW / CW, o.h * OH / CH]; cn++;
      if (mode === 'fill') cworst = Math.max(cworst, Math.abs(vis.x - t[0]), Math.abs(vis.y - t[1]), Math.abs(vis.w - t[2]), Math.abs(vis.h - t[3]));
      else if (Math.abs(vis.w / vis.h - PIPE.croppedAspect(o.src) * (OH / CH) / (OW / CW) * (OW / CW) / (OH / CH)) > 0.002 || Math.abs(vis.x + vis.w / 2 - (t[0] + t[2] / 2)) > 0.01) fitAsp++;
      // crop on canvas: trimming the box over the fixed picture must leave the picture where it was
      const kx = CW / OW, ky = CH / OH, P = { x: r.placed.x * kx, y: r.placed.y * ky, w: r.placed.w * kx, h: r.placed.h * ky };
      const vb = { x: Math.max(o.x, P.x), y: Math.max(o.y, P.y) }; vb.w = Math.min(o.x + o.w, P.x + P.w) - vb.x; vb.h = Math.min(o.y + o.h, P.y + P.h) - vb.y;
      const b = { x: vb.x + vb.w * 0.1, y: vb.y + vb.h * 0.05, w: vb.w * 0.7, h: vb.h * 0.8 };
      const o2 = JSON.parse(JSON.stringify(o)); Object.assign(o2, b);
      o2.src.crop = { l: (b.x - P.x) / P.w, t: (b.y - P.y) / P.h, r: (P.x + P.w - b.x - b.w) / P.w, b: (P.y + P.h - b.y - b.h) / P.h };
      const r2 = PIPE.vmixFor(dd, o2);
      keepWorst = Math.max(keepWorst, Math.abs(r2.placed.x - r.placed.x), Math.abs(r2.placed.y - r.placed.y), Math.abs(r2.placed.w - r.placed.w), Math.abs(r2.placed.h - r.placed.h), Math.abs(r2.zoom - r.zoom) * 1000);
    }
  }
  ok(cworst < 0.01 && fitAsp === 0, `${cn} cropped slots round-trip through the 6-decimal values (worst ${cworst.toFixed(5)} px; fit keeps the cropped shape, centred)`);
  ok(keepWorst < 1e-6, `trimming a box over its picture keeps the picture's size and position in vMix (worst ${keepWorst.toExponential(1)})`);
  const oldCrop = PIPE.migrate({ objects: [{ type: 'rrect', x: 0, y: 0, w: 10, h: 10, src: { aspect: '4:3' } }] });
  ok(oldCrop.objects[0].src.crop && oldCrop.objects[0].src.crop.l === 0 && oldCrop.objects[0].src.aspect === '4:3', 'projects saved before crop existed load uncropped');
  // lint
  const many = PIPE.newDoc(1920, 1080);
  for (let i = 0; i < 10; i++) many.objects.push(PIPE.newObject('rrect', (i % 5) * 380, i < 5 ? 0 : 540, 300, 200, { slotNum: i + 1, name: 'S' + i }));
  ok(PIPE.lint(many).some(w => w.level === 'error' && /10 layers/.test(w.msg)), 'more than 9 slots is flagged (10 layers per input)');
  many.objects = [PIPE.newObject('rrect', 0, 0, 500, 300, { name: 'A' }), PIPE.newObject('rrect', 400, 200, 500, 300, { name: 'B' })];
  ok(PIPE.lint(many).some(w => /overlap/.test(w.msg)), 'overlapping slots are flagged');
  const old = PIPE.migrate({ canvas: { w: 1280, h: 720 }, objects: [{ type: 'ellipse', x: 1, y: 2, w: 3, h: 4 }] });
  ok(old.objects[0].style.shadows && old.vmix.port === 8088 && old.frontMask.surround === 'backplate', 'older or partial project files load with defaults filled in');
  // a soft coloured glow keeps its exact colour in the PNG (the browser canvas export does not)
  const g = PIPE.newDoc(800, 400), go = PIPE.newObject('rect', 250, 150, 300, 100, { slot: false });
  go.style = PIPE.defaultStyle(); go.style.fill.enabled = false; go.style.stroke.enabled = false; go.style.shadowOnly = true;
  go.style.shadows = [{ enabled: true, x: 0, y: 0, blur: 120, spread: 0, color: '#3d9bff', opacity: 1 }]; g.objects = [go];
  const gr = PIPE.render(g, { scale: 1, dither: true });
  const gd = decodePNG(await PIPE.encodePNG(gr.back, gr.W, gr.H));
  let gn = 0, gerr = 0, fl = 0, sumA = 0;
  for (let p = 0; p < gd.w * gd.h; p++) { const a = gd.px[p * 4 + 3]; if (!a) continue; gn++; sumA += a; if (a <= 16) fl++; gerr = Math.max(gerr, Math.abs(gd.px[p * 4] - 0x3d), Math.abs(gd.px[p * 4 + 1] - 0x9b), Math.abs(gd.px[p * 4 + 2] - 0xff)); }
  ok(gerr === 0 && fl > 1000, `120 px #3d9bff glow: ${gn} visible pixels (${fl} at alpha 1-16), colour error ${gerr}`);
  const gu = PIPE.render(g, { scale: 1, dither: false }); let sumU = 0; for (let p = 3; p < gu.back.length; p += 4) sumU += gu.back[p];
  ok(Math.abs(sumA - sumU) / sumU < 0.002, `dithering keeps total opacity unbiased (${(100 * (sumA - sumU) / sumU).toFixed(3)} %)`);
  // packs built straight from the engine
  const slot = (n, name, x, y, w, h, src) => { const o = PIPE.newObject('rrect', x, y, w, h, { name, slotNum: n }); Object.assign(o.src, src || {}); return o; };
  const cases = [
    { name: 'pip720_overlay', W: 1280, H: 720, objs: () => [slot(1, 'PIP', 853, 461, 384, 216)] },
    { name: 'mixed1080', W: 1920, H: 1080, objs: () => {
      const bg = PIPE.newObject('rect', 0, 0, 1920, 1080, { name: 'Background', slot: false }); bg.style.shadows = []; bg.style.stroke.enabled = false;
      const e = PIPE.newObject('ellipse', 1460, 80, 380, 380, { name: 'Round Cam', slotNum: 3 });
      return [bg, slot(1, 'Slides43', 80, 120, 960, 720, { aspect: '4:3' }), slot(2, 'Portrait', 1100, 80, 220, 392, { aspect: '9:16', mode: 'fit' }), e,
        slot(4, 'Square fit', 1100, 600, 340, 340, { mode: 'fit' }), slot(5, 'Scope', 1540, 640, 340, 280, { aspect: 'custom', cw: 2.39, ch: 1 })];
    } },
    { name: 'canvas4k_out1080', W: 3840, H: 2160, out: [1920, 1080], objs: () => [slot(1, 'Cam 1', 200, 300, 1600, 900), slot(2, 'Cam 2', 2040, 300, 1600, 900)] }
  ];
  for (const c of cases) {
    const d = PIPE.newDoc(c.W, c.H); d.objects = c.objs(); if (c.out) { d.vmix.outW = c.out[0]; d.vmix.outH = c.out[1]; }
    d.exportOpts.baseName = c.name;
    const t0 = Date.now(), r = PIPE.render(d, { scale: 1, dither: true, edgePad: true });
    const [b, f, a] = await Promise.all([PIPE.encodePNG(r.back, r.W, r.H), PIPE.encodePNG(r.front, r.W, r.H), PIPE.encodePNG(PIPE.alphaTest(1024, 256), 1024, 256)]);
    const zip = PIPE.makeZip([{ name: c.name + '_backplate.png', data: b }, { name: c.name + '_frontmask.png', data: f }, { name: c.name + '_preview.png', data: b },
      { name: c.name + '_project.json', data: JSON.stringify(d) }, { name: 'vMix_setup.txt', data: PIPE.setupText(d) }, { name: 'alpha_test.png', data: a }]);
    console.log(`  · ${c.name}: rendered and encoded in ${Date.now() - t0} ms`);
    checkPack(zip, c.name);
  }
}

// ---------- 3. browser ----------
if (QUICK) { console.log('\n(--quick: browser checks skipped)'); finish(); }
section('Browser (Chromium)');
const pw = loadPlaywright();
if (!pw) {
  const msg = 'Playwright not installed: npm i --no-save playwright && npx playwright install chromium';
  if (REQUIRE_BROWSER) ok(false, msg); else console.log('  - skipped. ' + msg);
  finish();
}
await browserSuite(pw);
finish();

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch (e) { }
  try { return req(join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'playwright')); } catch (e) { }
  return null;
}
function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
async function browserSuite(pw) {
  // stand-in vMix Web API: applies SetLayer* calls, serves XML state, optional Basic auth
  const vmixLog = [], layers = {}; let auth = null;
  const inputs = [{ key: 'k1', number: 1, title: 'PIP Back Plate' }, { key: 'k2', number: 2, title: 'PIP Front Mask' }, { key: 'k3', number: 3, title: 'Cam A' }];
  const L = n => layers[n] || (layers[n] = { key: '', zoom: 1, panX: 0, panY: 0, crop: [0, 0, 1, 1] });
  const vmix = http.createServer((req, res) => {
    if (auth && req.headers.authorization !== 'Basic ' + Buffer.from(auth).toString('base64')) { res.writeHead(401); return res.end(); }
    const u = new URL(req.url, 'http://x'), f = u.searchParams.get('Function'), v = u.searchParams.get('Value') || '';
    if (f) {
      vmixLog.push({ f, input: u.searchParams.get('Input'), v }); let m;
      if (f === 'SetLayer') { const [i, s] = v.split(','); const t = inputs.find(x => x.title === s || String(x.number) === s); L(+i).key = t ? t.key : s; }
      else if ((m = f.match(/^SetLayer(\d+)(Zoom|PanX|PanY|Crop)$/))) { const l = L(+m[1]); if (m[2] === 'Crop') l.crop = v.split(',').map(Number); else l[m[2] === 'Zoom' ? 'zoom' : m[2] === 'PanX' ? 'panX' : 'panY'] = +v; }
      res.writeHead(200); return res.end('Function completed successfully.');
    }
    const ov = Object.keys(layers).sort((a, b) => a - b).map(n => { const l = layers[n]; return `<overlay index="${n - 1}" key="${l.key}"><position panX="${l.panX}" panY="${l.panY}" zoomX="${l.zoom}" zoomY="${l.zoom}"/><crop X1="${l.crop[0]}" Y1="${l.crop[1]}" X2="${l.crop[2]}" Y2="${l.crop[3]}"/></overlay>`; }).join('');
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<vmix><version>28.0.0.39</version><inputs>' + inputs.map(i => `<input key="${i.key}" number="${i.number}" type="Image" title="${i.title}">${i.number === 1 ? ov : ''}</input>`).join('') + '</inputs></vmix>');
  });
  const vmixPort = await listen(vmix);
  const relayPort = 20000 + Math.floor(Math.random() * 20000);
  const relay = spawn(process.execPath, [join(root, 'vmix-relay.js'), '--port', String(relayPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r, j) => { relay.stdout.on('data', d => { if (/relay .* on http/.test(String(d))) r(); }); relay.on('exit', c => j(new Error('relay exited ' + c))); setTimeout(() => j(new Error('relay did not start')), 5000); }).catch(e => ok(false, e.message));

  const browser = await pw.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true, permissions: ['camera'] });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const url = pathToFileURL(target).href, isTest = /\.test\.html$/.test(target);
  const docOf = () => p.evaluate(() => JSON.parse(JSON.stringify(__pip.doc)));
  const rendered = () => p.waitForFunction(() => __pip.render.back && !__pip.render.busy && !__pip.render.dirty, null, { timeout: 30000 });
  const download = async (fn) => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), fn()]); return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) }; };
  try {
    // production autosave must survive a test build session (and the other way round)
    await p.goto(url);
    const otherKey = isTest ? 'vmixPipBuilder.autosave.v1' : 'test:vmixPipBuilder.autosave.v1';
    await p.evaluate(k => { localStorage.clear(); localStorage.setItem(k, '{"sentinel":true}'); }, otherKey);
    await p.reload(); await rendered();
    ok(errors.length === 0, 'page loads with no errors');
    const tag = await p.locator('.testtag').count();
    ok(isTest ? tag === 1 && (await p.title()).startsWith('TEST') : tag === 0, isTest ? 'TEST BUILD tag and title shown' : 'no TEST BUILD tag on production');

    // every layout preset fits every canvas size: slots inside the canvas, no overlaps, whole pixels, sequential slot numbers
    const presetIssues = await p.evaluate(() => {
      const bad = [], sizes = [[1280, 720], [1920, 1080], [3840, 2160], [1080, 1920], [2560, 1080]];
      for (const [w, h] of sizes) {
        __pip.setCanvasSize(w, h, false);
        __pip.templates.forEach((name, i) => {
          __pip.loadTemplate(i);
          const s = __pip.doc.objects.filter(o => o.slot);
          s.forEach((o, j) => {
            if (o.x < 0 || o.y < 0 || o.x + o.w > w + 1e-6 || o.y + o.h > h + 1e-6) bad.push(`${name} @${w}x${h}: ${o.name} outside canvas`);
            if (![o.x, o.y, o.w, o.h].every(Number.isInteger)) bad.push(`${name} @${w}x${h}: ${o.name} not whole pixels`);
            if (o.slotNum !== j + 1) bad.push(`${name}: slot numbers out of order`);
            s.slice(j + 1).forEach(q => { if (o.x < q.x + q.w && q.x < o.x + o.w && o.y < q.y + q.h && q.y < o.y + o.h) bad.push(`${name} @${w}x${h}: ${o.name} overlaps ${q.name}`); });
          });
        });
      }
      __pip.setCanvasSize(1920, 1080, false);
      return { bad, count: __pip.templates.length };
    });
    ok(presetIssues.count >= 15 && presetIssues.bad.length === 0, `all ${presetIssues.count} layout presets fit 720p, 1080p, 4K, portrait and ultrawide` + (presetIssues.bad.length ? ': ' + presetIssues.bad.slice(0, 5).join('; ') : ''));
    ok(await p.locator('#layoutsBtn').isVisible(), 'Layouts button visible in the top bar');
    await p.evaluate(() => __pip.loadTemplate(2)); await rendered();
    ok((await docOf()).objects.filter(o => o.slot).length === 4, '2 x 2 template loads 4 slots');
    // ratio lock: on by default, resizing keeps the shape, Shift breaks it once, the toggle unlocks it, K flips it
    ok(await p.evaluate(() => __pip.ui.lockAspect === true) && await p.locator('#lockArBtn.on').isVisible(), 'ratio lock is on by default and shown in the top bar');
    const vbox = await p.locator('#view').boundingBox();
    const scr = async (x, y) => { const v = await p.evaluate(() => ({ z: __pip.view.zoom, ox: __pip.view.ox, oy: __pip.view.oy })); return [vbox.x + v.ox + x * v.z, vbox.y + v.oy + y * v.z]; };
    const slot1 = async () => (await docOf()).objects.find(o => o.slot && o.slotNum === 1);
    const dragHandle = async (hx, hy, dx, dy, shift) => {
      const [sx, sy] = await scr(hx, hy);
      if (shift) await p.keyboard.down('Shift');
      await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + dx, sy + dy, { steps: 8 }); await p.mouse.up();
      if (shift) await p.keyboard.up('Shift');
    };
    let s1 = await slot1(); await p.evaluate(id => __pip.sel([id]), s1.id);
    await dragHandle(s1.x + s1.w, s1.y + s1.h / 2, -150, 40);
    let r1 = await slot1();
    ok(r1.w < s1.w && Math.abs(r1.w / r1.h - 16 / 9) < 0.006 && [r1.x, r1.y, r1.w, r1.h].every(Number.isInteger) && Math.abs((r1.y + r1.h / 2) - (s1.y + s1.h / 2)) <= 0.5, `dragging a side handle while locked scales the box and keeps 16:9 (${s1.w}x${s1.h} -> ${r1.w}x${r1.h})`);
    const pre = await slot1();
    for (let i = 0; i < 6; i++) { const c = await slot1(); await dragHandle(c.x + c.w, c.y + c.h, i % 2 ? 37 : -29, i % 2 ? 11 : -23); }
    r1 = await slot1();
    ok(Math.abs(r1.w / r1.h - 16 / 9) < 0.006 && r1.x === pre.x && r1.y === pre.y, `six corner drags in a row keep 16:9 without drift and keep the opposite corner fixed (${r1.w}x${r1.h})`);
    await dragHandle(r1.x + r1.w, r1.y + r1.h / 2, -120, 0, true);
    let r2 = await slot1();
    ok(r2.h === r1.h && r2.w < r1.w, `Shift + drag breaks the ratio for one drag (${r2.w}x${r2.h})`);
    await p.keyboard.press('Control+z'); await p.click('#lockArBtn');
    ok(await p.evaluate(() => __pip.ui.lockAspect === false) && (await p.locator('#lockArBtn').textContent()).includes('unlocked'), 'the top bar button unlocks the ratio');
    r1 = await slot1(); await dragHandle(r1.x + r1.w / 2, r1.y + r1.h, 0, 60);
    r2 = await slot1();
    ok(r2.w === r1.w && r2.h > r1.h, `unlocked, a side handle changes one side only (${r2.w}x${r2.h})`);
    await p.click('#tabs button[data-tab="object"]');
    await p.fill('#tabBody input[data-b="w"]', '500'); await p.press('#tabBody input[data-b="w"]', 'Enter');
    ok((await slot1()).w === 500 && (await slot1()).h === r2.h, 'unlocked, the W field leaves H alone');
    await p.locator('#tabBody input[data-b="w"]').blur();
    await p.keyboard.press('k');
    ok(await p.evaluate(() => __pip.ui.lockAspect === true) && await p.locator('#tabBody button[data-lockar].on').count() === 1, 'K locks it again, and the lock beside W / H follows');
    await p.reload(); await rendered();
    ok(await p.evaluate(() => __pip.ui.lockAspect === true), 'the lock setting survives a reload');
    await p.evaluate(async () => __pip.sel([__pip.doc.objects.find(o => o.slot).id])); await p.click('#tabs button[data-tab="object"]');
    await p.click('#tabBody button[data-lockar]'); await p.waitForTimeout(100);
    ok(await p.evaluate(() => __pip.ui.lockAspect === false) && !(await p.locator('#lockArBtn').getAttribute('class')).includes('on'), 'the lock beside W / H toggles the same setting');
    await p.click('#lockArBtn');
    // crop on the canvas: C enters crop mode, dragging an edge trims the box over a fixed picture, dragging inside moves the picture
    await p.evaluate(() => __pip.loadTemplate(2)); await rendered();
    let c1 = await slot1(); await p.evaluate(id => __pip.sel([id]), c1.id);
    const placedOf = () => p.evaluate(() => { const o = __pip.doc.objects.find(o => o.slot && o.slotNum === 1); return __pip.vmixFor(o).placed; });
    const pic0 = await placedOf();
    await p.keyboard.press('c');
    ok(await p.evaluate(() => !!__pip.cropId) && await p.locator('#tabBody [data-act="cropMode"].primary').count() === 1, 'C starts cropping the selected slot');
    await dragHandle(c1.x, c1.y + c1.h / 2, 120, 0);
    let c2 = await slot1(), pic1 = await placedOf();
    ok(c2.x > c1.x && c2.x + c2.w === c1.x + c1.w && c2.h === c1.h && c2.src.crop.l > 0.1 && Math.abs(pic1.x - pic0.x) < 1e-6 && Math.abs(pic1.w - pic0.w) < 1e-6, `dragging the left edge trims the picture and leaves it in place (crop left ${(c2.src.crop.l * 100).toFixed(1)} %; box ${c2.x},${c2.w}; picture moved ${(pic1.x - pic0.x).toExponential(1)})`);
    await dragHandle(c2.x, c2.y + c2.h / 2, -400, 0);
    c2 = await slot1();
    ok(c2.x === c1.x && c2.src.crop.l === 0, `the edge stops at the edge of the picture (x ${c2.x}, left ${c2.src.crop.l})`);
    await dragHandle(c2.x + c2.w, c2.y + c2.h / 2, -200, 0);
    c2 = await slot1(); const [mx, my] = await scr(c2.x + c2.w / 2, c2.y + c2.h / 2);
    await p.mouse.move(mx, my); await p.mouse.down(); await p.mouse.move(mx - 60, my, { steps: 6 }); await p.mouse.up();
    let c3 = await slot1();
    ok(c3.x === c2.x && c3.w === c2.w && c3.src.crop.l > c2.src.crop.l && c3.src.crop.r < c2.src.crop.r, `dragging inside moves the picture under the box (left / right crop ${(c2.src.crop.l * 100).toFixed(1)} / ${(c2.src.crop.r * 100).toFixed(1)} -> ${(c3.src.crop.l * 100).toFixed(1)} / ${(c3.src.crop.r * 100).toFixed(1)} %)`);
    await p.keyboard.press('Enter');
    ok(await p.evaluate(() => !__pip.cropId), 'Enter finishes cropping');
    await p.click('#tabs button[data-tab="object"]');
    await p.fill('#tabBody input[data-b="src.crop.t"]', '10'); await p.press('#tabBody input[data-b="src.crop.t"]', 'Enter');
    c3 = await slot1(); const pic3 = await placedOf();
    ok(Math.abs(c3.src.crop.t - 0.1) < 1e-6 && Math.abs(pic3.y - pic0.y) < 1e-6 && c3.y > c1.y, 'typing Top 10 % trims the top of the picture without moving it');
    const sent = await p.evaluate(() => { const o = __pip.doc.objects.find(o => o.slot && o.slotNum === 1); return __pip.vmixFor(o).crop; });
    ok(sent[1] >= 0.1 - 1e-9 && sent[2] < 1, `the vMix crop carries the trim (${sent.map(n => n.toFixed(4)).join(',')})`);
    const picR = await placedOf();
    await p.click('#tabBody [data-act="cropReset"]');
    c3 = await slot1();
    ok(c3.src.crop.l === 0 && c3.src.crop.r === 0 && c3.src.crop.t === 0 && c3.w === c1.w && c3.h === c1.h && c3.x === Math.round(picR.x) && c3.y === Math.round(picR.y), `Remove crop grows the box back to the whole picture where it sits (${c3.w}x${c3.h} at ${c3.x},${c3.y})`);
    // New project: one click, blank, undo brings the old one back
    const before = (await docOf()).objects.length;
    await p.click('#newBtn');
    ok((await docOf()).objects.length === 0 && (await docOf()).canvas.w === 1920, 'New starts a blank project at the same canvas size');
    await p.keyboard.press('Control+z');
    ok((await docOf()).objects.length === before, 'undo after New brings the previous project back');
    // View menu holds the work area and guide options
    ok(!(await p.locator('#bgMode').isVisible()), 'background options are tucked into the View menu');
    await p.click('#viewMenuBtn'); ok(await p.locator('#bgMode').isVisible() && await p.locator('#safeMode').isVisible(), 'View menu opens');
    await p.check('#showGrid'); ok(await p.locator('#viewMenu.open').count() === 1 && await p.evaluate(() => __pip.ui.showGrid), 'ticking an option keeps the menu open');
    await p.uncheck('#showGrid'); await p.mouse.click(vbox.x + 5, vbox.y + vbox.height - 5); ok(await p.locator('#viewMenu.open').count() === 0, 'clicking away closes the View menu');
    await p.evaluate(() => __pip.loadTemplate(2)); await rendered();
    const box = await p.locator('#view').boundingBox(), n0 = (await docOf()).objects.length;
    await p.keyboard.press('q');
    await p.mouse.move(box.x + 300, box.y + 300); await p.mouse.down(); await p.mouse.move(box.x + 420, box.y + 380, { steps: 6 }); await p.mouse.up();
    let d = await docOf(), last = d.objects[d.objects.length - 1];
    ok(d.objects.length === n0 + 1 && last.cornerStyle === 'squircle' && [last.x, last.y, last.w, last.h].every(Number.isInteger), `drawing a squircle snaps to whole pixels (${last.x},${last.y} ${last.w}x${last.h})`);
    ok(Math.abs(last.w / last.h - 16 / 9) < 0.01, `with the ratio locked, a new box is drawn 16:9 (${last.w}x${last.h})`);
    await p.fill('#tabBody input[data-b="w"]', '640'); await p.press('#tabBody input[data-b="w"]', 'Enter');
    ok((await docOf()).objects.at(-1).w === 640 && (await docOf()).objects.at(-1).h === 360, `numeric W field resizes the object and keeps 16:9 (${(await docOf()).objects.at(-1).h})`);
    await p.locator('#tabBody input[data-b="w"]').blur();
    const x0 = (await docOf()).objects.at(-1).x;
    await p.keyboard.press('Shift+ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(450);
    ok((await docOf()).objects.at(-1).x === x0 + 11, 'arrow nudges 1 px, Shift+arrow 10 px');
    await p.keyboard.press('Control+z'); ok((await docOf()).objects.at(-1).x === x0, 'undo');
    await p.keyboard.press('Control+Shift+z'); ok((await docOf()).objects.at(-1).x === x0 + 11, 'redo');
    await p.keyboard.press('Control+d'); ok((await docOf()).objects.length === n0 + 2, 'duplicate');
    await p.keyboard.press('Delete'); ok((await docOf()).objects.length === n0 + 1, 'delete');
    await p.evaluate(() => { const d = __pip.doc; __pip.sel([d.objects[d.objects.length - 1].id]); });
    await p.click('#tabs button[data-tab="style"]');
    if (!(await p.locator('#cssShadow').isVisible())) await p.click('details[data-sec="stCss"] > summary');
    await p.fill('#cssShadow', '0 20px 60px rgba(0,0,0,.6), inset 0 2px 8px #00000080'); await p.click('[data-act="cssApply"]');
    last = (await docOf()).objects.at(-1);
    ok(last.style.shadows.length === 1 && last.style.shadows[0].blur === 60 && Math.abs(last.style.shadows[0].opacity - 0.6) < 1e-9 && last.style.innerShadows.length === 1, 'CSS box-shadow paste sets drop and inner shadows');
    await p.keyboard.press('Delete');
    // style preset round trip
    p.once('dialog', dl => dl.accept('Client Brand'));
    await p.evaluate(() => __pip.sel([__pip.doc.objects.find(o => o.slotNum === 1).id]));
    await p.fill('#tabBody input[data-b="style.stroke.width"]', '9'); await p.press('#tabBody input[data-b="style.stroke.width"]', 'Tab');
    await p.click('[data-act="presetSave"]');
    await p.evaluate(() => __pip.sel([__pip.doc.objects.find(o => o.slotNum === 3).id]));
    await p.selectOption('#presetSel', { label: 'Client Brand ★' }); await p.click('[data-act="presetApply"]');
    ok((await docOf()).objects.find(o => o.slotNum === 3).style.stroke.width === 9, 'style preset saves and applies to another slot');
    const keys = await p.evaluate(() => __pip.keys);
    ok(isTest ? Object.values(keys).every(k => k.startsWith('test:')) : Object.values(keys).every(k => !k.startsWith('test:')), (isTest ? 'test build' : 'production') + ' uses its own storage keys');
    // vMix tab
    await p.evaluate(() => __pip.sel([__pip.doc.objects.find(o => o.slotNum === 1).id]));
    await p.click('#tabs button[data-tab="vmix"]');
    await p.fill('#tabBody input[data-b="src.source"]', 'Cam A'); await p.press('#tabBody input[data-b="src.source"]', 'Tab');
    const codes = await p.$$eval('#vmComputed code', els => els.map(e => e.textContent));
    ok(codes.some(c => c.includes('Function=SetLayer&') && c.includes('Value=1,Cam%20A')), 'slot commands include SetLayer with the source input');
    // send direct, then through the relay with a password, then read back
    await p.evaluate(([vp, rp]) => { const d = __pip.doc; d.vmix.port = vp; d.vmix.relay = 'http://127.0.0.1:' + rp; __pip.doc = d; }, [vmixPort, relayPort]);
    await p.click('#tabs button[data-tab="object"]'); await p.click('#tabs button[data-tab="vmix"]');
    vmixLog.length = 0; await p.click('[data-act="sendAll"]');
    await p.waitForFunction(() => /Sent \d+ commands|could not be sent/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    const directCount = vmixLog.length;
    ok(directCount > 10 && vmixLog.some(c => c.f === 'SetLayer' && c.v === '1,Cam A'), `direct send from the page reached vMix (${directCount} commands)`);
    auth = 'admin:secret';
    if (!(await p.locator('#tabBody select[data-b="vmix.sendMode"]').isVisible())) await p.click('details[data-sec="vmConn"] > summary');
    await p.selectOption('#tabBody select[data-b="vmix.sendMode"]', 'relay');
    await p.fill('#tabBody input[data-b="vmix.user"]', 'admin'); await p.press('#tabBody input[data-b="vmix.user"]', 'Tab'); await p.fill('#vmPass', 'secret');
    vmixLog.length = 0; await p.click('[data-act="sendAll"]');
    await p.waitForFunction(() => /accepted all|failed|not reachable/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    ok(vmixLog.length === directCount && /accepted all/.test(await p.textContent('#toast')), `relay send with Basic auth confirmed (${vmixLog.length} commands)`);
    await p.click('[data-act="verify"]'); await p.waitForFunction(() => /Read back|failed/.test(document.getElementById('verifyOut').textContent), null, { timeout: 15000 });
    let vt = await p.textContent('#verifyOut');
    ok(/✓ zoomX/.test(vt) && !/✗/.test(vt), 'read back: every reported value matches');
    layers[1].zoom = 0.5;
    await p.click('[data-act="verify"]'); await p.waitForFunction(() => /✗ zoomX 0.5/.test(document.getElementById('verifyOut').textContent), null, { timeout: 15000 }).catch(() => { });
    ok(/✗ zoomX 0.5/.test(await p.textContent('#verifyOut')), 'read back flags a value changed in vMix');
    auth = null;
    // Export Pack from the page, checked like the engine packs
    await p.evaluate(() => __pip.loadTemplate(4)); await rendered();
    let t0 = Date.now(); let dl = await download(() => p.click('#packBtn'));
    console.log(`  · 1080p Export Pack in ${Date.now() - t0} ms`);
    writeFileSync(join(OUT, dl.name), dl.data);
    checkPack(dl.data, 'browser 1080p');
    // single-file exports
    for (const k of ['back', 'front', 'preview', 'setup', 'alpha']) {
      await p.click('#exportMenuBtn'); const f = await download(() => p.click(`[data-exp="${k}"]`));
      ok(f.data.length > 0, `Export menu: ${k} -> ${f.name}`);
    }
    // 4K: canvas change scales the layout, export stays exact
    await p.evaluate(() => __pip.setCanvasSize(3840, 2160, true)); await rendered();
    const k4 = (await docOf()).objects.filter(o => o.slot).map(o => [o.x, o.y, o.w, o.h]);
    ok(JSON.stringify(k4) === '[[128,378,2496,1404],[2688,378,1024,576]]', '1080p layout scales to 4K exactly');
    t0 = Date.now(); dl = await download(() => p.click('#packBtn'));
    console.log(`  · 4K Export Pack in ${Date.now() - t0} ms`);
    checkPack(dl.data, 'browser 4K');
    // save, clear, open
    const saved = await download(() => p.keyboard.press('Control+s'));
    const sp = join(OUT, 'roundtrip_project.json'); writeFileSync(sp, saved.data);
    await p.evaluate(() => { const d = __pip.doc; d.objects = []; __pip.doc = d; });
    await p.setInputFiles('#fileOpen', sp); await p.waitForFunction(() => __pip.doc.objects.length > 0);
    ok((await docOf()).canvas.w === 3840 && (await docOf()).objects.filter(o => o.slot).length === 2, 'project JSON saves and reopens');
    await p.waitForTimeout(600); await p.reload(); await rendered();
    ok((await docOf()).canvas.w === 3840, 'autosave restores the session after reload');
    ok(await p.evaluate(k => localStorage.getItem(k), otherKey) === '{"sentinel":true}', 'the other build\'s autosave was not touched');
    // live camera in the slots
    await p.click('#viewMenuBtn'); await p.selectOption('#bgMode', 'camera'); await p.check('#sampleInSlots');
    await p.waitForFunction(() => document.getElementById('camVideo').readyState >= 2, null, { timeout: 10000 }).catch(() => { });
    ok(await p.evaluate(() => document.getElementById('camVideo').readyState >= 2), 'live camera preview runs');
    await p.screenshot({ path: join(OUT, 'screenshot.png') });
    ok(errors.length === 0, 'no page errors during the run' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    ok(false, 'browser run stopped: ' + (e && e.message || e).split('\n')[0]);
    await p.screenshot({ path: join(OUT, 'failure.png') }).catch(() => { });
  } finally {
    await browser.close(); relay.kill(); vmix.close();
  }
}

function finish() {
  console.log(`\n${passed} passed, ${failures.length} failed` + (failures.length ? ':\n  - ' + failures.join('\n  - ') : ''));
  process.exit(failures.length ? 1 : 0);
}
