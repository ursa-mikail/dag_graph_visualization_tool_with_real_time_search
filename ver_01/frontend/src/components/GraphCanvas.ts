import * as d3 from 'd3';
import type { Node, Edge, Graph } from '../types';

type NodeDatum = Node & d3.SimulationNodeDatum;
type EdgeDatum = Omit<Edge, 'source' | 'target'> & {
  source: NodeDatum | string;
  target: NodeDatum | string;
};

export type GraphEventType = 'node-click' | 'node-hover' | 'node-unhover' | 'edge-hover' | 'edge-unhover';

export class GraphCanvas {
  private container: HTMLElement;
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation!: d3.Simulation<NodeDatum, EdgeDatum>;
  private nodeMap = new Map<string, NodeDatum>();
  private edgeMap = new Map<string, EdgeDatum>();
  private nodeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private edgeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private labelGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private listeners = new Map<GraphEventType, ((d: unknown) => void)[]>();
  private width = 0;
  private height = 0;
  private highlightedIds = new Set<string>();
  public showLabels = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  private init() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 600;

    this.svg = d3.select(this.container).append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .style('background', 'transparent');

    // Defs: arrowheads + glow filter
    const defs = this.svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#1e2a38');

    defs.append('marker')
      .attr('id', 'arrow-highlight')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#00e5ff');

    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });
    this.svg.call(zoom);

    this.g = this.svg.append('g');
    this.edgeGroup = this.g.append('g').attr('class', 'edges');
    this.nodeGroup = this.g.append('g').attr('class', 'nodes');
    this.labelGroup = this.g.append('g').attr('class', 'labels');

    // Simulation
    this.simulation = d3.forceSimulation<NodeDatum>()
      .force('link', d3.forceLink<NodeDatum, EdgeDatum>()
        .id(d => d.id)
        .distance(d => {
          const w = (d as EdgeDatum).weight || 1;
          return Math.max(80, Math.min(200, 80 + Math.log(w + 1) * 8));
        })
        .strength(0.4))
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(400))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide<NodeDatum>().radius(d => this.nodeRadius(d) + 8))
      .alphaDecay(0.015)
      .velocityDecay(0.4);

    // Resize observer
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
    this.simulation.alpha(0.1).restart();
  }

  private nodeRadius(d: NodeDatum): number {
    const base = 10;
    const riskBonus = d.risk_score * 8;
    const edgeBonus = Math.min(10, (d.edge_count || 0) * 0.5);
    return base + riskBonus + edgeBonus;
  }

  private nodeColor(d: NodeDatum): string {
    return d.color || '#4488ff';
  }

  loadGraph(graph: Graph) {
    const nodes: NodeDatum[] = graph.nodes.map(n => {
      const existing = this.nodeMap.get(n.id);
      return { ...n, x: existing?.x, y: existing?.y };
    });
    const edges: EdgeDatum[] = graph.edges.map(e => ({ ...e }));

    this.nodeMap.clear();
    this.edgeMap.clear();
    nodes.forEach(n => this.nodeMap.set(n.id, n));
    edges.forEach(e => this.edgeMap.set(e.id, e));

    this.render(nodes, edges);
  }

  addNode(node: Node) {
    if (this.nodeMap.has(node.id)) return;
    const rect = this.container.getBoundingClientRect();
    const nd: NodeDatum = {
      ...node,
      x: rect.width / 2 + (Math.random() - 0.5) * 200,
      y: rect.height / 2 + (Math.random() - 0.5) * 200,
    };
    this.nodeMap.set(nd.id, nd);
    this.render([...this.nodeMap.values()], [...this.edgeMap.values()]);
    // Flash new node
    setTimeout(() => {
      this.nodeGroup.selectAll<SVGCircleElement, NodeDatum>('circle')
        .filter(d => d.id === nd.id)
        .attr('filter', 'url(#glow)')
        .transition().duration(1500)
        .attr('filter', null);
    }, 50);
  }

  addEdge(edge: Edge) {
    if (this.edgeMap.has(edge.id)) return;
    const ed: EdgeDatum = { ...edge };
    this.edgeMap.set(ed.id, ed);
    this.render([...this.nodeMap.values()], [...this.edgeMap.values()]);
  }

  highlight(ids: string[]) {
    this.highlightedIds = new Set(ids);
    this.updateHighlight();
  }

  clearHighlight() {
    this.highlightedIds.clear();
    this.updateHighlight();
  }

  private updateHighlight() {
    const hasHighlight = this.highlightedIds.size > 0;

    this.nodeGroup.selectAll<SVGGElement, NodeDatum>('g.node')
      .attr('opacity', d => !hasHighlight || this.highlightedIds.has(d.id) ? 1 : 0.15);

    this.edgeGroup.selectAll<SVGLineElement, EdgeDatum>('line')
      .attr('opacity', d => {
        if (!hasHighlight) return 0.6;
        const sid = typeof d.source === 'string' ? d.source : (d.source as NodeDatum).id;
        const tid = typeof d.target === 'string' ? d.target : (d.target as NodeDatum).id;
        return this.highlightedIds.has(sid) || this.highlightedIds.has(tid) ? 1 : 0.05;
      })
      .attr('marker-end', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as NodeDatum).id;
        const tid = typeof d.target === 'string' ? d.target : (d.target as NodeDatum).id;
        const isHighlit = this.highlightedIds.has(sid) || this.highlightedIds.has(tid);
        return isHighlit ? 'url(#arrow-highlight)' : 'url(#arrow)';
      });
  }

  private render(nodes: NodeDatum[], edges: EdgeDatum[]) {
    const self = this;

    // ── Edges ──
    const edgeSel = this.edgeGroup.selectAll<SVGLineElement, EdgeDatum>('line')
      .data(edges, d => d.id)
      .join(
        enter => enter.append('line')
          .attr('stroke', '#1e2a38')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.6)
          .attr('marker-end', 'url(#arrow)')
          .attr('opacity', 0)
          .call(s => s.transition().duration(400).attr('opacity', 0.6))
          .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke', '#00e5ff').attr('stroke-opacity', 1).attr('stroke-width', 2);
            self.emit('edge-hover', { edge: d, x: event.clientX, y: event.clientY });
          })
          .on('mouseout', function(_, d) {
            d3.select(this).attr('stroke', '#1e2a38').attr('stroke-opacity', 0.6).attr('stroke-width', 1);
            self.emit('edge-unhover', d);
          }),
        update => update,
        exit => exit.transition().duration(300).attr('opacity', 0).remove()
      )
      .attr('stroke-width', d => Math.max(1, Math.min(4, Math.log(d.weight + 1) * 0.3)));

    // ── Nodes ──
    const nodeSel = this.nodeGroup.selectAll<SVGGElement, NodeDatum>('g.node')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const g = enter.append('g').attr('class', 'node')
            .style('cursor', 'pointer')
            .call(d3.drag<SVGGElement, NodeDatum>()
              .on('start', (event, d) => {
                if (!event.active) self.simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
              })
              .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
              .on('end', (event, d) => {
                if (!event.active) self.simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
              })
            )
            .on('click', (_, d) => self.emit('node-click', d))
            .on('mouseover', (event, d) => self.emit('node-hover', { node: d, x: event.clientX, y: event.clientY }))
            .on('mouseout', (_, d) => self.emit('node-unhover', d));

          // Outer glow ring for high risk
          g.append('circle')
            .attr('class', 'risk-ring')
            .attr('fill', 'none')
            .attr('stroke-width', 2)
            .attr('opacity', 0.3);

          // Main circle
          g.append('circle')
            .attr('class', 'main-circle')
            .attr('stroke-width', 1.5);

          // Icon text
          g.append('text')
            .attr('class', 'node-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', '11px')
            .attr('pointer-events', 'none');

          return g.attr('opacity', 0).call(s => s.transition().duration(400).attr('opacity', 1));
        },
        update => update,
        exit => exit.transition().duration(300).attr('opacity', 0).remove()
      );

    nodeSel.select<SVGCircleElement>('.risk-ring')
      .attr('r', d => self.nodeRadius(d) + 4)
      .attr('stroke', d => d.risk_score > 0.7 ? self.nodeColor(d) : 'transparent');

    nodeSel.select<SVGCircleElement>('.main-circle')
      .attr('r', d => self.nodeRadius(d))
      .attr('fill', d => {
        const color = self.nodeColor(d);
        return `${color}22`;
      })
      .attr('stroke', d => self.nodeColor(d));

    nodeSel.select<SVGTextElement>('.node-icon')
      .text(d => self.nodeIcon(d.type_name));

    // ── Labels ──
    const labelSel = this.labelGroup.selectAll<SVGTextElement, NodeDatum>('text')
      .data(this.showLabels ? nodes : [], d => d.id)
      .join(
        enter => enter.append('text')
          .attr('fill', '#7a9ab5')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none')
          .attr('opacity', 0)
          .call(s => s.transition().duration(400).attr('opacity', 1)),
        update => update,
        exit => exit.remove()
      )
      .text(d => d.label.length > 20 ? d.label.slice(0, 18) + '…' : d.label);

    // Simulation
    this.simulation
      .nodes(nodes)
      .on('tick', () => {
        edgeSel
          .attr('x1', d => (d.source as NodeDatum).x ?? 0)
          .attr('y1', d => (d.source as NodeDatum).y ?? 0)
          .attr('x2', d => (d.target as NodeDatum).x ?? 0)
          .attr('y2', d => (d.target as NodeDatum).y ?? 0);

        nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

        labelSel
          .attr('x', d => d.x ?? 0)
          .attr('y', d => (d.y ?? 0) + self.nodeRadius(d) + 14);
      });

    (this.simulation.force('link') as d3.ForceLink<NodeDatum, EdgeDatum>).links(edges);
    this.simulation.alpha(0.3).restart();
  }

  private nodeIcon(typeName: string): string {
    const icons: Record<string, string> = {
      shell_company: '🏢', bank_account: '🏦', crypto_wallet: '₿',
      individual: '●', real_estate: '◆', offshore_fund: '◉',
      server: '▣', endpoint: '○', router: '◈',
      supplier: '▲', manufacturer: '◰', distributor: '▶',
    };
    return icons[typeName] || '●';
  }

  on(event: GraphEventType, handler: (d: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  private emit(event: GraphEventType, data: unknown) {
    this.listeners.get(event)?.forEach(h => h(data));
  }

  toggleLabels() {
    this.showLabels = !this.showLabels;
    this.render([...this.nodeMap.values()], [...this.edgeMap.values()]);
  }

  fitView() {
    if (this.nodeMap.size === 0) return;
    const nodes = [...this.nodeMap.values()];
    const xs = nodes.map(n => n.x ?? 0);
    const ys = nodes.map(n => n.y ?? 0);
    const x1 = Math.min(...xs), x2 = Math.max(...xs);
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    const padding = 60;
    const bw = x2 - x1 + padding * 2;
    const bh = y2 - y1 + padding * 2;
    const scale = Math.min(0.9, Math.min(this.width / bw, this.height / bh));
    const tx = (this.width - (x1 + x2) * scale) / 2;
    const ty = (this.height - (y1 + y2) * scale) / 2;
    this.svg.transition().duration(600)
      .call(d3.zoom<SVGSVGElement, unknown>().transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  getNodeCount() { return this.nodeMap.size; }
  getEdgeCount() { return this.edgeMap.size; }
}
