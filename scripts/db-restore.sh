#!/usr/bin/env sh
# Restore a dump made by db-backup.sh into an empty database. The target
# database must exist (created by the operator or the hosting service) and be
# empty; the API's migration runner is then run against it to confirm the
# schema is current before the API is pointed at it.
#
#   TARGET_DATABASE_URL=postgres://... scripts/db-restore.sh backups/curanno-2026-10-30.dump
#
# PG_RESTORE overrides the pg_restore command the same way PG_DUMP does for
# backups; the dump is read from stdin.
set -eu
dump="${1:?usage: db-restore.sh <dump file>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL must be set}"
${PG_RESTORE:-pg_restore} --no-owner --no-acl --exit-on-error --dbname="$TARGET_DATABASE_URL" < "$dump"
