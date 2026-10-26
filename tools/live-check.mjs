// live-check.mjs - crawl the LIVE preview: every page of preview/ and every local reference those pages make must
// answer 200 under the prefix, and the live bytes of the home page, the stylesheet and fx.js must equal preview/.
//   node tools/live-check.mjs [--origin https://mikko-creator.github.io] [--prefix /d2cpeptides-redesign/]
// Paced for GitHub Pages (2 at a time, 300 ms apart); a non-200 is re-checked once before it counts (Pages answers
// the odd transient 503).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
const ORIGIN = arg('origin', 'https://mikko-creator.github.io');
const PREFIX = arg('prefix', '/d2cpeptides-redesign/');
const PV = path.join(ROOT, 'preview');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const pages = walk(PV).filter((f) => f.endsWith('.html')).map((f) => path.relative(PV, f).split(path.sep).join('/'));
const urls = new Set();
for (const p of pages) {
  urls.add(PREFIX + (p === 'index.html' ? '' : p.endsWith('/index.html') ? p.slice(0, -10) : p));
  const h = fs.readFileSync(path.join(PV, p), 'utf8');
  for (const m of h.matchAll(/\s(?:href|src|poster|data-src|data-src-sm)="([^"]+)"/g)) if (m[1].startsWith(PREFIX)) urls.add(m[1].split('#')[0]);
  for (const m of h.matchAll(/\ssrcset="([^"]+)"/g)) for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; if (u.startsWith(PREFIX)) urls.add(u); }
}
const list = [...urls];
const bad = [];
let done = 0;
async function check(u) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(ORIGIN + u, { method: 'GET', headers: { 'user-agent': 'd2c-redesign-live-check' } });
      await r.arrayBuffer();
      if (r.status === 200) return;
      if (attempt === 1) bad.push(r.status + ' ' + u);
    } catch (e) { if (attempt === 1) bad.push('ERR ' + u + ' ' + e.message); }
    await sleep(1500);
  }
}
for (let i = 0; i < list.length; i += 2) {
  await Promise.all(list.slice(i, i + 2).map(check));
  done += 2;
  await sleep(300);
}
const same = [];
for (const [u, f] of [[PREFIX, 'index.html'], [PREFIX + 'css/site.css', 'css/site.css'], [PREFIX + 'js/fx.js', 'js/fx.js'], [PREFIX + 'peptides/bpc157/', 'peptides/bpc157/index.html']]) {
  const r = await fetch(ORIGIN + u + '?nocache=' + Date.now());
  const live = Buffer.from(await r.arrayBuffer());
  same.push(`${u} ${md5(live) === md5(fs.readFileSync(path.join(PV, f))) ? 'identical' : 'DIFFERENT'}`);
}
console.log(`live: ${list.length - bad.length}/${list.length} URLs 200 (${pages.length} pages + their local references)`);
for (const s of same) console.log('  bytes', s);
for (const b of bad.slice(0, 20)) console.log('  FAIL', b);
process.exitCode = bad.length || same.some((s) => s.endsWith('DIFFERENT')) ? 1 : 0;
