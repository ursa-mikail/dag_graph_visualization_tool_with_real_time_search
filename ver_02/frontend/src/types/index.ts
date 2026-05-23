export interface NSystem {
  id: string
  label: string
  type: string
  ip: string
  metadata: Record<string, unknown>
  total_events: number
  outbound: number
  inbound: number
  total_bytes: number
  avg_latency: number
  max_latency: number
  avg_packet_loss: number
  critical_count: number
  high_count: number
  first_seen?: string
  last_seen?: string
  // D3
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null
}

export interface NEvent {
  id: number
  event_time: string
  source: string
  target: string
  protocol: string
  bytes_sent: number
  bytes_recv: number
  latency_ms: number
  packet_loss: number
  port: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  event_type: string
  flag: string
  metadata: Record<string, unknown>
  source_label?: string
  target_label?: string
}

export interface GraphSnapshot {
  systems: NSystem[]
  events: NEvent[]
  min_time: string
  max_time: string
}

export interface TimeRange {
  min: string
  max: string
  count: number
}

export interface FilterValues {
  protocols: string[]
  severities: string[]
  event_types: string[]
  system_types: string[]
}

export interface FilterState {
  severities: Set<string>
  protocols: Set<string>
  eventTypes: Set<string>
  systemTypes: Set<string>
  minLatency: number
  maxLatency: number
  minBytes: number
  minPacketLoss: number
  focusSystemIds: Set<string>
}

export interface PlaybackState {
  playing: boolean
  speed: number        // 1x 2x 4x 8x 16x
  currentMs: number    // current playhead position in unix ms
  windowMs: number     // how many ms of events to show at once
}

export interface SearchResult {
  id: string
  label: string
  type: string
  ip: string
}

export type WSMessage =
  | { type: 'data_loaded'; payload: { systems: number; events: number; min: number; max: number } }
  | { type: 'data_cleared'; payload: null }
