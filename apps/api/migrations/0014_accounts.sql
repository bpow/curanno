-- Accounts of the embedded issuer beyond a password (ADR 0028): the email
-- addresses of a user and whether they have been proven, the single-use
-- links mailed or handed out (invitation, password reset, address
-- verification), and a record of sign-in events, which also drives the
-- throttling of guesses. Unused when the API trusts an external provider.

-- An email address of a user. Unverified until its owner follows the link
-- sent there. A verified address belongs to one user, so it can later be
-- trusted to recognise them (upstream sign-in, approval rules).
create table user_emails (
  principal_id uuid not null references users (principal_id) on delete cascade,
  email text not null,
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index user_emails_principal_email_key on user_emails (principal_id, lower(email));
create unique index user_emails_verified_key on user_emails (lower(email)) where verified_at is not null;
create unique index user_emails_primary_key on user_emails (principal_id) where is_primary;
create index user_emails_lookup_idx on user_emails (lower(email));

-- Links with a secret in them. Only the hash of the secret is kept, so
-- neither a database dump nor a backup holds a usable link. Each is used once.
create table account_tokens (
  token_hash text primary key,
  purpose text not null check (purpose in ('invite', 'reset', 'verify')),
  -- The user a reset or verification is for; an invitation has none yet.
  principal_id uuid references users (principal_id) on delete cascade,
  email text not null,
  -- An invitation may make the new user an administrator.
  is_admin boolean not null default false,
  created_by uuid references users (principal_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index account_tokens_expiry_idx on account_tokens (expires_at);

-- What happened at sign-in, kept for a limited time. `key` is a keyed hash of
-- what a throttle counts (a login, an address), never the value itself.
create table auth_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  principal_id uuid references users (principal_id) on delete set null,
  key text,
  detail text
);

create index auth_events_key_idx on auth_events (kind, key, at) where key is not null;
create index auth_events_at_idx on auth_events (at);

-- Addresses that signed in with a password before this migration have it as
-- their login; nothing proved they own it, so they are not backfilled as verified.
