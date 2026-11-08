import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('./src/web/', import.meta.url));

export default defineConfig({
  root: webRoot,
  base: '/',
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('./dist/web/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // The server's CSP only allows same-origin scripts, styles and images.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./src/web/index.html', import.meta.url)),
        sw: fileURLToPath(new URL('./src/web/sw.ts', import.meta.url)),
      },
      output: {
        // The service worker must live at a stable URL in the site root.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
});
