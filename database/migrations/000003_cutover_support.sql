BEGIN;

-- Account merges keep historical transaction NIK untouched. Read paths resolve
-- aliases so the legacy semantics remain reproducible after cut-over.
CREATE TABLE IF NOT EXISTS nik_aliases(
  old_nik text PRIMARY KEY,
  new_nik text NOT NULL,
  reason text NOT NULL DEFAULT '',
  merged_by text NOT NULL DEFAULT '',
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK(old_nik<>new_nik)
);

-- Announcement attachments live in PostgreSQL for the single-VPS v2. This is
-- deliberately separate from announcements so metadata reads stay light.
CREATE TABLE IF NOT EXISTS announcement_files(
  announcement_id text PRIMARY KEY REFERENCES announcements(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime text NOT NULL DEFAULT 'application/octet-stream',
  content bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Admin checkpoints are logical snapshots of mutable configuration/domain rows.
-- Large raw ST/SO data remains protected by pg_dump backups and import versioning.
CREATE TABLE IF NOT EXISTS admin_checkpoints(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_nik text NOT NULL,
  label text NOT NULL,
  payload jsonb NOT NULL,
  restored_at timestamptz,
  restored_by text,
  restore_reason text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS import_jobs_actor_status_idx ON import_jobs(actor_nik,status,created_at DESC);
CREATE INDEX IF NOT EXISTS nik_aliases_new_idx ON nik_aliases(new_nik);

COMMIT;
