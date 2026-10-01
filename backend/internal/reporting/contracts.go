package reporting

import (
	"context"
	"fmt"
	"salesportal/internal/core"
	"sort"
)

func targetContract(db *core.DB, period string, ids []string, brand, metric string) map[string]any {
	value, missing, exists := core.TargetFor(db, period, ids, brand, metric, "")
	if brand == "ALL" && !exists {
		brands := map[string]bool{}
		for _, p := range db.Products {
			if p.Device {
				brands[p.Brand] = true
			}
		}
		miss := map[string]bool{}
		value = 0
		exists = len(brands) > 0
		for b := range brands {
			v, m, e := core.TargetFor(db, period, ids, b, metric, "")
			value += v
			exists = exists && e
			for _, id := range m {
				miss[id] = true
			}
		}
		missing = keys(miss)
	}
	return map[string]any{"value": value, "missing": missing, "exists": exists}
}

func combinedBrandTargets(brands []any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"target", "targetDA", "targetNOO"} {
		value, exists, missing := 0.0, len(brands) > 0, map[string]bool{}
		for _, row := range brands {
			t := row.(map[string]any)[key].(map[string]any)
			value += t["value"].(float64)
			exists = exists && t["exists"].(bool)
			for _, id := range t["missing"].([]string) {
				missing[id] = true
			}
		}
		out[key] = map[string]any{"value": value, "exists": exists, "missing": keys(missing)}
	}
	return out
}

type teamGroup struct {
	person core.Person
	ids    []string
}

func teamGroups(people []core.Person, ids []string, level string) []teamGroup {
	sales := map[string]bool{}
	for _, p := range people {
		if p.Sales && contains(ids, p.NIK) {
			sales[p.NIK] = true
		}
	}
	groups := []teamGroup{}
	if level == "BIG REGION" || level == "REGION" {
		buckets := map[string][]string{}
		for _, p := range people {
			if sales[p.NIK] {
				name := p.BigRegion
				if level == "REGION" {
					name = first(p.Portfolio, p.Region)
				}
				name = first(name, "LAINNYA")
				buckets[name] = append(buckets[name], p.NIK)
			}
		}
		for name, team := range buckets {
			groups = append(groups, teamGroup{core.Person{NIK: "AREA:" + name, Name: name, Role: level, Region: name}, team})
		}
	} else {
		for _, p := range people {
			team := []string{}
			if level == "SALES" {
				if sales[p.NIK] {
					team = append(team, p.NIK)
				}
			} else if p.Role == level {
				sub, _ := core.Scope(people, p.NIK)
				for _, id := range sub {
					if sales[id] {
						team = append(team, id)
					}
				}
			}
			if len(team) > 0 {
				groups = append(groups, teamGroup{p, team})
			}
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].person.Name < groups[j].person.Name })
	return groups
}

func teamRows(db *core.DB, period, level, brand string, ids []string) []map[string]any {
	groups := teamGroups(db.People, ids, level)
	union := map[string]bool{}
	for _, g := range groups {
		for _, id := range g.ids {
			union[id] = true
		}
	}
	groups = append(groups, teamGroup{core.Person{Name: "Total", Region: "Seluruh hasil tabel"}, keys(union)})
	prev, cut, available := core.ComparisonPeriod(db, period)
	pm := personMap(db.People)
	out := []map[string]any{}
	for _, g := range groups {
		p := g.person
		boss := pm[p.Supervisor]
		if level == "SALES" && p.Role == "ASM" {
			boss = p
		}
		out = append(out, map[string]any{"nik": p.NIK, "nama": p.Name, "role": p.Role, "region": first(p.Portfolio, p.Region), "boss": boss.Name, "bossRole": boss.Role, "acting": level == "SALES" && p.Role != "SALES" && p.NIK != "",
			"total": core.CalculateMetrics(core.Slice(db, period, g.ids, ""), db, period, brand, 2, 1), "previous": core.CalculateMetrics(core.SliceCompare(db, prev, g.ids, cut, period), db, prev, brand, 2, 1), "previousAvailable": available,
			"target": targetContract(db, period, g.ids, brand, "QTY"), "targetDA": targetContract(db, period, g.ids, brand, "DA"), "targetNOO": targetContract(db, period, g.ids, brand, "NOO")})
	}
	return out
}

func (s *Service) Team(ctx context.Context, effective, period, selection, level, brand string, filters map[string]any) ([]map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, err
	}
	me := personMap(people)[effective]
	area := level == "BIG REGION" || level == "REGION"
	if !inStrings([]string{"SALES", "ASM", "RGM", "BIG REGION", "REGION"}, level) || me.Role == "SALES" && level != "SALES" || !area && me.Role != "SALES" && core.Level[level] >= core.Level[me.Role] {
		return nil, fmt.Errorf("Tingkat tim tidak diizinkan")
	}
	ids, err = s.filterIDs(ctx, effective, ids, filters)
	if err != nil {
		return nil, err
	}
	db, err := s.LoadCoreDB(ctx, []string{period, core.Prev(period)})
	if err != nil {
		return nil, err
	}
	return teamRows(db, period, level, brand, ids), nil
}

func (s *Service) TeamKPI(ctx context.Context, effective, period, selection string, tree bool) ([]map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	db, err := s.LoadCoreDB(ctx, []string{period})
	if err != nil {
		return nil, err
	}
	pm := personMap(db.People)
	me := pm[effective]
	if core.Level[me.Role] < 2 {
		return nil, fmt.Errorf("Rincian tim KPI tidak tersedia untuk jabatan ini")
	}
	level := "SALES"
	if core.Level[me.Role] >= 4 || (me.Role == "ADMIN" && !inStrings([]string{"ASM", "RGM", "SALES"}, pm[selection].Role)) {
		level = "ASM"
	}
	out := []map[string]any{}
	if tree {
		return kpiTree(db, period, ids, core.Level[me.Role] >= 4), nil
	}
	for _, g := range teamGroups(db.People, ids, level) {
		p := g.person
		out = append(out, map[string]any{"nik": p.NIK, "nama": p.Name, "role": level, "region": p.BigRegion, "area": first(p.Portfolio, p.Region), "acting": level == "SALES" && p.Role != "SALES", "kpi": core.KPI(db, period, g.ids, p.BigRegion), "cutoff": db.Coverage[period].Cutoff, "noData": len(core.Slice(db, period, g.ids, "")) == 0, "partial": false, "children": []any{}})
	}
	return out, nil
}

func kpiTree(db *core.DB, period string, ids []string, top bool) []map[string]any {
	pm := personMap(db.People)
	nodes := map[string]map[string]any{}
	out := []map[string]any{}
	makeNode := func(p core.Person, own bool) map[string]any {
		team := []string{p.NIK}
		role := p.Role
		if own {
			role = "SALES"
		} else {
			sub, _ := core.Scope(db.People, p.NIK)
			team = []string{}
			for _, id := range sub {
				if contains(ids, id) {
					team = append(team, id)
				}
			}
		}
		return map[string]any{"nik": p.NIK, "nama": p.Name, "role": role, "acting": own && p.Role != "SALES", "region": p.BigRegion, "area": first(p.Portfolio, p.Region), "kpi": core.KPI(db, period, team, p.BigRegion), "cutoff": db.Coverage[period].Cutoff, "noData": len(core.Slice(db, period, team, "")) == 0, "partial": false, "children": []map[string]any{}}
	}
	for _, p := range db.People {
		if contains(ids, p.NIK) && (p.Role == "ASM" || !top && p.Role == "RGM") {
			nodes[p.NIK] = makeNode(p, false)
		}
	}
	parent := func(p core.Person) map[string]any {
		seen := map[string]bool{p.NIK: true}
		for id := p.Supervisor; id != "" && !seen[id]; id = pm[id].Supervisor {
			seen[id] = true
			if n := nodes[id]; n != nil {
				return n
			}
		}
		return nil
	}
	add := func(n, boss map[string]any) {
		if boss == nil {
			out = append(out, n)
		} else {
			boss["children"] = append(boss["children"].([]map[string]any), n)
		}
	}
	for _, p := range db.People {
		if n := nodes[p.NIK]; n != nil {
			var boss map[string]any
			if !top {
				boss = parent(p)
			}
			add(n, boss)
		}
	}
	if !top {
		for _, p := range db.People {
			if p.Sales && contains(ids, p.NIK) {
				boss := nodes[p.NIK]
				if boss == nil {
					boss = parent(p)
				}
				add(makeNode(p, true), boss)
			}
		}
	}
	return out
}
