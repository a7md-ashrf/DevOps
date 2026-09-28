/**
 * SERVER-MODE static file server.
 *
 * WHY this exists: the same React build can be served either by a pure nginx
 * container (static mode) or by a Node process (server mode). Server mode is
 * the hook for future server-side work — SSR, per-request personalization,
 * API co-location — without changing the frontend codebase. See
 * docs/frontend-modes.md for the tradeoff table.
 *
 * Plain JavaScript on purpose: it runs in the final slim image with only
 * `express` installed — no build step, no toolchain.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT ?? 8080);

const app = express();
app.disable('x-powered-by');

// NOTE: security headers (CSP, HSTS, X-Frame-Options…) are intentionally NOT
// set here — Nginx is the single owner of those headers in both modes, so
// responses never carry two conflicting values.
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', mode: 'server' });
});

app.use(
  express.static(DIST, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite hashes everything under /assets — safe to cache for a year.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // index.html must revalidate or deploys won't show up for returning users.
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// SPA fallback: any other GET returns index.html so client-side routes work.
// Express 5 / path-to-regexp v8 no longer accepts the old '*' catch-all, and
// a method-guarded middleware sidesteps the syntax entirely.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) next(err);
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`frontend (server mode) listening on :${PORT}`);
});

// Graceful shutdown mirrors the backend: SIGTERM -> stop accepting -> exit.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
});
