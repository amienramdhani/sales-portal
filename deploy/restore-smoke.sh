#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a
source ./.env
set +a
DUMP=${1:?'pakai: ./restore-smoke.sh backups/salesportal-YYYYMMDD-HHMMSS.dump'}
[[ -f "$DUMP" ]] || { echo "Dump tidak ditemukan: $DUMP" >&2; exit 1; }
TESTDB="salesportal_restore_test"
DBUSER="${POSTGRES_USER:-salesportal}"
cleanup(){ docker compose exec -T db dropdb -U "$DBUSER" --if-exists "$TESTDB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker compose exec -T db createdb -U "$DBUSER" "$TESTDB"
cat "$DUMP" | docker compose exec -T db pg_restore -U "$DBUSER" -d "$TESTDB"
docker compose exec -T db psql -U "$DBUSER" -d "$TESTDB" -v ON_ERROR_STOP=1 <<'SQL'
select count(*) as people from people;
select count(*) as customers from customers;
select count(*) as st_lines from st_lines;
select count(*) as auth_accounts from auth_accounts;
SQL
cleanup
trap - EXIT
printf 'restore smoke OK: %s\n' "$DUMP"
