#!/usr/bin/env node
/* vMix PIP Builder relay helper. Optional. Node 16+, no packages.

   Why: a page opened from a file cannot read vMix's HTTP replies (vMix sends no CORS
   headers) and cannot send a Web Controller password. This relay forwards the
   PIP Builder's commands to vMix, reports success or failure for each one, and can
   read vMix's XML state back so the app can check the layer values.

   Run:   node vmix-relay.js
   Options:
     --port 8089             port the relay listens on (127.0.0.1 only)
     --allow-host 10.0.0.20  extra vMix host the relay may talk to (repeatable).
                             127.0.0.1 and localhost are always allowed.
     --any-origin            accept requests from any web page (default: only
                             pages opened from a file or from localhost)

   In PIP Builder: vMix tab > Send via > Relay helper. */
'use strict';
const http = require('http');
const VERSION = '1.0.0';

const args = process.argv.slice(2);
let PORT = 8089, anyOrigin = false;
const allowHosts = new Set(['127.0.0.1', 'localhost']);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') PORT = +args[++i];
  else if (args[i] === '--allow-host') allowHosts.add(String(args[++i]).toLowerCase());
  else if (args[i] === '--any-origin') anyOrigin = true;
  else if (args[i] === '--help' || args[i] === '-h') { console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
}

function originOk(req) {
  if (anyOrigin) return true;
  const o = req.headers.origin;
  if (!o || o === 'null') return true; // file:// pages send "null"
  try { const h = new URL(o).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch (e) { return false; }
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function send(res, code, body, type) {
  cors(res);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}
// Only plain http GETs to /api on an allowed host.
function checkTarget(u) {
  let url; try { url = new URL(u); } catch (e) { throw new Error('bad URL'); }
  if (url.protocol !== 'http:') throw new Error('only http:// vMix URLs');
  if (!allowHosts.has(url.hostname.toLowerCase())) throw new Error('host ' + url.hostname + ' not allowed (start the relay with --allow-host ' + url.hostname + ')');
  if (!/^\/api\/?$/.test(url.pathname)) throw new Error('only /api/ paths');
  return url;
}
function vmixGet(url, user, pass) {
  return new Promise((resolve) => {
    const headers = {};
    if (user || pass) headers.Authorization = 'Basic ' + Buffer.from((user || '') + ':' + (pass || '')).toString('base64');
    const req = http.get(url, { headers, timeout: 4000 }, (r) => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => { b += c; }); r.on('end', () => resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, body: b }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ ok: false, status: 0, error: e.message }));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (!originOk(req)) return send(res, 403, { error: 'origin not allowed: ' + req.headers.origin });
  const path = req.url.split('?')[0];
  try {
    if (path === '/ping') return send(res, 200, { ok: true, version: VERSION, hosts: [...allowHosts] });
    if (path === '/send' && req.method === 'POST') {
      const body = await readBody(req), urls = Array.isArray(body.urls) ? body.urls : [];
      const results = [];
      for (const u of urls) {
        let url; try { url = checkTarget(u); } catch (e) { results.push({ url: u, ok: false, status: 0, error: e.message }); continue; }
        const r = await vmixGet(url, body.user, body.pass);
        results.push({ url: u, ok: r.ok, status: r.status, error: r.error, body: r.ok ? undefined : (r.body || '').slice(0, 200) });
        console.log((r.ok ? 'OK  ' : 'ERR ') + r.status + '  ' + decodeURIComponent(url.search));
      }
      return send(res, 200, { ok: results.every(r => r.ok), results });
    }
    if (path === '/state' && req.method === 'POST') {
      const body = await readBody(req);
      const url = checkTarget('http://' + (body.host || '127.0.0.1') + ':' + (body.port || 8088) + '/api/');
      const r = await vmixGet(url, body.user, body.pass);
      if (!r.ok) return send(res, 502, { error: 'vMix replied ' + r.status + ' ' + (r.error || '') });
      return send(res, 200, r.body, 'text/xml; charset=utf-8');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('vMix PIP Builder relay ' + VERSION + ' on http://127.0.0.1:' + PORT);
  console.log('Allowed vMix hosts: ' + [...allowHosts].join(', ') + '   (add more with --allow-host <ip>)');
});
