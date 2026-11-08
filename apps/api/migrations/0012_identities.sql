-- Identities: how a caller is recognised, separate from who they are.
-- A user was identified by one (issuer, subject) pair held on `users`; an
-- identity maps such a pair to a user, so one user can have several (a
-- second sign-in method, a provider migration, a rebuilt identity provider
-- whose subjects changed). ADR 0028.
--
-- `users.issuer` and `users.subject` stay, and are still written, so that
-- pods running the previous release keep working during a rolling upgrade;
-- the new code finds a user it knows only by those columns and adopts it
-- here. A later migration drops the columns.

create table identities (
  issuer text not null,
  subject text not null,
  principal_id uuid not null references users (principal_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (issuer, subject)
);

create index identities_principal_idx on identities (principal_id);

insert into identities (issuer, subject, principal_id, created_at, last_login_at)
select issuer, subject, principal_id, created_at, last_login_at from users;
