import type { components } from '@scale/api-client';
import { requireAdmin } from '../auth/plugin.js';
import { conflict, notFound } from '../problems.js';
import { ConflictError } from '../profiles/service.js';
import type { AppContext, Handlers } from './context.js';

export function profileHandlers(ctx: AppContext): Handlers {
  const { profiles } = ctx;
  return {
    async listProfiles() {
      return profiles.list();
    },

    async getProfile(request) {
      const { iri } = request.params as { iri: string };
      const profile = await profiles.get(iri);
      if (!profile) throw notFound(`no body profile ${iri}`);
      return profile;
    },

    async putProfile(request, reply) {
      const caller = requireAdmin(request);
      const { iri } = request.params as { iri: string };
      try {
        const { profile, created } = await profiles.put(
          iri,
          request.body as components['schemas']['BodyProfileInput'],
          caller.userId,
        );
        reply.code(created ? 201 : 200);
        return profile;
      } catch (err) {
        if (err instanceof ConflictError) throw conflict(err.message);
        throw err;
      }
    },

    async deleteProfile(request, reply) {
      requireAdmin(request);
      const { iri } = request.params as { iri: string };
      try {
        if (!(await profiles.delete(iri))) throw notFound(`no body profile ${iri}`);
      } catch (err) {
        if (err instanceof ConflictError) throw conflict(err.message);
        throw err;
      }
      return reply.code(204).send();
    },
  };
}
