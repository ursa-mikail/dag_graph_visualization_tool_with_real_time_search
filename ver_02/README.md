# NetFlow DAG — Temporal Network Visualiser

> Upload a network-comms CSV → watch events replay across a live force-directed graph with VCR-style playback controls.

---

## Quick Start

```bash
./scripts/up.sh
# → http://localhost:3001
```

Drag **`sample_network_events.csv`** onto the upload button, then press ▶.

---

## Playback Controls

| Control | Function |
|---------|----------|
| ▶ / ⏸   | Play / Pause |
| ⏮ ⏭    | Jump to start / end |
| ⏪ ⏩    | Step ±10 seconds |
| − / +   | Decrease / increase speed (½× → 120×) |
| Scrubber | Drag to any point in time |
| WINDOW   | Sliding event window (1s → 1hr shown at once) |

---

## Filter Panel (left sidebar)

- **Severity** — show only low / medium / high / critical events  
- **Protocol** — TCP, UDP, HTTPS, AMQP, etc.  
- **System Type** — web_server, database, threat, etc.  
- **Min latency** — hide fast connections, surface slow ones  
- **Max latency** — ceiling  
- **Min bytes** — focus on high-volume flows  
- **Min packet loss %** — surface degraded links  
- **Focus Systems** — enter comma-separated IDs to isolate  

---

## CSV Format

```csv
timestamp,source_id,source_label,source_type,source_ip,target_id,target_label,target_type,target_ip,protocol,bytes_sent,bytes_recv,latency_ms,packet_loss_pct,port,severity,event_type,flag,metadata
2024-01-15T08:00:00Z,srv-web-01,web-server-01,web_server,10.0.1.10,srv-db-01,postgres-primary,database,10.0.2.10,TCP,1024,4096,2.1,0.0,5432,low,query,SYN,{}
```

| Column | Description |
|--------|-------------|
| `timestamp` | RFC3339 or `YYYY-MM-DD HH:MM:SS` |
| `source_id` / `target_id` | Stable system identifier |
| `*_label` | Display name |
| `*_type` | `web_server`, `database`, `cache`, `load_balancer`, `worker`, `queue`, `monitoring`, `security`, `siem`, `external`, `endpoint`, `threat`, `storage`, `firewall` |
| `severity` | `low`, `medium`, `high`, `critical` |
| `metadata` | JSON blob (optional) |

---

## Architecture

```
Browser (TypeScript + D3)
  ├── GraphCanvas      — force-directed graph, animated packet particles
  ├── PlaybackController — VCR timeline with speed control
  ├── FilterPanel      — threshold & category filters
  ├── EventLog         — live event feed
  └── SystemDetail     — per-node stats panel

Go Backend
  ├── /api/import/csv  — ingest CSV
  ├── /api/snapshot    — graph at time T with filters
  ├── /api/events      — events in [from, to] window
  ├── /api/systems     — aggregated stats per system
  └── /ws              — WebSocket for reload signals

PostgreSQL 16
  └── events table with time + latency + bytes + severity indexes
```

---

## Ports

| Service  | Port |
|----------|------|
| Frontend | 3001 |
| Backend  | 8081 |
| Postgres | 5433 |

---

## Scripts

```bash
./scripts/up.sh     # build + start
./scripts/down.sh   # stop
./scripts/clean.sh  # nuke everything including volumes
```
