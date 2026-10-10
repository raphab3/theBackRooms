import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // As chamadas /api vão para o worker (wrangler dev).
    proxy: { '/api': 'http://localhost:8787' },
  },
});
