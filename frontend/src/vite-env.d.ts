/// <reference types="vite/client" />

/**
 * Build-time environment variables. Vite inlines these at `vite build` — they
 * are NOT runtime config. We deliberately keep the app to ONE optional var
 * (see src/api/client.ts) so a single image works in every environment.
 */
interface ImportMetaEnv {
  /** API prefix; defaults to '/api' (same-origin behind Nginx). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
