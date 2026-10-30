import { requireUser } from '../auth/plugin.js';
import {
  findDocumentIdByUri,
  loadDocument,
  registerDocument,
  type DocumentMetadata,
} from '../documents/service.js';
import { badRequest, notFound } from '../problems.js';
import type { AppContext, Handlers } from './context.js';

export function documentHandlers(ctx: AppContext): Handlers {
  const { db } = ctx;
  return {
    async registerDocument(request, reply) {
      const caller = requireUser(request);
      const metadata = request.body as DocumentMetadata;
      let result;
      try {
        result = await registerDocument(db, metadata, caller.userId);
      } catch (err) {
        if ((err as Error).message === 'no usable URI') {
          throw badRequest('none of the reported URIs identifies a document');
        }
        throw err;
      }
      reply.code(result.created ? 201 : 200);
      return result.document;
    },

    async lookupDocument(request) {
      const { uri } = request.query as { uri: string };
      const id = await findDocumentIdByUri(db, uri);
      const document = id === undefined ? undefined : await loadDocument(db, id);
      if (!document) throw notFound(`no document is identified by ${uri}`);
      return document;
    },

    async getDocument(request) {
      const { id } = request.params as { id: string };
      const document = await loadDocument(db, id);
      if (!document) throw notFound();
      return document;
    },
  };
}
