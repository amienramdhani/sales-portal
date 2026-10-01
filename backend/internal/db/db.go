package db

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
	Slow time.Duration
}

func Open(ctx context.Context, url string, slow time.Duration) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 30
	cfg.MinConns = 2
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.MaxConnLifetime = 45 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	ctxPing, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctxPing); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database ping: %w", err)
	}
	return &DB{Pool: pool, Slow: slow}, nil
}

func (d *DB) Close() {
	if d != nil && d.Pool != nil {
		d.Pool.Close()
	}
}

func (d *DB) Exec(ctx context.Context, name, sql string, args ...any) error {
	start := time.Now()
	_, err := d.Pool.Exec(ctx, sql, args...)
	dur := time.Since(start)
	if dur > d.Slow {
		slog.Warn("slow query", "query", name, "duration_ms", dur.Milliseconds())
	}
	return err
}
