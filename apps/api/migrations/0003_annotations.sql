-- Annotations, their targets and bodies. The W3C JSON-LD shape is split
-- into columns the server queries (document, creator, motivation, anchoring
-- state, quote, textual value) and JSONB for everything else, so that
-- extension properties round-trip unchanged (ADR 0011).

create table annotations (
  id uuid primary key default gen_random_uuid(),
  -- The document the targets refer to; null for annotations that only target other annotations.
  document_id uuid references documents (id) on delete set null,
  -- For replies (motivation "replying" with another annotation as target).
  parent_id uuid references annotations (id) on delete cascade,
  created_by uuid not null references users (principal_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Incremented on every update; the source of the ETag.
  version integer not null default 1,
  motivation text[] not null default '{}',
  -- Annotation-level properties other than id, type, body, target, creator,
  -- created, modified and motivation: generator, rights, extensions, ...
  data jsonb not null default '{}'::jsonb,
  -- Deleted annotations stay so that the protocol can answer 410 Gone and
  -- the event stream can report the deletion.
  deleted_at timestamptz
);

create index annotations_document_idx on annotations (document_id, created_at desc) where deleted_at is null;
create index annotations_created_by_idx on annotations (created_by, created_at desc) where deleted_at is null;
create index annotations_parent_idx on annotations (parent_id) where parent_id is not null;
create index annotations_motivation_idx on annotations using gin (motivation);
create index annotations_updated_idx on annotations (updated_at desc);

create table targets (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references annotations (id) on delete cascade,
  position integer not null,
  source text not null,
  document_id uuid references documents (id) on delete set null,
  -- The selectors recorded at creation. Never rewritten (ADR 0010).
  selectors jsonb,
  anchoring_state text not null default 'anchored'
    check (anchoring_state in ('anchored', 'orphaned', 'ambiguous', 'repaired')),
  -- A user's repair: {selector, creator, created}. Present only when anchoring_state = 'repaired'.
  repair jsonb,
  -- Other target properties: state, styleClass, renderedVia, scope, extensions.
  data jsonb not null default '{}'::jsonb,
  -- The first TextQuoteSelector's exact text, at any depth of refinedBy, for search and display.
  quote text generated always as (
    jsonb_path_query_first(selectors, '$.** ? (@.type == "TextQuoteSelector").exact') #>> '{}'
  ) stored,
  quote_search tsvector generated always as (
    to_tsvector('english', coalesce(jsonb_path_query_first(selectors, '$.** ? (@.type == "TextQuoteSelector").exact') #>> '{}', ''))
  ) stored,
  unique (annotation_id, position),
  check ((anchoring_state = 'repaired') = (repair is not null))
);

create index targets_document_idx on targets (document_id);
create index targets_source_idx on targets (source);
create index targets_quote_search_idx on targets using gin (quote_search);
create index targets_anchoring_idx on targets (anchoring_state) where anchoring_state <> 'anchored';

create table bodies (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references annotations (id) on delete cascade,
  position integer not null,
  -- The body exactly as received (a string body is stored as a JSON string).
  body jsonb not null,
  body_type text generated always as (body ->> 'type') stored,
  -- Profile IRI of a StructuredBody (docs/body-profiles.md).
  profile text generated always as (body ->> 'profile') stored,
  text_value text generated always as (
    case when body ->> 'type' = 'TextualBody' then body ->> 'value' end
  ) stored,
  text_search tsvector generated always as (
    to_tsvector('english', coalesce(case when body ->> 'type' = 'TextualBody' then body ->> 'value' end, ''))
  ) stored,
  unique (annotation_id, position)
);

create index bodies_text_search_idx on bodies using gin (text_search);
-- Containment queries on purpose, profile and structured values: body @> '{"purpose": "tagging"}'.
create index bodies_body_idx on bodies using gin (body jsonb_path_ops);
create index bodies_profile_idx on bodies (profile) where profile is not null;
