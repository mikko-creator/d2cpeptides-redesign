// harvest-assets.mjs - download every same-origin asset the crawl references (audit/asset-refs.json + brand extras)
// into audit/assets/<path under /d2cpeptides/>, query strings dropped. One connection, 150 ms apart; 401/403/429 stop the run.
//   node tools/harvest-assets.mjs [--refs audit/asset-refs.json]
import fs from 'node:fs';
import path from 'node:path';
const UA = 'site-reforge/1.0 (redesign pitch crawl; +mailto:mikko@dispenza.com)';
const refsFile = process.argv.includes('--refs') ? process.argv[process.argv.indexOf('--refs') + 1] : 'audit/asset-refs.json';
const refs = JSON.parse(fs.readFileSync(refsFile, 'utf8')).map((r) => (typeof r === 'string' ? r : r.path));
const extras = ['/d2cpeptides/img/brand/og-default.png', '/d2cpeptides/img/brand/logo-mark-512.png', '/d2cpeptides/favicon.ico',
  '/d2cpeptides/robots.txt', '/d2cpeptides/sitemap.xml', '/d2cpeptides/manifest.webmanifest', '/d2cpeptides/site.webmanifest'];
const all = [...new Set([...refs, ...extras])];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prev = fs.existsSync('audit/assets.json') ? JSON.parse(fs.readFileSync('audit/assets.json', 'utf8')) : [];
const done = new Map(prev.filter((r) => r.status === 200 || r.status === 404).map((r) => [r.path, r]));
const out = [...done.values()];
function magicOf(buf) {
  const b = buf.subarray(0, 12);
  const head = buf.subarray(0, 300).toString('utf8');
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (/^\s*<(\?xml|svg)/.test(head)) return 'svg';
  if (/^\s*(<!doctype html|<html)/i.test(head)) return 'HTML';
  return 'text';
}
for (const p of all) {
  if (done.has(p)) continue;
  const url = 'https://sgencms.github.io' + p;
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': UA } }); } catch (e) { out.push({ path: p, status: 0, error: String(e.message || e) }); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const rec = { path: p, status: res.status, type: res.headers.get('content-type'), bytes: buf.length };
  if ([401, 403, 429].includes(res.status)) { out.push(rec); console.log('STOP', res.status, p); break; }
  if (res.status === 200) {
    const file = path.join('audit/assets', p.replace(/^\/d2cpeptides\//, ''));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    rec.file = file.split(path.sep).join('/');
    rec.magic = magicOf(buf);
  }
  out.push(rec);
  await sleep(150);
}
fs.writeFileSync('audit/assets.json', JSON.stringify(out, null, 1));
const ok = out.filter((r) => r.status === 200);
console.log('fetched', ok.length, 'of', out.length, '| non-200:', out.filter((r) => r.status !== 200).map((r) => r.status + ' ' + r.path).join(', '));
const census = {};
for (const r of ok) census[r.magic] = (census[r.magic] || 0) + 1;
console.log('magic census', JSON.stringify(census));
const extOk = { png: 'png', webp: 'webp', jpg: 'jpeg', jpeg: 'jpeg', svg: 'svg', gif: 'gif' };
console.log('magic/extension mismatch:', ok.filter((r) => { const e = (r.path.match(/\.([a-z0-9]+)$/i) || [])[1]; return e && extOk[e] && r.magic !== extOk[e]; }).map((r) => r.path + ':' + r.magic).join(', ') || 'none');
