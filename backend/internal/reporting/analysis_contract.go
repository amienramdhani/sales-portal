package reporting

import (
	"encoding/json"
	"math"
	"salesportal/internal/core"
	"sort"
	"time"
)

// analysisContract preserves the dealer/brand and cohort contracts consumed by the legacy UI.
func analysisContract(db *core.DB, period string, ids []string, closed map[string]string) map[string]any {
	months := []string{}
	for i := 5; i >= 0; i-- {
		m := period
		if i > 0 {
			m = previousN(period, i)
		}
		if _, ok := db.Coverage[m]; ok || m == period {
			months = append(months, m)
		}
	}
	recent := months
	if len(recent) > 3 {
		recent = recent[len(recent)-3:]
	}
	brandsSet := map[string]bool{}
	for _, p := range db.Products {
		if p.Device {
			brandsSet[p.Brand] = true
		}
	}
	brands := keys(brandsSet)
	pm := personMap(db.People)
	cov := db.Coverage[period]
	prev := core.Prev(period)
	cube := map[string]map[string]map[string]float64{}
	last := map[string]string{}
	later := map[string][]string{}
	for _, m := range months {
		rows := core.SliceCompare(db, m, ids, "", period)
		if m == period {
			rows = core.Slice(db, m, ids, cov.Cutoff)
		}
		for _, r := range rows {
			if r.Qty == 0 {
				continue
			}
			if cube[r.Customer] == nil {
				cube[r.Customer] = map[string]map[string]float64{}
			}
			if cube[r.Customer][m] == nil {
				cube[r.Customer][m] = map[string]float64{}
			}
			cube[r.Customer][m][r.Brand] += float64(r.Qty)
			if r.Qty > 0 {
				if r.Date > last[r.Customer] {
					last[r.Customer] = r.Date
				}
				if m == period {
					k := core.Key(r.Customer, r.Brand)
					later[k] = append(later[k], r.Date)
				}
			}
		}
	}
	qty := func(id, m, b string) float64 {
		bm := cube[id][m]
		if b != "" {
			return bm[b]
		}
		v := 0.0
		for _, q := range bm {
			v += math.Max(0, q)
		}
		return v
	}
	avg := func(id, b string) float64 {
		v := 0.0
		for _, m := range recent {
			v += math.Max(0, qty(id, m, b))
		}
		return v / float64(len(recent))
	}
	active := []string{}
	for id := range cube {
		if (closed[id] == "" || closed[id] > cov.Cutoff) && (qty(id, period, "") > 0 || qty(id, prev, "") > 0) {
			active = append(active, id)
		}
	}
	sort.Strings(active)
	base := func(id string) map[string]any {
		c := db.Customers[id]
		return map[string]any{"id": id, "nama": first(c.Name, id), "kota": c.City, "hp": c.Phone, "nik": c.NIK, "sales": pm[c.NIK].Name}
	}
	dealers := []map[string]any{}
	area := func(id string) (string, string) {
		c := db.Customers[id]
		p := pm[c.NIK]
		return first(c.Region, first(p.Portfolio, p.Region)), p.BigRegion
	}
	peerBuckets := map[string][]float64{}
	for _, id := range active {
		sub, big := area(id)
		for _, b := range brands {
			if v := avg(id, b); v > 0 {
				for _, k := range []string{"S|" + sub, "B|" + big, "N|"} {
					key := core.Key(k, b)
					peerBuckets[key] = append(peerBuckets[key], v)
				}
			}
		}
	}
	for _, values := range peerBuckets {
		sort.Float64s(values)
	}
	for _, id := range active {
		d := base(id)
		total := avg(id, "")
		cells := map[string]any{}
		taken := 0
		for _, b := range brands {
			v := avg(id, b)
			if v > 0 {
				cells[b] = map[string]any{"has": 1, "avg": math.Round(v*10) / 10}
				taken++
				continue
			}
			// Match the legacy fallback: subregion, big region, then all scoped peers.
			sub, big := area(id)
			peers := []float64{}
			basis := ""
			for i, k := range []string{"S|" + sub, "B|" + big, "N|"} {
				values := peerBuckets[core.Key(k, b)]
				if len(values) > 0 && (len(values) >= 5 || i == 2) {
					peers = values
					basis = []string{"Sub Region " + sub, "Region " + big, "Nasional"}[i]
					break
				}
			}
			est := 0.0
			if len(peers) > 0 {
				median := peers[len(peers)/2]
				if len(peers)%2 == 0 {
					median = (median + peers[len(peers)/2-1]) / 2
				}
				est = math.Max(1, math.Round(math.Min(median, math.Max(1, total*.5))))
			}
			cells[b] = map[string]any{"has": 0, "est": est, "n": len(peers), "basis": basis}
		}
		d["avg"] = math.Round(total*10) / 10
		d["taken"] = taken
		d["cells"] = cells
		dealers = append(dealers, d)
	}
	sort.Slice(dealers, func(i, j int) bool { return dealers[i]["avg"].(float64) > dealers[j]["avg"].(float64) })
	react := []map[string]any{}
	back := []string{}
	for id := range cube {
		series := []float64{}
		sum, count := 0.0, 0
		for _, m := range months {
			q := qty(id, m, "")
			series = append(series, q)
			if m != period && q > 0 {
				sum += q
				count++
			}
		}
		cur, old := qty(id, period, ""), qty(id, prev, "")
		if cur > 0 && old == 0 && count > 0 {
			back = append(back, db.Customers[id].NIK)
		}
		if cur > 0 || count == 0 || closed[id] != "" && closed[id] <= cov.Cutoff {
			continue
		}
		status, weight := "PASIF", .4
		if old > 0 {
			status, weight = "DA BULAN LALU", 1
		} else if qty(id, core.Prev(prev), "") > 0 {
			status, weight = "IDLE", .7
		}
		d := base(id)
		v := sum / float64(count)
		d["status"] = status
		d["avg"] = math.Round(v*10) / 10
		d["series"] = series
		d["last"] = nullable(last[id])
		cut, _ := time.Parse("2006-01-02", cov.Cutoff)
		ld, _ := time.Parse("2006-01-02", last[id])
		d["jeda"] = int(cut.Sub(ld).Hours() / 24)
		d["score"] = v * weight
		react = append(react, d)
	}
	sort.Slice(react, func(i, j int) bool { return react[i]["score"].(float64) > react[j]["score"].(float64) })
	pairs := []map[string]any{}
	for k, f := range db.First {
		if !contains(ids, f.NIK) || len(f.Date) < 7 || f.Date > cov.Cutoff {
			continue
		}
		m := f.Date[:7]
		idx := -1
		for i, x := range months {
			if x == m {
				idx = i
			}
		}
		if idx < 0 {
			continue
		}
		pk := []string{}
		if json.Unmarshal([]byte(k), &pk) != nil || len(pk) != 2 {
			continue
		}
		id, b := pk[0], pk[1]
		c := db.Customers[id]
		pres := []int{}
		for _, x := range months[idx:] {
			v := 0
			if qty(id, x, b) > 0 {
				v = 1
			}
			pres = append(pres, v)
		}
		bs := map[string]bool{}
		for b, q := range cube[id][period] {
			if q > 0 {
				bs[b] = true
			}
		}
		again := false
		for _, dt := range later[k] {
			if dt > f.Date {
				again = true
			}
		}
		pairs = append(pairs, map[string]any{"c": id, "n": first(c.Name, id), "k": c.City, "hp": c.Phone, "b": b, "nik": f.NIK, "m": m, "d": f.Date, "pres": pres, "qM": qty(id, m, b), "qCur": qty(id, period, b), "multi": len(bs), "bl": keys(bs), "last": nullable(last[id]), "again": again})
	}
	sort.Slice(pairs, func(i, j int) bool { return fmtPair(pairs[i]) < fmtPair(pairs[j]) })
	return map[string]any{"period": period, "cutoff": cov.Cutoff, "closed": cov.Closed, "crossSell": map[string]any{"months": recent, "brands": brands, "dealers": dealers}, "reactivation": map[string]any{"months": months, "rows": react, "reactivated": back}, "noo": map[string]any{"prev": prev, "current": period, "months": months, "pairs": pairs}}
}

func fmtPair(p map[string]any) string { return p["c"].(string) + "|" + p["b"].(string) }
