package syncworker

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
	"salesportal/internal/config"
	"salesportal/internal/importer"
	"salesportal/internal/observability"
)

type Worker struct {
	Cfg        config.Config
	Importer   *importer.Importer
	State      *observability.WorkerState
	InstanceID string
}

func (w *Worker) Run(ctx context.Context, once bool) error {
	if w.Cfg.DriveFolderID == "" {
		return fmt.Errorf("DRIVE_FINISHED_FOLDER_ID belum diisi")
	}
	if w.InstanceID == "" {
		w.InstanceID = instanceID()
	}
	_, _ = w.Importer.DB.Exec(ctx, `insert into worker_runtime(worker,instance_id,started_at,heartbeat_at,enabled) values('drive-sync',$1,now(),now(),true) on conflict(worker) do update set instance_id=excluded.instance_id,started_at=excluded.started_at,heartbeat_at=now()`, w.InstanceID)
	b, err := os.ReadFile(w.Cfg.DriveServiceAccount)
	if err != nil {
		return fmt.Errorf("service account: %w", err)
	}
	conf, err := google.JWTConfigFromJSON(b, drive.DriveReadonlyScope)
	if err != nil {
		return err
	}
	svc, err := drive.NewService(ctx, option.WithHTTPClient(conf.Client(ctx)))
	if err != nil {
		return err
	}
	for {
		enabled := true
		_ = w.Importer.DB.QueryRow(ctx, `select coalesce((select (value #>> '{}')::boolean from app_settings where key='sync_enabled'),true)`).Scan(&enabled)
		_, _ = w.Importer.DB.Exec(ctx, `insert into worker_runtime(worker,instance_id,heartbeat_at,enabled) values('drive-sync',$1,now(),$2) on conflict(worker) do update set instance_id=excluded.instance_id,heartbeat_at=now(),enabled=excluded.enabled`, w.InstanceID, enabled)
		if enabled {
			if err := w.poll(ctx, svc); err != nil {
				slog.Error("sync poll", "error", err)
				w.State.MarkError(err)
				_, _ = w.Importer.DB.Exec(ctx, `update worker_runtime set last_error=$1,heartbeat_at=now() where worker='drive-sync'`, err.Error())
			}
		}
		if once {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(w.Cfg.DrivePollInterval):
		}
	}
}
func (w *Worker) poll(ctx context.Context, svc *drive.Service) error {
	w.State.MarkStart()
	_, _ = w.Importer.DB.Exec(ctx, `update worker_runtime set last_run_started_at=now(),heartbeat_at=now(),last_error='' where worker='drive-sync'`)
	q := fmt.Sprintf("'%s' in parents and trashed=false", strings.ReplaceAll(w.Cfg.DriveFolderID, "'", "\\'"))
	files, err := svc.Files.List().Q(q).Fields("files(id,name,mimeType,size,modifiedTime,md5Checksum)").PageSize(1000).OrderBy("modifiedTime asc").Do()
	if err != nil {
		return err
	}
	for _, f := range files.Files {
		if !supported(f.Name, f.MimeType) {
			continue
		}
		var done bool
		_ = w.Importer.DB.QueryRow(ctx, `select exists(select 1 from staging_files where source='DRIVE_SELESAI' and drive_file_id=$1 and status='DONE' and modified_time=$2)`, f.Id, parseTime(f.ModifiedTime)).Scan(&done)
		if done {
			continue
		}
		path, cleanup, err := w.download(ctx, svc, f)
		if err != nil {
			w.State.MarkError(err)
			continue
		}
		res, err := w.Importer.ImportSyncFile(ctx, path, "DRIVE_SELESAI", f.Id, f.Name, f.MimeType, parseTime(f.ModifiedTime))
		cleanup()
		if err != nil {
			slog.Error("sync file failed", "file", f.Name, "error", err)
			w.State.MarkError(err)
			continue
		}
		slog.Info("sync file done", "file", f.Name, "kind", res.Kind, "rows", res.Rows)
		w.State.MarkSuccess(f.Name)
		_, _ = w.Importer.DB.Exec(ctx, `update worker_runtime set heartbeat_at=now(),last_success_at=now(),last_file=$1,last_error='' where worker='drive-sync'`, f.Name)
	}
	_, _ = w.Importer.DB.Exec(ctx, `update worker_runtime set heartbeat_at=now() where worker='drive-sync'`)
	return nil
}
func (w *Worker) download(ctx context.Context, svc *drive.Service, f *drive.File) (string, func(), error) {
	var data []byte
	var err error
	if f.MimeType == "application/vnd.google-apps.spreadsheet" {
		resp, e := svc.Files.Export(f.Id, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").Download()
		if e != nil {
			return "", func() {}, e
		}
		defer resp.Body.Close()
		data, err = io.ReadAll(resp.Body)
	} else {
		resp, e := svc.Files.Get(f.Id).Download()
		if e != nil {
			return "", func() {}, e
		}
		defer resp.Body.Close()
		data, err = io.ReadAll(resp.Body)
	}
	if err != nil {
		return "", func() {}, err
	}
	if strings.HasSuffix(strings.ToLower(f.Name), ".csv") {
		data, err = csvToXLSX(data)
		if err != nil {
			return "", func() {}, err
		}
	}
	tmp, err := os.CreateTemp("", "sp-drive-*.xlsx")
	if err != nil {
		return "", func() {}, err
	}
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", func() {}, err
	}
	tmp.Close()
	return tmp.Name(), func() { os.Remove(tmp.Name()) }, nil
}
func supported(name, mime string) bool {
	n := strings.ToLower(name)
	return strings.HasSuffix(n, ".xlsx") || strings.HasSuffix(n, ".csv") || mime == "application/vnd.google-apps.spreadsheet"
}
func parseTime(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }
func csvToXLSX(b []byte) ([]byte, error) {
	r := csv.NewReader(bytes.NewReader(b))
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	f := excelize.NewFile()
	sh := f.GetSheetName(0)
	for i, row := range rows {
		for j, v := range row {
			cell, _ := excelize.CoordinatesToCellName(j+1, i+1)
			_ = f.SetCellValue(sh, cell, v)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
func fileExt(n string) string { return filepath.Ext(strings.ToLower(n)) }

func instanceID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("worker-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
