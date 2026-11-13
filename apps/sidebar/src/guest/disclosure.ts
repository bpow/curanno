/**
 * Which annotations a page may be sent (ADR 0025). Search finds a
 * document's annotations through every URI it is known by, so a page can
 * be linked, rightly or not, to a document that was annotated on another
 * site. Sending such an annotation's selectors to the page would hand it
 * the quoted text. A guest is therefore sent an annotation only when every
 * target names a page on the guest's own origin, when anyone may read the
 * annotation anyway, when the guest is a trusted origin (the PDF viewer),
 * or when the user allowed annotations from that origin on that page's
 * origin. The page's origin is the browser's report (ADR 0024).
 */
import { sourcesOf, type OneOrMany, type Target } from '@curanno/model';

/**
 * The key an origin is compared and remembered by: the host and port,
 * whatever the scheme, as document identity treats `http` and `https` as
 * one (docs/document-identity.md, section 3). `null` for an opaque origin.
 */
export function originKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.host;
  } catch {
    return null;
  }
}

/**
 * The origins, by `originKey`, of the sources not on `pageKey`; a source
 * that is not an http(s) URL counts as foreign under its own text.
 */
export function foreignSources(target: OneOrMany<Target>, pageKey: string | null): string[] {
  const foreign = new Set<string>();
  for (const source of sourcesOf(target)) {
    const key = originKey(source);
    if (key === null) foreign.add(source);
    else if (key !== pageKey) foreign.add(key);
  }
  return [...foreign];
}

/** The user's permissions to show one origin's annotations on another's pages. */
export interface ConsentStore {
  has(pageKey: string, sourceKey: string): boolean;
  add(pageKey: string, sourceKey: string): void;
}

const STORAGE_KEY = 'curanno.disclosure';

/**
 * Consent kept in the sidebar origin's `sessionStorage`, where the page
 * cannot read or set it, for the life of the tab, as the sidebar's sign-in
 * is (ADR 0019). With `null`, or no storage, it lasts as long as the sidebar.
 */
export function createSessionConsent(storage: Storage | null = safeSessionStorage()): ConsentStore {
  const pairs = new Set<string>();
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (Array.isArray(stored)) for (const p of stored) if (typeof p === 'string') pairs.add(p);
  } catch {
    // Unreadable consent is no consent.
  }
  const key = (pageKey: string, sourceKey: string) => JSON.stringify([pageKey, sourceKey]);
  return {
    has: (pageKey, sourceKey) => pairs.has(key(pageKey, sourceKey)),
    add(pageKey, sourceKey) {
      pairs.add(key(pageKey, sourceKey));
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...pairs]));
      } catch {
        // Kept in memory for this sidebar.
      }
    },
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
