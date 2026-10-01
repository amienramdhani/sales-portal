#!/usr/bin/env bash
set -euo pipefail
cat <<'TXT'
Rollback aplikasi tidak menghapus PostgreSQL.
1. Arahkan link/domain operasional kembali ke URL Apps Script lama.
2. Pastikan Apps Script masih aktif dan belum diubah read-only jika rollback dilakukan sebelum masa cadangan selesai.
3. Stop v2 writer/worker jika perlu: docker compose stop worker api caddy
4. Simpan database/backup v2 untuk investigasi; jangan hapus data.
TXT
