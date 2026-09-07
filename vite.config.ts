import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Die Weboberflaeche wird nach dist/web gebaut und im Betrieb vom Fastify-Server
// ausgeliefert. Im Entwicklungsmodus proxyt Vite alles unter /api an den Server.
export default defineConfig({
  root: resolve(process.cwd(), 'src/web'),
  base: './',
  build: {
    outDir: resolve(process.cwd(), 'dist/web'),
    emptyOutDir: true,
    target: 'chrome120',
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/medien': 'http://127.0.0.1:8787',
      '/stream': 'http://127.0.0.1:8787',
    },
  },
});
