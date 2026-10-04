// index.html is production and only changes by promoting index.test.html onto it.
//   node tests/guard-production.mjs <base-sha> <head-sha>   CI: if index.html changed between the
//                                                           two commits it must match index.test.html
//   node tests/guard-production.mjs --same                  after npm run promote: the files must match
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const same = () => readFileSync(join(root, 'index.html')).equals(readFileSync(join(root, 'index.test.html')));
const [base, head] = process.argv.slice(2);

let changed = true;
if (base !== '--same' && base && !/^0+$/.test(base)) {
  try { changed = execSync(`git diff --name-only ${base} ${head || 'HEAD'}`, { cwd: root }).toString().split('\n').includes('index.html'); }
  catch (e) { changed = true; }
}
if (!changed) { console.log('index.html (production) unchanged'); process.exit(0); }
if (!same()) {
  console.log('::error file=index.html::index.html changed but does not match index.test.html. Production only changes by promoting the test build (npm run promote).');
  process.exit(1);
}
console.log('index.html matches index.test.html (promoted build)');
