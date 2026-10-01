package main

import (
	"context"
	"flag"
	"log/slog"
	"os/signal"
	"salesportal/internal/config"
	dbx "salesportal/internal/db"
	"salesportal/internal/importer"
	"salesportal/internal/observability"
	"salesportal/internal/syncworker"
	"syscall"
	"time"
)

func main() {
	once := flag.Bool("once", false, "poll sekali lalu keluar")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
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
	im := &importer.Importer{DB: db.Pool, Location: loc}
	st := &observability.WorkerState{}
	w := &syncworker.Worker{Cfg: cfg, Importer: im, State: st}
	if err := w.Run(ctx, *once); err != nil && ctx.Err() == nil {
		panic(err)
	}
}
