package reporting

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"salesportal/internal/core"
)

// Range mirrors the legacy comparison range object.
type Range struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Label   string `json:"label"`
	Running bool   `json:"running,omitempty"`
}

func textAny(v any) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(v))
}
func upperAny(v any) string { return strings.ToUpper(textAny(v)) }
func intAny(v any, d int) int {
	s := textAny(v)
	if s == "" {
		return d
	}
	if i := strings.IndexByte(s, '.'); i >= 0 {
		s = s[:i]
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return d
	}
	return n
}
func listAny(v any) []string {
	if v == nil {
		return nil
	}
	if a, ok := v.([]string); ok {
		return a
	}
	if a, ok := v.([]any); ok {
		o := make([]string, 0, len(a))
		for _, x := range a {
			s := textAny(x)
			if s != "" {
				o = append(o, s)
			}
		}
		return o
	}
	if s := textAny(v); s != "" {
		return []string{s}
	}
	return nil
}
func inStrings(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func uniqueSorted(a []string) []string {
	m := map[string]bool{}
	for _, x := range a {
		if strings.TrimSpace(x) != "" {
			m[x] = true
		}
	}
	o := make([]string, 0, len(m))
	for x := range m {
		o = append(o, x)
	}
	sort.Strings(o)
	return o
}
func previousN(period string, n int) string {
	p := period
	for i := 0; i < n; i++ {
		p = core.Prev(p)
	}
	return p
}
func shiftDate(iso string, days int) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}
func monthLabel(period string) string {
	months := []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
	if len(period) != 7 {
		return period
	}
	m, _ := strconv.Atoi(period[5:7])
	if m < 1 || m > 12 {
		return period
	}
	return months[m-1] + " " + period[2:4]
}
func compareRanges(period, cutoff string, closed bool, mode string, weekA, weekB int) (Range, Range) {
	mode = strings.ToUpper(mode)
	prev := core.Prev(period)
	prevEnd := core.End(prev)
	end := core.End(period)
	if mode == "WTD" {
		t, _ := time.Parse("2006-01-02", cutoff)
		dow := (int(t.Weekday()) + 6) % 7 // Monday = 0
		m0 := shiftDate(cutoff, -dow)
		return Range{From: m0, To: cutoff, Label: "Minggu ini"}, Range{From: shiftDate(m0, -7), To: shiftDate(cutoff, -7), Label: "Minggu lalu"}
	}
	if mode == "WK" {
		wk := func(w int) Range {
			if w < 1 {
				w = 1
			}
			if w > 5 {
				w = 5
			}
			fromDay := (w-1)*7 + 1
			last, _ := strconv.Atoi(end[8:10])
			toDay := w * 7
			if w == 5 || toDay > last {
				toDay = last
			}
			if fromDay > last {
				fromDay = last
			}
			r := Range{From: fmt.Sprintf("%s-%02d", period, fromDay), To: fmt.Sprintf("%s-%02d", period, toDay), Label: fmt.Sprintf("W%d", w)}
			if !closed && r.To > cutoff {
				r.To = cutoff
				r.Running = true
			}
			return r
		}
		if weekA == 0 {
			weekA = 2
		}
		if weekB == 0 {
			weekB = 1
		}
		return wk(weekA), wk(weekB)
	}
	if mode == "MOM" {
		pa := prev
		if closed {
			pa = period
		}
		pb := core.Prev(pa)
		return Range{From: pa + "-01", To: core.End(pa), Label: monthLabel(pa)}, Range{From: pb + "-01", To: core.End(pb), Label: monthLabel(pb)}
	}
	day := cutoff[8:10]
	bto := prev + "-" + day
	if bto > prevEnd {
		bto = prevEnd
	}
	if closed {
		bto = prevEnd
	}
	return Range{From: period + "-01", To: cutoff, Label: "MTD"}, Range{From: prev + "-01", To: bto, Label: "LMTD"}
}

func personMap(people []core.Person) map[string]core.Person {
	m := map[string]core.Person{}
	for _, p := range people {
		m[p.NIK] = p
	}
	return m
}
func ancestor(pm map[string]core.Person, nik, role string) (core.Person, bool) {
	seen := map[string]bool{}
	for i := 0; i < 12 && nik != "" && !seen[nik]; i++ {
		seen[nik] = true
		p, ok := pm[nik]
		if !ok {
			return core.Person{}, false
		}
		if p.Role == role {
			return p, true
		}
		nik = p.Supervisor
	}
	return core.Person{}, false
}
func rowGroupKey(pm map[string]core.Person, nik, level string) string {
	if level == "SALES" {
		return nik
	}
	if p, ok := ancestor(pm, nik, level); ok {
		return p.NIK
	}
	return "~" + level
}
func rowsForRange(db *core.DB, period, selected string, ids []string, r Range) []core.DailyRow {
	months := []string{r.From[:7]}
	if r.To[:7] != months[0] {
		months = append(months, r.To[:7])
	}
	out := []core.DailyRow{}
	for _, p := range months {
		var rr []core.DailyRow
		if p == selected {
			rr = core.Slice(db, p, ids, "")
		} else {
			rr = core.SliceCompare(db, p, ids, "", selected)
		}
		for _, x := range rr {
			if x.Date >= r.From && x.Date <= r.To {
				out = append(out, x)
			}
		}
	}
	return out
}

// Compare ports the legacy apiCompare data model. It intentionally returns raw numbers;
// presentation rounding remains a frontend concern exactly like the Apps Script version.
func (s *Service) Compare(ctx context.Context, effective, period, selection string, opts map[string]any) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	view := upperAny(opts["view"])
	if view != "TYPE" {
		view = "BRAND"
	}
	cmp := upperAny(opts["cmp"])
	if !inStrings([]string{"MTD", "WTD", "WK", "MOM"}, cmp) {
		cmp = "MTD"
	}
	metric := upperAny(opts["metric"])
	if !inStrings([]string{"ST", "SO", "OMZET", "DA", "NOO"}, metric) {
		metric = "ST"
	}
	level := upperAny(opts["level"])
	if !inStrings([]string{"SALES", "ASM", "RGM"}, level) {
		level = "SALES"
	}
	brand := textAny(opts["brand"])
	if brand == "" {
		brand = "ALL"
	}
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	if me, ok := pm[effective]; ok && me.Role == "SALES" {
		level = "SALES"
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period), previousN(period, 2)})
	if err != nil {
		return nil, err
	}
	cov, ok := db.Coverage[period]
	if !ok {
		return nil, fmt.Errorf("Periode belum tersedia")
	}
	A, B := compareRanges(period, cov.Cutoff, cov.Closed, cmp, intAny(opts["weekA"], 0), intAny(opts["weekB"], 0))
	idSet := map[string]bool{}
	for _, id := range ids {
		idSet[id] = true
	}
	acc := map[string]map[string][2]float64{}
	cols := map[string]bool{}
	bigCount := map[string]map[string]int{}
	put := func(rk, ck string, side int, v float64) {
		if ck == "" || rk == "" || side < 0 || side > 1 {
			return
		}
		if acc[rk] == nil {
			acc[rk] = map[string][2]float64{}
		}
		x := acc[rk][ck]
		x[side] += v
		acc[rk][ck] = x
		cols[ck] = true
	}
	colKey := func(b, typ string) string {
		if view == "TYPE" {
			if b != brand {
				return ""
			}
			if typ == "" {
				return "(tanpa TYPE)"
			}
			return typ
		}
		if brand == "ALL" || b == brand {
			return b
		}
		return ""
	}
	sideOf := func(d string) int {
		if d >= A.From && d <= A.To {
			return 0
		}
		if d >= B.From && d <= B.To {
			return 1
		}
		return -1
	}
	if metric == "SO" {
		rows, e := s.DB.Query(ctx, `select so.tanggal::text,c.nik_sales,p.brand,coalesce(nullif(p.type,''),p.nama_barang),so.qty,c.region from so_lines so join products p on p.kode_barang=so.kode_produk left join customers c on c.kode_customer=so.kode_customer where so.tanggal between $1 and $2`, minS(A.From, B.From), maxS(A.To, B.To))
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		for rows.Next() {
			var d, nik, b, typ, region string
			var qty int64
			if e := rows.Scan(&d, &nik, &b, &typ, &qty, &region); e != nil {
				return nil, e
			}
			if !idSet[nik] {
				continue
			}
			ck := colKey(b, typ)
			if ck == "" {
				continue
			}
			rk := rowGroupKey(pm, nik, level)
			put(rk, ck, sideOf(d), float64(qty))
		}
	} else if metric == "NOO" {
		for k, f := range db.First {
			if !idSet[f.NIK] {
				continue
			}
			sd := sideOf(f.Date)
			if sd < 0 {
				continue
			}
			var pair []string
			_ = json.Unmarshal([]byte(k), &pair)
			if len(pair) < 2 {
				continue
			}
			ck := colKey(pair[1], "")
			if ck != "" {
				put(rowGroupKey(pm, f.NIK, level), ck, sd, 1)
			}
		}
	} else {
		pairs := map[string]map[string]int64{}
		for _, rg := range []Range{A, B} {
			for _, r := range rowsForRange(db, period, period, ids, rg) {
				sd := sideOf(r.Date)
				ck := colKey(r.Brand, r.Type)
				if sd < 0 || ck == "" {
					continue
				}
				rk := rowGroupKey(pm, r.NIK, level)
				if bigCount[rk] == nil {
					bigCount[rk] = map[string]int{}
				}
				if r.Region != "" {
					bigCount[rk][r.Region]++
				}
				switch metric {
				case "ST":
					if r.Qty != 0 {
						put(rk, ck, sd, float64(r.Qty))
					}
				case "OMZET":
					if r.Amount != 0 {
						put(rk, ck, sd, r.Amount)
					}
				case "DA":
					if r.Qty > 0 {
						pk := fmt.Sprintf("%s\x1f%s\x1f%d", rk, ck, sd)
						if pairs[pk] == nil {
							pairs[pk] = map[string]int64{}
						}
						pairs[pk][r.Customer+"\x1f"+r.Brand] += r.Qty
						cols[ck] = true
					}
				}
			}
		}
		if metric == "DA" {
			for pk, m := range pairs {
				parts := strings.Split(pk, "\x1f")
				if len(parts) != 3 {
					continue
				}
				n := 0
				for _, q := range m {
					if q >= 2 {
						n++
					}
				}
				sd, _ := strconv.Atoi(parts[2])
				put(parts[0], parts[1], sd, float64(n))
			}
		}
	}
	colList := []map[string]any{}
	for ck := range cols {
		var t [2]float64
		for _, m := range acc {
			x := m[ck]
			t[0] += x[0]
			t[1] += x[1]
		}
		colList = append(colList, map[string]any{"key": ck, "model": ck, "a": core.RoundJS2(t[0]), "l": core.RoundJS2(t[1])})
	}
	sort.Slice(colList, func(i, j int) bool {
		ai := colList[i]["a"].(float64) + colList[i]["l"].(float64)
		aj := colList[j]["a"].(float64) + colList[j]["l"].(float64)
		if ai == aj {
			return fmt.Sprint(colList[i]["key"]) < fmt.Sprint(colList[j]["key"])
		}
		return ai > aj
	})
	rowKeys := make([]string, 0, len(acc))
	for rk := range acc {
		rowKeys = append(rowKeys, rk)
	}
	sort.Slice(rowKeys, func(i, j int) bool {
		return personName(pm, rowKeys[i], level) < personName(pm, rowKeys[j], level)
	})
	outRows := []map[string]any{}
	for _, rk := range rowKeys {
		p, ok := pm[rk]
		if !ok {
			p = core.Person{NIK: rk, Name: "(tanpa " + level + ")", Role: level}
		}
		asm, _ := ancestor(pm, rk, "ASM")
		rgm, _ := ancestor(pm, rk, "RGM")
		group := ""
		if level == "SALES" {
			if asm.Name != "" {
				group = asm.Name
			} else {
				group = "(tanpa ASM)"
			}
		} else if level == "ASM" {
			if rgm.Name != "" {
				group = rgm.Name
			} else {
				group = "(tanpa RGM)"
			}
		} else {
			group = p.BigRegion
		}
		cells := map[string]any{}
		for k, v := range acc[rk] {
			cells[k] = []float64{core.RoundJS2(v[0]), core.RoundJS2(v[1])}
		}
		outRows = append(outRows, map[string]any{"nik": rk, "nama": p.Name, "role": p.Role, "region": firstS(p.Portfolio, p.Region), "big": firstS(p.BigRegion, "(tanpa Big Region)"), "rgm": rgm.Name, "asm": asm.Name, "group": group, "self": false, "cells": cells})
	}
	maxWeek := int(math.Ceil(float64(intAny(cov.Cutoff[8:10], 1)) / 7))
	if maxWeek > 5 {
		maxWeek = 5
	}
	return map[string]any{"view": view, "cmp": cmp, "metric": metric, "level": level, "brand": brand, "period": period, "cutoff": cov.Cutoff, "A": A, "B": B, "cols": colList, "rows": outRows, "maxWeek": maxWeek}, nil
}

func personName(pm map[string]core.Person, nik, level string) string {
	if p, ok := pm[nik]; ok && p.Name != "" {
		return p.Name
	}
	return "(tanpa " + level + ")"
}
func firstS(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func minS(a, b string) string {
	if a < b {
		return a
	}
	return b
}
func maxS(a, b string) string {
	if a > b {
		return a
	}
	return b
}

func weekRange(period string, week int) Range {
	if week < 1 {
		week = 1
	}
	if week > 5 {
		week = 5
	}
	last, _ := strconv.Atoi(core.End(period)[8:10])
	from := (week-1)*7 + 1
	to := week * 7
	if from > last {
		from = last
	}
	if to > last {
		to = last
	}
	return Range{From: fmt.Sprintf("%s-%02d", period, from), To: fmt.Sprintf("%s-%02d", period, to), Label: fmt.Sprintf("W%d", week)}
}

func (s *Service) metricForRange(ctx context.Context, db *core.DB, selected string, ids []string, rg Range, metric, brand, typ string) (float64, error) {
	metric = strings.ToUpper(metric)
	if metric == "SO" {
		rows, err := s.DB.Query(ctx, `select coalesce(sum(so.qty),0)::float8 from so_lines so join products p on p.kode_barang=so.kode_produk join customers c on c.kode_customer=so.kode_customer where so.tanggal between $1 and $2 and c.nik_sales=any($3) and ($4='ALL' or p.brand=$4) and ($5='' or $5='ALL' or coalesce(nullif(p.type,''),p.nama_barang)=$5)`, rg.From, rg.To, ids, brand, typ)
		if err != nil {
			return 0, err
		}
		defer rows.Close()
		var v float64
		if rows.Next() {
			_ = rows.Scan(&v)
		}
		return v, nil
	}
	rr := rowsForRange(db, selected, selected, ids, rg)
	filtered := []core.DailyRow{}
	for _, r := range rr {
		if brand != "" && brand != "ALL" && r.Brand != brand {
			continue
		}
		if typ != "" && typ != "ALL" && r.Type != typ {
			continue
		}
		filtered = append(filtered, r)
	}
	switch metric {
	case "ST":
		var n float64
		for _, r := range filtered {
			n += float64(r.Qty)
		}
		return n, nil
	case "OMZET":
		var n float64
		for _, r := range filtered {
			n += r.Amount
		}
		return core.RoundJS2(n), nil
	case "DA":
		m := map[string]int64{}
		for _, r := range filtered {
			m[r.Customer+"\x1f"+r.Brand] += r.Qty
		}
		n := 0
		for _, q := range m {
			if q >= 2 {
				n++
			}
		}
		return float64(n), nil
	case "NOO":
		set := map[string]bool{}
		idSet := map[string]bool{}
		for _, id := range ids {
			idSet[id] = true
		}
		for k, f := range db.First {
			if !idSet[f.NIK] || f.Date < rg.From || f.Date > rg.To {
				continue
			}
			var pair []string
			_ = json.Unmarshal([]byte(k), &pair)
			if len(pair) < 2 || (brand != "ALL" && brand != "" && pair[1] != brand) {
				continue
			}
			set[pair[0]+"\x1f"+pair[1]] = true
		}
		return float64(len(set)), nil
	}
	return 0, fmt.Errorf("Indikator analisa tidak dikenal")
}

func (s *Service) WeeklyAnalysis(ctx context.Context, effective, period, selection string, request map[string]any) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	filter, _ := request["filter"].(map[string]any)
	ids, err = s.filterIDs(ctx, effective, ids, filter)
	if err != nil {
		return nil, err
	}
	brand := textAny(request["brand"])
	if brand == "" {
		brand = "ALL"
	}
	typ := textAny(request["type"])
	if typ == "" {
		typ = "ALL"
	}
	metric := upperAny(request["metric"])
	if !inStrings([]string{"ST", "SO", "OMZET"}, metric) {
		metric = "ST"
	}
	mode := upperAny(request["mode"])
	if mode != "MOM" {
		mode = "WOW"
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period), previousN(period, 2)})
	if err != nil {
		return nil, err
	}
	cov, ok := db.Coverage[period]
	if !ok {
		return nil, fmt.Errorf("Periode belum tersedia")
	}
	cutDay, _ := strconv.Atoi(cov.Cutoff[8:10])
	maxWeek := int(math.Ceil(float64(cutDay) / 7))
	if maxWeek < 1 {
		maxWeek = 1
	}
	if maxWeek > 5 {
		maxWeek = 5
	}
	var A, B Range
	if mode == "MOM" {
		pb := textAny(request["periodB"])
		if pb == "" {
			pb = period
		}
		pa := textAny(request["periodA"])
		if pa == "" {
			pa = core.Prev(pb)
		}
		day := cutDay
		lastA, _ := strconv.Atoi(core.End(pa)[8:10])
		if day > lastA {
			day = lastA
		}
		A = Range{From: pa + "-01", To: fmt.Sprintf("%s-%02d", pa, day), Label: pa}
		B = Range{From: pb + "-01", To: fmt.Sprintf("%s-%02d", pb, cutDay), Label: pb}
	} else {
		wa := intAny(request["weekA"], maxInt(1, maxWeek-1))
		wb := intAny(request["weekB"], maxWeek)
		if wa == wb && maxWeek > 1 {
			wa = wb - 1
		}
		A = weekRange(period, wa)
		B = weekRange(period, wb)
		if A.To > cov.Cutoff {
			A.To = cov.Cutoff
		}
		if B.To > cov.Cutoff {
			B.To = cov.Cutoff
		}
	}
	types := []string{}
	for _, p := range db.Products {
		if p.Device && (brand == "ALL" || p.Brand == brand) {
			types = append(types, firstS(p.Type, p.Name))
		}
	}
	types = uniqueSorted(types)
	shown := types
	if typ != "ALL" {
		shown = nil
		if inStrings(types, typ) {
			shown = []string{typ}
		}
	}
	makeRow := func(key, label string, total bool) (map[string]any, error) {
		t := key
		if total {
			t = "ALL"
		}
		a, e := s.metricForRange(ctx, db, period, ids, A, metric, brand, t)
		if e != nil {
			return nil, e
		}
		b, e := s.metricForRange(ctx, db, period, ids, B, metric, brand, t)
		if e != nil {
			return nil, e
		}
		d := b - a
		var g any = 0.0
		if a != 0 {
			g = d / a * 100
		} else if b != 0 {
			g = nil
		}
		return map[string]any{"key": key, "label": label, "total": total, "a": core.RoundJS2(a), "b": core.RoundJS2(b), "delta": core.RoundJS2(d), "growth": g}, nil
	}
	total, err := makeRow("TOTAL", "TOTAL "+brand, true)
	if err != nil {
		return nil, err
	}
	groups := []map[string]any{total}
	for _, t := range shown {
		r, e := makeRow(t, t, false)
		if e != nil {
			return nil, e
		}
		groups = append(groups, r)
	}
	ranked := append([]map[string]any(nil), groups[1:]...)
	sort.Slice(ranked, func(i, j int) bool { return ranked[i]["delta"].(float64) > ranked[j]["delta"].(float64) })
	var best, worst, top any
	if len(ranked) > 0 {
		best = ranked[0]
		worst = ranked[len(ranked)-1]
		byB := append([]map[string]any(nil), ranked...)
		sort.Slice(byB, func(i, j int) bool { return byB[i]["b"].(float64) > byB[j]["b"].(float64) })
		top = byB[0]
	}
	periodRows, _ := s.DB.Query(ctx, `select distinct period from coverage order by period desc`)
	periods := []string{}
	if periodRows != nil {
		for periodRows.Next() {
			var p string
			_ = periodRows.Scan(&p)
			periods = append(periods, p)
		}
		periodRows.Close()
	}
	weeks := make([]int, maxWeek)
	for i := range weeks {
		weeks[i] = i + 1
	}
	people, _ := s.Scope.People(ctx)
	salesSet := map[string]bool{}
	for _, p := range people {
		if p.Sales && inStrings(ids, p.NIK) {
			salesSet[p.NIK] = true
		}
	}
	return map[string]any{"groups": groups, "types": types, "scopeCount": len(salesSet), "best": best, "worst": worst, "topContributor": top, "total": total, "metric": metric, "mode": mode, "brand": brand, "type": typ, "periodA": A.Label, "periodB": B.Label, "rangeA": A, "rangeB": B, "periods": periods, "weekOptions": weeks, "cutoff": cov.Cutoff}, nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (s *Service) filterIDs(ctx context.Context, effective string, base []string, filter map[string]any) ([]string, error) {
	if filter == nil {
		return base, nil
	}
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	baseSet := map[string]bool{}
	for _, id := range base {
		baseSet[id] = true
	}
	chosen := firstS(textAny(filter["sales"]), firstS(textAny(filter["asm"]), textAny(filter["rgm"])))
	if chosen != "" && chosen != "ALL" {
		if !baseSet[chosen] {
			return nil, fmt.Errorf("Filter berada di luar cakupan")
		}
		sub, e := core.Scope(people, chosen)
		if e != nil {
			return nil, e
		}
		ss := map[string]bool{}
		for _, x := range sub {
			ss[x] = true
		}
		for k := range baseSet {
			if !ss[k] {
				delete(baseSet, k)
			}
		}
	}
	big, region, subr := textAny(filter["big"]), textAny(filter["region"]), textAny(filter["sub"])
	for k := range baseSet {
		p := pm[k]
		if big != "" && big != "ALL" && p.BigRegion != big {
			delete(baseSet, k)
			continue
		}
		r := firstS(p.Portfolio, p.Region)
		if region != "" && region != "ALL" && r != region {
			delete(baseSet, k)
			continue
		}
		if subr != "" && subr != "ALL" && r != subr {
			delete(baseSet, k)
		}
	}
	o := []string{}
	for _, id := range base {
		if baseSet[id] {
			o = append(o, id)
		}
	}
	return o, nil
}

func (s *Service) TeamComparison(ctx context.Context, effective, period, selection string, request map[string]any) (map[string]any, error) {
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	base, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if me, ok := pm[effective]; ok && me.Role == "SALES" && me.Supervisor != "" {
		base = nil
		for _, p := range people {
			if p.Sales && p.Supervisor == me.Supervisor {
				base = append(base, p.NIK)
			}
		}
	}
	filter, _ := request["filter"].(map[string]any)
	ids, err := s.filterIDs(ctx, effective, base, filter)
	if err != nil {
		return nil, err
	}
	level := upperAny(request["level"])
	if !inStrings([]string{"SALES", "ASM", "RGM", "BIG REGION", "REGION"}, level) {
		level = "SALES"
	}
	if me, ok := pm[effective]; ok && me.Role == "SALES" && level != "SALES" {
		return nil, fmt.Errorf("Tingkat analisa tidak diizinkan")
	}
	metric := upperAny(request["metric"])
	if !inStrings([]string{"ST", "SO", "OMZET", "DA", "NOO"}, metric) {
		metric = "ST"
	}
	brand := textAny(request["brand"])
	if brand == "" {
		brand = "ALL"
	}
	mode := upperAny(request["mode"])
	if mode != "MOM" {
		mode = "WOW"
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period)})
	if err != nil {
		return nil, err
	}
	cov := db.Coverage[period]
	var A, B Range
	if mode == "MOM" {
		pp := core.Prev(period)
		day, _ := strconv.Atoi(cov.Cutoff[8:10])
		last, _ := strconv.Atoi(core.End(pp)[8:10])
		if day > last {
			day = last
		}
		A = Range{From: pp + "-01", To: fmt.Sprintf("%s-%02d", pp, day), Label: pp}
		B = Range{From: period + "-01", To: cov.Cutoff, Label: period}
	} else {
		A = weekRange(period, intAny(request["weekA"], 1))
		B = weekRange(period, intAny(request["weekB"], 2))
		if A.Label == B.Label {
			return nil, fmt.Errorf("Minggu pembanding harus berbeda")
		}
		if A.To > cov.Cutoff {
			A.To = cov.Cutoff
		}
		if B.To > cov.Cutoff {
			B.To = cov.Cutoff
		}
	}
	idSet := map[string]bool{}
	for _, x := range ids {
		idSet[x] = true
	}
	type group struct {
		NIK, Name, Region string
		IDs               []string
	}
	groups := []group{}
	if level == "BIG REGION" || level == "REGION" {
		buckets := map[string][]string{}
		regionBig := map[string]string{}
		for _, p := range people {
			if !p.Sales || !idSet[p.NIK] {
				continue
			}
			name := p.BigRegion
			if level == "REGION" {
				name = firstS(p.Portfolio, p.Region)
				regionBig[name] = p.BigRegion
			}
			if name == "" {
				name = "LAINNYA"
			}
			buckets[name] = append(buckets[name], p.NIK)
		}
		for name, team := range buckets {
			rg := "Nasional"
			if level == "REGION" {
				rg = regionBig[name]
			}
			groups = append(groups, group{Name: name, Region: rg, IDs: team})
		}
	} else {
		for _, p := range people {
			if !idSet[p.NIK] {
				continue
			}
			if (level == "SALES" && !p.Sales) || (level != "SALES" && p.Role != level) {
				continue
			}
			team := []string{p.NIK}
			if level != "SALES" {
				sub, _ := core.Scope(people, p.NIK)
				team = nil
				for _, x := range sub {
					if idSet[x] {
						team = append(team, x)
					}
				}
			}
			groups = append(groups, group{NIK: p.NIK, Name: p.Name, Region: firstS(p.Portfolio, firstS(p.Region, p.BigRegion)), IDs: team})
		}
	}
	rows := []map[string]any{}
	for _, g := range groups {
		a, e := s.metricForRange(ctx, db, period, g.IDs, A, metric, brand, "ALL")
		if e != nil {
			return nil, e
		}
		b, e := s.metricForRange(ctx, db, period, g.IDs, B, metric, brand, "ALL")
		if e != nil {
			return nil, e
		}
		d := b - a
		var gr any = 0.0
		if a != 0 {
			gr = d / a * 100
		} else if b != 0 {
			gr = nil
		}
		rows = append(rows, map[string]any{"nik": g.NIK, "nama": g.Name, "region": g.Region, "a": core.RoundJS2(a), "b": core.RoundJS2(b), "delta": core.RoundJS2(d), "growth": gr})
	}
	sort.Slice(rows, func(i, j int) bool {
		di, _ := rows[i]["delta"].(float64)
		dj, _ := rows[j]["delta"].(float64)
		if di == dj {
			return fmt.Sprint(rows[i]["nama"]) < fmt.Sprint(rows[j]["nama"])
		}
		return di > dj
	})
	var best, worst any
	if len(rows) > 0 {
		best, worst = rows[0], rows[len(rows)-1]
	}
	return map[string]any{"rows": rows, "periodA": A.Label, "periodB": B.Label, "best": best, "worst": worst, "metric": metric, "mode": mode, "level": level}, nil
}

// DealerHistory provides the same row-oriented shape expected by the production UI.
// It is deliberately calculated from domain tables (not spreadsheet-shaped data).
func (s *Service) DealerHistory(ctx context.Context, effective, selection, brand, from, to string, page int, query string, filters map[string]any) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if _, err := core.Month(from); err != nil {
		return nil, err
	}
	if _, err := core.Month(to); err != nil {
		return nil, err
	}
	if from > to {
		return nil, fmt.Errorf("Bulan awal harus sebelum/sama dengan bulan akhir")
	}
	months := monthSequence(from, to)
	if len(months) > 24 {
		return nil, fmt.Errorf("Pilih maksimal 24 bulan agar tabel tetap ringan")
	}
	allBrands := []string{}
	br, err := s.DB.Query(ctx, `select distinct brand from products where masuk_qty=true order by brand`)
	if err != nil {
		return nil, err
	}
	for br.Next() {
		var b string
		_ = br.Scan(&b)
		allBrands = append(allBrands, b)
	}
	br.Close()
	if brand == "" {
		brand = "ALL"
	}
	displayBrands := listAny(filters["displayBrands"])
	if len(displayBrands) == 0 && brand != "ALL" {
		displayBrands = []string{brand}
	}
	selectedBrands := displayBrands
	if len(selectedBrands) == 0 {
		selectedBrands = allBrands
	}
	indicators := listAny(filters["indicators"])
	if len(indicators) == 0 {
		indicators = []string{"ST", "SO", "OMZET"}
	}
	dateMode := upperAny(filters["dateMode"])
	if !inStrings([]string{"ALL", "MTD", "TODAY"}, dateMode) {
		dateMode = "ALL"
	}
	region := textAny(filters["region"])
	if region == "" {
		region = "ALL"
	}
	subRegion := textAny(filters["subRegion"])
	if subRegion == "" {
		subRegion = "ALL"
	}
	q := strings.ToLower(strings.TrimSpace(query))
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	type row struct {
		ID, Name, Sales, SalesNIK, ASM, ASMNIK, Region, Sub string
		ST, SO, Omzet                                       []any
		BrandMetrics                                        map[string]map[string]any
		Promotor                                            any
		PromFocus                                           any
		Grade                                               any
		GradeText                                           string
	}
	rowsMap := map[string]*row{}
	cus, err := s.DB.Query(ctx, `select kode_customer,nama_induk_customer,nik_sales,region,sub_region from customers where active=true and nik_sales=any($1)`, ids)
	if err != nil {
		return nil, err
	}
	for cus.Next() {
		var id, name, nik, rg, sr string
		_ = cus.Scan(&id, &name, &nik, &rg, &sr)
		p := pm[nik]
		asm, _ := ancestor(pm, nik, "ASM")
		rowsMap[id] = &row{ID: id, Name: firstS(name, id), Sales: p.Name, SalesNIK: nik, ASM: asm.Name, ASMNIK: asm.NIK, Region: firstS(p.BigRegion, rg), Sub: firstS(p.Portfolio, firstS(p.Region, sr)), BrandMetrics: map[string]map[string]any{}}
	}
	cus.Close()
	for _, rr := range rowsMap {
		for _, b := range allBrands {
			rr.BrandMetrics[b] = map[string]any{"st": make([]any, len(months)), "so": make([]any, len(months)), "omzet": make([]any, len(months))}
		}
		rr.ST = make([]any, len(months))
		rr.SO = make([]any, len(months))
		rr.Omzet = make([]any, len(months))
		for i := range months {
			rr.ST[i], rr.SO[i], rr.Omzet[i] = float64(0), float64(0), float64(0)
			for _, b := range allBrands {
				rr.BrandMetrics[b]["st"].([]any)[i] = float64(0)
				rr.BrandMetrics[b]["so"].([]any)[i] = float64(0)
				rr.BrandMetrics[b]["omzet"].([]any)[i] = float64(0)
			}
		}
	}
	monthMeta := make([]map[string]any, len(months))
	for mi, m := range months {
		var stCut, soCut *time.Time
		_ = s.DB.QueryRow(ctx, `select min(cutoff) from coverage where period=$1 and kind='ST'`, m).Scan(&stCut)
		_ = s.DB.QueryRow(ctx, `select min(cutoff) from coverage where period=$1 and kind='SO'`, m).Scan(&soCut)
		var stFrom, stTo, soFrom, soTo string
		if stCut != nil {
			stFrom, stTo = historyWindow(m, stCut.Format("2006-01-02"), dateMode, to)
		}
		if soCut != nil {
			soFrom, soTo = historyWindow(m, soCut.Format("2006-01-02"), dateMode, to)
		}
		monthMeta[mi] = map[string]any{"period": m, "stCut": nil, "soCut": nil, "stFrom": nil, "soFrom": nil}
		if stTo != "" {
			monthMeta[mi]["stCut"], monthMeta[mi]["stFrom"] = stTo, stFrom
		}
		if soTo != "" {
			monthMeta[mi]["soCut"], monthMeta[mi]["soFrom"] = soTo, soFrom
		}
		if stTo != "" {
			stRows, e := s.DB.Query(ctx, `select d.kode_customer,d.brand,sum(d.qty)::float8,sum(d.amount)::float8 from st_daily d join customers c on c.kode_customer=d.kode_customer where d.tanggal between $1 and $2 and c.nik_sales=any($3) group by d.kode_customer,d.brand`, stFrom, stTo, ids)
			if e != nil {
				return nil, e
			}
			for stRows.Next() {
				var id, b string
				var qty, amt float64
				_ = stRows.Scan(&id, &b, &qty, &amt)
				rr := rowsMap[id]
				if rr == nil {
					continue
				}
				bm := rr.BrandMetrics[b]
				if bm == nil {
					bm = map[string]any{"st": make([]any, len(months)), "so": make([]any, len(months)), "omzet": make([]any, len(months))}
					for i := range months {
						bm["st"].([]any)[i], bm["so"].([]any)[i], bm["omzet"].([]any)[i] = float64(0), float64(0), float64(0)
					}
					rr.BrandMetrics[b] = bm
				}
				bm["st"].([]any)[mi] = qty
				bm["omzet"].([]any)[mi] = core.RoundJS2(amt)
				if inStrings(selectedBrands, b) {
					rr.ST[mi] = rr.ST[mi].(float64) + qty
					rr.Omzet[mi] = core.RoundJS2(rr.Omzet[mi].(float64) + amt)
				}
			}
			stRows.Close()
		} else {
			for _, rr := range rowsMap {
				rr.ST[mi], rr.Omzet[mi] = nil, nil
				for _, b := range allBrands {
					rr.BrandMetrics[b]["st"].([]any)[mi] = nil
					rr.BrandMetrics[b]["omzet"].([]any)[mi] = nil
				}
			}
		}
		if soTo != "" {
			soRows, e := s.DB.Query(ctx, `select so.kode_customer,p.brand,sum(so.qty)::float8 from so_lines so join products p on p.kode_barang=so.kode_produk join customers c on c.kode_customer=so.kode_customer where so.tanggal between $1 and $2 and c.nik_sales=any($3) and p.masuk_qty=true group by so.kode_customer,p.brand`, soFrom, soTo, ids)
			if e != nil {
				return nil, e
			}
			for soRows.Next() {
				var id, b string
				var qty float64
				_ = soRows.Scan(&id, &b, &qty)
				rr := rowsMap[id]
				if rr == nil {
					continue
				}
				bm := rr.BrandMetrics[b]
				if bm == nil {
					continue
				}
				bm["so"].([]any)[mi] = qty
				if inStrings(selectedBrands, b) {
					rr.SO[mi] = rr.SO[mi].(float64) + qty
				}
			}
			soRows.Close()
		} else {
			for _, rr := range rowsMap {
				rr.SO[mi] = nil
				for _, b := range allBrands {
					rr.BrandMetrics[b]["so"].([]any)[mi] = nil
				}
			}
		}
	}
	outRows := []map[string]any{}
	for _, rr := range rowsMap {
		if q != "" && !strings.Contains(strings.ToLower(rr.ID+" "+rr.Name), q) {
			continue
		}
		if region != "ALL" && rr.Region != region {
			continue
		}
		if subRegion != "ALL" && rr.Sub != subRegion {
			continue
		}
		if cust := textAny(filters["customer"]); cust != "" && rr.ID != cust {
			continue
		}
		byBrand := map[string]any{}
		brandMetrics := map[string]any{}
		for b, bm := range rr.BrandMetrics {
			st := bm["st"].([]any)
			so := bm["so"].([]any)
			om := bm["omzet"].([]any)
			byBrand[b] = st
			brandMetrics[b] = map[string]any{"st": st, "so": so, "omzet": om, "totalST": sumNullable(st), "totalSO": sumNullable(so), "totalOmzet": sumNullable(om)}
		}
		prom, promFocus, grade, gradeText := s.dealerAttributes(ctx, rr.ID, selectedBrands)
		outRows = append(outRows, map[string]any{"id": rr.ID, "nama": rr.Name, "sales": rr.Sales, "salesNik": rr.SalesNIK, "asm": rr.ASM, "asmNik": rr.ASMNIK, "region": rr.Region, "subregion": rr.Sub, "st": rr.ST, "so": rr.SO, "omzet": rr.Omzet, "byBrand": byBrand, "brandMetrics": brandMetrics, "totalST": sumNullable(rr.ST), "totalSO": sumNullable(rr.SO), "totalOmzet": sumNullable(rr.Omzet), "promotor": prom, "promFocus": promFocus, "grade": grade, "gradeText": gradeText})
	}
	outRows = applyHistoryAttrFilters(outRows, filters)
	orderPeriod := textAny(filters["order"])
	noOrderPeriod := textAny(filters["noOrder"])
	basis := upperAny(filters["basis"])
	if basis != "SO" {
		basis = "ST"
	}
	orderBrands := listAny(filters["orderBrands"])
	noOrderBrands := listAny(filters["noOrderBrands"])
	if orderPeriod != "" || noOrderPeriod != "" {
		outRows = filterHistoryOrders(outRows, months, basis, orderPeriod, noOrderPeriod, orderBrands, noOrderBrands)
	}
	sort.Slice(outRows, func(i, j int) bool {
		a, b := outRows[i], outRows[j]
		return fmt.Sprint(a["nama"]) < fmt.Sprint(b["nama"])
	})
	pageSize := intAny(filters["pageSize"], 100)
	if pageSize != 50 && pageSize != 100 && pageSize != 200 {
		pageSize = 100
	}
	if page < 0 {
		page = 0
	}
	maxPage := 0
	if len(outRows) > 0 {
		maxPage = (len(outRows) - 1) / pageSize
	}
	if page > maxPage {
		page = maxPage
	}
	start := page * pageSize
	end := start + pageSize
	if end > len(outRows) {
		end = len(outRows)
	}
	totals := historyAggregate(outRows, selectedBrands, months)
	regions, subs := []string{}, []string{}
	for _, r := range outRows {
		regions = append(regions, fmt.Sprint(r["region"]))
		subs = append(subs, fmt.Sprint(r["subregion"]))
	}
	promBrand := "ALL"
	if len(selectedBrands) == 1 {
		promBrand = selectedBrands[0]
	}
	gradeOptions := s.gradeOptions(ctx, promBrand)
	return map[string]any{"months": monthMeta, "promBrand": promBrand, "gradeOptions": gradeOptions, "promCompare": historyPromCompare(outRows, months, selectedBrands), "brands": allBrands, "displayBrands": selectedBrands, "regions": uniqueSorted(regions), "subRegions": uniqueSorted(subs), "brand": brand, "from": from, "to": to, "filters": map[string]any{"basis": basis, "dateMode": dateMode, "region": region, "subRegion": subRegion, "displayBrands": displayBrands, "indicators": indicators, "order": orderPeriod, "noOrder": noOrderPeriod, "orderBrands": orderBrands, "noOrderBrands": noOrderBrands, "prom": textAny(filters["prom"]), "grade": textAny(filters["grade"])}, "total": len(outRows), "page": page, "pageSize": pageSize, "rows": outRows[start:end], "totals": map[string]any{"byBrand": totals}}, nil
}

func monthSequence(from, to string) []string {
	t, _ := time.Parse("2006-01", from)
	end, _ := time.Parse("2006-01", to)
	o := []string{}
	for !t.After(end) {
		o = append(o, t.Format("2006-01"))
		t = t.AddDate(0, 1, 0)
	}
	return o
}
func historyWindow(period, sourceCut, mode, refPeriod string) (string, string) {
	if sourceCut == "" {
		return "", ""
	}
	if mode == "TODAY" {
		day := sourceCut[8:10]
		if len(refPeriod) >= 7 {
			// Use the selected end-period cutoff day when possible.
		}
		last, _ := strconv.Atoi(core.End(period)[8:10])
		d, _ := strconv.Atoi(day)
		if d > last {
			d = last
		}
		x := fmt.Sprintf("%s-%02d", period, d)
		if x > sourceCut {
			return "", ""
		}
		return x, x
	}
	if mode == "MTD" {
		return period + "-01", sourceCut
	}
	return period + "-01", sourceCut
}
func sumNullable(a []any) any {
	var n float64
	for _, x := range a {
		if x == nil {
			return nil
		}
		switch v := x.(type) {
		case float64:
			n += v
		case int:
			n += float64(v)
		case int64:
			n += float64(v)
		}
	}
	return core.RoundJS2(n)
}
func (s *Service) dealerAttributes(ctx context.Context, customer string, focus []string) (any, any, any, string) {
	prows, _ := s.DB.Query(ctx, `select brand,jumlah,present_in_master from customer_promotors where kode_customer=$1 order by brand`, customer)
	promList := []map[string]any{}
	if prows != nil {
		for prows.Next() {
			var b string
			var n *int
			var present bool
			_ = prows.Scan(&b, &n, &present)
			promList = append(promList, map[string]any{"brand": b, "jumlah": n, "present": present})
		}
		prows.Close()
	}
	prom := any(nil)
	promFocus := any(nil)
	if len(promList) > 0 {
		prom = promList
	}
	if len(focus) == 1 {
		b := focus[0]
		found := false
		for _, p := range promList {
			if p["brand"] == b {
				if n, ok := p["jumlah"].(*int); ok && n != nil && *n > 0 {
					found = true
				}
			}
		}
		promFocus = found
	}
	grows, _ := s.DB.Query(ctx, `select brand,grade from customer_grades where kode_customer=$1 order by brand`, customer)
	gm := map[string]string{}
	if grows != nil {
		for grows.Next() {
			var b, g string
			_ = grows.Scan(&b, &g)
			gm[b] = g
		}
		grows.Close()
	}
	var grade any = gm
	parts := []string{}
	for _, b := range uniqueSorted(mapKeys(gm)) {
		parts = append(parts, b+" "+gm[b])
	}
	if len(focus) == 1 {
		grade = gm[focus[0]]
	}
	return prom, promFocus, grade, strings.Join(parts, " · ")
}
func mapKeys(m map[string]string) []string {
	o := make([]string, 0, len(m))
	for k := range m {
		o = append(o, k)
	}
	return o
}
func applyHistoryAttrFilters(rows []map[string]any, filters map[string]any) []map[string]any {
	prom := upperAny(filters["prom"])
	grade := strings.ToUpper(textAny(filters["grade"]))
	o := rows[:0]
	for _, r := range rows {
		if prom == "YES" || prom == "BER-PROMOTOR" {
			if r["promFocus"] != true && r["promotor"] == nil {
				continue
			}
		}
		if prom == "NO" || prom == "NON PROMOTOR" {
			if r["promFocus"] == true || r["promotor"] != nil {
				continue
			}
		}
		if grade != "" && grade != "ALL" && strings.ToUpper(fmt.Sprint(r["grade"])) != grade {
			continue
		}
		o = append(o, r)
	}
	return o
}
func filterHistoryOrders(rows []map[string]any, months []string, basis, orderP, noOrderP string, orderBrands, noOrderBrands []string) []map[string]any {
	index := map[string]int{}
	for i, m := range months {
		index[m] = i
	}
	metricKey := "st"
	if basis == "SO" {
		metricKey = "so"
	}
	get := func(r map[string]any, period string, brands []string) bool {
		i, ok := index[period]
		if !ok {
			return false
		}
		if len(brands) == 0 {
			a, _ := r[metricKey].([]any)
			return i < len(a) && numericAny(a[i]) > 0
		}
		bm, _ := r["brandMetrics"].(map[string]any)
		for _, b := range brands {
			x, _ := bm[b].(map[string]any)
			a, _ := x[metricKey].([]any)
			if i >= len(a) || numericAny(a[i]) <= 0 {
				return false
			}
		}
		return true
	}
	o := rows[:0]
	for _, r := range rows {
		if orderP != "" && !get(r, orderP, orderBrands) {
			continue
		}
		if noOrderP != "" && get(r, noOrderP, noOrderBrands) {
			continue
		}
		o = append(o, r)
	}
	return o
}
func numericAny(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case nil:
		return 0
	default:
		n, _ := strconv.ParseFloat(fmt.Sprint(x), 64)
		return n
	}
}
func historyAggregate(rows []map[string]any, brands, months []string) map[string]any {
	out := map[string]any{}
	for _, b := range brands {
		st, so, om := make([]any, len(months)), make([]any, len(months)), make([]any, len(months))
		for i := range months {
			st[i], so[i], om[i] = float64(0), float64(0), float64(0)
		}
		for _, r := range rows {
			bm, _ := r["brandMetrics"].(map[string]any)
			x, _ := bm[b].(map[string]any)
			for i := range months {
				for _, kv := range []struct {
					key string
					dst []any
				}{{"st", st}, {"so", so}, {"omzet", om}} {
					a, _ := x[kv.key].([]any)
					if i >= len(a) || a[i] == nil || kv.dst[i] == nil {
						kv.dst[i] = nil
					} else {
						kv.dst[i] = numericAny(kv.dst[i]) + numericAny(a[i])
					}
				}
			}
		}
		out[b] = map[string]any{"st": st, "so": so, "omzet": om, "totalST": sumNullable(st), "totalSO": sumNullable(so), "totalOmzet": sumNullable(om)}
	}
	return out
}
func historyPromCompare(rows []map[string]any, months []string, brands []string) map[string]any {
	yes := make([]float64, len(months))
	no := make([]float64, len(months))
	yc, nc := 0, 0
	for _, r := range rows {
		isProm := r["promFocus"] == true || r["promotor"] != nil
		if isProm {
			yc++
		} else {
			nc++
		}
		bm, _ := r["brandMetrics"].(map[string]any)
		for _, b := range brands {
			x, _ := bm[b].(map[string]any)
			a, _ := x["st"].([]any)
			for i := range months {
				if i < len(a) && a[i] != nil {
					if isProm {
						yes[i] += numericAny(a[i])
					} else {
						no[i] += numericAny(a[i])
					}
				}
			}
		}
	}
	return map[string]any{"yes": map[string]any{"count": yc, "sum": yes}, "no": map[string]any{"count": nc, "sum": no}}
}
func (s *Service) gradeOptions(ctx context.Context, brand string) []string {
	if brand == "" || brand == "ALL" {
		return []string{}
	}
	rows, err := s.DB.Query(ctx, `select distinct grade from customer_grades where brand=$1 order by grade`, brand)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	o := []string{}
	for rows.Next() {
		var g string
		_ = rows.Scan(&g)
		o = append(o, g)
	}
	return o
}

func (s *Service) DealerHistorySummary(ctx context.Context, effective, selection, brand, from, to, query string, filters map[string]any, level string) (map[string]any, error) {
	level = strings.ToUpper(strings.TrimSpace(level))
	if !inStrings([]string{"BIG", "REGION", "ASM", "SALES"}, level) {
		level = "BIG"
	}
	all, err := s.DealerHistory(ctx, effective, selection, brand, from, to, 0, query, mergeMap(filters, map[string]any{"pageSize": 200}))
	if err != nil {
		return nil, err
	}
	// Fetch every row when there are >200 using repeated pages.
	total := int(numericAny(all["total"]))
	rows := []map[string]any{}
	pageSize := 200
	for p := 0; p*pageSize < total; p++ {
		x, e := s.DealerHistory(ctx, effective, selection, brand, from, to, p, query, mergeMap(filters, map[string]any{"pageSize": pageSize}))
		if e != nil {
			return nil, e
		}
		if a, ok := x["rows"].([]map[string]any); ok {
			rows = append(rows, a...)
		} else if a, ok := x["rows"].([]any); ok {
			for _, v := range a {
				if m, ok := v.(map[string]any); ok {
					rows = append(rows, m)
				}
			}
		}
	}
	type grp struct {
		key, label, context string
		rows                []map[string]any
	}
	gm := map[string]*grp{}
	for _, r := range rows {
		key, label, context := "", "", ""
		switch level {
		case "BIG":
			key, label = fmt.Sprint(r["region"]), fmt.Sprint(r["region"])
		case "REGION":
			key = fmt.Sprint(r["region"]) + "\x1f" + fmt.Sprint(r["subregion"])
			label, context = fmt.Sprint(r["subregion"]), fmt.Sprint(r["region"])
		case "ASM":
			key, label, context = firstS(fmt.Sprint(r["asmNik"]), "ASM:"+fmt.Sprint(r["asm"])), fmt.Sprint(r["asm"]), fmt.Sprint(r["region"])
		case "SALES":
			key, label = firstS(fmt.Sprint(r["salesNik"]), "SALES:"+fmt.Sprint(r["sales"])), fmt.Sprint(r["sales"])
			context = strings.Trim(strings.Join([]string{fmt.Sprint(r["asm"]), fmt.Sprint(r["subregion"])}, " · "), " ·")
		}
		if key == "" {
			key, label = "BELUM", "Belum terpetakan"
		}
		if gm[key] == nil {
			gm[key] = &grp{key: key, label: label, context: context}
		}
		gm[key].rows = append(gm[key].rows, r)
	}
	brands, _ := all["displayBrands"].([]string)
	if len(brands) == 0 {
		if a, ok := all["displayBrands"].([]any); ok {
			brands = listAny(a)
		}
	}
	monthMeta, _ := all["months"].([]map[string]any)
	months := []string{}
	for _, m := range monthMeta {
		months = append(months, fmt.Sprint(m["period"]))
	}
	out := []map[string]any{}
	for _, g := range gm {
		out = append(out, map[string]any{"key": g.key, "label": g.label, "context": g.context, "dealerCount": len(g.rows), "byBrand": historyAggregate(g.rows, brands, months)})
	}
	sort.Slice(out, func(i, j int) bool { return fmt.Sprint(out[i]["label"]) < fmt.Sprint(out[j]["label"]) })
	return map[string]any{"level": level, "months": all["months"], "displayBrands": all["displayBrands"], "indicators": all["filters"].(map[string]any)["indicators"], "totalDealers": len(rows), "rows": out, "total": map[string]any{"dealerCount": len(rows), "byBrand": historyAggregate(rows, brands, months)}, "filters": all["filters"]}, nil
}
func mergeMap(a, b map[string]any) map[string]any {
	o := map[string]any{}
	for k, v := range a {
		o[k] = v
	}
	for k, v := range b {
		o[k] = v
	}
	return o
}

// Potensi returns a compact dealer potential matrix based on the previous three months.
func (s *Service) Potensi(ctx context.Context, effective, period, selection string) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	months := []string{previousN(period, 3), previousN(period, 2), previousN(period, 1)}
	db, err := s.LoadCoreDB(ctx, append([]string{period}, months...))
	if err != nil {
		return nil, err
	}
	brands := []string{}
	for _, p := range db.Products {
		if p.Device {
			brands = append(brands, p.Brand)
		}
	}
	brands = uniqueSorted(brands)
	idSet := map[string]bool{}
	for _, id := range ids {
		idSet[id] = true
	}
	avg := map[string]map[string]float64{}
	for _, m := range months {
		for _, r := range core.SliceCompare(db, m, ids, "", period) {
			if r.Qty == 0 {
				continue
			}
			if avg[r.Customer] == nil {
				avg[r.Customer] = map[string]float64{}
			}
			avg[r.Customer][r.Brand] += math.Max(0, float64(r.Qty)) / float64(len(months))
		}
	}
	rows := []map[string]any{}
	for id, bm := range avg {
		c := db.Customers[id]
		if !idSet[c.NIK] {
			continue
		}
		total := 0.0
		cells := map[string]any{}
		for _, b := range brands {
			v := bm[b]
			total += v
			cells[b] = map[string]any{"v": core.RoundJS2(v), "k": func() string {
				if v > 0 {
					return "h"
				}
				return "o"
			}()}
		}
		if total <= 0 {
			continue
		}
		rows = append(rows, map[string]any{"id": id, "nama": c.Name, "salesNik": c.NIK, "region": c.Region, "subRegion": c.SubRegion, "total": core.RoundJS2(total), "cell": cells})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i]["total"].(float64) > rows[j]["total"].(float64) })
	return map[string]any{"period": period, "months": months, "brands": brands, "rows": rows, "count": len(rows)}, nil
}

// Analisa composes the analytical page from the normalized data layer. The response keeps
// stable keys for Cross-sell/Reactivation/New-dealer cards while golden parity tests refine details.
func (s *Service) Analisa(ctx context.Context, effective, period, selection string) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period), previousN(period, 2), previousN(period, 3), previousN(period, 4), previousN(period, 5)})
	if err != nil {
		return nil, err
	}
	closed := map[string]string{}
	rows, err := s.DB.Query(ctx, "select kode_customer,tanggal_tutup::text from customer_closures where status='TUTUP'")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, date string
		if err := rows.Scan(&id, &date); err != nil {
			rows.Close()
			return nil, err
		}
		closed[id] = date
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return analysisContract(db, period, ids, closed), nil
}

// Executive assembles high-level summaries using the same normalized KPI/metric core.
func (s *Service) Executive(ctx context.Context, effective, period, selection string) (map[string]any, error) {
	d, err := s.Dashboard(ctx, effective, period, selection)
	if err != nil {
		return nil, err
	}
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	idSet := map[string]bool{}
	for _, id := range ids {
		idSet[id] = true
	}
	level := "TOP"
	if p, ok := pm[effective]; ok {
		switch p.Role {
		case "RGM":
			level = "RGM"
		case "ASM":
			level = "ASM"
		case "SALES":
			level = "SALES"
		}
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period)})
	if err != nil {
		return nil, err
	}
	nodes, daily, brands := executiveNodes(db, period, ids)
	prev, prevCut, _ := core.ComparisonPeriod(db, period)
	cov := db.Coverage[period]
	hol := core.HolidaySet{}
	hr, _ := s.DB.Query(ctx, `select tanggal::text from holidays where aktif=true`)
	if hr != nil {
		for hr.Next() {
			var x string
			_ = hr.Scan(&x)
			hol[x] = true
		}
		hr.Close()
	}
	days, run, _ := core.Workdays(period, cov.Cutoff, cov.Closed, hol)
	_ = prev
	var kpiMe any
	if k, ok := d.KPI.(core.KPIResult); ok {
		groups := []any{}
		for _, g := range k.Groups {
			groups = append(groups, map[string]any{"name": g.Name, "score": g.Score, "ind": g.Indicators})
		}
		kpiMe = map[string]any{"score": k.Score, "status": k.Status, "groups": groups}
	}
	return map[string]any{"level": level, "me": effective, "period": period, "prev": core.Prev(period), "cutoff": cov.Cutoff, "prevCutoff": prevCut, "closed": cov.Closed, "days": days, "run": run, "brands": brands, "nodes": nodes, "daily": daily, "hist": map[string]any{"months": []string{}, "v": map[string]any{}, "t": map[string]any{}}, "asm": []any{}, "kpi": map[string]any{}, "dealer": map[string]any{}, "kpiMe": kpiMe, "dealers": executiveDealers(d.Customers), "ownBig": nil, "ownSub": []string{}, "onlineBigs": []string{}, "soReady": false}, nil
}

func workdayDates(period, cutoff string, closed bool, holidays core.HolidaySet) ([]string, int, int) {
	start, _ := time.Parse("2006-01-02", period+"-01")
	end, _ := time.Parse("2006-01-02", core.End(period))
	cut, _ := time.Parse("2006-01-02", cutoff)
	dates := []string{}
	days, run := 0, 0
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		iso := d.Format("2006-01-02")
		if d.Weekday() == time.Sunday || holidays[iso] {
			continue
		}
		days++
		if closed || !d.After(cut) {
			run++
			dates = append(dates, iso)
		}
	}
	return dates, days, run
}

func (s *Service) EarlyWarning(ctx context.Context, effective, period, level, brand, metric, selection string, filters map[string]any) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	pm := personMap(people)
	level = strings.ToUpper(strings.TrimSpace(level))
	if !inStrings([]string{"SALES", "ASM", "RGM", "BIG REGION", "REGION"}, level) {
		return nil, fmt.Errorf("Pilihan tidak valid")
	}
	metric = strings.ToUpper(strings.TrimSpace(metric))
	if !inStrings([]string{"QTY", "DA", "NOO"}, metric) {
		return nil, fmt.Errorf("Pilihan tidak valid")
	}
	if brand == "" {
		brand = "ALL"
	}
	me := pm[effective]
	area := level == "BIG REGION" || level == "REGION"
	if me.Role == "SALES" && level != "SALES" {
		return nil, fmt.Errorf("Tingkat tidak diizinkan")
	}
	if !area && me.Role != "SALES" && core.Level[level] >= core.Level[me.Role] {
		return nil, fmt.Errorf("Tingkat tidak diizinkan")
	}
	ids, err = s.filterIDs(ctx, effective, ids, filters)
	if err != nil {
		return nil, err
	}
	idSet := map[string]bool{}
	for _, id := range ids {
		idSet[id] = true
	}
	salesPeople := []core.Person{}
	for _, p := range people {
		if p.Sales && idSet[p.NIK] {
			salesPeople = append(salesPeople, p)
		}
	}
	type ewGroup struct {
		NIK, Name, Role, Region, Big, Boss, BossRole string
		Team                                         []string
	}
	groups := []ewGroup{}
	if area {
		buckets := map[string][]core.Person{}
		for _, p := range salesPeople {
			name := p.BigRegion
			if level == "REGION" {
				name = firstS(p.Portfolio, p.Region)
			}
			if name == "" {
				name = "LAINNYA"
			}
			buckets[name] = append(buckets[name], p)
		}
		names := make([]string, 0, len(buckets))
		for n := range buckets {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, name := range names {
			bp := buckets[name]
			team := make([]string, 0, len(bp))
			for _, p := range bp {
				team = append(team, p.NIK)
			}
			region := "Nasional"
			boss, bossRole := "Nasional", "Cakupan"
			if level == "REGION" {
				region = bp[0].BigRegion
				boss, bossRole = firstS(bp[0].BigRegion, "—"), "Big Region"
			}
			groups = append(groups, ewGroup{NIK: "AREA:" + name, Name: name, Role: level, Region: region, Boss: boss, BossRole: bossRole, Team: team})
		}
	} else {
		for _, p := range people {
			if level == "SALES" {
				if !p.Sales || !idSet[p.NIK] {
					continue
				}
			} else if p.Role != level || !idSet[p.NIK] {
				continue
			}
			team := []string{p.NIK}
			if level != "SALES" {
				sub, _ := core.Scope(people, p.NIK)
				team = nil
				for _, id := range sub {
					if idSet[id] && pm[id].Sales {
						team = append(team, id)
					}
				}
			}
			if len(team) == 0 {
				continue
			}
			boss := pm[p.Supervisor]
			groups = append(groups, ewGroup{NIK: p.NIK, Name: p.Name, Role: p.Role, Region: firstS(p.Portfolio, p.Region), Big: p.BigRegion, Boss: firstS(boss.Name, "—"), BossRole: boss.Role, Team: team})
		}
	}
	db, err := s.LoadCoreDB(ctx, []string{period})
	if err != nil {
		return nil, err
	}
	cov, ok := db.Coverage[period]
	if !ok {
		return nil, fmt.Errorf("Periode belum tersedia")
	}
	hol := core.HolidaySet{}
	hr, _ := s.DB.Query(ctx, `select tanggal::text from holidays where aktif=true`)
	if hr != nil {
		for hr.Next() {
			var d string
			_ = hr.Scan(&d)
			hol[d] = true
		}
		hr.Close()
	}
	runDates, days, run := workdayDates(period, cov.Cutoff, cov.Closed, hol)
	last7 := runDates
	if len(last7) > 7 {
		last7 = last7[len(last7)-7:]
	}
	brands := []string{}
	for _, p := range db.Products {
		if p.Device {
			brands = append(brands, p.Brand)
		}
	}
	brands = uniqueSorted(brands)
	rows := []map[string]any{}
	for _, g := range groups {
		slice := core.Slice(db, period, g.Team, "")
		m := core.CalculateMetrics(slice, db, period, brand, 2, 1)
		actual := float64(m.Qty)
		if metric == "DA" {
			actual = float64(m.ActiveDealer)
		} else if metric == "NOO" {
			actual = float64(m.NOO)
		}
		tv, missing, exists := core.TargetFor(db, period, g.Team, brand, metric, "")
		if brand == "ALL" && !exists {
			tv = 0
			exists = false
			mm := map[string]bool{}
			for _, b := range brands {
				v, mis, ex := core.TargetFor(db, period, g.Team, b, metric, "")
				tv += v
				if ex {
					exists = true
				}
				for _, x := range mis {
					mm[x] = true
				}
			}
			missing = nil
			for x := range mm {
				missing = append(missing, x)
			}
		}
		daily := make([]float64, len(last7))
		for i, dt := range last7 {
			for _, r := range slice {
				if r.Date == dt && (brand == "ALL" || r.Brand == brand) {
					daily[i] += float64(r.Qty)
				}
			}
		}
		rows = append(rows, map[string]any{"nik": g.NIK, "nama": g.Name, "role": g.Role, "region": g.Region, "big": g.Big, "boss": g.Boss, "bossRole": g.BossRole, "teamSize": len(g.Team), "actual": actual, "target": tv, "targetComplete": exists && len(missing) == 0, "daily7": daily, "qtyMTD": m.Qty})
	}
	return map[string]any{"period": period, "cutoff": cov.Cutoff, "closed": cov.Closed, "days": days, "run": run, "level": level, "brand": brand, "metric": metric, "brands": brands, "last7": last7, "rows": rows}, nil
}
