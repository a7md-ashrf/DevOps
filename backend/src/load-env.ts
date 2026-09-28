import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader for HOST development only.
 *
 * WHY hand-rolled instead of the `dotenv` package: ~20 lines, zero supply
 * chain, and the semantics we need are trivial (KEY=VALUE, # comments, quotes).
 * Docker never uses this — containers receive configuration through compose
 * `environment:` blocks, which is the 12-factor path. Existing environment
 * variables always win, so a real env var can never be silently overridden.
 */
export function loadEnvFile(file: string = path.resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;

  const content = readFileSync(file, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
