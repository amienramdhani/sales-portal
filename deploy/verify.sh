#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source .env
HOST="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
echo "Containers:"
docker compose ps
echo
echo "healthz:"
curl -fsS "$HOST/healthz"; echo
echo "readyz:"
curl -fsS "$HOST/readyz"; echo
echo "API matrix:"
python ../tools/check_api_matrix.py
