import * as d3 from 'd3'
import type { NSystem, NEvent } from '../types'

type SysDatum = NSystem & d3.SimulationNodeDatum

interface ActiveEdge {
  source: string; target: string; label: string
  severity: string; weight: number; fresh: boolean
  key: string; count: number
}

interface Particle { x: number; y: number; t: number; severity: string; id: number }

export type CanvasEvent = 'node-click' | 'node-hover' | 'node-unhover' | 'bg-click'

export class GraphCanvas {
  private container: HTMLElement
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>
  private edgeG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private nodeG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private labelG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private particleG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private sim!: d3.Simulation<SysDatum, undefined>
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>   // stored for fitView
  private sysMap = new Map<string, SysDatum>()
  private edgeMap = new Map<string, ActiveEdge>()
  private particles: Particle[] = []
  private particleId = 0
  private animFrame = 0
  private listeners = new Map<CanvasEvent, ((d: unknown) => void)[]>()
  private highlightIds = new Set<string>()
  private w = 800; private h = 600
  showLabels = true

  constructor(container: HTMLElement) {
    this.container = container
    this.init()
  }

  private init() {
    const rect = this.container.getBoundingClientRect()
    this.w = rect.width || 800; this.h = rect.height || 600

    this.svg = d3.select(this.container).append('svg')
      .attr('width', '100%').attr('height', '100%')
      .on('click', (e) => { if (e.target === e.currentTarget) this.emit('bg-click', null) })

    const defs = this.svg.append('defs')
    // Arrow markers per severity
    const arrows = [
      { id: 'arr-low',      color: '#182030' },
      { id: 'arr-medium',   color: '#ffaa00' },
      { id: 'arr-high',     color: '#ff6600' },
      { id: 'arr-critical', color: '#ff2244' },
      { id: 'arr-hl',       color: '#00d4ff' },
    ]
    arrows.forEach(({ id, color }) => {
      defs.append('marker').attr('id', id)
        .attr('viewBox','0 -4 8 8').attr('refX', 20).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient','auto')
        .append('path').attr('d','M0,-4L8,0L0,4').attr('fill', color)
    })

    const glow = defs.append('filter').attr('id', 'glow')
    glow.append('feGaussianBlur').attr('stdDeviation','3').attr('result','b')
    const fm = glow.append('feMerge')
    fm.append('feMergeNode').attr('in','b')
    fm.append('feMergeNode').attr('in','SourceGraphic')

    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .on('zoom', (ev) => this.g.attr('transform', ev.transform))
    this.svg.call(this.zoom)

    this.g = this.svg.append('g')
    this.edgeG   = this.g.append('g')
    this.particleG = this.g.append('g')
    this.nodeG   = this.g.append('g')
    this.labelG  = this.g.append('g')

    this.sim = d3.forceSimulation<SysDatum>()
      .force('link', d3.forceLink<SysDatum, d3.SimulationLinkDatum<SysDatum>>().distance(130).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-400).distanceMax(500))
      .force('center', d3.forceCenter(this.w / 2, this.h / 2))
      .force('collision', d3.forceCollide<SysDatum>().radius(d => this.radius(d) + 12))
      .alphaDecay(0.02)

    new ResizeObserver(() => this.onResize()).observe(this.container)
    this.startParticleLoop()
  }

  private onResize() {
    const r = this.container.getBoundingClientRect()
    this.w = r.width; this.h = r.height
    this.sim.force('center', d3.forceCenter(this.w / 2, this.h / 2)).alpha(0.1).restart()
  }

  // ── Load complete snapshot ────────────────────────────────────────────────

  loadSnapshot(systems: NSystem[], events: NEvent[]) {
    // Preserve positions for known nodes
    const newSys: SysDatum[] = systems.map(s => {
      const ex = this.sysMap.get(s.id)
      return { ...s, x: ex?.x, y: ex?.y }
    })
    this.sysMap.clear()
    newSys.forEach(s => this.sysMap.set(s.id, s))

    // Build edge map: aggregate multiple events between same pair
    this.edgeMap.clear()
    events.forEach(ev => {
      const key = `${ev.source}→${ev.target}`
      const ex = this.edgeMap.get(key)
      const sev = this.maxSeverity(ex?.severity ?? 'low', ev.severity)
      this.edgeMap.set(key, {
        source: ev.source, target: ev.target,
        label: ev.event_type,
        severity: sev,
        weight: (ex?.weight ?? 0) + (ev.bytes_sent + ev.bytes_recv),
        fresh: true, key,
        count: (ex?.count ?? 0) + 1,
      })
    })

    this.render()
  }

  // ── Fire a burst of particles for newly arrived events ─────────────────────

  fireParticles(events: NEvent[]) {
    events.slice(0, 40).forEach(ev => {
      const src = this.sysMap.get(ev.source)
      const tgt = this.sysMap.get(ev.target)
      if (!src?.x || !tgt?.x) return
      this.particles.push({
        x: src.x!, y: src.y!, t: 0,
        severity: ev.severity, id: this.particleId++
      })
    })
  }

  private startParticleLoop() {
    const tick = () => {
      this.animFrame = requestAnimationFrame(tick)
      this.updateParticles()
    }
    this.animFrame = requestAnimationFrame(tick)
  }

  private updateParticles() {
    const SPEED = 0.025
    this.particles = this.particles.filter(p => p.t < 1)
    this.particles.forEach(p => { p.t += SPEED })

    this.particleG.selectAll<SVGCircleElement, Particle>('circle.packet')
      .data(this.particles, d => String(d.id))
      .join(
        enter => enter.append('circle').attr('class','packet').attr('r', 3),
        update => update,
        exit => exit.remove()
      )
      .attr('fill', d => this.sevColor(d.severity))
      .attr('opacity', d => 1 - d.t * 0.8)
      // positions are updated in render tick; here we move along the edge path
  }

  // ── D3 render ─────────────────────────────────────────────────────────────

  private render() {
    const self = this
    const nodes = [...this.sysMap.values()]
    const edges = [...this.edgeMap.values()]

    // ── Edges
    const edgeSel = this.edgeG.selectAll<SVGLineElement, ActiveEdge>('line')
      .data(edges, d => d.key)
      .join(
        enter => enter.append('line')
          .attr('opacity', 0)
          .call(s => s.transition().duration(500).attr('opacity', 1))
          .on('mouseover', (ev, d) => {
            d3.select(ev.currentTarget as SVGLineElement)
              .attr('stroke-width', 4).attr('stroke-opacity', 1)
          })
          .on('mouseout', (ev) => {
            d3.select(ev.currentTarget as SVGLineElement)
              .attr('stroke-width', null).attr('stroke-opacity', 0.55)
          }),
        update => update,
        exit => exit.transition().duration(400).attr('opacity', 0).remove()
      )
      .attr('stroke', d => this.sevColor(d.severity))
      .attr('stroke-opacity', 0.55)
      .attr('stroke-width', d => Math.max(1, Math.min(5, Math.log2((d.weight || 1) / 1024 + 1))))
      .attr('marker-end', d => `url(#arr-${d.severity})`)

    // ── Nodes
    const nodeSel = this.nodeG.selectAll<SVGGElement, SysDatum>('g.sys')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const g = enter.append('g').attr('class','sys').style('cursor','pointer')
            .call(d3.drag<SVGGElement, SysDatum>()
              .on('start', (ev, d) => { if (!ev.active) self.sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y })
              .on('drag',  (ev, d) => { d.fx=ev.x; d.fy=ev.y })
              .on('end',   (ev, d) => { if (!ev.active) self.sim.alphaTarget(0); d.fx=null; d.fy=null })
            )
            .on('click', (_, d) => self.emit('node-click', d))
            .on('mouseover', (ev, d) => self.emit('node-hover', { node: d, x: ev.clientX, y: ev.clientY }))
            .on('mouseout', () => self.emit('node-unhover', null))

          // Glow ring (critical/high)
          g.append('circle').attr('class','glow-ring').attr('fill','none').attr('stroke-width', 2)
          // Main circle
          g.append('circle').attr('class','main').attr('stroke-width', 1.5)
          // Icon
          g.append('text').attr('class','icon').attr('text-anchor','middle')
            .attr('dominant-baseline','central').attr('font-size','13px').attr('pointer-events','none')

          return g.attr('opacity', 0).call(s => s.transition().duration(400).attr('opacity', 1))
        },
        update => update,
        exit => exit.transition().duration(300).attr('opacity', 0).remove()
      )

    nodeSel.select<SVGCircleElement>('.glow-ring')
      .attr('r', d => this.radius(d) + 5)
      .attr('stroke', d => (d.critical_count > 0 ? '#ff2244' : d.high_count > 0 ? '#ff6600' : 'transparent'))
      .attr('opacity', 0.4)

    nodeSel.select<SVGCircleElement>('.main')
      .attr('r', d => this.radius(d))
      .attr('fill', d => this.typeColor(d.type) + '22')
      .attr('stroke', d => this.highlightIds.size
        ? (this.highlightIds.has(d.id) ? '#00d4ff' : this.typeColor(d.type) + '44')
        : this.typeColor(d.type))

    nodeSel.select<SVGTextElement>('.icon').text(d => this.typeIcon(d.type))

    nodeSel.attr('opacity', d =>
      this.highlightIds.size === 0 ? 1 : (this.highlightIds.has(d.id) ? 1 : 0.12))

    // ── Labels
    const labelSel = this.labelG.selectAll<SVGTextElement, SysDatum>('text')
      .data(this.showLabels ? nodes : [], d => d.id)
      .join(
        enter => enter.append('text').attr('fill','#6888a8').attr('font-size','10px')
          .attr('text-anchor','middle').attr('pointer-events','none'),
        update => update,
        exit => exit.remove()
      )
      .text(d => d.label.length > 18 ? d.label.slice(0,16)+'…' : d.label)
      .attr('opacity', d => this.highlightIds.size === 0 ? 1 : (this.highlightIds.has(d.id) ? 1 : 0))

    // Edges dim too
    edgeSel.attr('opacity', d => {
      if (this.highlightIds.size === 0) return 1
      return this.highlightIds.has(d.source) || this.highlightIds.has(d.target) ? 1 : 0.04
    })

    // ── Simulation tick
    this.sim.nodes(nodes).on('tick', () => {
      edgeSel
        .attr('x1', d => this.sysMap.get(d.source)?.x ?? 0)
        .attr('y1', d => this.sysMap.get(d.source)?.y ?? 0)
        .attr('x2', d => this.sysMap.get(d.target)?.x ?? 0)
        .attr('y2', d => this.sysMap.get(d.target)?.y ?? 0)

      nodeSel.attr('transform', d => `translate(${d.x??0},${d.y??0})`)

      labelSel.attr('x', d => d.x??0).attr('y', d => (d.y??0) + this.radius(d) + 14)

      // Move particles along their edges
      this.particleG.selectAll<SVGCircleElement, Particle>('circle.packet')
        .each(function(p) {
          // find the edge this particle belongs to — use particle index → edge
          const el = self.particles.indexOf(p)
          const edges = [...self.edgeMap.values()]
          if (el < 0 || el >= edges.length) return
          const edge = edges[el % edges.length]
          const src = self.sysMap.get(edge.source)
          const tgt = self.sysMap.get(edge.target)
          if (!src || !tgt) return
          const px = (src.x??0) + ((tgt.x??0) - (src.x??0)) * p.t
          const py = (src.y??0) + ((tgt.y??0) - (src.y??0)) * p.t
          d3.select(this).attr('cx', px).attr('cy', py)
        })
    })

    this.sim.alpha(0.2).restart()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  highlight(ids: string[]) {
    this.highlightIds = new Set(ids)
    this.render()
  }

  clearHighlight() {
    this.highlightIds.clear()
    this.render()
  }

  fitView() {
    const nodes = [...this.sysMap.values()]
    if (!nodes.length) return
    const rect = this.container.getBoundingClientRect()
    this.w = rect.width || this.w
    this.h = rect.height || this.h

    const xs = nodes.map(n => n.x ?? 0)
    const ys = nodes.map(n => n.y ?? 0)
    const pad = 80
    const x1 = Math.min(...xs) - pad
    const x2 = Math.max(...xs) + pad
    const y1 = Math.min(...ys) - pad
    const y2 = Math.max(...ys) + pad
    const bw = x2 - x1
    const bh = y2 - y1
    if (bw <= 0 || bh <= 0) return

    const scale = Math.min(0.9, this.w / bw, this.h / bh)
    const tx = (this.w - bw * scale) / 2 - x1 * scale
    const ty = (this.h - bh * scale) / 2 - y1 * scale

    this.svg.transition().duration(700).call(
      this.zoom.transform,                              // use stored zoom, not a new one
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    )
  }

  toggleLabels() { this.showLabels = !this.showLabels; this.render() }
  getNodeCount() { return this.sysMap.size }
  getEdgeCount() { return this.edgeMap.size }

  on(ev: CanvasEvent, fn: (d: unknown) => void) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, [])
    this.listeners.get(ev)!.push(fn)
  }
  private emit(ev: CanvasEvent, d: unknown) { this.listeners.get(ev)?.forEach(f => f(d)) }

  destroy() { cancelAnimationFrame(this.animFrame) }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private radius(d: NSystem): number {
    return 10 + Math.min(14, Math.log2((d.total_events || 1) + 1) * 2)
  }

  private typeColor(t: string): string {
    const m: Record<string, string> = {
      web_server: '#4488ff', database: '#ff6600', cache: '#ffaa00',
      load_balancer: '#00d4ff', worker: '#aa44ff', queue: '#ff44aa',
      monitoring: '#44aa66', security: '#ff2244', siem: '#ff4466',
      external: '#888888', endpoint: '#66aaff', threat: '#ff0044',
      storage: '#44ffaa', firewall: '#ff6644',
    }
    return m[t] || '#5588aa'
  }

  private typeIcon(t: string): string {
    const m: Record<string, string> = {
      web_server: '◈', database: '◉', cache: '⬡', load_balancer: '⊕',
      worker: '▶', queue: '≡', monitoring: '◎', security: '⊛', siem: '⊡',
      external: '○', endpoint: '●', threat: '⚠', storage: '▣', firewall: '⊠',
    }
    return m[t] || '◦'
  }

  private sevColor(s: string): string {
    return ({ low:'#182030', medium:'#ffaa00', high:'#ff6600', critical:'#ff2244' } as Record<string,string>)[s] || '#182030'
  }

  private maxSeverity(a: string, b: string): string {
    const rank = { low:0, medium:1, high:2, critical:3 } as Record<string,number>
    return rank[a] >= rank[b] ? a : b
  }
}
