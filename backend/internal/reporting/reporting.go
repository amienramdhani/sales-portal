package reporting

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"salesportal/internal/core"
	"salesportal/internal/scope"
)

type Service struct {
	DB       *pgxpool.Pool
	Scope    *scope.Resolver
	Location *time.Location
}

type DashboardResult struct {
	Period            string           `json:"period"`
	Coverage          any              `json:"coverage"`
	PreviousPeriod    string           `json:"previousPeriod"`
	PreviousCutoff    string           `json:"previousCutoff"`
	PreviousAvailable bool             `json:"previousAvailable"`
	Total             core.Metrics     `json:"total"`
	Previous          core.Metrics     `json:"previous"`
	Brands            []any            `json:"brands"`
	BrandTotals       map[string]any   `json:"brandTotals"`
	RegionalKPI       []core.KPIResult `json:"regionalKpi"`
	RegionalBrands    []any            `json:"regionalBrands"`
	Daily             []any            `json:"daily"`
	Weekly            []any            `json:"weekly"`
	Customers         []any            `json:"customers"`
	Types             []any            `json:"types"`
	KPI               any              `json:"kpi"`
	Trend             []any            `json:"trend"`
	ScopeCount        int              `json:"scopeCount"`
	Processed         string           `json:"processed"`
	Version           string           `json:"version"`
	Partial           bool             `json:"partial"`
	NoData            bool             `json:"noData"`
}

func (s *Service) LoadCoreDB(ctx context.Context, periods []string) (*core.DB, error) {
	ppl, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	db := &core.DB{People: ppl, Customers: map[string]core.Customer{}, Products: map[string]core.Product{}, Rows: map[string][]core.DailyRow{}, Coverage: map[string]core.Coverage{}, First: map[string]core.FirstPurchase{}, Unlinked: map[string]bool{}}
	rows, err := s.DB.Query(ctx, `select kode_customer,id_dealer,nama_induk_customer,nama_customer,nik_sales,region,sub_region,kota,nama_pic,alamat,no_hp from customers where active=true`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c core.Customer
		var n1, n2 string
		if err := rows.Scan(&c.ID, &c.Alias, &n1, &n2, &c.NIK, &c.Region, &c.SubRegion, &c.City, &c.PIC, &c.Address, &c.Phone); err != nil {
			rows.Close()
			return nil, err
		}
		c.Name = n1
		if c.Name == "" {
			c.Name = n2
		}
		db.Customers[c.ID] = c
	}
	rows.Close()
	rows, err = s.DB.Query(ctx, `select kode_barang,nama_barang,source_brand,brand,type,masuk_qty from products`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p core.Product
		if err := rows.Scan(&p.ID, &p.Name, &p.SourceBrand, &p.Brand, &p.Type, &p.Device); err != nil {
			rows.Close()
			return nil, err
		}
		db.Products[p.ID] = p
	}
	rows.Close()
	args := []any{}
	where := ""
	if len(periods) > 0 {
		ph := []string{}
		for i, p := range periods {
			args = append(args, p)
			ph = append(ph, fmt.Sprintf("$%d", i+1))
		}
		where = " where period in (" + strings.Join(ph, ",") + ")"
	}
	rows, err = s.DB.Query(ctx, `select period,nik,brand,metric,indicator_id,value from targets`+where, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t core.Target
		var v *float64
		if err := rows.Scan(&t.Period, &t.NIK, &t.Brand, &t.Metric, &t.Indicator, &v); err != nil {
			rows.Close()
			return nil, err
		}
		if v != nil {
			t.Value = *v
			db.Targets = append(db.Targets, t)
		}
	}
	rows.Close()
	args = []any{}
	where = ""
	if len(periods) > 0 {
		ph := []string{}
		for i, p := range periods {
			args = append(args, p)
			ph = append(ph, fmt.Sprintf("$%d", i+1))
		}
		where = " where period in (" + strings.Join(ph, ",") + ")"
	}
	rows, err = s.DB.Query(ctx, `select period,wilayah,kelompok,metric,brand,bobot,batas_skor,indicator_id,label,type_filter,min_qty_da from kpi_policies`+where, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p core.Policy
		if err := rows.Scan(&p.Period, &p.Region, &p.Group, &p.Metric, &p.Brand, &p.Weight, &p.Cap, &p.Indicator, &p.Label, &p.Types, &p.MinDA); err != nil {
			rows.Close()
			return nil, err
		}
		p.MinNOO = 1
		if p.Metric == "NOO" && p.MinDA != 2 {
			p.MinNOO = p.MinDA
		}
		db.Policies = append(db.Policies, p)
	}
	rows.Close()
	args = []any{}
	where = ""
	if len(periods) > 0 {
		ph := []string{}
		for i, p := range periods {
			args = append(args, p)
			ph = append(ph, fmt.Sprintf("$%d", i+1))
		}
		where = " where period in (" + strings.Join(ph, ",") + ")"
	}
	rows, err = s.DB.Query(ctx, `select period,region,kind,cutoff::text,closed,upload_version from coverage`+where+` order by period,kind,region`, args...)
	if err != nil {
		return nil, err
	}
	type covAgg struct {
		cut    string
		closed bool
		ver    int64
	}
	cm := map[string]covAgg{}
	for rows.Next() {
		var p, r, k, cut string
		var cl bool
		var v int64
		if err := rows.Scan(&p, &r, &k, &cut, &cl, &v); err != nil {
			rows.Close()
			return nil, err
		}
		if k != "ST" {
			continue
		}
		a := cm[p]
		if a.cut == "" || cut < a.cut {
			a.cut = cut
		}
		if a.cut == "" {
			a.cut = cut
		}
		if len(cm) == 0 {
			a.closed = cl
		} else {
			a.closed = a.closed && cl
		}
		if v > a.ver {
			a.ver = v
		}
		cm[p] = a
	}
	rows.Close()
	for p, a := range cm {
		db.Coverage[p] = core.Coverage{Period: p, Cutoff: a.cut, Closed: a.closed, Version: a.ver}
	}
	args = []any{}
	where = ""
	if len(periods) > 0 {
		ph := []string{}
		for i, p := range periods {
			args = append(args, p)
			ph = append(ph, fmt.Sprintf("$%d", i+1))
		}
		where = " where to_char(tanggal,'YYYY-MM') in (" + strings.Join(ph, ",") + ")"
	}
	rows, err = s.DB.Query(ctx, `select d.tanggal::text,coalesce(a.new_nik,d.nik),d.kode_customer,d.brand,d.type,d.region,d.qty,d.amount::float8,d.amount_accessory::float8,d.docs from st_daily d left join nik_aliases a on a.old_nik=d.nik`+strings.ReplaceAll(where, "tanggal", "d.tanggal")+` order by d.tanggal`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r core.DailyRow
		var docsJSON []byte
		if err := rows.Scan(&r.Date, &r.NIK, &r.Customer, &r.Brand, &r.Type, &r.Region, &r.Qty, &r.Amount, &r.Accessory, &docsJSON); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(docsJSON, &r.Docs)
		db.Rows[r.Date[:7]] = append(db.Rows[r.Date[:7]], r)
	}
	rows.Close()
	rows, err = s.DB.Query(ctx, `select f.kode_customer,f.brand,f.tanggal::text,coalesce(a.new_nik,f.nik) from first_purchase f left join nik_aliases a on a.old_nik=f.nik`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c, b, d, n string
		if err := rows.Scan(&c, &b, &d, &n); err != nil {
			rows.Close()
			return nil, err
		}
		db.First[core.Key(c, b)] = core.FirstPurchase{Date: d, NIK: n}
	}
	rows.Close()
	rows, err = s.DB.Query(ctx, `select kode_customer,brand from unlinked_returns`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c, b string
		_ = rows.Scan(&c, &b)
		db.Unlinked[core.Key(c, b)] = true
	}
	rows.Close()
	return db, nil
}

func (s *Service) Dashboard(ctx context.Context, effective, period, selection string) (DashboardResult, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return DashboardResult{}, err
	}
	pp := core.Prev(period)
	months := []string{period, pp}
	for i := 0; i < 11; i++ {
		months = append(months, core.Prev(months[len(months)-1]))
	}
	db, err := s.LoadCoreDB(ctx, months)
	if err != nil {
		return DashboardResult{}, err
	}
	cov, ok := db.Coverage[period]
	if !ok {
		return DashboardResult{}, fmt.Errorf("Periode belum tersedia")
	}
	prevP, prevCut, prevAvail := core.ComparisonPeriod(db, period)
	cur := core.Slice(db, period, ids, "")
	prev := core.SliceCompare(db, prevP, ids, prevCut, period)
	total := core.CalculateMetrics(cur, db, period, "", 2, 1)
	previous := core.CalculateMetrics(prev, db, prevP, "", 2, 1)
	brandSet := map[string]bool{}
	for _, r := range cur {
		brandSet[r.Brand] = true
	}
	for _, t := range db.Targets {
		if t.Period == period && contains(ids, t.NIK) && t.Indicator == "" && t.Brand != "ALL" {
			brandSet[t.Brand] = true
		}
	}
	brands := keys(brandSet)
	brandRows := []any{}
	for _, b := range brands {
		tv, missing, exists := core.TargetFor(db, period, ids, b, "QTY", "")
		brandRows = append(brandRows, map[string]any{"brand": b, "current": core.CalculateMetrics(cur, db, period, b, 2, 1), "previous": core.CalculateMetrics(prev, db, prevP, b, 2, 1), "target": map[string]any{"value": tv, "missing": missing, "exists": exists}, "targetDA": targetContract(db, period, ids, b, "DA"), "targetNOO": targetContract(db, period, ids, b, "NOO")})
	}
	byDate := map[string][]core.DailyRow{}
	for _, r := range cur {
		byDate[r.Date] = append(byDate[r.Date], r)
	}
	daily := []any{}
	dates := keysRows(byDate)
	for _, d := range dates {
		m := core.CalculateMetrics(byDate[d], db, period, "", 2, 1)
		quantities := []int64{}
		for _, b := range brands {
			quantities = append(quantities, core.CalculateMetrics(byDate[d], db, period, b, 2, 1).Qty)
		}
		daily = append(daily, map[string]any{"date": d, "qty": m.Qty, "omzet": m.Revenue, "da": m.ActiveDealer, "noo": m.NOO, "outlets": m.Outlets, "brands": quantities})
	}
	weekly := []any{}
	for w := 1; w <= 5; w++ {
		rr := []core.DailyRow{}
		for _, r := range cur {
			day := 0
			fmt.Sscanf(r.Date[8:10], "%d", &day)
			ww := (day + 6) / 7
			if ww > 5 {
				ww = 5
			}
			if ww == w {
				rr = append(rr, r)
			}
		}
		m := core.CalculateMetrics(rr, db, period, "", 2, 1)
		weekly = append(weekly, map[string]any{"week": w, "qty": m.Qty, "omzet": m.Revenue, "da": m.ActiveDealer, "noo": m.NOO})
	}
	customers, err := s.customerSummary(ctx, db, ids, period, prevP, prevCut)
	if err != nil {
		return DashboardResult{}, err
	}
	typesMap := map[string]int64{}
	for _, r := range cur {
		if r.Qty != 0 {
			typesMap[r.Brand+"|"+r.Type] += r.Qty
		}
	}
	types := []any{}
	for k, v := range typesMap {
		z := strings.SplitN(k, "|", 2)
		types = append(types, map[string]any{"brand": z[0], "type": z[1], "qty": v})
	}
	sort.Slice(types, func(i, j int) bool { return fmt.Sprint(types[i]) < fmt.Sprint(types[j]) })
	regions := map[string]bool{}
	for _, p := range db.People {
		if contains(ids, p.NIK) && p.Sales && p.BigRegion != "" {
			regions[p.BigRegion] = true
		}
	}
	var kpi any = nil
	regionalKPI := []core.KPIResult{}
	regionalBrands := []any{}
	for _, region := range keys(regions) {
		team := []string{}
		for _, p := range db.People {
			if contains(ids, p.NIK) && p.BigRegion == region {
				team = append(team, p.NIK)
			}
		}
		regionalKPI = append(regionalKPI, core.KPI(db, period, team, region))
		for _, b := range brands {
			regionalBrands = append(regionalBrands, map[string]any{"region": region, "brand": b, "total": core.CalculateMetrics(core.Slice(db, period, team, ""), db, period, b, 2, 1), "target": targetContract(db, period, team, b, "QTY"), "targetDA": targetContract(db, period, team, b, "DA")})
		}
	}
	if len(regions) == 1 {
		for r := range regions {
			kpi = core.KPI(db, period, ids, r)
		}
	}
	trend := []any{}
	periodKeys := []string{}
	for p := range db.Coverage {
		if p <= period {
			periodKeys = append(periodKeys, p)
		}
	}
	sort.Strings(periodKeys)
	if len(periodKeys) > 12 {
		periodKeys = periodKeys[len(periodKeys)-12:]
	}
	for _, p := range periodKeys {
		cmpP, cmpCut, av := core.ComparisonPeriod(db, p)
		nowRows := core.SliceCompare(db, p, ids, "", period)
		if p == period {
			nowRows = core.Slice(db, p, ids, "")
		}
		m := core.CalculateMetrics(nowRows, db, p, "", 2, 1)
		var old *int64
		if av {
			bm := core.CalculateMetrics(core.SliceCompare(db, cmpP, ids, cmpCut, period), db, cmpP, "", 2, 1)
			x := bm.Qty
			old = &x
		}
		var growth *float64
		if old != nil && *old != 0 {
			x := (float64(m.Qty-*old) / float64(*old)) * 100
			growth = &x
		}
		trend = append(trend, map[string]any{"period": p, "qty": m.Qty, "previousQty": old, "growth": growth, "cutoff": db.Coverage[p].Cutoff, "closed": db.Coverage[p].Closed})
	}
	var version string
	_ = s.DB.QueryRow(ctx, `select value from schema_migrations_meta where key='data_version'`).Scan(&version)
	return DashboardResult{Period: period, Coverage: cov, PreviousPeriod: prevP, PreviousCutoff: prevCut, PreviousAvailable: prevAvail, Total: total, Previous: previous, Brands: brandRows, BrandTotals: combinedBrandTargets(brandRows), RegionalKPI: regionalKPI, RegionalBrands: regionalBrands, Daily: daily, Weekly: weekly, Customers: customers, Types: types, KPI: kpi, Trend: trend, ScopeCount: salesCount(db.People, ids), Processed: time.Now().In(s.Location).Format(time.RFC3339), Version: version, NoData: len(cur) == 0}, nil
}

func (s *Service) customerSummary(ctx context.Context, db *core.DB, ids []string, period, prevP, prevCut string) ([]any, error) {
	cur := core.Slice(db, period, ids, "")
	old := core.SliceCompare(db, prevP, ids, prevCut, period)
	histPeriods := []string{}
	for p := range db.Rows {
		if p <= period {
			histPeriods = append(histPeriods, p)
		}
	}
	all := []core.DailyRow{}
	for _, p := range histPeriods {
		all = append(all, core.Slice(db, p, ids, "")...)
	}
	codes := map[string]bool{}
	for id, c := range db.Customers {
		if contains(ids, c.NIK) {
			codes[id] = true
		}
	}
	for _, r := range all {
		codes[r.Customer] = true
	}
	gc := groupCustomer(cur)
	go1 := groupCustomer(old)
	gh := groupCustomer(all)
	cov := db.Coverage[period]
	brands := map[string]bool{}
	for _, r := range cur {
		brands[r.Brand] = true
	}
	brandList := keys(brands)
	out := []any{}
	for _, id := range keys(codes) {
		c := db.Customers[id]
		cr := gc[id]
		or := go1[id]
		hr := gh[id]
		last := ""
		periodSeen := map[string]bool{}
		net := map[string]int64{}
		for _, r := range hr {
			net[r.Date[:7]+"|"+r.Brand] += r.Qty
			if r.Qty > 0 && r.Date > last {
				last = r.Date
			}
		}
		for _, r := range hr {
			if r.Qty > 0 && net[r.Date[:7]+"|"+r.Brand] > 0 {
				periodSeen[r.Date[:7]] = true
			}
		}
		cm := core.CalculateMetrics(cr, db, period, "", 2, 1)
		status := "BELUM ORDER"
		if cm.Qty >= 2 {
			status = "AKTIF"
		} else if cm.Qty > 0 {
			status = "BELUM MINIMUM DA"
		} else if periodSeen[prevP] {
			status = "DA BULAN LALU"
		} else if len(periodSeen) == 0 {
			status = "BELUM ORDER"
		} else if periodSeen[core.Prev(prevP)] {
			status = "IDLE"
		} else {
			status = "PASIF"
		}
		var gap *int
		if last != "" {
			ld, _ := time.Parse("2006-01-02", last)
			cd, _ := time.Parse("2006-01-02", cov.Cutoff)
			x := int(cd.Sub(ld).Hours() / 24)
			gap = &x
		}
		br := []any{}
		for _, b := range brandList {
			br = append(br, map[string]any{"brand": b, "metrics": core.CalculateMetrics(cr, db, period, b, 2, 1)})
		}
		out = append(out, map[string]any{"id": id, "nama": first(c.Name, id), "nik": c.NIK, "region": c.Region, "subRegion": c.SubRegion, "kota": c.City, "alamat": c.Address, "hp": c.Phone, "status": status, "last": nullable(last), "jeda": gap, "current": cm, "previous": core.CalculateMetrics(or, db, prevP, "", 2, 1), "brands": br})
	}
	return out, nil
}

func (s *Service) DealerDetail(ctx context.Context, effective, period, selection, customer string) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period)})
	if err != nil {
		return nil, err
	}
	c, known := db.Customers[customer]
	allowed := known && contains(ids, c.NIK)
	hist := []core.DailyRow{}
	for _, rr := range db.Rows {
		for _, r := range rr {
			if r.Customer == customer && contains(ids, r.NIK) {
				hist = append(hist, r)
			}
		}
	}
	if !allowed && len(hist) == 0 {
		return nil, fmt.Errorf("Dealer tidak tersedia dalam cakupan Anda")
	}
	rows := []core.DailyRow{}
	for _, r := range db.Rows[period] {
		if r.Customer == customer && contains(ids, r.NIK) {
			rows = append(rows, r)
		}
	}
	current := core.CalculateMetrics(rows, db, period, "", 2, 1)
	last := ""
	for _, r := range hist {
		if r.Qty > 0 && r.Date > last {
			last = r.Date
		}
	}
	status := "BELUM ORDER"
	if current.Qty >= 2 {
		status = "AKTIF"
	} else if current.Qty > 0 {
		status = "BELUM MINIMUM DA"
	}
	brands := map[string]bool{}
	for _, p := range db.Products {
		brands[p.Brand] = true
	}
	br := []any{}
	for _, b := range keys(brands) {
		br = append(br, map[string]any{"brand": b, "metrics": core.CalculateMetrics(rows, db, period, b, 2, 1)})
	}
	return map[string]any{"id": customer, "nama": first(c.Name, customer), "alamat": c.Address, "kota": c.City, "region": c.Region, "subRegion": c.SubRegion, "hp": c.Phone, "last": nullable(last), "status": status, "current": current, "brands": br}, nil
}

func (s *Service) Transactions(ctx context.Context, effective, period, selection, customer, dateFrom, dateTo string, page, pageSize int) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 100
	}
	if pageSize > 200 {
		pageSize = 200
	}
	args := []any{ids, period}
	where := `s.nik_sales=any($1) and to_char(s.tanggal,'YYYY-MM')=$2`
	if customer != "" {
		args = append(args, customer)
		where += fmt.Sprintf(" and s.kode_customer=$%d", len(args))
	}
	if dateFrom != "" {
		args = append(args, dateFrom)
		where += fmt.Sprintf(" and s.tanggal>=$%d", len(args))
	}
	if dateTo != "" {
		args = append(args, dateTo)
		where += fmt.Sprintf(" and s.tanggal<=$%d", len(args))
	}
	var total int
	if err := s.DB.QueryRow(ctx, `select count(*) from st_lines s where `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	q := fmt.Sprintf(`select s.tanggal::text,s.badan_usaha,s.no_transaksi,s.nomor_sj,s.kode_produk,p.nama_barang,p.brand,p.type,s.kode_customer,c.nama_induk_customer,s.nik_sales,s.qty,s.amount::float8 from st_lines s join products p on p.kode_barang=s.kode_produk left join customers c on c.kode_customer=s.kode_customer where %s order by s.tanggal desc,s.no_transaksi,s.kode_produk limit $%d offset $%d`, where, len(args)-1, len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var d, co, doc, sj, sku, pn, b, t, cust, cn, nik string
		var qty int
		var amount float64
		if err := rows.Scan(&d, &co, &doc, &sj, &sku, &pn, &b, &t, &cust, &cn, &nik, &qty, &amount); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"date": d, "company": co, "doc": doc, "sj": sj, "sku": sku, "product": pn, "brand": b, "type": t, "customer": cust, "customerName": cn, "nik": nik, "qty": qty, "amount": amount})
	}
	return map[string]any{"rows": items, "page": page, "pageSize": pageSize, "total": total, "pages": (total + pageSize - 1) / pageSize}, nil
}

func (s *Service) Rank(ctx context.Context, effective, period, level string, national bool) ([]map[string]any, error) {
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	allowed, err := s.Scope.Allowed(ctx, effective, "ALL")
	if err != nil {
		return nil, err
	}
	allowedSet := set(allowed)
	candidates := []core.Person{}
	for _, p := range people {
		if strings.EqualFold(p.Role, level) && (national || allowedSet[p.NIK]) {
			candidates = append(candidates, p)
		}
	}
	db, err := s.LoadCoreDB(ctx, []string{period})
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, p := range candidates {
		ids := []string{p.NIK}
		if p.Role != "SALES" {
			ids, _ = core.Scope(people, p.NIK)
		}
		k := core.KPI(db, period, ids, p.BigRegion)
		groupScores := []map[string]any{}
		for _, g := range k.Groups {
			status := "Berlaku"
			if g.Pending {
				status = "Belum final"
			} else if g.Partial || k.Tentative {
				status = "Sementara"
			} else if g.NA {
				status = "Tidak diwajibkan"
			}
			groupScores = append(groupScores, map[string]any{"name": g.Name, "score": g.Score, "status": status})
		}
		vacant := strings.HasPrefix(strings.ToUpper(p.NIK), "VAC") || strings.HasPrefix(strings.ToUpper(p.Name), "VACANT")
		out = append(out, map[string]any{"nik": p.NIK, "nama": p.Name, "role": p.Role, "wilayah": p.BigRegion, "region": p.Region, "score": k.Score, "status": k.Status, "groups": k.Count, "groupScores": groupScores, "canOpen": p.NIK != "", "vacant": vacant})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i]["vacant"].(bool) != out[j]["vacant"].(bool) {
			return !out[i]["vacant"].(bool)
		}
		a, b := rankScore(out[i]), rankScore(out[j])
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		if *a != *b {
			return *a > *b
		}
		return fmt.Sprint(out[i]["nama"]) < fmt.Sprint(out[j]["nama"])
	})
	for i := range out {
		score := rankScore(out[i])
		if out[i]["vacant"].(bool) || score == nil {
			out[i]["rank"] = nil
			out[i]["top"] = false
			out[i]["bottom"] = false
			out[i]["achieved"] = false
		} else {
			rank, bottom := 1, 1
			for _, row := range out {
				other := rankScore(row)
				if row["vacant"].(bool) || other == nil {
					continue
				}
				if *other > *score {
					rank++
				}
				if *other < *score {
					bottom++
				}
			}
			out[i]["rank"] = rank
			out[i]["top"] = rank <= 3
			out[i]["bottom"] = bottom <= 3 && rank > 3
			out[i]["achieved"] = *score >= 90
		}
	}
	return out, nil
}

func rankScore(row map[string]any) *float64 {
	switch v := row["score"].(type) {
	case *float64:
		return v
	case float64:
		return &v
	default:
		return nil
	}
}

func (s *Service) DOS(ctx context.Context, effective, period, selection string, filter map[string]any, page int) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	pageSize := 100
	asOf := core.End(period)
	var stCut, soCut *time.Time
	_ = s.DB.QueryRow(ctx, `select min(cutoff) filter(where kind='ST'),min(cutoff) filter(where kind='SO') from coverage where period=$1`, period).Scan(&stCut, &soCut)
	if stCut == nil || soCut == nil {
		return map[string]any{"rows": []any{}, "missing": true}, nil
	}
	if soCut.Before(*stCut) {
		asOf = soCut.Format("2006-01-02")
	} else {
		asOf = stCut.Format("2006-01-02")
	}
	args := []any{ids, asOf, pageSize, (page - 1) * pageSize}
	q := `with st as (select s.kode_customer,s.kode_produk,sum(s.qty)::bigint q from st_lines s join products p on p.kode_barang=s.kode_produk join customers c on c.kode_customer=s.kode_customer where c.nik_sales=any($1) and p.masuk_qty=true and s.tanggal between date '2025-12-01' and $2::date group by 1,2), so as (select o.kode_customer,o.kode_produk,sum(o.qty)::bigint q from so_lines o join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and o.tanggal between date '2025-12-01' and $2::date group by 1,2), so30 as (select o.kode_customer,o.kode_produk,sum(o.qty)::bigint q from so_lines o join customers c on c.kode_customer=o.kode_customer where c.nik_sales=any($1) and o.tanggal between $2::date-29 and $2::date group by 1,2) select coalesce(st.kode_customer,so.kode_customer),coalesce(st.kode_produk,so.kode_produk),p.brand,p.type,coalesce(st.q,0)-coalesce(so.q,0) stock,coalesce(so30.q,0) sellout30 from st full join so using(kode_customer,kode_produk) left join so30 on so30.kode_customer=coalesce(st.kode_customer,so.kode_customer) and so30.kode_produk=coalesce(st.kode_produk,so.kode_produk) join products p on p.kode_barang=coalesce(st.kode_produk,so.kode_produk) order by 1,3,4 limit $3 offset $4`
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var c, sku, b, t string
		var stock, out int64
		if err := rows.Scan(&c, &sku, &b, &t, &stock, &out); err != nil {
			return nil, err
		}
		var dos any = nil
		status := "BELUM BERGERAK"
		if out > 0 {
			d := float64(stock) / (float64(out) / 30.0)
			dos = d
			if stock <= 0 {
				status = "HABIS"
			} else if d < 7 {
				status = "MENIPIS"
			} else if d > 45 {
				status = "STOK TINGGI"
			} else {
				status = "CUKUP"
			}
		} else if stock <= 0 {
			status = "HABIS"
		}
		items = append(items, map[string]any{"customer": c, "sku": sku, "brand": b, "type": t, "stock": stock, "sellout30": out, "dos": dos, "status": status})
	}
	return map[string]any{"asOf": asOf, "rows": items, "page": page, "pageSize": pageSize, "missing": false}, nil
}

// DealerStock mirrors the legacy mobile dealer stock endpoint using the same DOS baseline.
// It is intentionally customer-scoped and applies server-side scope before querying stock.
func (s *Service) DealerStock(ctx context.Context, effective, period, selection, customer string) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if customer == "" {
		return nil, fmt.Errorf("Dealer wajib dipilih")
	}
	// Legacy StockCore.canSee uses the current dealer owner; unowned dealers are only visible
	// when the caller has national scope. We keep the same conservative rule here.
	var owner string
	if err := s.DB.QueryRow(ctx, `select nik_sales from customers where kode_customer=$1 and active=true`, customer).Scan(&owner); err != nil {
		return nil, fmt.Errorf("Dealer tidak ditemukan")
	}
	allowed := false
	for _, id := range ids {
		if id == owner {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, fmt.Errorf("Dealer di luar cakupan")
	}

	var stCut, soCut *time.Time
	if err := s.DB.QueryRow(ctx, `select min(cutoff) filter(where kind='ST'),min(cutoff) filter(where kind='SO') from coverage where period=$1`, period).Scan(&stCut, &soCut); err != nil {
		return nil, err
	}
	if stCut == nil || soCut == nil {
		return map[string]any{"ready": false, "message": "Menunggu kelengkapan ST / SO.", "rows": []any{}}, nil
	}
	asOf := *stCut
	if soCut.Before(asOf) {
		asOf = *soCut
	}
	from := asOf.AddDate(0, 0, -29)

	var big string
	_ = s.DB.QueryRow(ctx, `select coalesce(r.wilayah_kpi,'') from customers c left join people_effective p on p.nik=c.nik_sales left join regions r on r.region=coalesce(nullif(p.portfolio,''),nullif(p.region,''),c.region) where c.kode_customer=$1`, customer).Scan(&big)
	var dosMin, dosMax float64
	if err := s.DB.QueryRow(ctx, `select dos_min::float8,dos_max::float8 from dos_config where wilayah=$1 or wilayah='ALL' order by (wilayah=$1) desc limit 1`, big).Scan(&dosMin, &dosMax); err != nil {
		dosMin, dosMax = 7, 45
	}

	q := `with st as (
	  select kode_produk,sum(qty)::bigint q from st_lines where kode_customer=$1 and tanggal between date '2025-12-01' and $2::date group by kode_produk
	), so as (
	  select kode_produk,sum(qty)::bigint q from so_lines where kode_customer=$1 and tanggal between date '2025-12-01' and $2::date group by kode_produk
	), so30 as (
	  select kode_produk,sum(qty)::bigint q from so_lines where kode_customer=$1 and tanggal between $3::date and $2::date group by kode_produk
	), sku as (
	  select coalesce(st.kode_produk,so.kode_produk) kode_produk,coalesce(st.q,0)-coalesce(so.q,0) stock,coalesce(so30.q,0) sellout
	  from st full join so using(kode_produk)
	  left join so30 on so30.kode_produk=coalesce(st.kode_produk,so.kode_produk)
	)
	select p.brand,coalesce(nullif(p.type,''),p.nama_barang),sum(sku.stock)::bigint,sum(sku.sellout)::bigint
	from sku join products p on p.kode_barang=sku.kode_produk
	where p.masuk_qty=true
	group by p.brand,coalesce(nullif(p.type,''),p.nama_barang)
	order by p.brand,coalesce(nullif(p.type,''),p.nama_barang)`
	rows, err := s.DB.Query(ctx, q, customer, asOf.Format("2006-01-02"), from.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var brand, typ string
		var stock, sellout int64
		if err := rows.Scan(&brand, &typ, &stock, &sellout); err != nil {
			return nil, err
		}
		avg := float64(sellout) / 30
		var dos any
		status := "BELUM BERGERAK"
		if stock <= 0 {
			if sellout > 0 {
				status = "HABIS"
			} else {
				status = "TIDAK AKTIF"
			}
		} else if avg > 0 {
			d := float64(stock) / avg
			dos = d
			if d < dosMin {
				status = "MENIPIS"
			} else if d > dosMax {
				status = "STOK TINGGI"
			} else {
				status = "CUKUP"
			}
		}
		items = append(items, map[string]any{"customer": customer, "brand": brand, "type": typ, "stock": stock, "sellout": sellout, "avg": avg, "dos": dos, "status": status})
	}
	return map[string]any{"ready": true, "message": "", "asof": asOf.Format("2006-01-02"), "stCut": stCut.Format("2006-01-02"), "soCut": soCut.Format("2006-01-02"), "rows": items}, nil
}

func groupCustomer(rows []core.DailyRow) map[string][]core.DailyRow {
	m := map[string][]core.DailyRow{}
	for _, r := range rows {
		m[r.Customer] = append(m[r.Customer], r)
	}
	return m
}
func contains(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func set(a []string) map[string]bool {
	m := map[string]bool{}
	for _, x := range a {
		m[x] = true
	}
	return m
}
func keys(m map[string]bool) []string {
	o := []string{}
	for k := range m {
		o = append(o, k)
	}
	sort.Strings(o)
	return o
}
func keysRows(m map[string][]core.DailyRow) []string {
	o := []string{}
	for k := range m {
		o = append(o, k)
	}
	sort.Strings(o)
	return o
}
func first(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func salesCount(p []core.Person, ids []string) int {
	m := set(ids)
	n := 0
	for _, x := range p {
		if m[x.NIK] && x.Sales {
			n++
		}
	}
	return n
}
