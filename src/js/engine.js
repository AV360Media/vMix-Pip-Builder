/* vMix PIP Builder render engine.
   Shared by the UI thread, the render worker and the Node test harness.
   Pure JS, no DOM. All pixel math is Float32, premultiplied while compositing,
   converted to straight (non-premultiplied) 8-bit alpha only at the very end. */
var PIPE = (function () {
  'use strict';
  var VERSION = '1.0.0';

  // ---------- small utils ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function uid() { return 'o' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function parseColor(hex) {
    hex = String(hex || '#000000').trim();
    if (hex[0] === '#') hex = hex.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex.slice(0, 6), 16);
    if (isNaN(n)) n = 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function fmt(v, dp) {
    if (dp === undefined) dp = 6;
    var s = (+v).toFixed(dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  // ---------- document model ----------
  function defaultStyle() {
    return {
      fill: { enabled: true, type: 'solid', color: '#1a1f2b', alpha: 1, angle: 180, cx: 50, cy: 50, size: 100,
        stops: [{ pos: 0, color: '#2b3346', alpha: 1 }, { pos: 100, color: '#10131a', alpha: 1 }] },
      stroke: { enabled: true, width: 4, color: '#ffffff', alpha: 0.9, align: 'outside' },
      shadows: [{ enabled: true, x: 0, y: 16, blur: 48, spread: 0, color: '#000000', opacity: 0.55 }],
      innerShadows: [],
      glow: { enabled: false, blur: 32, spread: 0, color: '#3d9bff', opacity: 0.6 },
      feather: 0,
      knockout: true,
      shadowOnly: false
    };
  }
  function newObject(type, x, y, w, h, extra) {
    var o = {
      id: uid(), type: type, name: '', slot: type !== 'line' && type !== 'rect', slotNum: 0,
      x: x, y: y, w: w, h: h,
      radii: type === 'rrect' ? [24, 24, 24, 24] : [0, 0, 0, 0],
      cornerStyle: 'round', smooth: 4, caps: 'butt',
      plane: 'back', locked: false, hidden: false,
      style: defaultStyle(),
      src: { aspect: '16:9', cw: 16, ch: 9, mode: 'fill', source: '', layer: 0, crop: { l: 0, t: 0, r: 0, b: 0 } }
    };
    if (type === 'line') {
      o.style.stroke.enabled = false; o.style.shadows = []; o.style.knockout = false;
      o.style.fill.color = '#ffffff'; o.style.fill.alpha = 0.9;
    }
    if (type === 'rect') { o.style.knockout = false; }
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  function newDoc(w, h) {
    w = w || 1920; h = h || 1080;
    return {
      app: 'vmix-pip-builder', version: 1,
      canvas: { w: w, h: h },
      vmix: { host: '127.0.0.1', port: 8088, input: 'PIP Back Plate', maskInput: 'PIP Front Mask', maskLayer: 0,
        outW: w, outH: h, method: 'zoompan', sendMode: 'direct', relay: 'http://127.0.0.1:8089', user: '', pass: '' },
      frontMask: { surround: 'backplate', color: '#0b0d12', alpha: 1, scope: 'slots',
        includeStroke: true, includeInner: true,
        highlight: { enabled: false, width: 2, blur: 2, color: '#ffffff', opacity: 0.35 } },
      exportOpts: { dither: true, edgePad: true, baseName: 'pip' },
      objects: []
    };
  }
  // Fill in anything missing so older or hand-edited project files load safely.
  function migrate(d) {
    var base = newDoc(d && d.canvas ? d.canvas.w : 1920, d && d.canvas ? d.canvas.h : 1080);
    if (!d || typeof d !== 'object') return base;
    function merge(dst, src) {
      for (var k in src) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], src[k]);
        else if (src[k] !== undefined) dst[k] = src[k];
      }
      return dst;
    }
    var out = merge(base, d);
    out.objects = (d.objects || []).map(function (o) {
      var n = newObject(o.type || 'rrect', 0, 0, 100, 100);
      n.style = defaultStyle();
      merge(n, o);
      if (!Array.isArray(n.radii) || n.radii.length !== 4) n.radii = [0, 0, 0, 0];
      if (!Array.isArray(n.style.shadows)) n.style.shadows = [];
      if (!Array.isArray(n.style.innerShadows)) n.style.innerShadows = [];
      if (!n.id) n.id = uid();
      return n;
    });
    return out;
  }

  // ---------- geometry ----------
  function fitRadii(r, w, h) {
    var f = 1;
    function chk(sum, side) { if (sum > side && sum > 0) f = Math.min(f, side / sum); }
    chk(r[0] + r[1], w); chk(r[3] + r[2], w); chk(r[0] + r[3], h); chk(r[1] + r[2], h);
    return f < 1 ? r.map(function (v) { return v * f; }) : r;
  }
  // Shape descriptor in render pixels. spread follows CSS box-shadow rules.
  function shapeOf(o, spread, S, dx, dy) {
    spread = spread || 0; S = S || 1;
    var w = Math.max(0, +o.w), h = Math.max(0, +o.h);
    var x = +o.x + (dx || 0), y = +o.y + (dy || 0);
    var kind = o.type === 'ellipse' ? 'ellipse' : 'box';
    var r = [0, 0, 0, 0], n = 2;
    if (o.type === 'rrect') {
      r = (o.radii || [0, 0, 0, 0]).map(function (v) { return Math.max(0, +v || 0); });
      if (o.cornerStyle === 'squircle') n = clamp(+o.smooth || 4, 2, 12);
    } else if (o.type === 'line' && o.caps === 'round') {
      var m = Math.min(w, h) / 2; r = [m, m, m, m];
    }
    r = fitRadii(r, w, h);
    var W = w + 2 * spread, H = h + 2 * spread;
    if (W <= 0.01 || H <= 0.01) return null;
    if (kind === 'box' && spread !== 0) {
      r = r.map(function (ri) {
        if (ri <= 0) return 0;
        if (spread > 0 && ri < spread) { var q = ri / spread; return ri + spread * (1 + Math.pow(q - 1, 3)); }
        return Math.max(0, ri + spread);
      });
      r = fitRadii(r, W, H);
    }
    return { kind: kind, cx: (x + w / 2) * S, cy: (y + h / 2) * S, hw: W / 2 * S, hh: H / 2 * S,
      r: r.map(function (v) { return v * S; }), n: n };
  }
  function sdBox(sp, x, y) {
    var px = x - sp.cx, py = y - sp.cy;
    var r = px < 0 ? (py < 0 ? sp.r[0] : sp.r[3]) : (py < 0 ? sp.r[1] : sp.r[2]);
    var qx = (px < 0 ? -px : px) - sp.hw + r, qy = (py < 0 ? -py : py) - sp.hh + r;
    var ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, out;
    if (ox === 0) out = oy; else if (oy === 0) out = ox;
    else if (sp.n === 2) out = Math.sqrt(ox * ox + oy * oy);
    else out = Math.pow(Math.pow(ox, sp.n) + Math.pow(oy, sp.n), 1 / sp.n);
    var inn = qx > qy ? qx : qy; if (inn > 0) inn = 0;
    return inn + out - r;
  }
  function sdEllipse(sp, x, y) {
    var a = sp.hw, b = sp.hh;
    var px = Math.abs(x - sp.cx), py = Math.abs(y - sp.cy);
    if (Math.abs(a - b) < 1e-6) return Math.sqrt(px * px + py * py) - a;
    var tx = 0.70710678, ty = 0.70710678;
    for (var i = 0; i < 4; i++) {
      var ex = (a * a - b * b) * tx * tx * tx / a, ey = (b * b - a * a) * ty * ty * ty / b;
      var rx = a * tx - ex, ry = b * ty - ey, qx = px - ex, qy = py - ey;
      var r = Math.sqrt(rx * rx + ry * ry), q = Math.sqrt(qx * qx + qy * qy) || 1e-9;
      tx = clamp((qx * r / q + ex) / a, 0, 1); ty = clamp((qy * r / q + ey) / b, 0, 1);
      var t = Math.sqrt(tx * tx + ty * ty) || 1; tx /= t; ty /= t;
    }
    var dx = px - a * tx, dy = py - b * ty, d = Math.sqrt(dx * dx + dy * dy);
    return (px * px / (a * a) + py * py / (b * b) < 1) ? -d : d;
  }
  function sd(sp, x, y) { return sp.kind === 'ellipse' ? sdEllipse(sp, x, y) : sdBox(sp, x, y); }
  // Coverage of region d<0 for a pixel whose centre has signed distance d.
  function cov(d, f) {
    if (f > 0) { var t = 0.5 - d / f; if (t <= 0) return 0; if (t >= 1) return 1; return t * t * (3 - 2 * t); }
    var c = 0.5 - d; return c <= 0 ? 0 : c >= 1 ? 1 : c;
  }

  // ---------- masks ----------
  function Mask(x0, y0, w, h) { this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.d = new Float32Array(Math.max(0, w * h)); }
  function boundsOf(sp, pad, W, H, extra) {
    var e = extra || 0;
    var x0 = Math.floor(sp.cx - sp.hw - pad), y0 = Math.floor(sp.cy - sp.hh - pad);
    var x1 = Math.ceil(sp.cx + sp.hw + pad), y1 = Math.ceil(sp.cy + sp.hh + pad);
    x0 = Math.max(x0, -e); y0 = Math.max(y0, -e); x1 = Math.min(x1, W + e); y1 = Math.min(y1, H + e);
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }
  function raster(sp, b, fn) {
    var m = new Mask(b[0], b[1], b[2], b[3]), d = m.d, i = 0;
    for (var y = 0; y < m.h; y++) {
      var py = m.y0 + y + 0.5;
      for (var x = 0; x < m.w; x++) d[i++] = fn(sd(sp, m.x0 + x + 0.5, py));
    }
    return m;
  }
  function mulShape(m, sp, invert, f) {
    var d = m.d, i = 0;
    for (var y = 0; y < m.h; y++) {
      var py = m.y0 + y + 0.5;
      for (var x = 0; x < m.w; x++, i++) {
        if (d[i] === 0) continue;
        var c = cov(sd(sp, m.x0 + x + 0.5, py), f);
        d[i] *= invert ? 1 - c : c;
      }
    }
  }
  // Gaussian blur approximated by three box passes (the same approach browsers use for CSS shadows).
  function boxSizes(sigma, n) {
    var wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
    var wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    var wu = wl + 2;
    var mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    var m = Math.round(mIdeal), out = [];
    for (var i = 0; i < n; i++) out.push(i < m ? wl : wu);
    return out;
  }
  function boxH(s, t, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var y = 0; y < h; y++) {
      var row = y * w, ti = row, li = row, ri = row + r;
      var fv = s[row], lv = s[row + w - 1], val = (r + 1) * fv;
      for (var j = 0; j < r; j++) val += s[row + Math.min(j, w - 1)];
      for (var x = 0; x < w; x++) {
        var add = x + r < w ? s[row + x + r] : lv;
        var sub = x - r - 1 >= 0 ? s[row + x - r - 1] : fv;
        val += add - sub;
        t[ti++] = val * iarr;
      }
    }
  }
  function boxV(s, t, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var x = 0; x < w; x++) {
      var fv = s[x], lv = s[x + w * (h - 1)], val = (r + 1) * fv;
      for (var j = 0; j < r; j++) val += s[x + Math.min(j, h - 1) * w];
      for (var y = 0; y < h; y++) {
        var add = y + r < h ? s[x + (y + r) * w] : lv;
        var sub = y - r - 1 >= 0 ? s[x + (y - r - 1) * w] : fv;
        val += add - sub;
        t[x + y * w] = val * iarr;
      }
    }
  }
  function blur(m, sigma) {
    if (!(sigma > 0.25) || m.w === 0 || m.h === 0) return m;
    var sizes = boxSizes(sigma, 3), tmp = new Float32Array(m.d.length), a = m.d;
    for (var i = 0; i < 3; i++) {
      var r = (sizes[i] - 1) / 2;
      if (r < 1) continue;
      boxH(a, tmp, m.w, m.h, r); boxV(tmp, a, m.w, m.h, r);
    }
    return m;
  }

  // ---------- paint ----------
  function solidPaint(hex, alpha) { var c = parseColor(hex), a = clamp(+alpha, 0, 1); return { solid: [c[0] * a, c[1] * a, c[2] * a, a] }; }
  function gradientLUT(stops, mult) {
    var st = (stops || []).map(function (s) { return { p: clamp(+s.pos, 0, 100) / 100, c: parseColor(s.color), a: clamp(+s.alpha, 0, 1) * mult }; })
      .sort(function (a, b) { return a.p - b.p; });
    if (!st.length) st = [{ p: 0, c: [0, 0, 0], a: 0 }];
    var N = 1024, lut = new Float32Array(N * 4);
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1), k = 0;
      while (k < st.length - 1 && st[k + 1].p < t) k++;
      var A = st[k], B = st[Math.min(k + 1, st.length - 1)], u = 0;
      if (t <= st[0].p) { A = B = st[0]; }
      else if (t >= st[st.length - 1].p) { A = B = st[st.length - 1]; }
      else u = B.p > A.p ? (t - A.p) / (B.p - A.p) : 0;
      // interpolate premultiplied, like CSS
      for (var ch = 0; ch < 3; ch++) lut[i * 4 + ch] = A.c[ch] * A.a * (1 - u) + B.c[ch] * B.a * u;
      lut[i * 4 + 3] = A.a * (1 - u) + B.a * u;
    }
    return lut;
  }
  function fillPaint(fill, o, S) {
    if (!fill || fill.type === 'solid' || !fill.type) return solidPaint(fill ? fill.color : '#000', fill ? fill.alpha : 1);
    var lut = gradientLUT(fill.stops, clamp(+fill.alpha, 0, 1));
    var w = o.w * S, h = o.h * S, cx = (o.x + o.w / 2) * S, cy = (o.y + o.h / 2) * S;
    if (fill.type === 'linear') {
      var ang = (+fill.angle || 0) * Math.PI / 180, dx = Math.sin(ang), dy = -Math.cos(ang);
      var L = Math.abs(w * dx) + Math.abs(h * dy) || 1;
      return { lut: lut, t: function (x, y) { return ((x - cx) * dx + (y - cy) * dy) / L + 0.5; } };
    }
    var gx = (o.x + o.w * (+fill.cx / 100)) * S, gy = (o.y + o.h * (+fill.cy / 100)) * S;
    var sz = Math.max(0.01, (+fill.size || 100) / 100);
    var rw = Math.max(0.5, w / 2 * Math.SQRT2 * sz), rh = Math.max(0.5, h / 2 * Math.SQRT2 * sz);
    return { lut: lut, t: function (x, y) { var u = (x - gx) / rw, v = (y - gy) / rh; return Math.sqrt(u * u + v * v); } };
  }
  function paint(buf, W, H, m, p) {
    var x0 = Math.max(0, m.x0), y0 = Math.max(0, m.y0), x1 = Math.min(W, m.x0 + m.w), y1 = Math.min(H, m.y0 + m.h);
    var d = m.d, s = p.solid, lut = p.lut;
    for (var y = y0; y < y1; y++) {
      var mi = (y - m.y0) * m.w + (x0 - m.x0), bi = (y * W + x0) * 4;
      for (var x = x0; x < x1; x++, mi++, bi += 4) {
        var c = d[mi]; if (c <= 0) continue; if (c > 1) c = 1;
        var r, g, b, a;
        if (s) { r = s[0]; g = s[1]; b = s[2]; a = s[3]; }
        else { var t = p.t(x + 0.5, y + 0.5); t = t < 0 ? 0 : t > 1 ? 1 : t; var li = Math.round(t * 1023) * 4; r = lut[li]; g = lut[li + 1]; b = lut[li + 2]; a = lut[li + 3]; }
        var k = 1 - a * c;
        buf[bi] = r * c + buf[bi] * k; buf[bi + 1] = g * c + buf[bi + 1] * k;
        buf[bi + 2] = b * c + buf[bi + 2] * k; buf[bi + 3] = a * c + buf[bi + 3] * k;
      }
    }
  }
  function erase(buf, W, H, m) {
    var x0 = Math.max(0, m.x0), y0 = Math.max(0, m.y0), x1 = Math.min(W, m.x0 + m.w), y1 = Math.min(H, m.y0 + m.h);
    for (var y = y0; y < y1; y++) {
      var mi = (y - m.y0) * m.w + (x0 - m.x0), bi = (y * W + x0) * 4;
      for (var x = x0; x < x1; x++, mi++, bi += 4) {
        var c = m.d[mi]; if (c <= 0) continue; var k = c >= 1 ? 0 : 1 - c;
        buf[bi] *= k; buf[bi + 1] *= k; buf[bi + 2] *= k; buf[bi + 3] *= k;
      }
    }
  }

  // ---------- effect passes ----------
  function shadowPass(buf, W, H, o, S, sh, base, f) {
    if (!sh || sh.enabled === false || !(+sh.opacity > 0)) return;
    var sp = shapeOf(o, +sh.spread || 0, S, +sh.x || 0, +sh.y || 0);
    if (!sp) return;
    var sigma = Math.max(0, +sh.blur || 0) / 2 * S, pad = Math.ceil(sigma * 3) + 2;
    var m = raster(sp, boundsOf(sp, pad, W, H, pad), function (d) { return cov(d, f); });
    blur(m, sigma);
    mulShape(m, base, true, f); // CSS: outer shadows never paint under the box
    paint(buf, W, H, m, solidPaint(sh.color, sh.opacity));
  }
  function innerShadowPass(buf, W, H, o, S, sh, base, f) {
    if (!sh || sh.enabled === false || !(+sh.opacity > 0)) return;
    var hole = shapeOf(o, -(+sh.spread || 0), S, +sh.x || 0, +sh.y || 0);
    var sigma = Math.max(0, +sh.blur || 0) / 2 * S, pad = Math.ceil(sigma * 3) + 2 + Math.ceil(Math.max(Math.abs(+sh.x || 0), Math.abs(+sh.y || 0)) * S);
    var b = boundsOf(base, pad, W, H, pad);
    var m = hole ? raster(hole, b, function (d) { return 1 - cov(d, f); }) : (function () { var mm = new Mask(b[0], b[1], b[2], b[3]); mm.d.fill(1); return mm; })();
    blur(m, sigma);
    mulShape(m, base, false, f);
    paint(buf, W, H, m, solidPaint(sh.color, sh.opacity));
  }
  function strokeBand(st) {
    var w = Math.max(0, +st.width || 0);
    if (st.align === 'inside') return [-w, 0];
    if (st.align === 'center') return [-w / 2, w / 2];
    return [0, w];
  }
  function strokePass(buf, W, H, o, S, st, base, f) {
    if (!st || !st.enabled || !(+st.width > 0) || !(+st.alpha > 0)) return;
    var band = strokeBand(st), lo = band[0] * S, hi = band[1] * S;
    var m = raster(base, boundsOf(base, Math.max(0, hi) + f + 2, W, H, 0), function (d) {
      var v = cov(d - hi, f) - cov(d - lo, f); return v > 0 ? v : 0;
    });
    paint(buf, W, H, m, solidPaint(st.color, st.alpha));
  }
  function highlightPass(buf, W, H, o, S, hl, base, f) {
    if (!hl || !hl.enabled || !(+hl.width > 0) || !(+hl.opacity > 0)) return;
    var w = +hl.width * S, sigma = Math.max(0, +hl.blur || 0) / 2 * S, pad = Math.ceil(sigma * 3) + 2;
    var m = raster(base, boundsOf(base, pad, W, H, pad), function (d) { var v = cov(d, f) - cov(d + w, f); return v > 0 ? v : 0; });
    blur(m, sigma);
    mulShape(m, base, false, f);
    paint(buf, W, H, m, solidPaint(hl.color, hl.opacity));
  }
  function renderObject(buf, W, H, o, S, opt) {
    var st = o.style || {}, base = shapeOf(o, 0, S);
    if (!base) return;
    var f = Math.max(0, +st.feather || 0) * S;
    opt = opt || {};
    if (st.glow && st.glow.enabled) shadowPass(buf, W, H, o, S, { x: 0, y: 0, blur: st.glow.blur, spread: st.glow.spread, color: st.glow.color, opacity: st.glow.opacity }, base, f);
    (st.shadows || []).forEach(function (sh) { shadowPass(buf, W, H, o, S, sh, base, f); });
    if (!st.shadowOnly) {
      if (st.fill && st.fill.enabled !== false) {
        var m = raster(base, boundsOf(base, f + 2, W, H, 0), function (d) { return cov(d, f); });
        paint(buf, W, H, m, fillPaint(st.fill, o, S));
      }
      if (!opt.skipInner) (st.innerShadows || []).forEach(function (sh) { innerShadowPass(buf, W, H, o, S, sh, base, f); });
    }
    if (st.knockout || st.shadowOnly) {
      erase(buf, W, H, raster(base, boundsOf(base, f + 2, W, H, 0), function (d) { return cov(d, f); }));
    }
    if (!st.shadowOnly && !opt.skipStroke) strokePass(buf, W, H, o, S, st.stroke, base, f);
  }

  // ---------- plane renders ----------
  function slotsOf(doc) { return doc.objects.filter(function (o) { return o.slot && !o.hidden; }); }
  function renderBack(doc, S) {
    var W = Math.max(1, Math.round(doc.canvas.w * S)), H = Math.max(1, Math.round(doc.canvas.h * S));
    var buf = new Float32Array(W * H * 4), fm = doc.frontMask || {};
    doc.objects.forEach(function (o) {
      if (o.hidden) return;
      if (!o.slot && o.plane === 'front') return;
      renderObject(buf, W, H, o, S, { skipStroke: o.slot && fm.includeStroke, skipInner: o.slot && fm.includeInner });
    });
    return { W: W, H: H, buf: buf };
  }
  function slotRegion(o, S, W, H) {
    var sp = shapeOf(o, 0, S); if (!sp) return null;
    var f = Math.max(0, +(o.style && o.style.feather) || 0) * S;
    return { sp: sp, f: f, b: boundsOf(sp, f / 2 + 1, W, H, 0) };
  }
  function renderFront(doc, S, back) {
    var W = back.W, H = back.H, buf = new Float32Array(W * H * 4), fm = doc.frontMask || {};
    var slots = slotsOf(doc), regions = slots.map(function (o) {
      var rg = slotRegion(o, S, W, H); if (!rg) return null;
      // Surround only needs to cover pixels the video can occupy (its visible rect in vMix).
      var vm = vmixFor(doc, o), kx = doc.canvas.w / vm.outW * S, ky = doc.canvas.h / vm.outH * S, b = rg.b;
      var vx0 = Math.floor(vm.visible.x * kx + 1e-6), vy0 = Math.floor(vm.visible.y * ky + 1e-6);
      var vx1 = Math.ceil(vm.visible.x * kx + vm.visible.w * kx - 1e-6), vy1 = Math.ceil(vm.visible.y * ky + vm.visible.h * ky - 1e-6);
      var x0 = Math.max(b[0], vx0), y0 = Math.max(b[1], vy0), x1 = Math.min(b[0] + b[2], vx1), y1 = Math.min(b[1] + b[3], vy1);
      rg.fill = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
      return rg;
    }).filter(Boolean);
    // 1. surround material
    var col = solidPaint(fm.color, fm.alpha).solid, i;
    if (fm.surround === 'color' && fm.scope === 'canvas') {
      for (i = 0; i < W * H * 4; i += 4) { buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = col[3]; }
    } else if (fm.surround !== 'none') {
      var src = fm.surround === 'color' ? null : back.buf;
      regions.forEach(function (rg) {
        var b = rg.fill;
        for (var y = b[1]; y < b[1] + b[3]; y++) for (var x = b[0]; x < b[0] + b[2]; x++) {
          var k = (y * W + x) * 4;
          if (src) { buf[k] = src[k]; buf[k + 1] = src[k + 1]; buf[k + 2] = src[k + 2]; buf[k + 3] = src[k + 3]; }
          else { buf[k] = col[0]; buf[k + 1] = col[1]; buf[k + 2] = col[2]; buf[k + 3] = col[3]; }
        }
      });
    }
    // 2. cut a window per slot
    regions.forEach(function (rg) { erase(buf, W, H, raster(rg.sp, rg.b, function (d) { return cov(d, rg.f); })); });
    // 3. front material in stacking order
    doc.objects.forEach(function (o) {
      if (o.hidden) return;
      if (!o.slot) { if (o.plane === 'front') renderObject(buf, W, H, o, S, {}); return; }
      var st = o.style || {}, base = shapeOf(o, 0, S); if (!base) return;
      var f = Math.max(0, +st.feather || 0) * S;
      if (fm.includeInner && !st.shadowOnly) (st.innerShadows || []).forEach(function (sh) { innerShadowPass(buf, W, H, o, S, sh, base, f); });
      highlightPass(buf, W, H, o, S, fm.highlight, base, f);
      if (fm.includeStroke && !st.shadowOnly) strokePass(buf, W, H, o, S, st.stroke, base, f);
    });
    return { W: W, H: H, buf: buf };
  }

  // ---------- float -> straight 8-bit ----------
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296;
  }
  function dq(v, n) {
    var r = Math.round(v);
    if (v - r < 1e-3 && r - v < 1e-3) return r < 0 ? 0 : r > 255 ? 255 : r; // exact value: no noise
    r = Math.floor(v + hash(n)); return r < 0 ? 0 : r > 255 ? 255 : r;
  }
  function finalize(plane, opt) {
    opt = opt || {};
    var W = plane.W, H = plane.H, f = plane.buf, out = new Uint8ClampedArray(W * H * 4), dither = opt.dither !== false;
    for (var p = 0, i = 0; p < W * H; p++, i += 4) {
      var a = f[i + 3];
      if (!(a > 0.5 / 255 / 64)) continue; // effectively zero
      if (a > 1) a = 1;
      var r = f[i] / a, g = f[i + 1] / a, b = f[i + 2] / a;
      if (dither) {
        // stochastic rounding: unbiased, leaves exact colours untouched, breaks up banding
        out[i] = dq(r * 255, i); out[i + 1] = dq(g * 255, i + 1); out[i + 2] = dq(b * 255, i + 2); out[i + 3] = dq(a * 255, i + 3);
      } else {
        out[i] = Math.round(r * 255); out[i + 1] = Math.round(g * 255); out[i + 2] = Math.round(b * 255); out[i + 3] = Math.round(a * 255);
      }
      if (out[i + 3] === 0) { out[i] = out[i + 1] = out[i + 2] = 0; }
    }
    if (opt.edgePad) edgePad(out, W, H);
    return out;
  }
  // Give fully transparent pixels the colour of the nearest visible pixel so any
  // scaling or filtering in vMix never pulls black into soft edges.
  function edgePad(px, W, H) {
    var N = W * H, q = new Int32Array(N), seen = new Uint8Array(N), head = 0, tail = 0, i;
    for (i = 0; i < N; i++) if (px[i * 4 + 3] > 0) { seen[i] = 1; q[tail++] = i; }
    if (tail === 0 || tail === N) return;
    while (head < tail) {
      i = q[head++]; var x = i % W, s = i * 4;
      var nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (var k = 0; k < 4; k++) {
        var n = nb[k]; if (n < 0 || n >= N || seen[n]) continue;
        seen[n] = 1; var t = n * 4; px[t] = px[s]; px[t + 1] = px[s + 1]; px[t + 2] = px[s + 2]; q[tail++] = n;
      }
    }
  }

  // ---------- checks ----------
  function cornerCheck(doc, S, back) {
    var fm = doc.frontMask || {}, out = [];
    if (fm.surround !== 'backplate') return out;
    slotsOf(doc).forEach(function (o) {
      var rg = slotRegion(o, S, back.W, back.H); if (!rg) return;
      var b = rg.b, minA = 1, any = false;
      for (var y = b[1]; y < b[1] + b[3]; y++) for (var x = b[0]; x < b[0] + b[2]; x++) {
        if (sd(rg.sp, x + 0.5, y + 0.5) < 1 + rg.f) continue;
        // only pixels the video would cover
        if (x + 0.5 < rg.sp.cx - rg.sp.hw || x + 0.5 > rg.sp.cx + rg.sp.hw || y + 0.5 < rg.sp.cy - rg.sp.hh || y + 0.5 > rg.sp.cy + rg.sp.hh) continue;
        any = true; var a = back.buf[(y * back.W + x) * 4 + 3]; if (a < minA) minA = a;
      }
      if (any && minA < 0.98) out.push({ level: 'warn', id: o.id, msg: (o.name || 'Slot') + ': back plate is ' + (minA < 0.02 ? 'transparent' : 'semi-transparent') + ' behind the slot corners, so the front mask cannot fully round the video there. Add opaque art behind the slot, or use vMix layer Border radius.' });
    });
    return out;
  }
  function lint(doc) {
    var out = [], slots = slotsOf(doc), v = doc.vmix || {};
    if (slots.length > 9) out.push({ level: 'error', msg: slots.length + ' slots: a vMix input has 10 layers, so 9 sources plus the front mask is the limit.' });
    if (Math.abs(doc.canvas.w / doc.canvas.h - v.outW / v.outH) > 0.001) out.push({ level: 'warn', msg: 'Canvas aspect differs from vMix output ' + v.outW + 'x' + v.outH + '. vMix will scale the PNG to fit, so pixel values will not line up.' });
    for (var i = 0; i < slots.length; i++) {
      var a = slots[i];
      if (a.x < 0 || a.y < 0 || a.x + a.w > doc.canvas.w || a.y + a.h > doc.canvas.h) out.push({ level: 'warn', id: a.id, msg: (a.name || 'Slot') + ' extends past the canvas edge.' });
      for (var j = i + 1; j < slots.length; j++) {
        var b = slots[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
          out.push({ level: 'warn', id: b.id, msg: (a.name || 'Slot') + ' and ' + (b.name || 'Slot') + ' overlap. The back plate sits under every source, so a shadow cannot fall across another source.' });
      }
      var vm = vmixFor(doc, a);
      if (vm.zoom > 5) out.push({ level: 'error', id: a.id, msg: (a.name || 'Slot') + ': zoom ' + fmt(vm.zoom, 3) + ' is above the vMix maximum of 5.' });
      if (Math.abs(vm.panX) > 2 || Math.abs(vm.panY) > 2) out.push({ level: 'error', id: a.id, msg: (a.name || 'Slot') + ': pan is outside the vMix range of -2 to 2.' });
    }
    var layers = {};
    slots.forEach(function (o) { var L = layerOf(doc, o); if (layers[L]) out.push({ level: 'error', id: o.id, msg: 'Layer ' + L + ' is used by more than one slot.' }); layers[L] = 1; });
    if (layers[maskLayerOf(doc)]) out.push({ level: 'error', msg: 'Front mask layer ' + maskLayerOf(doc) + ' is also used by a slot.' });
    return out;
  }

  // ---------- full render entry ----------
  function render(doc, opt) {
    opt = opt || {};
    var S = opt.scale || 1, t0 = Date.now(), res = { scale: S };
    var back = renderBack(doc, S);
    res.W = back.W; res.H = back.H;
    var planes = opt.planes || ['back', 'front'];
    if (planes.indexOf('front') >= 0) {
      var front = renderFront(doc, S, back);
      res.front = finalize(front, opt);
      front = null;
    }
    if (opt.checks !== false) res.warnings = cornerCheck(doc, S, back);
    if (planes.indexOf('back') >= 0) res.back = finalize(back, opt);
    res.ms = Date.now() - t0;
    return res;
  }

  // ---------- vMix math ----------
  var ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '21:9': 21 / 9, '17:9 (DCI)': 256 / 135, '3:2': 3 / 2, '5:4': 5 / 4 };
  function aspectOf(src) {
    if (!src) return 16 / 9;
    if (src.aspect === 'custom') return Math.max(0.01, +src.cw || 16) / Math.max(0.01, +src.ch || 9);
    return ASPECTS[src.aspect] || 16 / 9;
  }
  // User crop of the source, as fractions of the source width / height trimmed from each side.
  function cropOf(src) {
    var c = src && src.crop || {}, k = function (v) { v = +v || 0; return v < 0 ? 0 : v > 0.98 ? 0.98 : v; };
    var l = k(c.l), r = k(c.r), t = k(c.t), b = k(c.b);
    if (l + r > 0.98) { var sx = 0.98 / (l + r); l *= sx; r *= sx; }
    if (t + b > 0.98) { var sy = 0.98 / (t + b); t *= sy; b *= sy; }
    return { l: l, t: t, r: r, b: b };
  }
  function croppedAspect(src) { var c = cropOf(src); return aspectOf(src) * (1 - c.l - c.r) / (1 - c.t - c.b); }
  function sortedSlots(doc) {
    return slotsOf(doc).slice().sort(function (a, b) { return (a.slotNum || 0) - (b.slotNum || 0) || doc.objects.indexOf(a) - doc.objects.indexOf(b); });
  }
  function layerOf(doc, o) {
    if (o.src && +o.src.layer > 0) return +o.src.layer;
    return sortedSlots(doc).indexOf(o) + 1;
  }
  function maskLayerOf(doc) {
    if (+doc.vmix.maskLayer > 0) return +doc.vmix.maskLayer;
    var max = 0; slotsOf(doc).forEach(function (o) { max = Math.max(max, layerOf(doc, o)); });
    return Math.min(10, max + 1);
  }
  // Layer values for a source in a slot. vMix positions layers in resolution-independent
  // screen space: Zoom 1 = full frame, Pan 0 = centred, Pan +/-2 = one full frame width
  // (PanY +2 = one full frame up). Crop X1/Y1 0 = none, X2/Y2 1 = none.
  function vmixFor(doc, o) {
    var v = doc.vmix, CW = doc.canvas.w, CH = doc.canvas.h, OW = +v.outW || CW, OH = +v.outH || CH;
    var sx = OW / CW, sy = OH / CH;
    var x = o.x * sx, y = o.y * sy, w = o.w * sx, h = o.h * sy;
    var A = aspectOf(o.src), fw, fh, uc = cropOf(o.src);
    if (A >= OW / OH) { fw = OW; fh = OW / A; } else { fh = OH; fw = OH * A; }
    // The user crop leaves a region rw x rh (at zoom 1) that is fitted or filled into the slot.
    var rw = fw * (1 - uc.l - uc.r), rh = fh * (1 - uc.t - uc.b);
    var fillMode = !o.src || o.src.mode !== 'fit';
    var zoom = fillMode ? Math.max(w / rw, h / rh) : Math.min(w / rw, h / rh);
    var pw = fw * zoom, ph = fh * zoom;
    // Centre the kept region on the slot; the layer itself (uncropped) is what Pan positions.
    var cx = x + w / 2 - ((uc.l + 1 - uc.r) / 2 - 0.5) * pw, cy = y + h / 2 - ((uc.t + 1 - uc.b) / 2 - 0.5) * ph;
    var panX = (2 * cx - OW) / OW, panY = (OH - 2 * cy) / OH;
    var c = [uc.l, uc.t, 1 - uc.r, 1 - uc.b];
    if (fillMode) {
      var ox = Math.max(0, (rw * zoom - w) / 2) / pw, oy = Math.max(0, (rh * zoom - h) / 2) / ph;
      c = [uc.l + ox, uc.t + oy, 1 - uc.r - ox, 1 - uc.b - oy];
    }
    var placed = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
    var visible = { x: placed.x + c[0] * pw, y: placed.y + c[1] * ph, w: (c[2] - c[0]) * pw, h: (c[3] - c[1]) * ph };
    return { zoom: zoom, panX: panX, panY: panY, crop: c, placed: placed, visible: visible, slotOut: { x: x, y: y, w: w, h: h },
      fitted: { w: fw, h: fh }, outW: OW, outH: OH, layer: layerOf(doc, o), mode: fillMode ? 'fill' : 'fit', aspect: A, userCrop: uc };
  }
  // Inverse: what vMix will show for given values. Used by tests and the read-back check.
  function vmixVisibleRect(OW, OH, aspect, zoom, panX, panY, crop) {
    var fw, fh; if (aspect >= OW / OH) { fw = OW; fh = OW / aspect; } else { fh = OH; fw = OH * aspect; }
    var pw = fw * zoom, ph = fh * zoom, cx = OW / 2 + panX * OW / 2, cy = OH / 2 - panY * OH / 2;
    var px = cx - pw / 2, py = cy - ph / 2;
    return { x: px + crop[0] * pw, y: py + crop[1] * ph, w: (crop[2] - crop[0]) * pw, h: (crop[3] - crop[1]) * ph };
  }
  function apiUrl(v, fn, input, value) {
    var u = 'http://' + (v.host || '127.0.0.1') + ':' + (v.port || 8088) + '/api/?Function=' + encodeURIComponent(fn);
    if (input !== undefined && input !== null && input !== '') u += '&Input=' + encodeURIComponent(input);
    if (value !== undefined && value !== null && value !== '') u += '&Value=' + encodeURIComponent(value).replace(/%2C/g, ',');
    return u;
  }
  function slotCommands(doc, o) {
    var v = doc.vmix, vm = vmixFor(doc, o), L = vm.layer, I = v.input, out = [];
    function add(fn, val) { out.push({ fn: fn, input: I, value: val, url: apiUrl(v, fn, I, val) }); }
    if (o.src && o.src.source) add('SetLayer', L + ',' + o.src.source);
    if (v.method === 'rectangle') {
      var p = vm.placed;
      add('SetLayer' + L + 'Rectangle', [p.x, p.y, p.w, p.h].map(function (n) { return fmt(n, 2); }).join(','));
    } else {
      add('SetLayer' + L + 'Zoom', fmt(vm.zoom));
      add('SetLayer' + L + 'PanX', fmt(vm.panX));
      add('SetLayer' + L + 'PanY', fmt(vm.panY));
    }
    add('SetLayer' + L + 'Crop', vm.crop.map(function (n) { return fmt(n); }).join(','));
    add('LayerOn', String(L));
    return out;
  }
  function maskCommands(doc) {
    var v = doc.vmix, L = maskLayerOf(doc), I = v.input, out = [];
    function add(fn, val) { out.push({ fn: fn, input: I, value: val, url: apiUrl(v, fn, I, val) }); }
    if (v.maskInput) add('SetLayer', L + ',' + v.maskInput);
    add('SetLayer' + L + 'Zoom', '1'); add('SetLayer' + L + 'PanX', '0'); add('SetLayer' + L + 'PanY', '0');
    add('SetLayer' + L + 'Crop', '0,0,1,1'); add('LayerOn', String(L));
    return out;
  }
  function allCommands(doc) {
    var list = sortedSlots(doc).map(function (o) { return { label: slotLabel(o), id: o.id, cmds: slotCommands(doc, o) }; });
    list.push({ label: 'Front mask', id: null, cmds: maskCommands(doc) });
    return list;
  }
  function slotLabel(o) { return (o.slotNum ? o.slotNum + '. ' : '') + (o.name || 'Slot'); }

  function setupText(doc) {
    var v = doc.vmix, base = (doc.exportOpts && doc.exportOpts.baseName) || 'pip', L = [];
    var slots = sortedSlots(doc), mL = maskLayerOf(doc);
    L.push('vMix PIP Builder setup');
    L.push('Canvas ' + doc.canvas.w + 'x' + doc.canvas.h + '   vMix output (preset resolution) ' + v.outW + 'x' + v.outH);
    L.push('');
    L.push('FILES');
    L.push('  ' + base + '_backplate.png   base of the input (shadows, borders, fills behind the video)');
    L.push('  ' + base + '_frontmask.png   top layer (rounds the video corners, borders over the video)');
    L.push('  ' + base + '_preview.png     reference only, do not load into vMix');
    L.push('  ' + base + '_project.json    reopen in PIP Builder');
    L.push('');
    L.push('BUILD THE INPUT');
    L.push('1. Copy the PNGs to a fixed folder on the vMix machine.');
    L.push('2. Check Settings > Display: the preset resolution must be ' + v.outW + 'x' + v.outH + '.');
    L.push('3. Add Input > Image > ' + base + '_backplate.png. Rename the input to "' + v.input + '".');
    L.push('4. Add Input > Image > ' + base + '_frontmask.png. Rename the input to "' + v.maskInput + '".');
    L.push('5. On both image inputs open Colour Adjust and leave "Premultiplied Alpha" unticked. These PNGs are straight alpha.');
    L.push('6. Open "' + v.input + '" input settings > Layers. Assign:');
    slots.forEach(function (o) { L.push('     Layer ' + layerOf(doc, o) + ' = ' + (o.src.source || ('your source for "' + (o.name || 'Slot') + '"'))); });
    L.push('     Layer ' + mL + ' = ' + v.maskInput + '  (front mask must be the highest layer used)');
    L.push('7. Position each layer: run the API commands below (browser, Companion Generic HTTP, or PIP Builder "Send"),');
    L.push('   or type the values into each layer\'s Edit > Position tab.');
    L.push('8. Leave the front mask layer at Zoom 1, Pan 0, no crop.');
    L.push('');
    L.push('LAYER VALUES');
    slots.forEach(function (o) {
      var vm = vmixFor(doc, o);
      L.push('  ' + slotLabel(o) + '  (Layer ' + vm.layer + ', source ' + (o.src.aspect === 'custom' ? o.src.cw + ':' + o.src.ch : o.src.aspect) + ', ' + vm.mode + ')');
      L.push('    Zoom ' + fmt(vm.zoom) + '   PanX ' + fmt(vm.panX) + '   PanY ' + fmt(vm.panY));
      L.push('    Crop X1 ' + fmt(vm.crop[0]) + '  Y1 ' + fmt(vm.crop[1]) + '  X2 ' + fmt(vm.crop[2]) + '  Y2 ' + fmt(vm.crop[3]));
      L.push('    Rectangle (uncropped, output px) X ' + fmt(vm.placed.x, 2) + '  Y ' + fmt(vm.placed.y, 2) + '  W ' + fmt(vm.placed.w, 2) + '  H ' + fmt(vm.placed.h, 2));
      L.push('    Visible area (output px) ' + fmt(vm.visible.x, 2) + ', ' + fmt(vm.visible.y, 2) + '  ' + fmt(vm.visible.w, 2) + 'x' + fmt(vm.visible.h, 2));
    });
    L.push('');
    L.push('API COMMANDS');
    allCommands(doc).forEach(function (g) { L.push('  # ' + g.label); g.cmds.forEach(function (c) { L.push('  ' + c.url); }); });
    var w = lint(doc);
    if (w.length) { L.push(''); L.push('WARNINGS'); w.forEach(function (x) { L.push('  ' + x.msg); }); }
    L.push('');
    L.push('NOTES');
    L.push('  Layer 10 is drawn on top of layer 9 and so on. The input\'s own image (the back plate) is under all layers.');
    L.push('  Pan and zoom are resolution independent. Pixel values (Rectangle) are in the vMix preset resolution.');
    L.push('  If a Web Controller password is set in vMix, the URLs need it (the relay helper can send it).');
    return L.join('\r\n');
  }

  // ---------- PNG encoder (straight RGBA, 8 bit, no gamma or colour chunks) ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf, start, end, crc) {
    var c = crc === undefined ? 0xffffffff : crc;
    for (var i = start || 0, e = end === undefined ? buf.length : end; i < e; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return c;
  }
  function crcFinal(c) { return (c ^ 0xffffffff) >>> 0; }
  function u32(a, o, v) { a[o] = v >>> 24 & 255; a[o + 1] = v >>> 16 & 255; a[o + 2] = v >>> 8 & 255; a[o + 3] = v & 255; }
  function chunk(type, data) {
    var c = new Uint8Array(12 + data.length);
    u32(c, 0, data.length);
    for (var i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    u32(c, 8 + data.length, crcFinal(crc32(c, 4, 8 + data.length)));
    return c;
  }
  function filterRows(px, W, H) {
    var stride = W * 4, out = new Uint8Array((stride + 1) * H);
    var c1 = new Uint8Array(stride), c2 = new Uint8Array(stride), c4 = new Uint8Array(stride);
    for (var y = 0; y < H; y++) {
      var r = y * stride, pr = r - stride, o = y * (stride + 1) + 1, x, v, s0 = 0, s1 = 0, s2 = 0, s4 = 0;
      // None
      for (x = 0; x < stride; x++) { v = px[r + x]; s0 += v < 128 ? v : 256 - v; }
      // Sub
      for (x = 0; x < 4; x++) { v = px[r + x]; c1[x] = v; s1 += v < 128 ? v : 256 - v; }
      for (x = 4; x < stride; x++) { v = (px[r + x] - px[r + x - 4]) & 255; c1[x] = v; s1 += v < 128 ? v : 256 - v; }
      if (y > 0) {
        // Up
        for (x = 0; x < stride; x++) { v = (px[r + x] - px[pr + x]) & 255; c2[x] = v; s2 += v < 128 ? v : 256 - v; }
        // Paeth
        for (x = 0; x < 4; x++) { v = (px[r + x] - px[pr + x]) & 255; c4[x] = v; s4 += v < 128 ? v : 256 - v; }
        for (x = 4; x < stride; x++) {
          var a = px[r + x - 4], b = px[pr + x], c = px[pr + x - 4], pa = b - c, pb = a - c, pc = pa + pb;
          if (pa < 0) pa = -pa; if (pb < 0) pb = -pb; if (pc < 0) pc = -pc;
          v = (px[r + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; c4[x] = v; s4 += v < 128 ? v : 256 - v;
        }
      } else { s2 = s4 = Infinity; }
      var best = s0, fid = 0;
      if (s1 < best) { best = s1; fid = 1; } if (s2 < best) { best = s2; fid = 2; } if (s4 < best) { best = s4; fid = 4; }
      out[o - 1] = fid;
      if (fid === 0) out.set(px.subarray(r, r + stride), o);
      else out.set(fid === 1 ? c1 : fid === 2 ? c2 : c4, o);
    }
    return out;
  }
  function concatBytes(parts) {
    var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0; for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  function zlibDeflate(data) {
    var cs = new CompressionStream('deflate');
    var stream = new Blob([data]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function encodePNG(px, W, H) {
    var ihdr = new Uint8Array(13);
    u32(ihdr, 0, W); u32(ihdr, 4, H); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var text = new TextEncoder().encode('Software\0vMix PIP Builder ' + VERSION);
    return zlibDeflate(filterRows(px, W, H)).then(function (z) {
      return concatBytes([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('tEXt', text), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]);
    });
  }

  // ---------- ZIP writer (stored) ----------
  function makeZip(files) {
    var parts = [], central = [], offset = 0, d = new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    function le(a, o, v, n) { for (var i = 0; i < n; i++) a[o + i] = (v >>> (8 * i)) & 255; }
    files.forEach(function (f) {
      var name = new TextEncoder().encode(f.name), data = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
      var crc = crcFinal(crc32(data)), h = new Uint8Array(30 + name.length);
      le(h, 0, 0x04034b50, 4); le(h, 4, 20, 2); le(h, 6, 0x0800, 2); le(h, 8, 0, 2); le(h, 10, time, 2); le(h, 12, date, 2);
      le(h, 14, crc, 4); le(h, 18, data.length, 4); le(h, 22, data.length, 4); le(h, 26, name.length, 2); le(h, 28, 0, 2);
      h.set(name, 30);
      var c = new Uint8Array(46 + name.length);
      le(c, 0, 0x02014b50, 4); le(c, 4, 20, 2); le(c, 6, 20, 2); le(c, 8, 0x0800, 2); le(c, 10, 0, 2); le(c, 12, time, 2); le(c, 14, date, 2);
      le(c, 16, crc, 4); le(c, 20, data.length, 4); le(c, 24, data.length, 4); le(c, 28, name.length, 2);
      le(c, 30, 0, 2); le(c, 32, 0, 2); le(c, 34, 0, 2); le(c, 36, 0, 2); le(c, 38, 0, 4); le(c, 42, offset, 4);
      c.set(name, 46);
      parts.push(h, data); central.push(c); offset += h.length + data.length;
    });
    var cd = concatBytes(central), end = new Uint8Array(22);
    le(end, 0, 0x06054b50, 4); le(end, 8, files.length, 2); le(end, 10, files.length, 2); le(end, 12, cd.length, 4); le(end, 16, offset, 4);
    return concatBytes(parts.concat([cd, end]));
  }

  // Alpha ramp for checking vMix's alpha handling: white (top) and black (bottom) at alpha 0..255.
  function alphaTest(W, H) {
    W = W || 1024; H = H || 256;
    var px = new Uint8ClampedArray(W * H * 4);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4, v = y < H / 2 ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = Math.round(x / (W - 1) * 255);
    }
    return px;
  }

  return {
    VERSION: VERSION, alphaTest: alphaTest, clamp: clamp, uid: uid, clone: clone, fmt: fmt, num: num, parseColor: parseColor,
    defaultStyle: defaultStyle, newObject: newObject, newDoc: newDoc, migrate: migrate,
    shapeOf: shapeOf, sd: sd, cov: cov, render: render, renderBack: renderBack, renderFront: renderFront, finalize: finalize,
    lint: lint, ASPECTS: ASPECTS, aspectOf: aspectOf, cropOf: cropOf, croppedAspect: croppedAspect, vmixFor: vmixFor, vmixVisibleRect: vmixVisibleRect,
    sortedSlots: sortedSlots, layerOf: layerOf, maskLayerOf: maskLayerOf, slotCommands: slotCommands, maskCommands: maskCommands,
    allCommands: allCommands, setupText: setupText, slotLabel: slotLabel, apiUrl: apiUrl,
    encodePNG: encodePNG, makeZip: makeZip, crc32: function (b) { return crcFinal(crc32(b)); }
  };
})();
if (typeof module !== 'undefined') module.exports = PIPE;
