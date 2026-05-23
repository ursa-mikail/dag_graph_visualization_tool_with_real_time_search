import type { GraphSnapshot, TimeRange, FilterValues, NEvent, NSystem, SearchResult, FilterState } from '../types'

const BASE = '/api'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export function filterToParams(f: FilterState): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.severities.size)    p.severities     = [...f.severities].join(',')
  if (f.protocols.size)     p.protocols      = [...f.protocols].join(',')
  if (f.eventTypes.size)    p.event_types    = [...f.eventTypes].join(',')
  if (f.systemTypes.size)   p.system_types   = [...f.systemTypes].join(',')
  if (f.minLatency > 0)     p.min_latency    = String(f.minLatency)
  if (f.maxLatency > 0)     p.max_latency    = String(f.maxLatency)
  if (f.minBytes > 0)       p.min_bytes      = String(f.minBytes)
  if (f.minPacketLoss > 0)  p.min_packet_loss = String(f.minPacketLoss)
  if (f.focusSystemIds.size) p.system_ids    = [...f.focusSystemIds].join(',')
  return p
}

export const api = {
  health:       ()               => get<{ status: string; events: number }>('/health'),
  getTimeRange: ()               => get<TimeRange>('/timerange'),
  getSnapshot:  (tMs: number, f: FilterState) =>
    get<GraphSnapshot>('/snapshot', { t: String(tMs), ...filterToParams(f) }),
  getEvents:    (fromMs: number, toMs: number, f: FilterState) =>
    get<NEvent[]>('/events', { from: String(fromMs), to: String(toMs), ...filterToParams(f) }),
  getSystems:   (f: FilterState) => get<NSystem[]>('/systems', filterToParams(f)),
  getFilterValues: ()            => get<FilterValues>('/filters/values'),
  search:       (q: string)      => get<SearchResult[]>('/search', { q, limit: '12' }),

  importCSV: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/import/csv', { method: 'POST', body: form })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body
  },

  exportCSV: (f: FilterState) => {
    const url = new URL('/api/export/csv', window.location.origin)
    Object.entries(filterToParams(f)).forEach(([k, v]) => url.searchParams.set(k, v))
    const a = document.createElement('a'); a.href = url.toString()
    a.download = `netflow_${Date.now()}.csv`; a.click()
  },

  clearData: () => fetch('/api/data', { method: 'DELETE' }),
}
