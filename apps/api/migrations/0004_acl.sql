-- Access control: one row per (annotation, principal, permission), joined
-- by every read path (ADR 0006). The creator receives all four permissions
-- when an annotation is created; the server inserts those rows.

create table acl (
  annotation_id uuid not null references annotations (id) on delete cascade,
  principal_id uuid not null references principals (id) on delete cascade,
  permission text not null check (permission in ('read', 'update', 'delete', 'share')),
  granted_by uuid references users (principal_id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (annotation_id, principal_id, permission)
);

-- Search filters by the caller's principals and permission 'read'; this
-- index serves that join without touching the table.
create index acl_principal_idx on acl (principal_id, permission, annotation_id);
