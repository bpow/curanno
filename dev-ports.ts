/// <reference types="node" />
/**
 * The development stack's ports, so it can move off ports another project
 * holds. Each comes from the environment, then the repository .env, then its
 * default: the environment wins, as with `node --env-file`. PGPORT and
 * ZITADEL_PORT are compose's and are read by compose itself.
 *
 *   node dev-ports.ts WEB_PORT   # prints the port
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const DEFAULTS = {
  PORT: 3000,
  WEB_PORT: 3001,
  SIDEBAR_PORT: 5173,
  PDF_VIEWER_PORT: 5174,
  GUEST_PORT: 5180,
  GUEST_BUNDLE_PORT: 5181,
} as const;

export type DevPortName = keyof typeof DEFAULTS;

function repositoryEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL('.env', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

export function devPort(name: DevPortName): number {
  const value = process.env[name] || repositoryEnv()[name];
  if (!value) return DEFAULTS[name];
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a port number, not ${JSON.stringify(value)}`);
  }
  return port;
}

if (import.meta.main) {
  const name = process.argv[2];
  if (!name || !(name in DEFAULTS)) {
    console.error(`usage: node dev-ports.ts ${Object.keys(DEFAULTS).join('|')}`);
    process.exit(2);
  }
  // Not console.log: under FORCE_COLOR (Playwright's web servers) it colors numbers.
  process.stdout.write(`${devPort(name as DevPortName)}\n`);
}
