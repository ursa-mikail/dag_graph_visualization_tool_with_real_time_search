package handlers

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dagviz/backend/internal/db"
	"github.com/dagviz/backend/internal/models"
	ws "github.com/dagviz/backend/internal/websocket"
	"github.com/gorilla/mux"
)

type Handler struct {
	db     *db.DB
	hub    *ws.Hub
	domain string
}

func New(database *db.DB, hub *ws.Hub, domain string) *Handler {
	return &Handler{db: database, hub: hub, domain: domain}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /api/graph
func (h *Handler) GetGraph(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 300
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil {
			limit = v
		}
	}
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		domain = h.domain
	}
	graph, err := h.db.GetGraph(r.Context(), domain, limit)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, graph)
}

// GET /api/nodes/:id/neighbors
func (h *Handler) GetNeighbors(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	nodeID := vars["id"]
	depthStr := r.URL.Query().Get("depth")
	depth := 2
	if depthStr != "" {
		if v, err := strconv.Atoi(depthStr); err == nil {
			depth = v
		}
	}
	graph, err := h.db.GetNodeNeighbors(r.Context(), nodeID, depth)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, graph)
}

// GET /api/search?q=...&limit=10
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, 200, []models.SearchResult{})
		return
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 10
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil {
			limit = v
		}
	}
	results, err := h.db.Search(r.Context(), q, limit)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, results)
}

// GET /api/schema?table=nodes&page=1&page_size=20
func (h *Handler) GetSchema(w http.ResponseWriter, r *http.Request) {
	table := r.URL.Query().Get("table")
	if table == "" {
		table = "nodes"
	}
	page := 1
	pageSize := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("page_size")); err == nil && v > 0 && v <= 100 {
		pageSize = v
	}

	schema, err := h.db.GetSchema(r.Context(), table, page, pageSize)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, schema)
}

// GET /api/tables
func (h *Handler) GetTables(w http.ResponseWriter, r *http.Request) {
	tables := []string{"nodes", "edges", "events", "alerts", "domains", "node_types"}
	writeJSON(w, 200, tables)
}

// GET /api/node-types
func (h *Handler) GetNodeTypes(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		domain = h.domain
	}
	types, err := h.db.GetNodeTypes(r.Context(), domain)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, types)
}

// GET /api/alerts
func (h *Handler) GetAlerts(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = v
	}
	alerts, err := h.db.GetAlerts(r.Context(), limit)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, alerts)
}

// GET /api/export/csv?type=nodes|edges
func (h *Handler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	exportType := r.URL.Query().Get("type")
	if exportType == "" {
		exportType = "nodes"
	}

	domain := r.URL.Query().Get("domain")
	if domain == "" {
		domain = h.domain
	}

	graph, err := h.db.GetGraph(r.Context(), domain, 10000)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	filename := fmt.Sprintf("dagviz_%s_%s.csv", exportType, time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	cw := csv.NewWriter(w)
	defer cw.Flush()

	if exportType == "edges" {
		cw.Write([]string{"source", "target", "label", "weight", "created_at", "metadata"})
		for _, e := range graph.Edges {
			cw.Write([]string{
				e.SourceID, e.TargetID, e.Label,
				fmt.Sprintf("%.2f", e.Weight),
				e.CreatedAt.Format(time.RFC3339),
				string(e.Metadata),
			})
		}
	} else {
		cw.Write([]string{"id", "label", "type_name", "risk_score", "country", "created_at", "metadata"})
		for _, n := range graph.Nodes {
			cw.Write([]string{
				n.ID, n.Label, n.TypeName,
				fmt.Sprintf("%.4f", n.RiskScore),
				n.Country,
				n.CreatedAt.Format(time.RFC3339),
				string(n.Metadata),
			})
		}
	}
}

// POST /api/import/csv
func (h *Handler) ImportCSV(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, 400, "failed to parse form")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "no file uploaded")
		return
	}
	defer file.Close()

	importType := r.FormValue("type")
	if importType == "" {
		importType = "nodes"
	}

	domain := r.FormValue("domain")
	if domain == "" {
		domain = h.domain
	}

	domainID, err := h.db.GetDomainID(r.Context(), domain)
	if err != nil {
		writeError(w, 500, "domain lookup failed")
		return
	}

	cr := csv.NewReader(file)
	headers, err := cr.Read()
	if err != nil {
		writeError(w, 400, "invalid CSV")
		return
	}

	headerIdx := map[string]int{}
	for i, h := range headers {
		headerIdx[strings.ToLower(strings.TrimSpace(h))] = i
	}

	imported := 0
	errors := []string{}

	get := func(row []string, key string) string {
		if i, ok := headerIdx[key]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}

	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		if importType == "edges" {
			source := get(row, "source")
			target := get(row, "target")
			if source == "" || target == "" {
				errors = append(errors, fmt.Sprintf("row %d: missing source/target", imported+1))
				continue
			}
			weight := 1.0
			if v, err := strconv.ParseFloat(get(row, "weight"), 64); err == nil {
				weight = v
			}
			label := get(row, "label")
			if label == "" {
				label = "connects"
			}
			meta := get(row, "metadata")
			if meta == "" {
				meta = "{}"
			}
			edge := &models.Edge{
				DomainID: domainID,
				SourceID: source,
				TargetID: target,
				Label:    label,
				Weight:   weight,
				Metadata: json.RawMessage(meta),
			}
			if err := h.db.InsertEdge(r.Context(), edge); err == nil {
				imported++
				h.hub.Broadcast("edge_added", edge)
			}
		} else {
			label := get(row, "label")
			if label == "" {
				errors = append(errors, fmt.Sprintf("row %d: missing label", imported+1))
				continue
			}
			riskScore := 0.0
			if v, err := strconv.ParseFloat(get(row, "risk_score"), 64); err == nil {
				riskScore = v
			}
			typeName := get(row, "type_name")
			if typeName == "" {
				typeName = "entity"
			}
			meta := get(row, "metadata")
			if meta == "" {
				meta = "{}"
			}
			node := &models.Node{
				DomainID:  domainID,
				TypeName:  typeName,
				Label:     label,
				RiskScore: riskScore,
				Country:   get(row, "country"),
				Metadata:  json.RawMessage(meta),
			}
			if err := h.db.InsertNode(r.Context(), node); err == nil {
				imported++
				h.hub.Broadcast("node_added", node)
			}
		}
	}

	writeJSON(w, 200, map[string]interface{}{
		"imported": imported,
		"errors":   errors,
		"type":     importType,
	})
}

// GET /api/health
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().Unix(),
		"domain":    h.domain,
		"ws_clients": h.hub.ClientCount(),
	})
}
