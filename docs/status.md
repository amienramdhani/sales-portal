# Migration build status

Baseline source: `Sales-Portal-AppsScript-2026-09-30.zip`.
Canonical weekly module: **`Weekly.gs` only**. Do not add `WeeklyAnalysis.gs` to the same Apps Script project.

The final Apps Script baseline contains **141 unique `api*` functions**. `docs/API_MATRIX.csv` is the machine-readable contract inventory.

## Current implementation checkpoint

- 141/141 routes are registered by the Go API contract layer.
- 96/141 routes currently have native Go candidate handlers wired in the API dispatcher.
- 45/141 routes remain `CONTRACT_REGISTERED`; these are mostly mutation/staging/template/restore workflows intentionally kept on Apps Script during parallel operation, plus a few post-cut-over admin flows.
- 0 routes are labelled `PORTED_GOLDEN_PASS` yet. A route is not considered parity-complete until it passes the Apps Script golden-output comparison for the applicable roles/periods/filters.
- Core calculation package, auth compatibility, server-side scope resolution, PostgreSQL schema, initial workbook importer, Drive read-only worker, dashboard/reporting foundation, observability endpoints and legacy-UI REST shim are included.
- The legacy production UI is preserved under `frontend/public/legacy/` as the visual parity reference and can be used as the default migration UI while the React component rewrite is completed.

This repository is therefore a **parallel-migration build candidate, not a cut-over approval**.

## Verification completed in this build environment

- Source inventory: 141 API contracts; canonical `Weekly.gs` confirmed.
- API contract matrix consistency: `contracts=141 matrix=141 missing=0 extra=0`.
- Go `internal/core` unit tests pass locally.
- Full Go dependency compilation could not be completed in this build container because outbound DNS/network access to `proxy.golang.org` is blocked. `go mod tidy`/`go test ./...` must be run once on the VPS/CI host with internet access.

## Cut-over remains forbidden until

1. all 141 rows are `PORTED_GOLDEN_PASS`;
2. negative scope/security tests pass;
3. UI parity checks pass at 390 px and 1440 px;
4. two weeks of parallel reconciliation have zero unexplained differences;
5. backup restore and k6 load gates pass.
