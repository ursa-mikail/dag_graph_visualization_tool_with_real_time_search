-- ─── DAGViz Schema ────────────────────────────────────────────────────────────
-- Supports any domain: money laundering, network comms, supply chain, etc.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Domains ──────────────────────────────────────────────────────────────────
CREATE TABLE domains (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Entity / Node Types (configurable per domain) ────────────────────────────
CREATE TABLE node_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id   UUID REFERENCES domains(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#00ff88',
  icon        TEXT,
  description TEXT,
  UNIQUE(domain_id, name)
);

-- ─── Nodes ────────────────────────────────────────────────────────────────────
CREATE TABLE nodes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id   UUID REFERENCES domains(id) ON DELETE CASCADE,
  type_name   TEXT NOT NULL,
  label       TEXT NOT NULL,
  risk_score  FLOAT DEFAULT 0.0 CHECK (risk_score >= 0 AND risk_score <= 1),
  country     TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nodes_domain ON nodes(domain_id);
CREATE INDEX idx_nodes_type ON nodes(type_name);
CREATE INDEX idx_nodes_label_trgm ON nodes USING gin(label gin_trgm_ops);
CREATE INDEX idx_nodes_risk ON nodes(risk_score DESC);
CREATE INDEX idx_nodes_metadata ON nodes USING gin(metadata);

-- ─── Edges ────────────────────────────────────────────────────────────────────
CREATE TABLE edges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id   UUID REFERENCES domains(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'connects',
  weight      FLOAT DEFAULT 1.0,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, label)
);

CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_domain ON edges(domain_id);
CREATE INDEX idx_edges_label ON edges(label);

-- ─── Transaction Log (domain-agnostic event log) ──────────────────────────────
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  domain_id   UUID REFERENCES domains(id),
  event_type  TEXT NOT NULL,  -- 'node_added','edge_added','node_updated','flagged'
  node_id     UUID REFERENCES nodes(id) ON DELETE SET NULL,
  edge_id     UUID REFERENCES edges(id) ON DELETE SET NULL,
  amount      NUMERIC(20,4),
  currency    TEXT,
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_domain ON events(domain_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_time ON events(occurred_at DESC);
CREATE INDEX idx_events_node ON events(node_id);

-- ─── Alerts / Flags ───────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id   UUID REFERENCES domains(id),
  node_id     UUID REFERENCES nodes(id) ON DELETE CASCADE,
  severity    TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  rule_name   TEXT NOT NULL,
  description TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_node ON alerts(node_id);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_resolved ON alerts(resolved);

-- ─── Seed: Money Laundering Domain ───────────────────────────────────────────
INSERT INTO domains (id, name, description) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'laundering', 'Criminal money laundering flow detection'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'network',    'Network communications & packet flow'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'supply',     'Supply chain provenance tracking');

INSERT INTO node_types (domain_id, name, color, icon, description) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'shell_company',  '#ff4444', '🏢', 'Opaque corporate entity'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bank_account',   '#4488ff', '🏦', 'Financial institution account'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'crypto_wallet',  '#ffaa00', '₿',  'Blockchain wallet address'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'individual',     '#00ff88', '👤', 'Named person of interest'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'real_estate',    '#aa44ff', '🏠', 'Property asset'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'offshore_fund',  '#ff8844', '💰', 'Offshore investment vehicle'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'server',         '#00aaff', '🖥️', 'Network server node'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'endpoint',       '#44ff88', '💻', 'Client endpoint'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'router',         '#ffff44', '📡', 'Network router'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'supplier',       '#ff44aa', '🏭', 'Raw material supplier'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'manufacturer',   '#44aaff', '⚙️', 'Manufacturer'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'distributor',    '#aaffaa', '🚚', 'Distribution hub');

-- ─── Helper: update updated_at ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nodes_updated_at BEFORE UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
