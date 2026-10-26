// Minimal CDP driver: Node 24 global WebSocket, no dependencies.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Network guard (BUILD-CONTRACT 4.17.13): browser checks never touch the network. Every Chrome launch from tools/
// (this file, tools/cdp-realsb.mjs, tools/serve.mjs --open) maps every host to NOTFOUND except localhost, 127.0.0.1
// (no image CDN), and runs with --no-proxy-server so no proxy can resolve a name on Chrome's behalf.
// SR_CHROME_ALLOW (host names separated by commas or spaces; a leading "*." covers subdomains) adds hosts for one run.
// A bare wildcard or an IP address is refused and the process exits 2. Callers cannot pass their own resolver or
// proxy flags (also exit 2).
export const GUARD_EXCLUDE = ['localhost', '127.0.0.1']; // no third-party image CDN is exempt by default
const GUARD_BANNED_ARG = /^--(host-resolver-rules|proxy-server|proxy-pac-url|proxy-auto-detect|proxy-bypass-list|winhttp-proxy-resolver)(=|$)/i;
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
// -> the guard flags; throws (does not exit) on a refused host or argument, so tests can call it
export function guardArgs(extraArgs = [], env = process.env) {
  for (const a of extraArgs) if (GUARD_BANNED_ARG.test(String(a))) throw new Error('refused: ' + String(a).split('=')[0] + ' would override the network guard (BUILD-CONTRACT 4.17.13)');
  const added = [];
  const raw = String(env.SR_CHROME_ALLOW || '').trim();
  for (const tok of raw ? raw.split(/[\s,]+/).filter(Boolean) : []) {
    const h = tok.toLowerCase().replace(/\.+$/, '');
    const glob = new RegExp('^' + h.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (h === '*' || glob.test('a.b.example.invalid')) throw new Error('refused: SR_CHROME_ALLOW takes no bare wildcard (got "' + tok + '")');
    if (!HOST_RE.test(h)) throw new Error('refused: SR_CHROME_ALLOW takes host names only (got "' + tok + '")');
    if (/^\d+(\.\d+){3}$/.test(h)) throw new Error('refused: SR_CHROME_ALLOW takes host names, not IP addresses (got "' + tok + '")');
    if (!GUARD_EXCLUDE.includes(h) && !added.includes(h)) added.push(h);
  }
  return ['--host-resolver-rules=MAP * ~NOTFOUND, ' + GUARD_EXCLUDE.concat(added).map((h) => 'EXCLUDE ' + h).join(', '), '--no-proxy-server'];
}
// -> the guard flags, or refuse and exit 2 before any Chrome starts
export function networkGuard(extraArgs = [], env = process.env) {
  try { return guardArgs(extraArgs, env); } catch (err) { console.error('[network guard] ' + err.message); process.exit(2); }
}

export async function launch({ port = 0, userDataDir, extraArgs = [] } = {}) {
  const guard = networkGuard(extraArgs);
  userDataDir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'srcdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...extraArgs, ...guard,
  ], { stdio: 'ignore', detached: false });
  // port 0: Chrome picks a free port and writes it to <userDataDir>/DevToolsActivePort, so
  // parallel runs never collide on a fixed debugging port.
  let ver;
  for (let i = 0; i < 100; i++) {
    try {
      let p = port;
      if (!p) { const f = path.join(userDataDir, 'DevToolsActivePort'); if (!fs.existsSync(f)) throw new Error('no port yet'); p = Number(fs.readFileSync(f, 'utf8').trim().split(/\s+/)[0]); }
      ver = await (await fetch(`http://127.0.0.1:${p}/json/version`)).json(); break;
    } catch { await sleep(150); }
  }
  if (!ver) throw new Error('chrome did not start');
  const b = new Browser(ver.webSocketDebuggerUrl, proc);
  await b.open();
  return b;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Browser {
  constructor(url, proc) { this.url = url; this.proc = proc; this.id = 0; this.pending = new Map(); this.listeners = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(e);
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id);
          msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
        } else if (msg.method) for (const l of this.listeners) l(msg);
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const p = new Promise((res, rej) => this.pending.set(id, { res, rej }));
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return p;
  }
  on(fn) { this.listeners.push(fn); }
  async newPage({ width = 1440, height = 900, mobile = false } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const pg = new Page(this, sessionId, targetId);
    await pg.send('Page.enable'); await pg.send('Runtime.enable'); await pg.send('Network.enable');
    await pg.viewport(width, height, mobile);
    return pg;
  }
  async close() { try { await this.send('Browser.close'); } catch {} try { this.proc.kill(); } catch {} }
}

class Page {
  constructor(b, sessionId, targetId) { this.b = b; this.sessionId = sessionId; this.targetId = targetId; }
  send(m, p) { return this.b.send(m, p, this.sessionId); }
  async viewport(width, height, mobile = false) {
    this.w = width; this.h = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }
  async goto(url, { waitFor = 'document.readyState === "complete"', timeout = 45000, settle = 800 } = {}) {
    await this.send('Page.navigate', { url });
    await sleep(300);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(`(()=>{try{return !!(${waitFor})}catch(e){return false}})()`)) break; } catch {}
      await sleep(250);
    }
    await sleep(settle);
    return this.eval('location.href');
  }
  async eval(expr, { awaitPromise = true, timeout = 60000 } = {}) {
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }),
      sleep(timeout).then(() => { throw new Error('eval timeout'); }),
    ]);
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  }
  async screenshot(file, { full = false } = {}) {
    let clip;
    if (full) {
      const h = await this.eval('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
      await this.send('Emulation.setDeviceMetricsOverride', { width: this.w, height: Math.min(h, 16000), deviceScaleFactor: 1, mobile: false });
      await sleep(600);
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    if (full) await this.viewport(this.w, this.h);
    return file;
  }
  async cookies() { return (await this.send('Network.getCookies')).cookies; }
  async setCookie(c) { return this.send('Network.setCookie', c); }
}
