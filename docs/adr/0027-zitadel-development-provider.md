# 0027. Zitadel is the development and CI identity provider

**Status:** Accepted

**Date:** 2026-11-04

## Context

ADR 0005 has the API accept any external OpenID Connect provider and ran Keycloak, from a realm file imported at start, as the stand-in for local development and CI. The production deployment will most likely use Zitadel, on the same OpenShift cluster as the platform. Testing against a provider other than the one in production leaves its differences (claims, token formats, login flow) to be found late, as ADR 0005 anticipated.

Zitadel differs from Keycloak in ways that shape the setup. It has no realm import, so its project, client and users are created through its API. It generates client ids. Its access tokens are opaque unless the application asks for JWTs, and they carry no profile claims. Its login UI v2 is a separate service. It has no password grant.

## Decision

The compose stack and CI run Zitadel v4.20.1 with login UI v2, behind one proxy on `localhost:8080`, with its database in the compose Postgres. Keycloak and its realm file are removed.

`deploy/zitadel/provision.ts` creates the project, one public client for the sidebar and the management site (JWT access tokens, PKCE), and the development users. It is idempotent and works against any instance given a token with the IAM_OWNER role. The compose stack runs it on every `up` and it writes the generated client id to `deploy/zitadel/.bootstrap/oidc.env`; the API, the sidebar's and the site's dev servers and the end-to-end tests fall back to that file after the environment and the repository `.env`.

Tests that need a token without a browser use Zitadel's session API with the login UI's service account, in place of the password grant (`apps/api/src/test/dev-token.ts`).

`deploy/zitadel/values.yaml` pilots Zitadel itself on OpenShift with the official chart, in the same shape: API and login UI on one host.

## Consequences

- Development and CI exercise the production provider's discovery, keys, token format and login UI, including the userinfo fallback for names and emails.
- The client id is no longer a constant. The code no longer has a default for it, and a fresh stack has to be provisioned before anything signs in.
- Zitadel's state lives in Postgres alongside the tokens it writes to `deploy/zitadel/.bootstrap/` on first start; the two must be reset together.
- The end-to-end tests follow Zitadel's login UI labels, which may change between Zitadel releases.
- The API stays provider-neutral: the `azp` check that Keycloak needed remains and does no harm.

## References

- ADR 0005, ADR 0019
- `deploy/zitadel/README.md`
