import type { Graph, SearchResult, SchemaTable, Alert, NodeType } from '../types';

const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export const api = {
  getGraph: (domain?: string, limit = 300) =>
    get<Graph>('/graph', { ...(domain ? { domain } : {}), limit: String(limit) }),

  getNeighbors: (nodeId: string, depth = 2) =>
    get<Graph>(`/nodes/${nodeId}/neighbors`, { depth: String(depth) }),

  search: (q: string, limit = 10) =>
    get<SearchResult[]>('/search', { q, limit: String(limit) }),

  getSchema: (table: string, page = 1, pageSize = 20) =>
    get<SchemaTable>('/schema', { table, page: String(page), page_size: String(pageSize) }),

  getTables: () => get<string[]>('/tables'),

  getNodeTypes: (domain?: string) =>
    get<NodeType[]>('/node-types', domain ? { domain } : {}),

  getAlerts: (limit = 50) =>
    get<Alert[]>('/alerts', { limit: String(limit) }),

  exportCSV: (type: 'nodes' | 'edges', domain?: string) => {
    const url = new URL('/api/export/csv', window.location.origin);
    url.searchParams.set('type', type);
    if (domain) url.searchParams.set('domain', domain);
    const a = document.createElement('a');
    a.href = url.toString();
    a.download = `dagviz_${type}_${Date.now()}.csv`;
    a.click();
  },

  importCSV: async (file: File, type: 'nodes' | 'edges', domain?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    if (domain) form.append('domain', domain);
    const res = await fetch('/api/import/csv', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Import failed');
    return res.json() as Promise<{ imported: number; errors: string[] }>;
  },
};
