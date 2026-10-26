// crawl.mjs - polite BFS harvest of https://sgencms.github.io/d2cpeptides/ into audit/raw/ for the D2C Peptides redesign pitch.
//   node tools/crawl.mjs [--gap 250] [--max 2000]
// ONE connection, --gap ms between requests; the first 401/403/429/503 stops the run (never retried); 8 x 404 inside 300 s stops it.
// Writes audit/raw/<path>/index.html (untouched bytes) + audit/crawl.json. robots.txt at the host root is 404 (no rules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]]) : a), []));
const UA = 'site-reforge/1.0 (redesign pitch crawl; +mailto:mikko@dispenza.com)';
const ORIGIN = 'https://sgencms.github.io', PREFIX = '/d2cpeptides/';
const GAP = Number(args.gap || 250), MAX = Number(args.max || 2000), MAX404 = 8;
const RAW = path.join(PROJ, 'audit/raw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ASSET = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|webm|css|js|xml|ico|woff2?|ttf|json|txt)(\?|$)/i;

function norm(u, base) {
  let x;
  try { x = new URL(u, base); } catch { return null; }
  if (!/^https?:$/.test(x.protocol) || x.hostname !== 'sgencms.github.io') return null;
  x.protocol = 'https:'; x.hash = ''; x.search = '';
  let p = x.pathname.replace(/\/{2,}/g, '/');
  if (!p.startsWith(PREFIX)) return null;
  if (ASSET.test(p)) return null;
  if (!p.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(p)) p += '/';
  x.pathname = p;
  return x.toString();
}
const fileOf = (u) => {
  let p = decodeURIComponent(new URL(u).pathname).slice(PREFIX.length);
  if (p === '' || p.endsWith('/')) p += 'index.html';
  return p;
};
let stopped = null;
const recent404 = [];
async function get(u) {
  const chain = [];
  let cur = u;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' } });
    if (res.status === 503 || res.status === 429) console.log('  ', res.status, 'retry-after:', res.headers.get('retry-after'), 'server:', res.headers.get('server'));
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), cur).toString();
      chain.push({ from: cur, status: res.status, to: next });
      await res.arrayBuffer().catch(() => {});
      if (new URL(next).hostname !== 'sgencms.github.io') return { status: res.status, chain, offOrigin: next };
      cur = next; await sleep(GAP); continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, chain, finalUrl: cur, contentType: res.headers.get('content-type') || '', buf };
  }
  return { status: 0, chain, error: 'too many redirects' };
}
function breaker(status, u) {
  if ([401, 403, 429, 503].includes(status)) { stopped = 'refusal ' + status + ' at ' + u; return true; }
  if (status === 404) {
    const now = Date.now(); recent404.push(now);
    while (recent404.length && now - recent404[0] > 300000) recent404.shift();
    if (recent404.length >= MAX404) { stopped = MAX404 + ' x 404 inside 300 s (last ' + u + ')'; return true; }
  }
  return false;
}
const records = [], seen = new Set(), queue = [];
const push = (u, from) => { const n = norm(u, from || ORIGIN + PREFIX); if (!n || seen.has(n)) return; seen.add(n); queue.push(n); };
if (args.resume && fs.existsSync(path.join(PROJ, 'audit/crawl.json'))) {
  // --resume: keep every 200/404 record, re-queue the pending list and anything that failed (5xx, 0), then continue the BFS.
  const prev = JSON.parse(fs.readFileSync(path.join(PROJ, 'audit/crawl.json'), 'utf8'));
  for (const r of prev.records) { if (r.status === 200 || r.status === 404) { records.push(r); seen.add(r.url); } }
  for (const r of prev.records) if (!(r.status === 200 || r.status === 404) && !seen.has(r.url)) { seen.add(r.url); queue.push(r.url); }
  for (const u of prev.pending) if (!seen.has(u)) { seen.add(u); queue.push(u); }
  // re-harvest links from saved pages so nothing discovered earlier is lost
  for (const r of records) if (r.status === 200 && r.file) {
    const html = fs.readFileSync(path.join(PROJ, r.file), 'utf8');
    for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']\s*([^"'#][^"']*)["']/gi)) push(m[1].replace(/&amp;/g, '&').trim(), r.finalUrl || r.url);
  }
  console.log('resume: kept', records.length, 'queue', queue.length);
} else {
  push(PREFIX);
  for (const s of ['404.html', 'search/', 'sitemap/']) push(PREFIX + s);
}
if (args.wait) await sleep(Number(args.wait));
while (queue.length && records.length < MAX) {
  const u = queue.shift();
  let r;
  try { r = await get(u); } catch (e) { records.push({ url: u, status: 0, error: String(e.message || e) }); await sleep(GAP); continue; }
  const rec = { url: u, status: r.status, chain: r.chain, finalUrl: r.finalUrl || null, contentType: r.contentType || null };
  if (r.offOrigin) rec.offOrigin = r.offOrigin;
  const halt = breaker(r.status, u);
  if (r.buf && /text\/html/i.test(r.contentType || '')) {
    const rel = fileOf(r.finalUrl || u);
    const file = path.join(RAW, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.buf);
    rec.file = 'audit/raw/' + rel; rec.bytes = r.buf.length;
    if (r.status === 200) {
      const html = r.buf.toString('utf8');
      for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']\s*([^"'#][^"']*)["']/gi)) push(m[1].replace(/&amp;/g, '&').trim(), r.finalUrl || u);
    }
  }
  records.push(rec);
  if (records.length % 25 === 0 || r.status !== 200) process.stdout.write(`${records.length} ${r.status} ${u}${r.chain.length ? ' -> ' + (r.finalUrl || r.offOrigin) : ''} (queue ${queue.length})\n`);
  if (halt && stopped) break;
  await sleep(GAP);
}
const out = { origin: ORIGIN + PREFIX, at: new Date().toISOString(), robotsHonoured: true, robots: 'host /robots.txt 404 (no rules)', gapMs: GAP, max: MAX,
  truncated: queue.length > 0 && !stopped, stopped, pending: queue, records,
  counts: { total: records.length, ok: records.filter((r) => r.status === 200).length, notFound: records.filter((r) => r.status === 404).length } };
fs.writeFileSync(path.join(PROJ, 'audit/crawl.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.counts), 'stopped:', stopped, 'pending:', queue.length, 'truncated:', out.truncated);
process.exitCode = stopped ? 1 : 0;
