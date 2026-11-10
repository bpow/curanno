-- Ontologies loaded for term lookup in body editors, such as HPO for
-- phenotypes (docs/ontologies.md). An operator imports each release; the
-- API only reads them.

create table ontologies (
  -- The ontology's CURIE prefix in lower case: 'hp' for HP:0001639.
  name text primary key,
  title text not null,
  version text,
  license text,
  -- Where users find out more, for the attribution licenses such as HPO's ask for.
  homepage text,
  loaded_at timestamptz not null default now()
);

create table ontology_terms (
  ontology text not null references ontologies (name) on delete cascade,
  id text not null,
  label text not null,
  synonyms text[] not null default '{}',
  -- Every is_a ancestor, so that a search can stay within one branch.
  ancestors text[] not null default '{}',
  primary key (ontology, id)
);

-- Searches match a substring of a label or synonym. A sequential scan of one
-- ontology's terms is fast enough at HPO's size (about 20,000), so there is
-- no text index.
