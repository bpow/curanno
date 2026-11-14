import { notFound } from '../problems.js';
import { hasOntology, listOntologies, searchTerms } from '../ontologies/service.js';
import type { AppContext, Handlers } from './context.js';

export function ontologyHandlers(ctx: AppContext): Handlers {
  return {
    async listOntologies() {
      return listOntologies(ctx.db);
    },

    async searchOntologyTerms(request, reply) {
      const { name } = request.params as { name: string };
      const { q, root, limit } = request.query as { q: string; root?: string; limit: number };
      if (!(await hasOntology(ctx.db, name))) throw notFound(`no ontology ${name} is loaded`);
      // Terms change only when an operator imports a new release, so a browser may repeat
      // an autocomplete or a suggestion run's lookups from its own cache for a while.
      void reply.header('cache-control', 'private, max-age=300');
      return searchTerms(ctx.db, name, { q, root, limit });
    },
  };
}
