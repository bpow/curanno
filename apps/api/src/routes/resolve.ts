import { badGateway, notFound } from '../problems.js';
import { UpstreamError } from '../resolvers.js';
import type { AppContext, Handlers } from './context.js';

export function resolveHandlers(ctx: AppContext): Handlers {
  return {
    async resolve(request, reply) {
      const { resolver: name } = request.params as { resolver: string };
      const { q, ...context } = request.query as Record<string, string>;
      const resolver = ctx.resolvers.get(name);
      if (!resolver)
        throw notFound(`there is no ${name} lookup, or it is turned off on this server`);
      try {
        const result = await resolver.resolve(q!, context);
        void reply.header('cache-control', 'private, max-age=3600');
        return result;
      } catch (err) {
        if (err instanceof UpstreamError) throw badGateway(err.message);
        throw err;
      }
    },
  };
}
