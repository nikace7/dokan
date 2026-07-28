/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Django API. Empty = same-origin `/api` (dev proxy). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
