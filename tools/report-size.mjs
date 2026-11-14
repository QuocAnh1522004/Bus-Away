// Post-build report: single-file size vs common ad-network limits, plus a breakdown of what's inside.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', process.argv[2] ?? 'dist'); // build dir (dist, dist-level2)
const html = readdirSync(dist).find((f) => f.endsWith('.html'));
const buf = readFileSync(join(dist, html));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const text = buf.toString('utf8');

const dataUris = [...text.matchAll(/data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)/g)];
let assetBytes = 0;
const byType = {};
for (const m of dataUris) {
  assetBytes += m[0].length;
  byType[m[1]] = (byType[m[1]] ?? 0) + m[0].length;
}

console.log(`\n${html}: ${kb(statSync(join(dist, html)).size)}  (gzip ${kb(gzipSync(buf).length)}, brotli ${kb(brotliCompressSync(buf).length)})`);
console.log(`  inlined assets (base64): ${kb(assetBytes)}`);
for (const [t, n] of Object.entries(byType)) console.log(`    ${t.padEnd(26)} ${kb(n)}`);
console.log(`  code + markup:           ${kb(buf.length - assetBytes)}`);
const limits = { 'Meta (FB/IG)': 2, 'AppLovin': 5, 'Unity Ads': 5, 'ironSource': 5, 'Google Ads': 5, 'Mintegral': 5, 'TikTok/Pangle': 5 };
console.log('  network limits:');
for (const [n, mb] of Object.entries(limits)) console.log(`    ${n.padEnd(16)} ${mb} MB  ${buf.length <= mb * 1024 * 1024 ? 'OK' : 'TOO BIG'}`);
