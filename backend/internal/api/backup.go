package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"salesportal/internal/auth"
)

func (s *Server) backupStatus(ctx context.Context) (map[string]any, error) {
	keep := s.Cfg.BackupRetentionDays
	var raw string
	if e := s.Reporting.DB.QueryRow(ctx, `select coalesce(value #>> '{}','') from app_settings where key='backup_retention_days'`).Scan(&raw); e == nil {
		if n, e2 := strconv.Atoi(raw); e2 == nil && n >= 2 && n <= 60 {
			keep = n
		}
	}
	var lastAt *time.Time
	var lastStatus, lastLoc, lastMsg string
	var tested bool
	_ = s.Reporting.DB.QueryRow(ctx, `select waktu,status,lokasi,keterangan,restore_tested from backup_log order by waktu desc limit 1`).Scan(&lastAt, &lastStatus, &lastLoc, &lastMsg, &tested)
	out := map[string]any{"keep": keep, "backupDir": s.Cfg.BackupDir, "lastStatus": lastStatus, "lastLocation": lastLoc, "lastMessage": lastMsg, "restoreTested": tested}
	if lastAt != nil {
		out["lastAt"] = lastAt.In(s.Reporting.Location).Format(time.RFC3339)
	}
	return out, nil
}
func (s *Server) backupSettings(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireSuper(sess); e != nil {
		return nil, 403, e
	}
	keep := intval(p, "keep", s.Cfg.BackupRetentionDays)
	if keep < 2 || keep > 60 {
		return nil, 400, errors.New("Retensi 2-60 backup harian.")
	}
	_, e := s.Reporting.DB.Exec(ctx, `insert into app_settings(key,value,updated_by,updated_at) values('backup_retention_days',to_jsonb($1::int),$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`, keep, sess.NIK)
	if e != nil {
		return nil, 500, e
	}
	_, _ = s.Reporting.DB.Exec(ctx, `insert into audit_log(nik,aksi,keterangan) values($1,'BACKUP_SETTINGS',$2)`, sess.NIK, fmt.Sprintf("Retensi %d", keep))
	x, e := s.backupStatus(ctx)
	return x, code(e), e
}
func (s *Server) startBackup(ctx context.Context, sess auth.Session) (any, int, error) {
	if e := s.requireSuper(sess); e != nil {
		return nil, 403, e
	}
	if e := os.MkdirAll(s.Cfg.BackupDir, 0750); e != nil {
		return nil, 500, e
	}
	name := "salesportal-" + time.Now().In(s.Reporting.Location).Format("20060102-150405") + ".dump"
	path := filepath.Join(s.Cfg.BackupDir, name)
	cmd := exec.CommandContext(ctx, "pg_dump", "-Fc", "--file", path, s.Cfg.DatabaseURL)
	out, e := cmd.CombinedOutput()
	status := "OK"
	msg := "Backup selesai"
	if e != nil {
		status = "ERROR"
		msg = string(out)
		if msg == "" {
			msg = e.Error()
		}
	}
	_, _ = s.Reporting.DB.Exec(context.Background(), `insert into backup_log(jenis,status,lokasi,keterangan) values('MANUAL',$1,$2,$3)`, status, path, msg)
	if e != nil {
		return nil, 500, fmt.Errorf("backup gagal: %s", msg)
	}
	// Apply retention after a successful backup.
	keep := s.Cfg.BackupRetentionDays
	var raw string
	if e2 := s.Reporting.DB.QueryRow(ctx, `select coalesce(value #>> '{}','') from app_settings where key='backup_retention_days'`).Scan(&raw); e2 == nil {
		if n, e3 := strconv.Atoi(raw); e3 == nil {
			keep = n
		}
	}
	entries, _ := os.ReadDir(s.Cfg.BackupDir)
	cut := time.Now().AddDate(0, 0, -keep)
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		info, e2 := ent.Info()
		if e2 == nil && info.ModTime().Before(cut) {
			_ = os.Remove(filepath.Join(s.Cfg.BackupDir, ent.Name()))
		}
	}
	x, _ := s.backupStatus(ctx)
	x["ok"] = true
	return x, 200, nil
}
