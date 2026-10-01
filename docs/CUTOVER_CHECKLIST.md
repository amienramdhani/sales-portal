# Cut-over checklist

## Golden parity
- [ ] All 141 rows in `API_MATRIX.csv` are `PORTED_GOLDEN_PASS`.
- [ ] Core metrics: ST, SO, DA, NOO, omzet, target, LMTD, KPI, DOS match the Apps Script golden output.
- [ ] Role/scope negative tests pass for Sales, ASM, RGM, Admin, Head of Sales, Top Tier, Super Admin.
- [ ] Demo mode is read-only and uses target-user scope.
- [ ] ONLINE behavior matches production.

## UI
- [ ] Desktop 1440 px visual comparison passes.
- [ ] Mobile 390 px visual comparison passes with no unintended horizontal page scroll.
- [ ] Tables, filters, freeze columns, panel state, bottom sheets, tooltips and loading states are verified.
- [ ] PWA online-first behavior verified.

## Data pipeline
- [ ] Drive service account has Viewer only.
- [ ] Worker reads `2. SELESAI` and never moves/renames/deletes files.
- [ ] Replace semantics month x region verified.
- [ ] NIK remap, returns, duplicate handling, cutoff and period locks verified.
- [ ] Daily reconciliation shows zero unexplained differences for at least 14 consecutive days.

## Operations
- [ ] k6 p95/p99/error-rate target passed.
- [ ] Daily backup passes.
- [ ] Weekly restore smoke test passes.
- [ ] Off-VPS backup copy exists.
- [ ] Admin runbook tested by someone other than the developer.
- [ ] Rollback URL/process tested.

## Final switch
- [ ] Freeze production writes for agreed cut-over window.
- [ ] Final Drive worker run completed.
- [ ] Final golden/reconciliation diff = zero.
- [ ] Set `PARALLEL_MODE=false` only after approval.
- [ ] Point operational domain/link to v2.
- [ ] Keep Apps Script read-only for 1 month.
