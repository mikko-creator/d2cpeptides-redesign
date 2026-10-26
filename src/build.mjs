// build.mjs - D2C Peptides redesign pitch: turn the crawled source pages (audit/raw, audit/crawl.json) into the
// redesigned static site in dist/.
//   node src/build.mjs [--base /d2cpeptides-redesign/] [--out dist] [--strict]
//
// What it keeps: every page at its source path, every word of every page, every link, the head metadata (title,
// description, canonical, Open Graph, JSON-LD) and every hook the client's own scripts use (site.js: cart, gate,
// filters, search; chatbot.js; tools.js calculators). Those scripts are shipped unchanged except for the URL prefix.
// What it changes: the stylesheet (src/styles/*.css, concatenated), fonts, the header logo variant, an ambient depth
// stage behind every page, image/video layers inside heroes and a few bands (src/assets/gen, AI-generated, labelled
// data-ai), and src/js/fx.js (scroll reveals, parallax depth, tilt and counters).
// --strict exits 1 when an expected anchor is missing from a page or a local reference in dist/ does not resolve.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const BASE = ('/' + String(arg('base', '/d2cpeptides-redesign/')).replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/$/, '/');
const OUT = path.resolve(ROOT, arg('out', 'dist'));
const STRICT = argv.includes('--strict');
const SRC_PREFIX = '/d2cpeptides/';
const problems = [];
const warn = (m) => problems.push(m);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const rebase = (s) => s.split(SRC_PREFIX).join(BASE);
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

// ---------- clean output (keep nothing stale) ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- static assets ----------
const ASSETS = path.join(ROOT, 'audit/assets');
for (const f of walk(path.join(ASSETS, 'img'))) write(path.relative(ASSETS, f), fs.readFileSync(f));
write('favicon.svg', fs.readFileSync(path.join(ASSETS, 'favicon.svg')));
for (const j of ['search-index.json', 'chat-index.json']) write(j, rebase(fs.readFileSync(path.join(ASSETS, j), 'utf8')));
const jsVer = {};
for (const j of ['site.js', 'chatbot.js', 'tools.js']) {
  const s = rebase(fs.readFileSync(path.join(ASSETS, 'js', j), 'utf8'));
  write('js/' + j, s);
  jsVer[j] = hash(s);
}
// generated media (AI decoration): src/assets/gen -> dist/img/gen
const GEN = path.join(ROOT, 'src/assets/gen');
for (const f of walk(GEN)) if (/\.(webp|mp4|webm|jpg|png)$/i.test(f)) write('img/gen/' + path.relative(GEN, f).split(path.sep).join('/'), fs.readFileSync(f));
const has = (rel) => fs.existsSync(path.join(OUT, rel));

// new stylesheet: src/styles/NN-*.css in name order, one file
const STY = path.join(ROOT, 'src/styles');
const cssParts = fs.readdirSync(STY).filter((f) => /\.css$/.test(f)).sort();
const css = rebase(cssParts.map((f) => '/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(STY, f), 'utf8')).join('\n'));
write('css/site.css', css);
const cssVer = hash(css);
const fx = rebase(read('src/js/fx.js'));
write('js/fx.js', fx);
const fxVer = hash(fx);

// ---------- media layers ----------
const AI = ' data-ai="higgsfield"';
function still(id, cls, pos) {
  if (!has(`img/gen/${id}-1280.webp`)) return '';
  const sizes = [640, 1280, 1920].filter((w) => has(`img/gen/${id}-${w}.webp`));
  const srcset = sizes.map((w) => `${BASE}img/gen/${id}-${w}.webp ${w}w`).join(', ');
  const big = sizes[sizes.length - 1];
  return `<img class="${cls}" src="${BASE}img/gen/${id}-${big}.webp" srcset="${srcset}" sizes="100vw" alt="" loading="lazy" decoding="async"${pos ? ` style="object-position:${pos}"` : ''}${AI}>`;
}
function loop(id, cls) {
  if (!has(`img/gen/${id}-loop.mp4`)) return '';
  const poster = has(`img/gen/${id}-loop-poster.webp`) ? `${BASE}img/gen/${id}-loop-poster.webp` : '';
  const phone = has(`img/gen/${id}-loop-phone.mp4`) ? ` data-src-sm="${BASE}img/gen/${id}-loop-phone.mp4"` : '';
  // fx.js picks the source (phone cut under 700px) and skips the video entirely under prefers-reduced-motion
  return `<video class="${cls}" muted loop playsinline preload="none"${poster ? ` poster="${poster}"` : ''} data-src="${BASE}img/gen/${id}-loop.mp4"${phone}${AI}></video>`;
}
const FXBITS = '<span class="fx-grid"></span><span class="fx-hex"></span><span class="fx-orb fx-orb--a" data-depth="-0.12"></span><span class="fx-orb fx-orb--b" data-depth="0.1"></span><span class="fx-scan"></span>';
function layer(media, extra = '') {
  return `<div class="fx" aria-hidden="true"><div class="fx__media" data-depth="0.18">${media}</div>${FXBITS}${extra}</div>`;
}
// page type -> hero media (stills fall back to nothing until the imagery lane delivers)
const HERO_MEDIA = {
  home: () => loop('hero', 'fx__video') || still('hero', 'fx__img', '70% 50%'),
  'shop-hub': () => still('hero', 'fx__img', '75% 50%'),
  category: () => still('crystal', 'fx__img'),
  'supplies-hub': () => still('lab', 'fx__img'),
  wholesale: () => still('rack', 'fx__img'),
  'wholesale-apply': () => still('rack', 'fx__img'),
  'private-label': () => still('rack', 'fx__img'),
  'locations-hub': () => still('desert', 'fx__img'),
  city: () => still('desert', 'fx__img'),
  location: () => still('desert', 'fx__img'),
  shipping: () => still('coldchain', 'fx__img'),
  returns: () => still('coldchain', 'fx__img'),
  'lab-results': () => still('lab', 'fx__img'),
  'review-policy': () => still('lab', 'fx__img'),
  about: () => still('lab', 'fx__img'),
  'learn-root': () => still('crystal', 'fx__img'),
  'peptide-hub': () => still('crystal', 'fx__img'),
  'type-hub': () => still('crystal', 'fx__img'),
  'goal-hub': () => still('hero', 'fx__img', '75% 50%'),
  'compare-hub': () => still('hero', 'fx__img', '75% 50%'),
  'blog-root': () => still('hero', 'fx__img', '75% 50%'),
};
const heroMedia = (type) => (HERO_MEDIA[type] ? HERO_MEDIA[type]() : '');

// ---------- pages ----------
const crawl = JSON.parse(read('audit/crawl.json'));
const pages = crawl.records.filter((r) => r.status === 200 && r.file);
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&amp;family=Inter:wght@400..700&amp;family=JetBrains+Mono:wght@400..600&amp;display=swap">';
let n = 0;
const typeCount = {};
for (const r of pages) {
  const rel = r.file.replace(/^audit\/raw\//, '');
  let h = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
  const type = (h.match(/<body[^>]*\sdata-type="([^"]+)"/) || [])[1] || 'page';
  typeCount[type] = (typeCount[type] || 0) + 1;
  const need = (cond, what) => { if (!cond) warn(`${rel}: ${what}`); };

  // head: fonts and stylesheet
  const fontsRe = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*">/;
  need(fontsRe.test(h), 'fonts link not found');
  h = h.replace(fontsRe, FONTS);
  const cssRe = /<link rel="stylesheet" href="\/d2cpeptides\/css\/site\.css\?v=[^"]*">/;
  need(cssRe.test(h), 'site.css link not found');
  h = h.replace(cssRe, `<link rel="stylesheet" href="${SRC_PREFIX}css/site.css?v=${cssVer}">`);
  // script versions follow the shipped (rebased) bytes
  h = h.replace(/(\/d2cpeptides\/js\/(site|chatbot|tools)\.js)\?v=[a-f0-9]+/g, (m, p, name) => `${p}?v=${jsVer[name + '.js']}`);

  // body: ambient depth stage behind everything
  const bodyRe = /<body([^>]*)>/;
  need(bodyRe.test(h), 'body tag');
  h = h.replace(bodyRe, (m, a) => `<body${a}>\n<div class="stage" aria-hidden="true"><span class="stage__mesh"></span><span class="stage__grid" data-depth="0.04"></span><span class="stage__hex" data-depth="0.08"></span><span class="stage__orb stage__orb--a"></span><span class="stage__orb stage__orb--b"></span><span class="stage__orb stage__orb--c"></span></div>`);

  // header and gate sit on dark glass: the light logo variant
  h = h.replace(/(<header class="site-header">[\s\S]*?<a href="\/d2cpeptides\/" class="brand"><img src="\/d2cpeptides\/img\/brand\/)logo\.svg/, '$1logo-light.svg');
  h = h.replace(/(<div class="gate__card"><div class="brand"><img src="\/d2cpeptides\/img\/brand\/)logo\.svg/, '$1logo-light.svg');

  // hero: media + depth layers as the first child of the hero section
  const media = heroMedia(type);
  h = h.replace(/<section class="hero( [^"]*)?">/, (m) => `${m}${layer(media, type === 'home' ? '<span class="fx-ring" data-depth="-0.2"></span>' : '')}`);

  // home bands: imagery behind the wholesale band, the quality section and the locations section
  if (type === 'home') {
    // extra classes switch a light band to the dark treatment (section--dark) or mark a photo backdrop (section--media)
    const band = (id, mediaHtml, extra = '') => {
      const re = new RegExp(`<section class="([^"]*)" id="${id}">`);
      need(re.test(h), `home section #${id}`);
      const cls = (mediaHtml ? ' section--media' : '') + (extra ? ' ' + extra : '');
      h = h.replace(re, (m, c) => `<section class="${c}${cls}" id="${id}">${layer(mediaHtml)}`);
    };
    band('wholesale-and-bulk', still('rack', 'fx__img'));
    band('quality-and-documentation', loop('lab', 'fx__video') || still('lab', 'fx__img'), 'section--dark');
    band('where-we-are', still('desert', 'fx__img'));
    band('shop-by-category', '');
  }
  // every navy band and the wholesale/learn heroes get the same layer stack even without a photo
  h = h.replace(/<section class="section section--navy( [^"]*)?"( id="[^"]*")?>(?!<div class="fx")/g, (m) => `${m}${layer('')}`);

  // motion layer script, after the client's site.js
  const siteJsRe = /(<script src="\/d2cpeptides\/js\/site\.js\?v=[a-f0-9]+" defer><\/script>)/;
  need(siteJsRe.test(h), 'site.js tag');
  h = h.replace(siteJsRe, `$1\n<script src="${SRC_PREFIX}js/fx.js?v=${fxVer}" defer></script>`);

  h = rebase(h);
  need(!h.includes(SRC_PREFIX) || BASE === SRC_PREFIX, 'source prefix survived the rebase');
  write(rel, h);
  n++;
}

// ---------- strict: every local reference resolves ----------
let refs = 0, broken = 0;
if (STRICT) {
  const files = walk(OUT).filter((f) => f.endsWith('.html'));
  const seen = new Set();
  for (const f of files) {
    const h = fs.readFileSync(f, 'utf8');
    const list = [];
    for (const m of h.matchAll(/\s(?:href|src|poster|data-src|data-src-sm)="([^"]+)"/g)) list.push(m[1]);
    for (const m of h.matchAll(/\ssrcset="([^"]+)"/g)) for (const part of m[1].split(',')) list.push(part.trim().split(/\s+/)[0]);
    for (let u of list) {
      if (!u.startsWith(BASE)) continue;
      u = u.split('#')[0].split('?')[0];
      if (seen.has(u)) continue;
      seen.add(u); refs++;
      let p = decodeURIComponent(u.slice(BASE.length));
      if (p === '' || p.endsWith('/')) p += 'index.html';
      if (!fs.existsSync(path.join(OUT, p))) { broken++; warn('broken local reference: ' + u + ' (first seen in ' + path.relative(OUT, f) + ')'); }
    }
  }
}

console.log(`built ${n} pages into ${path.relative(ROOT, OUT) || '.'} (base ${BASE}); css ${(css.length / 1024).toFixed(0)} KB from ${cssParts.length} parts; gen media ${walk(GEN).length} files`);
if (STRICT) console.log(`strict: ${refs} distinct local references checked, ${broken} broken`);
console.log('page types:', JSON.stringify(typeCount));
if (problems.length) { console.log(problems.length + ' problems:'); for (const p of problems.slice(0, 40)) console.log('  - ' + p); }
process.exitCode = STRICT && problems.length ? 1 : 0;
