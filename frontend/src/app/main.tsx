import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Initialize i18n before first render (one language at a time; default नेपाली).
import '@/lib/i18n';
import App from './App';
import '@/styles/index.css';
import '@/styles/tokens.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// App-shell service worker for the installable/offline-bootable POS (PWA).
// Production only — in dev it would serve stale bundles. It never caches
// /api responses (see public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
