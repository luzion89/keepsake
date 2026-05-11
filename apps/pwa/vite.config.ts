import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@keepsake/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/sync': 'http://localhost:8443',
      '/blobs': 'http://localhost:8443',
      '/ai': 'http://localhost:8443',
      '/settings/ai': 'http://localhost:8443',
      '/health': 'http://localhost:8443',
      '/logs': 'http://localhost:8443',
    },
  },
  build: { target: 'es2022' },
  test: { environment: 'jsdom', exclude: ['e2e/**', 'node_modules/**'] },
});
