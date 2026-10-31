-- Carries occurred_at in the NOTIFY payload so a live subscriber's read
-- check can be pinned to the event's own moment rather than whatever ACL
-- state exists when the check happens to run (events.ts).

create or replace function notify_annotation_event() returns trigger language plpgsql as $$
begin
  perform pg_notify(
    'annotation_events',
    json_build_object(
      'id', new.id,
      'annotation_id', new.annotation_id,
      'document_id', new.document_id,
      'kind', new.kind,
      'occurred_at', new.occurred_at
    )::text
  );
  return new;
end
$$;
