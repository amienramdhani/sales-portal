#!/usr/bin/env python3
from pathlib import Path
import csv, re, sys
root=Path(__file__).resolve().parents[1]
contracts=(root/'backend/internal/api/contracts_generated.go').read_text()
source=set(re.findall(r'Name: "(api[A-Za-z0-9_]+)"',contracts))
with (root/'docs/API_MATRIX.csv').open(encoding='utf-8-sig') as f:
    matrix={r['endpoint'] for r in csv.DictReader(f)}
missing=sorted(source-matrix); extra=sorted(matrix-source)
print(f'contracts={len(source)} matrix={len(matrix)} missing={len(missing)} extra={len(extra)}')
if missing: print('missing:',*missing,sep='\n- ')
if extra: print('extra:',*extra,sep='\n- ')
sys.exit(1 if missing or extra else 0)
