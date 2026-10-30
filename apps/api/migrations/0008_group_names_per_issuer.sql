-- A group name is unique within its owner: among the groups one identity
-- provider manages, and among the groups created through the API (issuer
-- null). Before this, the name was unique across both, so a group created
-- through the API with the name of a provider group not yet seen would
-- receive that provider group's members on their next login (security
-- review, finding 1).

drop index groups_name_key;
create unique index groups_owner_name_key on groups (coalesce(issuer, ''), lower(name));
