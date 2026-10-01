package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"salesportal/internal/auth"
)

// importRejected exports rows rejected during a staged bulk operation.  The
// staging format is intentionally generic: preview.rejected may contain either
// plain row objects or {row,alasan,solusi} records copied from the legacy flow.
func (s *Server) importRejected(ctx context.Context, sess auth.Session, endpoint string, p map[string]any) (any, int, error) {
	if e := s.requireAdmin(sess); e != nil {
		return nil, 403, e
	}
	id := str(p, "id")
	if id == "" {
		return nil, 400, errors.New("ID pratinjau wajib")
	}
	var actor, kind string
	var raw []byte
	err := s.Reporting.DB.QueryRow(ctx, `select actor_nik,kind,preview::text from import_jobs where id=$1::uuid and expires_at>now()`, id).Scan(&actor, &kind, &raw)
	if err != nil {
		return nil, 404, errors.New("Pratinjau tidak tersedia atau kedaluwarsa.")
	}
	if actor != sess.NIK && sess.Role != "SUPER ADMIN" {
		return nil, 403, errors.New("Pratinjau milik user lain.")
	}
	var prev map[string]any
	if err = json.Unmarshal(raw, &prev); err != nil {
		return nil, 500, err
	}
	vals, _ := prev["rejected"].([]any)
	if len(vals) == 0 {
		return nil, 400, errors.New("Tidak ada baris ditolak.")
	}

	flat := []map[string]any{}
	keys := map[string]bool{"ALASAN": true, "SOLUSI": true}
	for _, v := range vals {
		m, _ := v.(map[string]any)
		if m == nil {
			continue
		}
		row := m
		if r, ok := m["row"].(map[string]any); ok {
			row = r
		}
		x := map[string]any{}
		for k, z := range row {
			x[k] = z
			keys[k] = true
		}
		if z, ok := m["alasan"]; ok {
			x["ALASAN"] = z
		}
		if z, ok := m["solusi"]; ok {
			x["SOLUSI"] = z
		}
		flat = append(flat, x)
	}
	if len(flat) == 0 {
		return nil, 400, errors.New("Tidak ada baris ditolak.")
	}
	headers := []string{}
	for k := range keys {
		if k != "ALASAN" && k != "SOLUSI" {
			headers = append(headers, k)
		}
	}
	sort.Strings(headers)
	headers = append(headers, "ALASAN", "SOLUSI")
	rows := [][]any{}
	for _, m := range flat {
		r := make([]any, 0, len(headers))
		for _, h := range headers {
			r = append(r, m[h])
		}
		rows = append(rows, r)
	}
	name := "Rejected-" + kind + ".xlsx"
	if endpoint == "apiUsersRejected" {
		name = "User-Ditolak.xlsx"
	}
	if endpoint == "apiTransferRejected" {
		name = "Transfer-Dealer-Ditolak.xlsx"
	}
	x, e := xlsxPayload(name, "Ditolak", headers, rows, []string{fmt.Sprintf("ID pratinjau: %s", id)})
	return x, code(e), e
}
