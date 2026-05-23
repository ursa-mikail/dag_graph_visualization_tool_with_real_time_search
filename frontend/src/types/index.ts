export interface Node {
  id: string;
  domain_id: string;
  type_name: string;
  label: string;
  risk_score: number;
  country: string;
  metadata: Record<string, unknown>;
  created_at: string;
  color?: string;
  edge_count?: number;
  volume?: number;
  // D3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface Edge {
  id: string;
  source: string | Node;
  target: string | Node;
  label: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
  domain: string;
}

export interface SearchResult {
  id: string;
  label: string;
  type_name: string;
  country: string;
  risk_score: number;
}

export interface SchemaColumn {
  name: string;
  data_type: string;
  nullable: boolean;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  sample_rows: Record<string, unknown>[];
  total_rows: number;
  page: number;
  page_size: number;
}

export interface Alert {
  id: string;
  node_id: string;
  node_label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rule_name: string;
  description: string;
  created_at: string;
}

export interface NodeType {
  name: string;
  color: string;
  icon: string;
  description: string;
}

export interface WSMessage {
  type: 'node_added' | 'edge_added' | 'alert' | 'stats';
  payload: Node | Edge | Alert | Record<string, unknown>;
}
