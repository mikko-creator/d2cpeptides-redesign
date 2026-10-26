// secret-scan.mjs - no credential may be published. Scans exactly the files git would publish from this workspace
// (`git ls-files -co --exclude-standard`: tracked + untracked-not-ignored, i.e. what `git add -A` stages), or every
// file under --dir (a preview copy, an unpacked zip). Node builtins only.
//   node tools/secret-scan.mjs [--dir <folder>] [--keys <file> ...] [--control]
// Patterns: Google API keys (AIza...), GitHub tokens (gh[pousr]_...), AWS access key ids, Slack tokens, Stripe live keys,
// PEM private-key headers, and the literal id and secret halves of every --keys file (fal.key / hf.key live OUTSIDE the
// project; their values are read here and never printed - hits print the file path and the pattern name only).
// --control plants every pattern in a temp folder and requires each to be found, then exits.
// Exit 1 on any hit or a control that does not fire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// earlier pitch 2026-10-13 (BUILD-CONTRACT 4.14): tools/secret-allow.json lists exact matches (by sha256, never the string)
// that may appear only inside one named <script> element on files matching a path pattern; every other occurrence of
// the same string is still a hit. Allowed matches are counted and printed, never silently dropped.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dirArg = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : null;
const keyFiles = argv.flatMap((a, i) => (a === '--keys' && argv[i + 1] ? [argv[i + 1]] : []));
const PATTERNS = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-live-key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g],
  // earlier pitch 2026-10-14: GitHub push protection blocked a Mapbox token inside a vendor config blob that this scanner
  // had no pattern for. Mapbox tokens are pk./sk./tk. followed by a base64 JWT-like body.
  ['mapbox-token', /\b(?:pk|sk|tk)\.ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g],
];
for (const kf of keyFiles) {
  const v = fs.readFileSync(kf, 'utf8').trim();
  for (const [i, part] of v.split(':').entries()) if (part.length >= 16) PATTERNS.push([path.basename(kf) + (i ? ':secret' : ':id'), new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')]);
}
const TEXTISH = /\.(html?|css|js|mjs|cjs|json|jsonl|md|txt|xml|svg|ya?ml|sh|ps1|ini|cfg|env|log|csv|map|htaccess)$|(^|\/)(_redirects|\.gitignore|\.gitattributes|\.nojekyll|robots\.txt)$/i;
const ALLOW_FILE = path.join(ROOT, 'tools', 'secret-allow.json');
const ALLOW = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')).entries.map((e) => ({ ...e, re: new RegExp(e.pathRe), hashes: new Set(e.sha256) })) : [];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// spans of <script ... id="<id>" ...> ... </script>, in plain HTML or in JSON-escaped markup (id=\"<id>\", <\/script>)
function scriptSpans(text, id) {
  const spans = [];
  const re = new RegExp('id=\\\\?["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\\\?["\']', 'g');
  let m;
  while ((m = re.exec(text))) {
    const start = text.lastIndexOf('<script', m.index);
    if (start < 0) continue;
    let end = text.indexOf('</script>', m.index);
    const endEsc = text.indexOf('<\\/script>', m.index);
    if (end < 0 || (endEsc >= 0 && endEsc < end)) end = endEsc;
    if (end > m.index) spans.push([start, end]);
  }
  return spans;
}
function allowedMatch(name, str, index, rel, text, spanCache) {
  for (const a of ALLOW) {
    if (a.pattern !== name || !a.hashes.has(sha(str)) || !a.re.test(rel)) continue;
    const key = a.insideScriptId;
    if (!spanCache[key]) spanCache[key] = scriptSpans(text, key);
    if (spanCache[key].some(([s, e]) => index > s && index < e)) return true;
  }
  return false;
}

function list(dir) {
  if (dir) {
    const out = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } }(dir));
    return out;
  }
  const raw = execFileSync('git', ['-C', ROOT, 'ls-files', '-co', '--exclude-standard', '-z'], { maxBuffer: 1 << 28 }).toString('utf8');
  return raw.split('\0').filter(Boolean).map((f) => path.join(ROOT, f));
}

function scan(files, base) {
  const hits = [], allowed = [];
  let scanned = 0, binary = 0;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    // binary files are scanned too (a soft-404 HTML saved under an image name once carried a key), as latin1 text
    const text = TEXTISH.test(f.split(path.sep).join('/')) ? buf.toString('utf8') : (binary++, buf.toString('latin1'));
    const rel = path.relative(base, f).split(path.sep).join('/');
    const spanCache = {};
    scanned++;
    for (const [name, re] of PATTERNS) {
      re.lastIndex = 0;
      let n = 0, ok = 0, m;
      while ((m = re.exec(text))) { if (allowedMatch(name, m[0], m.index, rel, text, spanCache)) ok++; else n++; }
      if (n) hits.push({ file: f, pattern: name, count: n });
      if (ok) allowed.push({ file: f, pattern: name, count: ok });
    }
  }
  return { scanned, binary, hits, allowed };
}

if (argv.includes('--control')) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-ctl-'));
  const planted = { 'a.html': 'key=AIza' + 'A'.repeat(35), 'b.js': 'gh' + 'p_' + 'a'.repeat(36), 'c.txt': 'AKIA' + 'ABCDEFGHIJKLMNOP', 'd.md': 'xox' + 'b-1234567890-abcdef', 'e.json': 'sk' + '_live_' + 'b'.repeat(24), 'f.pem': '-----BEGIN ' + 'PRIVATE KEY-----', 'g.webp': 'RIFF\u0000\u0000WEBPVP8 junk AIza' + 'B'.repeat(35), 'i.json': '{"mapboxAccessToken":"' + 'pk.' + 'ey' + 'A'.repeat(30) + '.' + 'B'.repeat(22) + '"}' };
  for (const kf of keyFiles) planted['h-' + path.basename(kf) + '.txt'] = 'x ' + fs.readFileSync(kf, 'utf8').trim() + ' y';
  for (const [n, v] of Object.entries(planted)) fs.writeFileSync(path.join(t, n), v);
  const r = scan(list(t), t);
  const found = new Set(r.hits.map((h) => h.pattern));
  const want = PATTERNS.map((p) => p[0]);
  const missing = want.filter((w) => !found.has(w));
  fs.rmSync(t, { recursive: true, force: true });
  console.log('control', missing.length ? 'DID NOT FIRE for: ' + missing.join(', ') : 'FIRED for all ' + want.length + ' patterns (incl. a key inside a binary-named file)');
  // allowlist controls: a real allowlisted key (read from the raw evidence, never stored) is allowed ONLY inside its
  // script element on an allowed path; outside the element, on another path, or a different key: still a hit.
  let allowFail = [];
  const raw = path.join(ROOT, 'audit', 'raw', 'store-shop.html');
  if (ALLOW.length && fs.existsSync(raw)) {
    const h = fs.readFileSync(raw, 'utf8');
    const span = scriptSpans(h, 'app-secrets')[0];
    const key = span ? (h.slice(span[0], span[1]).match(/AIza[0-9A-Za-z_-]{35}/) || [])[0] : null;
    if (!key) allowFail.push('could not read an allowlisted key from the raw evidence');
    else {
      const u = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-allow-ctl-'));
      const put = (rel, body) => { const p = path.join(u, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
      const inside = '<script type="application/json" id="app-secrets">{"k":"' + key + '"}</script>';
      put('store/shop/index.html', '<html><head>' + inside + '</head></html>');                      // allowed
      put('store/shop/menu/flower/index.html', '<p>' + key + '</p>' + inside);                       // 1 hit (outside)
      put('about-us/index.html', inside);                                                                         // 1 hit (path)
      put('store/shop/menu/vape/index.html', inside.replace(key, 'AIza' + 'Z'.repeat(35)));          // 1 hit (hash)
      put('src/content/pages/store-shop.json', JSON.stringify({ head: inside }));                    // allowed (escaped)
      const ra = scan(list(u), u);
      const hitOf = (rel) => ra.hits.filter((x) => path.relative(u, x.file).split(path.sep).join('/') === rel).reduce((n, x) => n + x.count, 0);
      const okOf = (rel) => ra.allowed.filter((x) => path.relative(u, x.file).split(path.sep).join('/') === rel).reduce((n, x) => n + x.count, 0);
      const expect = [
        ['inside the script on an allowed path is allowed', okOf('store/shop/index.html') === 1 && hitOf('store/shop/index.html') === 0],
        ['outside the script is a hit', hitOf('store/shop/menu/flower/index.html') === 1 && okOf('store/shop/menu/flower/index.html') === 1],
        ['on another path is a hit', hitOf('about-us/index.html') === 1],
        ['a different key is a hit', hitOf('store/shop/menu/vape/index.html') === 1],
        ['JSON-escaped markup in a page model is allowed', okOf('src/content/pages/store-shop.json') === 1 && hitOf('src/content/pages/store-shop.json') === 0],
      ];
      fs.rmSync(u, { recursive: true, force: true });
      for (const [n, ok] of expect) { console.log('allow-control', ok ? 'ok  ' : 'FAIL', n); if (!ok) allowFail.push(n); }
    }
  }
  process.exitCode = missing.length || allowFail.length ? 1 : 0;
} else {
  const target = dirArg ? path.resolve(dirArg) : ROOT;
  const r = scan(list(dirArg ? target : null), target);
  const nAllowed = r.allowed.reduce((n, a) => n + a.count, 0);
  console.log('secret-scan   ', dirArg ? target : 'git publish set of ' + ROOT, '| files', r.scanned, '(binary scanned as latin1:', r.binary + ')', '| patterns', PATTERNS.length, '| hits', r.hits.length, '| allowlisted matches', nAllowed, 'in', r.allowed.length, 'files (tools/secret-allow.json)');
  for (const h of r.hits) console.log('   HIT', h.pattern, h.count + 'x', path.relative(target, h.file));
  process.exitCode = r.hits.length ? 1 : 0;
}
