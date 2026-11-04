# Zitadel

Zitadel is the OpenID Connect provider for development and CI, and the likely one for production (ADR 0027). The API itself works with any provider (ADR 0005).

| File            | Role                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `../../compose.yaml` | Zitadel v4.20.1, its login UI v2 and a Caddy proxy that serves both on `localhost:8080` |
| `Caddyfile`     | `/ui/v2/login` to the login UI, everything else to Zitadel, as an ingress does in a cluster |
| `provision.ts`  | Creates or updates the project, the public client and (`--dev-users`) alice and bob        |
| `.bootstrap/`   | Written by Zitadel on first start: the provisioner's and the login UI's tokens (ignored by git) |

## Development

```bash
podman compose up -d --wait
node deploy/zitadel/provision.ts --dev-users --write-env .env
```

Zitadel keeps its state in a `zitadel` database in the compose Postgres and creates its first instance only once, writing the two tokens to `.bootstrap/`. The tokens and the database go together: after deleting either, drop the other too (`podman compose exec postgres dropdb -U annotations zitadel` and `rm -r deploy/zitadel/.bootstrap`), then start the stack and provision again. The client id changes whenever the instance is recreated, which is why `provision.ts` writes it to `.env`.

There is no password grant in Zitadel. Tests that need a token without a browser use `apps/api/src/test/dev-token.ts`, which drives the code flow with the login UI's token the way the login UI does.
