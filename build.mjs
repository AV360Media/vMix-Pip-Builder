// Inlines every <!--#include path--> in src/index.html into index.test.html, the test copy of
// the app. index.html is production and only changes when index.test.html is promoted to it.
// The app files are classic scripts that src/index.html wraps in one function scope, so they are
// concatenated in the order it lists them. Usage: node build.mjs [--watch]
import { readFileSync, writeFileSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'index.test.html');

function build() {
  const html = readFileSync(join(src, 'index.html'), 'utf8')
    .replace(/<!--#include (\S+)-->\r?\n/g, (_, p) => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n'));
  if (/<!--#include /.test(html)) throw new Error('an include marker was not replaced');
  writeFileSync(out, html.replace(/\r\n/g, '\n'));
  console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB)`);
}

build();
if (process.argv.includes('--watch')) {
  let t;
  watch(src, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 100); });
  console.log('watching src/ …');
}
