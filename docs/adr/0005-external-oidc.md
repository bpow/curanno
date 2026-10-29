# 0005. Authentication through an external OpenID Connect provider

**Status:** Accepted

**Date:** 2026-10-29

## Context

The system needs login, but building and operating an account system means password storage, reset flows, multi-factor authentication and the security review that comes with all of them. Our users already have identities in institutional systems, and the deployments we expect run alongside an identity provider.

## Decision

The server authenticates users through OpenID Connect against an external provider, such as Keycloak or Authentik, using `openid-client`. There is no built-in account system and no password storage. User records in our database hold the provider's subject identifier and the profile fields we need, created on first login. Local development runs Keycloak from the compose stack with a seeded realm, so the real login flow is exercised from the start.

## Consequences

- No password handling in our code, and multi-factor authentication, account recovery and federation are the provider's concern.
- Any deployment needs an identity provider. A standalone installation without one is not supported.
- Providers differ in claims, token lifetimes and discovery details. The plan tests against Keycloak locally and the production provider in Phase 3 to catch these differences.
- Group membership may live in the provider, in our database, or both. The ACL model (ADR 0006) treats groups as our own principals, and any synchronization from provider groups is a later, explicit decision.
- Session handling for the sidebar iframe must work across origins, which constrains cookie settings and may require token-based sessions.

## References

- [Analysis note: Server](../web-annotation-replacement.md#1-server)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
