-- Groups learned from an identity provider's `groups` claim are owned by
-- that provider: membership is synchronized from the claim on every login,
-- so a user removed from the provider's group loses access here too.
-- Groups created through the API keep issuer null and are never touched by
-- that synchronization.

alter table groups add column issuer text;
