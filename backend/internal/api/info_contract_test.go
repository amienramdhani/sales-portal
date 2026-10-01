package api

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"salesportal/internal/auth"
	"salesportal/internal/core"
	"salesportal/internal/reporting"
	"salesportal/internal/scope"
	"testing"
	"time"
)

func TestMigratedAPIContracts(t *testing.T) {
	if os.Getenv("REPORTING_INTEGRATION") != "1" {
		t.Skip("set REPORTING_INTEGRATION=1 and DATABASE_URL")
	}
	ctx := context.Background()
	pool, e := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	sc := &scope.Resolver{DB: pool}
	s := &Server{Scope: sc, Reporting: &reporting.Service{DB: pool, Scope: sc, Location: time.UTC}}
	var period, nik string
	if e = pool.QueryRow(ctx, "select max(period) from coverage where kind='ST'").Scan(&period); e != nil {
		t.Fatal(e)
	}
	if e = pool.QueryRow(ctx, "select nik from people_effective where effective_role='SUPER ADMIN' order by nik limit 1").Scan(&nik); e != nil {
		t.Fatal(e)
	}
	sess := auth.Session{NIK: nik, EffectiveNIK: nik, Role: "SUPER ADMIN"}
	results := map[string]any{}
	cases := []struct {
		name   string
		params map[string]any
	}{
		{"apiDashboard", map[string]any{"period": period, "selection": "ALL"}},
		{"apiAnalisa", map[string]any{"period": period, "selection": "ALL"}},
		{"apiExec", map[string]any{"period": period, "selection": "ALL"}},
		{"apiCompare", map[string]any{"period": period, "selection": "ALL", "opts": map[string]any{"brand": "ALL", "view": "BRAND"}}},
		{"apiGrowthType", map[string]any{"period": period, "selection": "ALL", "brand": "ALL", "opts": map[string]any{}}},
		{"apiInfo", map[string]any{"page": 0, "query": "", "region": "ALL"}},
		{"apiAdmin", map[string]any{}},
		{"apiTeam", map[string]any{"period": period, "selection": "ALL", "level": "SALES", "brand": "ALL", "filters": map[string]any{}}},
		{"apiTeamKpi", map[string]any{"period": period, "selection": "ALL"}},
		{"apiKpiTree", map[string]any{"period": period, "selection": "ALL"}},
		{"apiRank", map[string]any{"period": period, "level": "SALES", "national": true}},
		{"apiMyRank", map[string]any{"period": period, "selection": "ALL"}},
		{"apiDOS", map[string]any{"period": period, "selection": "ALL", "filter": map[string]any{}, "page": 1}},
		{"apiTransactions", map[string]any{"period": period, "selection": "ALL", "customer": "", "page": 1, "dateFrom": period + "-01", "dateTo": period + "-28", "pageSize": 100}},
		{"apiTransactionGroups", map[string]any{"period": period, "selection": "ALL", "page": 0, "from": period + "-01", "to": period + "-28", "pageSize": 100, "sort": map[string]any{"col": "date", "dir": "desc"}}},
		{"apiDealerHistory", map[string]any{"selection": "ALL", "brand": "ALL", "from": period, "to": period, "page": 1, "query": "", "filters": map[string]any{}}},
		{"apiDealerHistorySummary", map[string]any{"selection": "ALL", "brand": "ALL", "from": period, "to": period, "query": "", "filters": map[string]any{}, "level": "BIG"}},
	}
	for _, tc := range cases {
		name := tc.name
		value, status, err := s.call(ctx, sess, name, tc.params)
		if err != nil || status != 200 {
			t.Fatalf("%s: status %d error %v", name, status, err)
		}
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var decoded any
		if err = json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		results[name] = decoded
		if name == "apiInfo" {
			m := decoded.(map[string]any)
			if _, ok := m["regions"].([]any); !ok {
				t.Fatal("missing info regions")
			}
			if _, ok := m["rows"].([]any); !ok {
				t.Fatal("missing info rows")
			}
		}
		if name == "apiAdmin" {
			m := decoded.(map[string]any)
			for _, key := range []string{"regions", "regionMap", "managedRegions", "users", "parts", "brands", "bosses"} {
				if _, ok := m[key].([]any); !ok {
					t.Fatalf("missing admin %s", key)
				}
			}
		}
		if name == "apiTeam" || name == "apiTeamKpi" || name == "apiKpiTree" {
			if _, ok := decoded.([]any); !ok {
				t.Fatalf("%s must return an array", name)
			}
		}
		if name == "apiDashboard" {
			m := decoded.(map[string]any)
			for _, key := range []string{"brands", "customers", "daily", "regionalKpi", "regionalBrands", "brandTotals"} {
				if _, ok := m[key]; !ok {
					t.Fatalf("missing dashboard %s", key)
				}
			}
		}
		if name == "apiAnalisa" {
			m := decoded.(map[string]any)
			for _, key := range []string{"crossSell", "reactivation", "noo"} {
				if _, ok := m[key].(map[string]any); !ok {
					t.Fatalf("missing analysis %s", key)
				}
			}
		}
		if name == "apiExec" {
			m := decoded.(map[string]any)
			for _, key := range []string{"nodes", "brands", "daily", "dealers"} {
				if _, ok := m[key]; !ok {
					t.Fatalf("missing executive %s", key)
				}
			}
		}
		if name == "apiRank" {
			if _, ok := decoded.([]any); !ok {
				t.Fatal("rank must return an array")
			}
		}
		if name == "apiDOS" || name == "apiDealerHistory" || name == "apiDealerHistorySummary" || name == "apiTransactions" {
			m := decoded.(map[string]any)
			if _, ok := m["rows"].([]any); !ok {
				t.Fatalf("%s rows missing", name)
			}
		}
		if name == "apiTransactionGroups" {
			m := decoded.(map[string]any)
			if m["page"] != float64(0) {
				t.Fatal("page must start at zero")
			}
			for _, r := range m["rows"].([]any) {
				if _, ok := r.(map[string]any)["rows"].([]any); !ok {
					t.Fatal("missing grouped transaction rows")
				}
			}
		}
	}
	if path := os.Getenv("REPORTING_API_FIXTURE"); path != "" {
		data, err := json.Marshal(results)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestInfoAudience(t *testing.T) {
	if str(map[string]any{}, "query") != "" || str(map[string]any{"query": nil}, "query") != "" {
		t.Fatal("missing parameters must be empty")
	}
	p := core.Person{Role: "SALES", BigRegion: "WEST"}
	if !infoVisible(p, []string{"NASIONAL"}, []string{"ALL"}) {
		t.Fatal("national information hidden")
	}
	if infoVisible(p, []string{"EAST"}, []string{"ALL"}) {
		t.Fatal("outside region visible")
	}
	if infoVisible(p, []string{"WEST"}, []string{"ASM"}) {
		t.Fatal("wrong role visible")
	}
	if !infoVisible(core.Person{Role: "ADMIN", AdminRegions: []string{"WEST"}}, []string{"WEST"}, []string{"ADMIN"}) {
		t.Fatal("admin region hidden")
	}
}
