# Locked migration decisions

These decisions are part of the v2 implementation contract.

## Parallel data flow
- Apps Script remains production/source of truth until cut-over.
- Admin uploads once to the existing Google Drive flow.
- Go reads the Apps Script `2. SELESAI` folder with a service account that has Viewer/read-only access.
- The Go worker never renames, moves, deletes, or modifies Drive files.
- Each file is recorded by Drive file ID + SHA-256 + metadata + row count + processing result.
- Manual data upload in v2 is disabled while `PARALLEL_MODE=true`. Production writes remain in Apps Script.

## Golden comparison
- `null` and missing are equivalent.
- Numeric 5 and 5.0 compare equal; string "5" is not numeric 5.
- Only arrays explicitly declared unordered may be sorted before comparison.
- Ranking, sorted results, and trend/time arrays are order-sensitive.
- Dates normalize to YYYY-MM-DD in Asia/Jakarta.
- Process timestamps, snapshot IDs, request IDs, tokens, and durations may be excluded.
- Business rounding is performed inside the ported core, not in the comparator.
- Diffs are reported by JSON path.

## PostgreSQL model
- `staging_*`: raw text/JSON + validation status.
- Domain tables: normalized typed data with constraints/indexes.
- Wide Excel structures are converted to row-oriented domain records.

## Authorization
- Role rangkap resolves to the highest effective role while preserving Sales portfolio flag.
- Scope is computed server-side from NIK ATASAN plus Admin_Access.
- Direct resource access outside allowed scope must return 403.
- Sanitized cross-scope summaries remain possible where the production behavior intentionally allows them.
- ONLINE is included only according to the legacy role/metric rules.
- Demo mode resolves to the target user's scope and blocks all writes.

## Performance gate
- API p95 <= 1 second; p99 <= 2 seconds.
- Page p95 usable <= 2.5 seconds under defined mobile/4G profile.
- k6: 100 VUs for 10 minutes, 3-5 second think time, error rate < 0.5%.
- Test against production-sized 24-month data and a 2x growth scenario.

## Backup / DR
- Daily backup; RPO <= 24 hours, RTO <= 2 hours.
- Weekly automated restore test into a separate database with smoke/golden queries.
- At least one backup copy outside the VPS.
- Bulk changes get a checkpoint before commit.

## Auth compatibility
Legacy PIN hash contract:
`base64url(HMAC_SHA256(key=PEPPER, message=NIK + "|" + SALT + "|" + PIN))`, without `=` padding.

`VERSI`, `WAJIB_GANTI`, `GAGAL`, `LOCK_UNTIL`, and `AKTIF` remain behaviorally compatible. Argon2id upgrade is postponed until after cut-over.

## PWA
- Online-first.
- Cache only application shell/static assets.
- Business API responses use `Cache-Control: no-store`.
- Session uses HttpOnly/Secure/SameSite cookie.
- localStorage is limited to non-sensitive UI preferences.

## Observability
- Structured JSON logs with request ID.
- Panic recovery.
- `/healthz`, `/readyz`, `/metrics`.
- Sync status and recent sync log.
- Slow query logging.
- Alerts for sustained latency, worker failure and backup failure.
