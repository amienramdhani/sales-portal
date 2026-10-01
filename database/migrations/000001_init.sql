BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations_meta(
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Import staging: values are intentionally text so legacy workbook parsing can be reproduced exactly.
CREATE TABLE IF NOT EXISTS app_settings(
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging_files(
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  drive_file_id text,
  file_name text NOT NULL,
  mime_type text,
  file_size bigint,
  sha256 text NOT NULL,
  modified_time timestamptz,
  detected_type text,
  status text NOT NULL DEFAULT 'NEW',
  row_count int NOT NULL DEFAULT 0,
  periods text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(source, drive_file_id, sha256)
);
CREATE TABLE IF NOT EXISTS staging_rows(
  id bigserial PRIMARY KEY,
  staging_file_id bigint REFERENCES staging_files(id) ON DELETE CASCADE,
  sheet_name text NOT NULL,
  row_no int NOT NULL,
  raw jsonb NOT NULL,
  validation_status text NOT NULL DEFAULT 'PENDING',
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized jsonb,
  UNIQUE(staging_file_id,sheet_name,row_no)
);

CREATE TABLE IF NOT EXISTS regions(
  region text PRIMARY KEY,
  wilayah_kpi text NOT NULL DEFAULT '',
  kanal text NOT NULL DEFAULT '' CHECK (kanal IN ('','ONLINE')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per NIK+position preserves role rangkap. Historical rows are never physically removed.
CREATE TABLE IF NOT EXISTS people(
  id bigserial PRIMARY KEY,
  nik text NOT NULL,
  nama text NOT NULL,
  posisi text NOT NULL,
  region text NOT NULL DEFAULT '',
  nik_atasan text NOT NULL DEFAULT '',
  aktif boolean NOT NULL DEFAULT true,
  source_row int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(nik,posisi)
);
CREATE INDEX IF NOT EXISTS people_nik_idx ON people(nik);
CREATE INDEX IF NOT EXISTS people_atasan_idx ON people(nik_atasan);

CREATE TABLE IF NOT EXISTS admin_regions(
  nik text NOT NULL,
  wilayah text NOT NULL,
  PRIMARY KEY(nik,wilayah)
);

CREATE TABLE IF NOT EXISTS auth_accounts(
  nik text PRIMARY KEY,
  salt text NOT NULL,
  pin_hash text NOT NULL,
  aktif boolean NOT NULL DEFAULT true,
  versi int NOT NULL DEFAULT 1,
  wajib_ganti boolean NOT NULL DEFAULT false,
  gagal int NOT NULL DEFAULT 0,
  lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions(
  id text PRIMARY KEY,
  nik text NOT NULL REFERENCES auth_accounts(nik) ON DELETE CASCADE,
  effective_nik text NOT NULL,
  role text NOT NULL,
  auth_version int NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS customers(
  kode_customer text PRIMARY KEY,
  id_dealer text NOT NULL DEFAULT '',
  alias text NOT NULL DEFAULT '',
  nama_customer text NOT NULL DEFAULT '',
  nama_induk_customer text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  sub_region text NOT NULL DEFAULT '',
  alamat text NOT NULL DEFAULT '',
  kota text NOT NULL DEFAULT '',
  no_hp text NOT NULL DEFAULT '',
  nik_sales text NOT NULL DEFAULT '',
  nama_pic text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_nik_idx ON customers(nik_sales);
CREATE INDEX IF NOT EXISTS customers_region_idx ON customers(region,sub_region);

CREATE TABLE IF NOT EXISTS customer_owner_history(
  id bigserial PRIMARY KEY,
  kode_customer text NOT NULL REFERENCES customers(kode_customer),
  nik_sales text NOT NULL,
  berlaku_mulai date NOT NULL,
  berlaku_sampai date,
  sumber text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kode_customer,berlaku_mulai)
);

CREATE TABLE IF NOT EXISTS customer_region_override(
  id bigserial PRIMARY KEY,
  kode_customer text NOT NULL REFERENCES customers(kode_customer),
  wilayah text NOT NULL,
  berlaku_mulai date NOT NULL,
  UNIQUE(kode_customer,berlaku_mulai)
);

CREATE TABLE IF NOT EXISTS customer_contact_requests(
  id bigserial PRIMARY KEY,
  kode_customer text NOT NULL REFERENCES customers(kode_customer),
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  alasan text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENGAJUAN',
  diajukan_oleh text NOT NULL DEFAULT '',
  diajukan_at timestamptz NOT NULL DEFAULT now(),
  diproses_oleh text,
  diproses_at timestamptz,
  catatan text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS customer_closures(
  id bigserial PRIMARY KEY,
  kode_customer text NOT NULL REFERENCES customers(kode_customer),
  tanggal_tutup date NOT NULL,
  alasan text NOT NULL,
  status text NOT NULL CHECK(status IN ('PENGAJUAN','TUTUP','DITOLAK','DIBUKA')),
  diajukan_oleh text NOT NULL,
  diajukan_at timestamptz NOT NULL DEFAULT now(),
  diproses_oleh text,
  diproses_at timestamptz,
  catatan text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS closures_status_idx ON customer_closures(kode_customer,status,tanggal_tutup);

CREATE TABLE IF NOT EXISTS customer_promotors(
  kode_customer text NOT NULL REFERENCES customers(kode_customer) ON DELETE CASCADE,
  brand text NOT NULL,
  jumlah int,
  present_in_master boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kode_customer,brand),
  CHECK(jumlah IS NULL OR jumlah>=0)
);
CREATE TABLE IF NOT EXISTS customer_grades(
  kode_customer text NOT NULL REFERENCES customers(kode_customer) ON DELETE CASCADE,
  brand text NOT NULL,
  grade varchar(20) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kode_customer,brand)
);

CREATE TABLE IF NOT EXISTS brands(
  source_brand text PRIMARY KEY,
  brand_utama text NOT NULL,
  masuk_qty boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS products(
  kode_barang text PRIMARY KEY,
  nama_barang text NOT NULL,
  source_brand text NOT NULL REFERENCES brands(source_brand),
  brand text NOT NULL,
  kategori_produk text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  masuk_qty boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_brand_type_idx ON products(brand,type);

CREATE TABLE IF NOT EXISTS st_lines(
  id bigserial PRIMARY KEY,
  tanggal date NOT NULL,
  badan_usaha text NOT NULL DEFAULT '',
  no_transaksi text NOT NULL,
  nomor_sj text NOT NULL DEFAULT '',
  kode_gudang text NOT NULL DEFAULT '',
  kode_produk text NOT NULL REFERENCES products(kode_barang),
  kode_customer text NOT NULL,
  nik_sales text NOT NULL,
  qty int NOT NULL CHECK(qty<>0),
  amount numeric(20,2) NOT NULL,
  id_baris text NOT NULL DEFAULT '',
  ref_transaksi text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  import_version bigint NOT NULL DEFAULT 1,
  source_file_id bigint REFERENCES staging_files(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((qty>0 AND amount>=0) OR (qty<0 AND amount<=0))
);
CREATE INDEX IF NOT EXISTS st_period_region_idx ON st_lines(tanggal,region);
CREATE INDEX IF NOT EXISTS st_scope_idx ON st_lines(nik_sales,tanggal);
CREATE INDEX IF NOT EXISTS st_customer_idx ON st_lines(kode_customer,tanggal);
CREATE UNIQUE INDEX IF NOT EXISTS st_idbaris_unique ON st_lines(badan_usaha,no_transaksi,id_baris) WHERE id_baris<>'';

CREATE TABLE IF NOT EXISTS so_lines(
  id bigserial PRIMARY KEY,
  tanggal date NOT NULL,
  kode_customer text NOT NULL,
  kode_produk text NOT NULL REFERENCES products(kode_barang),
  qty int NOT NULL CHECK(qty<>0),
  region text NOT NULL DEFAULT '',
  import_version bigint NOT NULL DEFAULT 1,
  source_file_id bigint REFERENCES staging_files(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS so_period_region_idx ON so_lines(tanggal,region);
CREATE INDEX IF NOT EXISTS so_customer_idx ON so_lines(kode_customer,tanggal);

CREATE TABLE IF NOT EXISTS coverage(
  period char(7) NOT NULL,
  region text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('ST','SO')),
  cutoff date NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  upload_version bigint NOT NULL DEFAULT 1,
  source_file_id bigint REFERENCES staging_files(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(period,region,kind)
);

CREATE TABLE IF NOT EXISTS targets(
  period char(7) NOT NULL,
  nik text NOT NULL,
  brand text NOT NULL,
  metric text NOT NULL CHECK(metric IN ('QTY','DA','NOO','OMZET')),
  indicator_id text NOT NULL DEFAULT '',
  value numeric(20,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(period,nik,brand,metric,indicator_id)
);
COMMENT ON COLUMN targets.value IS 'NULL=belum diisi, 0=tidak diwajibkan';

CREATE TABLE IF NOT EXISTS kpi_policies(
  id bigserial PRIMARY KEY,
  period char(7) NOT NULL,
  wilayah text NOT NULL,
  kelompok text NOT NULL,
  metric text NOT NULL CHECK(metric IN ('QTY','DA','NOO','OMZET')),
  brand text NOT NULL,
  bobot numeric(9,4) NOT NULL CHECK(bobot>0),
  batas_skor numeric(9,4) NOT NULL CHECK(batas_skor>0),
  aktif boolean NOT NULL DEFAULT true,
  indicator_id text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  type_filter text[] NOT NULL DEFAULT '{}',
  min_qty_da int NOT NULL DEFAULT 2 CHECK(min_qty_da>=1),
  UNIQUE(period,wilayah,kelompok,metric,brand,indicator_id)
);
CREATE TABLE IF NOT EXISTS kpi_rgm_policies(
  id bigserial PRIMARY KEY,
  period char(7) NOT NULL,
  nik text NOT NULL,
  kelompok text NOT NULL,
  indicator_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  metric text NOT NULL,
  brand text NOT NULL,
  type_filter text[] NOT NULL DEFAULT '{}',
  big_regions text[] NOT NULL DEFAULT '{}',
  bobot numeric(9,4) NOT NULL,
  batas_skor numeric(9,4) NOT NULL,
  target numeric(20,2),
  min_qty_da int NOT NULL DEFAULT 2,
  UNIQUE(period,nik,kelompok,indicator_id)
);

CREATE TABLE IF NOT EXISTS dos_config(
  wilayah text PRIMARY KEY,
  dos_min numeric(12,2) NOT NULL DEFAULT 7,
  dos_max numeric(12,2) NOT NULL DEFAULT 45
);
CREATE TABLE IF NOT EXISTS holidays(
  tanggal date PRIMARY KEY,
  keterangan text NOT NULL DEFAULT '',
  aktif boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS period_locks(
  period char(7) PRIMARY KEY,
  terkunci boolean NOT NULL DEFAULT false,
  alasan text NOT NULL DEFAULT '',
  oleh text NOT NULL DEFAULT '',
  waktu timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS export_access(
  nik text NOT NULL,
  jenis_export text NOT NULL,
  aktif boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(nik,jenis_export)
);

CREATE TABLE IF NOT EXISTS announcements(
  id text PRIMARY KEY,
  judul text NOT NULL,
  isi text NOT NULL,
  wilayah_list text[] NOT NULL DEFAULT '{}',
  role_list text[] NOT NULL DEFAULT '{}',
  file_id text,
  file_name text,
  mime text,
  bytes bigint,
  penulis_nik text NOT NULL,
  penulis_nama text NOT NULL DEFAULT '',
  dibuat timestamptz NOT NULL DEFAULT now(),
  aktif boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_log(
  id bigserial PRIMARY KEY,
  waktu timestamptz NOT NULL DEFAULT now(),
  nik text NOT NULL DEFAULT '',
  aksi text NOT NULL,
  keterangan text NOT NULL DEFAULT '',
  request_id text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log(waktu DESC);
CREATE TABLE IF NOT EXISTS ai_log(
  id bigserial PRIMARY KEY,
  waktu timestamptz NOT NULL DEFAULT now(),
  nik text NOT NULL,
  role text NOT NULL,
  question text NOT NULL,
  intent text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT '',
  rows_returned int NOT NULL DEFAULT 0,
  model text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  duration_ms int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS publish_log(
  id bigserial PRIMARY KEY,
  waktu timestamptz NOT NULL DEFAULT now(),
  aktor text NOT NULL,
  alasan text NOT NULL,
  snapshot jsonb
);
CREATE TABLE IF NOT EXISTS backup_log(
  id bigserial PRIMARY KEY,
  waktu timestamptz NOT NULL DEFAULT now(),
  jenis text NOT NULL,
  status text NOT NULL,
  lokasi text NOT NULL DEFAULT '',
  keterangan text NOT NULL DEFAULT '',
  restore_tested boolean NOT NULL DEFAULT false,
  restore_tested_at timestamptz
);
CREATE TABLE IF NOT EXISTS sync_log(
  id bigserial PRIMARY KEY,
  waktu timestamptz NOT NULL DEFAULT now(),
  file_name text NOT NULL,
  drive_file_id text,
  sha256 text,
  jenis text NOT NULL DEFAULT '',
  status text NOT NULL,
  bulan text[] NOT NULL DEFAULT '{}',
  region text[] NOT NULL DEFAULT '{}',
  baris int NOT NULL DEFAULT 0,
  qty bigint NOT NULL DEFAULT 0,
  keterangan text NOT NULL DEFAULT ''
);

-- Derived tables are rebuilt transactionally after import.
CREATE TABLE IF NOT EXISTS st_daily(
  tanggal date NOT NULL,
  nik text NOT NULL,
  kode_customer text NOT NULL,
  brand text NOT NULL,
  type text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  qty bigint NOT NULL DEFAULT 0,
  amount numeric(20,2) NOT NULL DEFAULT 0,
  amount_accessory numeric(20,2) NOT NULL DEFAULT 0,
  docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY(tanggal,nik,kode_customer,brand,type,region)
);
CREATE INDEX IF NOT EXISTS st_daily_scope_idx ON st_daily(nik,tanggal);
CREATE INDEX IF NOT EXISTS st_daily_customer_idx ON st_daily(kode_customer,tanggal);

CREATE TABLE IF NOT EXISTS first_purchase(
  kode_customer text NOT NULL,
  brand text NOT NULL,
  tanggal date NOT NULL,
  nik text NOT NULL,
  PRIMARY KEY(kode_customer,brand)
);
CREATE TABLE IF NOT EXISTS unlinked_returns(
  kode_customer text NOT NULL,
  brand text NOT NULL,
  first_seen date NOT NULL,
  last_seen date NOT NULL,
  count_rows int NOT NULL DEFAULT 1,
  PRIMARY KEY(kode_customer,brand)
);

CREATE TABLE IF NOT EXISTS import_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  actor_nik text NOT NULL,
  status text NOT NULL DEFAULT 'STAGED',
  reason text NOT NULL DEFAULT '',
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_file_id bigint REFERENCES staging_files(id),
  base_data_version bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '1 hour'),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

-- Effective role view. Highest position wins, sales flag remains true if any row is SALES.
CREATE OR REPLACE VIEW people_effective AS
WITH ranked AS (
  SELECT p.*,
    CASE upper(posisi)
      WHEN 'SALES' THEN 1 WHEN 'ASM' THEN 2 WHEN 'RGM' THEN 3 WHEN 'ADMIN' THEN 3.5
      WHEN 'HEAD OF SALES' THEN 4 WHEN 'CHIEF OPERATING OFFICER' THEN 5
      WHEN 'CHIEF COMMERCIAL OFFICER' THEN 5 WHEN 'BOARD OF DIRECTOR' THEN 6
      WHEN 'SUPER ADMIN' THEN 7 ELSE 0 END AS role_level,
    bool_or(upper(posisi)='SALES') OVER(PARTITION BY nik) AS sales_flag,
    max(CASE WHEN upper(posisi)='SALES' THEN region ELSE '' END) OVER(PARTITION BY nik) AS portfolio
  FROM people p WHERE aktif=true
), x AS (
  SELECT *, row_number() over(partition by nik order by role_level desc,id asc) rn FROM ranked
)
SELECT x.nik,x.nama,upper(x.posisi) effective_role,x.role_level,x.region,x.nik_atasan,
       x.sales_flag,x.portfolio,coalesce(r.wilayah_kpi,'') wilayah
FROM x LEFT JOIN regions r ON r.region=coalesce(nullif(x.region,''),nullif(x.portfolio,''))
WHERE rn=1;

CREATE OR REPLACE VIEW customer_current_closure AS
SELECT DISTINCT ON (kode_customer) kode_customer,tanggal_tutup,status,alasan
FROM customer_closures ORDER BY kode_customer,diproses_at DESC NULLS LAST,diajukan_at DESC;

INSERT INTO schema_migrations_meta(key,value) VALUES('data_version','0') ON CONFLICT(key) DO NOTHING;
COMMIT;

