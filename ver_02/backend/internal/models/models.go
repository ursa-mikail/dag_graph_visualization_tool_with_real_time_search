package models

import (
	"encoding/json"
	"time"
)

type System struct {
	ID        string          `json:"id"`
	Label     string          `json:"label"`
	Type      string          `json:"type"`
	IP        string          `json:"ip"`
	Metadata  json.RawMessage `json:"metadata"`
	CreatedAt time.Time       `json:"created_at"`
	// Computed stats
	TotalEvents   int64   `json:"total_events,omitempty"`
	Outbound      int64   `json:"outbound,omitempty"`
	Inbound       int64   `json:"inbound,omitempty"`
	TotalBytes    int64   `json:"total_bytes,omitempty"`
	AvgLatency    float64 `json:"avg_latency,omitempty"`
	MaxLatency    float64 `json:"max_latency,omitempty"`
	AvgPacketLoss float64 `json:"avg_packet_loss,omitempty"`
	CriticalCount int64   `json:"critical_count,omitempty"`
	HighCount     int64   `json:"high_count,omitempty"`
	FirstSeen     *time.Time `json:"first_seen,omitempty"`
	LastSeen      *time.Time `json:"last_seen,omitempty"`
}

type Event struct {
	ID         int64           `json:"id"`
	EventTime  time.Time       `json:"event_time"`
	SourceID   string          `json:"source"`
	TargetID   string          `json:"target"`
	Protocol   string          `json:"protocol"`
	BytesSent  int64           `json:"bytes_sent"`
	BytesRecv  int64           `json:"bytes_recv"`
	LatencyMs  float64         `json:"latency_ms"`
	PacketLoss float64         `json:"packet_loss"`
	Port       int             `json:"port"`
	Severity   string          `json:"severity"`
	EventType  string          `json:"event_type"`
	Flag       string          `json:"flag"`
	Metadata   json.RawMessage `json:"metadata"`
	// Populated from join
	SourceLabel string `json:"source_label,omitempty"`
	TargetLabel string `json:"target_label,omitempty"`
}

type TimelineFrame struct {
	Timestamp time.Time `json:"timestamp"`
	Events    []Event   `json:"events"`
	Systems   []System  `json:"systems"`
}

type TimeRange struct {
	Min   time.Time `json:"min"`
	Max   time.Time `json:"max"`
	Count int64     `json:"count"`
}

type GraphSnapshot struct {
	Systems []System `json:"systems"`
	Events  []Event  `json:"events"`
	MinTime time.Time `json:"min_time"`
	MaxTime time.Time `json:"max_time"`
}

type FilterParams struct {
	MinLatency    float64   `json:"min_latency"`
	MaxLatency    float64   `json:"max_latency"`
	MinBytes      int64     `json:"min_bytes"`
	Severities    []string  `json:"severities"`
	Protocols     []string  `json:"protocols"`
	SystemTypes   []string  `json:"system_types"`
	SystemIDs     []string  `json:"system_ids"`
	EventTypes    []string  `json:"event_types"`
	FromTime      time.Time `json:"from_time"`
	ToTime        time.Time `json:"to_time"`
	MinPacketLoss float64   `json:"min_packet_loss"`
}

type ImportResult struct {
	Systems  int      `json:"systems"`
	Events   int      `json:"events"`
	Errors   []string `json:"errors"`
	MinTime  time.Time `json:"min_time"`
	MaxTime  time.Time `json:"max_time"`
}

type SearchResult struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type"`
	IP    string `json:"ip"`
}

type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type PlaybackState struct {
	Playing  bool      `json:"playing"`
	Speed    float64   `json:"speed"`
	Current  time.Time `json:"current"`
	Min      time.Time `json:"min"`
	Max      time.Time `json:"max"`
}
