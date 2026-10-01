package api

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"salesportal/internal/auth"
	"salesportal/internal/core"
)

type exportGroup struct {
	Name, Big, Sub, RGM string
	IDs                 []string
}

func listParam(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		o := []string{}
		for _, z := range x {
			if t := strings.TrimSpace(fmt.Sprint(z)); t != "" {
				o = append(o, t)
			}
		}
		return o
	case string:
		if strings.TrimSpace(x) != "" {
			return []string{strings.TrimSpace(x)}
		}
	}
	return nil
}
func (s *Server) deviceBrands(ctx context.Context) ([]string, error) {
	rows, e := s.Reporting.DB.Query(ctx, `select distinct brand from products where masuk_qty=true and brand<>'' order by brand`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	o := []string{}
	for rows.Next() {
		var b string
		_ = rows.Scan(&b)
		o = append(o, b)
	}
	return o, rows.Err()
}
func (s *Server) selectedExportGroups(ctx context.Context, sess auth.Session, sel map[string]any) (string, []exportGroup, error) {
	people, e := s.Scope.People(ctx)
	if e != nil {
		return "", nil, e
	}
	allowed, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return "", nil, e
	}
	aset := map[string]bool{}
	for _, id := range allowed {
		aset[id] = true
	}
	sales := []core.Person{}
	for _, p := range people {
		if p.Sales && aset[p.NIK] {
			sales = append(sales, p)
		}
	}
	level := strings.ToUpper(strings.TrimSpace(fmt.Sprint(sel["level"])))
	if level == "" {
		level = "BIG"
	}
	if level != "BIG" && level != "SUB" {
		return "", nil, errors.New("Pilih Big Region atau Sub Region.")
	}
	rgmName := func(big string) string {
		a := []string{}
		for _, p := range people {
			if p.Role == "RGM" && strings.EqualFold(p.BigRegion, big) {
				a = append(a, p.Name)
			}
		}
		sort.Strings(a)
		if len(a) == 0 {
			return "—"
		}
		return strings.Join(a, ", ")
	}
	out := []exportGroup{}
	if level == "BIG" {
		bigs := listParam(sel["bigRegions"])
		if len(bigs) == 0 {
			set := map[string]bool{}
			for _, p := range sales {
				if p.BigRegion != "" {
					set[p.BigRegion] = true
				}
			}
			for b := range set {
				bigs = append(bigs, b)
			}
			sort.Strings(bigs)
		}
		for _, b := range bigs {
			ids := []string{}
			for _, p := range sales {
				if strings.EqualFold(p.BigRegion, b) {
					ids = append(ids, p.NIK)
				}
			}
			if len(ids) > 0 {
				out = append(out, exportGroup{Name: b, Big: b, RGM: rgmName(b), IDs: ids})
			}
		}
	} else {
		parent := strings.TrimSpace(fmt.Sprint(sel["parentBig"]))
		if parent == "" {
			return "", nil, errors.New("Pilih Big Region induk yang diizinkan.")
		}
		subs := listParam(sel["subRegions"])
		if len(subs) == 0 {
			set := map[string]bool{}
			for _, p := range sales {
				if strings.EqualFold(p.BigRegion, parent) {
					sub := p.Portfolio
					if sub == "" {
						sub = p.Region
					}
					if sub != "" {
						set[sub] = true
					}
				}
			}
			for v := range set {
				subs = append(subs, v)
			}
			sort.Strings(subs)
		}
		for _, sub := range subs {
			ids := []string{}
			for _, p := range sales {
				ps := p.Portfolio
				if ps == "" {
					ps = p.Region
				}
				if strings.EqualFold(p.BigRegion, parent) && ps == sub {
					ids = append(ids, p.NIK)
				}
			}
			if len(ids) > 0 {
				out = append(out, exportGroup{Name: sub, Big: parent, Sub: sub, RGM: rgmName(parent), IDs: ids})
			}
		}
	}
	if len(out) == 0 {
		return "", nil, errors.New("Tidak ada cakupan export dalam hak akses.")
	}
	return level, out, nil
}
func growth(now, prev float64) any {
	if prev == 0 {
		return float64(0)
	}
	v := now/prev - 1
	if v > 5 {
		v = 5
	}
	return v
}
func (s *Server) commonCutoff(ctx context.Context, period, kind string, groups []exportGroup) (string, error) {
	bigs := []string{}
	seen := map[string]bool{}
	for _, g := range groups {
		if !seen[g.Big] {
			seen[g.Big] = true
			bigs = append(bigs, g.Big)
		}
	}
	var t *time.Time
	e := s.Reporting.DB.QueryRow(ctx, `select min(c.cutoff) from coverage c left join regions r on r.region=c.region where c.period=$1 and c.kind=$2 and (c.region=any($3) or r.wilayah_kpi=any($3))`, period, kind, bigs).Scan(&t)
	if e != nil {
		return "", e
	}
	if t == nil {
		return "", nil
	}
	return t.Format("2006-01-02"), nil
}
func prevCut(period, cur string) string {
	if cur == "" {
		return ""
	}
	p := core.Prev(period)
	d := cur[8:10]
	end := core.End(p)[8:10]
	if d > end {
		d = end
	}
	return p + "-" + d
}
func (s *Server) targetSum(ctx context.Context, period string, ids []string, brand, metric string) (float64, error) {
	var n float64
	e := s.Reporting.DB.QueryRow(ctx, `select coalesce(sum(value),0)::float8 from targets where period=$1 and nik=any($2) and brand=$3 and metric=$4 and indicator_id=''`, period, ids, brand, metric).Scan(&n)
	return n, e
}
func (s *Server) soQty(ctx context.Context, ids []string, brand, from, to string) (float64, error) {
	var n float64
	e := s.Reporting.DB.QueryRow(ctx, `select coalesce(sum(o.qty),0)::float8 from so_lines o join products p on p.kode_barang=o.kode_produk join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and p.brand=$2 and p.masuk_qty=true and o.tanggal between $3::date and $4::date`, ids, brand, from, to).Scan(&n)
	return n, e
}
func (s *Server) brandMetricRow(ctx context.Context, db *core.DB, period, brand string, g exportGroup, stCut, soCut, prevStCut, prevSoCut string) (map[string]any, error) {
	prev := core.Prev(period)
	nowRows := core.Slice(db, period, g.IDs, stCut)
	prevRows := core.SliceCompare(db, prev, g.IDs, prevStCut, period)
	todayRows := []core.DailyRow{}
	for _, r := range nowRows {
		if r.Date == stCut {
			todayRows = append(todayRows, r)
		}
	}
	now := core.CalculateMetrics(nowRows, db, period, brand, 2, 1)
	before := core.CalculateMetrics(prevRows, db, prev, brand, 2, 1)
	today := core.CalculateMetrics(todayRows, db, period, brand, 2, 1)
	target, _ := s.targetSum(ctx, period, g.IDs, brand, "QTY")
	soNow, soToday, soPrev := float64(0), float64(0), float64(0)
	if soCut != "" {
		soNow, _ = s.soQty(ctx, g.IDs, brand, period+"-01", soCut)
		soToday, _ = s.soQty(ctx, g.IDs, brand, soCut, soCut)
	}
	if prevSoCut != "" {
		soPrev, _ = s.soQty(ctx, g.IDs, brand, prev+"-01", prevSoCut)
	}
	join := 0
	_ = s.Reporting.DB.QueryRow(ctx, `select count(distinct kode_customer) from st_daily where nik=any($1) and brand=$2 and tanggal<=$3::date and qty>0`, g.IDs, brand, stCut).Scan(&join)
	ach := float64(0)
	if target > 0 {
		ach = float64(now.Qty) / target
	}
	return map[string]any{"region": g.Name, "rgm": g.RGM, "target": target, "todayST": today.Qty, "mtdST": now.Qty, "lmtdST": before.Qty, "achv": ach, "growthST": growth(float64(now.Qty), float64(before.Qty)), "todayOmzet": today.Revenue, "mtdOmzet": now.Revenue, "lmtdOmzet": before.Revenue, "growthOmzet": growth(now.Revenue, before.Revenue), "dealerJoin": join, "todayDA": today.ActiveDealer, "mtdDA": now.ActiveDealer, "lmtdDA": before.ActiveDealer, "growthDA": growth(float64(now.ActiveDealer), float64(before.ActiveDealer)), "todaySO": soToday, "mtdSO": soNow, "lmtdSO": soPrev, "growthSO": growth(soNow, soPrev), "noo": now.NOO}, nil
}
func sumField(rows []map[string]any, key string) float64 {
	var n float64
	for _, r := range rows {
		switch v := r[key].(type) {
		case int:
			n += float64(v)
		case int64:
			n += float64(v)
		case float64:
			n += v
		}
	}
	return n
}
func (s *Server) brandTypeData(ctx context.Context, period, brand, cut string, groups []exportGroup) (map[string]any, error) {
	ids := []string{}
	for _, g := range groups {
		ids = append(ids, g.IDs...)
	}
	types := []string{}
	r, e := s.Reporting.DB.Query(ctx, `select distinct coalesce(nullif(type,''),nama_barang) from products where masuk_qty=true and brand=$1 order by 1`, brand)
	if e != nil {
		return nil, e
	}
	for r.Next() {
		var t string
		_ = r.Scan(&t)
		types = append(types, t)
	}
	r.Close()
	type row struct {
		typ    string
		st, so [5]float64
	}
	mm := map[string]*row{}
	for _, t := range types {
		mm[t] = &row{typ: t}
	}
	st, e := s.Reporting.DB.Query(ctx, `select coalesce(nullif(d.type,''),p.nama_barang),least(5,((extract(day from d.tanggal)::int-1)/7)+1)::int,sum(d.qty)::float8 from st_daily d join products p on p.brand=d.brand and coalesce(nullif(p.type,''),p.nama_barang)=coalesce(nullif(d.type,''),p.nama_barang) where d.nik=any($1) and d.brand=$2 and d.tanggal between $3::date and $4::date group by 1,2`, ids, brand, period+"-01", cut)
	if e == nil {
		for st.Next() {
			var t string
			var w int
			var n float64
			_ = st.Scan(&t, &w, &n)
			if mm[t] == nil {
				mm[t] = &row{typ: t}
				types = append(types, t)
			}
			mm[t].st[w-1] += n
		}
		st.Close()
	}
	so, e := s.Reporting.DB.Query(ctx, `select coalesce(nullif(p.type,''),p.nama_barang),least(5,((extract(day from o.tanggal)::int-1)/7)+1)::int,sum(o.qty)::float8 from so_lines o join products p on p.kode_barang=o.kode_produk join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and p.brand=$2 and p.masuk_qty=true and o.tanggal between $3::date and $4::date group by 1,2`, ids, brand, period+"-01", cut)
	if e == nil {
		for so.Next() {
			var t string
			var w int
			var n float64
			_ = so.Scan(&t, &w, &n)
			if mm[t] == nil {
				mm[t] = &row{typ: t}
				types = append(types, t)
			}
			mm[t].so[w-1] += n
		}
		so.Close()
	}
	sort.Strings(types)
	out := []map[string]any{}
	tst, tso := [5]float64{}, [5]float64{}
	for _, t := range types {
		x := mm[t]
		sa, oa := make([]float64, 5), make([]float64, 5)
		var ts, to float64
		for i := 0; i < 5; i++ {
			sa[i] = x.st[i]
			oa[i] = x.so[i]
			tst[i] += x.st[i]
			tso[i] += x.so[i]
			ts += x.st[i]
			to += x.so[i]
		}
		out = append(out, map[string]any{"type": t, "st": sa, "so": oa, "totalST": ts, "totalSO": to})
	}
	return map[string]any{"rows": out, "total": map[string]any{"st": tst[:], "so": tso[:], "totalST": sum5(tst), "totalSO": sum5(tso)}, "scopeLabel": strings.Join(groupNames(groups), ", "), "cutoff": cut}, nil
}
func sum5(a [5]float64) float64 {
	var n float64
	for _, x := range a {
		n += x
	}
	return n
}
func groupNames(g []exportGroup) []string {
	o := []string{}
	for _, x := range g {
		o = append(o, x.Name)
	}
	return o
}
func (s *Server) brandExportData(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "BRAND") {
		return nil, 403, errors.New("Izin export Brand tidak aktif")
	}
	period := str(p, "period")
	if _, e := core.Month(period); e != nil {
		return nil, 400, e
	}
	sel := mapval(p, "selection")
	level, groups, e := s.selectedExportGroups(ctx, sess, sel)
	if e != nil {
		return nil, 403, e
	}
	known, e := s.deviceBrands(ctx)
	if e != nil {
		return nil, 500, e
	}
	brands := listParam(sel["brands"])
	if len(brands) == 0 {
		brands = known
	}
	includeSummary := true
	if v, ok := sel["includeSummary"]; ok {
		includeSummary = fmt.Sprint(v) != "false"
	}
	includeType := true
	if v, ok := sel["includeType"]; ok {
		includeType = fmt.Sprint(v) != "false"
	}
	if !includeSummary && !includeType {
		return nil, 400, errors.New("Pilih minimal satu isi export.")
	}
	stCut, _ := s.commonCutoff(ctx, period, "ST", groups)
	soCut, _ := s.commonCutoff(ctx, period, "SO", groups)
	if stCut == "" {
		return nil, 400, errors.New("Data ST belum lengkap untuk region pilihan.")
	}
	prevSt := prevCut(period, stCut)
	prevSo := prevCut(period, soCut)
	db, e := s.Reporting.LoadCoreDB(ctx, []string{period, core.Prev(period)})
	if e != nil {
		return nil, 500, e
	}
	sheets := []map[string]any{}
	for _, b := range brands {
		sh := map[string]any{"brand": b}
		if includeSummary {
			rows := []map[string]any{}
			for _, g := range groups {
				x, e := s.brandMetricRow(ctx, db, period, b, g, stCut, soCut, prevSt, prevSo)
				if e != nil {
					return nil, 500, e
				}
				rows = append(rows, x)
			}
			total := map[string]any{"region": "GRAND TOTAL", "rgm": ""}
			for _, k := range []string{"target", "todayST", "mtdST", "lmtdST", "todayOmzet", "mtdOmzet", "lmtdOmzet", "dealerJoin", "todayDA", "mtdDA", "lmtdDA", "todaySO", "mtdSO", "lmtdSO", "noo"} {
				total[k] = sumField(rows, k)
			}
			if sumField(rows, "target") > 0 {
				total["achv"] = sumField(rows, "mtdST") / sumField(rows, "target")
			} else {
				total["achv"] = 0
			}
			total["growthST"] = growth(sumField(rows, "mtdST"), sumField(rows, "lmtdST"))
			total["growthOmzet"] = growth(sumField(rows, "mtdOmzet"), sumField(rows, "lmtdOmzet"))
			total["growthDA"] = growth(sumField(rows, "mtdDA"), sumField(rows, "lmtdDA"))
			total["growthSO"] = growth(sumField(rows, "mtdSO"), sumField(rows, "lmtdSO"))
			sh["summary"] = map[string]any{"rows": rows, "total": total}
		}
		if includeType {
			cut := stCut
			if soCut != "" && soCut < cut {
				cut = soCut
			}
			td, e := s.brandTypeData(ctx, period, b, cut, groups)
			if e != nil {
				return nil, 500, e
			}
			sh["type"] = td
		}
		sheets = append(sheets, sh)
	}
	return map[string]any{"name": "Brand-Report-" + period + "-" + level + ".xlsx", "period": period, "level": level, "parentBig": func() string {
		if level == "SUB" {
			return groups[0].Big
		}
		return ""
	}(), "stCut": stCut, "soCut": soCut, "prevPeriod": core.Prev(period), "prevStCut": prevSt, "prevSoCut": prevSo, "includeSummary": includeSummary, "includeType": includeType, "sheets": sheets}, 200, nil
}

func (s *Server) dosExportData(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "DOS") {
		return nil, 403, errors.New("Izin export DOS tidak aktif")
	}
	period := str(p, "period")
	sel := mapval(p, "selection")
	level, groups, e := s.selectedExportGroups(ctx, sess, sel)
	if e != nil {
		return nil, 403, e
	}
	brands := listParam(sel["brands"])
	if len(brands) == 0 {
		brands, _ = s.deviceBrands(ctx)
	}
	ids := []string{}
	for _, g := range groups {
		ids = append(ids, g.IDs...)
	}
	var stc, soc *time.Time
	_ = s.Reporting.DB.QueryRow(ctx, `select min(cutoff) filter(where kind='ST'),min(cutoff) filter(where kind='SO') from coverage where period=$1`, period).Scan(&stc, &soc)
	if stc == nil || soc == nil {
		return nil, 400, errors.New("Menunggu ST dan SO seluruh region dalam pilihan.")
	}
	asof := *stc
	if soc.Before(asof) {
		asof = *soc
	}
	from := asof.AddDate(0, 0, -29)
	people, _ := s.Scope.People(ctx)
	pm := map[string]core.Person{}
	for _, x := range people {
		pm[x.NIK] = x
	}
	sheets := []map[string]any{}
	for _, brand := range brands {
		types := []string{}
		tr, _ := s.Reporting.DB.Query(ctx, `select distinct coalesce(nullif(type,''),nama_barang) from products where brand=$1 and masuk_qty=true order by 1`, brand)
		if tr != nil {
			for tr.Next() {
				var t string
				_ = tr.Scan(&t)
				types = append(types, t)
			}
			tr.Close()
		}
		q, e := s.Reporting.DB.Query(ctx, `with st as (select s.kode_customer,coalesce(nullif(p.type,''),p.nama_barang) type,sum(s.qty)::bigint q from st_lines s join products p on p.kode_barang=s.kode_produk join customers c on c.kode_customer=s.kode_customer where c.nik_sales=any($1) and p.brand=$2 and p.masuk_qty=true and s.tanggal between date '2025-12-01' and $3::date group by 1,2), so as (select o.kode_customer,coalesce(nullif(p.type,''),p.nama_barang) type,sum(o.qty)::bigint q from so_lines o join products p on p.kode_barang=o.kode_produk join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and p.brand=$2 and p.masuk_qty=true and o.tanggal between date '2025-12-01' and $3::date group by 1,2), so30 as (select o.kode_customer,coalesce(nullif(p.type,''),p.nama_barang) type,sum(o.qty)::bigint q from so_lines o join products p on p.kode_barang=o.kode_produk join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and p.brand=$2 and p.masuk_qty=true and o.tanggal between $4::date and $3::date group by 1,2), u as (select coalesce(st.kode_customer,so.kode_customer) customer,coalesce(st.type,so.type) type,coalesce(st.q,0) st,coalesce(so.q,0) so,coalesce(st.q,0)-coalesce(so.q,0) stock,coalesce(so30.q,0) so30 from st full join so using(kode_customer,type) left join so30 on so30.kode_customer=coalesce(st.kode_customer,so.kode_customer) and so30.type=coalesce(st.type,so.type)) select u.customer,c.nama_induk_customer,c.nik_sales,u.type,u.st,u.so,u.stock,u.so30 from u join customers c on c.kode_customer=u.customer order by c.nama_induk_customer,u.customer,u.type`, ids, brand, asof.Format("2006-01-02"), from.Format("2006-01-02"))
		if e != nil {
			return nil, 500, e
		}
		by := map[string]map[string]any{}
		for q.Next() {
			var cid, name, nik, typ string
			var st, so, stock, so30 int64
			_ = q.Scan(&cid, &name, &nik, &typ, &st, &so, &stock, &so30)
			r := by[cid]
			if r == nil {
				p := pm[nik]
				asm := ""
				x := p
				seen := map[string]bool{}
				for x.NIK != "" && !seen[x.NIK] {
					seen[x.NIK] = true
					if x.Role == "ASM" {
						asm = x.Name
						break
					}
					x = pm[x.Supervisor]
				}
				r = map[string]any{"customer": cid, "nama": name, "sales": p.Name, "asm": asm, "region": p.BigRegion, "note": "", "types": []map[string]any{}}
				by[cid] = r
			}
			avg := float64(so30) / 30
			var dos any = nil
			if avg > 0 {
				dos = float64(stock) / avg
			}
			arr := r["types"].([]map[string]any)
			arr = append(arr, map[string]any{"type": typ, "st": st, "so": so, "stock": stock, "so30": so30, "dos": dos})
			r["types"] = arr
		}
		q.Close()
		rows := []map[string]any{}
		for _, r := range by {
			arr := r["types"].([]map[string]any)
			var st, so, stock, so30 float64
			for _, x := range arr {
				st += asFloat(x["st"])
				so += asFloat(x["so"])
				stock += asFloat(x["stock"])
				so30 += asFloat(x["so30"])
			}
			var dos any = nil
			if so30 > 0 {
				dos = stock / (so30 / 30)
			}
			r["total"] = map[string]any{"st": st, "so": so, "stock": stock, "so30": so30, "dos": dos}
			rows = append(rows, r)
		}
		sort.Slice(rows, func(i, j int) bool { return fmt.Sprint(rows[i]["nama"]) < fmt.Sprint(rows[j]["nama"]) })
		tb := []map[string]any{}
		cb := []map[string]any{}
		for _, t := range types {
			vals := []map[string]any{}
			for _, r := range rows {
				for _, x := range r["types"].([]map[string]any) {
					if x["type"] == t {
						vals = append(vals, x)
					}
				}
			}
			sum := sumDOS(vals)
			tb = append(tb, sum)
			cb = append(cb, map[string]any{"st": countDOS(vals, "st", 2), "so": countDOS(vals, "so", 1), "stock": countDOS(vals, "stock", 1), "so30": countDOS(vals, "so30", 1)})
		}
		allVals := []map[string]any{}
		for _, r := range rows {
			allVals = append(allVals, r["total"].(map[string]any))
		}
		sheets = append(sheets, map[string]any{"brand": brand, "types": types, "rows": rows, "totalByType": tb, "coverageByType": cb, "total": sumDOS(allVals), "coverage": map[string]any{"st": countDOS(allVals, "st", 2), "so": countDOS(allVals, "so", 1), "stock": countDOS(allVals, "stock", 1), "so30": countDOS(allVals, "so30", 1)}, "asof": asof.Format("2006-01-02"), "from": from.Format("2006-01-02"), "covered": true, "windowReady": true, "scopeLabel": strings.Join(groupNames(groups), ", ")})
	}
	return map[string]any{"name": "DOS-" + period + "-" + level + ".xlsx", "period": period, "level": level, "scopeLabel": strings.Join(groupNames(groups), ", "), "asof": asof.Format("2006-01-02"), "from": from.Format("2006-01-02"), "sheets": sheets}, 200, nil
}
func asFloat(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return 0
}
func sumDOS(vals []map[string]any) map[string]any {
	var st, so, stock, so30 float64
	for _, x := range vals {
		st += asFloat(x["st"])
		so += asFloat(x["so"])
		stock += asFloat(x["stock"])
		so30 += asFloat(x["so30"])
	}
	var dos any = nil
	if so30 > 0 {
		dos = stock / (so30 / 30)
	}
	return map[string]any{"st": st, "so": so, "stock": stock, "so30": so30, "dos": dos}
}
func countDOS(vals []map[string]any, key string, min float64) int {
	n := 0
	for _, x := range vals {
		if asFloat(x[key]) >= min {
			n++
		}
	}
	return n
}

func (s *Server) kpiExportData(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "KPI") {
		return nil, 403, errors.New("Izin export KPI tidak aktif")
	}
	period := str(p, "period")
	sel := mapval(p, "selection")
	rankGroup := str(sel, "rankGroup")
	if rankGroup == "" {
		rankGroup = "FINAL"
	}
	gr, _ := s.Reporting.DB.Query(ctx, `select distinct kelompok from kpi_policies where period=$1 order by kelompok`, period)
	groups := []string{}
	if gr != nil {
		for gr.Next() {
			var g string
			_ = gr.Scan(&g)
			groups = append(groups, g)
		}
		gr.Close()
	}
	people, e := s.Scope.People(ctx)
	if e != nil {
		return nil, 500, e
	}
	allowed, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	aset := map[string]bool{}
	for _, id := range allowed {
		aset[id] = true
	}
	db, e := s.Reporting.LoadCoreDB(ctx, []string{period})
	if e != nil {
		return nil, 500, e
	}
	regions := []string{}
	if sess.Role != "HEAD OF SALES" && sess.Role != "CHIEF OPERATING OFFICER" && sess.Role != "CHIEF COMMERCIAL OFFICER" && sess.Role != "BOARD OF DIRECTOR" {
		set := map[string]bool{}
		for _, x := range people {
			if aset[x.NIK] && x.BigRegion != "" {
				set[x.BigRegion] = true
			}
		}
		for x := range set {
			regions = append(regions, x)
		}
		sort.Strings(regions)
	}
	sheets := []map[string]any{}
	for _, big := range regions {
		salesRows := []map[string]any{}
		ids := []string{}
		for _, x := range people {
			if x.Sales && x.BigRegion == big && aset[x.NIK] {
				ids = append(ids, x.NIK)
				salesRows = append(salesRows, map[string]any{"nik": x.NIK, "nama": x.Name, "atasan": bossName(people, x), "subRegion": firstStr(x.Portfolio, x.Region), "acting": x.Role != "SALES", "kpi": core.KPI(db, period, []string{x.NIK}, big)})
			}
		}
		if len(ids) == 0 {
			continue
		}
		asmRows := []map[string]any{}
		if sess.Role != "ASM" {
			for _, x := range people {
				if x.Role == "ASM" && x.BigRegion == big && aset[x.NIK] {
					team, _ := core.Scope(people, x.NIK)
					keep := []string{}
					for _, id := range team {
						if containsID(ids, id) {
							keep = append(keep, id)
						}
					}
					asmRows = append(asmRows, map[string]any{"nik": x.NIK, "nama": x.Name, "atasan": bossName(people, x), "subRegion": firstStr(x.Portfolio, x.Region), "kpi": core.KPI(db, period, keep, big)})
				}
			}
		}
		var cutoff string
		_ = s.Reporting.DB.QueryRow(ctx, `select min(cutoff)::text from coverage where period=$1 and kind='ST'`, period).Scan(&cutoff)
		total := core.KPI(db, period, ids, big)
		sheets = append(sheets, map[string]any{"region": big, "scopeLabel": big, "cutoff": cutoff, "groups": kpiDefs(total), "salesRows": salesRows, "salesTotal": total, "asmRows": asmRows, "asmTotal": func() any {
			if len(asmRows) > 0 {
				return total
			}
			return nil
		}()})
	}
	ranking := sess.Role == "RGM" || sess.Role == "ADMIN" || sess.Role == "SUPER ADMIN" || sess.Role == "HEAD OF SALES" || sess.Role == "CHIEF OPERATING OFFICER" || sess.Role == "CHIEF COMMERCIAL OFFICER" || sess.Role == "BOARD OF DIRECTOR"
	rankingOnly := sess.Role == "HEAD OF SALES" || sess.Role == "CHIEF OPERATING OFFICER" || sess.Role == "CHIEF COMMERCIAL OFFICER" || sess.Role == "BOARD OF DIRECTOR"
	out := map[string]any{"name": "KPI-Report-" + period + ".xlsx", "period": period, "rankGroup": rankGroup, "groupNames": groups, "ranking": ranking, "rankingOnly": rankingOnly, "sheets": sheets}
	if ranking {
		rs, _ := s.Reporting.Rank(ctx, sess.EffectiveNIK, period, "SALES", true)
		ra, _ := s.Reporting.Rank(ctx, sess.EffectiveNIK, period, "ASM", true)
		out["rankingSales"] = map[string]any{"rows": rankExportRows(rs, groups), "cutoff": period + "-01"}
		out["rankingAsm"] = map[string]any{"rows": rankExportRows(ra, groups), "cutoff": period + "-01"}
	}
	return out, 200, nil
}
func containsID(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func firstStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func bossName(p []core.Person, x core.Person) string {
	for _, z := range p {
		if z.NIK == x.Supervisor {
			return z.Name
		}
	}
	return ""
}
func kpiDefs(k core.KPIResult) []map[string]any {
	o := []map[string]any{}
	for _, g := range k.Groups {
		inds := []map[string]any{}
		for _, i := range g.Indicators {
			inds = append(inds, map[string]any{"indicator": i.Indicator, "label": i.Label, "metric": i.Metric, "brand": i.Brand, "weight": i.Weight, "types": i.Types, "minDA": i.MinDA})
		}
		o = append(o, map[string]any{"name": g.Name, "indicators": inds})
	}
	return o
}
func rankExportRows(a []map[string]any, groups []string) []map[string]any {
	o := []map[string]any{}
	for _, r := range a {
		o = append(o, map[string]any{"nik": r["nik"], "nama": r["nama"], "region": r["wilayah"], "subRegion": r["region"], "atasan": "", "groupScores": make([]any, len(groups)), "final": r["score"], "status": r["status"], "rank": r["rank"], "highlight": ""})
	}
	return o
}

func (s *Server) exportSummary(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if !s.exportAllowed(ctx, sess, "SUMMARY") {
		return nil, 403, errors.New("Izin export Summary tidak aktif")
	}
	period := str(p, "period")
	d, e := s.Reporting.Dashboard(ctx, sess.EffectiveNIK, period, str(p, "selection"))
	if e != nil {
		return nil, code(e), e
	}
	headers := []string{"METRIK", "TARGET", "AKTUAL", "% ACHV", "PEMBANDING", "GROWTH %"}
	rows := [][]any{}
	target := func(br any, field string) float64 {
		m, ok := br.(map[string]any)
		if !ok {
			return 0
		}
		t, _ := m[field].(map[string]any)
		return asFloat(t["value"])
	}
	var totalTarget, totalDA, totalNOO float64
	for _, b := range d.Brands {
		totalTarget += target(b, "target")
		totalDA += target(b, "targetDA")
		totalNOO += target(b, "targetNOO")
	}
	ach := func(a, t float64) any {
		if t <= 0 {
			return nil
		}
		return a / t * 100
	}
	grow := func(a, b float64) any {
		if b == 0 {
			return nil
		}
		return (a - b) / b * 100
	}
	rows = append(rows, []any{"SELL THRU", totalTarget, d.Total.Qty, ach(float64(d.Total.Qty), totalTarget), d.Previous.Qty, grow(float64(d.Total.Qty), float64(d.Previous.Qty))}, []any{"DEALER AKTIF", totalDA, d.Total.ActiveDealer, ach(float64(d.Total.ActiveDealer), totalDA), d.Previous.ActiveDealer, grow(float64(d.Total.ActiveDealer), float64(d.Previous.ActiveDealer))}, []any{"NOO", totalNOO, d.Total.NOO, ach(float64(d.Total.NOO), totalNOO), d.Previous.NOO, grow(float64(d.Total.NOO), float64(d.Previous.NOO))}, []any{"OMZET", nil, d.Total.Revenue, nil, d.Previous.Revenue, grow(d.Total.Revenue, d.Previous.Revenue)})
	x, e := xlsxPayload("Summary-"+period+".xlsx", "Summary", headers, rows, []string{"PERIODE: " + period, "CAKUPAN: " + str(p, "selection")})
	return x, code(e), e
}
