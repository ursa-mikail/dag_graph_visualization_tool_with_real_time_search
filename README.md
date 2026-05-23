# DAGViz — Universal Graph Intelligence Platform

> Visualize, trace, and analyze any directed acyclic graph — from criminal money laundering flows to network communications, supply chains, and beyond.

![DAGViz](https://img.shields.io/badge/DAGViz-v1.0.0-00ff88?style=for-the-badge)
![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=for-the-badge&logo=go)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql)

---

## Features

- 🔍 **Real-time autocomplete search** — instant node/edge suggestions from PostgreSQL full-text search
- 🕸️ **Interactive DAG canvas** — force-directed graph with zoom, pan, drag, and hover intelligence
- 📡 **WebSocket live updates** — graph mutates in real-time as the backend simulates data
- 🗄️ **Schema explorer** — paginated DB table view with column metadata
- 📤 **CSV import/export** — upload your own node/edge data or download current graph
- 🌐 **Domain-agnostic** — money laundering, network comms, supply chain, dependency graphs — anything
- 🎨 **Adaptive theming** — nodes colored and sized by type, risk score, and flow volume

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Browser (TypeScript)                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  DAG Canvas │  │  Search Bar  │  │ Schema / CSV│ │
│  │  (D3.js)    │  │ (WebSocket)  │  │   Panel     │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
└─────────┼────────────────┼─────────────────┼─────────┘
          │ REST            │ WS               │ REST
┌─────────▼────────────────▼─────────────────▼─────────┐
│                   Go HTTP Server                       │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ /api/    │  │  WS Hub      │  │ Simulator      │  │
│  │ graph    │  │  (gorilla)   │  │ (goroutine)    │  │
│  └──────────┘  └──────────────┘  └────────────────┘  │
└────────────────────────────┬──────────────────────────┘
                             │ pgx
┌────────────────────────────▼──────────────────────────┐
│                  PostgreSQL 16                          │
│  nodes · edges · transactions · entities · domains    │
└───────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- Docker & Docker Compose v2
- Ports: `3000` (frontend), `8080` (backend), `5432` (postgres)

### Start

```bash
./scripts/up.sh
```

Then open: **http://localhost:3000**

### Stop

```bash
./scripts/down.sh
```

### Full Clean (removes volumes + images)

```bash
./scripts/clean.sh
```

---

## Data Domains

The simulator ships with **Money Laundering** mode by default, generating:

| Entity Type | Description |
|-------------|-------------|
| Shell Company | Opaque legal entities used to obscure ownership |
| Bank Account | Financial accounts across jurisdictions |
| Crypto Wallet | Blockchain addresses |
| Individual | Named persons of interest |
| Real Estate | Property assets used for layering |

Switch domains by changing `DOMAIN` env var:

```bash
DOMAIN=network ./scripts/up.sh   # network comms
DOMAIN=supply   ./scripts/up.sh  # supply chain
DOMAIN=deps     ./scripts/up.sh  # software dependencies
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/graph` | Full graph (nodes + edges) |
| GET | `/api/search?q=` | Autocomplete search |
| GET | `/api/nodes/:id/neighbors` | Ego network for a node |
| GET | `/api/schema` | DB schema with pagination |
| GET | `/api/export/csv` | Download current graph as CSV |
| POST | `/api/import/csv` | Upload CSV nodes/edges |
| WS | `/ws` | Real-time graph event stream |

---

## CSV Format

### Nodes CSV
```csv
id,label,type,risk_score,metadata
node-1,Acme Corp,shell_company,0.87,"{""country"":""BVI""}"
```

### Edges CSV
```csv
source,target,label,weight,metadata
node-1,node-2,wire_transfer,150000,"{""date"":""2024-01-15""}"
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |
| `PORT` | `8080` | Backend HTTP port |
| `DOMAIN` | `laundering` | Simulation domain |
| `SIM_INTERVAL_MS` | `2000` | Milliseconds between simulation ticks |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, D3.js, Vite |
| Backend | Go 1.22, gorilla/websocket, pgx/v5 |
| Database | PostgreSQL 16 |
| Container | Docker Compose v2 |
| Fonts | IBM Plex Mono, Syne |

---

## License

MIT
