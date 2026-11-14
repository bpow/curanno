/**
 * The signed-in user's IRI, as the server names them as a creator: asked of
 * `/x/me` once per identity, since only the server knows its public URL.
 */
import { unwrap } from '@curanno/api-client';
import { useApi } from './api/client';

let cached: Promise<string | undefined> | undefined;

export function currentUserIri(): Promise<string | undefined> {
  const asking =
    cached ??
    useApi()
      .GET('/x/me')
      .then((res) => unwrap(res).iri)
      .catch(() => {
        cached = undefined;
        return undefined;
      });
  cached = asking;
  return asking;
}

/** Signing in or out, or as someone else, asks again. */
export function forgetCurrentUser(): void {
  cached = undefined;
}
