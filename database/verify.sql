-- Read-only post-import smoke checks.
select 'people_effective' as check_name, count(*)::bigint as value from people_effective
union all select 'customers', count(*) from customers
union all select 'products', count(*) from products
union all select 'st_lines', count(*) from st_lines
union all select 'so_lines', count(*) from so_lines
union all select 'auth_accounts', count(*) from auth_accounts
union all select 'targets', count(*) from targets
union all select 'kpi_policies', count(*) from kpi_policies
union all select 'st_daily', count(*) from st_daily
union all select 'first_purchase', count(*) from first_purchase;

-- There must not be active auth users without an org person after initial reconciliation.
select a.nik
from auth_accounts a
left join people_effective p on p.nik=a.nik
where a.aktif=true and p.nik is null;

-- Self-supervision is invalid.
select nik,nama,posisi from people where nik<>'' and nik=nik_atasan;

-- Duplicate role rows are prevented by UNIQUE(nik,posisi), but this detects conflicting names per NIK.
select nik, array_agg(distinct nama) names
from people group by nik having count(distinct nama)>1;
