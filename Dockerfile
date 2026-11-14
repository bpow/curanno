# Images for the platform, built from the repository root (ADR 0021):
#
#   podman build --target api -t curanno-api -f Dockerfile .
#   podman build --target web -t curanno-web -f Dockerfile .
#
# `api` holds the compiled server, the OpenAPI document it binds to, the SQL
# migrations (run with `node dist/db/migrate.js`), the production dependencies
# of @curanno/api, and the built clients it serves under STATIC_ROOT: the sidebar
# (/sidebar/), the PDF viewer (/pdf/) and the guest bundle (/guest.js).
# `web` holds the management site's Nitro server. Both read their
# configuration from environment variables (see .env.example and
# deploy/helm/curanno/values.yaml); nothing is baked in.
#
# Both run as uid 1000 in group 0, and every file belongs to group 0 and is
# readable by it, so OpenShift can run them as an arbitrary uid from the
# namespace's range (always with gid 0). Nothing is written at run time.

FROM docker.io/library/node:24-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/model/package.json packages/model/
COPY packages/api-client/package.json packages/api-client/
COPY packages/extract/package.json packages/extract/
COPY packages/guest/package.json packages/guest/
COPY apps/api/package.json apps/api/
COPY apps/sidebar/package.json apps/sidebar/
COPY apps/pdf-viewer/package.json apps/pdf-viewer/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages packages
COPY apps apps
COPY dev-ports.ts ./
# The libraries, then each client; the sidebar and viewer read config.json at
# run time, so their builds carry only development defaults.
RUN pnpm exec tsc -b tsconfig.json \
 && pnpm --filter @curanno/guest bundle \
 && pnpm --filter @curanno/sidebar build \
 && pnpm --filter @curanno/pdf-viewer build \
 && pnpm --filter @curanno/web exec nuxt prepare \
 && pnpm --filter @curanno/web build \
 && pnpm --filter @curanno/api deploy --prod --legacy /out \
 && mkdir -p /out/static \
 && cp -r apps/sidebar/dist /out/static/sidebar \
 && cp -r apps/pdf-viewer/dist /out/static/pdf \
 && cp packages/guest/build/guest.js /out/static/guest.js

FROM docker.io/library/node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/openapi.yaml ./openapi.yaml
COPY --from=build /out/migrations ./migrations
COPY --from=build /out/static ./static
# Run by the chart's Zitadel provisioning Job (zitadel.provision in its values).
COPY deploy/zitadel/provision.ts ./zitadel/provision.ts
USER 1000:0
EXPOSE 3000
ENV PORT=3000
ENV STATIC_ROOT=/app/static
CMD ["node", "dist/index.js"]

FROM docker.io/library/node:24-alpine AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/apps/web/.output ./
USER 1000:0
EXPOSE 3001
ENV PORT=3001
ENV HOST=0.0.0.0
CMD ["node", "server/index.mjs"]
