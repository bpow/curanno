# API image. Build from the repository root:
#   podman build -t annotations-api -f Dockerfile .
# The image contains the compiled server, the OpenAPI document it binds to,
# the SQL migrations (run with `node apps/api/dist/db/migrate.js`) and only
# the production dependencies of @scale/api and the workspace packages it
# uses. Configuration is read from environment variables (see .env.example).

FROM docker.io/library/node:24-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/model/package.json packages/model/
COPY packages/api-client/package.json packages/api-client/
COPY packages/guest/package.json packages/guest/
COPY apps/api/package.json apps/api/
COPY apps/sidebar/package.json apps/sidebar/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @scale/api...
COPY packages/model packages/model
COPY packages/api-client packages/api-client
COPY apps/api apps/api
RUN pnpm exec tsc -b apps/api/tsconfig.json \
 && pnpm --filter @scale/api deploy --prod --legacy /out

FROM docker.io/library/node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/openapi.yaml ./openapi.yaml
COPY --from=build /out/migrations ./migrations
USER node
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/index.js"]
