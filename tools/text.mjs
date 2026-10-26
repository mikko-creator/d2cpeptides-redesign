// text.mjs - readable outline of a saved page: headings, paragraphs, list items, buttons/links, images (src + alt).
//   node tools/text.mjs <file.html> [--imgs]
import fs from 'node:fs';
const f = process.argv[2]; const imgs = process.argv.includes('--imgs');
let h = fs.readFileSync(f, 'utf8');
h = h.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '').replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
const dec = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '--').replace(/&#038;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
const out = []; let last = '';
const re = /<(h[1-6]|p|li|button|a|img|figcaption|summary|dt|dd|label|span class="elementor-heading-title[^"]*"|div class="elementor-text-editor[^"]*")\b([^>]*)>([\s\S]*?)(?=<\/\1>|<(?:h[1-6]|p|li|button|img)\b)/gi;
for (const m of h.matchAll(/<(h[1-6]|p|li|button|summary|dt|dd|figcaption)\b[^>]*>([\s\S]*?)<\/\1>|<img\b([^>]*)>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
  if (m[1]) { const t = dec(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (t && t !== last) { out.push(m[1].toUpperCase() + ': ' + t); last = t; } }
  else if (m[3] !== undefined && imgs) { const src = (/\b(?:data-src|src)=["']([^"']+)/.exec(m[3]) || [])[1] || ''; const alt = (/\balt=["']([^"']*)/.exec(m[3]) || [])[1] || ''; if (!/^data:/.test(src)) out.push('IMG: ' + src + ' | alt=' + dec(alt)); }
  else if (m[4] !== undefined) { const href = (/\bhref=["']([^"']+)/.exec(m[4]) || [])[1] || ''; const t = dec(m[5].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (t && t.length < 80 && t !== last) { out.push('A: ' + t + ' -> ' + href); last = t; } }
}
console.log(out.join('\n'));
