# 0026. Groups are managed entirely through our own API; OIDC is identity only

**Status:** Accepted

**Date:** 2026-10-31

## Context

ADR 0005 left provider groups open: "Group membership may live in the provider, in our database, or both... any synchronization from provider groups is a later, explicit decision." That sync was later added: groups carried a nullable `issuer` (null for groups created through the API, an issuer IRI for groups learned from a token's `groups` claim), membership in provider-owned groups was reconciled with the claim on every sign-in, and provider-owned groups were read-only through the API. Keeping the two kinds safely apart needed three pieces of special-casing to stay consistent with each other: group names unique per owner rather than globally, claim-sync scoped to the issuer that owns a group, and a check blocking API writes to provider-owned groups. A mismatch between any of these previously let a group created through the API be renamed to a not-yet-seen provider group's name and receive its members on their next sign-in (security review, finding 2).

curanno's groups are ad hoc and curanno-specific (e.g. "reviewers for study X"), not a reflection of groups the identity provider already maintains for other purposes. Syncing them from the provider's `groups` claim bought nothing here: there is no organizational group to stay in step with, so the sync, its special-casing and the bug class it enabled were pure cost.

## Decision

The `groups` claim is no longer read. A token's claims are used only to establish identity (issuer, subject, name, email); `TokenClaims` drops `groups` and the verifier stops parsing it. Every group is created, renamed, deleted and has its membership managed through `/x/groups` alone, by its own administrators or a platform administrator — the same path already used for API-created groups. The `issuer` column on `groups` is dropped, along with `requireApiManaged()` and the per-owner name scoping; group names are unique again, full stop.

Platform administrators continue to be managed as `users.is_admin`, set directly (SQL for the first one, then `PATCH /x/users/{id}`) rather than derived from a `groups` claim; `OIDC_ADMIN_GROUP` and `config.oidc.adminGroup` are removed, so every deployment now uses the local-flag path that already existed as the fallback when no admin group was configured.

## Consequences

- No more claim-sync code path, and the group-name-squatting bug class it enabled cannot recur: there is one namespace, one way to create a group, one way to change its membership.
- Removing someone from a directory group at the identity provider no longer revokes curanno access by itself. Access changes go through curanno's own group API (or deleting the user's account) instead of propagating from the provider.
- An admin's membership change takes effect immediately rather than waiting for the member's next sign-in, since there is no claim reconciliation to race.
- If a future deployment does want directory-group-driven access, that is a new, separate decision (as ADR 0005 anticipated) and would need to re-add a sync path deliberately, not by reverting this one.

## References

- ADR 0005, ADR 0006
- [Security review](../security-review.md), finding 2
