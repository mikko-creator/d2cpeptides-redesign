// make-preview.mjs - turn dist/ into the noindex GitHub Pages preview (preview/), keeping preview/.git.
//   node tools/make-preview.mjs [--dist dist] [--out preview] [--check]
// The build already writes every URL under the preview prefix (/d2cpeptides-redesign/), and every source page already
// carries <meta name="robots" content="noindex, nofollow"> (the client's staging site does), so nothing is rewritten.
// Added: .nojekyll (Pages serves files as they are) and a robots.txt that allows crawling, so a crawler can READ the
// noindex (a Disallow would hide it and still let the bare URL be indexed from outside links).
// The check fails closed: every HTML page must carry exactly one noindex robots meta, and a planted control page
// without it must be caught.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
const dist = path.resolve(ROOT, arg('dist', 'dist'));
const out = path.resolve(ROOT, arg('out', 'preview'));
const NOINDEX = /<meta name="robots" content="noindex, ?nofollow">/g;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

function check(dir) {
  const bad = [];
  for (const f of walk(dir).filter((f) => f.endsWith('.html'))) {
    const n = (fs.readFileSync(f, 'utf8').match(NOINDEX) || []).length;
    if (n !== 1) bad.push(`${n} noindex metas: ${path.relative(dir, f)}`);
  }
  if (!fs.existsSync(path.join(dir, '.nojekyll'))) bad.push('no .nojekyll');
  return bad;
}

if (!a.includes('--check')) {
  fs.mkdirSync(out, { recursive: true });
  for (const e of fs.readdirSync(out)) if (e !== '.git') fs.rmSync(path.join(out, e), { recursive: true, force: true });
  fs.cpSync(dist, out, { recursive: true });
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
}
const bad = check(out);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-control-'));
fs.cpSync(out, tmp, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git`) });
const victim = walk(tmp).find((f) => f.endsWith('index.html'));
fs.writeFileSync(victim, fs.readFileSync(victim, 'utf8').replace(NOINDEX, ''));
const controlFired = check(tmp).length > 0;
fs.rmSync(tmp, { recursive: true, force: true });
const pages = walk(out).filter((f) => f.endsWith('.html')).length;
console.log(`preview: ${pages} pages, ${bad.length} problems, control ${controlFired ? 'fired' : 'DID NOT FIRE'}`);
for (const b of bad.slice(0, 20)) console.log('  -', b);
process.exitCode = bad.length || !controlFired ? 1 : 0;
