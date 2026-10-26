// hf-run.mjs — one Higgsfield REST generation (image or video), saved to a file you name, with a sidecar record.
// Node builtins only. Flow (docs.higgsfield.ai): optional upload (POST /files/generate-upload-url -> PUT upload_url ->
// public_url), POST /<endpoint> -> request_id + status_url, poll status_url to a terminal state, download the output.
//
//   node tools/hf-run.mjs --key-file <path> --endpoint kling-video/v3.0-turbo/image-to-video \
//        --input '{"prompt":"...","duration":10,"resolution":"1080p"}' [--upload <local image> --upload-field image_url] \
//        --out tmp/hf/aurora.mp4 [--estimate] [--dry]
//
// The key is NEVER read from, or written into, the project tree: pass --key-file (outside it) or set HF_CREDENTIALS.
// --estimate calls POST /estimate/<endpoint> and prints the price description without generating anything.
// Writes <out>.json: endpoint, input (upload URLs kept: they are the provider's own CDN), request id, status, output url,
// bytes, sha256, time. A request id is written to <out>.pending.json the moment it is accepted, so an interrupted poll
// can be resumed with --resume <request_id> (no second charge).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  args[k] = v;
}
const keyFile = args['key-file'];
if (keyFile && path.resolve(keyFile).toLowerCase().startsWith(PROJ.toLowerCase())) { console.error('refusing a key file inside the project tree'); process.exit(2); }
const KEY = (process.env.HF_CREDENTIALS || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!KEY && !args.dry) { console.error('no Higgsfield key: set HF_CREDENTIALS or pass --key-file'); process.exit(2); }
const API = 'https://api.higgsfield.ai';
const H = { Authorization: 'Key ' + KEY, 'Content-Type': 'application/json' };
const endpoint = String(args.endpoint || '').replace(/^\/+/, '');
if (!endpoint) { console.error('need --endpoint'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const input = args['input-file'] ? JSON.parse(fs.readFileSync(path.resolve(PROJ, String(args['input-file'])), 'utf8')) : args.input ? JSON.parse(String(args.input)) : {};

async function upload(file) {
  const abs = path.resolve(PROJ, file);
  const ct = /\.png$/i.test(abs) ? 'image/png' : /\.webp$/i.test(abs) ? 'image/webp' : /\.mp4$/i.test(abs) ? 'video/mp4' : 'image/jpeg';
  const r = await fetch(API + '/files/generate-upload-url', { method: 'POST', headers: H, body: JSON.stringify({ content_type: ct }) });
  if (!r.ok) throw new Error('upload-url HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const u = await r.json();
  const put = await fetch(u.upload_url, { method: 'PUT', headers: { ...(u.upload_headers || {}), 'Content-Type': ct }, body: fs.readFileSync(abs) });
  if (!put.ok) throw new Error('upload PUT HTTP ' + put.status + ' ' + (await put.text()).slice(0, 300));
  return u.public_url;
}

// Exit codes are SET, never forced with process.exit(), once a fetch has run: on Windows, exiting while undici closes
// its sockets aborts Node with a libuv assertion (UV_HANDLE_CLOSING) and a crash code.
async function main() {
if (args.estimate) {
  const r = await fetch(API + '/estimate/' + endpoint, { method: 'POST', headers: H, body: JSON.stringify(input) });
  console.log('estimate HTTP', r.status, (await r.text()).slice(0, 1200));
  return r.ok ? 0 : 1;
}
if (!args.out) { console.error('need --out'); return 2; }
const out = path.resolve(PROJ, String(args.out));
fs.mkdirSync(path.dirname(out), { recursive: true });

try {
  let reqId = args.resume ? String(args.resume) : null;
  let statusUrl = reqId ? API + '/requests/' + reqId + '/status' : null;
  if (!reqId) {
    if (args.upload) {
      const field = String(args['upload-field'] || 'image_url');
      input[field] = await upload(String(args.upload));
      console.log('uploaded', args.upload, '->', field);
    }
    if (args.dry) { console.log('[dry]', endpoint, JSON.stringify(input).slice(0, 600)); return 0; }
    const idem = crypto.createHash('sha256').update(endpoint + JSON.stringify(input) + String(args.out)).digest('hex').slice(0, 32);
    const sub = await fetch(API + '/' + endpoint, { method: 'POST', headers: { ...H, 'Idempotency-Key': idem }, body: JSON.stringify(input) });
    const subText = await sub.text();
    if (!sub.ok) throw new Error(endpoint + ' submit HTTP ' + sub.status + ' ' + subText.slice(0, 400));
    const s = JSON.parse(subText);
    reqId = s.request_id; statusUrl = s.status_url || (API + '/requests/' + reqId + '/status');
    fs.writeFileSync(out + '.pending.json', JSON.stringify({ endpoint, input, requestId: reqId, statusUrl, acceptedAt: new Date().toISOString() }, null, 2));
    console.log('accepted', reqId);
  }
  const t0 = Date.now();
  let st;
  for (;;) {
    await sleep(4000);
    const r = await fetch(statusUrl, { headers: H });
    st = await r.json().catch(() => ({}));
    if (['completed', 'failed', 'nsfw', 'canceled', 'cancelled'].includes(st.status)) break;
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('timed out after 20 min; resume with --resume ' + reqId);
  }
  if (st.status !== 'completed') throw new Error('terminal status ' + st.status + ': ' + JSON.stringify(st).slice(0, 400));
  const url = (st.video && st.video.url) || (st.images && st.images[0] && st.images[0].url) || (st.image && st.image.url) || (st.output && st.output.url);
  if (!url) throw new Error('completed without an output url: ' + JSON.stringify(st).slice(0, 400));
  const d = await fetch(url);
  if (!d.ok) throw new Error('download HTTP ' + d.status);
  const buf = Buffer.from(await d.arrayBuffer());
  fs.writeFileSync(out, buf);
  const rec = {
    tool: 'tools/hf-run.mjs', provider: 'Higgsfield', endpoint, input, requestId: reqId, status: st.status, outputUrl: url,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    file: path.relative(PROJ, out).split(path.sep).join('/'), generatedAt: new Date().toISOString(),
    provenance: 'AI-generated (Higgsfield). Illustrative only: never a photograph of D2C Peptides (d2cpeptides.com), its products, vials, staff, customers or premises.',
  };
  fs.writeFileSync(out + '.json', JSON.stringify(rec, null, 2));
  try { fs.unlinkSync(out + '.pending.json'); } catch {}
  console.log('ok', rec.file, (buf.length / 1024).toFixed(0) + 'KB', reqId);
  return 0;
} catch (e) {
  console.error('FAIL', String(e.message || e).slice(0, 500));
  return 1;
}
}
process.exitCode = await main();
