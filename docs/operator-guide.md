# Operator guide

Deploying, configuring, backing up and upgrading the platform. The system is two container images and a Helm chart; Postgres is the only stateful dependency; bring your own, or for small and trial installs let the chart run a single Postgres pod (section 4).

## 1. What runs

| Component | Image | Serves |
| --- | --- | --- |
| API | `curanno-api` (Dockerfile target `api`) | The W3C protocol and `/x/` extensions; the sidebar at `/sidebar/`, the guest bundle at `/guest.js`, the JSON-LD context at `/x/context.jsonld`; the PDF viewer at `/pdf/` on its own host; `/healthz`, `/readyz`, `/metrics` |
| Management site | `curanno-web` (target `web`) | The landing page (with the bookmarklet) and the administration pages, under the same host as the API |
| Postgres 17 | yours, or the chart's (`postgres.enabled`) | Everything stateful |
| OpenID Connect provider | yours, or the API itself (section 3a) | Sign-in for the sidebar and the site (ADR 0005, 0019, 0028) |

Both images read their configuration from environment variables; nothing is baked in (ADR 0021). The sidebar and the viewer fetch `config.json` from the API at start, generated from the API's environment.

## 2. Build and publish the images

From the repository root, for a release tag `1.0.0`:

```bash
podman build --target api -t ghcr.io/example/curanno-api:1.0.0 -f Dockerfile .
```

```bash
podman build --target web -t ghcr.io/example/curanno-web:1.0.0 -f Dockerfile .
```

Push both to your registry and set `image.repository`, `web.image.repository` and the tags in the chart's values (the tag defaults to the chart's `appVersion`). CI builds both images on every change without publishing them.

The `Publish images` workflow (`.github/workflows/publish-images.yml`) publishes them to `ghcr.io/<owner>/curanno-api` and `ghcr.io/<owner>/curanno-web`, which the chart uses by default: every push to `main` as `:main` and `:sha-<commit>`, and every tag `vX.Y.Z` as `:X.Y.Z`, `:X.Y` and `:latest`. Tag a release with the chart's `appVersion` (`v1.0.0` for `appVersion: '1.0.0'`) so the default tag exists. It can also be run by hand from the Actions tab.

## 3. Configure the identity provider

Create a **public** OpenID Connect client (Authorization Code with PKCE, no client secret) for the sidebar and the site. With `PUBLIC_URL` being `https://curanno.example`:

- Redirect URIs: `https://curanno.example/sidebar/`, `https://curanno.example/sidebar/popup-callback.html`, `https://curanno.example/sidebar/silent-renew.html`, `https://curanno.example/auth/callback`.
- Post-logout redirect URIs: `https://curanno.example/sidebar/`, `https://curanno.example/`.
- For the browser extension, `https://dmlkjhnoiinndnkboiknehimngilddpp.chromiumapp.org/` as both a redirect and a post-logout redirect URI (another id for a build of your own). The sidebar signs in and out through the extension whenever it runs, so sign-in fails for extension users until this is registered. This lets them sign in on pages whose `Cross-Origin-Opener-Policy` leaves the sign-in popup blank (ADR 0029). Set the chart's `extensionIds` and the embedded issuer and `zitadel.provision` register it for you.
- Web origins (CORS for the token endpoint): `https://curanno.example`.
- Refresh tokens enabled for the client, so framed sidebars can renew without third-party cookies (ADR 0019). The sidebar and the site request the `offline_access` scope, which most providers require before they issue a refresh token; the client must be allowed to request it. In Keycloak, `offline_access` issues offline tokens, which outlive the browser session, and users need the realm's `offline_access` role.
- Access tokens must be JWTs (in Zitadel, the application's auth token type set to JWT). A user's display name comes from the token's `name` claim, then `preferred_username`, and their email from `email`; when the token lacks either, the API asks the provider's userinfo endpoint with the same token, which covers providers such as Zitadel that keep profile claims out of access tokens. Without either source, users appear by their subject identifier until an administrator sets a display name.
- No `groups` claim is needed: groups are managed entirely through `/x/groups` (ADR 0026). Make the first administrator with SQL (`update users set is_admin = true where ...`) after their first sign-in; they can then administer further ones with `PATCH /x/users/{id}`.

The API accepts a token when its issuer matches, its signature verifies against the issuer's JWKS, it is within its validity (30 s tolerance) and either its `aud` is `config.oidcAudience` (default: the client id) or its `azp` is the client id, which is how some providers (Keycloak) mark public-client access tokens; Zitadel puts the client id in `aud`. A token revoked at the provider is honoured for at most 60 s (the API's verification cache) or until it expires.

With Zitadel, `deploy/zitadel/provision.ts` creates this client (and prints its generated id) against any instance, and the chart can run it as a hook Job that supplies the id itself (`zitadel.provision.enabled`); [Deploying with Zitadel](#deploying-with-zitadel) walks through running Zitadel and the chart together, and `deploy/zitadel/README.md` has the details.

## 3a. Or let the API be the identity provider (embedded mode)

With `auth.mode: embedded` (`AUTH_MODE=embedded`, [ADR 0028](adr/0028-embedded-issuer.md)) the API is its own OpenID Connect issuer on `PUBLIC_URL`, with password accounts, optional sign-in through Google, GitHub or any OpenID Connect provider, and sign-up that an administrator approves. Nothing else is needed but Postgres: no Zitadel, no client to register, no provisioning Job. It suits small and trial installations; an institution with its own directory, multi-factor sign-in or single sign-on should keep an external provider (section 3). **There is no second factor in embedded mode.** Passwords are stored as argon2id hashes, sign-in attempts are throttled, and responses do not reveal whether an account exists, but a password is all that stands between an attacker and an account.

**Minimum values.**

```yaml
auth:
  mode: embedded
  bootstrapAdminEmail: you@example.org   # invited to become the first administrator
secrets:
  databaseUrl: postgres://...
  authSecret: <openssl rand -base64 48>
config:
  publicUrl: https://curanno.example      # must be https outside a trial
```

`secrets.authSecret` (or `AUTH_SECRET` in an existing Secret) seals the issuer's signing keys in the database and keys its cookies. It must be at least 32 characters and **identical on every replica and across upgrades**. Keep it with your other secrets and out of database backups: a dump alone then cannot mint tokens. If it is lost or changed the API cannot read its signing keys and will not start; recover by deleting the rows of `signing_keys` and starting again, which signs everyone out.

**Routing.** The ingress sends `/oidc`, `/idp` and `/.well-known/openid-configuration` to the API (the chart's does when `ingress.enabled`); everything else of the site stays with the site. Use https: the issuer's cookies are `Secure` when `publicUrl` is https, and passwords would otherwise cross the network in the clear. The chart warns when it is not. The browser origin of the issuer is `publicUrl`; the sidebar on another origin (a different host name for the same install, a development server) must be listed in `auth.extraOrigins`. Browser extensions the sidebar signs in through are listed in `extensionIds` (ADR 0029).

**The first administrator.** With `auth.bootstrapAdminEmail` set, an invitation to that address is created while no administrator exists: mailed if mail is configured, otherwise written to the API log (`kubectl logs deploy/<release> | grep invite`). Or create one directly: `kubectl exec deploy/<release> -- sh -c 'ACCOUNT_PASSWORD=... node dist/auth/embedded/cli.js create --login you@example.org --name "You" --admin'`. The same program has `set-password`, `invite --email x [--admin]` (prints a one-use link, valid for a week) and `rotate-key`.

**Who may sign up (`auth.signup`).**

| Value | Meaning |
| --- | --- |
| `approval` (default) | Anyone may apply at `/account/signup`. They can sign in and read what is public, but cannot write until an administrator approves them on the **Applications** page; both outcomes are mailed (when mail is set up). |
| `open` | Anyone may create an account and use it at once. Expect abuse; the sign-up limits and the queue cap are your only defences. |
| `closed` | No sign-up page; people join by invitation. |

Invitations work under every policy. Under `approval`, `auth.autoApproveDomains` approves an applicant at once when they verify an address in one of those domains. A pending applicant is also told so in the site. `auth.maxPending` pauses sign-up while that many applications wait; rejected applicants are deleted after 30 days and unverified, undecided ones after 14. Sign-up from one address is limited to five an hour and sign-in guesses to ten per login and forty per address in fifteen minutes (the counts are in Postgres, so replicas share them; the address comes from the proxy's `X-Forwarded-For`, so make sure your ingress sets it and strips a client's own). A known login can be locked for fifteen minutes by someone failing on purpose; that is the price of the limit.

**Mail.** Set `auth.mail.from` and `secrets.smtpUrl` (`smtps://user:pass@host`) for invitations, resets, address verification and the notices to administrators and applicants. Without them nothing is sent: administrators hand out `account invite` links, "forgot your password" is not offered (an administrator runs `set-password`), and an address cannot be verified, so only addresses vouched for by an invitation or a provider count as verified. Account links carry a secret in the query string; the API's request log redacts it, but your ingress's access log may not, so redact `token=` there as well.

**Sign in with another service.** Set `auth.providers.google.clientId` and `secrets.upstream.googleClientSecret` (likewise `github`, and `oidc` with an `issuer` and a `name` for the button). Register `<publicUrl>/idp/upstream/<google|github|oidc>/callback` as the redirect URI at the provider. A person signing in this way follows the sign-up policy. If the provider vouches for an address that already has an account, nothing is joined until the account's owner signs in to it with its password (an account with no password must be joined from its own account page). `auth.autolink` lists providers whose verified address may join an account without that step; leave it empty unless the provider verifies addresses and you trust it to. People connect and disconnect providers on their account page (**/me**), which asks for their password again; the last way to sign in cannot be removed.

**Disabling and merging.** An administrator disables a user with `PATCH /x/users/{id}` (`{"status": "disabled"}`, on the users page's API); their sessions and refresh tokens end at once, and an access token already issued works for up to an hour. If someone ends up with two accounts, `kubectl exec deploy/<release> -- node dist/accounts/merge-cli.js --survivor <id|login|email> --loser <id|login|email> [--yes]` (from a source tree, `pnpm --filter @curanno/api account:merge` with the same arguments) folds one into the other; it describes what it would do without `--yes`, and the merge cannot be undone.

**Signing keys.** They are created on first start and shared by replicas. `rotate-key` adds a new one; restart every API replica so it signs with it. Old keys remain available for at least two days after the latest rotation, then are retired. Complete the rolling restart within that window, leaving at least an hour for the last tokens signed with the old key to expire. Further rotations restart the overlap period.

**Upgrading from external mode** is not supported in place: tokens, subjects and clients differ. Run embedded mode as a separate install.

## 4. Deploy the chart

Embedded mode needs the values of section 3a; the rest of this section applies to both.

```bash
helm upgrade --install curanno deploy/helm/curanno \
  --namespace annotations --create-namespace \
  --set config.publicUrl=https://curanno.example \
  --set config.oidcIssuer=https://idp.example \
  --set config.oidcClientId=curanno-sidebar \
  --set "config.frameAncestors='self' https://*.example.org" \
  --set pdfViewer.host=pdf.curanno.example \
  --set ingress.enabled=true --set ingress.host=curanno.example \
  --set secrets.existingSecret=curanno-database
```

Values worth knowing (`deploy/helm/curanno/values.yaml` documents each):

- `secrets.databaseUrl` or `secrets.existingSecret`: the Postgres connection string. Migrations run from an init container before each API pod starts and take an advisory lock, so replicas starting together are safe.
- `config.frameAncestors`: the origins allowed to embed the sidebar, as CSP source expressions. This is the clickjacking defence (ADR 0007): list the sites your users annotate, or `https:` for any https site if you accept the trade. Users of the browser extension annotate whatever site they are on, so serving them needs `https:`. The viewer's origin is added for you.
- `pdfViewer.host`: a second host name for the PDF viewer, with its own certificate, so a PDF.js defect never runs on the sidebar's origin (ADR 0021). Point its DNS at the ingress; the chart adds the ingress rule.
- `ingress.metrics`: whether `/metrics` is reachable from outside (default no). Scrape the API Service inside the cluster instead.
- `postgres.enabled`: run Postgres in the release instead of using `secrets.databaseUrl` (below).
- `web.enabled`: the management site; off, the API still serves the sidebar and viewer, and users install the bookmarklet from `pnpm --filter @curanno/guest bookmarklet` output instead of the landing page.

### Postgres in the chart

For a small or trial install, `postgres.enabled=true` runs `postgres:17` as a one-pod StatefulSet with a `postgres.persistence.size` volume (1 GiB by default) and points the API at it; leave `secrets.databaseUrl` empty. Set `postgres.password` (letters, digits and `. _ ~ -`; it goes into the connection string), or keep it under `POSTGRES_PASSWORD` in `secrets.existingSecret`. The password is applied only when the volume is first initialized. There is no replication or failover, and `helm uninstall` leaves the volume (`data-curanno-postgres-0` for a release named `curanno`) behind, so delete it by hand if you mean to. Back it up as in section 5 with `PG_DUMP="kubectl exec -i curanno-postgres-0 -- pg_dump"`.

The pod sets no user, so OpenShift's restricted SCC assigns one from the namespace's range and the volume's group from its `fsGroup`. On other clusters the image's default user is root, which `runAsNonRoot` refuses; set `postgres.podSecurityContext` to `{runAsNonRoot: true, runAsUser: 999, fsGroup: 999}`.

### Deploying with Zitadel

Zitadel runs as its own release of the official chart, in the same namespace as the annotations release so the provisioning Job can read Zitadel's token Secret. With `zitadel.example` as Zitadel's host and `curanno.example` as the platform's:

1. **Postgres.** One server can hold both databases: `annotations` for the platform and `zitadel` for Zitadel, each with its own user. Zitadel's user must own its database or be allowed to create it.
2. **Zitadel's secrets.** The masterkey encrypts Zitadel's keys in its database, so keep a copy outside the cluster; losing it loses the instance.

   ```bash
   kubectl -n curanno create secret generic zitadel-masterkey --from-literal=masterkey="$(openssl rand -hex 16)"
   kubectl -n curanno create secret generic zitadel-db --from-literal=dsn='postgres://zitadel:...@postgres:5432/zitadel?sslmode=require'
   ```

3. **Zitadel.** Copy `deploy/zitadel/values.yaml` and set the host in its three places (`ExternalDomain` and both Ingresses). The values are written for OpenShift; elsewhere, drop the Route annotation and set the Ingress class and TLS. Wait for the setup Job to finish: it creates the first instance and stores an IAM owner's token in the Secret `iam-admin-pat`.

   ```bash
   helm repo add zitadel https://charts.zitadel.com
   helm upgrade --install zitadel zitadel/zitadel --version 10.4.0 -n curanno \
     --skip-schema-validation -f zitadel-values.yaml
   ```

   `https://zitadel.example/.well-known/openid-configuration` should now answer. The console is at `/ui/console` as `admin@curanno.zitadel.example`, with the initial password `Password1!`, which must be changed on first use.

4. **The platform.** Install the chart with `zitadel.provision.enabled=true` and no `config.oidcClientId`. Before every install and upgrade, a hook Job registers the client for `config.publicUrl` and writes the client's id to the ConfigMap `curanno-oidc`, which the API and the site read.

   ```bash
   helm upgrade --install curanno deploy/helm/curanno -n curanno \
     --set config.publicUrl=https://curanno.example \
     --set config.oidcIssuer=https://zitadel.example \
     --set zitadel.provision.enabled=true \
     --set "config.frameAncestors='self' https://*.example.org" \
     --set pdfViewer.host=pdf.curanno.example \
     --set ingress.enabled=true --set ingress.host=curanno.example \
     --set secrets.existingSecret=curanno-database
   ```

   If the install fails at the hook, `kubectl -n curanno logs job/curanno-zitadel-provision` shows why. The Job is deleted when it succeeds.

5. **Users and the first administrator.** Self-registration is off (`AllowRegister: false`), so create users in the console or connect an external identity provider to Zitadel. After the first administrator has signed in once, set the flag in the platform's database:

   ```sql
   update users set is_admin = true where issuer = 'https://zitadel.example' and email = 'someone@example.org';
   ```

6. **Checks.** Run section 8.

The ConfigMap `curanno-oidc` is not managed by Helm, so it survives `helm uninstall`. The client id changes only when the Zitadel instance is recreated; when it does, run `helm upgrade` and restart both deployments.

### Ingress requirements

- Route `/annotations`, `/x`, `/sidebar`, `/guest.js`, `/healthz`, `/readyz` (and `/metrics` if exposed) on the main host to the API Service and everything else to the site; route `/pdf` on the viewer host to the API Service. The chart's Ingress does this.
- Server-sent events hold responses open for as long as a sidebar is open. Raise idle and read timeouts above the 30 s keepalive and turn response buffering off; `values.yaml` carries the ingress-nginx annotations and `templates/NOTES.txt` the equivalents for Traefik, HAProxy and cloud load balancers.
- TLS on both hosts. The API sends `Strict-Transport-Security` when `publicUrl` is https.
- Rate limiting and connection limits are the ingress's job; the chart sets none.

### OpenShift Routes

On OpenShift, `route.enabled=true` (instead of `ingress.enabled`) creates one Route per path above, since a Route carries a single path, on the host of `config.publicUrl` (or `route.host`) and `pdfViewer.host`. TLS is terminated at the router (`route.tls.termination: edge`, http redirected to https); without a certificate in `route.tls` the router's default one is used, which covers names under the cluster's apps domain:

```yaml
config:
  publicUrl: https://curanno.apps.example.org
pdfViewer:
  host: curanno-pdf.apps.example.org
route:
  enabled: true
```

The default `route.annotations` raise the router's timeout to an hour for server-sent events and make it replace, rather than append to, a client's `X-Forwarded-For`, which the sign-in and sign-up limits rely on. Keep both if you override the annotations.

### Health and observability

- `GET /healthz`: the process answers (liveness). `GET /readyz`: the database answers too (readiness), so a database outage drains pods instead of restarting them.
- Logs: JSON lines from pino to stdout, one per request with `reqId`, which is also returned as `X-Request-Id` (and taken from the proxy's `X-Request-Id` when present). Set `LOG_LEVEL` (`info` by default). Authorization headers are redacted.
- Metrics: Prometheus text at `/metrics`: process defaults, `http_request_duration_seconds` by method, route pattern and status, `curanno_event_streams_open`, `curanno_events_delivered_total` by kind. Alert on readiness failures, 5xx rates and a flat `curanno_event_streams_open` during business hours (an ingress cutting streams).

## 5. Back up and restore

The database is the only state. Back it up with the script, which dumps in pg_dump's compressed custom format without ownership or privilege statements:

```bash
DATABASE_URL=postgres://... scripts/db-backup.sh backups/curanno-$(date +%F).dump
```

Run it from a machine with `pg_dump` of at least the server's major version, or run the one inside the database container or a `postgres:17` pod (`PG_DUMP="kubectl exec -i postgres-0 -- pg_dump" scripts/db-backup.sh ...`); the dump goes through stdout so either works. Schedule it (a CronJob with a `postgres:17` image and the script works) and keep dumps off the cluster.

To restore, create an empty database, restore into it, run the migrations against it to confirm the schema is current, and point the API at it:

```bash
TARGET_DATABASE_URL=postgres://... scripts/db-restore.sh backups/curanno-2026-10-30.dump
```

```bash
DATABASE_URL=postgres://... pnpm --filter @curanno/api migrate
```

The test `apps/api/src/db/backup-restore.test.ts` does exactly this in CI: it dumps a database, restores it into a fresh one, checks that the API answers from the restored copy as it did from the original, and runs the whole OpenAPI contract suite against a restored database. Run it yourself after changing the procedure.

What a restore loses: annotations made after the dump, and nothing else; identity provider state lives with the provider.

## 6. Upgrade

1. Read the release notes for migrations and configuration changes. Migrations are plain SQL files applied in order and recorded in `schema_migrations`; they are forward-only.
2. Back up (section 5).
3. `helm upgrade` with the new chart version and image tags. The init container applies new migrations before the new API pods start; old pods keep serving until the new ones are ready. A migration that an old pod cannot work with is called out in the release notes with the order to follow (scale down first).
4. Watch `/readyz`, the 5xx rate and `curanno_event_streams_open` (sidebars reconnect with `Last-Event-ID` and miss nothing).
5. To roll back, `helm rollback`; migrations are not rolled back, so only roll back across releases whose notes say the schema is compatible, otherwise restore the backup.

The OpenAPI document and the text model are versioned contracts (CONTRIBUTING.md); a breaking change to either is a new major version and the release notes say so.

## 7. Operating notes

- Administrators: users with `is_admin` set, managed with SQL for the first one and `PATCH /x/users/{id}` thereafter.
- Groups are created, renamed and have their membership managed entirely through `/x/groups` (ADR 0026); OIDC tokens are used only for identity.
- Document identity: the API logs a warning (`a page links documents that are recorded as distinct; not merged`) when a page claims links to several known documents. It never merges them on its own; an operator who has established that they are one document merges with `mergeDocuments` in `apps/api/src/documents/service.ts` (a one-off script against the database). See [document-identity.md](document-identity.md), section 6.
- Body profiles: registered by administrators through `PUT /x/profiles/{iri}` with a JSON Schema. A schema with a catastrophic regular expression slows every write; review schemas before registering them.
- The PDF viewer fetches PDFs from the browser, so a PDF's host must allow cross-origin reads; otherwise users open the file from their computer. No fetching proxy is deployed (ADR 0021).
- The sidebar's CSP allows `'unsafe-eval'` because Ajv compiles profile schemas in the browser (`apps/sidebar/README.md`).

## 8. Checks on a new cluster

After the first deployment: `curl https://curanno.example/readyz`; open `https://curanno.example/` and sign in; drag the bookmarklet to the bookmarks bar; annotate a page on an allowed origin and a PDF in the viewer; open the same page in another browser as another user and share an annotation across; confirm the sidebar frame is refused on a page outside `frameAncestors` (the browser's console shows the CSP refusal); scrape `/metrics` from inside the cluster; run a backup and a restore into a scratch database.

## 9. Reproducing the load test

[performance.md](performance.md) records the load test of ACL-filtered search: the data shape, the numbers measured on a laptop and the query plans. To repeat it against a release, or against a candidate Postgres instance:

1. Point `DATABASE_URL` at an empty database you can discard. A local throwaway: `podman run -d --name load-pg --shm-size=1g -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine`, then `DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres`. Give the container at least 1 GB of shared memory: Postgres runs the ACL joins in parallel and the 64 MB default fails with "could not resize shared memory segment".
2. `pnpm load:seed` applies the migrations and writes the data: by default 1 000 000 annotations over 10 000 documents by 5 000 users in 500 groups, a few minutes on a laptop and about 3 GB. `--annotations`, `--documents`, `--users`, `--groups` and `--seed` change the sizes; the same parameters always give the same rows. The database must be empty, or pass `--truncate`.
3. `pnpm load:run -- --out results.json` builds the API, starts it in a child process against the same database, and drives it as four principals (anonymous, a user in one small group, a user in many groups including the largest, and the most prolific creator) through the container, `/x/search` and the event stream's `Last-Event-ID` replay. It prints a table of p50, p95 and p99 latencies with throughput per scenario, then `EXPLAIN (ANALYZE, BUFFERS)` for the main search queries, and writes everything to the file. `--duration` (seconds per scenario, 10) and `--connections` (10) set the load; `--only <text>` runs the scenarios whose name contains the text.

Postgres settings matter: the ACL check hashes a caller's readable annotations when a query touches many candidates, and at the default `work_mem` of 4 MB that hash and its sort spill to temporary files; 32 to 64 MB keeps them in memory and took 10 to 20% off the heaviest numbers in [performance.md](performance.md).

The run does not touch the identity provider: seeded users belong to an issuer that exists only for the test and the runner signs their tokens with a key it generates. Never run the seed against a database you keep.

