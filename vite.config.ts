import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Ad-network webviews (MRAID, some DSP sandboxes) do not always honour `type="module"`.
 * After vite-plugin-singlefile has inlined everything, rewrite the module script into a classic
 * IIFE at the end of <body>. Runs in closeBundle so it sees the final, written HTML.
 */
function classicInlineScript(): Plugin {
  let outDir = 'dist';
  return {
    name: 'classic-inline-script',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      for (const f of readdirSync(outDir).filter((n) => n.endsWith('.html'))) {
        const file = join(outDir, f);
        let html = readFileSync(file, 'utf8');
        let boot = '';
        html = html.replace(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g, (_m, code: string) => {
          // ESM-only syntax that may survive minification in an inlined module
          boot += `<script>(function(){${code.replaceAll('import.meta.url', 'document.baseURI')}\n})();</script>`;
          return '';
        });
        if (!boot) throw new Error('classic-inline-script: no inlined module script found');
        // Replacer function: the minified bundle contains `$&` / `$'` sequences that a plain
        // replacement string would expand into the matched text.
        writeFileSync(file, html.replace('</body>', () => `${boot}\n</body>`));
      }
    },
  };
}

// Level variants: `vite build` = level 1 -> dist/, `vite build --mode level2` = level 2 -> dist-level2/.
// The dev server picks with ?level=2.
export default defineConfig(({ mode }) => ({
  define: { __LEVEL__: JSON.stringify(mode === 'level2' ? 2 : 1) },
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), classicInlineScript()],
  server: { port: 5173, host: true },
  // three + its examples must resolve to ONE module instance in dev (no split pre-bundles).
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/libs/meshopt_decoder.module.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
    ],
  },
  build: {
    outDir: mode === 'level2' ? 'dist-level2' : 'dist',
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 3, drop_console: true, pure_getters: true, unsafe_arrows: true },
      mangle: { properties: false },
      format: { comments: false },
    },
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4096,
  },
}));
