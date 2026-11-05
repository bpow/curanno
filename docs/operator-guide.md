# Operator guide

Deploying, configuring, backing up and upgrading the platform. The system is two container images and a Helm chart; Postgres is the only stateful dependency and is not part of the chart (ADR 0004, plan section 9).

## 1. What runs

| Component | Image | Serves |
| --- | --- | --- |
| API | `annotations-api` (Dockerfile target `api`) | The W3C protocol and `/x/` extensions; the sidebar at `/sidebar/`, the guest bundle at `/guest.js`, the JSON-LD context at `/x/context.jsonld`; the PDF viewer at `/pdf/` on its own host; `/healthz`, `/readyz`, `/metrics` |
| Management site | `annotations-web` (target `web`) | The landing page (with the bookmarklet) and the administration pages, under the same host as the API |
| Postgres 17 | yours | Everything stateful |
| OpenID Connect provider | yours | Sign-in for the sidebar and the site (ADR 0005, 0019) |

Both images read their configuration from environment variables; nothing is baked in (ADR 0021). The sidebar and the viewer fetch `config.json` from the API at start, generated from the API's environment.

## 2. Build and publish the images

From the repository root, for a release tag `1.0.0`:

```bash
podman build --target api -t ghcr.io/example/annotations-api:1.0.0 -f Dockerfile .
```

```bash
podman build --target web -t ghcr.io/example/annotations-web:1.0.0 -f Dockerfile .
```

Push both to your registry and set `image.repository`, `web.image.repository` and the tags in the chart's values (the tag defaults to the chart's `appVersion`). CI builds both images on every change without publishing them.

## 3. Configure the identity provider

Create a **public** OpenID Connect client (Authorization Code with PKCE, no client secret) for the sidebar and the site. With `PUBLIC_URL` being `https://annotations.example`:

- Redirect URIs: `https://annotations.example/sidebar/`, `https://annotations.example/sidebar/popup-callback.html`, `https://annotations.example/sidebar/silent-renew.html`, `https://annotations.example/auth/callback`.
- Post-logout redirect URIs: `https://annotations.example/sidebar/`, `https://annotations.example/`.
- Web origins (CORS for the token endpoint): `https://annotations.example`.
- Refresh tokens enabled for the client, so framed sidebars can renew without third-party cookies (ADR 0019). The sidebar and the site request the `offline_access` scope, which most providers require before they issue a refresh token; the client must be allowed to request it. In Keycloak, `offline_access` issues offline tokens, which outlive the browser session, and users need the realm's `offline_access` role.
- Access tokens must be JWTs (in Zitadel, the application's auth token type set to JWT). A user's display name comes from the token's `name` claim, then `preferred_username`, and their email from `email`; when the token lacks either, the API asks the provider's userinfo endpoint with the same token, which covers providers such as Zitadel that keep profile claims out of access tokens. Without either source, users appear by their subject identifier until an administrator sets a display name.
- No `groups` claim is needed: groups are managed entirely through `/x/groups` (ADR 0026). Make the first administrator with SQL (`update users set is_admin = true where ...`) after their first sign-in; they can then administer further ones with `PATCH /x/users/{id}`.

The API accepts a token when its issuer matches, its signature verifies against the issuer's JWKS, it is within its validity (30 s tolerance) and either its `aud` is `config.oidcAudience` (default: the client id) or its `azp` is the client id, which is how some providers (Keycloak) mark public-client access tokens; Zitadel puts the client id in `aud`. A token revoked at the provider is honoured for at most 60 s (the API's verification cache) or until it expires.

With Zitadel, `deploy/zitadel/provision.ts` creates this client (and prints its generated id) against any instance, and the chart can run it as a hook Job that supplies the id itself (`zitadel.provision.enabled`); [Deploying with Zitadel](#deploying-with-zitadel) walks through running Zitadel and the chart together, and `deploy/zitadel/README.md` has the details.

## 4. Deploy the chart

```bash
helm upgrade --install annotations deploy/helm/annotations \
  --namespace annotations --create-namespace \
  --set config.publicUrl=https://annotations.example \
  --set config.oidcIssuer=https://idp.example/realms/annotations \
  --set config.oidcClientId=annotations-sidebar \
  --set "config.frameAncestors='self' https://*.example.org" \
  --set pdfViewer.host=pdf.annotations.example \
  --set ingress.enabled=true --set ingress.host=annotations.example \
  --set secrets.existingSecret=annotations-database
```

Values worth knowing (`deploy/helm/annotations/values.yaml` documents each):

- `secrets.databaseUrl` or `secrets.existingSecret`: the Postgres connection string. Migrations run from an init container before each API pod starts and take an advisory lock, so replicas starting together are safe.
- `config.frameAncestors`: the origins allowed to embed the sidebar, as CSP source expressions. This is the clickjacking defence (ADR 0007): list the sites your users annotate, or `https:` for any https site if you accept the trade. Users of the browser extension annotate whatever site they are on, so serving them needs `https:`. The viewer's origin is added for you.
- `pdfViewer.host`: a second host name for the PDF viewer, with its own certificate, so a PDF.js defect never runs on the sidebar's origin (ADR 0021). Point its DNS at the ingress; the chart adds the ingress rule.
- `ingress.metrics`: whether `/metrics` is reachable from outside (default no). Scrape the API Service inside the cluster instead.
- `web.enabled`: the management site; off, the API still serves the sidebar and viewer, and users install the bookmarklet from `pnpm --filter @curanno/guest bookmarklet` output instead of the landing page.

### Deploying with Zitadel

Zitadel runs as its own release of the official chart, in the same namespace as the annotations release so the provisioning Job can read Zitadel's token Secret. With `zitadel.example` as Zitadel's host and `annotations.example` as the platform's:

1. **Postgres.** One server can hold both databases: `annotations` for the platform and `zitadel` for Zitadel, each with its own user. Zitadel's user must own its database or be allowed to create it.
2. **Zitadel's secrets.** The masterkey encrypts Zitadel's keys in its database, so keep a copy outside the cluster; losing it loses the instance.

   ```bash
   kubectl -n annotations create secret generic zitadel-masterkey --from-literal=masterkey="$(openssl rand -hex 16)"
   kubectl -n annotations create secret generic zitadel-db --from-literal=dsn='postgres://zitadel:...@postgres:5432/zitadel?sslmode=require'
   ```

3. **Zitadel.** Copy `deploy/zitadel/values.yaml` and set the host in its three places (`ExternalDomain` and both Ingresses). The values are written for OpenShift; elsewhere, drop the Route annotation and set the Ingress class and TLS. Wait for the setup Job to finish: it creates the first instance and stores an IAM owner's token in the Secret `iam-admin-pat`.

   ```bash
   helm repo add zitadel https://charts.zitadel.com
   helm upgrade --install zitadel zitadel/zitadel --version 10.4.0 -n annotations \
     --skip-schema-validation -f zitadel-values.yaml
   ```

   `https://zitadel.example/.well-known/openid-configuration` should now answer. The console is at `/ui/console` as `admin@annotations.zitadel.example`, with the initial password `Password1!`, which must be changed on first use.

4. **The platform.** Install the chart with `zitadel.provision.enabled=true` and no `config.oidcClientId`. Before every install and upgrade, a hook Job registers the client for `config.publicUrl` and writes the client's id to the ConfigMap `annotations-oidc`, which the API and the site read.

   ```bash
   helm upgrade --install annotations deploy/helm/annotations -n annotations \
     --set config.publicUrl=https://annotations.example \
     --set config.oidcIssuer=https://zitadel.example \
     --set zitadel.provision.enabled=true \
     --set "config.frameAncestors='self' https://*.example.org" \
     --set pdfViewer.host=pdf.annotations.example \
     --set ingress.enabled=true --set ingress.host=annotations.example \
     --set secrets.existingSecret=annotations-database
   ```

   If the install fails at the hook, `kubectl -n annotations logs job/annotations-zitadel-provision` shows why. The Job is deleted when it succeeds.

5. **Users and the first administrator.** Self-registration is off (`AllowRegister: false`), so create users in the console or connect an external identity provider to Zitadel. After the first administrator has signed in once, set the flag in the platform's database:

   ```sql
   update users set is_admin = true where issuer = 'https://zitadel.example' and email = 'someone@example.org';
   ```

6. **Checks.** Run section 8.

The ConfigMap `annotations-oidc` is not managed by Helm, so it survives `helm uninstall`. The client id changes only when the Zitadel instance is recreated; when it does, run `helm upgrade` and restart both deployments.

### Ingress requirements

- Route `/annotations`, `/x`, `/sidebar`, `/guest.js`, `/healthz`, `/readyz` (and `/metrics` if exposed) on the main host to the API Service and everything else to the site; route `/pdf` on the viewer host to the API Service. The chart's Ingress does this.
- Server-sent events hold responses open for as long as a sidebar is open. Raise idle and read timeouts above the 30 s keepalive and turn response buffering off; `values.yaml` carries the ingress-nginx annotations and `templates/NOTES.txt` the equivalents for Traefik, HAProxy and cloud load balancers.
- TLS on both hosts. The API sends `Strict-Transport-Security` when `publicUrl` is https.
- Rate limiting and connection limits are the ingress's job; the chart sets none.

### Health and observability

- `GET /healthz`: the process answers (liveness). `GET /readyz`: the database answers too (readiness), so a database outage drains pods instead of restarting them.
- Logs: JSON lines from pino to stdout, one per request with `reqId`, which is also returned as `X-Request-Id` (and taken from the proxy's `X-Request-Id` when present). Set `LOG_LEVEL` (`info` by default). Authorization headers are redacted.
- Metrics: Prometheus text at `/metrics`: process defaults, `http_request_duration_seconds` by method, route pattern and status, `annotations_event_streams_open`, `annotations_events_delivered_total` by kind. Alert on readiness failures, 5xx rates and a flat `annotations_event_streams_open` during business hours (an ingress cutting streams).

## 5. Back up and restore

The database is the only state. Back it up with the script, which dumps in pg_dump's compressed custom format without ownership or privilege statements:

```bash
DATABASE_URL=postgres://... scripts/db-backup.sh backups/annotations-$(date +%F).dump
```

Run it from a machine with `pg_dump` of at least the server's major version, or run the one inside the database container or a `postgres:17` pod (`PG_DUMP="kubectl exec -i postgres-0 -- pg_dump" scripts/db-backup.sh ...`); the dump goes through stdout so either works. Schedule it (a CronJob with a `postgres:17` image and the script works) and keep dumps off the cluster.

To restore, create an empty database, restore into it, run the migrations against it to confirm the schema is current, and point the API at it:

```bash
TARGET_DATABASE_URL=postgres://... scripts/db-restore.sh backups/annotations-2026-10-30.dump
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
4. Watch `/readyz`, the 5xx rate and `annotations_event_streams_open` (sidebars reconnect with `Last-Event-ID` and miss nothing).
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

After the first deployment: `curl https://annotations.example/readyz`; open `https://annotations.example/` and sign in; drag the bookmarklet to the bookmarks bar; annotate a page on an allowed origin and a PDF in the viewer; open the same page in another browser as another user and share an annotation across; confirm the sidebar frame is refused on a page outside `frameAncestors` (the browser's console shows the CSP refusal); scrape `/metrics` from inside the cluster; run a backup and a restore into a scratch database.

## 9. Reproducing the load test

[performance.md](performance.md) records the load test of ACL-filtered search: the data shape, the numbers measured on a laptop and the query plans. To repeat it against a release, or against a candidate Postgres instance:

1. Point `DATABASE_URL` at an empty database you can discard. A local throwaway: `podman run -d --name load-pg --shm-size=1g -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine`, then `DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres`. Give the container at least 1 GB of shared memory: Postgres runs the ACL joins in parallel and the 64 MB default fails with "could not resize shared memory segment".
2. `pnpm load:seed` applies the migrations and writes the data: by default 1 000 000 annotations over 10 000 documents by 5 000 users in 500 groups, a few minutes on a laptop and about 3 GB. `--annotations`, `--documents`, `--users`, `--groups` and `--seed` change the sizes; the same parameters always give the same rows. The database must be empty, or pass `--truncate`.
3. `pnpm load:run -- --out results.json` builds the API, starts it in a child process against the same database, and drives it as four principals (anonymous, a user in one small group, a user in many groups including the largest, and the most prolific creator) through the container, `/x/search` and the event stream's `Last-Event-ID` replay. It prints a table of p50, p95 and p99 latencies with throughput per scenario, then `EXPLAIN (ANALYZE, BUFFERS)` for the main search queries, and writes everything to the file. `--duration` (seconds per scenario, 10) and `--connections` (10) set the load; `--only <text>` runs the scenarios whose name contains the text.

Postgres settings matter: the ACL check hashes a caller's readable annotations when a query touches many candidates, and at the default `work_mem` of 4 MB that hash and its sort spill to temporary files; 32 to 64 MB keeps them in memory and took 10 to 20% off the heaviest numbers in [performance.md](performance.md).

The run does not touch the identity provider: seeded users belong to an issuer that exists only for the test and the runner signs their tokens with a key it generates. Never run the seed against a database you keep.

