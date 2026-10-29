-- Registered body profiles: a JSON Schema per profile IRI (docs/body-profiles.md).
-- Built-in profiles from packages/model are upserted here at server start so
-- that the API lists one registry.

create table body_profiles (
  iri text primary key,
  title text not null,
  description text,
  schema jsonb not null,
  -- Built-in profiles are owned by the code and cannot be edited through the API.
  builtin boolean not null default false,
  enabled boolean not null default true,
  created_by uuid references users (principal_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
