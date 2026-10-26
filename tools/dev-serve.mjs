// dev-serve.mjs - serve dist/ under the preview prefix, the way GitHub Pages will (misses get 404.html with status 404).
//   node tools/dev-serve.mjs [--root dist] [--prefix /d2cpeptides-redesign/] [--port 8790]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
const root = path.resolve(ROOT, arg('root', 'dist'));
const prefix = '/' + String(arg('prefix', '/d2cpeptides-redesign/')).replace(/^\/+|\/+$/g, '') + '/';
const port = Number(arg('port', 8790));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === prefix.slice(0, -1)) { res.writeHead(301, { location: prefix }); return res.end(); }
  if (!p.startsWith(prefix)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('outside prefix'); }
  let f = path.join(root, p.slice(prefix.length));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { location: p + '/' }); return res.end(); }
    f = path.join(f, 'index.html');
  }
  if (!fs.existsSync(f)) {
    const nf = path.join(root, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
  }
  const type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
  const stat = fs.statSync(f);
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && type.startsWith('video/')) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-store' });
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${path.relative(ROOT, root)} at http://127.0.0.1:${port}${prefix}`));
