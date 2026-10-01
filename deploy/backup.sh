#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a
source ./.env
set +a
mkdir -p backups
TS=$(date +%Y%m%d-%H%M%S)
OUT="backups/salesportal-$TS.dump"
TMP="${OUT}.tmp"
trap 'rm -f "$TMP"' EXIT
# Dump is streamed from the PostgreSQL container to the host-mounted deploy/backups folder.
docker compose exec -T db pg_dump -Fc -U "${POSTGRES_USER:-salesportal}" "${POSTGRES_DB:-salesportal}" > "$TMP"
mv "$TMP" "$OUT"
trap - EXIT
find backups -name 'salesportal-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
printf '%s\n' "$OUT"
