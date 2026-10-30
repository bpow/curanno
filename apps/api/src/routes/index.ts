import { aclHandlers } from './acl.js';
import type { AppContext, Handlers } from './context.js';
import { documentHandlers } from './documents.js';
import { eventHandlers } from './events.js';
import { groupHandlers } from './groups.js';
import { profileHandlers } from './profiles.js';
import { protocolHandlers } from './protocol.js';
import { searchHandlers } from './search.js';
import { userHandlers } from './users.js';

/** Every operationId in apps/api/openapi.yaml, bound by fastify-openapi-glue. */
export function createHandlers(ctx: AppContext): Handlers {
  return {
    ...protocolHandlers(ctx),
    ...searchHandlers(ctx),
    ...aclHandlers(ctx),
    ...profileHandlers(ctx),
    ...documentHandlers(ctx),
    ...eventHandlers(ctx),
    ...userHandlers(ctx),
    ...groupHandlers(ctx),
  };
}
