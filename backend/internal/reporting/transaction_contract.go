package reporting

import (
	"context"
	"encoding/json"
	"fmt"
	"salesportal/internal/core"
)

func (s *Service) TransactionGroups(ctx context.Context, effective, period, selection, from, to string, page, size int, order map[string]any) (map[string]any, error) {
	ids, err := s.Scope.Allowed(ctx, effective, selection)
	if err != nil {
		return nil, err
	}
	if _, err = core.Month(period); err != nil {
		return nil, err
	}
	if from == "" {
		from = period + "-01"
	}
	if to == "" {
		to = core.End(period)
	}
	if _, err = core.ISO(from); err != nil {
		return nil, err
	}
	if _, err = core.ISO(to); err != nil {
		return nil, err
	}
	if from[:7] != period || to[:7] != period || from > to {
		return nil, fmt.Errorf("Rentang tanggal tidak valid")
	}
	if size != 50 && size != 100 && size != 200 {
		size = 100
	}
	if page < 0 {
		page = 0
	}
	where := `s.nik_sales=any($1) and s.tanggal between $2::date and $3::date`
	var total int
	var qty int64
	var amount float64
	err = s.DB.QueryRow(ctx, `select count(distinct (s.tanggal,s.kode_customer)),coalesce(sum(s.qty),0)::bigint,coalesce(sum(s.amount),0)::float8 from st_lines s where `+where, ids, from, to).Scan(&total, &qty, &amount)
	if err != nil {
		return nil, err
	}
	maxPage := (total - 1) / size
	if page > maxPage {
		page = maxPage
	}
	sortBy := "date desc, customer"
	if textAny(order["dir"]) == "asc" {
		sortBy = "date asc, customer"
	}
	if fmt.Sprint(order["column"]) == "1" {
		sortBy = "nama asc, date desc, customer"
		if textAny(order["dir"]) == "desc" {
			sortBy = "nama desc, date desc, customer"
		}
	}
	query := `with detail as (
 select s.tanggal::text date,s.kode_customer customer,coalesce(nullif(c.nama_induk_customer,''),c.nama_customer,s.kode_customer) nama,s.nomor_sj sj,s.badan_usaha company,p.brand,p.type,sum(s.qty)::bigint qty,sum(s.amount)::float8 amount
 from st_lines s join products p on p.kode_barang=s.kode_produk left join customers c on c.kode_customer=s.kode_customer where ` + where + `
 group by s.tanggal,s.kode_customer,c.nama_induk_customer,c.nama_customer,s.nomor_sj,s.badan_usaha,p.brand,p.type
 ), groups as (select date,customer,max(nama) nama,sum(qty)::bigint qty,sum(amount)::float8 amount,jsonb_agg(to_jsonb(detail) order by sj,brand,type) rows from detail group by date,customer)
 select date,customer,nama,qty,amount,rows from groups order by ` + sortBy + ` limit $4 offset $5`
	rows, err := s.DB.Query(ctx, query, ids, from, to, size, page*size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var date, id, name string
		var q int64
		var a float64
		var raw []byte
		if err = rows.Scan(&date, &id, &name, &q, &a, &raw); err != nil {
			return nil, err
		}
		details := []any{}
		if err = json.Unmarshal(raw, &details); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"date": date, "customer": id, "nama": name, "qty": q, "amount": a, "rows": details})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"rows": items, "page": page, "pageSize": size, "total": total, "totals": map[string]any{"qty": qty, "amount": amount}, "from": from, "to": to}, nil
}
