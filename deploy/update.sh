#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose build api worker
docker compose run --rm --entrypoint /app/migrate api -schema /app/migrations/000001_init.sql
docker compose up -d --remove-orphans api worker caddy
./verify.sh
