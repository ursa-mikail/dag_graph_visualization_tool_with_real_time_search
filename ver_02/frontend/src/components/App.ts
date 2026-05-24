import '../styles/global.css'
import { GraphCanvas } from './GraphCanvas'
import { PlaybackController } from './PlaybackController'
import { FilterPanel } from './FilterPanel'
import { EventLog } from './EventLog'
import { SystemDetail } from './SystemDetail'
import { api } from '../lib/api'
import { toast } from '../lib/toast'
import type { NSystem, NEvent, FilterState, TimeRange, WSMessage } from '../types'

export class App {
  private root: HTMLElement
  private canvas!: GraphCanvas
  private playback!: PlaybackController
  private filterPanel!: FilterPanel
  private eventLog!: EventLog
  private sysDetail!: SystemDetail

  private timeRange: TimeRange | null = null
  private filter: FilterState = this.blankFilter()
  private allEvents: NEvent[] = []        // events in current playback window
  private ws: WebSocket | null = null
  private selectedSysId: string | null = null
  private noData = true

  constructor(root: HTMLElement) { this.root = root }

  async init() {
    this.buildLayout()
    this.connectWS()
    await this.checkExistingData()
  }

  private async checkExistingData() {
    try {
      const h = await api.health()
      if (h.events > 0) {
        this.noData = false
        await this.loadData()
      }
    } catch { /* backend not ready yet */ }
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private buildLayout() {
    this.root.style.cssText = 'display:flex;flex-direction:column;height:100vh;overflow:hidden;'
    this.root.innerHTML = `
      <!-- Top bar -->
      <div id="topbar" style="
        display:flex;align-items:center;gap:10px;padding:0 14px;
        height:50px;flex-shrink:0;
        background:rgba(7,9,13,.97);border-bottom:1px solid #182030;
        position:relative;z-index:100;">

        <!-- Logo -->
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="4"  r="2.5" fill="#00d4ff"/>
            <circle cx="3"  cy="18" r="2.5" fill="#00ff88"/>
            <circle cx="19" cy="18" r="2.5" fill="#ff2244"/>
            <circle cx="11" cy="11" r="2"   fill="#ffaa00"/>
            <line x1="11" y1="6.5"  x2="4"  y2="16" stroke="#182030" stroke-width="1.5"/>
            <line x1="11" y1="6.5"  x2="18" y2="16" stroke="#182030" stroke-width="1.5"/>
            <line x1="5"  y1="18"   x2="17" y2="18" stroke="#182030" stroke-width="1.5"/>
            <line x1="11" y1="9"    x2="11" y2="13" stroke="#182030" stroke-width="1.5"/>
          </svg>
          <span style="font-family:'Syne',sans-serif;font-size:15px;font-weight:800;
            letter-spacing:-.02em;color:#c8d8ec;">
            Net<span style="color:#00d4ff;">Flow</span> <span style="font-weight:400;font-size:11px;color:#384860;">DAG</span>
          </span>
        </div>

        <!-- Search -->
        <div style="position:relative;width:280px;">
          <input id="search-input" type="text" placeholder="⌕  Search systems…"
            style="width:100%;padding:7px 32px 7px 12px;font-size:12px;border-radius:6px;">
          <button id="search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
            background:none;border:none;color:#384860;font-size:13px;opacity:0;transition:opacity .15s;
            pointer-events:none;">✕</button>
          <div id="search-drop" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
            background:rgba(7,9,13,.98);border:1px solid #182030;border-radius:6px;z-index:200;
            box-shadow:0 8px 32px rgba(0,0,0,.7);overflow:hidden;"></div>
        </div>

        <!-- Buttons -->
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="btn-labels" class="btn" style="font-size:11px;">⊞ Labels</button>
          <!-- Zoom cluster -->
          <div style="display:flex;gap:1px;background:#182030;border:1px solid #182030;border-radius:6px;overflow:hidden;">
            <button id="btn-zoom-in"    class="btn" style="font-size:14px;padding:4px 11px;border-radius:0;border:none;" title="Zoom in (or scroll up)">+</button>
            <button id="btn-zoom-reset" class="btn" style="font-size:10px;padding:4px 9px;border-radius:0;border:none;border-left:1px solid #182030;border-right:1px solid #182030;" title="Reset zoom">1:1</button>
            <button id="btn-zoom-out"   class="btn" style="font-size:14px;padding:4px 11px;border-radius:0;border:none;" title="Zoom out (or scroll down)">−</button>
          </div>
          <button id="btn-fit" class="btn" style="font-size:11px;">⊡ Fit all</button>
        </div>

        <div style="flex:1;"></div>

        <!-- Stats -->
        <div id="hdr-stats" style="display:flex;gap:16px;font-size:11px;"></div>

        <!-- Upload CSV -->
        <label class="btn btn-green" style="font-size:11px;padding:5px 12px;cursor:pointer;flex-shrink:0;">
          ↑ Load CSV
          <input id="csv-input" type="file" accept=".csv" style="display:none;">
        </label>

        <!-- Export -->
        <button id="btn-export" class="btn" style="font-size:11px;">↓ Export CSV</button>

        <!-- Clear -->
        <button id="btn-clear" class="btn btn-danger" style="font-size:11px;">✕ Clear</button>

        <!-- WS dot -->
        <div id="ws-dot" style="width:7px;height:7px;border-radius:50%;
          background:#384860;flex-shrink:0;" title="WebSocket"></div>
      </div>

      <!-- Body -->
      <div style="flex:1;display:grid;
        grid-template-columns:220px 1fr 240px;
        grid-template-rows:1fr;
        overflow:hidden;">

        <!-- Left: Filters -->
        <div id="filter-mount" style="border-right:1px solid #182030;overflow:hidden;
          display:flex;flex-direction:column;"></div>

        <!-- Center: Graph + timeline -->
        <div style="display:flex;flex-direction:column;overflow:hidden;position:relative;">

          <!-- Upload prompt (shown when no data) -->
          <div id="upload-prompt" style="
            position:absolute;inset:0;z-index:10;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:18px;background:rgba(7,9,13,.92);backdrop-filter:blur(4px);">
            <div style="font-size:48px;opacity:.3;">📡</div>
            <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#c8d8ec;">
              Load a network events CSV
            </div>
            <div style="font-size:12px;color:#6888a8;text-align:center;max-width:380px;line-height:1.7;">
              Upload a CSV with columns:<br>
              <code style="color:#00d4ff;font-size:11px;">timestamp, source_id, source_label, source_type,
              source_ip, target_id, target_label, target_type, target_ip,
              protocol, bytes_sent, bytes_recv, latency_ms, packet_loss_pct,
              port, severity, event_type, flag, metadata</code>
            </div>
            <label class="btn btn-accent" style="padding:10px 28px;font-size:13px;cursor:pointer;">
              ↑ Choose CSV file
              <input id="csv-input-2" type="file" accept=".csv" style="display:none;">
            </label>
            <div style="font-size:11px;color:#384860;">
              A sample CSV is included: <code style="color:#6888a8;">sample_network_events.csv</code>
            </div>
          </div>

          <!-- Canvas -->
          <div id="canvas-mount" style="flex:1;overflow:hidden;background:
            radial-gradient(ellipse at 25% 35%, rgba(0,212,255,.025) 0%, transparent 55%),
            radial-gradient(ellipse at 75% 70%, rgba(0,255,136,.015) 0%, transparent 50%),
            #07090d;"></div>

          <!-- Playback timeline -->
          <div id="playback-mount" style="flex-shrink:0;"></div>
        </div>

        <!-- Right: Detail + Event log -->
        <div style="border-left:1px solid #182030;display:flex;flex-direction:column;overflow:hidden;">
          <div id="detail-mount" style="flex:1;overflow:hidden;border-bottom:1px solid #182030;min-height:0;"></div>
          <div id="log-mount"    style="height:280px;overflow:hidden;flex-shrink:0;"></div>
        </div>
      </div>
    `

    // ── Graph canvas
    this.canvas = new GraphCanvas(this.root.querySelector<HTMLElement>('#canvas-mount')!)
    this.canvas.on('node-click',   d => this.onNodeClick(d as NSystem))
    this.canvas.on('node-hover',   d => { /* tooltip handled in canvas */ })
    this.canvas.on('bg-click',     () => { this.canvas.clearHighlight(); this.sysDetail.showEmpty() })

    // ── Playback
    this.playback = new PlaybackController(
      this.root.querySelector<HTMLElement>('#playback-mount')!,
      {
        onTick: ms => this.onPlaybackTick(ms),
        onEnd:  () => toast('Playback complete', 'info', 2000),
      }
    )

    // ── Filter panel
    const blankF = this.blankFilter()
    this.filterPanel = new FilterPanel(
      this.root.querySelector<HTMLElement>('#filter-mount')!, blankF
    )
    this.filterPanel.onChange = f => { this.filter = f; this.reloadSnapshot() }

    // Load filter dropdown values
    api.getFilterValues().then(v => this.filterPanel.setValues(v)).catch(() => {})

    // ── Event log + system detail
    this.eventLog  = new EventLog(this.root.querySelector<HTMLElement>('#log-mount')!)
    this.sysDetail = new SystemDetail(this.root.querySelector<HTMLElement>('#detail-mount')!)

    // ── Top bar controls
    this.wireTopBar()
    this.wireSearch()
  }

  private wireTopBar() {
    const csvInput  = this.root.querySelector<HTMLInputElement>('#csv-input')!
    const csvInput2 = this.root.querySelector<HTMLInputElement>('#csv-input-2')!

    const handleFile = async (f: File) => {
      toast(`Importing ${f.name}…`, 'info', 2000)
      try {
        const res = await api.importCSV(f)
        const errNote = res.errors?.length ? ` (${res.errors.length} row errors)` : ''
        toast(`✓ ${res.events} events · ${res.systems} systems${errNote}`, 'success', 5000)
        if (res.errors?.length) {
          console.warn('Import row errors:', res.errors.slice(0, 10))
        }
        this.noData = false
        this.hideUploadPrompt()
        await this.loadData()
      } catch (e) {
        toast('Import failed: ' + (e as Error).message, 'critical', 6000)
      }
    }

    csvInput.addEventListener('change',  () => { if (csvInput.files?.[0])  handleFile(csvInput.files[0]);  csvInput.value=''  })
    csvInput2.addEventListener('change', () => { if (csvInput2.files?.[0]) handleFile(csvInput2.files[0]); csvInput2.value='' })

    this.root.querySelector('#btn-export')!.addEventListener('click', () => {
      api.exportCSV(this.filter)
      toast('Exporting…', 'info', 1500)
    })

    this.root.querySelector('#btn-clear')!.addEventListener('click', async () => {
      if (!confirm('Clear all loaded data?')) return
      await api.clearData()
      this.noData = true
      this.allEvents = []
      this.timeRange = null
      this.canvas.loadSnapshot([], [])
      this.eventLog.clear()
      this.sysDetail.showEmpty()
      this.showUploadPrompt()
      toast('Data cleared', 'info')
    })

    this.root.querySelector('#btn-labels')!.addEventListener('click', () => this.canvas.toggleLabels())
    this.root.querySelector('#btn-fit')!.addEventListener('click',    () => this.canvas.fitView())
    this.root.querySelector('#btn-zoom-in')!.addEventListener('click',    () => this.canvas.zoomIn())
    this.root.querySelector('#btn-zoom-out')!.addEventListener('click',   () => this.canvas.zoomOut())
    this.root.querySelector('#btn-zoom-reset')!.addEventListener('click', () => this.canvas.resetZoom())
  }

  private wireSearch() {
    const input   = this.root.querySelector<HTMLInputElement>('#search-input')!
    const clearBtn = this.root.querySelector<HTMLButtonElement>('#search-clear')!
    const drop    = this.root.querySelector<HTMLDivElement>('#search-drop')!
    let timer: ReturnType<typeof setTimeout>

    const showClear = (v: boolean) => {
      clearBtn.style.opacity = v ? '1' : '0'
      clearBtn.style.pointerEvents = v ? 'auto' : 'none'
    }

    input.addEventListener('input', () => {
      showClear(input.value.length > 0)
      clearTimeout(timer)
      if (!input.value.trim()) { drop.style.display = 'none'; return }
      timer = setTimeout(async () => {
        try {
          const results = await api.search(input.value.trim())
          drop.innerHTML = results.length === 0
            ? `<div style="padding:10px 12px;color:#384860;font-size:11px;">No results</div>`
            : results.map(r => `
                <div class="search-row" data-id="${r.id}" style="
                  padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
                  border-bottom:1px solid #0c111a;font-size:11px;transition:background .1s;">
                  <span style="color:#00d4ff;">${this.typeIcon(r.type)}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="color:#c8d8ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.label}</div>
                    <div style="color:#384860;font-size:10px;">${r.type.replace(/_/g,' ')} · ${r.ip}</div>
                  </div>
                </div>`).join('')
          drop.style.display = 'block'
          drop.querySelectorAll('.search-row').forEach(el => {
            el.addEventListener('mouseover', () => { (el as HTMLElement).style.background = 'rgba(0,212,255,.05)' })
            el.addEventListener('mouseout',  () => { (el as HTMLElement).style.background = '' })
            el.addEventListener('mousedown', (e) => {
              e.preventDefault()
              const id = (el as HTMLElement).dataset.id!
              this.focusSystem(id)
              input.value = (el as HTMLElement).querySelector('div')?.textContent?.trim() || ''
              drop.style.display = 'none'
            })
          })
        } catch { /* ignore */ }
      }, 180)
    })

    input.addEventListener('blur',  () => setTimeout(() => { drop.style.display = 'none' }, 150))
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; showClear(false); drop.style.display='none'; this.canvas.clearHighlight() }
    })
    clearBtn.addEventListener('mousedown', e => {
      e.preventDefault()
      input.value = ''; showClear(false); drop.style.display='none'; this.canvas.clearHighlight()
    })
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  private async loadData() {
    try {
      this.timeRange = await api.getTimeRange()
      if (!this.timeRange?.min) { this.showUploadPrompt(); return }

      const minMs = new Date(this.timeRange.min).getTime()
      const maxMs = new Date(this.timeRange.max).getTime()
      this.playback.setRange(minMs, maxMs)

      // Load filter dropdown values
      api.getFilterValues().then(v => this.filterPanel.setValues(v)).catch(() => {})

      // Load initial snapshot (full dataset)
      await this.reloadSnapshot()

      // Update header stats
      this.updateStats()

      // Fit graph after render
      setTimeout(() => this.canvas.fitView(), 800)

      toast(`Ready — ${this.timeRange.count.toLocaleString()} events loaded. Press ▶ to play.`, 'success', 4000)
    } catch (e) {
      toast('Failed to load data: ' + (e as Error).message, 'critical')
    }
  }

  private async reloadSnapshot() {
    if (!this.timeRange) return
    try {
      const maxMs = this.playback.isPlaying ? this.playback.current : new Date(this.timeRange.max).getTime()
      const snap  = await api.getSnapshot(maxMs, this.filter)
      this.canvas.loadSnapshot(snap.systems, snap.events)
      this.allEvents = snap.events
      this.eventLog.push(snap.events.slice(-50))
      this.updateStats(snap.systems.length, snap.events.length)
    } catch { /* ignore during rapid playback */ }
  }

  // ── Playback tick ─────────────────────────────────────────────────────────

  private lastTickMs = 0
  private tickThrottle = 0

  private async onPlaybackTick(currentMs: number) {
    // Throttle API calls to at most every 500ms
    const now = Date.now()
    if (now - this.tickThrottle < 500) return
    this.tickThrottle = now

    const windowMs = this.playback.windowSize
    const fromMs   = currentMs - windowMs
    const toMs     = currentMs

    try {
      // Fetch events in the sliding window
      const events = await api.getEvents(fromMs, toMs, this.filter)
      this.allEvents = events
      this.eventLog.push(events)

      // Fire particle bursts for new events since last tick
      const newEvents = events.filter(e => new Date(e.event_time).getTime() > this.lastTickMs)
      if (newEvents.length > 0) this.canvas.fireParticles(newEvents)

      // Update graph: get snapshot up to current time
      const snap = await api.getSnapshot(toMs, this.filter)
      this.canvas.loadSnapshot(snap.systems, snap.events)

      // Update selected system detail if visible
      if (this.selectedSysId) {
        const sys = snap.systems.find(s => s.id === this.selectedSysId)
        if (sys) {
          const sysEvents = events.filter(e => e.source === this.selectedSysId || e.target === this.selectedSysId)
          this.sysDetail.show(sys, sysEvents)
        }
      }

      this.updateStats(snap.systems.length, snap.events.length)
    } catch { /* ignore */ }

    this.lastTickMs = currentMs
  }

  // ── Node interaction ──────────────────────────────────────────────────────

  private onNodeClick(sys: NSystem) {
    this.selectedSysId = sys.id
    this.canvas.highlight([sys.id])
    const sysEvents = this.allEvents.filter(e => e.source === sys.id || e.target === sys.id)
    this.sysDetail.show(sys, sysEvents)
  }

  private focusSystem(id: string) {
    this.canvas.highlight([id])
    this.filter.focusSystemIds = new Set([id])
    const sys = [...(this.canvas as unknown as { sysMap: Map<string, NSystem> }).sysMap?.values() || []]
      .find((s: NSystem) => s.id === id)
    if (sys) {
      this.selectedSysId = id
      const sysEvents = this.allEvents.filter(e => e.source === id || e.target === id)
      this.sysDetail.show(sys, sysEvents)
    }
    toast(`Focused on: ${id}`, 'info', 1500)
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url   = `${proto}//${location.host}/ws`
    const dot   = this.root.querySelector<HTMLElement>('#ws-dot')!

    const connect = () => {
      this.ws = new WebSocket(url)
      this.ws.onopen    = () => { dot.style.background = '#00ff88'; dot.style.boxShadow = '0 0 6px #00ff8866' }
      this.ws.onclose   = () => { dot.style.background = '#384860'; dot.style.boxShadow = 'none'; setTimeout(connect, 3000) }
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WSMessage
          if (msg.type === 'data_loaded') {
            this.noData = false
            this.hideUploadPrompt()
            this.loadData()
          } else if (msg.type === 'data_cleared') {
            this.canvas.loadSnapshot([], [])
            this.eventLog.clear()
          }
        } catch { /* ignore */ }
      }
    }
    connect()
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  private updateStats(nodes?: number, edges?: number) {
    const el = this.root.querySelector<HTMLElement>('#hdr-stats')!
    const n = nodes ?? this.canvas.getNodeCount()
    const e = edges ?? this.canvas.getEdgeCount()
    el.innerHTML = [
      { label: 'systems', value: n, color: '#00d4ff' },
      { label: 'flows',   value: e, color: '#00ff88' },
    ].map(s => `
      <div style="text-align:center;">
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;
          color:${s.color};line-height:1;">${s.value.toLocaleString()}</div>
        <div style="font-size:9px;color:#384860;letter-spacing:.06em;text-transform:uppercase;">${s.label}</div>
      </div>`).join('')
  }

  private showUploadPrompt() {
    const el = this.root.querySelector<HTMLElement>('#upload-prompt')
    if (el) el.style.display = 'flex'
  }

  private hideUploadPrompt() {
    const el = this.root.querySelector<HTMLElement>('#upload-prompt')
    if (el) el.style.display = 'none'
  }

  private blankFilter(): FilterState {
    return {
      severities: new Set(), protocols: new Set(), eventTypes: new Set(),
      systemTypes: new Set(), minLatency: 0, maxLatency: 0,
      minBytes: 0, minPacketLoss: 0, focusSystemIds: new Set(),
    }
  }

  private typeIcon(t: string): string {
    const m: Record<string,string> = {
      web_server:'◈', database:'◉', cache:'⬡', load_balancer:'⊕',
      worker:'▶', queue:'≡', monitoring:'◎', security:'⊛', threat:'⚠',
    }
    return m[t] || '●'
  }
}
