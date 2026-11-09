# Zitadel

Zitadel is the OpenID Connect provider for development and CI, and the likely one for production (ADR 0027). The API itself works with any provider (ADR 0005). This is **external mode**, the default; with `AUTH_MODE=embedded` the API is its own issuer and none of this is used (ADR 0028, operator guide section 3a).

| File            | Role                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `../../compose.yaml` | Zitadel v4.20.1, its login UI v2 and a Caddy proxy that serves both on `localhost:8080` |
| `Caddyfile`     | `/ui/v2/login` to the login UI, everything else to Zitadel, as an ingress does in a cluster |
| `provision.ts`  | Creates or updates the project, the public client and (`--dev-users`) alice and bob; compose's `zitadel-provision` runs it on every `up` |
| `values.yaml`   | Values for the official chart on OpenShift                                                 |
| `.bootstrap/`   | The provisioner's and the login UI's tokens, written by Zitadel on first start, and `oidc.env`, written by `zitadel-provision` (ignored by git) |

## Development

```bash
podman compose up -d --wait
```

`--wait` returns once `zitadel-provision` has created the client and the users and written `OIDC_ISSUER` and `OIDC_CLIENT_ID` to `.bootstrap/oidc.env`. Everything that signs in during development falls back to that file; set the two in the environment or the repository `.env` to use another provider.

Zitadel keeps its state in a `zitadel` database in the compose Postgres and creates its first instance only once, writing the two tokens to `.bootstrap/`. The tokens and the database go together: after deleting either, drop the other too (`podman compose exec postgres dropdb -U annotations zitadel` and `rm -r deploy/zitadel/.bootstrap`), then start the stack again. The client id changes whenever the instance is recreated, which is why it is written to a file rather than configured.

There is no password grant in Zitadel. Tests that need a token without a browser use `apps/api/src/test/dev-token.ts`, which drives the code flow with the login UI's token the way the login UI does.

## Cluster (pilot)

`values.yaml` is for chart 10.4.0 from `https://charts.zitadel.com`. It runs the same images as compose, uses an existing Postgres, and puts the API and the login UI on one host through two Ingresses, which OpenShift turns into edge-terminated Routes. It leaves the pod and container user unset for OpenShift's restricted SCC, which the chart's schema does not allow, hence `--skip-schema-validation`.

```bash
kubectl create secret generic zitadel-masterkey --from-literal=masterkey="$(openssl rand -hex 16)"
kubectl create secret generic zitadel-db --from-literal=dsn='postgres://zitadel:...@postgres:5432/zitadel?sslmode=require'
helm repo add zitadel https://charts.zitadel.com
helm upgrade --install zitadel zitadel/zitadel --version 10.4.0 \
  --skip-schema-validation -f deploy/zitadel/values.yaml
```

Keep the masterkey somewhere other than the cluster: it encrypts the instance's keys in the database. The setup job stores the provisioner's token in the secret `iam-admin-pat`. Installed in the same namespace with `zitadel.provision.enabled=true`, the annotations chart uses it: a hook Job runs `provision.ts` from the API image before every install and upgrade, creating or updating the client for `config.publicUrl` (plus `zitadel.provision.extraOrigins`), and writes the generated id to the ConfigMap `<fullname>-oidc` (`curanno-oidc` for a release named annotations), which the API and the site read in place of `config.oidcClientId`. Helm does not manage that ConfigMap, so it outlives `helm uninstall`. If the client id changes (only when the Zitadel instance is recreated), restart both deployments.

```bash
helm upgrade --install curanno deploy/helm/curanno \
  --set config.oidcIssuer=https://zitadel.apps.cloudapps.unc.edu \
  --set config.publicUrl=https://curanno.example \
  --set zitadel.provision.enabled=true
```

Without the hook, run the script from a checkout and set the printed `OIDC_CLIENT_ID` as `config.oidcClientId`:

```bash
kubectl get secret iam-admin-pat -o jsonpath='{.data.pat}' | base64 -d > /tmp/zitadel-admin.pat
node deploy/zitadel/provision.ts --issuer https://zitadel.apps.cloudapps.unc.edu \
  --pat-file /tmp/zitadel-admin.pat --origin https://curanno.example
```
 Sign in to the console at `/ui/console` as `admin@curanno.<host>` with Zitadel's default initial password `Password1!`, which must be changed on first use.

Open questions for production: where Postgres runs (an operator such as CloudNativePG, or a managed instance), whether to run more than one replica (Zitadel is stateless apart from Postgres), and SMTP for password resets.
