-- The purpose clients give a new body of a profile (ADR 0030). Unlike the
-- purpose mapping for JSON textual bodies, several profiles may share one.

alter table body_profiles add column default_purpose text;
