/**
 * A `fetch` that answers from recorded responses of the Allele Registry and
 * VariantValidator (`fixtures/*.json`, trimmed copies of live answers), for
 * tests. A request with no recording fails, as an unreachable service would.
 */
import { readdirSync, readFileSync } from 'node:fs';

export interface Recording {
  status: number;
  body: unknown;
}

/** Every recording in `fixtures/`, as one map from URL to answer. */
export function loadRecordings(): Record<string, Recording> {
  // Run from src (vitest) or dist (built): both resolve to src/variants/fixtures.
  const dir = new URL('../../src/variants/fixtures/', import.meta.url);
  const recordings: Record<string, Recording> = {};
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    Object.assign(
      recordings,
      JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as Record<string, Recording>,
    );
  }
  return recordings;
}

export function fixtureFetch(
  recordings: Record<string, Recording> = loadRecordings(),
  requested: string[] = [],
): typeof fetch {
  return (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const recording = recordings[url];
    if (!recording) return Promise.reject(new TypeError(`fetch failed: no recording for ${url}`));
    return Promise.resolve(
      new Response(JSON.stringify(recording.body), {
        status: recording.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}
