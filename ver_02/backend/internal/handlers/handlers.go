package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dagviz-netflow/backend/internal/db"
	"github.com/dagviz-netflow/backend/internal/models"
	ws "github.com/dagviz-netflow/backend/internal/websocket"
	"github.com/gorilla/mux"
)

type Handler struct {
	db  *db.DB
	hub *ws.Hub
}

func New(database *db.DB, hub *ws.Hub) *Handler {
	return &Handler{db: database, hub: hub}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /api/health
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	count := h.db.GetEventCount(r.Context())
	writeJSON(w, 200, map[string]interface{}{
		"status":     "ok",
		"events":     count,
		"ws_clients": h.hub.ClientCount(),
		"timestamp":  time.Now().Unix(),
	})
}

// GET /api/timerange
func (h *Handler) GetTimeRange(w http.ResponseWriter, r *http.Request) {
	tr, err := h.db.GetTimeRange(r.Context())
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, tr)
}

// GET /api/snapshot?t=<unix_ms>&severities=high,critical&min_latency=50
func (h *Handler) GetSnapshot(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	// Parse time
	var upTo time.Time
	if tStr := q.Get("t"); tStr != "" {
		ms, err := strconv.ParseInt(tStr, 10, 64)
		if err == nil {
			upTo = time.UnixMilli(ms)
		}
	}
	if upTo.IsZero() {
		upTo = time.Now()
	}

	f := parseFilter(q)
	snap, err := h.db.GetSnapshot(r.Context(), upTo, f)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, snap)
}

// GET /api/events?from=<unix_ms>&to=<unix_ms>&...filters
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	tr, _ := h.db.GetTimeRange(r.Context())
	from := tr.Min
	to := tr.Max

	if s := q.Get("from"); s != "" {
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
			from = time.UnixMilli(ms)
		}
	}
	if s := q.Get("to"); s != "" {
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
			to = time.UnixMilli(ms)
		}
	}

	f := parseFilter(q)
	events, err := h.db.GetEventsInWindow(r.Context(), from, to, f)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, events)
}

// GET /api/systems
func (h *Handler) GetSystems(w http.ResponseWriter, r *http.Request) {
	f := parseFilter(r.URL.Query())
	systems, err := h.db.GetSystemStats(r.Context(), f)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, systems)
}

// GET /api/systems/:id
func (h *Handler) GetSystem(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	snap, err := h.db.GetSnapshot(r.Context(), time.Now().Add(100*365*24*time.Hour), &models.FilterParams{
		SystemIDs: []string{id},
	})
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, snap)
}

// GET /api/search?q=...
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
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

// GET /api/filters/values  — distinct values for dropdowns
func (h *Handler) GetFilterValues(w http.ResponseWriter, r *http.Request) {
	vals, err := h.db.GetDistinctValues(r.Context())
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, vals)
}

// POST /api/import/csv
func (h *Handler) ImportCSV(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, 400, "form parse error")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "no file uploaded")
		return
	}
	defer file.Close()

	_ = hdr
	result, err := h.db.ImportCSV(r.Context(), file)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("import failed: %v", err))
		return
	}

	// Broadcast to all WS clients that new data is available
	h.hub.Broadcast("data_loaded", map[string]interface{}{
		"systems": result.Systems,
		"events":  result.Events,
		"min":     result.MinTime.UnixMilli(),
		"max":     result.MaxTime.UnixMilli(),
	})

	writeJSON(w, 200, result)
}

// DELETE /api/data  — clear all data
func (h *Handler) ClearData(w http.ResponseWriter, r *http.Request) {
	if err := h.db.ClearData(r.Context()); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	h.hub.Broadcast("data_cleared", nil)
	writeJSON(w, 200, map[string]string{"status": "cleared"})
}

// GET /api/export/csv
func (h *Handler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	f := parseFilter(r.URL.Query())
	filename := fmt.Sprintf("netflow_%s.csv", time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	if err := h.db.ExportCSV(r.Context(), w, f); err != nil {
		// Headers already sent, can't writeError
		return
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func parseFilter(q interface{ Get(string) string }) *models.FilterParams {
	f := &models.FilterParams{}

	if v := q.Get("min_latency"); v != "" {
		f.MinLatency, _ = strconv.ParseFloat(v, 64)
	}
	if v := q.Get("max_latency"); v != "" {
		f.MaxLatency, _ = strconv.ParseFloat(v, 64)
	}
	if v := q.Get("min_bytes"); v != "" {
		f.MinBytes, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := q.Get("min_packet_loss"); v != "" {
		f.MinPacketLoss, _ = strconv.ParseFloat(v, 64)
	}
	if v := q.Get("severities"); v != "" {
		f.Severities = splitTrim(v)
	}
	if v := q.Get("protocols"); v != "" {
		f.Protocols = splitTrim(v)
	}
	if v := q.Get("system_types"); v != "" {
		f.SystemTypes = splitTrim(v)
	}
	if v := q.Get("system_ids"); v != "" {
		f.SystemIDs = splitTrim(v)
	}
	if v := q.Get("event_types"); v != "" {
		f.EventTypes = splitTrim(v)
	}
	return f
}

func splitTrim(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
