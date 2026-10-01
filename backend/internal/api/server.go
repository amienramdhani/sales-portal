package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"salesportal/internal/auth"
	"salesportal/internal/config"
	"salesportal/internal/core"
	"salesportal/internal/importer"
	"salesportal/internal/reporting"
	"salesportal/internal/scope"
)

type Server struct {
	Cfg          config.Config
	Auth         *auth.Service
	Scope        *scope.Resolver
	Reporting    *reporting.Service
	Importer     *importer.Importer
	StaticDir    string
	WorkerStatus func() map[string]any
	requests     *prometheus.CounterVec
	latency      *prometheus.HistogramVec
}

type ctxKey string

const sessionKey ctxKey = "session"

func New(cfg config.Config, a *auth.Service, sc *scope.Resolver, rp *reporting.Service, im *importer.Importer, static string) *Server {
	s := &Server{Cfg: cfg, Auth: a, Scope: sc, Reporting: rp, Importer: im, StaticDir: static}
	s.requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "salesportal_http_requests_total", Help: "HTTP requests"}, []string{"route", "status"})
	s.latency = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "salesportal_http_request_duration_seconds", Help: "HTTP latency", Buckets: prometheus.DefBuckets}, []string{"route"})
	prometheus.MustRegister(s.requests, s.latency)
	return s
}
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(s.recoverer, s.requestID, s.accessLog)
	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)
	r.Handle("/metrics", promhttp.Handler())
	r.Post("/api/apiLogin", s.login)
	for _, c := range Contracts {
		if c.Name == "apiLogin" {
			continue
		}
		name := c.Name
		r.Post("/api/"+name, s.withSession(name, s.compat(name)))
	}
	// if s.StaticDir != "" {
	// 	fs := http.FileServer(http.Dir(s.StaticDir))
	// 	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	// 		p := filepath.Join(s.StaticDir, filepath.Clean(req.URL.Path))
	// 		if st, err := os.Stat(p); err == nil && !st.IsDir() {
	// 			fs.ServeHTTP(w, req)
	// 			return
	// 		}
	// 		req.URL.Path = "/"
	// 		fs.ServeHTTP(w, req)
	// 	}))
	// }
	if s.StaticDir != "" {
		fs := http.FileServer(http.Dir(s.StaticDir))
		r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			p := filepath.Join(s.StaticDir, filepath.Clean(req.URL.Path))

			if st, err := os.Stat(p); err == nil {
				if st.IsDir() {
					index := filepath.Join(p, "index.html")
					if _, err := os.Stat(index); err == nil {
						fs.ServeHTTP(w, req)
						return
					}
				} else {
					fs.ServeHTTP(w, req)
					return
				}
			}

			req.URL.Path = "/"
			fs.ServeHTTP(w, req)
		}))
	}
	return r
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var p map[string]any
	if !decode(r, &p) {
		writeErr(w, 400, "JSON tidak valid")
		return
	}
	sess, must, err := s.Auth.Login(r.Context(), str(p, "nik"), str(p, "pin"))
	if err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	s.setCookie(w, sess.ID, sess.ExpiresAt)
	writeJSON(w, 200, map[string]any{"token": sess.ID, "mustChange": must, "user": map[string]any{"nik": sess.EffectiveNIK, "role": sess.Role}})
}
func (s *Server) withSession(name string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Compatibility clients (the exact legacy UI) explicitly send token as the first API argument.
		// Prefer that token over the cookie so a freshly issued token after PIN change is honored immediately.
		b, _ := io.ReadAll(r.Body)
		var p map[string]any
		_ = json.Unmarshal(b, &p)
		r.Body = io.NopCloser(strings.NewReader(string(b)))
		id := str(p, "token")
		if id == "" {
			if c, e := r.Cookie(s.Cfg.SessionCookieName); e == nil {
				id = c.Value
			}
		}
		if id == "" {
			writeErr(w, 401, "Sesi tidak ditemukan")
			return
		}
		sess, err := s.Auth.GetSession(r.Context(), id)
		if err != nil {
			writeErr(w, 401, "Sesi berakhir. Silakan masuk kembali.")
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey, sess)
		next(w, r.WithContext(ctx))
	}
}
func sessionFrom(r *http.Request) auth.Session { return r.Context().Value(sessionKey).(auth.Session) }
func (s *Server) setCookie(w http.ResponseWriter, id string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{Name: s.Cfg.SessionCookieName, Value: id, Path: "/", Expires: exp, HttpOnly: true, Secure: s.Cfg.Env == "production", SameSite: http.SameSiteLaxMode})
}
func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: s.Cfg.SessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.Cfg.Env == "production", SameSite: http.SameSiteLaxMode})
}

func (s *Server) compat(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p map[string]any
		if !decode(r, &p) {
			writeErr(w, 400, "JSON tidak valid")
			return
		}
		sess := sessionFrom(r)
		res, code, err := s.call(r.Context(), sess, name, p)
		if err != nil {
			writeErr(w, code, err.Error())
			return
		}
		writeJSON(w, code, res)
	}
}

func (s *Server) call(ctx context.Context, sess auth.Session, name string, p map[string]any) (any, int, error) {
	// Demo mode is read-only for business writes, but the user must always be able to stop demo or log out.
	if sess.Demo && isWrite(name) && name != "apiStopDemo" && name != "apiLogout" {
		return nil, 403, errors.New("Mode Demo hanya-baca")
	}
	// During parallel operation Apps Script is the only operational writer. The Go side is deliberately
	// read-only (apart from session/demo lifecycle) so the two systems cannot diverge.
	if s.Cfg.ParallelMode && isWrite(name) && name != "apiStartDemo" && name != "apiStopDemo" && name != "apiLogout" {
		return nil, 409, errors.New("Mode paralel: perubahan data tetap dilakukan di Sales Portal Apps Script")
	}
	switch name {
	case "apiLogout":
		_ = s.Auth.Logout(ctx, sess.ID)
		return true, 200, nil
	case "apiResetPin":
		return s.resetPin(ctx, sess, p)
	case "apiSetActive":
		return s.setActive(ctx, sess, p)
	case "apiChangePin":
		pin := str(p, "pin")
		if e := s.Auth.ChangePIN(ctx, sess, pin); e != nil {
			return nil, 400, e
		}
		ns, _, e := s.Auth.Login(ctx, sess.NIK, pin)
		if e != nil {
			return nil, 500, e
		}
		return map[string]any{"token": ns.ID}, 200, nil
	case "apiStartDemo":
		ns, e := s.Auth.StartDemo(ctx, sess, str(p, "targetNik"))
		if e != nil {
			return nil, 403, e
		}
		return map[string]any{"ok": true, "token": ns.ID, "demo": true}, 200, nil
	case "apiStopDemo":
		ns, e := s.Auth.StopDemo(ctx, sess)
		if e != nil {
			return nil, 400, e
		}
		return map[string]any{"ok": true, "token": ns.ID, "demo": false}, 200, nil
	case "apiDemoOptions":
		return s.demoOptions(ctx, sess)
	case "apiBootstrap", "apiV6Boot":
		return s.bootstrap(ctx, sess)
	case "apiDashboard":
		x, e := s.Reporting.Dashboard(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"))
		return x, code(e), e
	case "apiAnalisa":
		x, e := s.Reporting.Analisa(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"))
		return x, code(e), e
	case "apiPotensi":
		x, e := s.Reporting.Potensi(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"))
		return x, code(e), e
	case "apiCompare":
		x, e := s.Reporting.Compare(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), mapval(p, "opts"))
		return x, code(e), e
	case "apiGrowthType":
		opts := mapval(p, "opts")
		if opts == nil {
			opts = map[string]any{}
		}
		opts["view"] = "TYPE"
		opts["brand"] = str(p, "brand")
		opts["level"] = "SALES"
		x, e := s.Reporting.Compare(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), opts)
		return x, code(e), e
	case "apiWeeklyAnalysis":
		x, e := s.Reporting.WeeklyAnalysis(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), mapval(p, "request"))
		return x, code(e), e
	case "apiTeamComparison":
		x, e := s.Reporting.TeamComparison(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), mapval(p, "request"))
		return x, code(e), e
	case "apiEarlyWarning":
		x, e := s.Reporting.EarlyWarning(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "level"), str(p, "brand"), str(p, "metric"), str(p, "selection"), mapval(p, "filters"))
		return x, code(e), e
	case "apiExec":
		x, e := s.Reporting.Executive(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"))
		return x, code(e), e
	case "apiDealerDetail":
		x, e := s.Reporting.DealerDetail(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), str(p, "customer"))
		return x, code(e), e
	case "apiDealerHistory":
		x, e := s.Reporting.DealerHistory(ctx, sess.EffectiveNIK, str(p, "selection"), str(p, "brand"), str(p, "from"), str(p, "to"), intval(p, "page", 1), str(p, "query"), mapval(p, "filters"))
		return x, code(e), e
	case "apiDealerHistorySummary":
		x, e := s.Reporting.DealerHistorySummary(ctx, sess.EffectiveNIK, str(p, "selection"), str(p, "brand"), str(p, "from"), str(p, "to"), str(p, "query"), mapval(p, "filters"), str(p, "level"))
		return x, code(e), e
	case "apiTransactions":
		x, e := s.Reporting.Transactions(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), str(p, "customer"), str(p, "dateFrom"), str(p, "dateTo"), intval(p, "page", 1), intval(p, "pageSize", 100))
		return x, code(e), e
	case "apiTransactionGroups":
		x, e := s.Reporting.TransactionGroups(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), str(p, "from"), str(p, "to"), intval(p, "page", 0), intval(p, "pageSize", 100), mapval(p, "sort"))
		return x, code(e), e
	case "apiRank":
		x, e := s.Reporting.Rank(ctx, sess.EffectiveNIK, str(p, "period"), strings.ToUpper(str(p, "level")), boolval(p, "national"))
		return x, code(e), e
	case "apiPersonKpi", "apiRankDetail":
		return s.personKPI(ctx, sess, str(p, "period"), str(p, "nik"))
	case "apiMyRank":
		return s.myRank(ctx, sess, str(p, "period"), str(p, "selection"))
	case "apiTeam":
		x, e := s.Reporting.Team(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), str(p, "level"), str(p, "brand"), mapval(p, "filters"))
		return x, code(e), e
	case "apiTeamKpi", "apiKpiTree":
		x, e := s.Reporting.TeamKPI(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), name == "apiKpiTree")
		return x, code(e), e
	case "apiDOS":
		x, e := s.Reporting.DOS(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), mapval(p, "filter"), intval(p, "page", 1))
		return x, code(e), e
	case "apiDealerStock":
		x, e := s.Reporting.DealerStock(ctx, sess.EffectiveNIK, str(p, "period"), str(p, "selection"), str(p, "customer"))
		return x, code(e), e
	case "apiHealthCheck":
		return s.healthReport(ctx, sess)
	case "apiAdmin":
		return s.adminSummary(ctx, sess)
	case "apiBackupSettings":
		return s.backupSettings(ctx, sess, p)
	case "apiStartBackup":
		return s.startBackup(ctx, sess)
	case "apiActivity", "apiAdminBanner", "apiCheckpoints":
		return s.activity(ctx, sess, p)
	case "apiPeriodLock":
		return s.periodLock(ctx, sess, p)
	case "apiRegionMapGet":
		return s.regionMapGet(ctx, sess)
	case "apiRegionMapSave":
		return s.regionMapSave(ctx, sess, p)
	case "apiSyncStatus":
		return s.syncStatus(ctx, sess)
	case "apiSyncFileDownload":
		return s.syncFileDownload(ctx, sess, p)
	case "apiSyncRetry":
		return s.syncRetry(ctx, sess, p)
	case "apiSyncRunNow":
		return map[string]any{"ok": true, "message": "Worker akan melakukan polling pada siklus terdekat; jalankan container worker dengan --once untuk eksekusi langsung."}, 200, nil
	case "apiSyncSchedule":
		return s.syncSchedule(ctx, sess, p)
	case "apiInfo":
		return s.infoContract(ctx, sess, p)
	case "apiDownloadInfo":
		return s.downloadInfo(ctx, sess, p)
	case "apiSetInfoActive":
		return s.infoSetActive(ctx, sess, p)
	case "apiSaveExportAccess":
		return s.saveExportAccess(ctx, sess, p)
	case "apiDealerTutupList":
		return s.dealerClosureList(ctx, sess)
	case "apiDealerTutupAjukan":
		return s.dealerClosureSubmit(ctx, sess, p)
	case "apiDealerTutupProses":
		return s.dealerClosureProcess(ctx, sess, p)
	case "apiDealerRegionGet", "apiDealerRegionLookup":
		return s.dealerRegion(ctx, sess, p)
	case "apiTargetGet":
		return s.targetGet(ctx, sess, p)
	case "apiKpiGet":
		return s.kpiGet(ctx, sess, p)
	case "apiAIOptions":
		return map[string]any{"enabled": s.Cfg.AIAPIKey != "", "model": s.Cfg.AIModel, "quick": []string{"Pencapaian saya", "Dealer belum order", "Risiko KPI", "Sales yang belum jualan"}}, 200, nil
	case "apiAIChat":
		return s.aiChat(ctx, sess, p)
	case "apiHariLibur", "apiHariLiburAdmin":
		return s.holidays(ctx, sess, name)
	case "apiHariLiburSave":
		return s.holidaySave(ctx, sess, p)
	case "apiHariLiburHapus":
		return s.holidayDelete(ctx, sess, p)
	case "apiBrandExportOptions", "apiKPIExportOptions", "apiDOSExportOptions":
		return s.exportOptions(ctx, sess, name, p)
	case "apiBrandExportData":
		return s.brandExportData(ctx, sess, p)
	case "apiDOSExportData":
		return s.dosExportData(ctx, sess, p)
	case "apiKPIExportData":
		return s.kpiExportData(ctx, sess, p)
	case "apiExportSummary":
		return s.exportSummary(ctx, sess, p)
	case "apiDealerSearch":
		return s.dealerSearch(ctx, sess, p)
	case "apiDealerEditDetail":
		return s.dealerEditDetail(ctx, sess, p)
	case "apiContactRequests":
		return s.contactRequests(ctx, sess, p)
	case "apiDealerContact":
		return s.dealerContact(ctx, sess, p)
	case "apiSubmitDealerContact":
		return s.submitDealerContact(ctx, sess, p)
	case "apiReviewDealerContacts":
		return s.reviewDealerContacts(ctx, sess, p)
	case "apiSaveDealerContact":
		return s.saveDealerContact(ctx, sess, p)
	case "apiExportDealerContacts":
		return s.exportDealerContacts(ctx, sess)
	case "apiAccountDeleteCheck":
		return s.accountDeleteCheck(ctx, sess, p)
	case "apiAccountMergePreview":
		return s.accountMergePreview(ctx, sess, p)
	case "apiDealerDeleteCheck":
		return s.dealerDeleteCheck(ctx, sess, p)
	case "apiDealerDownloadAll":
		return s.dealerDownloadAll(ctx, sess)
	case "apiDealerIndukPeek":
		return s.dealerIndukPeek(ctx, sess, p)
	case "apiDealerRegionSave":
		return s.dealerRegionSave(ctx, sess, p)
	case "apiDealerTemplate":
		return s.dealerTemplate(ctx, sess)
	case "apiRegionImportTemplate":
		return s.regionImportTemplate(ctx, sess, p)
	case "apiTransferDealerTemplate":
		return s.transferDealerTemplate(ctx, sess)
	case "apiUserTemplate":
		return s.userTemplate(ctx, sess)
	case "apiUserPinExport":
		return s.userPinExport(ctx, sess, p)
	case "apiTransferRejected", "apiUsersRejected":
		return s.importRejected(ctx, sess, name, p)
	case "apiExportDealerExcel":
		return s.dealerExportData(ctx, sess, p)
	case "apiExportDealerCsv":
		return s.exportDealerCSV(ctx, sess, p)
	case "apiExportDealerHistory":
		return s.exportDealerHistory(ctx, sess, p)
	}
	// Full endpoint surface is registered. APIs not yet specialized are handled by the compatibility data layer.
	return s.genericCompatibility(ctx, sess, name, p)
}

func (s *Server) bootstrap(ctx context.Context, sess auth.Session) (any, int, error) {
	people, e := s.Scope.People(ctx)
	if e != nil {
		return nil, 500, e
	}
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	set := map[string]bool{}
	for _, x := range ids {
		set[x] = true
	}
	pp := []any{}
	for _, x := range people {
		if set[x.NIK] {
			pp = append(pp, x)
		}
	}
	rows, e := s.Reporting.DB.Query(ctx, `select distinct period from coverage order by period desc`)
	if e != nil {
		return nil, 500, e
	}
	periods := []string{}
	for rows.Next() {
		var x string
		_ = rows.Scan(&x)
		periods = append(periods, x)
	}
	rows.Close()
	exp := map[string]bool{}
	rr, e := s.Reporting.DB.Query(ctx, `select jenis_export,aktif from export_access where nik=$1`, sess.EffectiveNIK)
	if e == nil {
		for rr.Next() {
			var k string
			var v bool
			_ = rr.Scan(&k, &v)
			exp[k] = v
		}
		rr.Close()
	}
	var uname, uregion, uwilayah string
	_ = s.Reporting.DB.QueryRow(ctx, `select nama,region,wilayah from people_effective where nik=$1`, sess.EffectiveNIK).Scan(&uname, &uregion, &uwilayah)
	demo := map[string]any{"active": sess.Demo, "canStart": sess.NIK == sess.EffectiveNIK && sess.Role == "SUPER ADMIN", "readOnly": sess.Demo}
	if sess.Demo {
		demo["target"] = map[string]any{"nik": sess.EffectiveNIK, "nama": uname, "role": sess.Role, "wilayah": uwilayah, "region": uregion}
	}
	return map[string]any{"user": map[string]any{"nik": sess.EffectiveNIK, "nama": uname, "role": sess.Role, "region": uregion, "wilayah": uwilayah}, "people": pp, "periods": periods, "processed": time.Now().In(s.Reporting.Location).Format(time.RFC3339), "version": "go-v2", "exportAccess": exp, "demo": demo}, 200, nil
}
func (s *Server) demoOptions(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "SUPER ADMIN" && sess.NIK == sess.EffectiveNIK {
		return nil, 403, errors.New("khusus Super Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select p.nik,p.nama,p.effective_role from people_effective p join auth_accounts a on a.nik=p.nik where a.aktif=true and p.effective_role not in ('ADMIN','SUPER ADMIN') order by p.effective_role,p.nama`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var n, na, ro string
		_ = rows.Scan(&n, &na, &ro)
		o = append(o, map[string]any{"nik": n, "nama": na, "role": ro})
	}
	return o, 200, nil
}
func (s *Server) personKPI(ctx context.Context, sess auth.Session, period, nik string) (any, int, error) {
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, nik)
	if e != nil {
		return nil, 403, e
	}
	db, e := s.Reporting.LoadCoreDB(ctx, []string{period})
	if e != nil {
		return nil, 500, e
	}
	var region, role string
	for _, p := range db.People {
		if p.NIK == nik {
			region = p.BigRegion
			role = p.Role
		}
	}
	if role == "SALES" {
		ids = []string{nik}
	}
	return core.KPI(db, period, ids, region), 200, nil
}
func (s *Server) myRank(ctx context.Context, sess auth.Session, period, sel string) (any, int, error) {
	nik := sess.EffectiveNIK
	if sel != "" && sel != "ALL" {
		nik = sel
	}
	var role, name, region string
	if e := s.Reporting.DB.QueryRow(ctx, `select effective_role,nama,wilayah from people_effective where nik=$1`, nik).Scan(&role, &name, &region); e != nil {
		return nil, 404, e
	}
	if role != "SALES" && role != "ASM" {
		return map[string]any{"eligible": false, "message": "Peringkat individu tersedia untuk Sales dan ASM."}, 200, nil
	}
	rows, e := s.Reporting.Rank(ctx, sess.EffectiveNIK, period, role, true)
	if e != nil {
		return nil, 500, e
	}
	for _, r := range rows {
		if fmt.Sprint(r["nik"]) == nik {
			return map[string]any{"eligible": true, "nik": nik, "nama": name, "role": role, "region": region, "score": r["score"], "status": r["status"], "nationalRank": r["rank"], "nationalTotal": len(rows)}, 200, nil
		}
	}
	return map[string]any{"eligible": false, "message": "Rincian peringkat tidak tersedia dalam izin akun ini."}, 200, nil
}
func (s *Server) teamSummary(ctx context.Context, sess auth.Session, period, sel string) (any, int, error) {
	d, e := s.Reporting.Dashboard(ctx, sess.EffectiveNIK, period, sel)
	if e != nil {
		return nil, code(e), e
	}
	return map[string]any{"period": period, "total": d.Total, "brands": d.Brands, "customers": d.Customers, "kpi": d.KPI, "scopeCount": d.ScopeCount}, 200, nil
}
func (s *Server) healthReport(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "SUPER ADMIN" && sess.Role != "ADMIN" {
		return nil, 403, errors.New("menu kesehatan khusus admin")
	}
	checks := map[string]any{}
	for _, q := range []struct{ name, sql string }{{"people", "select count(*) from people_effective"}, {"customers", "select count(*) from customers"}, {"products", "select count(*) from products"}, {"st", "select count(*) from st_lines"}, {"so", "select count(*) from so_lines"}} {
		var n int64
		e := s.Reporting.DB.QueryRow(ctx, q.sql).Scan(&n)
		checks[q.name] = map[string]any{"count": n, "ok": e == nil}
	}
	return map[string]any{"ok": true, "checks": checks}, 200, nil
}
func (s *Server) adminSummary(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	superuser := sess.Role == "SUPER ADMIN"
	tables := []string{"people", "customers", "products", "st_lines", "so_lines", "targets", "kpi_policies"}
	counts := map[string]int64{}
	for _, t := range tables {
		var n int64
		_ = s.Reporting.DB.QueryRow(ctx, "select count(*) from "+t).Scan(&n)
		counts[t] = n
	}

	regionMap, regions, err := s.adminRegions(ctx)
	if err != nil {
		return nil, 500, err
	}
	managedRegions, err := s.adminManagedRegions(ctx, sess)
	if err != nil {
		return nil, 500, err
	}
	brands, err := s.adminDeviceBrands(ctx)
	if err != nil {
		return nil, 500, err
	}
	parts, err := s.adminCoverageParts(ctx)
	if err != nil {
		return nil, 500, err
	}
	users, bosses, err := s.adminUsers(ctx, superuser, managedRegions)
	if err != nil {
		return nil, 500, err
	}
	locks := []any{}
	if superuser {
		locks, err = s.adminPeriodLocks(ctx)
		if err != nil {
			return nil, 500, err
		}
	}
	return map[string]any{
		"superuser":           superuser,
		"url":                 "",
		"notes":               []string{},
		"counts":              counts,
		"regions":             regions,
		"brands":              brands,
		"regionMap":           regionMap,
		"managedRegions":      managedRegions,
		"periods":             map[string]any{},
		"processed":           []any{},
		"parts":               parts,
		"users":               users,
		"bosses":              bosses,
		"locks":               locks,
		"versions":            []any{},
		"backup":              map[string]any{"running": false, "overdue": false, "last": nil, "lastEvent": nil, "secondary": nil, "retention": 14},
		"exportAccess":        nil,
		"parallelMode":        s.Cfg.ParallelMode,
		"manualUploadEnabled": !s.Cfg.ParallelMode,
	}, 200, nil
}

func (s *Server) adminRegions(ctx context.Context) ([]any, []string, error) {
	rows, err := s.Reporting.DB.Query(ctx, `select region,wilayah_kpi,kanal from regions order by wilayah_kpi,region`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	regionMap := []any{}
	seen := map[string]bool{}
	regions := []string{}
	for rows.Next() {
		var region, wilayah, kanal string
		if err = rows.Scan(&region, &wilayah, &kanal); err != nil {
			return nil, nil, err
		}
		regionMap = append(regionMap, map[string]any{"REGION": region, "WILAYAH_KPI": wilayah, "KANAL": kanal})
		if wilayah != "" && !seen[wilayah] {
			seen[wilayah] = true
			regions = append(regions, wilayah)
		}
	}
	sort.Strings(regions)
	return regionMap, regions, rows.Err()
}

func (s *Server) adminManagedRegions(ctx context.Context, sess auth.Session) ([]string, error) {
	if sess.Role == "SUPER ADMIN" {
		_, regions, err := s.adminRegions(ctx)
		return regions, err
	}
	rows, err := s.Reporting.DB.Query(ctx, `select wilayah from admin_regions where nik=$1 order by wilayah`, sess.EffectiveNIK)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var region string
		if err = rows.Scan(&region); err != nil {
			return nil, err
		}
		out = append(out, region)
	}
	return out, rows.Err()
}

func (s *Server) adminDeviceBrands(ctx context.Context) ([]string, error) {
	rows, err := s.Reporting.DB.Query(ctx, `select distinct brand from products where masuk_qty=true and brand<>'' order by brand`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var brand string
		if err = rows.Scan(&brand); err != nil {
			return nil, err
		}
		out = append(out, brand)
	}
	return out, rows.Err()
}

func (s *Server) adminCoverageParts(ctx context.Context) ([]any, error) {
	rows, err := s.Reporting.DB.Query(ctx, `select kind,period,region,cutoff::text from coverage order by period desc,kind,region`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []any{}
	for rows.Next() {
		var kind, period, region, cutoff string
		if err = rows.Scan(&kind, &period, &region, &cutoff); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"kind": kind, "period": period, "region": region, "cutoff": cutoff})
	}
	return out, rows.Err()
}

func (s *Server) adminUsers(ctx context.Context, superuser bool, managedRegions []string) ([]any, []any, error) {
	rows, err := s.Reporting.DB.Query(ctx, `
select p.nik,p.nama,p.effective_role,p.region,p.nik_atasan,p.sales_flag,p.portfolio,p.wilayah,
       coalesce(a.aktif,false),coalesce(a.pin_hash,'')<>'',
       coalesce(array_agg(ar.wilayah order by ar.wilayah) filter (where ar.wilayah is not null),'{}')
from people_effective p
left join auth_accounts a on a.nik=p.nik
left join admin_regions ar on ar.nik=p.nik
where p.nik<>'-'
group by p.nik,p.nama,p.effective_role,p.region,p.nik_atasan,p.sales_flag,p.portfolio,p.wilayah,a.aktif,a.pin_hash
order by p.nama,p.nik`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	users := []any{}
	bosses := []any{}
	for rows.Next() {
		var nik, nama, role, region, atasan, portfolio, wilayah string
		var sales, active, hasPin bool
		adminRegions := []string{}
		if err = rows.Scan(&nik, &nama, &role, &region, &atasan, &sales, &portfolio, &wilayah, &active, &hasPin, &adminRegions); err != nil {
			return nil, nil, err
		}
		if !superuser && !containsFold(managedRegions, wilayah) {
			continue
		}
		user := map[string]any{"nik": nik, "nama": nama, "role": role, "region": region, "atasan": atasan, "sales": sales, "portfolio": portfolio, "wilayah": wilayah, "adminRegions": adminRegions, "active": active, "hasPin": hasPin}
		users = append(users, user)
		if superuser || containsFold([]string{"ASM", "RGM"}, role) {
			bosses = append(bosses, map[string]any{"nik": nik, "nama": nama, "role": role, "wilayah": wilayah})
		}
	}
	return users, bosses, rows.Err()
}

func (s *Server) adminPeriodLocks(ctx context.Context) ([]any, error) {
	rows, err := s.Reporting.DB.Query(ctx, `select period,terkunci,alasan,oleh,waktu from period_locks order by period desc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []any{}
	for rows.Next() {
		var period, alasan, oleh string
		var locked bool
		var waktu time.Time
		if err = rows.Scan(&period, &locked, &alasan, &oleh, &waktu); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"PERIODE": period, "TERKUNCI": locked, "ALASAN": alasan, "OLEH": oleh, "WAKTU": waktu})
	}
	return out, rows.Err()
}
func (s *Server) activity(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select waktu,nik,aksi,keterangan from audit_log order by waktu desc limit 100`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var t time.Time
		var n, a, k string
		_ = rows.Scan(&t, &n, &a, &k)
		o = append(o, map[string]any{"time": t, "nik": n, "action": a, "description": k})
	}
	return o, 200, nil
}
func (s *Server) periodLock(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	period := str(p, "period")
	locked := boolval(p, "locked")
	reason := str(p, "reason")
	if len(reason) < 5 {
		return nil, 400, errors.New("Isi alasan minimal 5 karakter")
	}
	_, e := s.Reporting.DB.Exec(ctx, `insert into period_locks(period,terkunci,alasan,oleh) values($1,$2,$3,$4) on conflict(period) do update set terkunci=excluded.terkunci,alasan=excluded.alasan,oleh=excluded.oleh,waktu=now()`, period, locked, reason, sess.NIK)
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) regionMapGet(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select region,wilayah_kpi,kanal from regions order by wilayah_kpi,region`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var a, b, c string
		_ = rows.Scan(&a, &b, &c)
		o = append(o, map[string]any{"region": a, "wilayah": b, "kanal": c})
	}
	return o, 200, nil
}
func (s *Server) regionMapSave(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	in := mapval(p, "input")
	region := str(in, "region")
	wil := str(in, "wilayah")
	kan := strings.ToUpper(str(in, "kanal"))
	if region == "" || wil == "" {
		return nil, 400, errors.New("Region dan Big Region wajib")
	}
	if kan != "" && kan != "ONLINE" {
		return nil, 400, errors.New("KANAL hanya kosong atau ONLINE")
	}
	_, e := s.Reporting.DB.Exec(ctx, `insert into regions(region,wilayah_kpi,kanal) values($1,$2,$3) on conflict(region) do update set wilayah_kpi=excluded.wilayah_kpi,kanal=excluded.kanal,updated_at=now()`, region, wil, kan)
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) syncStatus(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select waktu,file_name,jenis,status,bulan,region,baris,keterangan from sync_log order by waktu desc limit 50`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var t time.Time
		var f, k, st, ket string
		var ps, rs []string
		var n int
		_ = rows.Scan(&t, &f, &k, &st, &ps, &rs, &n, &ket)
		o = append(o, map[string]any{"time": t, "file": f, "kind": k, "status": st, "periods": ps, "regions": rs, "rows": n, "note": ket})
	}
	m := map[string]any{"rows": o, "parallelMode": s.Cfg.ParallelMode}
	if s.WorkerStatus != nil {
		m["worker"] = s.WorkerStatus()
	}
	return m, 200, nil
}
func (s *Server) infoList(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	rows, e := s.Reporting.DB.Query(ctx, `select id,judul,isi,wilayah_list,role_list,file_name,penulis_nama,dibuat,aktif from announcements where aktif=true or $1 in ('ADMIN','SUPER ADMIN') order by dibuat desc limit 200`, sess.Role)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var id, j, i, fn, pn string
		var wl, rl []string
		var t time.Time
		var a bool
		_ = rows.Scan(&id, &j, &i, &wl, &rl, &fn, &pn, &t, &a)
		o = append(o, map[string]any{"id": id, "judul": j, "isi": i, "wilayah": wl, "roles": rl, "fileName": fn, "author": pn, "created": t, "active": a})
	}
	return o, 200, nil
}
func (s *Server) infoSetActive(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	_, e := s.Reporting.DB.Exec(ctx, `update announcements set aktif=$2 where id=$1`, str(p, "id"), boolval(p, "value"))
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) saveExportAccess(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	in := mapval(p, "input")
	_, e := s.Reporting.DB.Exec(ctx, `insert into export_access(nik,jenis_export,aktif,updated_by) values($1,$2,$3,$4) on conflict(nik,jenis_export) do update set aktif=excluded.aktif,updated_by=excluded.updated_by,updated_at=now()`, str(in, "nik"), str(in, "type"), boolval(in, "active"), sess.NIK)
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) dealerClosureList(ctx context.Context, sess auth.Session) (any, int, error) {
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	rows, e := s.Reporting.DB.Query(ctx, `select x.id,x.kode_customer,c.nama_induk_customer,x.tanggal_tutup::text,x.alasan,x.status,x.diajukan_oleh,x.diajukan_at,x.catatan from customer_closures x join customers c on c.kode_customer=x.kode_customer where c.nik_sales=any($1) or $2 in ('ADMIN','SUPER ADMIN') order by x.diajukan_at desc`, ids, sess.Role)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var id int64
		var c, n, d, a, st, by, note string
		var t time.Time
		_ = rows.Scan(&id, &c, &n, &d, &a, &st, &by, &t, &note)
		o = append(o, map[string]any{"id": id, "customer": c, "name": n, "date": d, "reason": a, "status": st, "by": by, "created": t, "note": note})
	}
	return o, 200, nil
}
func (s *Server) dealerClosureSubmit(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	cust := str(p, "id")
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	var owner string
	if e = s.Reporting.DB.QueryRow(ctx, `select nik_sales from customers where kode_customer=$1`, cust).Scan(&owner); e != nil || !containsS(ids, owner) {
		return nil, 403, errors.New("Dealer di luar cakupan")
	}
	_, e = s.Reporting.DB.Exec(ctx, `insert into customer_closures(kode_customer,tanggal_tutup,alasan,status,diajukan_oleh) values($1,$2,$3,'PENGAJUAN',$4)`, cust, str(p, "tanggal"), str(p, "alasan"), sess.EffectiveNIK)
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) dealerClosureProcess(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	id := intval(p, "row", 0)
	act := strings.ToUpper(str(p, "aksi"))
	status := map[string]string{"SETUJUI": "TUTUP", "TOLAK": "DITOLAK", "BUKA": "DIBUKA"}[act]
	if status == "" {
		return nil, 400, errors.New("aksi tidak dikenal")
	}
	_, e := s.Reporting.DB.Exec(ctx, `update customer_closures set status=$2,diproses_oleh=$3,diproses_at=now(),catatan=$4 where id=$1`, id, status, sess.NIK, str(p, "catatan"))
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) dealerRegion(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	q := str(p, "dealer")
	if q == "" {
		q = str(p, "q")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select c.kode_customer,c.nama_induk_customer,c.region,c.sub_region,coalesce((select wilayah from customer_region_override d where d.kode_customer=c.kode_customer order by berlaku_mulai desc limit 1),'') override from customers c where $1='' or c.kode_customer ilike '%'||$1||'%' or c.nama_induk_customer ilike '%'||$1||'%' order by c.nama_induk_customer limit 100`, q)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var a, b, c, d, e1 string
		_ = rows.Scan(&a, &b, &c, &d, &e1)
		o = append(o, map[string]any{"customer": a, "name": b, "region": c, "subRegion": d, "override": e1})
	}
	return o, 200, nil
}
func (s *Server) targetGet(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	period := str(p, "period")
	rows, e := s.Reporting.DB.Query(ctx, `select t.nik,p.nama,t.brand,t.metric,t.indicator_id,t.value::float8 from targets t left join people_effective p on p.nik=t.nik where t.period=$1 order by p.nama,t.brand,t.metric,t.indicator_id`, period)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var n, na, b, m, i string
		var v *float64
		_ = rows.Scan(&n, &na, &b, &m, &i, &v)
		o = append(o, map[string]any{"nik": n, "nama": na, "brand": b, "metric": m, "indicator": i, "value": v})
	}
	return map[string]any{"period": period, "rows": o}, 200, nil
}
func (s *Server) kpiGet(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	period := str(p, "period")
	rows, e := s.Reporting.DB.Query(ctx, `select wilayah,kelompok,metric,brand,bobot::float8,batas_skor::float8,indicator_id,label,type_filter,min_qty_da from kpi_policies where period=$1 order by wilayah,kelompok,id`, period)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var w, g, m, b, i, l string
		var wt, cap float64
		var types []string
		var min int
		_ = rows.Scan(&w, &g, &m, &b, &wt, &cap, &i, &l, &types, &min)
		o = append(o, map[string]any{"region": w, "group": g, "metric": m, "brand": b, "weight": wt, "cap": cap, "indicator": i, "label": l, "types": types, "minDA": min})
	}
	return map[string]any{"period": period, "rows": o}, 200, nil
}

func (s *Server) genericCompatibility(ctx context.Context, sess auth.Session, name string, p map[string]any) (any, int, error) {
	// Every Apps Script API has a route. Un-specialized endpoints are intentionally explicit instead of silently returning wrong data.
	// Their contract is preserved in contracts_generated.go and covered by tests/golden/matrix.csv.
	return map[string]any{"ok": false, "endpoint": name, "migrationStatus": "CONTRACT_REGISTERED", "message": "Endpoint terdaftar pada Go v2 tetapi membutuhkan parity implementation sebelum cut-over. Gunakan migration matrix untuk status."}, 501, nil
}

func isWrite(name string) bool {
	for _, x := range []string{"Save", "Commit", "Delete", "Stage", "Upload", "Publish", "Set", "Start", "Stop", "Reset", "Change", "Proses", "Ajukan", "Submit", "Review", "Restore", "Retry", "Schedule", "Copy", "Hapus", "Lock"} {
		if strings.Contains(name, x) {
			return true
		}
	}
	return name == "apiLogout" || name == "apiBackupSettings"
}
func decode(r *http.Request, v any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 20<<20))
	return dec.Decode(v) == nil
}
func str(m map[string]any, k string) string {
	if m == nil || m[k] == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(m[k]))
}
func intval(m map[string]any, k string, d int) int {
	v := str(m, k)
	if v == "" {
		return d
	}
	n, e := strconv.Atoi(strings.Split(v, ".")[0])
	if e != nil {
		return d
	}
	return n
}
func boolval(m map[string]any, k string) bool {
	v := strings.ToLower(str(m, k))
	return v == "true" || v == "1" || v == "ya" || v == "yes"
}
func mapval(m map[string]any, k string) map[string]any {
	if x, ok := m[k].(map[string]any); ok {
		return x
	}
	return map[string]any{}
}
func code(e error) int {
	if e == nil {
		return 200
	}
	s := strings.ToLower(e.Error())
	if strings.Contains(s, "cakupan") || strings.Contains(s, "khusus") {
		return 403
	}
	if strings.Contains(s, "tidak tersedia") || strings.Contains(s, "tidak ditemukan") {
		return 404
	}
	return 400
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": msg})
}
func containsS(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 12)
		_, _ = rand.Read(b)
		id := base64.RawURLEncoding.EncodeToString(b)
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), ctxKey("request_id"), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if x := recover(); x != nil {
				slog.Error("panic recovered", "panic", x, "path", r.URL.Path)
				writeErr(w, 500, "Terjadi kesalahan server")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		dur := time.Since(start)
		s.requests.WithLabelValues(r.URL.Path, strconv.Itoa(rw.status)).Inc()
		s.latency.WithLabelValues(r.URL.Path).Observe(dur.Seconds())
		slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", rw.status, "duration_ms", dur.Milliseconds(), "request_id", r.Context().Value(ctxKey("request_id")))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(n int) { w.status = n; w.ResponseWriter.WriteHeader(n) }
func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now()})
}
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if e := s.Reporting.DB.Ping(ctx); e != nil {
		writeErr(w, 503, "database tidak siap")
		return
	}
	result := map[string]any{"ok": true, "database": "ready"}
	if s.Cfg.DriveFolderID != "" {
		var hb *time.Time
		var enabled bool
		err := s.Reporting.DB.QueryRow(ctx, `select heartbeat_at,enabled from worker_runtime where worker='drive-sync'`).Scan(&hb, &enabled)
		if err != nil || hb == nil {
			writeJSON(w, 503, map[string]any{"ok": false, "database": "ready", "worker": "heartbeat belum tersedia"})
			return
		}
		result["workerHeartbeat"] = hb
		result["workerEnabled"] = enabled
		if enabled && time.Since(*hb) > 2*s.Cfg.DrivePollInterval+time.Minute {
			writeJSON(w, 503, map[string]any{"ok": false, "database": "ready", "worker": "heartbeat kedaluwarsa", "heartbeat": hb})
			return
		}
	}
	writeJSON(w, 200, result)
}

func (s *Server) syncSchedule(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	on := boolval(p, "on")
	_, err := s.Reporting.DB.Exec(ctx, `insert into app_settings(key,value,updated_by) values('sync_enabled',to_jsonb($1::boolean),$2) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`, on, sess.NIK)
	if err != nil {
		return nil, 500, err
	}
	_, _ = s.Reporting.DB.Exec(ctx, `insert into audit_log(nik,aksi,keterangan) values($1,'SYNC_SCHEDULE',$2)`, sess.NIK, fmt.Sprintf("enabled=%t", on))
	return map[string]any{"ok": true, "enabled": on}, 200, nil
}

func (s *Server) resetPin(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	target := str(p, "nik")
	if target == "" {
		return nil, 400, errors.New("NIK wajib")
	}
	ok, err := s.Scope.CanManage(ctx, sess.NIK, target)
	if err != nil {
		return nil, 500, err
	}
	if !ok {
		return nil, 403, errors.New("Pengguna di luar kewenangan")
	}
	pin, err := s.Auth.ResetPIN(ctx, target)
	if err != nil {
		return nil, 400, err
	}
	_, _ = s.Reporting.DB.Exec(ctx, `insert into audit_log(nik,aksi,keterangan) values($1,'RESET_PIN',$2)`, sess.NIK, target)
	return map[string]any{"nik": target, "pin": pin}, 200, nil
}

func (s *Server) setActive(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	target := str(p, "nik")
	active := boolval(p, "isActive")
	if target == sess.NIK {
		return nil, 400, errors.New("Tidak dapat mengubah status akun sendiri.")
	}
	ok, err := s.Scope.CanManage(ctx, sess.NIK, target)
	if err != nil {
		return nil, 500, err
	}
	if !ok {
		return nil, 403, errors.New("Pengguna di luar kewenangan")
	}
	if !active {
		var role string
		_ = s.Reporting.DB.QueryRow(ctx, `select effective_role from people_effective where nik=$1`, target).Scan(&role)
		if role == "SUPER ADMIN" {
			var n int
			_ = s.Reporting.DB.QueryRow(ctx, `select count(*) from auth_accounts a join people_effective p on p.nik=a.nik where a.aktif=true and p.effective_role='SUPER ADMIN'`).Scan(&n)
			if n <= 1 {
				return nil, 400, errors.New("Super Admin aktif terakhir harus dipertahankan.")
			}
		}
	}
	if err = s.Auth.SetActive(ctx, target, active); err != nil {
		return nil, 400, err
	}
	_, _ = s.Reporting.DB.Exec(ctx, `insert into audit_log(nik,aksi,keterangan) values($1,'ACCOUNT_ACTIVE',$2)`, sess.NIK, fmt.Sprintf("%s %t", target, active))
	return true, 200, nil
}

func (s *Server) holidays(ctx context.Context, sess auth.Session, name string) (any, int, error) {
	if name == "apiHariLiburAdmin" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select tanggal::text,keterangan,aktif from holidays order by tanggal`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var d, k string
		var a bool
		_ = rows.Scan(&d, &k, &a)
		o = append(o, map[string]any{"tanggal": d, "keterangan": k, "aktif": a})
	}
	return o, 200, nil
}
func (s *Server) holidaySave(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	d := str(p, "tanggal")
	if _, e := time.Parse("2006-01-02", d); e != nil {
		return nil, 400, errors.New("Tanggal harus YYYY-MM-DD")
	}
	_, e := s.Reporting.DB.Exec(ctx, `insert into holidays(tanggal,keterangan,aktif) values($1,$2,$3) on conflict(tanggal) do update set keterangan=excluded.keterangan,aktif=excluded.aktif`, d, str(p, "ket"), boolval(p, "aktif"))
	return map[string]any{"ok": e == nil}, code(e), e
}
func (s *Server) holidayDelete(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	_, e := s.Reporting.DB.Exec(ctx, `delete from holidays where tanggal=$1`, str(p, "tanggal"))
	return map[string]any{"ok": e == nil}, code(e), e
}

func (s *Server) exportOptions(ctx context.Context, sess auth.Session, name string, p map[string]any) (any, int, error) {
	rows, e := s.Reporting.DB.Query(ctx, `select distinct brand from products order by brand`)
	if e != nil {
		return nil, 500, e
	}
	brands := []string{}
	for rows.Next() {
		var x string
		_ = rows.Scan(&x)
		brands = append(brands, x)
	}
	rows.Close()
	rr, e := s.Reporting.DB.Query(ctx, `select distinct period from coverage order by period desc`)
	if e != nil {
		return nil, 500, e
	}
	periods := []string{}
	for rr.Next() {
		var x string
		_ = rr.Scan(&x)
		periods = append(periods, x)
	}
	rr.Close()
	regions := []string{}
	rg, e := s.Reporting.DB.Query(ctx, `select distinct wilayah_kpi from regions where wilayah_kpi<>'' order by 1`)
	if e == nil {
		for rg.Next() {
			var x string
			_ = rg.Scan(&x)
			regions = append(regions, x)
		}
		rg.Close()
	}
	return map[string]any{"brands": brands, "periods": periods, "regions": regions, "parallelMode": s.Cfg.ParallelMode, "endpoint": name}, 200, nil
}

func (s *Server) dealerSearch(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	q := str(p, "q")
	rows, e := s.Reporting.DB.Query(ctx, `select kode_customer,nama_induk_customer,nik_sales,region,sub_region,kota from customers where nik_sales=any($1) and ($2='' or kode_customer ilike '%'||$2||'%' or nama_induk_customer ilike '%'||$2||'%') order by nama_induk_customer limit 100`, ids, q)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var id, n, nik, r, sr, k string
		_ = rows.Scan(&id, &n, &nik, &r, &sr, &k)
		o = append(o, map[string]any{"id": id, "nama": n, "nik": nik, "region": r, "subRegion": sr, "kota": k})
	}
	return o, 200, nil
}
func (s *Server) dealerEditDetail(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	id := str(p, "uniq")
	if id == "" {
		id = str(p, "id")
	}
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	var n, nik, r, sr, a, k, hp, pic string
	e = s.Reporting.DB.QueryRow(ctx, `select nama_induk_customer,nik_sales,region,sub_region,alamat,kota,no_hp,nama_pic from customers where kode_customer=$1`, id).Scan(&n, &nik, &r, &sr, &a, &k, &hp, &pic)
	if e != nil {
		return nil, 404, e
	}
	if !containsS(ids, nik) && sess.Role != "SUPER ADMIN" && sess.Role != "ADMIN" {
		return nil, 403, errors.New("Dealer di luar cakupan")
	}
	return map[string]any{"id": id, "nama": n, "nik": nik, "region": r, "subRegion": sr, "alamat": a, "kota": k, "hp": hp, "pic": pic}, 200, nil
}

func (s *Server) dealerContactRevision(ctx context.Context, id string) (string, map[string]any, string, string, error) {
	var pic, hp, alamat, owner, region string
	err := s.Reporting.DB.QueryRow(ctx, `select c.nama_pic,c.no_hp,c.alamat,c.nik_sales,coalesce(p.wilayah,'') from customers c left join people_effective p on p.nik=c.nik_sales where c.kode_customer=$1 and c.active=true`, id).Scan(&pic, &hp, &alamat, &owner, &region)
	if err != nil {
		return "", nil, "", "", err
	}
	values := map[string]any{"pic": pic, "hp": hp, "alamat": alamat}
	b, _ := json.Marshal(map[string]any{"values": values, "owner": owner, "region": region})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), values, owner, region, nil
}

func (s *Server) canReviewDealer(ctx context.Context, sess auth.Session, ownerRegion string) bool {
	if sess.Role == "SUPER ADMIN" {
		return true
	}
	if sess.Role != "ADMIN" {
		return false
	}
	var ok bool
	_ = s.Reporting.DB.QueryRow(ctx, `select exists(select 1 from admin_regions where nik=$1 and wilayah=$2)`, sess.NIK, ownerRegion).Scan(&ok)
	return ok
}

func (s *Server) dealerContact(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	id := str(p, "id")
	revision, values, owner, ownerRegion, e := s.dealerContactRevision(ctx, id)
	if e != nil {
		return nil, 404, errors.New("Dealer tidak ditemukan")
	}
	ids, e := s.Scope.Allowed(ctx, sess.EffectiveNIK, "ALL")
	if e != nil {
		return nil, 403, e
	}
	inScope := containsS(ids, owner)
	canEdit := s.canReviewDealer(ctx, sess, ownerRegion)
	if !inScope && !canEdit {
		return nil, 403, errors.New("Dealer di luar cakupan")
	}
	canSubmit := sess.Role == "SALES" && owner == sess.EffectiveNIK
	rows, e := s.Reporting.DB.Query(ctx, `select id,before_data,after_data,alasan,status,diajukan_oleh,diajukan_at,diproses_oleh,diproses_at,catatan from customer_contact_requests where kode_customer=$1 and ($2 or diajukan_oleh=$3) order by diajukan_at desc limit 20`, id, canEdit, sess.EffectiveNIK)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	reqs := []any{}
	for rows.Next() {
		var rid int64
		var before, after []byte
		var reason, status, actor, note string
		var created time.Time
		var reviewer *string
		var reviewed *time.Time
		if e := rows.Scan(&rid, &before, &after, &reason, &status, &actor, &created, &reviewer, &reviewed, &note); e != nil {
			return nil, 500, e
		}
		var bv, av any
		_ = json.Unmarshal(before, &bv)
		_ = json.Unmarshal(after, &av)
		reqs = append(reqs, map[string]any{"id": rid, "dealer": id, "before": bv, "after": av, "reason": reason, "status": status, "actor": actor, "created": created, "reviewer": reviewer, "reviewed": reviewed, "reviewReason": note})
	}
	return map[string]any{"values": values, "canSubmit": canSubmit, "canEdit": canEdit, "revision": revision, "requests": reqs}, 200, nil
}

func validateContactInput(input map[string]any, before map[string]any) (map[string]any, error) {
	pic := str(input, "pic")
	hp := str(input, "hp")
	alamat := str(input, "alamat")
	if pic == "" {
		pic = fmt.Sprint(before["pic"])
	}
	if hp == "" {
		hp = fmt.Sprint(before["hp"])
	}
	if alamat == "" {
		alamat = fmt.Sprint(before["alamat"])
	}
	if len([]rune(pic)) > 120 || len([]rune(alamat)) > 1000 || pic == "" || alamat == "" {
		return nil, errors.New("Isi nama PIC (maks.120) dan alamat (maks.1000).")
	}
	digits := ""
	for _, r := range hp {
		if r >= '0' && r <= '9' {
			digits += string(r)
		} else if !strings.ContainsRune("+ ()-", r) {
			return nil, errors.New("Format nomor HP tidak valid.")
		}
	}
	if hp != "" && (len(digits) < 8 || len(digits) > 15) {
		return nil, errors.New("Nomor HP harus 8-15 digit.")
	}
	return map[string]any{"pic": pic, "hp": hp, "alamat": alamat}, nil
}

func (s *Server) submitDealerContact(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	input := mapval(p, "input")
	id := str(input, "dealer")
	revision, before, owner, _, e := s.dealerContactRevision(ctx, id)
	_ = revision
	if e != nil || sess.Role != "SALES" || owner != sess.EffectiveNIK {
		return nil, 403, errors.New("Hanya Sales pemegang dealer yang dapat mengajukan.")
	}
	var pending bool
	_ = s.Reporting.DB.QueryRow(ctx, `select exists(select 1 from customer_contact_requests where kode_customer=$1 and status in ('PENDING','PENGAJUAN'))`, id).Scan(&pending)
	if pending {
		return nil, 400, errors.New("Dealer masih memiliki pengajuan menunggu persetujuan.")
	}
	if b, ok := input["before"].(map[string]any); ok {
		cur, _ := json.Marshal(before)
		old, _ := json.Marshal(b)
		if string(cur) != string(old) {
			return nil, 409, errors.New("Kontak berubah. Buka ulang detail dealer.")
		}
	}
	after, e := validateContactInput(input, before)
	if e != nil {
		return nil, 400, e
	}
	reason := str(input, "reason")
	if len([]rune(reason)) < 5 || len([]rune(reason)) > 500 {
		return nil, 400, errors.New("Isi alasan 5-500 karakter.")
	}
	bb, _ := json.Marshal(before)
	ab, _ := json.Marshal(after)
	if string(bb) == string(ab) {
		return nil, 400, errors.New("Belum ada perubahan.")
	}
	var rid int64
	e = s.Reporting.DB.QueryRow(ctx, `insert into customer_contact_requests(kode_customer,before_data,after_data,alasan,status,diajukan_oleh) values($1,$2,$3,$4,'PENGAJUAN',$5) returning id`, id, bb, ab, reason, sess.NIK).Scan(&rid)
	if e != nil {
		return nil, 500, e
	}
	return map[string]any{"id": rid}, 200, nil
}

func (s *Server) reviewDealerContacts(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	decision := strings.ToUpper(str(p, "decision"))
	if decision != "APPROVED" && decision != "REJECTED" {
		return nil, 400, errors.New("Keputusan tidak valid.")
	}
	reason := str(p, "reason")
	if decision == "REJECTED" && len([]rune(reason)) < 5 {
		return nil, 400, errors.New("Alasan penolakan wajib 5-500 karakter.")
	}
	idsRaw, ok := p["ids"].([]any)
	if !ok || len(idsRaw) == 0 || len(idsRaw) > 100 {
		return nil, 400, errors.New("Pilih 1-100 pengajuan unik.")
	}
	tx, e := s.Reporting.DB.Begin(ctx)
	if e != nil {
		return nil, 500, e
	}
	defer tx.Rollback(ctx)
	count := 0
	for _, raw := range idsRaw {
		id, e := strconv.ParseInt(fmt.Sprint(raw), 10, 64)
		if e != nil {
			return nil, 400, errors.New("ID pengajuan tidak valid")
		}
		var dealer, status string
		var after []byte
		if e = tx.QueryRow(ctx, `select kode_customer,status,after_data from customer_contact_requests where id=$1 for update`, id).Scan(&dealer, &status, &after); e != nil {
			return nil, 404, errors.New("Pengajuan tidak ditemukan")
		}
		if status != "PENGAJUAN" && status != "PENDING" {
			return nil, 409, errors.New("Pengajuan sudah diproses. Perbarui daftar.")
		}
		_, _, _, reg, e := s.dealerContactRevision(ctx, dealer)
		if e != nil || !s.canReviewDealer(ctx, sess, reg) {
			return nil, 403, errors.New("Pengajuan di luar kewenangan.")
		}
		if decision == "APPROVED" {
			var v map[string]any
			_ = json.Unmarshal(after, &v)
			if _, e = tx.Exec(ctx, `update customers set nama_pic=$2,no_hp=$3,alamat=$4,updated_at=now() where kode_customer=$1`, dealer, fmt.Sprint(v["pic"]), fmt.Sprint(v["hp"]), fmt.Sprint(v["alamat"])); e != nil {
				return nil, 500, e
			}
		}
		if _, e = tx.Exec(ctx, `update customer_contact_requests set status=$2,diproses_oleh=$3,diproses_at=now(),catatan=$4 where id=$1`, id, decision, sess.NIK, reason); e != nil {
			return nil, 500, e
		}
		count++
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, 500, e
	}
	return map[string]any{"count": count}, 200, nil
}

func (s *Server) saveDealerContact(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	input := mapval(p, "input")
	id := str(input, "dealer")
	rev, before, _, reg, e := s.dealerContactRevision(ctx, id)
	if e != nil || !s.canReviewDealer(ctx, sess, reg) {
		return nil, 403, errors.New("Dealer di luar wilayah tugas.")
	}
	if got := str(input, "revision"); got != "" && got != rev {
		return nil, 409, errors.New("Kontak/pemegang dealer berubah. Buka ulang detail dealer.")
	}
	after, e := validateContactInput(input, before)
	if e != nil {
		return nil, 400, e
	}
	reason := str(input, "reason")
	if len([]rune(reason)) < 5 || len([]rune(reason)) > 500 {
		return nil, 400, errors.New("Isi alasan 5-500 karakter.")
	}
	bb, _ := json.Marshal(before)
	ab, _ := json.Marshal(after)
	if string(bb) == string(ab) {
		return nil, 400, errors.New("Tidak ada perubahan.")
	}
	tx, e := s.Reporting.DB.Begin(ctx)
	if e != nil {
		return nil, 500, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `update customers set nama_pic=$2,no_hp=$3,alamat=$4,updated_at=now() where kode_customer=$1`, id, fmt.Sprint(after["pic"]), fmt.Sprint(after["hp"]), fmt.Sprint(after["alamat"])); e != nil {
		return nil, 500, e
	}
	var rid int64
	if e = tx.QueryRow(ctx, `insert into customer_contact_requests(kode_customer,before_data,after_data,alasan,status,diajukan_oleh,diproses_oleh,diproses_at,catatan) values($1,$2,$3,$4,'APPROVED',$5,$5,now(),'ADMIN_DIRECT') returning id`, id, bb, ab, reason, sess.NIK).Scan(&rid); e != nil {
		return nil, 500, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, 500, e
	}
	return map[string]any{"id": rid}, 200, nil
}

func (s *Server) exportDealerContacts(ctx context.Context, sess auth.Session) (any, int, error) {
	if sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Super Admin")
	}
	rows, e := s.Reporting.DB.Query(ctx, `select c.kode_customer,c.nama_induk_customer,coalesce(p.wilayah,''),c.nik_sales,c.nama_pic,c.no_hp,c.alamat from customers c left join people_effective p on p.nik=c.nik_sales where c.active=true order by c.nama_induk_customer`)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var id, nama, reg, nik, pic, hp, alamat string
		if e := rows.Scan(&id, &nama, &reg, &nik, &pic, &hp, &alamat); e != nil {
			return nil, 500, e
		}
		rev, _, _, _, _ := s.dealerContactRevision(ctx, id)
		o = append(o, []any{id, nama, reg, nik, pic, hp, alamat, rev})
	}
	return map[string]any{"headers": []string{"KODE CUSTOMER", "NAMA DEALER", "REGION", "NIK SALES", "NAMA PIC", "NO HP", "ALAMAT", "VERSI KONTAK"}, "rows": o}, 200, nil
}

func (s *Server) contactRequests(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if sess.Role != "ADMIN" && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("khusus Admin")
	}
	status := str(p, "status")
	rows, e := s.Reporting.DB.Query(ctx, `select id,kode_customer,before_data,after_data,alasan,status,diajukan_oleh,diajukan_at,diproses_oleh,diproses_at,catatan from customer_contact_requests where $1='' or status=$1 order by diajukan_at desc limit 500`, status)
	if e != nil {
		return nil, 500, e
	}
	defer rows.Close()
	o := []any{}
	for rows.Next() {
		var id int64
		var c, al, st, by string
		var before, after []byte
		var at time.Time
		var pb, cat *string
		var pt *time.Time
		_ = rows.Scan(&id, &c, &before, &after, &al, &st, &by, &at, &pb, &pt, &cat)
		var b1, b2 any
		_ = json.Unmarshal(before, &b1)
		_ = json.Unmarshal(after, &b2)
		o = append(o, map[string]any{"id": id, "customer": c, "before": b1, "after": b2, "reason": al, "status": st, "by": by, "created": at, "processedBy": pb, "processedAt": pt, "note": cat})
	}
	return o, 200, nil
}
