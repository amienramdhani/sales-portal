package reporting

import "salesportal/internal/core"

func executiveDealers(customers []any) []any {
	out := []any{}
	for _, row := range customers {
		c := row.(map[string]any)
		m := c["current"].(core.Metrics)
		old := c["previous"].(core.Metrics)
		br := map[string]int64{}
		for _, r := range c["brands"].([]any) {
			b := r.(map[string]any)
			q := b["metrics"].(core.Metrics).Qty
			if q > 0 {
				br[b["brand"].(string)] = q
			}
		}
		out = append(out, map[string]any{"id": c["id"], "nama": c["nama"], "nik": c["nik"], "hp": c["hp"], "kota": c["kota"], "mtd": m.Qty, "lmtd": old.Qty, "lm": old.Qty, "br": br, "lmBr": map[string]int64{}, "n": m.Notes, "noo": nil, "stok": nil})
	}
	return out
}

func executiveNodes(db *core.DB, period string, ids []string) (map[string]any, map[string]any, []string) {
	brandsSet := map[string]bool{}
	for _, p := range db.Products {
		if p.Device {
			brandsSet[p.Brand] = true
		}
	}
	brands := keys(brandsSet)
	groups := map[string][]string{"N": {}, "O": {}}
	names := map[string]string{"N": "Nasional", "O": "Cakupan saya"}
	for _, p := range db.People {
		if !contains(ids, p.NIK) || !p.Sales {
			continue
		}
		big := first(p.BigRegion, "(tanpa Big Region)")
		sub := first(first(p.Portfolio, p.Region), "(tanpa Region)")
		for _, k := range []string{"N", "O", "B|" + big, "S|" + big + "|" + sub, "P|" + p.NIK} {
			groups[k] = append(groups[k], p.NIK)
		}
		names["B|"+big] = big
		names["S|"+big+"|"+sub] = sub
		names["P|"+p.NIK] = p.Name
	}
	prev, cut, _ := core.ComparisonPeriod(db, period)
	nodes := map[string]any{}
	daily := map[string]any{}
	for k, team := range groups {
		cur := core.Slice(db, period, team, "")
		old := core.SliceCompare(db, prev, team, cut, period)
		today := []core.DailyRow{}
		days := map[string]map[string]int64{}
		for _, r := range cur {
			if r.Date == db.Coverage[period].Cutoff {
				today = append(today, r)
			}
			if days[r.Date] == nil {
				days[r.Date] = map[string]int64{}
			}
			days[r.Date][r.Brand] += r.Qty
		}
		metrics := map[string]any{}
		for _, b := range append(append([]string{}, brands...), "ALL") {
			a := core.CalculateMetrics(cur, db, period, b, 2, 1)
			lm := core.CalculateMetrics(old, db, prev, b, 2, 1)
			td := core.CalculateMetrics(today, db, period, b, 2, 1)
			targets := map[string]float64{}
			for i, m := range []string{"QTY", "DA", "NOO"} {
				value, _, _ := core.TargetFor(db, period, team, b, m, "")
				if b == "ALL" {
					value = 0
					for _, bb := range brands {
						v, _, _ := core.TargetFor(db, period, team, bb, m, "")
						value += v
					}
				}
				targets[[]string{"st", "da", "noo"}[i]] = value
			}
			metrics[b] = map[string]any{"st": []int64{a.Qty, lm.Qty, td.Qty}, "da": []int{a.ActiveDealer, lm.ActiveDealer, td.ActiveDealer}, "noo": []int{a.NOO, lm.NOO, td.NOO}, "om": []float64{a.Revenue, lm.Revenue, td.Revenue}, "so": []any{nil, nil, nil}, "t": targets}
		}
		p := core.Person{}
		if len(team) > 0 {
			p = personMap(db.People)[team[0]]
		}
		nodes[k] = map[string]any{"name": names[k], "big": p.BigRegion, "sub": first(p.Portfolio, p.Region), "lead": "", "online": false, "m": metrics}
		daily[k] = days
	}
	return nodes, daily, brands
}
