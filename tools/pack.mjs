// Post-build "self-extracting" packer.
//
// The single-file build is ~70% three.js source + base64 assets, which deflate very well. Ad
// networks cap the RAW file size (they don't care about transfer gzip), so we ship:
//
//   <script> tiny inflate (fflate, raw DEFLATE only, ~4 KB) + base64(deflateRaw(bundle)) </script>
//
// At boot the bundle is inflated in one synchronous pass and injected as a classic <script>.
// The uncompressed build is kept as dist/index.uncompressed.html for networks that forbid
// script injection (e.g. strict "no eval"-style validators).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateRawSync, constants } from 'node:zlib';
import { build } from 'vite';

const dist = resolve(import.meta.dirname, '..', process.argv[2] ?? 'dist'); // build dir (dist, dist-level2)
const file = join(dist, 'index.html');
const html = readFileSync(file, 'utf8');

// The game bundle is the last classic inline script (see classicInlineScript in vite.config.ts).
const re = /<script>\(function\(\)\{([\s\S]*)\n\}\)\(\);<\/script>/;
const m = html.match(re);
if (!m) throw new Error('pack: game script not found');
const code = `(function(){${m[1]}\n})();`;

// Max-effort raw deflate.
const packed = deflateRawSync(Buffer.from(code, 'utf8'), { level: 9, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY });
const b64 = packed.toString('base64');

// Bundle just fflate's inflateSync as a minified IIFE.
const out = await build({
  logLevel: 'silent',
  configFile: false,
  build: {
    write: false,
    minify: 'terser',
    lib: { entry: resolve(import.meta.dirname, 'pack-inflate-entry.js'), formats: ['iife'], name: '__inflate' },
  },
});
const inflater = out[0].output[0].code.trim();

const loader =
  `<script>${inflater}` +
  `(function(){var s=atob("${b64}"),n=s.length,b=new Uint8Array(n);for(var i=0;i<n;i++)b[i]=s.charCodeAt(i);` +
  `var e=document.createElement("script");e.text=new TextDecoder().decode(__inflate(b));document.body.appendChild(e)})();</script>`;

copyFileSync(file, join(dist, 'index.uncompressed.html'));
writeFileSync(file, html.replace(m[0], () => loader));
console.log(`pack: bundle ${(code.length / 1024).toFixed(1)} KB -> deflate ${(packed.length / 1024).toFixed(1)} KB -> base64 ${(b64.length / 1024).toFixed(1)} KB (+ inflater ${(inflater.length / 1024).toFixed(1)} KB)`);
