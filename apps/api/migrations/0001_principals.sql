-- Principals: users, groups and the two pseudo-principals (ADR 0006).
-- One table gives ACL rows a single foreign key whatever kind of principal
-- they name; users and groups extend it with their own tables.

create table principals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('user', 'group', 'public', 'authenticated')),
  created_at timestamptz not null default now()
);

-- Fixed identifiers so that queries and clients can name the pseudo-principals.
insert into principals (id, kind) values
  ('00000000-0000-0000-0000-000000000001', 'public'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated');

create table users (
  principal_id uuid primary key references principals (id) on delete cascade,
  -- The OpenID Connect issuer and subject identify a user (ADR 0005).
  issuer text not null,
  subject text not null,
  display_name text,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (issuer, subject)
);

create table groups (
  principal_id uuid primary key references principals (id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references users (principal_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index groups_name_key on groups (lower(name));

create table group_memberships (
  group_id uuid not null references groups (principal_id) on delete cascade,
  user_id uuid not null references users (principal_id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  added_by uuid references users (principal_id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_memberships_user_idx on group_memberships (user_id);
