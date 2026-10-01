package api

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
	"salesportal/internal/auth"
)

func (s *Server) driveService(ctx context.Context) (*drive.Service, error) {
	b, e := os.ReadFile(s.Cfg.DriveServiceAccount)
	if e != nil {
		return nil, e
	}
	conf, e := google.JWTConfigFromJSON(b, drive.DriveReadonlyScope)
	if e != nil {
		return nil, e
	}
	return drive.NewService(ctx, option.WithHTTPClient(conf.Client(ctx)))
}
func (s *Server) driveFilePayload(ctx context.Context, id string) (map[string]any, error) {
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("File tidak tersedia")
	}
	svc, e := s.driveService(ctx)
	if e != nil {
		return nil, e
	}
	meta, e := svc.Files.Get(id).Fields("id,name,mimeType,size").Do()
	if e != nil {
		return nil, e
	}
	var rc io.ReadCloser
	mime := meta.MimeType
	if meta.MimeType == "application/vnd.google-apps.spreadsheet" {
		resp, e := svc.Files.Export(id, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").Download()
		if e != nil {
			return nil, e
		}
		rc = resp.Body
		mime = xlsxMime
		if !strings.HasSuffix(strings.ToLower(meta.Name), ".xlsx") {
			meta.Name += ".xlsx"
		}
	} else {
		resp, e := svc.Files.Get(id).Download()
		if e != nil {
			return nil, e
		}
		rc = resp.Body
	}
	defer rc.Close()
	b, e := io.ReadAll(io.LimitReader(rc, 50<<20))
	if e != nil {
		return nil, e
	}
	return map[string]any{"name": meta.Name, "mime": mime, "base64": base64.StdEncoding.EncodeToString(b)}, nil
}
func (s *Server) downloadInfo(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	id := str(p, "id")
	var fileID string
	var roles, regions []string
	var active bool
	e := s.Reporting.DB.QueryRow(ctx, `select coalesce(file_id,''),role_list,wilayah_list,aktif from announcements where id=$1`, id).Scan(&fileID, &roles, &regions, &active)
	if e != nil || !active {
		return nil, 404, errors.New("Informasi tidak ditemukan")
	}
	if sess.Role != "SUPER ADMIN" && sess.Role != "ADMIN" {
		if len(roles) > 0 && !containsFold(roles, sess.Role) {
			return nil, 403, errors.New("Data di luar cakupan")
		}
		var big string
		_ = s.Reporting.DB.QueryRow(ctx, `select wilayah from people_effective where nik=$1`, sess.EffectiveNIK).Scan(&big)
		if len(regions) > 0 && !containsFold(regions, big) {
			return nil, 403, errors.New("Data di luar cakupan")
		}
	}
	x, e := s.driveFilePayload(ctx, fileID)
	return x, code(e), e
}
func containsFold(a []string, v string) bool {
	for _, x := range a {
		if strings.EqualFold(strings.TrimSpace(x), strings.TrimSpace(v)) {
			return true
		}
	}
	return false
}
func (s *Server) syncFileDownload(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	x, e := s.driveFilePayload(ctx, str(p, "fileId"))
	return x, code(e), e
}
func (s *Server) syncRetry(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	id := str(p, "fileId")
	if id == "" {
		return nil, 400, errors.New("fileId wajib")
	}
	ct, e := s.Reporting.DB.Exec(ctx, `update staging_files set status='RETRY',error_text=null,processed_at=null where drive_file_id=$1`, id)
	if e != nil {
		return nil, 500, e
	}
	if ct.RowsAffected() == 0 {
		return nil, 404, errors.New("File sync tidak ditemukan")
	}
	_, _ = s.Reporting.DB.Exec(ctx, `insert into audit_log(nik,aksi,keterangan) values($1,'SYNC_RETRY',$2)`, sess.NIK, id)
	return map[string]any{"ok": true, "message": "File ditandai untuk diproses ulang pada polling berikutnya."}, 200, nil
}
