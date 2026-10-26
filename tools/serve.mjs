#!/usr/bin/env node
// sr-serve — zero-dependency static server for a site-reforge clone.
// A clone built with root-relative paths cannot be opened over file://:
// "/styles/x.css" resolves to the filesystem root, not the clone root.
// Serving the directory is what makes those paths mean what they say.
//
//   node tools/serve.mjs [--root <dir>] [--port <n>] [--not-found <file>] [--open]
//     --root       directory to serve (default: the current directory); --port default 8787 (0 = any free port)
//     --not-found  answer every miss with this page (relative to --root) and status 404
//     --open       also open the address in a NEW Chrome window with its own profile and the network guard of
//                  tools/cdp.mjs (BUILD-CONTRACT 4.17.13). Without it no browser is opened (the default since
//                  2026-10-12, lane P0: an auto-opened default browser ran without the guard); --no-open is accepted.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const root = path.resolve(argOf('root', process.cwd()));
const port = Number(argOf('port', 8787));
const open = args.includes('--open') && !args.includes('--no-open');
/* --not-found <file, relative to root>: answer every miss with that page and status 404, the way static hosts serve
   a site's 404.html at the failing request's own path (fix round 2, D7: tests the 404 page at any depth) */
const notFound = argOf('not-found', null) ? path.resolve(root, argOf('not-found', null)) : null;

if (!fs.existsSync(root)) { console.error('no such directory: ' + root); process.exit(1); }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf', '.map': 'application/json; charset=utf-8',
};

// Resolve inside root only. A clone can carry any path a source site did, and
// "%2e%2e/" is still ".." after decoding.
function safeResolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  const abs = path.resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

const misses = new Map();

const server = http.createServer((req, res) => {
  const target = safeResolve(req.url || '/');
  if (!target) { res.writeHead(403).end('forbidden'); return; }

  const candidates = [];
  let st = null;
  try { st = fs.statSync(target); } catch { /* absent */ }
  if (st && st.isDirectory()) {
    candidates.push(path.join(target, 'index.html'));
  } else {
    candidates.push(target);
    // "/about" for a clone that wrote "about.html"
    if (!path.extname(target)) candidates.push(target + '.html', path.join(target, 'index.html'));
  }

  for (const f of candidates) {
    let s = null;
    try { s = fs.statSync(f); } catch { continue; }
    if (!s.isFile()) continue;
    const type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
    /* byte ranges, as GitHub Pages and most hosts answer them: without a 206 a browser cannot seek a
       <video> (the hero film), so frame-by-frame QA only worked on the live host */
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? Math.max(0, s.size - Number(m[2])) : Number(m[1]);
      let end = m[1] === '' || m[2] === '' ? s.size - 1 : Math.min(Number(m[2]), s.size - 1);
      if (start > end || start >= s.size) { res.writeHead(416, { 'content-range': 'bytes */' + s.size }).end(); return; }
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${s.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
      fs.createReadStream(f, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': s.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
    return;
  }

  const key = (req.url || '/').split('?')[0];
  misses.set(key, (misses.get(key) || 0) + 1);
  if (notFound && fs.existsSync(notFound)) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); fs.createReadStream(notFound).pipe(res); return; }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + key);
});

// A HARDCODED PORT IS A COIN TOSS ON A DEVELOPER'S MACHINE.
//
// The first version listened on one port and died on EADDRINUSE with an unhandled 'error'
// event — which, launched from a .cmd by double-click, means the window closes before the
// stack trace can be read. The report is "it won't load", and nothing on screen says why.
// Measured on this machine: two ports in the 87xx range were already held by other local
// apps, and one of them answered with a completely different site.
//
// So: try the requested port, then walk up. Say which one won.
const MAX_TRIES = 20;
// The port currently being attempted — not a counter. Deriving the failed port from an
// attempt index printed "port 8789 is in use" when 8790 was the one that failed, which is a
// diagnostic that sends the reader to the wrong place.
let current = port;
let tries = 0;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && tries < MAX_TRIES) {
    const failed = current;
    current += 1;
    tries += 1;
    console.log('  port ' + failed + ' is in use by something else — trying ' + current + '…');
    setTimeout(() => server.listen(current, '127.0.0.1'), 40);
    return;
  }
  console.error('\nCould not start the server: ' + (err && err.message ? err.message : String(err)));
  console.error('Nothing was changed. This window stays open so you can read the message.');
  process.exitCode = 1;
});

server.on('listening', () => {
  const actual = server.address().port;
  const url = 'http://127.0.0.1:' + actual + '/';
  console.log('serving ' + root);
  console.log('');
  console.log('    ' + url);
  console.log('');
  console.log(open ? '  A guarded Chrome window opens on it (own profile, network guard).' : '  Copy the address above into your browser (or pass --open).');
  console.log('  Leave this window open while you browse. Ctrl-C stops it,');
  console.log('  and every missing file that was requested is listed on exit.');
  if (open) {
    // never the default browser: a separate Chrome with its own profile and the network guard (exits 2 on a refused
    // SR_CHROME_ALLOW before anything starts)
    Promise.all([import('./cdp.mjs'), import('node:child_process'), import('node:os')]).then(([cdp, cp, os]) => {
      const guard = cdp.networkGuard();
      const profile = path.join(os.default.tmpdir(), 'sr-serve-chrome-' + actual);
      cp.spawn(cdp.CHROME, ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', ...guard, url], { stdio: 'ignore', detached: true }).unref();
    });
  }
});

server.listen(port, '127.0.0.1');

const report = () => {
  if (misses.size) {
    console.log('\n' + misses.size + ' path(s) requested and not found:');
    for (const [k, n] of [...misses].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log('  ' + n + '  ' + k);
  } else {
    console.log('\nno missing paths requested.');
  }
  process.exit(0);
};
process.on('SIGINT', report);
process.on('SIGTERM', report);
