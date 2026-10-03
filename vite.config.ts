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
    rollupOptions: {
      input: {
        binder: path.join(web, 'binder/index.html'),
        world: path.join(web, 'world/index.html'),
      },
    },
  },
});
