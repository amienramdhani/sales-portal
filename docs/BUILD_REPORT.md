# Sales Portal v2 - build verification report

Baseline: `Sales-Portal-AppsScript-2026-09-30.zip`  
Canonical weekly module: `Weekly.gs` only.

## Verified in the artifact build environment

- Final Apps Script inventory: **141 unique `api*` functions**.
- Go contract registry vs API matrix: **141 / 141, missing 0, extra 0**.
- Native Go candidate handlers wired: **96**.
- Contract-only endpoints still requiring parity implementation: **45**.
- `go test ./internal/core`: **PASS**.
- PostgreSQL schema, initial-workbook importer, Drive read-only worker, Docker Compose, Caddy, backup/restore scripts, golden normalizer and k6 scenario are included.
- Production UI is preserved under `frontend/public/legacy/` with a REST compatibility shim for parallel parity work.

## Not yet proven in this build environment

- Full `go test ./...` / dependency compile: **not executed to completion** because outbound DNS/network access to `proxy.golang.org` is blocked in the artifact environment. Run `go mod tidy && go test ./...` on the VPS/CI host with internet access.
- PostgreSQL/Docker end-to-end runtime: **not executed here** because Docker/PostgreSQL services are not available in the artifact environment.
- Golden-output parity: **0 endpoints are marked `PORTED_GOLDEN_PASS` yet**. Candidate handlers must be compared against Apps Script output using real anonymized fixtures.
- Two-week zero-diff parallel run, load gate, backup restore gate and cut-over approval: **pending**.

## Cut-over rule

Do **not** switch `PARALLEL_MODE=false` or retire Apps Script until `docs/CUTOVER_CHECKLIST.md` is fully satisfied.
