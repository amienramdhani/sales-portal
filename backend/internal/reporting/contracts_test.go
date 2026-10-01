package reporting

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"salesportal/internal/core"
	"salesportal/internal/scope"
	"testing"
	"time"
)

func contractDB() *core.DB {
	return &core.DB{
		People:    []core.Person{{NIK: "M", Name: "Manager", Role: "ASM", BigRegion: "WEST"}, {NIK: "S", Name: "Sales", Role: "SALES", Sales: true, Supervisor: "M", BigRegion: "WEST", Region: "CITY"}, {NIK: "X", Name: "Outside", Role: "SALES", Sales: true, BigRegion: "EAST"}},
		Products:  map[string]core.Product{"A": {Brand: "A", Device: true}, "B": {Brand: "B", Device: true}},
		Customers: map[string]core.Customer{"D": {Name: "Dealer", NIK: "S", Region: "CITY"}, "R": {Name: "Reactivate", NIK: "S", Region: "CITY"}, "X": {Name: "Outside", NIK: "X"}},
		Coverage:  map[string]core.Coverage{"2026-08": {Cutoff: "2026-08-31", Closed: true}, "2026-09": {Cutoff: "2026-09-10"}},
		Rows:      map[string][]core.DailyRow{"2026-08": {{Date: "2026-08-01", NIK: "S", Customer: "D", Brand: "A", Qty: 4}, {Date: "2026-08-02", NIK: "S", Customer: "R", Brand: "B", Qty: 6}}, "2026-09": {{Date: "2026-09-01", NIK: "S", Customer: "D", Brand: "A", Qty: 3}, {Date: "2026-09-10", NIK: "S", Customer: "D", Brand: "A", Qty: 2}, {Date: "2026-09-10", NIK: "X", Customer: "X", Brand: "A", Qty: 99}}},
		Targets:   []core.Target{{Period: "2026-09", NIK: "S", Brand: "A", Metric: "QTY", Value: 10}, {Period: "2026-09", NIK: "S", Brand: "A", Metric: "DA", Value: 2}},
		First:     map[string]core.FirstPurchase{core.Key("D", "A"): {Date: "2026-08-01", NIK: "S"}},
		Unlinked:  map[string]bool{},
	}
}

func jsonObject(t *testing.T, v any) map[string]any {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	var out map[string]any
	if e = json.Unmarshal(b, &out); e != nil {
		t.Fatal(e)
	}
	return out
}

func TestTeamContractAndScope(t *testing.T) {
	db := contractDB()
	for _, level := range []string{"SALES", "ASM", "BIG REGION", "REGION"} {
		rows := teamRows(db, "2026-09", level, "A", []string{"S"})
		if len(rows) != 2 {
			t.Fatalf("%s rows: %v", level, rows)
		}
		for _, r := range rows {
			if r["total"].(core.Metrics).Qty != 5 || r["previous"].(core.Metrics).Qty != 4 {
				t.Fatalf("%s wrong metrics: %v", level, r)
			}
			if r["target"].(map[string]any)["value"] != float64(10) {
				t.Fatal(r)
			}
		}
	}
	rows := teamRows(db, "2026-09", "SALES", "B", []string{"S"})
	if rows[0]["total"].(core.Metrics).Qty != 0 {
		t.Fatal("brand filter ignored")
	}
	empty := teamRows(db, "2026-09", "SALES", "A", []string{})
	if len(empty) != 1 || empty[0]["total"].(core.Metrics).Qty != 0 {
		t.Fatal("empty scope leaked data")
	}
}

func TestMissingFilterValues(t *testing.T) {
	if textAny(nil) != "" || textAny(" ALL ") != "ALL" || upperAny(nil) != "" {
		t.Fatal("absent filters must remain empty")
	}
	if len(listAny(nil)) != 0 || intAny(nil, 10) != 10 {
		t.Fatal("absent filter defaults changed")
	}
}

func TestAnalysisContract(t *testing.T) {
	db := contractDB()
	a := analysisContract(db, "2026-09", []string{"S"}, nil)
	cross := a["crossSell"].(map[string]any)
	dealers := cross["dealers"].([]map[string]any)
	if len(dealers) != 2 {
		t.Fatalf("current and previous active dealers must appear: %v", dealers)
	}
	if dealers[0]["nik"] != "S" {
		t.Fatal("missing owner")
	}
	re := a["reactivation"].(map[string]any)["rows"].([]map[string]any)
	if len(re) != 1 || re[0]["status"] != "DA BULAN LALU" {
		t.Fatal(re)
	}
	pairs := a["noo"].(map[string]any)["pairs"].([]map[string]any)
	if len(pairs) != 1 || pairs[0]["qCur"] != float64(5) || len(pairs[0]["pres"].([]int)) != 2 {
		t.Fatal(pairs)
	}
	closed := analysisContract(db, "2026-09", []string{"S"}, map[string]string{"R": "2026-09-01"})
	if len(closed["reactivation"].(map[string]any)["rows"].([]map[string]any)) != 0 {
		t.Fatal("closed dealer included")
	}
	empty := jsonObject(t, analysisContract(db, "2026-09", []string{}, nil))
	if _, ok := empty["crossSell"].(map[string]any)["dealers"].([]any); !ok {
		t.Fatal("empty dealers must be []")
	}
	if _, ok := empty["noo"].(map[string]any)["pairs"].([]any); !ok {
		t.Fatal("empty pairs must be []")
	}
}

func TestExecutiveContract(t *testing.T) {
	nodes, daily, brands := executiveNodes(contractDB(), "2026-09", []string{"S"})
	if len(brands) != 2 {
		t.Fatal(brands)
	}
	for _, key := range []string{"N", "O", "B|WEST", "S|WEST|CITY", "P|S"} {
		n := nodes[key].(map[string]any)
		m := n["m"].(map[string]any)["A"].(map[string]any)
		q := m["st"].([]int64)
		if q[0] != 5 || q[1] != 4 || q[2] != 2 {
			t.Fatal(q)
		}
		if m["t"].(map[string]float64)["st"] != 10 {
			t.Fatal(m)
		}
	}
	if _, ok := nodes["P|X"]; ok {
		t.Fatal("outside scope")
	}
	if daily["N"].(map[string]map[string]int64)["2026-09-10"]["A"] != 2 {
		t.Fatal(daily)
	}
}

func TestTargetAndKPIJSON(t *testing.T) {
	db := contractDB()
	rows := []any{}
	for _, b := range []string{"A", "B"} {
		rows = append(rows, map[string]any{"target": targetContract(db, "2026-09", []string{"S"}, b, "QTY"), "targetDA": targetContract(db, "2026-09", []string{"S"}, b, "DA"), "targetNOO": targetContract(db, "2026-09", []string{"S"}, b, "NOO")})
	}
	target := combinedBrandTargets(rows)["target"].(map[string]any)
	if target["value"] != float64(10) || target["exists"] != false || len(target["missing"].([]string)) != 1 {
		t.Fatal(target)
	}
	k := jsonObject(t, core.KPI(db, "2026-09", []string{"S"}, "WEST"))
	for _, key := range []string{"region", "sub", "status", "groups"} {
		if _, ok := k[key]; !ok {
			t.Fatalf("missing KPI field %s: %v", key, k)
		}
	}
}

// Optional read-only integration check against the migrated database.
func TestMigratedDatabaseContracts(t *testing.T) {
	if os.Getenv("REPORTING_INTEGRATION") != "1" {
		t.Skip("set REPORTING_INTEGRATION=1 and DATABASE_URL")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := &Service{DB: pool, Scope: &scope.Resolver{DB: pool}, Location: time.UTC}
	var period, effective string
	if err = pool.QueryRow(ctx, "select max(period) from coverage where kind='ST'").Scan(&period); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "select nik from people_effective where effective_role='SUPER ADMIN' order by nik limit 1").Scan(&effective); err != nil {
		t.Fatal(err)
	}
	d, err := s.Dashboard(ctx, effective, period, "ALL")
	if err != nil {
		t.Fatal(err)
	}
	j := jsonObject(t, d)
	if _, ok := j["regionalKpi"].([]any); !ok {
		t.Fatal("regionalKpi is not an array")
	}
	if _, ok := j["brandTotals"].(map[string]any); !ok {
		t.Fatal("brandTotals missing")
	}
	for _, row := range j["daily"].([]any) {
		if _, ok := row.(map[string]any)["brands"].([]any); !ok {
			t.Fatal("daily brand quantities missing")
		}
	}
	a, err := s.Analisa(ctx, effective, period, "ALL")
	if err != nil {
		t.Fatal(err)
	}
	teams := map[string]any{}
	for _, level := range []string{"SALES", "ASM", "RGM", "BIG REGION", "REGION"} {
		r, e := s.Team(ctx, effective, period, "ALL", level, "ALL", nil)
		if e != nil {
			t.Fatal(e)
		}
		teams[level] = r
		if len(r) == 0 {
			t.Fatal("missing team totals")
		}
	}
	e, err := s.Executive(ctx, effective, period, "ALL")
	if err != nil {
		t.Fatal(err)
	}
	if path := os.Getenv("REPORTING_UI_FIXTURE"); path != "" {
		data, err := json.Marshal(map[string]any{"dashboard": d, "analysis": a, "teams": teams, "executive": e})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("contracts verified: %d brands, %d daily rows, %d regional KPIs", len(d.Brands), len(d.Daily), len(d.RegionalKPI))
}
