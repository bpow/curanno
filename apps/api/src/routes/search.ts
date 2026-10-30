import type { AnchoringState } from '@scale/model';
import { toAnnotation } from '../annotations/serialize.js';
import { findDocumentIdByUri } from '../documents/service.js';
import type { AppContext, Handlers } from './context.js';

interface SearchQuery {
  uri?: string;
  document?: string;
  text?: string;
  motivation?: string;
  purpose?: string;
  profile?: string;
  creator?: string;
  state?: AnchoringState;
  parent?: string;
  since?: string;
  until?: string;
  sort?: 'created' | 'modified';
  order?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export function searchHandlers(ctx: AppContext): Handlers {
  return {
    async searchAnnotations(request) {
      const q = request.query as SearchQuery;
      let documentId = q.document;
      if (documentId === undefined && q.uri !== undefined) {
        documentId = await findDocumentIdByUri(ctx.db, q.uri);
        if (documentId === undefined) return { total: 0, items: [] };
      }
      const result = await ctx.store.list(request.caller, {
        documentId,
        text: q.text,
        motivation: q.motivation,
        purpose: q.purpose,
        profile: q.profile,
        creator: q.creator,
        state: q.state,
        parent: q.parent,
        since: q.since,
        until: q.until,
        sort: q.sort,
        order: q.order,
        limit: q.limit,
        offset: q.offset,
      });
      return {
        total: result.total,
        items: result.items.map((r) => toAnnotation(r, ctx.config.publicUrl)),
      };
    },
  };
}
