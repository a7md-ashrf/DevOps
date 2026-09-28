import react from '@vitejs/plugin-react';
// vitest/config re-exports Vite's defineConfig with the `test` block typed —
// plain `vite` would reject the field at typecheck time while vitest still
// reads it at runtime (a confusing half-working setup).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // `make dev`: the browser talks to Vite on :5173, which forwards /api to
    // the backend running on the host. In containers Nginx does this job
    // instead — this proxy only exists for the hot-reload workflow.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // No sourcemaps in production: smaller image, and we don't ship original
    // sources to every visitor. CI artifacts keep them for debugging instead.
    sourcemap: false,
    // Hashed filenames under /assets let Nginx serve them with a one-year
    // immutable cache — every other file stays revalidating.
    assetsDir: 'assets',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
