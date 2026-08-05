/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Django dev server (config/urls mounts the API under /api). The
      // tenant comes from the request HOST (invariant 4), so the proxy must
      // send the seeded demo tenant's host explicitly. IPv4 loopback avoids
      // `demo.localhost` resolving to ::1 before Docker's Windows port proxy.
      '/api': {
        target: 'http://127.0.0.1:8000',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            const browserHost = request.headers.host?.split(':')[0] ?? 'localhost';
            const apiHost =
              browserHost === 'localhost' || browserHost === '127.0.0.1'
                ? 'demo.localhost'
                : browserHost;
            proxyRequest.setHeader('Host', apiHost);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
