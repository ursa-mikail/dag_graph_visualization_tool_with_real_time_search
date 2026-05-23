package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/dagviz/backend/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, dsn string) (*DB, error) {
	var pool *pgxpool.Pool
	var err error

	for i := 0; i < 15; i++ {
		pool, err = pgxpool.New(ctx, dsn)
		if err == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				log.Println("DB: connected")
				break
			} else {
				pool.Close()
				err = pingErr
			}
		}
		log.Printf("DB not ready (%v), retrying in 2s... (%d/15)", err, i+1)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("db connect failed after retries: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (d *DB) Close() { d.pool.Close() }

// ─── Graph ────────────────────────────────────────────────────────────────────

func (d *DB) GetGraph(ctx context.Context, domain string, limit int) (*models.Graph, error) {
	if limit <= 0 {
		limit = 300
	}

	domainID, err := d.GetDomainID(ctx, domain)
	if err != nil {
		return nil, fmt.Errorf("domain lookup: %w", err)
	}

	// Nodes with color from node_types and computed edge_count/volume
	rows, err := d.pool.Query(ctx, `
		SELECT
			n.id, n.domain_id, n.type_name, n.label, n.risk_score,
			COALESCE(n.country, ''), n.metadata, n.created_at, n.updated_at,
			COALESCE(nt.color, '#4488ff'),
			COUNT(DISTINCT e.id)::int   AS edge_count,
			COALESCE(SUM(e.weight), 0)  AS volume
		FROM nodes n
		LEFT JOIN node_types nt ON nt.domain_id = n.domain_id AND nt.name = n.type_name
		LEFT JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
		WHERE n.domain_id = $1
		GROUP BY n.id, n.domain_id, n.type_name, n.label, n.risk_score,
		         n.country, n.metadata, n.created_at, n.updated_at, nt.color
		ORDER BY n.risk_score DESC, n.created_at DESC
		LIMIT $2
	`, domainID, limit)
	if err != nil {
		return nil, fmt.Errorf("nodes query: %w", err)
	}
	defer rows.Close()

	nodes := []models.Node{}
	nodeSet := map[string]bool{}
	for rows.Next() {
		var n models.Node
		var metaBytes []byte
		if err := rows.Scan(
			&n.ID, &n.DomainID, &n.TypeName, &n.Label, &n.RiskScore,
			&n.Country, &metaBytes, &n.CreatedAt, &n.UpdatedAt,
			&n.Color, &n.EdgeCount, &n.Volume,
		); err != nil {
			log.Printf("node scan error: %v", err)
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		n.Metadata = json.RawMessage(metaBytes)
		nodes = append(nodes, n)
		nodeSet[n.ID] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("nodes rows: %w", err)
	}

	if len(nodes) == 0 {
		return &models.Graph{Nodes: []models.Node{}, Edges: []models.Edge{}, Domain: domain}, nil
	}

	// Edges — only between nodes we returned
	edgeRows, err := d.pool.Query(ctx, `
		SELECT e.id, e.domain_id, e.source_id, e.target_id, e.label,
		       e.weight, e.metadata, e.created_at
		FROM edges e
		WHERE e.domain_id = $1
		LIMIT $2
	`, domainID, limit*3)
	if err != nil {
		return nil, fmt.Errorf("edges query: %w", err)
	}
	defer edgeRows.Close()

	edges := []models.Edge{}
	for edgeRows.Next() {
		var e models.Edge
		var metaBytes []byte
		if err := edgeRows.Scan(
			&e.ID, &e.DomainID, &e.SourceID, &e.TargetID,
			&e.Label, &e.Weight, &metaBytes, &e.CreatedAt,
		); err != nil {
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		e.Metadata = json.RawMessage(metaBytes)
		// Only include edges where both endpoints are in our node set
		if nodeSet[e.SourceID] && nodeSet[e.TargetID] {
			edges = append(edges, e)
		}
	}

	return &models.Graph{Nodes: nodes, Edges: edges, Domain: domain}, nil
}

func (d *DB) GetNodeNeighbors(ctx context.Context, nodeID string, depth int) (*models.Graph, error) {
	// depth=0 → just the node itself; depth<0 → default 2
	if depth < 0 {
		depth = 2
	}

	visitedNodes := map[string]bool{nodeID: true}
	queue := []string{nodeID}

	for lvl := 0; lvl < depth; lvl++ {
		if len(queue) == 0 {
			break
		}
		placeholders := make([]string, len(queue))
		args := make([]interface{}, len(queue))
		for i, id := range queue {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			args[i] = id
		}
		inList := strings.Join(placeholders, ",")
		neighborRows, err := d.pool.Query(ctx, fmt.Sprintf(`
			SELECT DISTINCT
				CASE WHEN source_id = ANY(ARRAY[%s]::uuid[])
				     THEN target_id ELSE source_id END AS neighbor
			FROM edges
			WHERE source_id = ANY(ARRAY[%s]::uuid[])
			   OR target_id = ANY(ARRAY[%s]::uuid[])
		`, inList, inList, inList), args...)
		if err != nil {
			break
		}
		queue = []string{}
		for neighborRows.Next() {
			var nid string
			if neighborRows.Scan(&nid) == nil && !visitedNodes[nid] {
				visitedNodes[nid] = true
				queue = append(queue, nid)
			}
		}
		neighborRows.Close()
	}

	// Build args for the collected node IDs
	ids := make([]string, 0, len(visitedNodes))
	for id := range visitedNodes {
		ids = append(ids, id)
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	inList := strings.Join(placeholders, ",")

	nodeRows, err := d.pool.Query(ctx, fmt.Sprintf(`
		SELECT n.id, n.domain_id, n.type_name, n.label, n.risk_score,
		       COALESCE(n.country,''), n.metadata, n.created_at, n.updated_at,
		       COALESCE(nt.color,'#4488ff'), 0, 0.0
		FROM nodes n
		LEFT JOIN node_types nt ON nt.domain_id = n.domain_id AND nt.name = n.type_name
		WHERE n.id = ANY(ARRAY[%s]::uuid[])
	`, inList), args...)
	if err != nil {
		return nil, err
	}
	defer nodeRows.Close()

	nodes := []models.Node{}
	for nodeRows.Next() {
		var n models.Node
		var metaBytes []byte
		if err := nodeRows.Scan(
			&n.ID, &n.DomainID, &n.TypeName, &n.Label, &n.RiskScore,
			&n.Country, &metaBytes, &n.CreatedAt, &n.UpdatedAt,
			&n.Color, &n.EdgeCount, &n.Volume,
		); err != nil {
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		n.Metadata = json.RawMessage(metaBytes)
		nodes = append(nodes, n)
	}

	edgeRows, err := d.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, domain_id, source_id, target_id, label, weight, metadata, created_at
		FROM edges
		WHERE source_id = ANY(ARRAY[%s]::uuid[])
		  AND target_id = ANY(ARRAY[%s]::uuid[])
	`, inList, inList), args...)
	if err != nil {
		return nil, err
	}
	defer edgeRows.Close()

	edges := []models.Edge{}
	for edgeRows.Next() {
		var e models.Edge
		var metaBytes []byte
		if err := edgeRows.Scan(
			&e.ID, &e.DomainID, &e.SourceID, &e.TargetID,
			&e.Label, &e.Weight, &metaBytes, &e.CreatedAt,
		); err != nil {
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		e.Metadata = json.RawMessage(metaBytes)
		edges = append(edges, e)
	}

	return &models.Graph{Nodes: nodes, Edges: edges}, nil
}

// ─── Search ───────────────────────────────────────────────────────────────────

func (d *DB) Search(ctx context.Context, query string, limit int) ([]models.SearchResult, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := d.pool.Query(ctx, `
		SELECT id, label, type_name, COALESCE(country,''), risk_score
		FROM nodes
		WHERE label ILIKE '%' || $1 || '%'
		   OR type_name ILIKE '%' || $1 || '%'
		   OR country ILIKE '%' || $1 || '%'
		   OR metadata::text ILIKE '%' || $1 || '%'
		ORDER BY
			CASE WHEN label ILIKE $1 || '%' THEN 0 ELSE 1 END,
			risk_score DESC
		LIMIT $2
	`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := []models.SearchResult{}
	for rows.Next() {
		var r models.SearchResult
		if err := rows.Scan(&r.ID, &r.Label, &r.TypeName, &r.Country, &r.Score); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results, nil
}

// ─── Schema ───────────────────────────────────────────────────────────────────

var allowedTables = map[string]bool{
	"nodes": true, "edges": true, "events": true,
	"alerts": true, "domains": true, "node_types": true,
}

func (d *DB) GetSchema(ctx context.Context, tableName string, page, pageSize int) (*models.SchemaTable, error) {
	if !allowedTables[tableName] {
		tableName = "nodes"
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	colRows, err := d.pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable = 'YES'
		FROM information_schema.columns
		WHERE table_name = $1 AND table_schema = 'public'
		ORDER BY ordinal_position
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer colRows.Close()

	cols := []models.SchemaColumn{}
	for colRows.Next() {
		var c models.SchemaColumn
		colRows.Scan(&c.Name, &c.DataType, &c.Nullable)
		cols = append(cols, c)
	}

	var total int64
	// Safe because tableName is allowlisted
	d.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s`, tableName)).Scan(&total)

	offset := (page - 1) * pageSize
	dataRows, err := d.pool.Query(ctx,
		fmt.Sprintf(`SELECT * FROM %s ORDER BY 1 LIMIT $1 OFFSET $2`, tableName),
		pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer dataRows.Close()

	samples := []map[string]interface{}{}
	fdesc := dataRows.FieldDescriptions()
	for dataRows.Next() {
		vals, err := dataRows.Values()
		if err != nil {
			continue
		}
		row := map[string]interface{}{}
		for i, fd := range fdesc {
			v := vals[i]
			// Convert non-JSON-serialisable types to strings
			switch vt := v.(type) {
			case [16]byte: // UUID
				row[string(fd.Name)] = fmt.Sprintf("%x-%x-%x-%x-%x",
					vt[0:4], vt[4:6], vt[6:8], vt[8:10], vt[10:16])
			default:
				row[string(fd.Name)] = v
			}
		}
		samples = append(samples, row)
	}

	return &models.SchemaTable{
		Name:       tableName,
		Columns:    cols,
		SampleRows: samples,
		TotalRows:  total,
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// ─── Node Types ───────────────────────────────────────────────────────────────

func (d *DB) GetNodeTypes(ctx context.Context, domain string) ([]models.NodeType, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT nt.name, nt.color, COALESCE(nt.icon,''), COALESCE(nt.description,'')
		FROM node_types nt
		JOIN domains dom ON dom.id = nt.domain_id
		WHERE dom.name = $1
	`, domain)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	types := []models.NodeType{}
	for rows.Next() {
		var t models.NodeType
		rows.Scan(&t.Name, &t.Color, &t.Icon, &t.Description)
		types = append(types, t)
	}
	return types, nil
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

func (d *DB) GetAlerts(ctx context.Context, limit int) ([]models.Alert, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT a.id, a.domain_id, a.node_id, COALESCE(n.label,''),
		       a.severity, a.rule_name, COALESCE(a.description,''), a.created_at
		FROM alerts a
		LEFT JOIN nodes n ON n.id = a.node_id
		WHERE a.resolved = FALSE
		ORDER BY a.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	alerts := []models.Alert{}
	for rows.Next() {
		var a models.Alert
		rows.Scan(&a.ID, &a.DomainID, &a.NodeID, &a.NodeLabel,
			&a.Severity, &a.RuleName, &a.Description, &a.CreatedAt)
		alerts = append(alerts, a)
	}
	return alerts, nil
}

// ─── Insert helpers ───────────────────────────────────────────────────────────

// InsertNode inserts a node and populates n.ID with the generated UUID.
func (d *DB) InsertNode(ctx context.Context, n *models.Node) error {
	if n.Metadata == nil {
		n.Metadata = json.RawMessage("{}")
	}
	// RETURNING id so the caller gets the generated UUID
	err := d.pool.QueryRow(ctx, `
		INSERT INTO nodes (domain_id, type_name, label, risk_score, country, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at
	`, n.DomainID, n.TypeName, n.Label, n.RiskScore, n.Country, n.Metadata).
		Scan(&n.ID, &n.CreatedAt, &n.UpdatedAt)
	return err
}

func (d *DB) InsertEdge(ctx context.Context, e *models.Edge) error {
	if e.Metadata == nil {
		e.Metadata = json.RawMessage("{}")
	}
	err := d.pool.QueryRow(ctx, `
		INSERT INTO edges (domain_id, source_id, target_id, label, weight, metadata)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6)
		ON CONFLICT (source_id, target_id, label)
		DO UPDATE SET weight = EXCLUDED.weight, metadata = EXCLUDED.metadata
		RETURNING id, created_at
	`, e.DomainID, e.SourceID, e.TargetID, e.Label, e.Weight, e.Metadata).
		Scan(&e.ID, &e.CreatedAt)
	return err
}

func (d *DB) InsertAlert(ctx context.Context, a *models.Alert) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO alerts (domain_id, node_id, severity, rule_name, description)
		VALUES ($1, $2::uuid, $3, $4, $5)
	`, a.DomainID, a.NodeID, a.Severity, a.RuleName, a.Description)
	return err
}

func (d *DB) GetDomainID(ctx context.Context, domain string) (string, error) {
	var id string
	err := d.pool.QueryRow(ctx, `SELECT id FROM domains WHERE name = $1`, domain).Scan(&id)
	if err != nil {
		// Insert new domain on demand
		err = d.pool.QueryRow(ctx, `
			INSERT INTO domains (name, description)
			VALUES ($1, $2)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		`, domain, domain+" domain").Scan(&id)
	}
	return id, err
}

func (d *DB) GetRandomNodes(ctx context.Context, domainID string, n int) ([]models.Node, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, domain_id, type_name, label, risk_score, COALESCE(country,''), metadata
		FROM nodes
		WHERE domain_id = $1
		ORDER BY RANDOM()
		LIMIT $2
	`, domainID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := []models.Node{}
	for rows.Next() {
		var node models.Node
		var metaBytes []byte
		if err := rows.Scan(&node.ID, &node.DomainID, &node.TypeName, &node.Label,
			&node.RiskScore, &node.Country, &metaBytes); err != nil {
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		node.Metadata = json.RawMessage(metaBytes)
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func (d *DB) NodeCount(ctx context.Context, domainID string) int {
	var count int
	d.pool.QueryRow(ctx, `SELECT COUNT(*) FROM nodes WHERE domain_id = $1`, domainID).Scan(&count)
	return count
}
