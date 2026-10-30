-- The read check every query makes, `exists (select 1 from acl where
-- annotation_id = ? and permission = 'read' and principal_id = any(?))`,
-- probed the primary key with the caller's principals as index keys, which
-- the planner costs per principal; for a caller in many groups it preferred
-- hashing every annotation the caller may read, whatever the query asked
-- for. This index answers the probe from one descent: the annotation's
-- read grants, filtered by principal (docs/performance.md).

create index acl_annotation_read_idx on acl (annotation_id) include (principal_id)
  where permission = 'read';
