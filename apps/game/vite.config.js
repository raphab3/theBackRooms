import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    // Duas páginas: o jogo clássico (/) e o lobby 3D (/lobby/).
    rollupOptions: { input: { main: page('index.html'), lobby: page('lobby/index.html') } },
    chunkSizeWarningLimit: 700, // three.js sozinho passa de 500 kB sem compressão
  },
  server: {
    port: 5173,
    // As chamadas /api (inclusive WebSocket) vão para o worker (wrangler dev).
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
