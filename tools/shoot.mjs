// shoot.mjs — full-page screenshots at exact widths (asserted), after fonts + images settle.
//   node src/tools/shoot.mjs --url http://127.0.0.1:8795/_lab/pop.html --widths 1440,390 --out tmp/shots/lab [--full] [--scroll-steps 0]
// Writes <out>.<width>.png. With --scroll-steps N it scrolls the page in N steps first so
// lazy images and scroll-driven reveals have run (a hidden, never-scrolled page lies).
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './cdp.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]]) : a), []));
const widths = String(args.widths || '1440,390').split(',').map(Number);
const out = path.resolve(args.out || 'tmp/shots/shot');
fs.mkdirSync(path.dirname(out), { recursive: true });
const b = await launch({ port: 0 });
const report = [];
try {
  for (const w of widths) {
    const p = await b.newPage({ width: w, height: Number(args.height || 900), mobile: false });
    // --init "<js>" runs before any page script (e.g. pre-set the 21+ consent so the gate stays closed)
    if (args.init) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: String(args.init) });
    if (args['reduced-motion']) await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const href = await p.goto(args.url, { settle: 600, timeout: 60000 });
    const iw = await p.eval('innerWidth');
    if (iw !== w) throw new Error(`viewport not applied: wanted ${w} got ${iw}`);
    // A 404 page screenshots just as happily as the real one: assert the document status.
    const status = await p.eval("(performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0");
    if (status !== 200) throw new Error(`document status ${status} for ${href} — refusing to screenshot an error page`);
    await p.eval('document.fonts.ready.then(() => true)');
    const steps = Number(args['scroll-steps'] || 0);
    if (steps) {
      const H = await p.eval('document.documentElement.scrollHeight');
      for (let i = 1; i <= steps; i++) { await p.eval(`scrollTo(0, ${Math.round((H * i) / steps)})`); await sleep(260); }
      await p.eval('scrollTo(0, 0)'); await sleep(400);
    }
    await p.eval(`Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 8000); })))`);
    await sleep(Number(args.settle || 500));
    const info = await p.eval(`({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')).slice(0, 10), title: document.title })`);
    const file = `${out}.${w}.png`;
    if (args.slices) {
      // full-height layout, then clip-capture consecutive slices at 1:1 (readable, no stitching)
      const H = await p.eval('document.documentElement.scrollHeight');
      const sliceH = Number(args.slices) > 1 ? Number(args.slices) : 1400;
      await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(H, 30000), deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      for (let y = 0, k = 0; y < H; y += sliceH, k++) {
        const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y, width: w, height: Math.min(sliceH, H - y), scale: 1 }, captureBeyondViewport: true });
        fs.writeFileSync(`${out}.${w}.s${String(k).padStart(2, '0')}.png`, Buffer.from(r.data, 'base64'));
      }
      await p.viewport(w, Number(args.height || 900));
    }
    await p.screenshot(file, { full: !!args.full });
    report.push({ w, href, ...info, file });
    console.log(w, 'scrollWidth', info.sw, info.sw > w ? 'OVERFLOW' : 'ok', 'height', info.sh, 'broken', info.broken.length, info.broken.join(' '), '->', path.relative(process.cwd(), file));
  }
} finally { await b.close(); }
