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

# Site, sidebar and API on one origin (WEB_PORT, default 3001), like production;
# PDF viewer on PDF_VIEWER_PORT (5174). Ports: .env.example
dev: migrate build
    pnpm -r --parallel \
      --filter @curanno/api \
      --filter @curanno/sidebar \
      --filter @curanno/pdf-viewer \
      --filter @curanno/web \
      dev

# Sample host page and bookmarklet on GUEST_PORT (5180), against the local sidebar
guest:
    pnpm --filter @curanno/guest dev -- --sidebar-origin http://localhost:`node dev-ports.ts WEB_PORT`
