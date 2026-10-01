#!/usr/bin/env python3
from pathlib import Path
import csv, json, re
root=Path(__file__).resolve().parents[1]
contracts=(root/'backend/internal/api/contracts_generated.go').read_text()
items=[]
for m in re.finditer(r'\{Name: "(api[A-Za-z0-9_]+)", Source: "([^"]+)", Params: \[\]string\{([^}]*)\}\}',contracts):
    name,src,raw=m.groups()
    params=re.findall(r'"([^"]+)"', raw)
    items.append((name,src,params))
server=(root/'backend/internal/api/server.go').read_text()
ported={'apiLogin'}
# Every literal api name mentioned in a switch case is an explicit implementation.
for line in server.splitlines():
    if line.lstrip().startswith('case '):
        ported.update(re.findall(r'"(api[A-Za-z0-9_]+)"', line))
# Operational writes deliberately disabled while v1 is source of truth.
parallel_disabled=set()
for name,src,params in items:
    if re.search(r'(Stage|Commit|Upload|Publish|Restore|Bulk)',name) and name not in ported:
        parallel_disabled.add(name)
# A few non-stage writes are also intentionally held on v1 in parallel mode.
parallel_disabled.update({'apiAddDealer','apiSaveUser','apiTargetSave','apiKpiSaveRegion','apiKpiSaveRgm','apiKpiCopy','apiDealerSave','apiDealerDelete','apiAccountDelete','apiAccountMergeCommit','apiStatusBulkCommit'})
rows=[]
for name,src,params in sorted(items):
    if name in ported:
        status='PORTED_NOT_GOLDEN'
        note='Implemented in Go; must pass golden-output parity before cut-over.'
    elif name in parallel_disabled:
        status='PARALLEL_DISABLED'
        note='Disabled in Go while PARALLEL_MODE=true; production write remains in Apps Script until parity/cut-over.'
    else:
        status='CONTRACT_REGISTERED'
        note='Route registered; parity implementation still required before cut-over.'
    rows.append({'endpoint':name,'legacy_source':src,'params':', '.join(params),'migration_status':status,'parallel_note':note})
with (root/'docs/API_MATRIX.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
summary={
 'total':len(rows),
 'ported_not_golden':sum(r['migration_status']=='PORTED_NOT_GOLDEN' for r in rows),
 'contract_registered':sum(r['migration_status']=='CONTRACT_REGISTERED' for r in rows),
 'parallel_disabled':sum(r['migration_status']=='PARALLEL_DISABLED' for r in rows),
}
(root/'docs/API_MATRIX_SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
