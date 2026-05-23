-- NetFlow DAG schema

-- pg_trgm is in contrib, available in postgres:16 (debian image)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Systems (graph nodes) — TEXT primary key from CSV
CREATE TABLE IF NOT EXISTS systems (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'unknown',
  ip         TEXT NOT NULL DEFAULT '',
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_systems_type  ON systems(type);
CREATE INDEX IF NOT EXISTS idx_systems_trgm  ON systems USING gin(label gin_trgm_ops);

-- Events (temporal directed edges)
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  event_time   TIMESTAMPTZ NOT NULL,
  source_id    TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  protocol     TEXT NOT NULL DEFAULT 'TCP',
  bytes_sent   BIGINT NOT NULL DEFAULT 0,
  bytes_recv   BIGINT NOT NULL DEFAULT 0,
  latency_ms   FLOAT NOT NULL DEFAULT 0,
  packet_loss  FLOAT NOT NULL DEFAULT 0,
  port         INT NOT NULL DEFAULT 0,
  severity     TEXT NOT NULL DEFAULT 'low'
               CHECK (severity IN ('low','medium','high','critical')),
  event_type   TEXT NOT NULL DEFAULT 'connection',
  flag         TEXT NOT NULL DEFAULT 'SYN',
  metadata     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_time     ON events(event_time);
CREATE INDEX IF NOT EXISTS idx_events_source   ON events(source_id);
CREATE INDEX IF NOT EXISTS idx_events_target   ON events(target_id);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
CREATE INDEX IF NOT EXISTS idx_events_latency  ON events(latency_ms);

-- Sessions metadata
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGSERIAL PRIMARY KEY,
  session_name TEXT NOT NULL UNIQUE,
  description  TEXT,
  min_time     TIMESTAMPTZ,
  max_time     TIMESTAMPTZ,
  event_count  INT NOT NULL DEFAULT 0,
  system_count INT NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sessions (session_name, description)
VALUES ('default', 'Default session')
ON CONFLICT (session_name) DO NOTHING;
