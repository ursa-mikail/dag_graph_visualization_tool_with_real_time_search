import * as d3 from 'd3'
import type { NSystem, NEvent } from '../types'

type SysDatum = NSystem & d3.SimulationNodeDatum

interface ActiveEdge {
  source: string; target: string
  severity: string; weight: number
  key: string; count: number; label: string
}

// Particle stores its own src/tgt coords so it moves correctly
interface Particle {
  id: number; t: number; severity: string
  x0: number; y0: number; x1: number; y1: number
}

export type CanvasEvent = 'node-click' | 'node-hover' | 'node-unhover' | 'bg-click'

// Severity rank for comparisons
const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export class GraphCanvas {
  private container: HTMLElement
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>
  private edgeG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private nodeG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private labelG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private particleG!: d3.Selection<SVGGElement, unknown, null, undefined>
  private sim!: d3.Simulation<SysDatum, undefined>
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>
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
      .on('click', (e) => {
        const t = e.target as Element
        if (t.tagName === 'svg' || (t.tagName === 'g' && !t.closest('g.sys'))) {
          this.emit('bg-click', null)
        }
      })

    // ── Defs: arrows + glow filter ──────────────────────────────────────────
    const defs = this.svg.append('defs')

    // One arrow per severity — clearly visible colors
    const arrowDefs = [
      { id: 'arr-low',      color: '#3a5a80' },
      { id: 'arr-medium',   color: '#ffaa00' },
      { id: 'arr-high',     color: '#ff6600' },
      { id: 'arr-critical', color: '#ff2244' },
    ]
    arrowDefs.forEach(({ id, color }) => {
      defs.append('marker').attr('id', id)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 24).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
    })

    // Glow filter for highlighted nodes
    const glow = defs.append('filter').attr('id', 'node-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    const fm = glow.append('feMerge')
    fm.append('feMergeNode').attr('in', 'blur')
    fm.append('feMergeNode').attr('in', 'SourceGraphic')

    // Alert pulse filter (critical nodes)
    const alertGlow = defs.append('filter').attr('id', 'alert-glow')
      .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
    alertGlow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
    const fm2 = alertGlow.append('feMerge')
    fm2.append('feMergeNode').attr('in', 'blur')
    fm2.append('feMergeNode').attr('in', 'SourceGraphic')

    // ── Zoom ────────────────────────────────────────────────────────────────
    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.04, 8])
      .on('zoom', (ev) => this.g.attr('transform', ev.transform))
    this.svg.call(this.zoom)

    // Layer order: edges → particles → nodes → labels
    this.g = this.svg.append('g')
    this.edgeG    = this.g.append('g').attr('class', 'layer-edges')
    this.particleG = this.g.append('g').attr('class', 'layer-particles')
    this.nodeG    = this.g.append('g').attr('class', 'layer-nodes')
    this.labelG   = this.g.append('g').attr('class', 'layer-labels')

    // ── Simulation ───────────────────────────────────────────────────────────
    this.sim = d3.forceSimulation<SysDatum>()
      .force('link', d3.forceLink<SysDatum, d3.SimulationLinkDatum<SysDatum>>()
        .distance(160).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-600).distanceMax(600))
      .force('center', d3.forceCenter(this.w / 2, this.h / 2).strength(0.05))
      .force('collision', d3.forceCollide<SysDatum>().radius(d => this.radius(d) + 20).strength(0.8))
      .alphaDecay(0.018)
      .velocityDecay(0.35)

    new ResizeObserver(() => this.onResize()).observe(this.container)
    this.startParticleLoop()
  }

  private onResize() {
    const r = this.container.getBoundingClientRect()
    this.w = r.width; this.h = r.height
    this.sim.force('center', d3.forceCenter(this.w / 2, this.h / 2).strength(0.05))
    this.sim.alpha(0.1).restart()
  }

  // ── Public: load snapshot ─────────────────────────────────────────────────

  loadSnapshot(systems: NSystem[], events: NEvent[]) {
    const newSys: SysDatum[] = systems.map(s => {
      const ex = this.sysMap.get(s.id)
      return { ...s, x: ex?.x, y: ex?.y }
    })
    this.sysMap.clear()
    newSys.forEach(s => this.sysMap.set(s.id, s))

    this.edgeMap.clear()
    events.forEach(ev => {
      const key = `${ev.source}→${ev.target}`
      const ex = this.edgeMap.get(key)
      const sev = ex
        ? (SEV_RANK[ex.severity] >= SEV_RANK[ev.severity] ? ex.severity : ev.severity)
        : ev.severity
      this.edgeMap.set(key, {
        source: ev.source, target: ev.target,
        severity: sev, label: ev.event_type,
        weight: (ex?.weight ?? 0) + ev.bytes_sent + ev.bytes_recv,
        key, count: (ex?.count ?? 0) + 1,
      })
    })

    this.render()
  }

  // ── Public: fire particles for new events ─────────────────────────────────

  fireParticles(events: NEvent[]) {
    events.slice(0, 30).forEach(ev => {
      const src = this.sysMap.get(ev.source)
      const tgt = this.sysMap.get(ev.target)
      if (!src?.x || !tgt?.x || !src?.y || !tgt?.y) return
      this.particles.push({
        id: this.particleId++, t: 0, severity: ev.severity,
        x0: src.x, y0: src.y, x1: tgt.x, y1: tgt.y,
      })
    })
  }

  // ── Particle animation loop ───────────────────────────────────────────────

  private startParticleLoop() {
    const tick = () => {
      this.animFrame = requestAnimationFrame(tick)
      this.tickParticles()
    }
    this.animFrame = requestAnimationFrame(tick)
  }

  private tickParticles() {
    const SPEED = 0.018
    this.particles = this.particles.filter(p => p.t < 1)
    this.particles.forEach(p => { p.t += SPEED })

    // Update source/target coords from live simulation positions
    // so particles track nodes that are still moving
    this.particles.forEach(p => {
      // Best-effort: find the matching edge and update endpoints
      for (const [, edge] of this.edgeMap) {
        const src = this.sysMap.get(edge.source)
        const tgt = this.sysMap.get(edge.target)
        if (src?.x && tgt?.x) {
          // Only update if this particle started near this edge's source
          const dist = Math.hypot((p.x0 - (src.x ?? 0)), (p.y0 - (src.y ?? 0)))
          if (dist < 40) {
            p.x0 = src.x ?? p.x0
            p.y0 = src.y ?? p.y0
            p.x1 = tgt.x ?? p.x1
            p.y1 = tgt.y ?? p.y1
            break
          }
        }
      }
    })

    this.particleG.selectAll<SVGCircleElement, Particle>('circle.pkt')
      .data(this.particles, d => String(d.id))
      .join(
        enter => enter.append('circle').attr('class', 'pkt').attr('r', 3.5),
        update => update,
        exit => exit.remove()
      )
      .attr('fill', d => this.sevEdgeColor(d.severity))
      .attr('opacity', d => Math.max(0.1, 1 - d.t * 0.85))
      .attr('cx', d => d.x0 + (d.x1 - d.x0) * d.t)
      .attr('cy', d => d.y0 + (d.y1 - d.y0) * d.t)
  }

  // ── Main D3 render ────────────────────────────────────────────────────────

  private render() {
    const self = this
    const nodes = [...this.sysMap.values()]
    const edges = [...this.edgeMap.values()]

    // ── Edges ────────────────────────────────────────────────────────────────
    const edgeSel = this.edgeG.selectAll<SVGLineElement, ActiveEdge>('line')
      .data(edges, d => d.key)
      .join(
        enter => enter.append('line')
          .attr('opacity', 0)
          .call(s => s.transition().duration(600).attr('opacity', null))
          .on('mouseover', function(_, d) {
            d3.select(this)
              .attr('stroke-opacity', 1)
              .attr('stroke-width', 4)
            self.showEdgeTooltip(d)
          })
          .on('mouseout', function() {
            d3.select(this)
              .attr('stroke-opacity', null)
              .attr('stroke-width', null)
            self.hideEdgeTooltip()
          }),
        update => update,
        exit => exit.transition().duration(300).attr('opacity', 0).remove()
      )
      .attr('stroke', d => this.sevEdgeColor(d.severity))
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', d => Math.max(1.5, Math.min(6, 1.5 + d.count * 0.4)))
      .attr('marker-end', d => `url(#arr-${d.severity})`)

    // Apply highlight dimming to edges (without touching the enter-transition)
    this.applyEdgeHighlight(edgeSel)

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeSel = this.nodeG.selectAll<SVGGElement, SysDatum>('g.sys')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const g = enter.append('g').attr('class', 'sys')
            .style('cursor', 'pointer')
            .call(d3.drag<SVGGElement, SysDatum>()
              .on('start', (ev, d) => {
                if (!ev.active) self.sim.alphaTarget(0.3).restart()
                d.fx = d.x; d.fy = d.y
              })
              .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y })
              .on('end', (ev, d) => {
                if (!ev.active) self.sim.alphaTarget(0)
                d.fx = null; d.fy = null
              })
            )
            .on('click', (ev, d) => { ev.stopPropagation(); self.emit('node-click', d) })
            .on('mouseover', (ev, d) => self.emit('node-hover', { node: d, x: ev.clientX, y: ev.clientY }))
            .on('mouseout', () => self.emit('node-unhover', null))

          // Shadow (depth)
          g.append('circle').attr('class', 'shadow')
            .attr('fill', 'rgba(0,0,0,0.4)')
            .attr('filter', 'url(#node-glow)')

          // Fill circle
          g.append('circle').attr('class', 'fill-circle')

          // Border circle
          g.append('circle').attr('class', 'border-circle')
            .attr('fill', 'none').attr('stroke-width', 2)

          // Type letter (reliable cross-platform vs unicode symbols)
          g.append('text').attr('class', 'type-label')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-family', 'IBM Plex Mono, monospace')
            .attr('font-weight', '700')
            .attr('pointer-events', 'none')

          return g.attr('opacity', 0).call(s => s.transition().duration(500).attr('opacity', 1))
        },
        update => update,
        exit => exit.transition().duration(300).attr('opacity', 0).remove()
      )

    const r = (d: SysDatum) => this.radius(d)

    nodeSel.select<SVGCircleElement>('.shadow')
      .attr('r', d => r(d) + 3)
      .attr('cx', 2).attr('cy', 3)

    nodeSel.select<SVGCircleElement>('.fill-circle')
      .attr('r', d => r(d))
      .attr('fill', d => this.typeColor(d.type) + '55')  // 33% opacity — visible but not garish

    nodeSel.select<SVGCircleElement>('.border-circle')
      .attr('r', d => r(d))
      .attr('stroke', d => this.nodeStroke(d))
      .attr('filter', d =>
        this.highlightIds.has(d.id) ? 'url(#node-glow)'
        : d.critical_count > 0 ? 'url(#alert-glow)'
        : null)

    nodeSel.select<SVGTextElement>('.type-label')
      .attr('font-size', d => Math.max(9, Math.min(13, r(d) * 0.75)) + 'px')
      .attr('fill', d => this.typeColor(d.type))
      .text(d => this.typeLetter(d.type))

    // Highlight/dim whole group
    nodeSel.attr('opacity', d =>
      this.highlightIds.size === 0 ? 1
      : this.highlightIds.has(d.id) ? 1 : 0.15)

    // ── Labels ───────────────────────────────────────────────────────────────
    const labelSel = this.labelG.selectAll<SVGGElement, SysDatum>('g.lbl')
      .data(this.showLabels ? nodes : [], d => d.id)
      .join(
        enter => {
          const g = enter.append('g').attr('class', 'lbl').attr('pointer-events', 'none')
          // Background pill for readability
          g.append('rect').attr('class', 'lbl-bg')
            .attr('rx', 3).attr('ry', 3)
            .attr('fill', 'rgba(7,9,13,0.75)')
          g.append('text').attr('class', 'lbl-text')
            .attr('text-anchor', 'middle')
            .attr('font-family', 'IBM Plex Mono, monospace')
            .attr('font-size', '11px')
            .attr('fill', '#c8d8ec')
          return g
        },
        update => update,
        exit => exit.remove()
      )

    // Update label text and background pill size
    labelSel.select<SVGTextElement>('.lbl-text')
      .text(d => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label)

    // Position pill — do after text to measure width
    labelSel.each(function(d) {
      const g = d3.select(this)
      const textEl = g.select<SVGTextElement>('.lbl-text').node()
      if (!textEl) return
      const tw = textEl.getComputedTextLength ? textEl.getComputedTextLength() : 60
      const pad = 5
      g.select('.lbl-bg')
        .attr('width', tw + pad * 2)
        .attr('height', 14)
        .attr('x', -(tw / 2 + pad))
        .attr('y', -7)
    })

    labelSel.attr('opacity', d =>
      this.highlightIds.size === 0 ? 1
      : this.highlightIds.has(d.id) ? 1 : 0)

    // ── Sim tick ─────────────────────────────────────────────────────────────
    this.sim.nodes(nodes).on('tick', () => {
      edgeSel
        .attr('x1', d => this.sysMap.get(d.source)?.x ?? 0)
        .attr('y1', d => this.sysMap.get(d.source)?.y ?? 0)
        .attr('x2', d => this.sysMap.get(d.target)?.x ?? 0)
        .attr('y2', d => this.sysMap.get(d.target)?.y ?? 0)

      nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)

      labelSel.attr('transform', d =>
        `translate(${d.x ?? 0},${(d.y ?? 0) + this.radius(d) + 16})`)
    })

    this.sim.alpha(0.2).restart()
  }

  private applyEdgeHighlight(sel: d3.Selection<SVGLineElement, ActiveEdge, SVGGElement, unknown>) {
    if (this.highlightIds.size === 0) {
      sel.attr('opacity', 0.75)
    } else {
      sel.attr('opacity', d =>
        this.highlightIds.has(d.source) || this.highlightIds.has(d.target) ? 1 : 0.06)
    }
  }

  // ── Edge tooltip (inline, no external dep) ────────────────────────────────
  private edgeTooltipEl: HTMLDivElement | null = null

  private showEdgeTooltip(d: ActiveEdge) {
    if (!this.edgeTooltipEl) {
      this.edgeTooltipEl = document.createElement('div')
      this.edgeTooltipEl.style.cssText = `
        position:fixed;pointer-events:none;z-index:9999;
        background:rgba(7,9,13,.97);border:1px solid #1e2d42;
        border-radius:6px;padding:8px 12px;font-size:11px;
        font-family:'IBM Plex Mono',monospace;color:#c8d8ec;
        line-height:1.6;box-shadow:0 4px 20px rgba(0,0,0,.6);
      `
      document.body.appendChild(this.edgeTooltipEl)
    }
    const sevColor = ({ low:'#3a5a80',medium:'#ffaa00',high:'#ff6600',critical:'#ff2244' } as Record<string,string>)[d.severity]
    this.edgeTooltipEl.innerHTML = `
      <div style="color:${sevColor};font-weight:700;margin-bottom:4px;">
        ${d.severity.toUpperCase()} — ${d.label.replace(/_/g,' ')}
      </div>
      <div style="color:#6888a8;">
        ${d.source} → ${d.target}<br>
        ${d.count} event${d.count !== 1 ? 's' : ''} · ${this.fmtBytes(d.weight)}
      </div>
    `
    this.edgeTooltipEl.style.display = 'block'
    const move = (e: MouseEvent) => {
      if (this.edgeTooltipEl) {
        this.edgeTooltipEl.style.left = (e.clientX + 14) + 'px'
        this.edgeTooltipEl.style.top  = (e.clientY - 10) + 'px'
      }
    }
    document.addEventListener('mousemove', move)
    ;(this.edgeTooltipEl as unknown as { _mover: (e:MouseEvent)=>void })._mover = move
  }

  private hideEdgeTooltip() {
    if (!this.edgeTooltipEl) return
    this.edgeTooltipEl.style.display = 'none'
    const mover = (this.edgeTooltipEl as unknown as { _mover?: (e:MouseEvent)=>void })._mover
    if (mover) document.removeEventListener('mousemove', mover)
  }

  // ── Public controls ───────────────────────────────────────────────────────

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
    const x1 = Math.min(...xs) - pad, x2 = Math.max(...xs) + pad
    const y1 = Math.min(...ys) - pad, y2 = Math.max(...ys) + pad
    const bw = x2 - x1, bh = y2 - y1
    if (bw <= 0 || bh <= 0) return

    const scale = Math.min(0.92, this.w / bw, this.h / bh)
    const tx = (this.w - bw * scale) / 2 - x1 * scale
    const ty = (this.h - bh * scale) / 2 - y1 * scale

    this.svg.transition().duration(700).call(
      this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
    )
  }

  zoomIn()    { this.svg.transition().duration(220).call(this.zoom.scaleBy, 1.5) }
  zoomOut()   { this.svg.transition().duration(220).call(this.zoom.scaleBy, 1 / 1.5) }
  resetZoom() {
    this.svg.transition().duration(400).call(
      this.zoom.transform, d3.zoomIdentity.translate(this.w / 2, this.h / 2).scale(1)
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

  // ── Visual helpers ────────────────────────────────────────────────────────

  private radius(d: NSystem): number {
    return 12 + Math.min(16, Math.log2((d.total_events || 1) + 1) * 2.5)
  }

  // Full-opacity type colors — readable on dark bg
  private typeColor(t: string): string {
    const m: Record<string, string> = {
      web_server:         '#4d99ff',
      database:           '#ff7733',
      cache:              '#ffcc00',
      load_balancer:      '#00ddff',
      worker:             '#bb55ff',
      queue:              '#ff55bb',
      monitoring:         '#44dd88',
      security:           '#ff3355',
      siem:               '#ff6688',
      external:           '#99aabb',
      endpoint:           '#77aaff',
      threat:             '#ff0033',
      threat_actor:       '#ff0033',
      storage:            '#55ffcc',
      firewall:           '#ff8855',
      regulator:          '#ffee55',
      ci_server:          '#66ccff',
      code_repository:    '#99ff66',
      artifact_registry:  '#ffaa44',
      cdn:                '#aaddff',
      victim_enterprise:  '#ff6699',
      c2_server:          '#ff1144',
      incident_responder: '#44ffaa',
      emr_system:         '#4488ff',
      lab_system:         '#ff9933',
      imaging_system:     '#66bbff',
      pharmacy_system:    '#cc44ff',
      patient_monitor:    '#44ffdd',
      monitoring_system:  '#44dd88',
      medical_device:     '#ffaa66',
      clinical_system:    '#55aaff',
      blood_bank:         '#ff4455',
      payer:              '#aaffaa',
      health_exchange:    '#77ccff',
      reception:          '#ffddaa',
      workstation:        '#88aacc',
      legitimate_business:'#66ff88',
      shell_company:      '#ff5522',
      bank_account:       '#4477ff',
      crypto_wallet:      '#ffaa00',
      individual:         '#00ff88',
      real_estate:        '#aa55ff',
      mixer:              '#ff2244',
    }
    return m[t] || '#7799bb'
  }

  private nodeStroke(d: SysDatum): string {
    if (this.highlightIds.has(d.id)) return '#00ddff'
    if (d.critical_count > 0) return '#ff2244'
    if (d.high_count > 0)     return '#ff6600'
    return this.typeColor(d.type)
  }

  // Short letter abbreviation — reliable on all platforms
  private typeLetter(t: string): string {
    const m: Record<string, string> = {
      web_server: 'W', database: 'DB', cache: 'C', load_balancer: 'LB',
      worker: 'WK', queue: 'Q', monitoring: 'M', security: 'SEC',
      siem: 'SI', external: 'EX', endpoint: 'EP', threat: '!',
      threat_actor: '!', storage: 'S', firewall: 'FW', regulator: 'R',
      ci_server: 'CI', code_repository: 'GIT', artifact_registry: 'AR',
      cdn: 'CDN', victim_enterprise: 'V', c2_server: 'C2',
      incident_responder: 'IR', emr_system: 'EMR', lab_system: 'LAB',
      imaging_system: 'IMG', pharmacy_system: 'PH', patient_monitor: 'PM',
      monitoring_system: 'MON', medical_device: 'MD', clinical_system: 'CS',
      blood_bank: 'BB', payer: 'PAY', health_exchange: 'HIE',
      reception: 'RX', workstation: 'PC', legitimate_business: 'BIZ',
      shell_company: 'SH', bank_account: 'BNK', crypto_wallet: 'BTC',
      individual: 'ID', real_estate: 'RE', mixer: 'MX',
    }
    return m[t] || t.slice(0, 2).toUpperCase()
  }

  // Edge colors — clearly differentiated from dark background
  private sevEdgeColor(s: string): string {
    const m: Record<string, string> = {
      low:      '#3a5a80',   // visible blue-grey (not the bg color!)
      medium:   '#ffaa00',   // amber
      high:     '#ff6600',   // orange
      critical: '#ff2244',   // red
    }
    return m[s] || '#3a5a80'
  }

  private fmtBytes(b: number): string {
    if (b > 1073741824) return (b / 1073741824).toFixed(1) + ' GB'
    if (b > 1048576)    return (b / 1048576).toFixed(1) + ' MB'
    if (b > 1024)       return (b / 1024).toFixed(0) + ' KB'
    return b + ' B'
  }
}
