-- Signing in with another provider (Google, GitHub, a generic OpenID Connect
-- provider) and linking those identities to a user (ADR 0028).

-- An identity at an upstream provider that belongs to a user. A user may have
-- several, and a password besides; the provider's own subject identifies it,
-- never the email address.
create table linked_accounts (
  provider text not null,
  external_subject text not null,
  principal_id uuid not null references users (principal_id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (provider, external_subject)
);

create index linked_accounts_principal_idx on linked_accounts (principal_id);

-- A trip to a provider and back. The state in the redirect names it; the
-- browser that started it holds a cookie whose hash is kept here, so a
-- callback replayed in another browser is refused. `login` resumes a sign-in
-- interaction (`uid`); `connect` attaches the result to `principal_id`.
create table upstream_attempts (
  state_hash text primary key,
  provider text not null,
  purpose text not null check (purpose in ('login', 'connect')),
  uid text,
  principal_id uuid references users (principal_id) on delete cascade,
  nonce text not null,
  code_verifier text not null,
  binding_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index upstream_attempts_expiry_idx on upstream_attempts (expires_at);

-- An upstream identity whose verified email matches an existing account, held
-- until the person proves they own that account by signing in to it. Nothing
-- is attached before then. Bound to the browser, short-lived, used once.
create table pending_links (
  id_hash text primary key,
  provider text not null,
  external_subject text not null,
  email text not null,
  display_name text,
  principal_id uuid not null references users (principal_id) on delete cascade,
  uid text not null,
  binding_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index pending_links_expiry_idx on pending_links (expires_at);

-- The step between a callback, which cannot see the sign-in interaction's
-- cookie, and the interaction's own path, which can: a ticket, bound to the
-- browser and the interaction, used once.
create table login_tickets (
  ticket_hash text primary key,
  principal_id uuid not null references users (principal_id) on delete cascade,
  uid text not null,
  binding_hash text not null,
  expires_at timestamptz not null
);

create index login_tickets_expiry_idx on login_tickets (expires_at);
