package scope

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"salesportal/internal/core"
)

type Resolver struct{ DB *pgxpool.Pool }

func (r *Resolver) People(ctx context.Context) ([]core.Person, error) {
	rows, err := r.DB.Query(ctx, `select nik,nama,effective_role,region,nik_atasan,sales_flag,portfolio,wilayah from people_effective order by nik`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []core.Person{}
	for rows.Next() {
		var p core.Person
		if err := rows.Scan(&p.NIK, &p.Name, &p.Role, &p.Region, &p.Supervisor, &p.Sales, &p.Portfolio, &p.BigRegion); err != nil {
			return nil, err
		}
		if p.Role == "ADMIN" {
			a, err := r.DB.Query(ctx, `select wilayah from admin_regions where nik=$1 order by wilayah`, p.NIK)
			if err == nil {
				for a.Next() {
					var w string
					_ = a.Scan(&w)
					p.AdminRegions = append(p.AdminRegions, w)
				}
				a.Close()
			}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (r *Resolver) Allowed(ctx context.Context, effectiveNIK, selection string) ([]string, error) {
	p, err := r.People(ctx)
	if err != nil {
		return nil, err
	}
	base, err := core.Scope(p, effectiveNIK)
	if err != nil {
		return nil, err
	}
	if selection == "" || selection == "ALL" {
		return base, nil
	}
	ok := false
	for _, id := range base {
		if id == selection {
			ok = true
			break
		}
	}
	if !ok {
		return nil, errors.New("Data di luar cakupan")
	}
	sub, err := core.Scope(p, selection)
	if err != nil {
		return nil, err
	}
	baseSet := map[string]bool{}
	for _, id := range base {
		baseSet[id] = true
	}
	out := []string{}
	for _, id := range sub {
		if baseSet[id] {
			out = append(out, id)
		}
	}
	return out, nil
}
func (r *Resolver) CanManage(ctx context.Context, actorNIK, targetNIK string) (bool, error) {
	p, err := r.People(ctx)
	if err != nil {
		return false, err
	}
	var a, t *core.Person
	for i := range p {
		if p[i].NIK == actorNIK {
			a = &p[i]
		}
		if p[i].NIK == targetNIK {
			t = &p[i]
		}
	}
	if a == nil || t == nil {
		return false, nil
	}
	return a.Role == "SUPER ADMIN" || (a.Role == "ADMIN" && (t.Role == "SALES" || t.Role == "ASM" || t.Role == "RGM") && contains(a.AdminRegions, t.BigRegion)), nil
}
func (r *Resolver) RequireSelection(ctx context.Context, effectiveNIK string, payload map[string]any) error {
	for _, k := range []string{"nik", "targetNik", "selection"} {
		if v, ok := payload[k]; ok {
			sv := strings.TrimSpace(fmt.Sprint(v))
			if sv != "" && sv != "ALL" {
				if _, err := r.Allowed(ctx, effectiveNIK, sv); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func contains(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
