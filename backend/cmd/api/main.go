package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	apihttp "salesportal/internal/api"
	"salesportal/internal/auth"
	"salesportal/internal/config"
	dbx "salesportal/internal/db"
	"salesportal/internal/importer"
	"salesportal/internal/observability"
	"salesportal/internal/reporting"
	"salesportal/internal/scope"
	"syscall"
	"time"
)

func main() {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	slog.SetDefault(observability.NewLogger(slog.LevelInfo))
	db, err := dbx.Open(ctx, cfg.DatabaseURL, cfg.SlowQueryThreshold)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	loc, _ := time.LoadLocation(cfg.Timezone)
	a := &auth.Service{DB: db.Pool, Pepper: cfg.Pepper, TTL: cfg.SessionTTL}
	sc := &scope.Resolver{DB: db.Pool}
	rp := &reporting.Service{DB: db.Pool, Scope: sc, Location: loc}
	im := &importer.Importer{DB: db.Pool, Location: loc}
	server := apihttp.New(cfg, a, sc, rp, im, "/app/frontend")
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: server.Router(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		slog.Info("api started", "addr", cfg.HTTPAddr)
		if e := srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			slog.Error("server", "error", e)
			os.Exit(1)
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	sh, cn := context.WithTimeout(ctx, 15*time.Second)
	defer cn()
	_ = srv.Shutdown(sh)
}
