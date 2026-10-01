#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose run --rm --entrypoint /app/worker worker --once
