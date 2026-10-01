#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy"

if [[ ! -f .env ]]; then
  echo "ERROR: deploy/.env belum ada. Copy dari .env.example dan isi dulu." >&2
  exit 1
fi
if [[ ! -f import/Sales-Portal-Database.xlsx ]]; then
  echo "ERROR: copy database awal ke deploy/import/Sales-Portal-Database.xlsx" >&2
  exit 1
fi
if [[ ! -f secrets/google-service-account.json ]]; then
  echo "WARNING: service account Drive belum ada; worker sync tidak akan bisa membaca Drive." >&2
fi

echo "[1/5] Build image"
docker compose build

echo "[2/5] Start PostgreSQL"
docker compose up -d db

echo "[3/5] Apply schema + import initial workbook"
docker compose run --rm --entrypoint /app/migrate api \
  -schema /app/migrations/000001_init.sql \
  -xlsx /import/Sales-Portal-Database.xlsx

echo "[4/5] Start API, worker, Caddy"
docker compose up -d api worker caddy

echo "[5/5] Verify"
./verify.sh
