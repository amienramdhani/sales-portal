package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"salesportal/internal/auth"
)

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

func (s *Server) requireAdmin(sess auth.Session) error {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return errors.New("khusus Admin")
	}
	return nil
}
func (s *Server) requireSuper(sess auth.Session) error {
	if sess.Role != "SUPER ADMIN" {
		return errors.New("khusus Super Admin")
	}
	return nil
}
func (s *Server) exportAllowed(ctx context.Context, sess auth.Session, kind string) bool {
	if sess.Role == "SUPER ADMIN" {
		return true
	}
	var ok bool
	_ = s.Reporting.DB.QueryRow(ctx, `select coalesce(aktif,false) from export_access where nik=$1 and upper(jenis_export)=upper($2)`, sess.EffectiveNIK, kind).Scan(&ok)
	return ok
}

func xlsxPayload(name, sheet string, headers []string, rows [][]any, notes []string) (map[string]any, error) {
	f := excelize.NewFile()
	defaultSheet := f.GetSheetName(0)
	if strings.TrimSpace(sheet) == "" {
		sheet = "Data"
	}
	if defaultSheet != sheet {
		_ = f.SetSheetName(defaultSheet, sheet)
	}
	row := 1
	if len(notes) > 0 {
		for _, n := range notes {
			_ = f.SetCellValue(sheet, fmt.Sprintf("A%d", row), n)
			row++
		}
		row++
	}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, row)
		_ = f.SetCellValue(sheet, cell, h)
	}
	headerRow := row
	row++
	for _, r := range rows {
		for i, v := range r {
			cell, _ := excelize.CoordinatesToCellName(i+1, row)
			_ = f.SetCellValue(sheet, cell, v)
		}
		row++
	}
	if len(headers) > 0 {
		last, _ := excelize.CoordinatesToCellName(len(headers), headerRow)
		style, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "FFFFFF", Family: "Calibri", Size: 11}, Fill: excelize.Fill{Type: "pattern", Color: []string{"10394E"}, Pattern: 1}, Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true}})
		_ = f.SetCellStyle(sheet, fmt.Sprintf("A%d", headerRow), last, style)
		_ = f.AutoFilter(sheet, fmt.Sprintf("A%d:%s", headerRow, last), []excelize.AutoFilterOptions{})
		_ = f.SetPanes(sheet, &excelize.Panes{Freeze: true, Split: false, YSplit: headerRow, TopLeftCell: fmt.Sprintf("A%d", headerRow+1), ActivePane: "bottomLeft"})
		for i := 1; i <= len(headers); i++ {
			col, _ := excelize.ColumnNumberToName(i)
			_ = f.SetColWidth(sheet, col, col, 18)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return map[string]any{"name": name, "mime": xlsxMime, "base64": base64.StdEncoding.EncodeToString(buf.Bytes())}, nil
}

func (s *Server) dealerTemplate(ctx context.Context, sess auth.Session) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	x, e := xlsxPayload("Template-Dealer-Baru.xlsx", "Template_Dealer", []string{"KODE CUSTOMER", "NAMA INDUK CUSTOMER", "NIK SALES", "ID_DEALER", "KOTA", "ALAMAT", "No. HP", "SUB REGION"}, nil, []string{"Simpan sebagai XLSX, lalu Admin > Tambah dealer > Periksa upload dealer."})
	return x, code(e), e
}
func (s *Server) regionImportTemplate(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	kind := strings.ToUpper(str(p, "kind"))
	switch kind {
	case "ST":
		x, e := xlsxPayload("Template-ST.xlsx", "Master_Transaksi", []string{"TANGGAL TRANSAKSI", "BADAN USAHA", "NO TRANSAKSI", "NOMOR SJ", "KODE GUDANG", "KODE PRODUK", "KODE CUSTOMER", "NIK SALES", "QTY", "AMOUNT"}, nil, []string{"Isi data sesuai scope Region + Brand yang dipilih di aplikasi.", "File harus lengkap dari tanggal 1 sampai cutoff untuk scope upload.", "Brand divalidasi dari KODE PRODUK terhadap Master_Product."})
		return x, code(e), e
	case "SO":
		x, e := xlsxPayload("Template-SO.xlsx", "Master_SO", []string{"KODE CUSTOMER", "TANGGAL SO", "KODE PRODUK", "QTY"}, nil, []string{"Isi data SELL OUT sesuai scope Region + Brand yang dipilih di aplikasi.", "Brand divalidasi dari KODE BARANG terhadap Master_Product."})
		return x, code(e), e
	default:
		return nil, 400, errors.New("Jenis data tidak valid.")
	}
}
func (s *Server) transferDealerTemplate(ctx context.Context, sess auth.Session) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	x, e := xlsxPayload("Template-Transfer-Dealer.xlsx", "Transfer_Dealer", []string{"KODE CUSTOMER", "NEW_SALES_NIK", "EFFECTIVE_DATE", "NOTE"}, [][]any{{"", "", "", ""}}, []string{"Satu file boleh berisi banyak Sales tujuan.", "EFFECTIVE_DATE format YYYY-MM-DD.", "KODE CUSTOMER dan NEW_SALES_NIK wajib valid.", "Transfer mengubah current owner dan menyimpan Dealer_Assignment_History; transaksi lama tidak diubah."})
	return x, code(e), e
}
func (s *Server) userTemplate(ctx context.Context, sess auth.Session) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	x, e := xlsxPayload("Template-User-Massal.xlsx", "Template_User", []string{"NIK", "NAMA", "POSISI", "REGION", "NIK_ATASAN", "WILAYAH_ADMIN"}, nil, nil)
	return x, code(e), e
}

func (s *Server) dealerDownloadAll(ctx context.Context, sess auth.Session) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	people, e := s.Scope.People(ctx)
	if e != nil {
		return nil, 500, e
	}
	allowed := map[string]bool{}
	if sess.Role == "SUPER ADMIN" {
		for _, p := range people {
			allowed[p.NIK] = true
		}
	} else {
		for _, p := range people {
			ok, _ := s.Scope.CanManage(ctx, sess.NIK, p.NIK)
			if ok {
				allowed[p.NIK] = true
			}
		}
	}
	q, e := s.Reporting.DB.Query(ctx, `select kode_customer,nama_induk_customer,nik_sales,id_dealer,kota,alamat,no_hp,sub_region,region,nama_customer,nama_pic from customers where active=true order by nama_induk_customer,kode_customer`)
	if e != nil {
		return nil, 500, e
	}
	defer q.Close()
	rows := [][]any{}
	for q.Next() {
		var id, nama, nik, dealer, kota, alamat, hp, sub, region, ncust, pic string
		_ = q.Scan(&id, &nama, &nik, &dealer, &kota, &alamat, &hp, &sub, &region, &ncust, &pic)
		if !allowed[nik] {
			continue
		}
		rows = append(rows, []any{id, nama, nik, dealer, kota, alamat, hp, sub, region, ncust, pic})
	}
	name := "Data-Dealer-" + time.Now().In(s.Reporting.Location).Format("20060102") + ".xlsx"
	x, e := xlsxPayload(name, "Master_Customer", []string{"KODE CUSTOMER", "NAMA INDUK CUSTOMER", "NIK SALES", "ID_DEALER", "KOTA", "ALAMAT", "No. HP", "SUB REGION", "REGION", "NAMA CUSTOMER", "NAMA PIC"}, rows, []string{"1 baris = 1 dealer/toko pada domain database v2.", "NIK SALES jangan diubah lewat file ini; gunakan Transfer Dealer.", "Format kode/NIK sebagai Teks supaya angka 0 di depan tidak hilang."})
	return x, code(e), e
}

func (s *Server) accountUsage(ctx context.Context, nik string) (map[string]any, error) {
	refs := []map[string]any{}
	checks := []struct{ sheet, what, sql string }{{"Master_Customer", "dealer", `select count(*) from customers where active=true and nik_sales=$1`}, {"Dealer_Assignment_History", "riwayat assignment", `select count(*) from customer_owner_history where nik_sales=$1`}, {"Admin_Access", "akses admin", `select count(*) from admin_regions where nik=$1`}, {"Export_Access", "izin export", `select count(*) from export_access where nik=$1`}, {"Target_Input", "target", `select count(*) from targets where nik=$1`}}
	for _, c := range checks {
		var n int
		if e := s.Reporting.DB.QueryRow(ctx, c.sql, nik).Scan(&n); e != nil {
			return nil, e
		}
		if n > 0 {
			refs = append(refs, map[string]any{"sheet": c.sheet, "what": c.what, "count": n})
		}
	}
	var tx int
	_ = s.Reporting.DB.QueryRow(ctx, `select count(*) from st_lines where nik_sales=$1`, nik).Scan(&tx)
	roles := []string{}
	rr, e := s.Reporting.DB.Query(ctx, `select posisi from people where nik=$1 order by id`, nik)
	if e == nil {
		for rr.Next() {
			var x string
			_ = rr.Scan(&x)
			roles = append(roles, x)
		}
		rr.Close()
	}
	return map[string]any{"refs": refs, "tx": tx, "roles": roles}, nil
}
func (s *Server) accountDeleteCheck(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireSuper(sess); e != nil {
		return nil, 403, e
	}
	nik := str(p, "nik")
	if nik == "" {
		return nil, 400, errors.New("NIK wajib")
	}
	u, e := s.accountUsage(ctx, nik)
	if e != nil {
		return nil, 500, e
	}
	var nama, role string
	_ = s.Reporting.DB.QueryRow(ctx, `select nama,effective_role from people_effective where nik=$1`, nik).Scan(&nama, &role)
	block := []string{}
	if nik == sess.NIK {
		block = append(block, "Tidak bisa menghapus akun sendiri.")
	}
	if role == "SUPER ADMIN" {
		var n int
		_ = s.Reporting.DB.QueryRow(ctx, `select count(*) from people_effective where effective_role='SUPER ADMIN'`).Scan(&n)
		if n < 2 {
			block = append(block, "Super Admin terakhir tidak bisa dihapus.")
		}
	}
	refs, _ := u["refs"].([]map[string]any)
	for _, r := range refs {
		sh := fmt.Sprint(r["sheet"])
		if sh != "Admin_Access" && sh != "Export_Access" {
			block = append(block, fmt.Sprintf("Masih punya %v %v (%s).", r["count"], r["what"], sh))
		}
	}
	if n := intFromAny(u["tx"]); n > 0 {
		block = append(block, fmt.Sprintf("Punya %d transaksi historis — nonaktifkan saja, jangan dihapus.", n))
	}
	return map[string]any{"nik": nik, "nama": nama, "refs": u["refs"], "tx": u["tx"], "block": block}, 200, nil
}
func (s *Server) accountMergePreview(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireSuper(sess); e != nil {
		return nil, 403, e
	}
	keep, drop := str(p, "keep"), str(p, "drop")
	if keep == "" || drop == "" || keep == drop {
		return nil, 400, errors.New("Pilih dua akun yang berbeda.")
	}
	var keepName, dropName, keepRole string
	if e := s.Reporting.DB.QueryRow(ctx, `select nama,effective_role from people_effective where nik=$1`, keep).Scan(&keepName, &keepRole); e != nil {
		return nil, 404, fmt.Errorf("Akun yang dipertahankan (%s) tidak ditemukan.", keep)
	}
	_ = s.Reporting.DB.QueryRow(ctx, `select nama from people_effective where nik=$1`, drop).Scan(&dropName)
	u, e := s.accountUsage(ctx, drop)
	if e != nil {
		return nil, 500, e
	}
	block := []string{}
	if drop == sess.NIK {
		block = append(block, "Tidak bisa menggabungkan akun yang sedang dipakai login.")
	}
	refs, _ := u["refs"].([]map[string]any)
	for _, r := range refs {
		if fmt.Sprint(r["sheet"]) == "Master_Customer" && keepRole != "SALES" {
			block = append(block, fmt.Sprintf("Akun %s memegang %v dealer, tapi %s bukan Sales. Transfer dealernya dulu atau pilih akun Sales.", drop, r["count"], keep))
		}
	}
	var clashes []string
	qr, e := s.Reporting.DB.Query(ctx, `select distinct a.period from targets a join targets b on a.period=b.period and a.brand=b.brand and a.metric=b.metric and a.indicator_id=b.indicator_id where a.nik=$1 and b.nik=$2 order by a.period`, drop, keep)
	if e == nil {
		for qr.Next() {
			var x string
			_ = qr.Scan(&x)
			clashes = append(clashes, x)
		}
		qr.Close()
	}
	if len(clashes) > 0 {
		block = append(block, "Target bulan "+strings.Join(clashes, ", ")+" ada di dua akun. Hapus salah satu di Target dulu.")
	}
	return map[string]any{"keep": keep, "keepName": keepName, "drop": drop, "dropName": dropName, "refs": u["refs"], "roles": u["roles"], "tx": u["tx"], "block": block}, 200, nil
}
func intFromAny(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	default:
		var n int
		fmt.Sscan(fmt.Sprint(v), &n)
		return n
	}
}

func (s *Server) dealerDeleteCheck(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	id := str(p, "uniq")
	block := []string{}
	var n int
	if e := s.Reporting.DB.QueryRow(ctx, `select count(*) from st_lines where kode_customer=$1`, id).Scan(&n); e == nil && n > 0 {
		block = append(block, fmt.Sprintf("Dealer punya %d baris transaksi historis.", n))
	}
	var n2 int
	_ = s.Reporting.DB.QueryRow(ctx, `select count(*) from so_lines where kode_customer=$1`, id).Scan(&n2)
	if n2 > 0 {
		block = append(block, fmt.Sprintf("Dealer punya %d baris SELL OUT historis.", n2))
	}
	var open int
	_ = s.Reporting.DB.QueryRow(ctx, `select count(*) from customer_contact_requests where kode_customer=$1 and status='PENGAJUAN'`, id).Scan(&open)
	if open > 0 {
		block = append(block, "Masih ada pengajuan perubahan kontak yang belum diproses.")
	}
	return map[string]any{"block": block}, 200, nil
}
func (s *Server) dealerIndukPeek(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	uniq, baru := str(p, "uniq"), str(p, "baru")
	var lama string
	if e := s.Reporting.DB.QueryRow(ctx, `select kode_customer from customers where kode_customer=$1`, uniq).Scan(&lama); e != nil { // normalized schema uses unique customer code as the stable id
		lama = uniq
	}
	from := []string{}
	q, _ := s.Reporting.DB.Query(ctx, `select kode_customer from customers where nama_induk_customer=(select nama_induk_customer from customers where kode_customer=$1) order by kode_customer`, uniq)
	if q != nil {
		for q.Next() {
			var x string
			_ = q.Scan(&x)
			from = append(from, x)
		}
		q.Close()
	}
	existsToko := []string{}
	var namaBaru string
	q, _ = s.Reporting.DB.Query(ctx, `select kode_customer,nama_induk_customer from customers where kode_customer=$1 or id_dealer=$1 order by kode_customer`, baru)
	if q != nil {
		for q.Next() {
			var x, n string
			_ = q.Scan(&x, &n)
			existsToko = append(existsToko, x)
			if namaBaru == "" {
				namaBaru = n
			}
		}
		q.Close()
	}
	return map[string]any{"err": "", "lama": lama, "baru": baru, "toko": from, "exists": len(existsToko), "existsToko": existsToko, "namaBaru": namaBaru}, 200, nil
}

func (s *Server) userPinExport(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	gen := boolval(p, "gen")
	if gen && s.Cfg.ParallelMode {
		return nil, 409, errors.New("Mode paralel: PIN sementara tetap dibuat dari Apps Script")
	}
	people, e := s.Scope.People(ctx)
	if e != nil {
		return nil, 500, e
	}
	out := map[string]any{}
	made := 0
	for _, person := range people {
		if sess.Role != "SUPER ADMIN" {
			ok, _ := s.Scope.CanManage(ctx, sess.NIK, person.NIK)
			if !ok {
				continue
			}
		}
		var hash string
		var active, must bool
		err := s.Reporting.DB.QueryRow(ctx, `select pin_hash,aktif,wajib_ganti from auth_accounts where nik=$1`, person.NIK).Scan(&hash, &active, &must)
		status := "BELUM ADA PIN"
		if err == nil {
			if !active && hash != "" {
				status = "NONAKTIF"
			} else if hash == "" {
				status = "BELUM ADA PIN"
			} else if must {
				status = "SEMENTARA (BELUM LOGIN)"
			} else {
				status = "SUDAH DIGANTI"
			}
		}
		pin := ""
		if gen && (status == "BELUM ADA PIN" || status == "SEMENTARA (BELUM LOGIN)") {
			pin, e = s.Auth.ResetPIN(ctx, person.NIK)
			if e != nil {
				return nil, 500, e
			}
			status = "SEMENTARA (BELUM LOGIN)"
			made++
		}
		out[person.NIK] = map[string]any{"status": status, "pin": pin}
	}
	return map[string]any{"users": out, "made": made}, 200, nil
}

func (s *Server) dealerRegionSave(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireSuper(sess); e != nil {
		return nil, 403, e
	}
	reason := str(p, "reason")
	if len(reason) < 5 {
		return nil, 400, errors.New("Isi alasan minimal 5 karakter.")
	}
	op := mapval(p, "op")
	add := mapval(op, "add")
	id, big, date := str(add, "dealer"), str(add, "big"), str(add, "date")
	if id == "" || big == "" || date == "" {
		return nil, 400, errors.New("Dealer, Big Region, dan tanggal wajib.")
	}
	if _, e := time.Parse("2006-01-02", date); e != nil {
		return nil, 400, errors.New("Tanggal berlaku wajib (YYYY-MM-DD).")
	}
	var exists bool
	_ = s.Reporting.DB.QueryRow(ctx, `select exists(select 1 from customers where kode_customer=$1)`, id).Scan(&exists)
	if !exists {
		return nil, 404, fmt.Errorf("Dealer %s tidak ditemukan.", id)
	}
	var bigExists bool
	_ = s.Reporting.DB.QueryRow(ctx, `select exists(select 1 from regions where upper(wilayah_kpi)=upper($1))`, big).Scan(&bigExists)
	if !bigExists {
		return nil, 400, fmt.Errorf("Big Region %s tidak ada di Region Map.", big)
	}
	tx, e := s.Reporting.DB.Begin(ctx)
	if e != nil {
		return nil, 500, e
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `insert into customer_region_override(kode_customer,wilayah,berlaku_mulai) values($1,$2,$3) on conflict(kode_customer,berlaku_mulai) do update set wilayah=excluded.wilayah`, id, big, date)
	if e == nil {
		_, e = tx.Exec(ctx, `insert into audit_log(nik,aksi,keterangan,data) values($1,'DEALER_REGION',$2,jsonb_build_object('dealer',$3,'big',$4,'date',$5))`, sess.NIK, reason, id, big, date)
	}
	if e == nil {
		_, e = tx.Exec(ctx, `update schema_migrations_meta set value=((value::bigint)+1)::text,updated_at=now() where key='data_version'`)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		return nil, 500, e
	}
	return map[string]any{"ok": true, "msg": id + " → " + big + " mulai " + date}, 200, nil
}

// dealerExportData returns the legacy browser-side XLSX contract; workbook rendering stays in the exact legacy UI.
func (s *Server) dealerExportData(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "DEALER") {
		return nil, 403, errors.New("Izin export Dealer tidak aktif")
	}
	from, to := str(p, "from"), str(p, "to")
	if from == "" {
		from = time.Now().In(s.Reporting.Location).Format("2006-01")
	}
	if to == "" {
		to = from
	}
	filter := mapval(p, "filter")
	filter["pageSize"] = 200
	// Re-use history calculation and fetch all pages.
	first, e := s.Reporting.DealerHistory(ctx, sess.EffectiveNIK, str(p, "selection"), "ALL", from, to, 0, str(filter, "query"), filter)
	if e != nil {
		return nil, code(e), e
	}
	total := intFromAny(first["total"])
	rows := []map[string]any{}
	for pg := 0; pg*200 < total; pg++ {
		x, e := s.Reporting.DealerHistory(ctx, sess.EffectiveNIK, str(p, "selection"), "ALL", from, to, pg, str(filter, "query"), filter)
		if e != nil {
			return nil, code(e), e
		}
		if a, ok := x["rows"].([]map[string]any); ok {
			rows = append(rows, a...)
		}
	}
	brands := anyStringSlice(first["displayBrands"])
	if len(brands) == 0 {
		brands = anyStringSlice(first["brands"])
	}
	out := []map[string]any{}
	for _, r := range rows {
		metrics := map[string]any{}
		bm, _ := r["brandMetrics"].(map[string]any)
		for _, b := range brands {
			x, _ := bm[b].(map[string]any)
			metrics[b] = map[string]any{"st": lastAnySlice(x["st"]), "so": lastAnySlice(x["so"]), "omzet": lastAnySlice(x["omzet"])}
		}
		promStatus, promDetail := promText(r["promotor"], r["promFocus"])
		grade := gradeMap(r["grade"])
		out = append(out, map[string]any{"id": r["id"], "nama": r["nama"], "kota": "", "asm": r["asm"], "sales": r["sales"], "region": r["region"], "subregion": r["subregion"], "status": "AKTIF", "last": "", "metrics": metrics, "totalST": r["totalST"], "totalSO": r["totalSO"], "totalOmzet": r["totalOmzet"], "promStatus": promStatus, "promDetail": promDetail, "grade": grade})
	}
	gradeBrands := []string{}
	gr, _ := s.Reporting.DB.Query(ctx, `select distinct brand from customer_grades order by brand`)
	if gr != nil {
		for gr.Next() {
			var b string
			_ = gr.Scan(&b)
			gradeBrands = append(gradeBrands, b)
		}
		gr.Close()
	}
	filters := filter
	filters["from"], filters["to"], filters["count"], filters["scope"] = from, to, len(out), str(p, "selection")
	filters["regions"] = first["regions"]
	return map[string]any{"name": "Daftar-Dealer-" + from + "-" + to + ".xlsx", "brands": brands, "gradeBrands": gradeBrands, "months": first["months"], "rows": out, "filters": filters}, 200, nil
}
func anyStringSlice(v any) []string {
	if x, ok := v.([]string); ok {
		return x
	}
	if a, ok := v.([]any); ok {
		o := []string{}
		for _, z := range a {
			o = append(o, fmt.Sprint(z))
		}
		return o
	}
	return nil
}
func lastAnySlice(v any) any {
	if a, ok := v.([]any); ok && len(a) > 0 {
		return a[len(a)-1]
	}
	return nil
}
func promText(v any, focus any) (string, string) {
	if focus == true {
		return "BER-PROMOTOR", fmt.Sprint(v)
	}
	if v != nil {
		return "BER-PROMOTOR", fmt.Sprint(v)
	}
	return "-", ""
}
func gradeMap(v any) map[string]any {
	if m, ok := v.(map[string]string); ok {
		o := map[string]any{}
		for k, x := range m {
			o[k] = x
		}
		return o
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func (s *Server) exportDealerHistory(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "DEALER_HISTORY") && !s.exportAllowed(ctx, sess, "DEALER") {
		return nil, 403, errors.New("Izin export History Dealer tidak aktif")
	}
	filters := mapval(p, "filters")
	filters["pageSize"] = 200
	first, e := s.Reporting.DealerHistory(ctx, sess.EffectiveNIK, str(p, "selection"), str(p, "brand"), str(p, "from"), str(p, "to"), 0, str(p, "query"), filters)
	if e != nil {
		return nil, code(e), e
	}
	total := intFromAny(first["total"])
	rows := []map[string]any{}
	for pg := 0; pg*200 < total; pg++ {
		x, e := s.Reporting.DealerHistory(ctx, sess.EffectiveNIK, str(p, "selection"), str(p, "brand"), str(p, "from"), str(p, "to"), pg, str(p, "query"), filters)
		if e != nil {
			return nil, code(e), e
		}
		if a, ok := x["rows"].([]map[string]any); ok {
			rows = append(rows, a...)
		}
	}
	level := str(filters, "summaryLevel")
	summary, e := s.Reporting.DealerHistorySummary(ctx, sess.EffectiveNIK, str(p, "selection"), str(p, "brand"), str(p, "from"), str(p, "to"), str(p, "query"), filters, level)
	if e != nil {
		return nil, code(e), e
	}
	// Shape rows for the new legacy renderer while keeping the raw matrix data too.
	result := map[string]any{}
	for k, v := range first {
		result[k] = v
	}
	result["rows"] = rows
	result["summary"] = summary
	result["name"] = "History-Dealer-" + str(p, "from") + "-" + str(p, "to") + ".xlsx"
	ff := result["filters"].(map[string]any)
	ff["scope"] = str(p, "selection")
	ff["count"] = len(rows)
	ff["exportBrands"] = anyStringSlice(filters["exportBrands"])
	return result, 200, nil
}

func (s *Server) exportDealerCSV(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	// Legacy endpoint is currently a compatibility fallback; return the same dealer dataset in a JSON-friendly contract.
	return s.dealerExportData(ctx, sess, map[string]any{"selection": str(p, "selection"), "from": str(p, "period"), "to": str(p, "period"), "filter": mapval(p, "filter")})
}

func sortedMapKeys(m map[string]any) []string {
	o := make([]string, 0, len(m))
	for k := range m {
		o = append(o, k)
	}
	sort.Strings(o)
	return o
}
func encodeBytes(name, mime string, b []byte) map[string]any {
	return map[string]any{"name": name, "mime": mime, "base64": base64.StdEncoding.EncodeToString(b)}
}
func bufferPayload(name string, b *bytes.Buffer) map[string]any {
	return encodeBytes(name, xlsxMime, b.Bytes())
}
