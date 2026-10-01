package observability

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"sync/atomic"
	"time"
)

type JSONHandler struct{ inner slog.Handler }

func NewLogger(level slog.Leveler) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

type WorkerState struct {
	LastRun     atomic.Int64
	LastSuccess atomic.Int64
	LastError   atomic.Value
	LastFile    atomic.Value
}

func (s *WorkerState) MarkStart() { s.LastRun.Store(time.Now().Unix()) }
func (s *WorkerState) MarkSuccess(file string) {
	s.LastSuccess.Store(time.Now().Unix())
	s.LastFile.Store(file)
	s.LastError.Store("")
}
func (s *WorkerState) MarkError(err error) {
	if err != nil {
		s.LastError.Store(err.Error())
	}
}
func (s *WorkerState) Snapshot() map[string]any {
	m := map[string]any{"last_run": s.LastRun.Load(), "last_success": s.LastSuccess.Load()}
	if v := s.LastError.Load(); v != nil {
		m["last_error"] = v
	}
	if v := s.LastFile.Load(); v != nil {
		m["last_file"] = v
	}
	return m
}

func LogJSON(ctx context.Context, level slog.Level, msg string, fields map[string]any) {
	b, _ := json.Marshal(fields)
	slog.Log(ctx, level, msg, "data", string(b))
}
