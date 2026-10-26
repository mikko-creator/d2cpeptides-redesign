// parity.mjs - prove the rebuild carries 100% of the source content: per page, the visible text stream, every link
// and every source image must survive into dist/ unchanged (after the URL prefix change).
//   node tools/parity.mjs [--dist dist] [--base /d2cpeptides-redesign/]
// Text = the body with <script>, <style> and HTML comments removed, tags turned into spaces, entities decoded,
// whitespace collapsed. Links = every href in <body>. Images = every <img src> in <body> except the build's own
// generated decoration (img/gen/). The ADDED side is reported too: text or links in dist that the source lacks.
// Positive controls: a copy of one built page with a sentence deleted, a link retargeted and an image dropped must
// fail all three checks, or the run fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
const DIST = path.resolve(ROOT, arg('dist', 'dist'));
const BASE = '/' + String(arg('base', '/d2cpeptides-redesign/')).replace(/^\/+|\/+$/g, '') + '/';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', middot: '·', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', times: '×' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
const body = (h) => (h.split(/<body[^>]*>/)[1] || '').split('</body>')[0].replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
const text = (h) => decode(body(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = (u) => u.replace(/&amp;/g, '&').split('/d2cpeptides/').join('/').split(BASE).join('/');
const links = (h) => [...body(h).matchAll(/\shref="([^"]*)"/g)].map((m) => norm(m[1]));
// declared swap: the header and the gate now sit on dark glass, so they carry the client's own light logo file
// (img/brand/logo-light.svg, the variant the source footer already uses) instead of img/brand/logo.svg
const LOGO_VARIANT = (u) => u.replace('/img/brand/logo-light.svg', '/img/brand/logo.svg');
const imgs = (h) => [...body(h).matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((m) => LOGO_VARIANT(norm(m[1]))).filter((u) => !u.includes('/img/gen/'));
const multisetDiff = (x, y) => { const c = new Map(); for (const v of y) c.set(v, (c.get(v) || 0) + 1); const miss = []; for (const v of x) { const k = c.get(v) || 0; if (k) c.set(v, k - 1); else miss.push(v); } return miss; };

function compare(src, out) {
  const t1 = text(src), t2 = text(out);
  const r = { textEqual: t1 === t2, words: t1.split(' ').length };
  if (!r.textEqual) {
    const w1 = t1.split(' '), w2 = t2.split(' ');
    r.textMissing = multisetDiff(w1, w2).slice(0, 12);
    r.textAdded = multisetDiff(w2, w1).slice(0, 12);
  }
  const l1 = links(src), l2 = links(out);
  r.links = l1.length; r.linksMissing = multisetDiff(l1, l2); r.linksAdded = multisetDiff(l2, l1);
  const i1 = imgs(src), i2 = imgs(out);
  r.imgs = i1.length; r.imgsMissing = multisetDiff(i1, i2);
  r.ok = r.textEqual && !r.linksMissing.length && !r.linksAdded.length && !r.imgsMissing.length;
  return r;
}

const crawl = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/crawl.json'), 'utf8'));
const pages = crawl.records.filter((r) => r.status === 200 && r.file);
let ok = 0, words = 0, nLinks = 0, nImgs = 0;
const bad = [];
for (const r of pages) {
  const rel = r.file.replace(/^audit\/raw\//, '');
  const out = path.join(DIST, rel);
  if (!fs.existsSync(out)) { bad.push({ page: rel, missingPage: true }); continue; }
  const res = compare(fs.readFileSync(path.join(ROOT, r.file), 'utf8'), fs.readFileSync(out, 'utf8'));
  words += res.words; nLinks += res.links; nImgs += res.imgs;
  if (res.ok) ok++; else bad.push({ page: rel, ...res });
}
// positive controls on a copy of the home page
const srcHome = fs.readFileSync(path.join(ROOT, 'audit/raw/index.html'), 'utf8');
let planted = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
planted = planted.replace('Minimums, volume tiers and lead times are not published.', '').replace(/href="[^"]*\/wholesale\/apply\/"/, 'href="/elsewhere/"').replace(/<img\b[^>]*semaglutide-960\.webp[^>]*>/, '');
const ctl = compare(srcHome, planted);
const controls = { textFires: !ctl.textEqual, linkFires: ctl.linksMissing.length > 0, imageFires: ctl.imgsMissing.length > 0 };
const controlsOk = controls.textFires && controls.linkFires && controls.imageFires;
const report = { at: new Date().toISOString(), dist: path.relative(ROOT, DIST), pages: pages.length, identical: ok, words, links: nLinks, images: nImgs, failures: bad, controls };
fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit/parity.json'), JSON.stringify(report, null, 2));
console.log(`parity: ${ok}/${pages.length} pages identical in text, links and images (${words} words, ${nLinks} links, ${nImgs} images compared)`);
console.log(`controls: text ${controls.textFires ? 'fired' : 'DID NOT FIRE'}, link ${controls.linkFires ? 'fired' : 'DID NOT FIRE'}, image ${controls.imageFires ? 'fired' : 'DID NOT FIRE'}`);
for (const b of bad.slice(0, 10)) console.log('  FAIL', b.page, JSON.stringify({ textMissing: b.textMissing, textAdded: b.textAdded, linksMissing: b.linksMissing?.slice(0, 4), linksAdded: b.linksAdded?.slice(0, 4), imgsMissing: b.imgsMissing?.slice(0, 4) }));
process.exitCode = bad.length || !controlsOk ? 1 : 0;
