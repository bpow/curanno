# 0028. An optional embedded OpenID Connect issuer, with linked identities and approval-based sign-up

**Status:** Accepted

**Date:** 2026-11-07

## Context

ADR 0005 has the API accept tokens from an external OpenID Connect provider and keeps account handling out of our code. ADR 0027 made Zitadel the development and CI provider. That keeps password storage, recovery and MFA out of the platform, but it makes every deployment run and back up a second system: Zitadel, its login UI, its masterkey, a proxy, a provisioning job and a client-id handoff. For small installations the identity provider is then most of the operational cost.

Two product needs are also awkward with an external provider alone:

- A person should be able to sign in with any of several identities (a password, Google, GitHub, an institutional OIDC provider) and reach the same account, with the same annotations and group memberships.
- Some deployments want open sign-up that an administrator approves, rather than administrators creating every user.

The API identifies a user by `(issuer, subject)` (`users` is unique on that pair), and annotations, ACLs and groups all hang off `principal_id`. The sidebar is a public PKCE client that sends bearer tokens and keeps no server session (ADR 0019).

Options considered:

- **Stay external only.** Linking and approval would be left to Zitadel's settings. Zitadel cannot merge two existing users, and its approval and linking behaviour is not ours to shape. Deployment weight stays.
- **A bespoke login with a session cookie.** Cookies do not work in the sidebar's third-party frame, so the popup and token machinery of ADR 0019 would be needed anyway. Rejected.
- **Several external issuers trusted directly by the API.** The sidebar and site are configured for one issuer and one client; this rebuilds a broker badly. Rejected.
- **An embedded OpenID Connect issuer that also brokers upstream providers.** The sidebar, the site and the verifier keep working unchanged. Chosen.

## Decision

The API can run its own OpenID Connect issuer, selected by `AUTH_MODE=embedded`. `AUTH_MODE=external` remains the default and ADR 0005 continues to hold for it; this ADR adds a mode and amends nothing about external behaviour.

**Issuer.** The issuer is `PUBLIC_URL`, an origin without a path, mounted in the API process, built on `oidc-provider` (node-oidc-provider; MIT, and its 40 production dependencies are MIT or ISC) with a Postgres adapter and JWT access tokens whose `aud` names the API, issued through its resource-indicator support with a default resource. The sidebar and the site remain public Authorization Code with PKCE clients with a fixed client id. Signing keys are stored in Postgres, sealed with `AUTH_SECRET` (which also keys the issuer's cookies, and so is the same on every replica), shared by replicas, and rotated with an overlap window. The one client's id is fixed, `curanno`, whatever `OIDC_CLIENT_ID` says; its redirect URIs are derived from `PUBLIC_URL` and `AUTH_EXTRA_ORIGINS`. Interaction pages (sign in, sign up, invitation, reset, linking, account) are part of the management site under `/account/*` and call internal API endpoints; `/oidc/*` routes to the API. The sign-in popup of ADR 0019 is a top-level window on this origin, so the issuer's cookies are first-party.

**Subject.** The token's `sub` is the principal id, stable across every linked identity.

**Identity mapping.** A new `identities (issuer, subject) → principal_id` table replaces the unique key on `users` as the way the API finds a caller; existing rows are migrated into it. This change is independent of the issuer and ships first, in both modes, because it also covers a provider migration or a rebuilt instance whose subjects change. In embedded mode the issuer is itself and the subject is the principal id.

**Sign-in methods.** Password (argon2id, rate limited, uniform errors), and upstream providers configured by environment: Google (OIDC), GitHub (OAuth2, using only the verified primary email) and generic OIDC. Passkeys follow later. Email verification and reset need SMTP; without it, administrators hand out invitation links and password reset is off.

**Linked identities.** A person's upstream identities are rows in `linked_accounts (provider, external_subject) → principal_id`, and email addresses live in `user_emails` with a verified flag instead of being overwritten at each login. An upstream callback has these outcomes:

1. The linked account is known: sign in as its principal.
2. The user is signed in and chose "connect": after a recent re-authentication, attach the identity to the current principal. An identity owned by another principal is refused with a pointer to merging.
3. The identity is unknown, the user is not signed in, and a verified email matches an existing account: do not link silently. Store a short-lived, browser-bound pending link, ask the person to sign in to the existing account, and attach the identity afterwards. `AUTH_AUTOLINK=verified-email` may skip the prompt, only for providers on an allow-list that verify email; it is off by default.
4. Otherwise the identity is new: apply the sign-up policy.

Unlinking needs a recent re-authentication and may not remove the last way to sign in. Merging two principals moves their annotations, ACL entries, group memberships and identities in one transaction and is recorded in the audit trail. Administrators can do it first; users can do it themselves later, after proving control of both accounts.

**Sign-up policy.** `AUTH_SIGNUP` is one of `closed`, `invite`, `approval` and `open`, and **`approval` is the default**.

- A new person creates an account in the state `pending`, with a verified email (a confirmation link for passwords; the provider's verified email for upstream sign-in) and an optional message.
- Users have a `status` of `pending`, `active`, `rejected` or `disabled`. A pending user can authenticate and is told they are waiting, but the API treats them as anonymous: they receive tokens, and the single place that resolves the caller (`apps/api/src/auth/caller.ts`) grants them nothing beyond what anonymous callers may read, except `GET /x/me`. Other requests that need an account answer 403 with a distinct problem type.
- Administrators approve or reject in the management site, with an optional note, through `/x/applications`. Both outcomes are mailed and recorded. Approval grants an account, not group or ACL access; the screen may offer to add the user to groups, which stay managed through `/x/groups` (ADR 0026).
- Rules can approve automatically: a verified-email domain allow-list, an invitation, or membership of a GitHub organization. Anything else is queued. Rules are configuration.
- `invite` skips sign-up for anyone without an invitation; `closed` allows only accounts created by an administrator; `open` activates new accounts immediately.
- Rejected and abandoned applications are purged after a configured period.
- The first administrator is created from the command line or from `BOOTSTRAP_ADMIN_EMAIL`, which issues a one-time invitation, replacing the SQL step.

## Consequences

- A deployment can run with the API, the site and Postgres alone; the identity provider origin, the provisioning Job and the client-id ConfigMap are not needed in embedded mode.
- The platform takes on what ADR 0005 avoided: password storage, reset and invitation tokens, email delivery, key management and the security review of the login pages. Without a second factor the embedded mode is weaker than Zitadel. The operator guide says so, and the mode is aimed at small and trial installations; institutional deployments are expected to keep an external provider.
- Everything in the previous point is permanent maintenance (dependency advisories, browser behaviour, passkey specifications). `docs/security-review.md` is extended and the new code gets a dedicated review before release.
- Open sign-up attracts abuse. Rate limits per address and per IP, an optional proof-of-work or CAPTCHA on password sign-up, a cap on the queue, throttled outgoing mail and non-enumerating responses are part of the first release, not a later addition.
- An unattended queue makes the service look broken, so administrators get a count in the console and a digest or immediate notice, and the waiting page states the expected review time.
- A spike (2026-11-07) ran the provider mounted on Fastify with a Postgres adapter, and drove the whole flow over HTTP, including with `oidc-client-ts`. It showed what the real implementation must configure: the provider's routes live under `/oidc` with discovery at the origin root, and are mounted with the body left unread because the provider parses it itself; the interaction cookie is scoped to the interaction path, so the site's login page posts back under `/oidc/interaction/:uid/...`; `offline_access` is ignored without `prompt=consent`, so `issueRefreshToken` must be overridden for the first-party client; the id token algorithm must match the signing key (`clientDefaults`); a first-party `loadExistingGrant` skips the consent screen; name and email go in the access token with `extraTokenClaims`, so the verifier needs no userinfo call; re-using a rotated refresh token is refused and revokes the grant; JWT access tokens are not stored, so disabling a user takes effect through the status check in `resolveCaller`, not through revocation. The implementation was then run in a real browser (2026-11-07): a protected page of the site redirects to the sign-in page and back, and the sidebar, framed on another origin, signs in through its popup. The sign-out page submits itself under a CSP that allows only that script, and our security headers are set on the provider's responses by hand, because a hijacked reply skips the server's hooks. Not yet exercised: secure cookies behind a TLS-terminating ingress (`provider.proxy` follows whether the issuer is https).
- Accounts beyond a password (2026-11-08): invitations, password reset and address verification are single-use links whose secrets are stored only as SHA-256 (`account_tokens`); addresses live in `user_emails`, verified once their owner follows a link, and only a verified address can be used to reset a password. Asking for a reset answers the same for every address. Sign-in guesses are counted in `auth_events` under keyed hashes of the login and of the client address (10 failures per login and 40 per address in 15 minutes), so replicas share the counts and the table holds no login names; the address comes from the proxy's forwarding header and the per-login limit does not depend on it. A consequence is that anyone can lock a known login for 15 minutes by failing on purpose; the alternative, no per-login limit, was judged worse. Resetting a password ends the user's sessions and grants. In embedded mode the stored profile is authoritative: tokens no longer overwrite `users.email` and the display name, since a token issued before an edit would undo it. Account links in logs have their token redacted. Mail needs `SMTP_URL`; without it invitations are handed over as links and reset is not offered. Open sign-up is still to come with the approval flow.
- Applications hold personal data about people who may never be approved, hence the retention period.
- Linking and merging are ours to get right. The merge touches every table that references a principal, so it needs an audit of those references and a test for each.
- External mode gains the `identities` table and the ability to merge accounts, but no linking of its own; there, linking stays with the provider (Zitadel linking, with its limits).
- New configuration (`AUTH_MODE`, `AUTH_SIGNUP`, `AUTH_AUTOLINK`, SMTP, provider client ids and secrets) and chart values; `zitadel.provision` stays for external mode.

## References

- ADR 0005, ADR 0006, ADR 0019, ADR 0026, ADR 0027
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/)
- [Operator guide](../operator-guide.md), [security review](../security-review.md)
