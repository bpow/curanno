-- Groups are no longer synchronized from an identity provider's `groups`
-- claim (ADR 0026): OIDC is used for identity only, and every group is
-- managed through our own API. Existing provider-synced memberships become
-- plain local memberships; nothing further will add or remove members for
-- them automatically.

drop index groups_owner_name_key;
alter table groups drop column issuer;
create unique index groups_name_key on groups (lower(name));
