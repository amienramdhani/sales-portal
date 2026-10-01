package api

import (
	"context"
	"salesportal/internal/auth"
	"salesportal/internal/core"
	"sort"
	"strings"
	"time"
)

func infoVisible(person core.Person, regions, roles []string) bool {
	if person.Role == "SUPER ADMIN" {
		return true
	}
	if !containsFold(roles, "ALL") && !containsFold(roles, person.Role) {
		return false
	}
	if containsFold(regions, "NASIONAL") || core.Level[person.Role] >= 4 {
		return true
	}
	if person.Role == "ADMIN" {
		for _, r := range person.AdminRegions {
			if containsFold(regions, r) {
				return true
			}
		}
		return false
	}
	return containsFold(regions, person.BigRegion)
}

func (s *Server) infoContract(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	people, err := s.Scope.People(ctx)
	if err != nil {
		return nil, code(err), err
	}
	me := core.Person{}
	allRegions := map[string]bool{}
	for _, person := range people {
		if person.NIK == sess.EffectiveNIK {
			me = person
		}
		if person.BigRegion != "" {
			allRegions[person.BigRegion] = true
		}
	}
	regions := []string{"NASIONAL"}
	for r := range allRegions {
		if core.Level[me.Role] >= 4 || r == me.BigRegion || me.Role == "ADMIN" && containsFold(me.AdminRegions, r) {
			regions = append(regions, r)
		}
	}
	sort.Strings(regions)
	rows, err := s.Reporting.DB.Query(ctx, `select id,judul,isi,wilayah_list,role_list,coalesce(file_name,''),penulis_nama,dibuat,aktif,coalesce(file_id,''),coalesce(bytes,0) from announcements order by dibuat desc,id`)
	if err != nil {
		return nil, code(err), err
	}
	defer rows.Close()
	result := []map[string]any{}
	q := strings.ToLower(str(p, "query"))
	region := str(p, "region")
	for rows.Next() {
		var id, title, body, file, author, fileID string
		var rr, roles []string
		var created time.Time
		var active bool
		var size int64
		if err = rows.Scan(&id, &title, &body, &rr, &roles, &file, &author, &created, &active, &fileID, &size); err != nil {
			return nil, code(err), err
		}
		if !infoVisible(me, rr, roles) || !active && me.Role != "SUPER ADMIN" || region != "" && region != "ALL" && !containsFold(rr, region) || !strings.Contains(strings.ToLower(title+" "+body), q) {
			continue
		}
		result = append(result, map[string]any{"id": id, "title": title, "body": body, "region": strings.Join(rr, ", "), "roles": roles, "author": author, "created": created, "active": active, "fileName": file, "size": size, "hasFile": fileID != "", "canManage": !sess.Demo && me.Role == "SUPER ADMIN"})
	}
	if err = rows.Err(); err != nil {
		return nil, code(err), err
	}
	page := intval(p, "page", 0)
	if page < 0 {
		page = 0
	}
	maxPage := (len(result) - 1) / 20
	if page > maxPage {
		page = maxPage
	}
	end := (page + 1) * 20
	if end > len(result) {
		end = len(result)
	}
	return map[string]any{"regions": regions, "uploadRegions": []string{}, "canUpload": false, "total": len(result), "page": page, "pageSize": 20, "rows": result[page*20 : end]}, 200, nil
}
