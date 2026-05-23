package models

import (
	"encoding/json"
	"time"
)

type Node struct {
	ID        string          `json:"id" db:"id"`
	DomainID  string          `json:"domain_id" db:"domain_id"`
	TypeName  string          `json:"type_name" db:"type_name"`
	Label     string          `json:"label" db:"label"`
	RiskScore float64         `json:"risk_score" db:"risk_score"`
	Country   string          `json:"country" db:"country"`
	Metadata  json.RawMessage `json:"metadata" db:"metadata"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt time.Time       `json:"updated_at" db:"updated_at"`
	// Computed
	Color     string  `json:"color,omitempty"`
	EdgeCount int     `json:"edge_count,omitempty"`
	Volume    float64 `json:"volume,omitempty"`
}

type Edge struct {
	ID        string          `json:"id" db:"id"`
	DomainID  string          `json:"domain_id" db:"domain_id"`
	SourceID  string          `json:"source" db:"source_id"`
	TargetID  string          `json:"target" db:"target_id"`
	Label     string          `json:"label" db:"label"`
	Weight    float64         `json:"weight" db:"weight"`
	Metadata  json.RawMessage `json:"metadata" db:"metadata"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
}

type Graph struct {
	Nodes  []Node `json:"nodes"`
	Edges  []Edge `json:"edges"`
	Domain string `json:"domain"`
}

type SearchResult struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	TypeName string `json:"type_name"`
	Country  string `json:"country"`
	Score    float64 `json:"risk_score"`
}

type SchemaTable struct {
	Name        string         `json:"name"`
	RowCount    int64          `json:"row_count"`
	Columns     []SchemaColumn `json:"columns"`
	SampleRows  []map[string]interface{} `json:"sample_rows"`
	TotalRows   int64          `json:"total_rows"`
	Page        int            `json:"page"`
	PageSize    int            `json:"page_size"`
}

type SchemaColumn struct {
	Name     string `json:"name"`
	DataType string `json:"data_type"`
	Nullable bool   `json:"nullable"`
}

type Alert struct {
	ID          string    `json:"id"`
	DomainID    string    `json:"domain_id"`
	NodeID      string    `json:"node_id"`
	NodeLabel   string    `json:"node_label"`
	Severity    string    `json:"severity"`
	RuleName    string    `json:"rule_name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type NodeType struct {
	Name        string `json:"name"`
	Color       string `json:"color"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}
