# Sales Portal v2 - Go + PostgreSQL + React PWA

Migration baseline generated from:

- `Sales-Portal-AppsScript-2026-09-30.zip` (final Apps Script source baseline)
- `Sales Portal - Database.xlsx` (supplied database workbook)
- `PRD Sales Portal v2 (Go + React PWA)`
- locked migration decisions from the migration review

Canonical weekly source: **`Weekly.gs` only**.

## Objective

Run v2 in parallel with the current Apps Script production system, reproduce business outputs and authorization behavior, then cut over only after the golden comparison and operational gates pass.

## Repository layout

```text
backend/                  Go API, auth, scope, reports, importer, worker
frontend/                 React + TypeScript PWA
  public/legacy/          production UI reference + Go REST compatibility shim
  src/                    componentized React rewrite

database/migrations/      PostgreSQL schema

deploy/                   Docker Compose, Caddy, install/update/backup scripts

docs/                     API matrix, decisions, inventories, cut-over checklist

tests/golden/              normalized JSON diff harness

tests/load/                k6 scenario

legacy_reference/          final Apps Script source - reference only

tools/                     audit helpers
```

## Current checkpoint

The final source contains **141 Apps Script APIs**. All 141 routes are registered in Go.

At this checkpoint:

- **96** endpoints have native Go candidate handlers wired.
- **45** remain contract-registered, mainly write/stage/template/restore workflows kept on Apps Script while `PARALLEL_MODE=true`.
- **0** endpoints are declared `PORTED_GOLDEN_PASS` until automated parity comparison is executed against the production Apps Script baseline.

See:

```text
docs/status.md
docs/API_MATRIX.csv
docs/API_MATRIX_SUMMARY.json
```

Do not interpret `PORTED_CANDIDATE` as cut-over approval.

## Recommended VPS path

Copy the entire extracted project to:

```text
/opt/sales-portal-v2
```

The deployment working directory is:

```text
/opt/sales-portal-v2/deploy
```

Copy the initial database workbook to:

```text
/opt/sales-portal-v2/deploy/import/Sales-Portal-Database.xlsx
```

Copy the Google service-account key to:

```text
/opt/sales-portal-v2/deploy/secrets/google-service-account.json
```

Create the runtime environment file:

```bash
cd /opt/sales-portal-v2/deploy
cp .env.example .env
nano .env
```

Keep:

```env
PARALLEL_MODE=true
```

throughout the parallel test period.

## Install

After Docker Engine + Compose are installed and `deploy/.env` is complete:

```bash
cd /opt/sales-portal-v2/deploy
chmod +x *.sh
./install.sh
```

The installer:

1. builds the Go + frontend image;
2. starts PostgreSQL;
3. applies `database/migrations/000001_init.sql`;
4. imports the initial workbook;
5. starts API, Drive worker and Caddy;
6. calls `/healthz`, `/readyz` and the API inventory checker.

## Drive parallel mode

The production Apps Script remains the operational writer.

The Go worker reads **only the Apps Script `2. SELESAI` folder** with Google Drive read-only scope. It never renames, moves or deletes Drive files.

Set:

```env
DRIVE_FINISHED_FOLDER_ID=<folder-id-2-SELESAI>
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-service-account.json
```

Share only that folder to the service-account email as **Viewer**.

## Verification

```bash
cd /opt/sales-portal-v2/deploy
./verify.sh
```

Additional source checks:

```bash
cd /opt/sales-portal-v2
python tools/check_api_matrix.py

cd backend
go mod tidy
go test ./...
```

The build container used to prepare this package had no outbound access to `proxy.golang.org`, so dependency-bearing Go packages could not be compiled here. Run the commands above once on the VPS/CI host with internet access.

## UI mode

For migration parity, use the preserved legacy production UI first. It lives at:

```text
frontend/public/legacy/index.html
```

It contains a `google.script.run` compatibility shim that maps the legacy client calls to `/api/<apiName>`.

The React component rewrite is also present under `frontend/src`; switch UI mode only after visual + behavioral parity is validated.

## Cut-over rule

Never set:

```env
PARALLEL_MODE=false
```

until `docs/CUTOVER_CHECKLIST.md` is completely satisfied.

## Detailed instructions

Use the companion PDF:

`Sales-Portal-v2-Implementation-Guide.pdf`

It explains exactly what to copy, where to put it, how to configure the VPS, Drive, PostgreSQL, domain/HTTPS, initial import, parallel operation, backup/restore, troubleshooting, cut-over and rollback.
