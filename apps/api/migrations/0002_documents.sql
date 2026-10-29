-- Documents and the URIs that identify them (docs/document-identity.md).
-- A document is the thing annotated; its URIs are every identifier a page
-- has reported for it. A normalized URI belongs to at most one document,
-- which is what makes lookup a single index scan and what forces documents
-- that turn out to share an identifier to be merged.

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title_search tsvector generated always as (to_tsvector('simple', coalesce(title, ''))) stored
);

create index documents_title_search_idx on documents using gin (title_search);

create table document_uris (
  document_id uuid not null references documents (id) on delete cascade,
  -- The URI as the page reported it.
  uri text not null,
  -- The canonical form used for lookup; the rules are in docs/document-identity.md.
  uri_normalized text not null primary key,
  -- How the URI was learned: see the relation list in docs/document-identity.md.
  relation text not null check (
    relation in ('self', 'canonical', 'shortlink', 'alternate', 'og_url', 'dc_identifier', 'doi', 'pdf_fingerprint', 'pdf_url')
  ),
  -- The page (normalized URI) that asserted this identifier, for auditing bad canonicals.
  claimant_normalized text,
  created_at timestamptz not null default now()
);

create index document_uris_document_idx on document_uris (document_id);
