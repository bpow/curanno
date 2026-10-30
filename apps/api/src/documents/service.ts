/**
 * Document identity (docs/document-identity.md, ADR 0014): resolving the
 * URIs a page reports to one document, merging documents that turn out to
 * share a URI, and finding the document a target source belongs to.
 */
import type { Kysely } from 'kysely';
import {
  canonicalizeDoi,
  canonicalizeUri,
  dcIdentifierUri,
  pdfFingerprintUri,
  resolveLink,
  type DocumentUri,
  type DocumentUriRelation,
} from '@scale/model';
import type { components } from '@scale/api-client';
import type { Database } from '../db/index.js';
import { isoDate } from '../annotations/serialize.js';

export type DocumentMetadata = components['schemas']['DocumentMetadata'];
export type DocumentJson = components['schemas']['Document'];

/** Relations in order of trust; the first wins when two give the same normalized URI. */
const PRECEDENCE: DocumentUriRelation[] = [
  'self',
  'pdf_fingerprint',
  'canonical',
  'doi',
  'dc_identifier',
  'og_url',
  'shortlink',
  'pdf_url',
];

/** Apply the normalization and guards of docs/document-identity.md to reported links. */
export function normalizeLinks(metadata: DocumentMetadata): DocumentUri[] {
  const candidates: DocumentUri[] = [];
  const add = (uri: string, relation: DocumentUriRelation, normalized: string | null): void => {
    if (normalized) candidates.push({ uri, normalized, relation });
  };
  add(metadata.uri, 'self', canonicalizeUri(metadata.uri));
  for (const link of metadata.links) {
    switch (link.relation) {
      case 'self':
        add(link.uri, 'self', canonicalizeUri(link.uri));
        break;
      case 'canonical':
      case 'og_url':
      case 'shortlink':
      case 'pdf_url':
        add(link.uri, link.relation, resolveLink(link.uri, metadata.uri));
        break;
      case 'doi':
        add(link.uri, 'doi', canonicalizeDoi(link.uri));
        break;
      case 'dc_identifier':
        add(
          link.uri,
          'dc_identifier',
          link.uri.startsWith('urn:x-dc:') ? link.uri : dcIdentifierUri(link.uri),
        );
        break;
      case 'pdf_fingerprint':
        add(
          link.uri,
          'pdf_fingerprint',
          link.uri.startsWith('urn:x-pdf:') ? link.uri.toLowerCase() : pdfFingerprintUri(link.uri),
        );
        break;
      case 'alternate':
        // Reserved: feeds, AMP copies and translations are not the same document.
        break;
    }
  }
  candidates.sort((a, b) => PRECEDENCE.indexOf(a.relation) - PRECEDENCE.indexOf(b.relation));
  const seen = new Set<string>();
  return candidates.filter((c) =>
    seen.has(c.normalized) ? false : (seen.add(c.normalized), true),
  );
}

export interface RegisterResult {
  document: DocumentJson;
  created: boolean;
}

export async function registerDocument(
  db: Kysely<Database>,
  metadata: DocumentMetadata,
  actorId: string,
): Promise<RegisterResult> {
  const uris = normalizeLinks(metadata);
  return db.transaction().execute(async (trx) => {
    const { documentId, created } = await resolveDocumentForUris(
      trx,
      uris,
      metadata.title,
      actorId,
    );
    const document = await loadDocument(trx, documentId);
    if (!document) throw new Error('document vanished during registration');
    return { document, created };
  });
}

/** The document a set of URIs identifies, created or merged as needed (docs/document-identity.md, 5 and 6). */
export async function resolveDocumentForUris(
  trx: Kysely<Database>,
  uris: DocumentUri[],
  title: string | undefined,
  actorId: string | null,
): Promise<{ documentId: string; created: boolean }> {
  if (uris.length === 0) throw new Error('no usable URI');
  const normalized = uris.map((u) => u.normalized);
  const matches = await trx
    .selectFrom('document_uris')
    .innerJoin('documents', 'documents.id', 'document_uris.document_id')
    .select(['documents.id', 'documents.created_at'])
    .distinct()
    .where('uri_normalized', 'in', normalized)
    .orderBy('documents.created_at', 'asc')
    .orderBy('documents.id', 'asc')
    .execute();

  let documentId: string;
  let created = false;
  if (matches.length === 0) {
    const doc = await trx
      .insertInto('documents')
      .values({ title: title ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    documentId = doc.id;
    created = true;
  } else {
    documentId = (matches[0] as { id: string }).id;
    if (matches.length > 1) {
      await mergeDocuments(
        trx,
        documentId,
        matches.slice(1).map((m) => m.id),
        actorId,
      );
    }
    if (title) {
      await trx
        .updateTable('documents')
        .set({ title })
        .where('id', '=', documentId)
        .where('title', 'is', null)
        .execute();
    }
  }
  const self = uris[0]?.relation === 'self' ? uris[0].normalized : null;
  await trx
    .insertInto('document_uris')
    .values(
      uris.map((u) => ({
        document_id: documentId,
        uri: u.uri,
        uri_normalized: u.normalized,
        relation: u.relation,
        claimant_normalized: u.relation === 'self' ? null : self,
      })),
    )
    .onConflict((oc) => oc.column('uri_normalized').doNothing())
    .execute();
  await trx
    .updateTable('documents')
    .set({ updated_at: new Date() })
    .where('id', '=', documentId)
    .execute();
  return { documentId, created };
}

async function mergeDocuments(
  trx: Kysely<Database>,
  survivor: string,
  others: string[],
  actorId: string | null,
): Promise<void> {
  const moved = await trx
    .updateTable('annotations')
    .set({ document_id: survivor })
    .where('document_id', 'in', others)
    .returning('id')
    .execute();
  await trx
    .updateTable('targets')
    .set({ document_id: survivor })
    .where('document_id', 'in', others)
    .execute();
  await trx
    .updateTable('document_uris')
    .set({ document_id: survivor })
    .where('document_id', 'in', others)
    .execute();
  await trx.deleteFrom('documents').where('id', 'in', others).execute();
  if (moved.length > 0) {
    await trx
      .insertInto('annotation_events')
      .values(
        moved.map((a) => ({
          annotation_id: a.id,
          document_id: survivor,
          kind: 'updated' as const,
          actor_id: actorId,
        })),
      )
      .execute();
  }
}

/** The document a target's source belongs to, created when the URI is new; undefined for URIs that identify no web resource. */
export async function documentForSource(
  trx: Kysely<Database>,
  source: string,
  actorId: string | null,
): Promise<string | undefined> {
  const normalized = canonicalizeUri(source);
  if (!normalized) return undefined;
  const { documentId } = await resolveDocumentForUris(
    trx,
    [{ uri: source, normalized, relation: 'self' }],
    undefined,
    actorId,
  );
  return documentId;
}

export async function findDocumentIdByUri(
  db: Kysely<Database>,
  uri: string,
): Promise<string | undefined> {
  const normalized = canonicalizeUri(uri);
  if (!normalized) return undefined;
  const row = await db
    .selectFrom('document_uris')
    .select('document_id')
    .where('uri_normalized', '=', normalized)
    .executeTakeFirst();
  return row?.document_id;
}

export async function loadDocument(
  db: Kysely<Database>,
  id: string,
): Promise<DocumentJson | undefined> {
  const doc = await db
    .selectFrom('documents')
    .select(['id', 'title', 'created_at', 'updated_at'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!doc) return undefined;
  const uris = await db
    .selectFrom('document_uris')
    .select(['uri', 'relation'])
    .where('document_id', '=', id)
    .orderBy('created_at', 'asc')
    .orderBy('uri_normalized', 'asc')
    .execute();
  return {
    id: doc.id,
    ...(doc.title !== null ? { title: doc.title } : {}),
    uris: uris.map((u) => ({ uri: u.uri, relation: u.relation })),
    created: isoDate(doc.created_at),
    modified: isoDate(doc.updated_at),
  };
}
