#!/usr/bin/env sh
# Dump the annotations database to a file (pg_dump custom format, compressed,
# without ownership or privilege statements so it restores into any role).
#
#   DATABASE_URL=postgres://... scripts/db-backup.sh backups/annotations-$(date +%F).dump
#
# PG_DUMP overrides the pg_dump command, for example to run the one inside the
# database container when the host has none or an older major version:
#   PG_DUMP="podman exec -i annotations-postgres-1 pg_dump" scripts/db-backup.sh out.dump
# The dump is written through stdout, so that works unchanged.
set -eu
out="${1:?usage: db-backup.sh <output file>}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
${PG_DUMP:-pg_dump} --format=custom --compress=6 --no-owner --no-acl --dbname="$DATABASE_URL" > "$out"
