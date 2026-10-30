/**
 * The JSON-LD context that every annotation's `@context` names after the
 * W3C one: the definitions of this platform's extension terms, served
 * under the public URL so that the IRI dereferences.
 */
import { EXTENSION_CONTEXT_DOCUMENT } from '@curanno/model';
import type { Handlers } from './context.js';

export function vocabularyHandlers(): Handlers {
  return {
    getExtensionContext(_request, reply) {
      reply.header('cache-control', 'public, max-age=86400');
      reply.type('application/ld+json');
      return Promise.resolve(EXTENSION_CONTEXT_DOCUMENT);
    },
  };
}
