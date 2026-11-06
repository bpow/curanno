default: dev

# Start Postgres and Zitadel, provisioning the dev client and users
up:
    podman compose up -d --wait

down:
    podman compose down

migrate: up
    pnpm --filter @curanno/api migrate

# Build first so the dev scripts' concurrent `tsc -b` runs are no-ops, not races
build:
    pnpm build

# Site, sidebar and API on :3001 (as one origin, like production); PDF viewer on :5174
dev: migrate build
    pnpm -r --parallel \
      --filter @curanno/api \
      --filter @curanno/sidebar \
      --filter @curanno/pdf-viewer \
      --filter @curanno/web \
      dev

# Sample host page and bookmarklet on :5180, against the local sidebar
guest:
    pnpm --filter @curanno/guest dev -- --sidebar-origin http://localhost:3001
