import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev convenience only: the Django backend serves /api and /media locally.
    // The backend picks the shop from the Host header, so keep the browser's
    // (e.g. demo.shop.localhost:5173); the string shorthand would rewrite it.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
