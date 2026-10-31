# Management site

The management site is a [Nuxt](https://nuxt.com) application for the people who run an instance: users, groups and their members, who may see which annotation, and browsing and searching annotations. It is an ordinary client of the public API ([ADR 0009](../../docs/adr/0009-vue-sidebar-nuxt-management-site.md)): every request leaves the browser through `@curanno/api-client` with the signed-in user's own token, and nothing runs in Nuxt's server layer ([ADR 0020](../../docs/adr/0020-management-site-serving.md)).

## Running it

With the compose stack up and the API running (see the [repository README](../../README.md)):

```bash
pnpm --filter @curanno/web dev
```

The site is at <http://localhost:3001>. Sign in as `alice` / `alice` or `bob` / `bob`. Neither is a platform administrator; to see the Users page, make one an administrator with the API (`PATCH /x/users/{id}` with `{"isAdmin": true}` from an administrator, or `update users set is_admin = true` in Postgres for the first one), or set `OIDC_ADMIN_GROUP` on the API to a Keycloak group.

In development the dev server proxies `/annotations` and `/x` to the API (`API_PROXY_TARGET`, default `http://localhost:3000`), so the site and the API share an origin, which is how production serves them too. The proxy is a dev-server setting in `nuxt.config.ts`, not an application route.

| Setting                      | Default                                       | Meaning                                    |
| ---------------------------- | --------------------------------------------- | ------------------------------------------ |
| `NUXT_PUBLIC_API_BASE`       | empty, meaning the same origin                 | Base URL of the API                        |
| `NUXT_PUBLIC_OIDC_ISSUER`    | `http://localhost:8080/realms/annotations-dev` | OpenID Connect issuer, without a trailing slash; required for a built site |
| `NUXT_PUBLIC_OIDC_CLIENT_ID` | `annotations-sidebar`                         | Public client the site signs in as         |
| `NUXT_PUBLIC_PDF_VIEWER_URL` | `http://localhost:5174/pdf/`                  | The PDF viewer page, linked from the landing page and built into the bookmarklet |
| `API_PROXY_TARGET`           | `http://localhost:3000`                       | Where the dev server proxies the API to    |

The site's Content-Security-Policy allows connections, frames and form submissions to paths under `NUXT_PUBLIC_OIDC_ISSUER`. A built site fills the issuer in when its server starts, so one image serves any provider; if the variable is unset there, the policy allows no provider and sign-in is blocked. `apps/web/scripts/check-runtime-csp.mjs` checks a running site, and CI runs it against the image.

The identity provider must list `<site origin>/auth/callback` among the client's redirect URIs and `<site origin>/` among its post-logout redirect URIs; the development realm does for ports 3001 (this site) and 5173/4173 (the sidebar).

## Pages

| Path           | Who          | What                                                                                          |
| -------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `/`            | anyone       | Landing page, server-rendered, with the bookmarklet to install and the PDF viewer link        |
| `/me`          | signed in    | The caller's account, groups and a link to their annotations                                  |
| `/users`       | admins       | Every user, searchable, with paging                                                            |
| `/users/:id`   | signed in    | One user; administrators can rename them and grant or remove the administrator flag           |
| `/groups`      | signed in    | The caller's groups (every group for administrators), create a group                          |
| `/groups/:id`  | signed in    | Rename, describe and delete the group, manage members and roles; provider-managed groups are read-only |
| `/browse`      | signed in    | Search over `/x/search` with every documented filter, paging and the total                    |
| `/browse/:id`  | signed in    | One annotation: targets, bodies, the caller's permissions, the sharing panel for `share` holders |

The page routes avoid `/annotations` and `/x`, which belong to the API on the shared origin.

## Login

The site is a public OpenID Connect client using Authorization Code with PKCE through `oidc-client-ts`, the same model as the sidebar ([ADR 0019](../../docs/adr/0019-sidebar-session-and-origin.md)). Tokens live in this origin's `sessionStorage` and travel only as `Authorization` headers; sign-out goes through the provider and always forgets the tokens locally. Pages declare `middleware: 'auth'` or `middleware: 'admin'`; the admin guard uses the `isAdmin` flag `GET /x/me` reports, so an administrator is whoever the API says.

## Layout

```
app/
  api/           the injected API client and problem-details helpers
  auth/          oidc-client-ts user manager and the session store
  annotations/   reading annotations in the shapes the W3C model allows
  components/    MembershipEditor, SharingPanel, AnnotationSummary, …
  composables/   useRequest / useAction (one read or write with its problem), useAuth
  middleware/    auth, admin
  pages/         one file per route
  plugins/       auth.client.ts: creates the session store and the API client
e2e/             Playwright test against Keycloak and the API
```

Auto-imports are off (`nuxt.config.ts`): components import what they use from `vue`, `#imports` and `#components`, so the component tests run with plain `@vue/test-utils` under happy-dom and a fake `fetch` behind the generated client. `pnpm --filter @curanno/web test` runs them; `pnpm --filter @curanno/web e2e` runs the Playwright test (needs the compose stack, a migrated database and `pnpm build` for the API's build output; the dev server is started or reused).

## Nuxt version

The site runs on Nuxt 4.6 or later: earlier 4.x releases carry security advisories in the server that renders the landing page (see `docs/security-review.md`). Nuxt 4.4 and later build with Vite 8, whose CSS minifier `lightningcss` is MPL-2.0; ADR 0022 admits it as build-time tooling that ships nothing.
