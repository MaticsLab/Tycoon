import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    // In dev the game server runs separately on :8080.
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
  build: { target: 'es2020' },
});
