BEGIN;

CREATE TABLE IF NOT EXISTS app_settings(
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key,value)
VALUES ('sync_enabled','true'::jsonb)
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS worker_runtime(
  worker text PRIMARY KEY,
  instance_id text NOT NULL DEFAULT '',
  started_at timestamptz,
  heartbeat_at timestamptz,
  last_run_started_at timestamptz,
  last_success_at timestamptz,
  last_file text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
