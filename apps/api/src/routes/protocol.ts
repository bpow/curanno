/**
 * The W3C Web Annotation Protocol: the single container (ADR 0015) and the
 * annotation resources with ETags and conditional requests.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AnnotationInput } from '@curanno/model';
import { parseAnnotationInput } from '../annotations/input.js';
import {
  annotationIri,
  etagOf,
  isoDate,
  toAnnotation,
  type AnnotationRecord,
} from '../annotations/serialize.js';
import { requireUser } from '../auth/plugin.js';
import { findDocumentIdByUri } from '../documents/service.js';
import { forbidden, gone, notFound, preconditionFailed } from '../problems.js';
import { NIL_UUID, type AppContext, type Handlers } from './context.js';

export const ANNOTATION_PROFILE = 'http://www.w3.org/ns/anno.jsonld';
export const ANNOTATION_CONTENT_TYPE = `application/ld+json; profile="${ANNOTATION_PROFILE}"`;
const LDP = 'http://www.w3.org/ns/ldp#';
const LDP_CONTEXT = 'http://www.w3.org/ns/ldp.jsonld';
const PROTOCOL = 'http://www.w3.org/TR/annotation-protocol/';
export const CONTAINER_PAGE_SIZE = 20;

type Representation = 'minimal' | 'iris' | 'descriptions';

interface ContainerQuery {
  page?: number;
  iris?: 0 | 1;
  target?: string;
}

/** `application/json` when the client asked for it and not for JSON-LD; otherwise the protocol's media type. */
export function negotiate(request: FastifyRequest): string {
  const accept = request.headers.accept ?? '';
  if (/application\/json/.test(accept) && !/ld\+json/.test(accept)) return 'application/json';
  return ANNOTATION_CONTENT_TYPE;
}

function ifMatchSatisfied(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((s) => s.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}

function representationFor(
  request: FastifyRequest,
  iris: 0 | 1 | undefined,
): { representation: Representation; applied: boolean } {
  if (iris === 0) return { representation: 'descriptions', applied: false };
  if (iris === 1) return { representation: 'iris', applied: false };
  const prefer = request.headers['prefer'];
  const value = Array.isArray(prefer) ? prefer.join(',') : (prefer ?? '');
  if (value.includes(`${LDP}PreferMinimalContainer`))
    return { representation: 'minimal', applied: true };
  if (value.includes(`${LDP}PreferContainedDescriptions`)) {
    return { representation: 'descriptions', applied: true };
  }
  if (value.includes(`${LDP}PreferContainedIRIs`)) return { representation: 'iris', applied: true };
  return { representation: 'iris', applied: false };
}

export function protocolHandlers(ctx: AppContext): Handlers {
  const { store, profiles, config } = ctx;
  const publicUrl = config.publicUrl;

  function sendAnnotation(
    request: FastifyRequest,
    reply: FastifyReply,
    record: AnnotationRecord,
    status = 200,
  ) {
    reply
      .code(status)
      .type(negotiate(request))
      .header('etag', etagOf(record))
      .header('link', `<${LDP}Resource>; rel="type"`)
      .header('allow', 'GET, HEAD, OPTIONS, PUT, DELETE')
      .header('vary', 'Accept');
    return toAnnotation(record, publicUrl);
  }

  async function loadForWrite(request: FastifyRequest, permission: 'update' | 'delete') {
    const caller = requireUser(request);
    const { id } = request.params as { id: string };
    const record = await store.get(id, caller);
    if (!record) throw notFound();
    if (record.deleted_at !== null) throw gone();
    if (!record.permissions.includes(permission)) {
      throw forbidden(`the ${permission} permission is required`);
    }
    const ifMatch = request.headers['if-match'] as string;
    if (!ifMatchSatisfied(ifMatch, etagOf(record))) throw preconditionFailed();
    return { caller, record };
  }

  return {
    async listContainer(request, reply) {
      const query = request.query as ContainerQuery;
      const caller = request.caller;
      const { representation, applied } = representationFor(request, query.iris);
      let documentId: string | undefined;
      if (query.target !== undefined) {
        documentId = (await findDocumentIdByUri(ctx.db, query.target)) ?? NIL_UUID;
      }
      const containerIri =
        `${publicUrl}/annotations/` +
        (query.target !== undefined ? `?target=${encodeURIComponent(query.target)}` : '');
      const pageIri = (page: number): string =>
        `${containerIri}${query.target !== undefined ? '&' : '?'}page=${page}&iris=${
          representation === 'descriptions' ? 0 : 1
        }`;

      const page = query.page ?? 0;
      const result = await store.list(caller, {
        documentId,
        limit: query.page === undefined && representation === 'minimal' ? 0 : CONTAINER_PAGE_SIZE,
        offset: page * CONTAINER_PAGE_SIZE,
      });
      const lastPage = Math.max(0, Math.ceil(result.total / CONTAINER_PAGE_SIZE) - 1);
      if (query.page !== undefined && page > lastPage) {
        throw notFound(`the container has ${lastPage + 1} page(s)`);
      }
      const pageObject = (n: number) => ({
        '@context': ANNOTATION_PROFILE,
        id: pageIri(n),
        type: 'AnnotationPage',
        partOf: containerIri,
        startIndex: n * CONTAINER_PAGE_SIZE,
        items:
          representation === 'descriptions'
            ? result.items.map((r) => toAnnotation(r, publicUrl))
            : result.items.map((r) => annotationIri(publicUrl, r.id)),
        ...(n < lastPage ? { next: pageIri(n + 1) } : {}),
        ...(n > 0 ? { prev: pageIri(n - 1) } : {}),
      });

      const modified = result.modified ? isoDate(result.modified) : new Date().toISOString();
      reply
        .type(negotiate(request))
        .header('etag', `"${result.total}-${Date.parse(modified)}"`)
        .header(
          'link',
          `<${LDP}BasicContainer>; rel="type", <${PROTOCOL}>; rel="${LDP}constrainedBy"`,
        )
        .header('allow', 'GET, HEAD, OPTIONS, POST')
        .header('accept-post', `${ANNOTATION_CONTENT_TYPE}, application/json`)
        .header('vary', 'Accept, Prefer');
      if (applied) reply.header('preference-applied', 'return=representation');

      if (query.page !== undefined) return pageObject(page);
      return {
        '@context': [ANNOTATION_PROFILE, LDP_CONTEXT],
        id: containerIri,
        type: ['BasicContainer', 'AnnotationCollection'],
        total: result.total,
        modified,
        first: representation === 'minimal' ? pageIri(0) : pageObject(0),
        last: pageIri(lastPage),
      };
    },

    async createAnnotation(request, reply) {
      const caller = requireUser(request);
      const parsed = parseAnnotationInput(request.body as AnnotationInput);
      await profiles.validateBodies(parsed.bodies);
      const id = await store.create(parsed, caller);
      const record = await store.get(id, caller);
      if (!record) throw new Error('created annotation is not readable by its creator');
      reply.header('location', annotationIri(publicUrl, id));
      return sendAnnotation(request, reply, record, 201);
    },

    async getAnnotation(request, reply) {
      const { id } = request.params as { id: string };
      const record = await store.get(id, request.caller);
      if (!record) throw notFound();
      if (record.deleted_at !== null) throw gone();
      return sendAnnotation(request, reply, record);
    },

    async updateAnnotation(request, reply) {
      const { caller, record } = await loadForWrite(request, 'update');
      const parsed = parseAnnotationInput(request.body as AnnotationInput);
      await profiles.validateBodies(parsed.bodies);
      await store.replace(record, parsed, caller);
      const updated = await store.get(record.id, caller);
      if (!updated) throw new Error('updated annotation is not readable');
      return sendAnnotation(request, reply, updated);
    },

    async deleteAnnotation(request, reply) {
      const { caller, record } = await loadForWrite(request, 'delete');
      await store.softDelete(record, caller);
      return reply.code(204).send();
    },
  };
}
