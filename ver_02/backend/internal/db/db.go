package db

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/dagviz-netflow/backend/internal/models"
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
		log.Printf("DB not ready (%v), retrying in 2s (%d/15)", err, i+1)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("db connect: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (d *DB) Close() { d.pool.Close() }

// ─── Time range ───────────────────────────────────────────────────────────────

func (d *DB) GetTimeRange(ctx context.Context) (*models.TimeRange, error) {
	var tr models.TimeRange
	err := d.pool.QueryRow(ctx,
		`SELECT MIN(event_time), MAX(event_time), COUNT(*) FROM events`,
	).Scan(&tr.Min, &tr.Max, &tr.Count)
	if err != nil || tr.Count == 0 {
		return &models.TimeRange{}, err
	}
	return &tr, nil
}

// ─── Events in sliding window ─────────────────────────────────────────────────

func (d *DB) GetEventsInWindow(ctx context.Context, from, to time.Time, f *models.FilterParams) ([]models.Event, error) {
	// Clamp zero/negative from to a safe minimum
	if from.IsZero() || from.Year() < 2000 {
		from = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	args := []interface{}{from, to}
	clauses := []string{"e.event_time >= $1", "e.event_time <= $2"}
	n := 3

	if f != nil {
		n = applyFilter(f, &clauses, &args, n)
	}

	rows, err := d.pool.Query(ctx, fmt.Sprintf(`
		SELECT e.id, e.event_time, e.source_id, e.target_id,
		       e.protocol, e.bytes_sent, e.bytes_recv, e.latency_ms,
		       e.packet_loss, e.port, e.severity, e.event_type, e.flag, e.metadata,
		       src.label, tgt.label
		FROM events e
		JOIN systems src ON src.id = e.source_id
		JOIN systems tgt ON tgt.id = e.target_id
		WHERE %s
		ORDER BY e.event_time ASC
		LIMIT 2000
	`, strings.Join(clauses, " AND ")), args...)
	if err != nil {
		return nil, fmt.Errorf("GetEventsInWindow: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

// ─── Snapshot: all systems+edges active up to a point in time ─────────────────

func (d *DB) GetSnapshot(ctx context.Context, upTo time.Time, f *models.FilterParams) (*models.GraphSnapshot, error) {
	// Systems: aggregate per-node stats using a subquery (avoids DISTINCT+window conflict)
	sysArgs := []interface{}{upTo}
	sysRows, err := d.pool.Query(ctx, `
		SELECT s.id, s.label, s.type, s.ip, s.metadata,
		       COALESCE(stats.total_events, 0),
		       COALESCE(stats.total_bytes,  0),
		       COALESCE(stats.avg_latency,  0),
		       COALESCE(stats.max_latency,  0),
		       COALESCE(stats.avg_loss,     0)
		FROM systems s
		JOIN (
			SELECT source_id AS sid FROM events WHERE event_time <= $1
			UNION
			SELECT target_id AS sid FROM events WHERE event_time <= $1
		) active ON active.sid = s.id
		LEFT JOIN (
			SELECT
				unnest(ARRAY[source_id, target_id])            AS sid,
				COUNT(*)                                       AS total_events,
				COALESCE(SUM(bytes_sent + bytes_recv), 0)      AS total_bytes,
				COALESCE(AVG(latency_ms), 0)                   AS avg_latency,
				COALESCE(MAX(latency_ms), 0)                   AS max_latency,
				COALESCE(AVG(packet_loss), 0)                  AS avg_loss
			FROM events
			WHERE event_time <= $1
			GROUP BY sid
		) stats ON stats.sid = s.id
		ORDER BY s.id
	`, sysArgs...)
	if err != nil {
		return nil, fmt.Errorf("GetSnapshot systems: %w", err)
	}
	defer sysRows.Close()

	seenSys := map[string]bool{}
	systems := []models.System{}
	for sysRows.Next() {
		var sys models.System
		var metaBytes []byte
		if err := sysRows.Scan(
			&sys.ID, &sys.Label, &sys.Type, &sys.IP, &metaBytes,
			&sys.TotalEvents, &sys.TotalBytes, &sys.AvgLatency,
			&sys.MaxLatency, &sys.AvgPacketLoss,
		); err != nil {
			log.Printf("snapshot sys scan: %v", err)
			continue
		}
		if seenSys[sys.ID] {
			continue
		}
		seenSys[sys.ID] = true
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		sys.Metadata = json.RawMessage(metaBytes)
		systems = append(systems, sys)
	}
	if err := sysRows.Err(); err != nil {
		return nil, fmt.Errorf("GetSnapshot sys rows: %w", err)
	}

	// Events up to upTo, with optional filters
	evArgs := []interface{}{upTo}
	evClauses := []string{"e.event_time <= $1"}
	evN := 2
	if f != nil {
		evN = applyFilter(f, &evClauses, &evArgs, evN)
	}

	evRows, err := d.pool.Query(ctx, fmt.Sprintf(`
		SELECT e.id, e.event_time, e.source_id, e.target_id,
		       e.protocol, e.bytes_sent, e.bytes_recv, e.latency_ms,
		       e.packet_loss, e.port, e.severity, e.event_type, e.flag, e.metadata,
		       src.label, tgt.label
		FROM events e
		JOIN systems src ON src.id = e.source_id
		JOIN systems tgt ON tgt.id = e.target_id
		WHERE %s
		ORDER BY e.event_time ASC
		LIMIT 5000
	`, strings.Join(evClauses, " AND ")), evArgs...)
	if err != nil {
		return nil, fmt.Errorf("GetSnapshot events: %w", err)
	}
	defer evRows.Close()

	events, err := scanEvents(evRows)
	if err != nil {
		return nil, err
	}

	var minT, maxT time.Time
	for _, e := range events {
		if minT.IsZero() || e.EventTime.Before(minT) {
			minT = e.EventTime
		}
		if e.EventTime.After(maxT) {
			maxT = e.EventTime
		}
	}

	return &models.GraphSnapshot{
		Systems: systems,
		Events:  events,
		MinTime: minT,
		MaxTime: maxT,
	}, nil
}

// ─── System stats ─────────────────────────────────────────────────────────────

func (d *DB) GetSystemStats(ctx context.Context, f *models.FilterParams) ([]models.System, error) {
	args := []interface{}{}
	clauses := []string{"1=1"}
	n := 1
	if f != nil {
		n = applyFilter(f, &clauses, &args, n)
	}
	_ = n

	rows, err := d.pool.Query(ctx, fmt.Sprintf(`
		SELECT s.id, s.label, s.type, COALESCE(s.ip,''), s.metadata,
		       COUNT(e.id),
		       COUNT(CASE WHEN e.source_id = s.id THEN 1 END),
		       COUNT(CASE WHEN e.target_id = s.id THEN 1 END),
		       COALESCE(SUM(e.bytes_sent + e.bytes_recv), 0),
		       COALESCE(AVG(e.latency_ms), 0),
		       COALESCE(MAX(e.latency_ms), 0),
		       COALESCE(AVG(e.packet_loss), 0),
		       COUNT(CASE WHEN e.severity='critical' THEN 1 END),
		       COUNT(CASE WHEN e.severity='high'     THEN 1 END),
		       MIN(e.event_time),
		       MAX(e.event_time)
		FROM systems s
		LEFT JOIN events e ON (e.source_id = s.id OR e.target_id = s.id) AND %s
		GROUP BY s.id, s.label, s.type, s.ip, s.metadata
		ORDER BY COUNT(e.id) DESC
	`, strings.Join(clauses, " AND ")), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	systems := []models.System{}
	for rows.Next() {
		var sys models.System
		var metaBytes []byte
		rows.Scan(
			&sys.ID, &sys.Label, &sys.Type, &sys.IP, &metaBytes,
			&sys.TotalEvents, &sys.Outbound, &sys.Inbound,
			&sys.TotalBytes, &sys.AvgLatency, &sys.MaxLatency,
			&sys.AvgPacketLoss, &sys.CriticalCount, &sys.HighCount,
			&sys.FirstSeen, &sys.LastSeen,
		)
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		sys.Metadata = json.RawMessage(metaBytes)
		systems = append(systems, sys)
	}
	return systems, nil
}

// ─── Search ───────────────────────────────────────────────────────────────────

func (d *DB) Search(ctx context.Context, q string, limit int) ([]models.SearchResult, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, label, type, COALESCE(ip,'')
		FROM systems
		WHERE label ILIKE '%' || $1 || '%'
		   OR type  ILIKE '%' || $1 || '%'
		   OR ip    ILIKE '%' || $1 || '%'
		   OR id    ILIKE '%' || $1 || '%'
		ORDER BY CASE WHEN label ILIKE $1 || '%' THEN 0 ELSE 1 END, label
		LIMIT $2
	`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []models.SearchResult{}
	for rows.Next() {
		var r models.SearchResult
		rows.Scan(&r.ID, &r.Label, &r.Type, &r.IP)
		results = append(results, r)
	}
	return results, nil
}

// ─── Filter dropdown values ───────────────────────────────────────────────────

func (d *DB) GetDistinctValues(ctx context.Context) (map[string][]string, error) {
	result := map[string][]string{
		"protocols": {}, "severities": {}, "event_types": {}, "system_types": {},
	}
	queries := map[string]string{
		"protocols":    "SELECT DISTINCT protocol    FROM events  ORDER BY 1",
		"severities":   "SELECT DISTINCT severity    FROM events  ORDER BY 1",
		"event_types":  "SELECT DISTINCT event_type  FROM events  ORDER BY 1",
		"system_types": "SELECT DISTINCT type        FROM systems ORDER BY 1",
	}
	for key, q := range queries {
		rows, err := d.pool.Query(ctx, q)
		if err != nil {
			continue
		}
		for rows.Next() {
			var v string
			rows.Scan(&v)
			result[key] = append(result[key], v)
		}
		rows.Close()
	}
	return result, nil
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

func (d *DB) ImportCSV(ctx context.Context, r io.Reader) (*models.ImportResult, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // allow variable — we validate per-row below

	headers, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("CSV header: %w", err)
	}

	idx := map[string]int{}
	for i, h := range headers {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}

	get := func(row []string, key string) string {
		if i, ok := idx[key]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}

	result := &models.ImportResult{Errors: []string{}}
	systemsSeen := map[string]bool{}

	type sysRow struct{ id, label, stype, ip string }
	type evRow struct {
		ts                   time.Time
		srcID, tgtID         string
		protocol             string
		bytesSent, bytesRecv int64
		latency, loss        float64
		port                 int
		severity, evType, flag string
		meta                 json.RawMessage
	}

	var sysList []sysRow
	var evList  []evRow
	rowNum := 1

	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		rowNum++
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("row %d parse: %v", rowNum, err))
			continue
		}

		// Timestamp
		tsStr := get(row, "timestamp")
		ts, err := parseTime(tsStr)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("row %d: bad timestamp %q", rowNum, tsStr))
			continue
		}

		srcID := get(row, "source_id")
		tgtID := get(row, "target_id")
		if srcID == "" || tgtID == "" {
			result.Errors = append(result.Errors, fmt.Sprintf("row %d: missing source_id/target_id", rowNum))
			continue
		}

		// Register source system (use source metadata for source, target metadata for target)
		for _, s := range []struct{ id, label, stype, ip string }{
			{srcID, get(row, "source_label"), get(row, "source_type"), get(row, "source_ip")},
			{tgtID, get(row, "target_label"), get(row, "target_type"), get(row, "target_ip")},
		} {
			if !systemsSeen[s.id] {
				systemsSeen[s.id] = true
				label := s.label
				if label == "" {
					label = s.id
				}
				stype := s.stype
				if stype == "" {
					stype = "unknown"
				}
				sysList = append(sysList, sysRow{s.id, label, stype, s.ip})
			}
		}

		// Parse numerics
		bytesSent, _ := strconv.ParseInt(get(row, "bytes_sent"), 10, 64)
		bytesRecv, _ := strconv.ParseInt(get(row, "bytes_recv"), 10, 64)
		latency, _   := strconv.ParseFloat(get(row, "latency_ms"), 64)
		loss, _      := strconv.ParseFloat(get(row, "packet_loss_pct"), 64)
		port, _      := strconv.Atoi(get(row, "port"))

		severity := normSeverity(get(row, "severity"))
		protocol := get(row, "protocol")
		if protocol == "" {
			protocol = "TCP"
		} else {
			protocol = strings.ToUpper(protocol)
		}
		evType := get(row, "event_type")
		if evType == "" {
			evType = "connection"
		}
		flag := get(row, "flag")
		if flag == "" {
			flag = "SYN"
		}

		// Metadata: tolerate non-JSON gracefully
		meta := json.RawMessage("{}")
		if m := get(row, "metadata"); m != "" && json.Valid([]byte(m)) {
			meta = json.RawMessage(m)
		}

		evList = append(evList, evRow{
			ts, srcID, tgtID, protocol,
			bytesSent, bytesRecv, latency, loss, port,
			severity, evType, flag, meta,
		})
	}

	// Upsert systems first (events FK-reference systems)
	for _, s := range sysList {
		_, err := d.pool.Exec(ctx, `
			INSERT INTO systems (id, label, type, ip, metadata)
			VALUES ($1, $2, $3, $4, '{}')
			ON CONFLICT (id) DO UPDATE
			SET label = EXCLUDED.label,
			    type  = EXCLUDED.type,
			    ip    = EXCLUDED.ip
		`, s.id, s.label, s.stype, s.ip)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("system %s: %v", s.id, err))
		} else {
			result.Systems++
		}
	}

	// Insert events
	var minT, maxT time.Time
	for _, e := range evList {
		_, err := d.pool.Exec(ctx, `
			INSERT INTO events
			  (event_time, source_id, target_id, protocol,
			   bytes_sent, bytes_recv, latency_ms, packet_loss,
			   port, severity, event_type, flag, metadata)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		`, e.ts, e.srcID, e.tgtID, e.protocol,
			e.bytesSent, e.bytesRecv, e.latency, e.loss, e.port,
			e.severity, e.evType, e.flag, e.meta)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("event row: %v", err))
		} else {
			result.Events++
			if minT.IsZero() || e.ts.Before(minT) {
				minT = e.ts
			}
			if e.ts.After(maxT) {
				maxT = e.ts
			}
		}
	}

	result.MinTime = minT
	result.MaxTime = maxT

	// Update session stats
	d.pool.Exec(ctx, `
		UPDATE sessions SET
			min_time     = (SELECT MIN(event_time) FROM events),
			max_time     = (SELECT MAX(event_time) FROM events),
			event_count  = (SELECT COUNT(*) FROM events),
			system_count = (SELECT COUNT(*) FROM systems)
		WHERE session_name = 'default'
	`)

	log.Printf("ImportCSV: %d systems, %d events, %d errors", result.Systems, result.Events, len(result.Errors))
	return result, nil
}

// ─── Clear / Export ───────────────────────────────────────────────────────────

func (d *DB) ClearData(ctx context.Context) error {
	_, err := d.pool.Exec(ctx, `TRUNCATE events, systems RESTART IDENTITY CASCADE`)
	if err == nil {
		d.pool.Exec(ctx, `UPDATE sessions SET event_count=0, system_count=0, min_time=NULL, max_time=NULL WHERE session_name='default'`)
	}
	return err
}

func (d *DB) ExportCSV(ctx context.Context, w io.Writer, f *models.FilterParams) error {
	tr, err := d.GetTimeRange(ctx)
	if err != nil {
		return err
	}
	from := tr.Min
	to   := tr.Max
	if from.IsZero() {
		from = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	if to.IsZero() {
		to = time.Now().Add(100 * 365 * 24 * time.Hour)
	}

	events, err := d.GetEventsInWindow(ctx, from, to, f)
	if err != nil {
		return err
	}

	cw := csv.NewWriter(w)
	cw.Write([]string{
		"timestamp", "source_id", "source_label", "target_id", "target_label",
		"protocol", "bytes_sent", "bytes_recv", "latency_ms", "packet_loss_pct",
		"port", "severity", "event_type", "flag", "metadata",
	})
	for _, e := range events {
		cw.Write([]string{
			e.EventTime.Format(time.RFC3339),
			e.SourceID, e.SourceLabel, e.TargetID, e.TargetLabel,
			e.Protocol,
			strconv.FormatInt(e.BytesSent, 10),
			strconv.FormatInt(e.BytesRecv, 10),
			strconv.FormatFloat(e.LatencyMs, 'f', 2, 64),
			strconv.FormatFloat(e.PacketLoss, 'f', 2, 64),
			strconv.Itoa(e.Port),
			e.Severity, e.EventType, e.Flag,
			string(e.Metadata),
		})
	}
	cw.Flush()
	return cw.Error()
}

func (d *DB) GetEventCount(ctx context.Context) int64 {
	var n int64
	d.pool.QueryRow(ctx, `SELECT COUNT(*) FROM events`).Scan(&n)
	return n
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func scanEvents(rows interface {
	Next() bool
	Scan(...interface{}) error
	Err() error
}) ([]models.Event, error) {
	events := []models.Event{}
	for rows.Next() {
		var ev models.Event
		var metaBytes []byte
		if err := rows.Scan(
			&ev.ID, &ev.EventTime, &ev.SourceID, &ev.TargetID,
			&ev.Protocol, &ev.BytesSent, &ev.BytesRecv, &ev.LatencyMs,
			&ev.PacketLoss, &ev.Port, &ev.Severity, &ev.EventType,
			&ev.Flag, &metaBytes, &ev.SourceLabel, &ev.TargetLabel,
		); err != nil {
			log.Printf("scanEvents: %v", err)
			continue
		}
		if len(metaBytes) == 0 {
			metaBytes = []byte("{}")
		}
		ev.Metadata = json.RawMessage(metaBytes)
		events = append(events, ev)
	}
	return events, rows.Err()
}

func applyFilter(f *models.FilterParams, clauses *[]string, args *[]interface{}, n int) int {
	add := func(clause string, val interface{}) {
		*clauses = append(*clauses, clause)
		*args = append(*args, val)
		n++
	}
	addList := func(col string, vals []string) {
		if len(vals) == 0 {
			return
		}
		pls := make([]string, len(vals))
		for i, v := range vals {
			pls[i] = fmt.Sprintf("$%d", n)
			*args = append(*args, v)
			n++
		}
		*clauses = append(*clauses, fmt.Sprintf("%s = ANY(ARRAY[%s])", col, strings.Join(pls, ",")))
	}

	if f.MinLatency > 0 {
		add(fmt.Sprintf("e.latency_ms >= $%d", n), f.MinLatency)
	}
	if f.MaxLatency > 0 {
		add(fmt.Sprintf("e.latency_ms <= $%d", n), f.MaxLatency)
	}
	if f.MinBytes > 0 {
		add(fmt.Sprintf("(e.bytes_sent + e.bytes_recv) >= $%d", n), f.MinBytes)
	}
	if f.MinPacketLoss > 0 {
		add(fmt.Sprintf("e.packet_loss >= $%d", n), f.MinPacketLoss)
	}
	if len(f.Severities) > 0 {
		addList("e.severity", f.Severities)
	}
	if len(f.Protocols) > 0 {
		addList("e.protocol", f.Protocols)
	}
	if len(f.EventTypes) > 0 {
		addList("e.event_type", f.EventTypes)
	}
	if len(f.SystemTypes) > 0 {
		// Filter edges where either endpoint is of a matching type
		// Requires a subquery join — build it inline
		pls := make([]string, len(f.SystemTypes))
		for i, v := range f.SystemTypes {
			pls[i] = fmt.Sprintf("$%d", n)
			*args = append(*args, v)
			n++
		}
		typeList := strings.Join(pls, ",")
		*clauses = append(*clauses, fmt.Sprintf(
			`(EXISTS (SELECT 1 FROM systems __s WHERE __s.id = e.source_id AND __s.type = ANY(ARRAY[%s]))
			  OR EXISTS (SELECT 1 FROM systems __s WHERE __s.id = e.target_id AND __s.type = ANY(ARRAY[%s])))`,
			typeList, typeList))
	}
	if len(f.SystemIDs) > 0 {
		pls := make([]string, len(f.SystemIDs))
		for i, v := range f.SystemIDs {
			pls[i] = fmt.Sprintf("$%d", n)
			*args = append(*args, v)
			n++
		}
		inList := strings.Join(pls, ",")
		*clauses = append(*clauses, fmt.Sprintf(
			"(e.source_id = ANY(ARRAY[%s]) OR e.target_id = ANY(ARRAY[%s]))", inList, inList))
	}
	return n
}

func parseTime(s string) (time.Time, error) {
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised time format: %q", s)
}

func normSeverity(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "low", "medium", "high", "critical":
		return s
	}
	return "low"
}
