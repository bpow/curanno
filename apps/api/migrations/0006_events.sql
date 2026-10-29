-- Change events for the server-sent events stream (ADR 0004). Rows give
-- clients a Last-Event-ID to resume from; the trigger fans each row out
-- over LISTEN/NOTIFY so running servers push it without polling.

create table annotation_events (
  id bigint generated always as identity primary key,
  -- No foreign key: deletion events outlive their annotation.
  annotation_id uuid not null,
  document_id uuid,
  kind text not null check (kind in ('created', 'updated', 'deleted')),
  actor_id uuid references users (principal_id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index annotation_events_document_idx on annotation_events (document_id, id);

create function notify_annotation_event() returns trigger language plpgsql as $$
begin
  perform pg_notify(
    'annotation_events',
    json_build_object(
      'id', new.id,
      'annotation_id', new.annotation_id,
      'document_id', new.document_id,
      'kind', new.kind
    )::text
  );
  return new;
end
$$;

create trigger annotation_events_notify
  after insert on annotation_events
  for each row execute function notify_annotation_event();
