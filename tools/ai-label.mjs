#!/usr/bin/env node
// ai-label.mjs - embed and verify the IPTC "trainedAlgorithmicMedia" AI label (tools/ai-label.xmp) in generated media.
// Node builtins only (ffmpeg/ffprobe on PATH for video). BUILD-CONTRACT 4.10 and 4.17.12, DESIGN-SPEC R-40.
//
//   node tools/ai-label.mjs embed  <file|dir>...           label every JPEG, PNG, MP4 and WebM given (dirs: recursive)
//   node tools/ai-label.mjs verify <file|dir>... [--control] [--json]
//
// embed:
//   JPEG  an APP1 segment "http://ns.adobe.com/xap/1.0/\0" + the XMP packet, after SOI (and after APP0/JFIF when
//         present); an existing XMP APP1 is replaced, every other byte is kept (no re-encode).
//   PNG   an iTXt chunk, keyword "XML:com.adobe.xmp", uncompressed, before the first IDAT; an existing one is replaced.
//   MP4 / WebM  ffmpeg stream copy (-c copy, no re-encode) with the container tags comment + description carrying the
//         IPTC digital source type URI (XMP-in-video is not written by ffmpeg); the file is replaced atomically.
//   Idempotent: a file already carrying this exact label is left untouched (same bytes).
// verify:
//   Every file must carry the label: a byte grep for "trainedAlgorithmicMedia" returns 1 or more (the R-40 test), AND the
//   label sits where a reader finds it (JPEG: inside an XMP APP1; PNG: inside the XMP iTXt; video: in the container tags
//   per ffprobe; JSON sidecar: an iptcDigitalSourceType field). A file of any other type is reported (fail closed).
//   --control: a positive control. Labelled copies of a JPEG, a PNG and (when given) a video are stripped of the label in
//   a temp dir; verify must report each stripped copy as UNLABELLED and each labelled copy as labelled, or exit 1.
// Exit: 0 all labelled (and the control fired), 1 otherwise, 2 usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const XMP = fs.readFileSync(path.join(PROJ, 'tools/ai-label.xmp'), 'utf8').trim();
export const NEEDLE = 'trainedAlgorithmicMedia';
export const DST_URI = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
export const VIDEO_NOTE = 'AI-generated illustrative motion. IPTC digital source type: ' + DST_URI + '. Not footage of D2C Peptides (d2cpeptides.com), its products, vials, staff, customers or premises.';
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
const FF = process.env.FFMPEG || 'ffmpeg', FP = process.env.FFPROBE || 'ffprobe';

/* ---------------- JPEG ---------------- */
function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (no SOI)');
  const segs = [];
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) throw new Error('JPEG marker expected at ' + o);
    const m = buf[o + 1];
    if (m === 0xff) { o++; continue; }                      // fill byte
    if (m === 0xda || m === 0xd9) { segs.push({ m, o, end: buf.length, tail: true }); break; }   // SOS: the rest is scan data
    if (m >= 0xd0 && m <= 0xd7) { segs.push({ m, o, end: o + 2 }); o += 2; continue; }
    const len = buf.readUInt16BE(o + 2);
    segs.push({ m, o, end: o + 2 + len });
    o += 2 + len;
  }
  return segs;
}
const isXmpApp1 = (buf, s) => s.m === 0xe1 && buf.toString('latin1', s.o + 4, s.o + 4 + XMP_NS.length) === XMP_NS;
export function jpegXmp(buf) {
  for (const s of jpegSegments(buf)) if (isXmpApp1(buf, s)) return buf.toString('utf8', s.o + 4 + XMP_NS.length, s.end);
  return null;
}
export function jpegEmbed(buf, xmp = XMP) {
  const segs = jpegSegments(buf);
  const payload = Buffer.concat([Buffer.from(XMP_NS, 'latin1'), Buffer.from(xmp, 'utf8')]);
  if (payload.length + 2 > 0xffff) throw new Error('XMP packet too large for one APP1');
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(payload.length + 2, 2); payload.copy(app1, 4);
  const kept = segs.filter((s) => !isXmpApp1(buf, s));
  // insert after APP0 (JFIF/JFXX) segments when present, else right after SOI
  let at = 0;
  while (at < kept.length && kept[at].m === 0xe0) at++;
  const parts = [buf.subarray(0, 2)];
  kept.forEach((s, i) => { if (i === at) parts.push(app1); parts.push(buf.subarray(s.o, s.end)); });
  if (at >= kept.length) parts.push(app1);
  return Buffer.concat(parts);
}
export function jpegStrip(buf) {
  const segs = jpegSegments(buf);
  return Buffer.concat([buf.subarray(0, 2), ...segs.filter((s) => !isXmpApp1(buf, s)).map((s) => buf.subarray(s.o, s.end))]);
}

/* ---------------- PNG ---------------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  const out = [];
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    out.push({ type, o, end: o + 12 + len, data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
const XMP_KEY = 'XML:com.adobe.xmp';
const isXmpItxt = (c) => c.type === 'iTXt' && c.data.toString('latin1', 0, XMP_KEY.length + 1) === XMP_KEY + '\0';
export function pngXmp(buf) {
  for (const c of pngChunks(buf)) if (isXmpItxt(c)) {
    // keyword\0 compFlag compMethod lang\0 transKey\0 text
    let p = XMP_KEY.length + 1;
    const comp = c.data[p]; p += 2;
    p = c.data.indexOf(0, p) + 1; p = c.data.indexOf(0, p) + 1;
    if (comp) return null;   // compressed XMP is not written by this tool
    return c.data.toString('utf8', p);
  }
  return null;
}
export function pngEmbed(buf, xmp = XMP) {
  const chunks = pngChunks(buf);
  const data = Buffer.concat([Buffer.from(XMP_KEY + '\0', 'latin1'), Buffer.from([0, 0]), Buffer.from('\0\0', 'latin1'), Buffer.from(xmp, 'utf8')]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write('iTXt', 4, 'latin1'); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  const kept = chunks.filter((c) => !isXmpItxt(c));
  const at = kept.findIndex((c) => c.type === 'IDAT');
  if (at < 0) throw new Error('PNG without IDAT');
  const parts = [PNG_SIG];
  kept.forEach((c, i) => { if (i === at) parts.push(chunk); parts.push(buf.subarray(c.o, c.end)); });
  return Buffer.concat(parts);
}
export function pngStrip(buf) { return Buffer.concat([PNG_SIG, ...pngChunks(buf).filter((c) => !isXmpItxt(c)).map((c) => buf.subarray(c.o, c.end))]); }

/* ---------------- video (MP4 / WebM) ---------------- */
function run(bin, a) { const r = spawnSync(bin, a, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(bin + ' failed: ' + (r.stderr || '').slice(-600)); return r.stdout; }
export function videoTags(file) {
  const j = JSON.parse(run(FP, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file]));
  const tags = { ...((j.format && j.format.tags) || {}) };
  for (const s of j.streams || []) Object.assign(tags, Object.fromEntries(Object.entries(s.tags || {}).map(([k, v]) => ['stream:' + k, v])));
  return tags;
}
function videoLabelled(file) { return Object.values(videoTags(file)).some((v) => String(v).includes(DST_URI)); }
export function videoEmbed(file, note = VIDEO_NOTE) {
  if (videoLabelled(file) && fs.readFileSync(file).includes(NEEDLE)) return false;
  const ext = path.extname(file);
  const tmp = file + '.label-tmp' + ext;
  const fmt = ext.toLowerCase() === '.webm' ? [] : ['-movflags', '+faststart'];
  run(FF, ['-y', '-loglevel', 'error', '-i', file, '-map', '0', '-c', 'copy', ...fmt, '-metadata', 'comment=' + note, '-metadata', 'description=' + note, tmp]);
  fs.renameSync(tmp, file);
  return true;
}
function videoStrip(file, out) { run(FF, ['-y', '-loglevel', 'error', '-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '-1', '-fflags', '+bitexact', out]); }

/* ---------------- dispatch ---------------- */
const kindOf = (f) => {
  const e = path.extname(f).toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'jpeg';
  if (e === '.png') return 'png';
  if (e === '.mp4' || e === '.webm') return 'video';
  if (e === '.json') return 'sidecar';
  if (e === '.webp') return 'webp';
  return 'other';
};
/** embed the label into one file in place; returns 'labelled' | 'already' */
export function embedFile(file) {
  const k = kindOf(file);
  if (k === 'video') return videoEmbed(file) ? 'labelled' : 'already';
  if (k !== 'jpeg' && k !== 'png') throw new Error('cannot embed into ' + k + ': ' + file);
  const buf = fs.readFileSync(file);
  const cur = k === 'jpeg' ? jpegXmp(buf) : pngXmp(buf);
  if (cur && cur.trim() === XMP) return 'already';
  const out = k === 'jpeg' ? jpegEmbed(buf) : pngEmbed(buf);
  const tmp = file + '.label-tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  return 'labelled';
}
/** check one file; returns { file, kind, grep (count of the needle), where (structural), ok } */
export function checkFile(file) {
  const k = kindOf(file);
  const buf = fs.readFileSync(file);
  let grep = 0, i = -1;
  while ((i = buf.indexOf(NEEDLE, i + 1)) !== -1) grep++;
  let where = null;
  try {
    if (k === 'jpeg') { const x = jpegXmp(buf); where = x && x.includes(DST_URI) ? 'jpeg APP1 XMP' : null; }
    else if (k === 'png') { const x = pngXmp(buf); where = x && x.includes(DST_URI) ? 'png iTXt XMP' : null; }
    else if (k === 'video') where = videoLabelled(file) ? 'container tags (ffprobe)' : null;
    else if (k === 'sidecar') { const j = JSON.parse(buf.toString('utf8')); where = j.iptcDigitalSourceType === DST_URI ? 'sidecar iptcDigitalSourceType' : null; }
    else if (k === 'webp') where = buf.includes('XMP ') && buf.includes(DST_URI) ? 'webp XMP chunk' : null;
  } catch (e) { where = null; }
  return { file, kind: k, grep, where, ok: grep >= 1 && !!where };
}
function walk(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n), out); }
  else out.push(p);
  return out;
}

function control(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-label-control-'));
  const res = [];
  const pick = (k) => files.find((f) => kindOf(f) === k && checkFile(f).ok);
  for (const k of ['jpeg', 'png', 'video']) {
    const src = pick(k);
    if (!src) { res.push({ kind: k, skipped: 'no labelled ' + k + ' among the inputs' }); continue; }
    const ext = path.extname(src);
    const stripped = path.join(dir, 'stripped-' + k + ext);
    if (k === 'jpeg') fs.writeFileSync(stripped, jpegStrip(fs.readFileSync(src)));
    else if (k === 'png') fs.writeFileSync(stripped, pngStrip(fs.readFileSync(src)));
    else videoStrip(src, stripped);
    const a = checkFile(stripped);
    // and back: embedding into the stripped copy must make it pass again
    const relab = path.join(dir, 'relabelled-' + k + ext);
    fs.copyFileSync(stripped, relab);
    embedFile(relab);
    const b = checkFile(relab);
    res.push({ kind: k, from: path.relative(PROJ, src).split(path.sep).join('/'), strippedReportedUnlabelled: !a.ok, strippedGrep: a.grep, relabelledPasses: b.ok, fired: !a.ok && b.ok });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = new Set(rest.filter((a) => a.startsWith('--')));
  const targets = rest.filter((a) => !a.startsWith('--'));
  if (!['embed', 'verify'].includes(cmd) || !targets.length) { console.error('usage: node tools/ai-label.mjs embed|verify <file|dir>... [--control] [--json]'); process.exit(2); }
  const files = targets.flatMap((t) => walk(path.resolve(t))).filter((f) => !/\.(label-tmp|tmp-\d+)/.test(f));
  if (cmd === 'embed') {
    let n = 0, already = 0, failed = 0;
    for (const f of files) {
      const k = kindOf(f);
      if (k === 'sidecar') continue;
      try { const r = embedFile(f); r === 'labelled' ? n++ : already++; console.log(r.padEnd(9), path.relative(PROJ, f)); }
      catch (e) { failed++; console.log('FAIL     ', path.relative(PROJ, f), String(e.message).slice(0, 200)); }
    }
    console.log('embed: labelled ' + n + ', already ' + already + ', failed ' + failed);
    process.exitCode = failed ? 1 : 0;
  } else {
    const rows = files.map(checkFile);
    const bad = rows.filter((r) => !r.ok);
    if (opts.has('--json')) console.log(JSON.stringify(rows, null, 1));
    else for (const r of rows) console.log((r.ok ? 'ok   ' : 'MISS ') + String(r.grep).padStart(2) + '  ' + (r.where || '-').padEnd(30) + ' ' + path.relative(PROJ, r.file).split(path.sep).join('/'));
    let ctlOk = true;
    if (opts.has('--control')) {
      const c = control(files);
      for (const x of c) console.log('control ' + x.kind + ': ' + (x.skipped ? 'SKIPPED (' + x.skipped + ')' : (x.fired ? 'FIRED' : 'DID NOT FIRE') + ' (stripped copy of ' + x.from + ' reported unlabelled=' + x.strippedReportedUnlabelled + ', grep ' + x.strippedGrep + '; relabelled passes=' + x.relabelledPasses + ')'));
      ctlOk = c.every((x) => x.skipped || x.fired) && c.some((x) => x.fired);
    }
    console.log('verify: ' + rows.length + ' files, ' + (rows.length - bad.length) + ' labelled, ' + bad.length + ' missing' + (opts.has('--control') ? ', control ' + (ctlOk ? 'fired' : 'FAILED') : ''));
    process.exitCode = bad.length || !ctlOk ? 1 : 0;
  }
}
