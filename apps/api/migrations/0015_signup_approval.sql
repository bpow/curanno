-- Sign-up with approval (ADR 0028). A user has a status: only an `active`
-- user acts as themself; a `pending` one (waiting for an administrator) and a
-- `rejected` or `disabled` one are treated as anonymous by the API, apart from
-- reading their own status. Every existing user stays active, so external
-- mode, where the provider decides who may sign in, is unaffected.
alter table users
  add column status text not null default 'active'
    check (status in ('pending', 'active', 'rejected', 'disabled'));

-- What someone asked for when they signed up, and what was decided. A pending
-- application has no decision. These hold personal data about people who may
-- never be approved, so rejected and abandoned ones are purged after a time.
create table applications (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null unique references users (principal_id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  decision text check (decision in ('approved', 'rejected')),
  decided_at timestamptz,
  decided_by uuid references users (principal_id) on delete set null,
  decision_note text,
  check ((decision is null) = (decided_at is null))
);

create index applications_pending_idx on applications (created_at) where decision is null;
