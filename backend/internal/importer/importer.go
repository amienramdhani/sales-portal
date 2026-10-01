package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"
	"salesportal/internal/core"
	x "salesportal/internal/xlsx"
)

type Importer struct {
	DB       *pgxpool.Pool
	Location *time.Location
}
type Result struct {
	FileID   int64    `json:"fileId"`
	Kind     string   `json:"kind"`
	Rows     int      `json:"rows"`
	Periods  []string `json:"periods"`
	Regions  []string `json:"regions"`
	Warnings []string `json:"warnings"`
}

func (im *Importer) ImportInitialWorkbook(ctx context.Context, path string) (map[string]int, error) {
	f, err := x.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	counts := map[string]int{}
	tx, err := im.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	steps := []func(context.Context, pgx.Tx, *excelize.File) (int, error){im.importRegions, im.importPeople, im.importAdminRegions, im.importAuth, im.importCustomers, im.importOwnerHistory, im.importBrands, im.importProducts, im.importTargetsWide, im.importTargetsLong, im.importKPI, im.importDOS, im.importHolidays, im.importLocks, im.importExportAccess, im.importAnnouncements, im.importST, im.importSO, im.importPromotors, im.importGrades}
	names := []string{"Region_Map", "Master_Sales", "Admin_Access", "_Auth", "Master_Customer", "Dealer_Assignment_History", "Product_Rules", "Master_Product", "Target_Input", "Target_Periode", "KPI_Config", "DOS_Config", "Hari_Libur", "Period_Locks", "Export_Access", "Informasi", "Master_Transaksi", "Master_SO", "Master_Promotor", "Master_Grade"}
	for i, fn := range steps {
		n, e := fn(ctx, tx, f)
		if e != nil {
			return nil, fmt.Errorf("%s: %w", names[i], e)
		}
		counts[names[i]] = n
	}
	if err := rebuildDerived(ctx, tx); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `update schema_migrations_meta set value=(value::bigint+1)::text,updated_at=now() where key='data_version'`); err != nil {
		return nil, err
	}
	return counts, tx.Commit(ctx)
}

func (im *Importer) ImportSyncFile(ctx context.Context, path, source, driveID, name, mime string, modified time.Time) (Result, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Result{}, err
	}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	var fileID int64
	err = im.DB.QueryRow(ctx, `insert into staging_files(source,drive_file_id,file_name,mime_type,file_size,sha256,modified_time,status) values($1,$2,$3,$4,$5,$6,$7,'PROCESSING') on conflict(source,drive_file_id,sha256) do update set file_name=excluded.file_name returning id`, source, driveID, name, mime, len(b), hash, modified).Scan(&fileID)
	if err != nil {
		return Result{}, err
	}
	f, err := x.Open(path)
	if err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	defer f.Close()
	kind, sheet, rows, err := detect(f)
	if err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	limit := 150000
	if kind == "SO" {
		limit = 300000
	}
	if len(rows) > limit {
		return Result{}, im.fail(ctx, fileID, fmt.Errorf("maksimal %d baris per file", limit))
	}
	res := Result{FileID: fileID, Kind: kind, Rows: len(rows)}
	tx, err := im.DB.Begin(ctx)
	if err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	defer tx.Rollback(ctx)
	if err := im.stageRows(ctx, tx, fileID, sheet, rows); err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	switch kind {
	case "ST":
		res.Periods, res.Regions, res.Warnings, err = im.replaceST(ctx, tx, fileID, rows)
	case "SO":
		res.Periods, res.Regions, err = im.replaceSO(ctx, tx, fileID, rows)
	case "CUSTOMER":
		_, err = im.upsertCustomers(ctx, tx, rows, true)
	case "PRODUCT":
		_, err = im.upsertProducts(ctx, tx, rows)
	}
	if err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	if kind == "ST" || kind == "SO" {
		if err = rebuildDerived(ctx, tx); err != nil {
			return Result{}, im.fail(ctx, fileID, err)
		}
	}
	_, err = tx.Exec(ctx, `update staging_files set status='DONE',row_count=$2,periods=$3,regions=$4,processed_at=now() where id=$1`, fileID, len(rows), res.Periods, res.Regions)
	if err != nil {
		return Result{}, err
	}
	note := "worker Go read-only"
	if len(res.Warnings) > 0 {
		note += " | " + strings.Join(res.Warnings, " | ")
	}
	_, _ = tx.Exec(ctx, `insert into sync_log(file_name,drive_file_id,sha256,jenis,status,bulan,region,baris,keterangan) values($1,$2,$3,$4,'SELESAI',$5,$6,$7,$8)`, name, driveID, hash, kind, res.Periods, res.Regions, len(rows), note)
	if err = tx.Commit(ctx); err != nil {
		return Result{}, im.fail(ctx, fileID, err)
	}
	return res, nil
}
func (im *Importer) fail(ctx context.Context, id int64, e error) error {
	_, _ = im.DB.Exec(ctx, `update staging_files set status='FAILED',error_text=$2,processed_at=now() where id=$1`, id, e.Error())
	return e
}
func detect(f *excelize.File) (kind, sheet string, rows []x.Row, err error) {
	for _, s := range f.GetSheetList() {
		rr, e := x.Rows(f, s)
		if e != nil {
			continue
		}
		if len(rr) == 0 {
			continue
		}
		h := map[string]bool{}
		for k := range rr[0] {
			h[strings.ToUpper(strings.TrimSpace(k))] = true
		}
		switch {
		case h["TANGGAL TRANSAKSI"] && h["NO TRANSAKSI"] && h["KODE PRODUK"] && h["KODE CUSTOMER"]:
			return "ST", s, rr, nil
		case h["TANGGAL SO"] && h["KODE CUSTOMER"] && h["KODE PRODUK"]:
			return "SO", s, rr, nil
		case h["KODE CUSTOMER"] && h["NIK SALES"] && !h["TANGGAL TRANSAKSI"]:
			return "CUSTOMER", s, rr, nil
		case h["KODE BARANG"] && h["NAMA BARANG"] && h["BRAND"]:
			return "PRODUCT", s, rr, nil
		}
	}
	return "", "", nil, fmt.Errorf("jenis file tidak dikenali dari header")
}
func (im *Importer) stageRows(ctx context.Context, tx pgx.Tx, fileID int64, sheet string, rows []x.Row) error {
	for i, r := range rows {
		b, _ := json.Marshal(r)
		if _, e := tx.Exec(ctx, `insert into staging_rows(staging_file_id,sheet_name,row_no,raw) values($1,$2,$3,$4)`, fileID, sheet, i+2, b); e != nil {
			return e
		}
	}
	return nil
}

func sheetRows(f *excelize.File, name string) ([]x.Row, error) {
	for _, s := range f.GetSheetList() {
		if strings.EqualFold(s, name) {
			return x.Rows(f, s)
		}
	}
	return nil, nil
}
func b(v string) bool               { return core.Active(v) }
func num(v string) (float64, error) { return core.Number(v) }
func i64(v string) (int64, error) {
	n, e := core.Number(v)
	if e != nil {
		return 0, e
	}
	if math.Trunc(n) != n {
		return 0, fmt.Errorf("harus bilangan bulat: %s", v)
	}
	return int64(n), nil
}
func date(v string) (string, error) {
	v = strings.TrimSpace(v)
	if len(v) >= 10 && len(v) > 4 && v[4] == '-' {
		return core.ISO(v[:10])
	}
	// Excel source files use a mix of ISO, Indonesian dd/mm/yyyy and formatted mm-dd-yy cells.
	for _, layout := range []string{"2006/01/02", "02/01/2006", "02-01-2006", "01-02-06", "01/02/06", "2006-01-02 15:04:05"} {
		if t, e := time.Parse(layout, v); e == nil {
			return t.Format("2006-01-02"), nil
		}
	}
	return "", fmt.Errorf("tanggal tidak valid: %s", v)
}
func txt(r x.Row, k string) string { return strings.TrimSpace(r[k]) }

func (im *Importer) importRegions(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Region_Map")
	if e != nil {
		return 0, e
	}
	for _, r := range rows {
		if txt(r, "REGION") == "" {
			continue
		}
		_, e = tx.Exec(ctx, `insert into regions(region,wilayah_kpi,kanal) values($1,$2,$3) on conflict(region) do update set wilayah_kpi=excluded.wilayah_kpi,kanal=excluded.kanal,updated_at=now()`, txt(r, "REGION"), txt(r, "WILAYAH_KPI"), strings.ToUpper(txt(r, "KANAL")))
		if e != nil {
			return 0, e
		}
	}
	return len(rows), nil
}
func (im *Importer) importPeople(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Sales")
	if e != nil {
		return 0, e
	}
	type eff struct {
		name, role, region, supervisor, portfolio string
		sales                                     bool
	}
	effective := map[string]eff{}
	seenRole := map[string]bool{}
	for i, r := range rows {
		nik := txt(r, "NIK KARYAWAN")
		if nik == "" {
			continue
		}
		pos := core.RolePosition(txt(r, "POSISI"), 2)
		if core.Level[pos] == 0 {
			return 0, fmt.Errorf("baris %d posisi tidak valid: %s", i+2, pos)
		}
		name := txt(r, "SALES")
		key := nik + "|" + pos
		if seenRole[key] {
			return 0, fmt.Errorf("NIK dan role berulang: %s", nik)
		}
		seenRole[key] = true
		x, ok := effective[nik]
		if ok && x.name != name {
			return 0, fmt.Errorf("NIK memiliki nama berbeda: %s", nik)
		}
		candidate := eff{name: name, role: pos, region: txt(r, "REGION"), supervisor: txt(r, "NIK ATASAN"), sales: pos == "SALES"}
		if candidate.sales {
			candidate.portfolio = candidate.region
		}
		if !ok {
			effective[nik] = candidate
		} else if core.Level[pos] > core.Level[x.role] {
			candidate.sales = candidate.sales || x.sales
			if candidate.portfolio == "" {
				candidate.portfolio = x.portfolio
			}
			effective[nik] = candidate
		} else {
			x.sales = x.sales || candidate.sales
			if x.portfolio == "" {
				x.portfolio = candidate.portfolio
			}
			effective[nik] = x
		}
	}
	// Validate the effective hierarchy and region mapping before touching domain rows.
	for nik, p := range effective {
		if p.supervisor == nik {
			return 0, fmt.Errorf("Atasan utama menunjuk diri sendiri: %s", nik)
		}
		if p.supervisor != "" {
			if _, ok := effective[p.supervisor]; !ok {
				return 0, fmt.Errorf("Atasan tidak ditemukan: %s", p.supervisor)
			}
		}
		seen := map[string]bool{nik: true}
		n := p.supervisor
		for n != "" {
			if seen[n] {
				return 0, fmt.Errorf("Siklus hierarki: %s", nik)
			}
			seen[n] = true
			n = effective[n].supervisor
		}
		if core.Level[p.role] < 4 && p.role != "ADMIN" {
			region := p.region
			if region == "" {
				region = p.portfolio
			}
			var exists bool
			_ = tx.QueryRow(ctx, `select exists(select 1 from regions where region=$1 and wilayah_kpi<>'')`, region).Scan(&exists)
			if !exists {
				return 0, fmt.Errorf("Region belum dipetakan di Region_Map: %s", region)
			}
		}
	}
	for i, r := range rows {
		nik := txt(r, "NIK KARYAWAN")
		if nik == "" {
			continue
		}
		pos := core.RolePosition(txt(r, "POSISI"), 2)
		_, e = tx.Exec(ctx, `insert into people(nik,nama,posisi,region,nik_atasan,aktif,source_row) values($1,$2,$3,$4,$5,true,$6) on conflict(nik,posisi) do update set nama=excluded.nama,region=excluded.region,nik_atasan=excluded.nik_atasan,aktif=true,source_row=excluded.source_row,updated_at=now()`, nik, txt(r, "SALES"), pos, txt(r, "REGION"), txt(r, "NIK ATASAN"), i+2)
		if e != nil {
			return 0, e
		}
	}
	return len(rows), nil
}
func (im *Importer) importAdminRegions(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Admin_Access")
	if e != nil {
		return 0, e
	}
	for _, r := range rows {
		if txt(r, "NIK") == "" || txt(r, "WILAYAH") == "" {
			continue
		}
		_, e = tx.Exec(ctx, `insert into admin_regions(nik,wilayah) values($1,$2) on conflict do nothing`, txt(r, "NIK"), txt(r, "WILAYAH"))
		if e != nil {
			return 0, e
		}
	}
	return len(rows), nil
}
func (im *Importer) importAuth(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "_Auth")
	if e != nil {
		return 0, e
	}
	for _, r := range rows {
		nik := txt(r, "NIK")
		if nik == "" {
			continue
		}
		ver, _ := strconv.Atoi(txt(r, "VERSI"))
		if ver == 0 {
			ver = 1
		}
		failed, _ := strconv.Atoi(txt(r, "GAGAL"))
		var lock any = nil
		if s := txt(r, "LOCK_UNTIL"); s != "" {
			if t, e := time.Parse(time.RFC3339, s); e == nil {
				lock = t
			}
		}
		_, e = tx.Exec(ctx, `insert into auth_accounts(nik,salt,pin_hash,aktif,versi,wajib_ganti,gagal,lock_until) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(nik) do update set salt=excluded.salt,pin_hash=excluded.pin_hash,aktif=excluded.aktif,versi=excluded.versi,wajib_ganti=excluded.wajib_ganti,gagal=excluded.gagal,lock_until=excluded.lock_until`, nik, txt(r, "SALT"), txt(r, "PIN_HASH"), b(txt(r, "AKTIF")), ver, b(txt(r, "WAJIB_GANTI")), failed, lock)
		if e != nil {
			return 0, e
		}
	}
	return len(rows), nil
}
func (im *Importer) importCustomers(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Customer")
	if e != nil {
		return 0, e
	}
	return im.upsertCustomers(ctx, tx, rows, false)
}
func (im *Importer) upsertCustomers(ctx context.Context, tx pgx.Tx, rows []x.Row, sync bool) (int, error) {
	n := 0
	for i, r := range rows {
		id := txt(r, "KODE CUSTOMER")
		if id == "" {
			continue
		}
		nik := txt(r, "NIK SALES")
		if sync {
			var old string
			e := tx.QueryRow(ctx, `select nik_sales from customers where kode_customer=$1`, id).Scan(&old)
			if e == nil && old != "" && nik != "" && old != nik {
				return n, fmt.Errorf("baris %d NIK SALES berbeda; gunakan Transfer Dealer", i+2)
			}
		}
		_, e := tx.Exec(ctx, `insert into customers(kode_customer,id_dealer,alias,nama_customer,nama_induk_customer,region,sub_region,alamat,kota,no_hp,nik_sales,nama_pic) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(kode_customer) do update set id_dealer=case when excluded.id_dealer<>'' then excluded.id_dealer else customers.id_dealer end,alias=case when excluded.alias<>'' then excluded.alias else customers.alias end,nama_customer=case when excluded.nama_customer<>'' then excluded.nama_customer else customers.nama_customer end,nama_induk_customer=case when excluded.nama_induk_customer<>'' then excluded.nama_induk_customer else customers.nama_induk_customer end,region=case when excluded.region<>'' then excluded.region else customers.region end,sub_region=case when excluded.sub_region<>'' then excluded.sub_region else customers.sub_region end,alamat=case when excluded.alamat<>'' then excluded.alamat else customers.alamat end,kota=case when excluded.kota<>'' then excluded.kota else customers.kota end,no_hp=case when excluded.no_hp<>'' then excluded.no_hp else customers.no_hp end,nik_sales=case when excluded.nik_sales<>'' then excluded.nik_sales else customers.nik_sales end,nama_pic=case when excluded.nama_pic<>'' then excluded.nama_pic else customers.nama_pic end,updated_at=now()`, id, txt(r, "ID_DEALER"), txt(r, "ALIAS"), txt(r, "NAMA CUSTOMER"), txt(r, "NAMA INDUK CUSTOMER"), txt(r, "REGION"), txt(r, "SUB REGION"), txt(r, "ALAMAT"), txt(r, "KOTA"), txt(r, "No. HP"), nik, txt(r, "NAMA PIC"))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importOwnerHistory(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Dealer_Assignment_History")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "KODE CUSTOMER") == "" {
			continue
		}
		from, er := date(txt(r, "BERLAKU_MULAI"))
		if er != nil {
			continue
		}
		var to any = nil
		if s := txt(r, "BERLAKU_SAMPAI"); s != "" {
			if d, er := date(s); er == nil {
				to = d
			}
		}
		_, e = tx.Exec(ctx, `insert into customer_owner_history(kode_customer,nik_sales,berlaku_mulai,berlaku_sampai,sumber,note,updated_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(kode_customer,berlaku_mulai) do update set nik_sales=excluded.nik_sales,berlaku_sampai=excluded.berlaku_sampai,sumber=excluded.sumber,note=excluded.note,updated_by=excluded.updated_by,updated_at=now()`, txt(r, "KODE CUSTOMER"), txt(r, "NIK SALES"), from, to, txt(r, "SUMBER"), txt(r, "NOTE"), txt(r, "UPDATED_BY"))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importBrands(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Product_Rules")
	if e != nil {
		return 0, e
	}
	for _, r := range rows {
		brand := txt(r, "BRAND")
		if brand == "" {
			continue
		}
		main := txt(r, "BRAND_UTAMA")
		if main == "" {
			main = brand
		}
		_, e = tx.Exec(ctx, `insert into brands(source_brand,brand_utama,masuk_qty) values($1,$2,$3) on conflict(source_brand) do update set brand_utama=excluded.brand_utama,masuk_qty=excluded.masuk_qty`, brand, main, b(txt(r, "MASUK_QTY")))
		if e != nil {
			return 0, e
		}
	}
	return len(rows), nil
}
func (im *Importer) importProducts(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Product")
	if e != nil {
		return 0, e
	}
	return im.upsertProducts(ctx, tx, rows)
}
func (im *Importer) upsertProducts(ctx context.Context, tx pgx.Tx, rows []x.Row) (int, error) {
	n := 0
	for i, r := range rows {
		id := txt(r, "KODE BARANG")
		if id == "" {
			continue
		}
		source := txt(r, "BRAND")
		var main string
		var dev bool
		if e := tx.QueryRow(ctx, `select brand_utama,masuk_qty from brands where source_brand=$1`, source).Scan(&main, &dev); e != nil {
			return n, fmt.Errorf("baris %d Product_Rules belum lengkap: %s", i+2, source)
		}
		_, e := tx.Exec(ctx, `insert into products(kode_barang,nama_barang,source_brand,brand,kategori_produk,type,masuk_qty) values($1,$2,$3,$4,$5,$6,$7) on conflict(kode_barang) do update set nama_barang=excluded.nama_barang,source_brand=excluded.source_brand,brand=excluded.brand,kategori_produk=excluded.kategori_produk,type=excluded.type,masuk_qty=excluded.masuk_qty,updated_at=now()`, id, txt(r, "NAMA BARANG"), source, main, txt(r, "KATEGORI PRODUK"), txt(r, "TYPE"), dev)
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}

func (im *Importer) importTargetsWide(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Target_Input")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		period := txt(r, "PERIODE TARGET")
		if period == "" {
			period = txt(r, "PERIODE")
		}
		nik := txt(r, "NIK SALES")
		if nik == "" {
			nik = txt(r, "NIK")
		}
		if period == "" || nik == "" {
			continue
		}
		for h, v := range r {
			up := strings.ToUpper(strings.TrimSpace(h))
			parts := strings.Fields(up)
			if len(parts) < 2 {
				continue
			}
			metric := map[string]string{"ST": "QTY", "DA": "DA", "NOO": "NOO", "OMZET": "OMZET"}[parts[0]]
			if metric == "" {
				continue
			}
			brand := strings.Join(parts[1:], " ")
			var value any = nil
			if strings.TrimSpace(v) != "" {
				x, e := num(v)
				if e != nil {
					return n, fmt.Errorf("target %s %s: %w", nik, h, e)
				}
				value = x
			}
			_, e = tx.Exec(ctx, `insert into targets(period,nik,brand,metric,indicator_id,value) values($1,$2,$3,$4,'',$5) on conflict(period,nik,brand,metric,indicator_id) do update set value=excluded.value,updated_at=now()`, period, nik, brand, metric, value)
			if e != nil {
				return n, e
			}
			n++
		}
	}
	return n, nil
}
func (im *Importer) importTargetsLong(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Target_Periode")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "PERIODE") == "" || txt(r, "NIK") == "" {
			continue
		}
		var value any = nil
		if v := txt(r, "TARGET"); v != "" {
			x, e := num(v)
			if e != nil {
				return n, e
			}
			value = x
		}
		_, e = tx.Exec(ctx, `insert into targets(period,nik,brand,metric,indicator_id,value) values($1,$2,$3,$4,$5,$6) on conflict(period,nik,brand,metric,indicator_id) do update set value=excluded.value,updated_at=now()`, txt(r, "PERIODE"), txt(r, "NIK"), txt(r, "BRAND"), strings.ToUpper(txt(r, "METRIK")), txt(r, "INDIKATOR_ID"), value)
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importKPI(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "KPI_Config")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "PERIODE") == "" || !b(txt(r, "AKTIF")) {
			continue
		}
		w, e := num(txt(r, "BOBOT"))
		if e != nil {
			return n, e
		}
		cap, e := num(txt(r, "BATAS_SKOR"))
		if e != nil {
			return n, e
		}
		min := 2
		if s := txt(r, "MIN_QTY_DA"); s != "" {
			q, e := strconv.Atoi(strings.Split(s, ".")[0])
			if e == nil && q > 0 {
				min = q
			}
		}
		types := []string{}
		for _, v := range strings.Split(txt(r, "TYPE_FILTER"), "|") {
			if strings.TrimSpace(v) != "" {
				types = append(types, strings.TrimSpace(v))
			}
		}
		_, e = tx.Exec(ctx, `insert into kpi_policies(period,wilayah,kelompok,metric,brand,bobot,batas_skor,aktif,indicator_id,label,type_filter,min_qty_da) values($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11) on conflict(period,wilayah,kelompok,metric,brand,indicator_id) do update set bobot=excluded.bobot,batas_skor=excluded.batas_skor,aktif=true,label=excluded.label,type_filter=excluded.type_filter,min_qty_da=excluded.min_qty_da`, txt(r, "PERIODE"), txt(r, "WILAYAH_KPI"), txt(r, "KELOMPOK_KPI"), strings.ToUpper(txt(r, "METRIK")), txt(r, "BRAND"), w, cap, txt(r, "INDIKATOR_ID"), txt(r, "LABEL"), types, min)
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importDOS(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "DOS_Config")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "WILAYAH") == "" {
			continue
		}
		mn, _ := num(txt(r, "DOS_MIN"))
		mx, _ := num(txt(r, "DOS_MAX"))
		_, e = tx.Exec(ctx, `insert into dos_config(wilayah,dos_min,dos_max) values($1,$2,$3) on conflict(wilayah) do update set dos_min=excluded.dos_min,dos_max=excluded.dos_max`, txt(r, "WILAYAH"), mn, mx)
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importHolidays(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Hari_Libur")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "TANGGAL") == "" {
			continue
		}
		d, e := date(txt(r, "TANGGAL"))
		if e != nil {
			return n, e
		}
		_, e = tx.Exec(ctx, `insert into holidays(tanggal,keterangan,aktif) values($1,$2,$3) on conflict(tanggal) do update set keterangan=excluded.keterangan,aktif=excluded.aktif`, d, txt(r, "KETERANGAN"), b(txt(r, "AKTIF")))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importLocks(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Period_Locks")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "PERIODE") == "" {
			continue
		}
		_, e = tx.Exec(ctx, `insert into period_locks(period,terkunci,alasan,oleh) values($1,$2,$3,$4) on conflict(period) do update set terkunci=excluded.terkunci,alasan=excluded.alasan,oleh=excluded.oleh,waktu=now()`, txt(r, "PERIODE"), b(txt(r, "TERKUNCI")), txt(r, "ALASAN"), txt(r, "OLEH"))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importExportAccess(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Export_Access")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "NIK") == "" || txt(r, "JENIS_EXPORT") == "" {
			continue
		}
		_, e = tx.Exec(ctx, `insert into export_access(nik,jenis_export,aktif,updated_by) values($1,$2,$3,$4) on conflict(nik,jenis_export) do update set aktif=excluded.aktif,updated_by=excluded.updated_by,updated_at=now()`, txt(r, "NIK"), txt(r, "JENIS_EXPORT"), b(txt(r, "AKTIF")), txt(r, "UPDATED_BY"))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importAnnouncements(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Informasi")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		if txt(r, "ID") == "" {
			continue
		}
		wl := splitList(first(txt(r, "WILAYAH_LIST"), txt(r, "WILAYAH")))
		rl := splitList(txt(r, "ROLE_LIST"))
		bytes, _ := strconv.ParseInt(txt(r, "BYTES"), 10, 64)
		_, e = tx.Exec(ctx, `insert into announcements(id,judul,isi,wilayah_list,role_list,file_id,file_name,mime,bytes,penulis_nik,penulis_nama,aktif) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(id) do update set judul=excluded.judul,isi=excluded.isi,wilayah_list=excluded.wilayah_list,role_list=excluded.role_list,file_id=excluded.file_id,file_name=excluded.file_name,mime=excluded.mime,bytes=excluded.bytes,penulis_nik=excluded.penulis_nik,penulis_nama=excluded.penulis_nama,aktif=excluded.aktif`, txt(r, "ID"), txt(r, "JUDUL"), txt(r, "ISI"), wl, rl, txt(r, "FILE_ID"), txt(r, "FILE_NAME"), txt(r, "MIME"), bytes, txt(r, "PENULIS_NIK"), txt(r, "PENULIS_NAMA"), b(txt(r, "AKTIF")))
		if e != nil {
			return n, e
		}
		n++
	}
	return n, nil
}
func (im *Importer) importST(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Transaksi")
	if e != nil {
		return 0, e
	}
	if len(rows) == 0 {
		return 0, nil
	}
	ps, rs, _, e := im.appendST(ctx, tx, nil, rows)
	if e == nil {
		e = updateCoverage(ctx, tx, "ST", ps, rs, nil)
	}
	return len(rows), e
}
func (im *Importer) importSO(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_SO")
	if e != nil {
		return 0, e
	}
	if len(rows) == 0 {
		return 0, nil
	}
	ps, rs, e := im.appendSO(ctx, tx, nil, rows)
	if e == nil {
		e = updateCoverage(ctx, tx, "SO", ps, rs, nil)
	}
	return len(rows), e
}
func (im *Importer) importPromotors(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Promotor")
	if e != nil {
		return 0, e
	}
	if len(rows) == 0 {
		return 0, nil
	}
	_, e = tx.Exec(ctx, `delete from customer_promotors`)
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		id := first(txt(r, "ID DEALER"), txt(r, "KODE CUSTOMER"))
		if id == "" {
			continue
		}
		for h, v := range r {
			up := strings.ToUpper(strings.TrimSpace(h))
			if !strings.HasPrefix(up, "PROMOTOR ") {
				continue
			}
			brand := strings.TrimSpace(strings.TrimPrefix(up, "PROMOTOR "))
			var q any = nil
			if strings.TrimSpace(v) != "" {
				x, e := strconv.Atoi(strings.Split(v, ".")[0])
				if e != nil || x < 0 {
					return n, fmt.Errorf("promotor %s %s harus bilangan bulat >=0", id, brand)
				}
				q = x
			}
			_, e = tx.Exec(ctx, `insert into customer_promotors(kode_customer,brand,jumlah,present_in_master) values($1,$2,$3,true)`, id, brand, q)
			if e != nil {
				return n, e
			}
			n++
		}
	}
	return n, nil
}
func (im *Importer) importGrades(ctx context.Context, tx pgx.Tx, f *excelize.File) (int, error) {
	rows, e := sheetRows(f, "Master_Grade")
	if e != nil {
		return 0, e
	}
	if len(rows) == 0 {
		return 0, nil
	}
	_, e = tx.Exec(ctx, `delete from customer_grades`)
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		id := first(txt(r, "ID DEALER"), txt(r, "KODE CUSTOMER"))
		if id == "" {
			continue
		}
		for h, v := range r {
			up := strings.ToUpper(strings.TrimSpace(h))
			if !strings.HasPrefix(up, "GRADE ") || strings.TrimSpace(v) == "" {
				continue
			}
			brand := strings.TrimSpace(strings.TrimPrefix(up, "GRADE "))
			grade := strings.ToUpper(strings.TrimSpace(v))
			if len([]rune(grade)) > 20 {
				return n, fmt.Errorf("grade >20 karakter untuk %s", id)
			}
			_, e = tx.Exec(ctx, `insert into customer_grades(kode_customer,brand,grade) values($1,$2,$3)`, id, brand, grade)
			if e != nil {
				return n, e
			}
			n++
		}
	}
	return n, nil
}

func (im *Importer) replaceST(ctx context.Context, tx pgx.Tx, fileID int64, rows []x.Row) ([]string, []string, []string, error) {
	// Capture the legacy data before inserting so warning comparisons are meaningful.
	type before struct {
		cutoff string
		qty    int64
	}
	old := map[string]before{}
	for _, r := range rows {
		d, e := date(txt(r, "TANGGAL TRANSAKSI"))
		if e != nil {
			return nil, nil, nil, e
		}
		region, e := routeRegion(ctx, tx, txt(r, "KODE CUSTOMER"), txt(r, "NIK SALES"))
		if e != nil {
			return nil, nil, nil, e
		}
		k := d[:7] + "|" + region
		if _, ok := old[k]; !ok {
			var b before
			_ = tx.QueryRow(ctx, `select coalesce(max(tanggal)::text,''),coalesce(sum(qty),0)::bigint from st_lines where to_char(tanggal,'YYYY-MM')=$1 and region=$2`, d[:7], region).Scan(&b.cutoff, &b.qty)
			old[k] = b
		}
	}
	ps, rs, remapWarnings, err := im.appendST(ctx, tx, &fileID, rows)
	if err != nil {
		return nil, nil, nil, err
	}
	pairs := map[string]bool{}
	for _, r := range rows {
		d, _ := date(txt(r, "TANGGAL TRANSAKSI"))
		region, _ := routeRegion(ctx, tx, txt(r, "KODE CUSTOMER"), txt(r, "NIK SALES"))
		pairs[d[:7]+"|"+region] = true
	}
	warnings := append([]string{}, remapWarnings...)
	for k := range pairs {
		z := strings.SplitN(k, "|", 2)
		if _, err = tx.Exec(ctx, `delete from st_lines where to_char(tanggal,'YYYY-MM')=$1 and region=$2 and source_file_id is distinct from $3`, z[0], z[1], fileID); err != nil {
			return nil, nil, nil, err
		}
		var cut string
		var incoming int64
		_ = tx.QueryRow(ctx, `select coalesce(max(tanggal)::text,''),coalesce(sum(qty),0)::bigint from st_lines where to_char(tanggal,'YYYY-MM')=$1 and region=$2`, z[0], z[1]).Scan(&cut, &incoming)
		b := old[k]
		if b.cutoff != "" && cut != "" && cut < b.cutoff {
			warnings = append(warnings, z[1]+": cutoff mundur dari "+b.cutoff+" ke "+cut)
		}
		if b.qty > 0 && incoming*100 < b.qty*70 {
			warnings = append(warnings, fmt.Sprintf("%s: QTY turun >30%% (%d -> %d)", z[1], b.qty, incoming))
		}
	}
	if err = updateCoverage(ctx, tx, "ST", ps, rs, fileID); err != nil {
		return nil, nil, nil, err
	}
	return ps, rs, warnings, nil
}

func (im *Importer) replaceSO(ctx context.Context, tx pgx.Tx, fileID int64, rows []x.Row) ([]string, []string, error) {
	ps, rs, err := im.appendSO(ctx, tx, &fileID, rows)
	if err != nil {
		return nil, nil, err
	}
	pairs := map[string]bool{}
	for _, r := range rows {
		d, e := date(first(txt(r, "TANGGAL SO"), txt(r, "TANGGAL")))
		if e != nil {
			return nil, nil, e
		}
		region, e := routeRegion(ctx, tx, txt(r, "KODE CUSTOMER"), "")
		if e != nil {
			return nil, nil, e
		}
		pairs[d[:7]+"|"+region] = true
	}
	for k := range pairs {
		z := strings.SplitN(k, "|", 2)
		if _, err = tx.Exec(ctx, `delete from so_lines where to_char(tanggal,'YYYY-MM')=$1 and region=$2 and source_file_id is distinct from $3`, z[0], z[1], fileID); err != nil {
			return nil, nil, err
		}
	}
	if err = updateCoverage(ctx, tx, "SO", ps, rs, fileID); err != nil {
		return nil, nil, err
	}
	return ps, rs, nil
}

func (im *Importer) appendST(ctx context.Context, tx pgx.Tx, fileID *int64, rows []x.Row) ([]string, []string, []string, error) {
	periods, regions := map[string]bool{}, map[string]bool{}
	seen := map[string]bool{}
	remaps := map[string]int{}
	for i, r := range rows {
		d, e := date(txt(r, "TANGGAL TRANSAKSI"))
		if e != nil {
			return nil, nil, nil, fmt.Errorf("baris %d: %w", i+2, e)
		}
		if d > time.Now().In(im.Location).Format("2006-01-02") {
			return nil, nil, nil, fmt.Errorf("baris %d tanggal masa depan", i+2)
		}
		sku := txt(r, "KODE PRODUK")
		var exists bool
		if e = tx.QueryRow(ctx, `select exists(select 1 from products where kode_barang=$1)`, sku).Scan(&exists); e != nil || !exists {
			return nil, nil, nil, fmt.Errorf("baris %d produk tidak dikenal: %s", i+2, sku)
		}
		cust := txt(r, "KODE CUSTOMER")
		nik := txt(r, "NIK SALES")
		var nikKnown bool
		_ = tx.QueryRow(ctx, `select exists(select 1 from people_effective where nik=$1)`, nik).Scan(&nikKnown)
		if !nikKnown {
			originalNik := nik
			var cur string
			if e = tx.QueryRow(ctx, `select nik_sales from customers where kode_customer=$1`, cust).Scan(&cur); e != nil || cur == "" {
				return nil, nil, nil, fmt.Errorf("baris %d NIK SALES tidak dikenal & dealer tidak ditemukan", i+2)
			}
			nik = cur
			remaps[originalNik+" -> "+cur]++
		}
		qty, e := i64(txt(r, "QTY"))
		if e != nil || qty == 0 {
			return nil, nil, nil, fmt.Errorf("baris %d qty tidak valid", i+2)
		}
		fmt.Printf("DEBUG AMOUNT: formatted=%q raw=%q\n", txt(r, "AMOUNT"), txt(r, "AMOUNT_RAW"))
		amountText := txt(r, "AMOUNT_RAW")
		if amountText == "" {
			amountText = txt(r, "AMOUNT")
		}
		amount, e := num(amountText)
		if e != nil {
			return nil, nil, nil, fmt.Errorf("baris %d amount: %w", i+2, e)
		}
		if (qty < 0 && amount > 0) || (qty > 0 && amount < 0) {
			return nil, nil, nil, fmt.Errorf("baris %d tanda qty/amount tidak konsisten", i+2)
		}
		doc := txt(r, "NO TRANSAKSI")
		if doc == "" || cust == "" {
			return nil, nil, nil, fmt.Errorf("baris %d NO TRANSAKSI / KODE CUSTOMER kosong", i+2)
		}
		line := txt(r, "ID_BARIS")
		dupKey := ""
		if line != "" {
			dupKey = core.Key(txt(r, "BADAN USAHA"), doc, line)
		} else {
			dupKey = core.Key(d, txt(r, "BADAN USAHA"), doc, txt(r, "NOMOR SJ"), sku, cust, nik, qty, amount)
		}
		if seen[dupKey] {
			return nil, nil, nil, fmt.Errorf("baris transaksi duplikat %d. Jika baris sah terpisah, sertakan ID_BARIS unik", i+2)
		}
		seen[dupKey] = true
		region, e := routeRegion(ctx, tx, cust, nik)
		if e != nil {
			return nil, nil, nil, fmt.Errorf("baris %d: %w", i+2, e)
		}
		period := d[:7]
		if locked(ctx, tx, period) {
			return nil, nil, nil, fmt.Errorf("periode %s terkunci", period)
		}
		var fid any = nil
		if fileID != nil {
			fid = *fileID
		}
		_, e = tx.Exec(ctx, `insert into st_lines(tanggal,badan_usaha,no_transaksi,nomor_sj,kode_gudang,kode_produk,kode_customer,nik_sales,qty,amount,id_baris,ref_transaksi,region,source_file_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, d, txt(r, "BADAN USAHA"), txt(r, "NO TRANSAKSI"), txt(r, "NOMOR SJ"), txt(r, "KODE GUDANG"), sku, cust, nik, qty, amount, txt(r, "ID_BARIS"), txt(r, "REF_TRANSAKSI"), region, fid)
		if e != nil {
			return nil, nil, nil, fmt.Errorf("baris %d: %w", i+2, e)
		}
		periods[period] = true
		regions[region] = true
	}
	ps, rs := keys(periods), keys(regions)
	warnings := []string{}
	for k, n := range remaps {
		warnings = append(warnings, fmt.Sprintf("NIK tidak terdaftar diganti %s (%d baris)", k, n))
	}
	sort.Strings(warnings)
	return ps, rs, warnings, nil
}
func (im *Importer) appendSO(ctx context.Context, tx pgx.Tx, fileID *int64, rows []x.Row) ([]string, []string, error) {
	periods, regions := map[string]bool{}, map[string]bool{}
	for i, r := range rows {
		d, e := date(first(txt(r, "TANGGAL SO"), txt(r, "TANGGAL")))
		if e != nil {
			return nil, nil, fmt.Errorf("baris %d: %w", i+2, e)
		}
		if d < "2025-12-01" {
			return nil, nil, fmt.Errorf("baris %d SO sebelum baseline 2025-12-01", i+2)
		}
		cust := txt(r, "KODE CUSTOMER")
		region, e := routeRegion(ctx, tx, cust, "")
		if e != nil {
			return nil, nil, fmt.Errorf("baris %d: %w", i+2, e)
		}
		sku := txt(r, "KODE PRODUK")
		var exists bool
		if e = tx.QueryRow(ctx, `select exists(select 1 from products where kode_barang=$1)`, sku).Scan(&exists); e != nil || !exists {
			return nil, nil, fmt.Errorf("baris %d produk tidak dikenal: %s", i+2, sku)
		}
		qty, e := i64(txt(r, "QTY"))
		if e != nil || qty == 0 {
			return nil, nil, fmt.Errorf("baris %d qty tidak valid", i+2)
		}
		period := d[:7]
		if locked(ctx, tx, period) {
			return nil, nil, fmt.Errorf("periode %s terkunci", period)
		}
		var fid any = nil
		if fileID != nil {
			fid = *fileID
		}
		_, e = tx.Exec(ctx, `insert into so_lines(tanggal,kode_customer,kode_produk,qty,region,source_file_id) values($1,$2,$3,$4,$5,$6)`, d, cust, sku, qty, region, fid)
		if e != nil {
			return nil, nil, e
		}
		periods[period] = true
		regions[region] = true
	}
	ps, rs := keys(periods), keys(regions)
	return ps, rs, nil
}

func updateCoverage(ctx context.Context, tx pgx.Tx, kind string, periods, regions []string, fileID any) error {
	table := "st_lines"
	if kind == "SO" {
		table = "so_lines"
	}
	for _, p := range periods {
		for _, r := range regions {
			var cut string
			q := fmt.Sprintf("select coalesce(max(tanggal)::text,'') from %s where to_char(tanggal,'YYYY-MM')=$1 and region=$2", table)
			if err := tx.QueryRow(ctx, q, p, r).Scan(&cut); err != nil {
				return err
			}
			if cut == "" {
				_, _ = tx.Exec(ctx, `delete from coverage where period=$1 and region=$2 and kind=$3`, p, r, kind)
				continue
			}
			if _, err := tx.Exec(ctx, `insert into coverage(period,region,kind,cutoff,closed,source_file_id) values($1,$2,$3,$4,$5,$6) on conflict(period,region,kind) do update set cutoff=excluded.cutoff,closed=excluded.closed,source_file_id=excluded.source_file_id,upload_version=coverage.upload_version+1,updated_at=now()`, p, r, kind, cut, cut == core.End(p), fileID); err != nil {
				return err
			}
		}
	}
	return nil
}

func routeRegion(ctx context.Context, tx pgx.Tx, cust, nik string) (string, error) {
	var region string
	// Legacy RegionCore.route returns WILAYAH_KPI (Big Region), not the raw sub-region text.
	err := tx.QueryRow(ctx, `
select coalesce(
  nullif((select wilayah from customer_region_override where kode_customer=$1 order by berlaku_mulai desc limit 1),''),
  nullif(rc.wilayah_kpi,''),
  nullif(p.wilayah,''),
  ''
)
from customers c
left join regions rc on rc.region=c.region
left join people_effective p on p.nik=coalesce(nullif($2,''),c.nik_sales)
where c.kode_customer=$1`, cust, nik).Scan(&region)
	if err != nil || region == "" {
		return "", fmt.Errorf("dealer %s belum terpetakan ke region", cust)
	}
	return region, nil
}
func locked(ctx context.Context, tx pgx.Tx, p string) bool {
	var x bool
	_ = tx.QueryRow(ctx, `select coalesce((select terkunci from period_locks where period=$1),false)`, p).Scan(&x)
	return x
}
func rebuildDerived(ctx context.Context, tx pgx.Tx) error {
	if _, e := tx.Exec(ctx, `truncate st_daily,first_purchase,unlinked_returns`); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `insert into st_daily(tanggal,nik,kode_customer,brand,type,region,qty,amount,amount_accessory,docs)
select s.tanggal,s.nik_sales,s.kode_customer,p.brand,p.type,s.region,
       sum(case when p.masuk_qty then s.qty else 0 end)::bigint,
       round(sum(s.amount),2),round(sum(case when p.masuk_qty then 0 else s.amount end),2),
       jsonb_agg(distinct (s.badan_usaha||'|'||s.no_transaksi))
from st_lines s join products p on p.kode_barang=s.kode_produk group by 1,2,3,4,5,6`)
	if e != nil {
		return e
	}
	// Legacy first-purchase logic groups positive device lines by company+document+dealer+brand,
	// then applies linked returns (REF_TRANSAKSI) before choosing the first net-positive order.
	_, e = tx.Exec(ctx, `with positive_orders as (
  select s.kode_customer,p.brand,s.tanggal,min(s.nik_sales) nik_sales,s.badan_usaha,s.no_transaksi,sum(s.qty)::bigint qty
  from st_lines s join products p on p.kode_barang=s.kode_produk
  where p.masuk_qty=true and s.qty>0
  group by 1,2,3,5,6
), linked_returns as (
  select s.kode_customer,p.brand,s.badan_usaha,s.ref_transaksi,sum(s.qty)::bigint qty
  from st_lines s join products p on p.kode_barang=s.kode_produk
  where p.masuk_qty=true and s.qty<0 and coalesce(s.ref_transaksi,'')<>''
  group by 1,2,3,4
), net_orders as (
  select o.*, o.qty+coalesce(r.qty,0) net_qty
  from positive_orders o left join linked_returns r
    on r.kode_customer=o.kode_customer and r.brand=o.brand and r.badan_usaha=o.badan_usaha and r.ref_transaksi=o.no_transaksi
), ranked as (
  select *,row_number() over(partition by kode_customer,brand order by tanggal,no_transaksi,nik_sales) rn
  from net_orders where net_qty>0
)
insert into first_purchase(kode_customer,brand,tanggal,nik)
select kode_customer,brand,tanggal,nik_sales from ranked where rn=1`)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `with device_returns as (
  select s.*,p.brand from st_lines s join products p on p.kode_barang=s.kode_produk
  where p.masuk_qty=true and s.qty<0
), unmatched as (
  select r.* from device_returns r
  where coalesce(r.ref_transaksi,'')=''
     or not exists (
       select 1 from st_lines p0 join products pp on pp.kode_barang=p0.kode_produk
       where pp.masuk_qty=true and p0.qty>0
         and p0.kode_customer=r.kode_customer and pp.brand=r.brand
         and p0.badan_usaha=r.badan_usaha and p0.no_transaksi=r.ref_transaksi
     )
)
insert into unlinked_returns(kode_customer,brand,first_seen,last_seen,count_rows)
select kode_customer,brand,min(tanggal),max(tanggal),count(*) from unmatched group by 1,2`)
	return e
}
func splitList(s string) []string {
	a := []string{}
	for _, v := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '|' || r == ';' }) {
		v = strings.TrimSpace(v)
		if v != "" {
			a = append(a, v)
		}
	}
	return a
}
func first(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return strings.TrimSpace(a)
	}
	return strings.TrimSpace(b)
}
func keys(m map[string]bool) []string {
	o := []string{}
	for k := range m {
		o = append(o, k)
	}
	sort.Strings(o)
	return o
}
func HashReader(r io.Reader) (string, error) {
	h := sha256.New()
	if _, e := io.Copy(h, r); e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
