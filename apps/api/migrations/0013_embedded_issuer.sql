-- The embedded OpenID Connect issuer (ADR 0028): what oidc-provider keeps
-- (sessions, grants, codes, refresh tokens), its signing keys, and the
-- passwords of the users who sign in with one. Unused when the API trusts an
-- external provider.

-- oidc-provider's adapter store. `payload` is the provider's own JSON;
-- the other columns are the lookups it asks for.
create table oidc_store (
  id text not null,
  type text not null,
  payload jsonb not null,
  grant_id text,
  uid text,
  user_code text,
  expires_at timestamptz,
  primary key (id, type)
);

create index oidc_store_grant_idx on oidc_store (grant_id) where grant_id is not null;
create index oidc_store_uid_idx on oidc_store (uid) where uid is not null;
create index oidc_store_user_code_idx on oidc_store (user_code) where user_code is not null;
create index oidc_store_expiry_idx on oidc_store (expires_at) where expires_at is not null;

-- Signing keys, newest first signs. The private half is encrypted with
-- AUTH_SECRET, so a database dump alone cannot mint tokens. A retired key
-- keeps verifying until the tokens it signed have expired, then is deleted.
create table signing_keys (
  kid text primary key,
  algorithm text not null,
  public_jwk jsonb not null,
  private_jwk_encrypted text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

-- A password sign-in method of a user. `login` is what they type (an email
-- address or a user name), compared without regard to case.
create table credentials (
  principal_id uuid primary key references users (principal_id) on delete cascade,
  login text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index credentials_login_key on credentials (lower(login));
