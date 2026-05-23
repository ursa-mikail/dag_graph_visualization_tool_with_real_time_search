import { GraphCanvas } from './GraphCanvas';
import { SearchBar } from './SearchBar';
import { NodeDetail } from './NodeDetail';
import { AlertsFeed } from './AlertsFeed';
import { SchemaPanel } from './SchemaPanel';
import { Tooltip } from './Tooltip';
import { WSClient } from '../lib/ws';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { Node, Edge, Alert, WSMessage, SearchResult } from '../types';

type PanelMode = 'graph' | 'schema';

export class App {
  private root: HTMLElement;
  private canvas!: GraphCanvas;
  private search!: SearchBar;
  private nodeDetail!: NodeDetail;
  private alertsFeed!: AlertsFeed;
  private schemaPanel!: SchemaPanel;
  private tooltip!: Tooltip;
  private ws!: WSClient;
  private mode: PanelMode = 'graph';
  private stats = { nodes: 0, edges: 0, alerts: 0, ws: false };
  private statsEl!: HTMLElement;
  private canvasContainer!: HTMLDivElement;
  private schemaContainer!: HTMLDivElement;
  private nodeDetailContainer!: HTMLDivElement;

  constructor(root: HTMLElement) { this.root = root; }

  async init() {
    this.buildLayout();
    this.tooltip = new Tooltip();
    this.ws = new WSClient();
    this.setupWS();
    await this.loadInitialGraph();
    this.loadAlerts();
    setInterval(() => this.loadAlerts(), 15000);
  }

  private buildLayout() {
    this.root.innerHTML = `
      <div id="layout" style="
        display: grid;
        grid-template-rows: 52px 1fr;
        grid-template-columns: 1fr 320px;
        grid-template-areas: 'topbar topbar' 'main sidebar';
        height: 100vh; width: 100vw; overflow: hidden;
        background: #080c10;
      ">
        <!-- Top bar -->
        <div id="topbar" style="
          grid-area: topbar;
          display: flex; align-items: center; gap: 12px;
          padding: 0 16px;
          background: rgba(8,12,16,0.95);
          border-bottom: 1px solid #1e2a38;
          backdrop-filter: blur(8px);
          position: relative; z-index: 100;
        ">
          <!-- Logo -->
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-right:4px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="4" r="3" fill="#00e5ff" opacity="0.9"/>
              <circle cx="4" cy="18" r="3" fill="#00ff88" opacity="0.9"/>
              <circle cx="20" cy="18" r="3" fill="#ff4444" opacity="0.9"/>
              <line x1="12" y1="7" x2="6" y2="15.5" stroke="#1e2a38" stroke-width="1.5"/>
              <line x1="12" y1="7" x2="18" y2="15.5" stroke="#1e2a38" stroke-width="1.5"/>
              <line x1="7" y1="18" x2="17" y2="18" stroke="#1e2a38" stroke-width="1.5"/>
            </svg>
            <span style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;
              letter-spacing:-0.02em;color:#c9d8e8;">DAG<span style="color:#00e5ff;">Viz</span></span>
          </div>

          <!-- Mode toggle -->
          <div style="display:flex;gap:2px;background:#0d1117;border:1px solid #1e2a38;
            border-radius:6px;padding:2px;flex-shrink:0;">
            <button id="mode-graph" class="btn" style="
              padding:4px 12px;font-size:11px;border:none;border-radius:4px;
              background:rgba(0,229,255,0.1);color:#00e5ff;font-weight:600;
            ">Graph</button>
            <button id="mode-schema" class="btn" style="
              padding:4px 12px;font-size:11px;border:none;border-radius:4px;
              background:transparent;color:#4a6a85;
            ">Schema</button>
          </div>

          <!-- Search -->
          <div id="search-mount" style="flex:1;max-width:520px;"></div>

          <!-- Controls -->
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            <button id="btn-labels" class="btn" style="font-size:11px;padding:5px 10px;" title="Toggle labels">⊞ Labels</button>
            <button id="btn-fit" class="btn" style="font-size:11px;padding:5px 10px;" title="Fit to view">⊡ Fit</button>
            <button id="btn-refresh" class="btn" style="font-size:11px;padding:5px 10px;" title="Reload graph">↺ Reload</button>
          </div>

          <!-- Stats -->
          <div id="stats-bar" style="
            display: flex; gap: 14px; align-items: center;
            padding: 0 12px; flex-shrink:0; font-size:11px; color:#4a6a85;
          "></div>

          <!-- WS status -->
          <div id="ws-dot" style="width:8px;height:8px;border-radius:50%;
            background:#ff4444;flex-shrink:0;" title="WebSocket"></div>
        </div>

        <!-- Main area (graph or schema) -->
        <div id="main-area" style="
          grid-area: main; position:relative; overflow:hidden;
          background: radial-gradient(ellipse at 30% 40%, rgba(0,229,255,0.03) 0%, transparent 60%),
                      radial-gradient(ellipse at 70% 80%, rgba(0,255,136,0.02) 0%, transparent 50%),
                      #080c10;
        ">
          <!-- Graph canvas -->
          <div id="canvas-container" style="width:100%;height:100%;"></div>

          <!-- Schema panel (hidden initially) -->
          <div id="schema-container" style="
            display:none;width:100%;height:100%;overflow:hidden;
          "></div>

          <!-- Help overlay (dismissed on first click) -->
          <div id="help-overlay" style="
            position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
            background:rgba(8,12,16,0.85);border:1px solid #1e2a38;border-radius:8px;
            padding:10px 18px;font-size:11px;color:#4a6a85;
            backdrop-filter:blur(8px);pointer-events:none;
            display:flex;gap:16px;align-items:center;
          ">
            <span>🖱 Drag to pan</span>
            <span>⚲ Scroll to zoom</span>
            <span>● Click node to inspect</span>
            <span>⊕ Double-click to expand</span>
          </div>
        </div>

        <!-- Sidebar -->
        <div id="sidebar" style="
          grid-area: sidebar; display:flex; flex-direction:column;
          border-left: 1px solid #1e2a38; overflow:hidden;
          background: #080c10;
        ">
          <!-- Node detail -->
          <div id="node-detail" style="flex:1;overflow:hidden;border-bottom:1px solid #1e2a38;min-height:0;"></div>
          <!-- Alerts feed -->
          <div id="alerts-feed" style="height:220px;overflow:hidden;flex-shrink:0;"></div>
        </div>
      </div>
    `;

    // Wire up subcomponents
    this.canvasContainer = this.root.querySelector<HTMLDivElement>('#canvas-container')!;
    this.schemaContainer = this.root.querySelector<HTMLDivElement>('#schema-container')!;
    this.nodeDetailContainer = this.root.querySelector<HTMLDivElement>('#node-detail')!;
    this.statsEl = this.root.querySelector<HTMLElement>('#stats-bar')!;

    // Graph canvas
    this.canvas = new GraphCanvas(this.canvasContainer);
    this.setupCanvasEvents();

    // Search
    const searchMount = this.root.querySelector<HTMLElement>('#search-mount')!;
    this.search = new SearchBar(searchMount);
    this.search.onSelect = (r: SearchResult) => this.onSearchSelect(r);
    this.search.onClear  = () => this.releaseHighlight();

    // Click on empty canvas background releases highlight
    this.canvasContainer.addEventListener('click', (e) => {
      const target = e.target as SVGElement;
      // Only release when clicking the SVG background, not a node/edge
      if (target.tagName === 'svg' || target.tagName === 'g' && target.classList.length === 0) {
        this.releaseHighlight();
      }
    });

    // Node detail
    this.nodeDetail = new NodeDetail(this.nodeDetailContainer);

    // Alerts feed
    this.alertsFeed = new AlertsFeed(this.root.querySelector<HTMLElement>('#alerts-feed')!);

    // Schema panel
    this.schemaPanel = new SchemaPanel(this.schemaContainer);

    // Mode buttons
    this.root.querySelector('#mode-graph')?.addEventListener('click', () => this.setMode('graph'));
    this.root.querySelector('#mode-schema')?.addEventListener('click', () => this.setMode('schema'));

    // Control buttons
    this.root.querySelector('#btn-labels')?.addEventListener('click', () => {
      this.canvas.toggleLabels();
      toast(`Labels ${this.canvas.showLabels ? 'shown' : 'hidden'}`, 'info', 1500);
    });
    this.root.querySelector('#btn-fit')?.addEventListener('click', () => this.canvas.fitView());
    this.root.querySelector('#btn-refresh')?.addEventListener('click', () => {
      toast('Reloading graph…', 'info', 1000);
      this.loadInitialGraph();
    });

    // Dismiss help
    this.canvasContainer.addEventListener('click', () => {
      const overlay = this.root.querySelector<HTMLElement>('#help-overlay');
      if (overlay) { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.5s'; setTimeout(() => overlay.remove(), 500); }
    }, { once: true });
  }

  private setupCanvasEvents() {
    this.canvas.on('node-click', (data) => {
      const { node } = data as { node: Node };
      if (!node) return;
      this.nodeDetail.show(node);
      // Highlight the clicked node + its direct neighbors (1-hop ego network)
      api.getNeighbors(node.id, 1).then(g => {
        const ids = g.nodes.map(n => n.id);
        if (!ids.includes(node.id)) ids.push(node.id);
        this.canvas.highlight(ids);
      }).catch(() => {
        this.canvas.highlight([node.id]);
      });
      // Clear the search bar text without firing onClear (we want to keep highlight)
      this.search.clearText();
      // Setup expand button
      setTimeout(() => {
        const btn = this.nodeDetail.getExpandButton();
        btn?.addEventListener('click', () => this.expandNode(node.id));
      }, 50);
    });

    this.canvas.on('node-hover', (data) => {
      const { node, x, y } = data as { node: Node; x: number; y: number };
      this.tooltip.showNode(node, x, y);
    });
    this.canvas.on('node-unhover', () => this.tooltip.hide());

    this.canvas.on('edge-hover', (data) => {
      const { edge, x, y } = data as { edge: Edge; x: number; y: number };
      this.tooltip.showEdge(edge, x, y);
    });
    this.canvas.on('edge-unhover', () => this.tooltip.hide());
  }

  private setupWS() {
    const dot = this.root.querySelector<HTMLDivElement>('#ws-dot');

    this.ws.onStatusChange = (connected) => {
      this.stats.ws = connected;
      if (dot) {
        dot.style.background = connected ? '#00ff88' : '#ff4444';
        dot.title = connected ? 'Live — WebSocket connected' : 'Disconnected';
        if (connected) dot.style.boxShadow = '0 0 8px #00ff8866';
        else dot.style.boxShadow = 'none';
      }
    };

    this.ws.onMessage((msg: WSMessage) => {
      switch (msg.type) {
        case 'node_added': {
          const node = msg.payload as Node;
          this.canvas.addNode(node);
          this.stats.nodes++;
          this.updateStats();
          if (node.risk_score > 0.75) {
            toast(`⚠ High-risk node: ${node.label} (${(node.risk_score * 100).toFixed(0)}%)`, 'warning', 4000);
          }
          break;
        }
        case 'edge_added': {
          const edge = msg.payload as Edge;
          this.canvas.addEdge(edge);
          this.stats.edges++;
          this.updateStats();
          break;
        }
        case 'alert': {
          const alert = msg.payload as Alert;
          this.alertsFeed.addAlert(alert);
          this.stats.alerts++;
          this.updateStats();
          const color = alert.severity === 'critical' ? 'critical' : alert.severity === 'high' ? 'warning' : 'info';
          toast(`🚨 ${alert.severity.toUpperCase()}: ${alert.rule_name} — ${alert.node_label}`, color as never, 5000);
          break;
        }
        case 'stats': {
          const s = msg.payload as { nodes: number };
          if (s.nodes) this.stats.nodes = s.nodes;
          this.updateStats();
          break;
        }
      }
    });

    this.ws.connect();
  }

  private async loadInitialGraph() {
    try {
      const graph = await api.getGraph('laundering', 300);
      this.canvas.loadGraph(graph);
      this.stats.nodes = graph.nodes.length;
      this.stats.edges = graph.edges.length;
      this.updateStats();
      setTimeout(() => this.canvas.fitView(), 800);
    } catch (e) {
      toast('Failed to load graph: ' + (e as Error).message, 'critical');
    }
  }

  private async loadAlerts() {
    try {
      const alerts = await api.getAlerts(50);
      this.alertsFeed.setAlerts(alerts);
      this.stats.alerts = alerts.length;
      this.updateStats();
    } catch { /* silent */ }
  }

  private async expandNode(nodeId: string) {
    try {
      toast('Expanding neighborhood…', 'info', 1500);
      const subgraph = await api.getNeighbors(nodeId, 2);
      subgraph.nodes.forEach(n => this.canvas.addNode(n));
      subgraph.edges.forEach(e => this.canvas.addEdge(e));
      const ids = subgraph.nodes.map(n => n.id);
      this.canvas.highlight(ids);
      toast(`Expanded: ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges`, 'success');
    } catch {
      toast('Failed to expand node', 'critical');
    }
  }

  private releaseHighlight() {
    this.canvas.clearHighlight();
    this.nodeDetail = new NodeDetail(this.nodeDetailContainer);
    this.search.clear();
  }

  private onSearchSelect(result: SearchResult) {
    // First fetch neighbors so we can highlight the whole ego-network
    api.getNeighbors(result.id, 1).then(g => {
      const allIds = g.nodes.map(n => n.id);
      // Ensure the searched node itself is always included
      if (!allIds.includes(result.id)) allIds.push(result.id);
      this.canvas.highlight(allIds);

      const node = g.nodes.find(n => n.id === result.id);
      if (node) this.nodeDetail.show(node);
      setTimeout(() => {
        const btn = this.nodeDetail.getExpandButton();
        btn?.addEventListener('click', () => this.expandNode(result.id));
      }, 50);
    }).catch(() => {
      // Fallback: highlight just the node
      this.canvas.highlight([result.id]);
    });
    toast(`Focused: ${result.label} — click canvas background or ✕ to release`, 'info', 3000);
  }

  private setMode(mode: PanelMode) {
    this.mode = mode;
    const graphBtn = this.root.querySelector<HTMLButtonElement>('#mode-graph');
    const schemaBtn = this.root.querySelector<HTMLButtonElement>('#mode-schema');

    if (mode === 'graph') {
      this.canvasContainer.style.display = 'block';
      this.schemaContainer.style.display = 'none';
      if (graphBtn) { graphBtn.style.background = 'rgba(0,229,255,0.1)'; graphBtn.style.color = '#00e5ff'; }
      if (schemaBtn) { schemaBtn.style.background = 'transparent'; schemaBtn.style.color = '#4a6a85'; }
    } else {
      this.canvasContainer.style.display = 'none';
      this.schemaContainer.style.display = 'block';
      if (schemaBtn) { schemaBtn.style.background = 'rgba(0,229,255,0.1)'; schemaBtn.style.color = '#00e5ff'; }
      if (graphBtn) { graphBtn.style.background = 'transparent'; graphBtn.style.color = '#4a6a85'; }
    }
  }

  private updateStats() {
    this.statsEl.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;">
        ${[
          { label: 'nodes', value: this.stats.nodes.toLocaleString(), color: '#00e5ff' },
          { label: 'edges', value: this.stats.edges.toLocaleString(), color: '#00ff88' },
          { label: 'alerts', value: this.stats.alerts.toLocaleString(), color: '#ff4444' },
        ].map(s => `
          <div style="text-align:center;">
            <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:${s.color};line-height:1;">
              ${s.value}
            </div>
            <div style="font-size:9px;color:#2a3a4a;letter-spacing:0.06em;text-transform:uppercase;">${s.label}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
}
