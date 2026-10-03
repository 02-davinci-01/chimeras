import path from 'node:path';
import { defineConfig } from 'vite';

const web = path.resolve(import.meta.dirname, 'web');

export default defineConfig({
  root: web,
  publicDir: false,
  // Lets the dev-only card harness read dist/ through /@fs.
  define: { __REPO__: JSON.stringify(import.meta.dirname) },
  appType: 'mpa',
  server: { fs: { allow: [import.meta.dirname] } },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    target: 'es2022',
    // Fonts stay files: inlined, every subset would ride in the CSS whether the page sets it or not.
    assetsInlineLimit: file => (/\.woff2?$/.test(file) ? false : undefined),
    // three.js is most of the world's weight and rarely changes, so it gets its own long-cached chunk.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        binder: path.join(web, 'binder/index.html'),
        world: path.join(web, 'world/index.html'),
      },
      output: {
        codeSplitting: { groups: [{ name: id => (id.includes('/node_modules/three/') ? 'three' : null) }] },
      },
    },
  },
});
