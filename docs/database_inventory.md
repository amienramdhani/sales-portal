# Database inventory - source workbook

Source: `Sales Portal - Database.xlsx` supplied with the 2026-09-30 migration baseline.

| Sheet | Data rows | Notes |
|---|---:|---|
| Master_Customer | 4,954 | Dealer/customer master |
| Dealer_Assignment_History | 14 | Dealer owner history |
| Log_Sync | 189 | Legacy sync log |
| Target_Input | 61 | Wide monthly sales targets |
| Hari_Libur | 3 | Active/inactive holidays |
| Export_Access | 10 | Per-user export permission |
| AI_Audit_Log | 52 | AI audit history |
| Version_Log | 44 | Publish/version history |
| Backup_Log | 0 | Backup log header only |
| Period_Locks | 0 | Period lock header only |
| Dealer_Region | 0 | Override header only |
| Admin_Access | 4 | Admin big-region scope |
| DOS_Config | 1 | DOS threshold |
| Informasi | 0 | Announcement header only |
| _Auth | 105 | Salt/hash/account state - canonical auth source |
| Audit_Log | 468 | Administrative audit history |
| KPI_Config | 24 | KPI policy rows |
| Target_Periode | 210 | Indicator-specific target rows |
| Product_Rules | 7 | Brand mapping / MASUK_QTY |
| Region_Map | 44 | Includes `KANAL` |
| Master_Sales | 998 | Org structure; still contains legacy `PIN AKSES` |
| Master_Product | 999 | Product master |
| Master_Transaksi | 12,070 | ST transaction rows in supplied sample |
| Master_Target | 999 | Legacy target table |
| Backup_Posisi_1789283275978 | 999 | Historical backup; contains legacy `PIN AKSES` |

## Important migration observations

1. `_Auth` is the only auth source imported to `auth_accounts`; legacy `PIN AKSES` values are deliberately ignored.
2. `Region_Map` already has `KANAL`, so ONLINE routing is representable in PostgreSQL.
3. The supplied workbook does not contain `Master_SO`, `Master_Promotor`, `Master_Grade`, or `Dealer_Tutup`. The importer treats these as optional/on-demand sources because the Apps Script code can create/use them later.
4. Wide sheets such as `Target_Input`, Promotor and Grade are normalized into row-oriented domain tables. Their wide shape exists only at the spreadsheet/template boundary.
5. Raw import values are retained under `staging_*` before domain validation and commit.
