import type { FilterValues, FilterState } from '../types'

export class FilterPanel {
  private container: HTMLElement
  private state: FilterState
  private values: FilterValues = { protocols:[], severities:[], event_types:[], system_types:[] }
  public onChange?: (f: FilterState) => void

  constructor(container: HTMLElement, initial: FilterState) {
    this.container = container
    this.state = initial
    this.render()
  }

  setValues(v: FilterValues) {
    this.values = v
    this.render()
  }

  getState(): FilterState { return this.state }

  private render() {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <div style="padding:10px 14px;border-bottom:1px solid #182030;flex-shrink:0;
          display:flex;align-items:center;gap:8px;">
          <span style="font-family:'Syne',sans-serif;font-size:10px;font-weight:700;
            letter-spacing:.12em;text-transform:uppercase;color:#6888a8;">Filters</span>
          <div style="flex:1"></div>
          <button id="reset-filters" class="btn" style="font-size:10px;padding:3px 8px;">Reset</button>
        </div>

        <div style="flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:14px;">

          <!-- Severity -->
          <div>
            <div style="font-size:9px;color:#384860;letter-spacing:.1em;margin-bottom:6px;">SEVERITY</div>
            <div id="sev-checks" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          <!-- Protocol -->
          <div>
            <div style="font-size:9px;color:#384860;letter-spacing:.1em;margin-bottom:6px;">PROTOCOL</div>
            <div id="proto-checks" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
          </div>

          <!-- System type -->
          <div>
            <div style="font-size:9px;color:#384860;letter-spacing:.1em;margin-bottom:6px;">SYSTEM TYPE</div>
            <div id="type-checks" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          <!-- Thresholds -->
          <div>
            <div style="font-size:9px;color:#384860;letter-spacing:.1em;margin-bottom:8px;">THRESHOLDS</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${this.thresholdRow('min-latency',     'Min latency (ms)',    this.state.minLatency,    0,    5000)}
              ${this.thresholdRow('max-latency',     'Max latency (ms)',    this.state.maxLatency,    0,    5000)}
              ${this.thresholdRow('min-bytes',       'Min bytes',           this.state.minBytes,      0,    10000000)}
              ${this.thresholdRow('min-pkt-loss',    'Min pkt loss %',      this.state.minPacketLoss, 0,    100)}
            </div>
          </div>

          <!-- Focus systems -->
          <div>
            <div style="font-size:9px;color:#384860;letter-spacing:.1em;margin-bottom:6px;">
              FOCUS SYSTEMS <span style="color:#384860;">(IDs, comma-sep)</span>
            </div>
            <input id="focus-ids" type="text" placeholder="srv-db-01, srv-web-01…"
              value="${[...this.state.focusSystemIds].join(', ')}"
              style="width:100%;padding:6px 10px;font-size:11px;">
          </div>

        </div>

        <!-- Apply -->
        <div style="padding:10px 14px;border-top:1px solid #182030;flex-shrink:0;">
          <button id="apply-filters" class="btn btn-accent" style="width:100%;padding:7px;">
            Apply Filters
          </button>
        </div>
      </div>
    `

    // Severity checkboxes
    const sevs = ['low','medium','high','critical']
    const sevColors: Record<string,string> = { low:'#44aa66', medium:'#ffaa00', high:'#ff6600', critical:'#ff2244' }
    const sevContainer = this.container.querySelector('#sev-checks')!
    sevs.forEach(s => {
      const label = document.createElement('label')
      label.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;'
      const chk = document.createElement('input')
      chk.type = 'checkbox'; chk.value = s
      chk.checked = this.state.severities.has(s)
      chk.style.accentColor = sevColors[s]
      label.appendChild(chk)
      const dot = document.createElement('span')
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${sevColors[s]};flex-shrink:0;`
      label.appendChild(dot)
      label.appendChild(document.createTextNode(s.charAt(0).toUpperCase() + s.slice(1)))
      sevContainer.appendChild(label)
    })

    // Protocol chips
    const protoContainer = this.container.querySelector('#proto-checks')!
    this.values.protocols.forEach(p => {
      const btn = document.createElement('button')
      btn.className = 'btn'
      btn.textContent = p
      btn.dataset.value = p
      btn.style.cssText = 'font-size:10px;padding:3px 8px;'
      if (this.state.protocols.has(p)) { btn.style.borderColor='#00d4ff'; btn.style.color='#00d4ff' }
      btn.addEventListener('click', () => {
        if (this.state.protocols.has(p)) { this.state.protocols.delete(p); btn.style.borderColor=''; btn.style.color='' }
        else { this.state.protocols.add(p); btn.style.borderColor='#00d4ff'; btn.style.color='#00d4ff' }
      })
      protoContainer.appendChild(btn)
    })

    // System type checkboxes
    const typeContainer = this.container.querySelector('#type-checks')!
    this.values.system_types.forEach(t => {
      const label = document.createElement('label')
      label.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;'
      const chk = document.createElement('input')
      chk.type = 'checkbox'; chk.value = t
      chk.checked = this.state.systemTypes.has(t)
      label.appendChild(chk)
      label.appendChild(document.createTextNode(t.replace(/_/g,' ')))
      typeContainer.appendChild(label)
    })

    // Wire up reset
    this.container.querySelector('#reset-filters')!.addEventListener('click', () => {
      this.state = this.blankState()
      this.render()
      this.onChange?.(this.state)
    })

    // Wire up apply
    this.container.querySelector('#apply-filters')!.addEventListener('click', () => {
      this.collectState()
      this.onChange?.(this.state)
    })

    // Threshold live-update labels
    this.container.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(sl => {
      const lbl = this.container.querySelector<HTMLElement>(`#lbl-${sl.id}`)
      sl.addEventListener('input', () => { if (lbl) lbl.textContent = sl.value })
    })
  }

  private thresholdRow(id: string, label: string, value: number, min: number, max: number): string {
    return `
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span style="font-size:10px;color:#6888a8;">${label}</span>
          <span id="lbl-${id}" style="font-size:10px;color:#00d4ff;">${value}</span>
        </div>
        <input id="${id}" type="range" min="${min}" max="${max}" value="${value}" step="${max > 1000 ? 1000 : 1}"
          style="width:100%;height:3px;accent-color:#00d4ff;">
      </div>
    `
  }

  private collectState() {
    // Severities
    this.state.severities.clear()
    this.container.querySelectorAll<HTMLInputElement>('#sev-checks input:checked')
      .forEach(c => this.state.severities.add(c.value))

    // System types
    this.state.systemTypes.clear()
    this.container.querySelectorAll<HTMLInputElement>('#type-checks input:checked')
      .forEach(c => this.state.systemTypes.add(c.value))

    // Thresholds
    const v = (id: string) => parseFloat((this.container.querySelector<HTMLInputElement>(`#${id}`)?.value) || '0')
    this.state.minLatency    = v('min-latency')
    this.state.maxLatency    = v('max-latency')
    this.state.minBytes      = v('min-bytes')
    this.state.minPacketLoss = v('min-pkt-loss')

    // Focus IDs
    this.state.focusSystemIds.clear()
    const raw = (this.container.querySelector<HTMLInputElement>('#focus-ids')?.value || '').trim()
    if (raw) raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(id => this.state.focusSystemIds.add(id))
  }

  private blankState(): FilterState {
    return {
      severities: new Set(), protocols: new Set(), eventTypes: new Set(),
      systemTypes: new Set(), minLatency: 0, maxLatency: 0, minBytes: 0,
      minPacketLoss: 0, focusSystemIds: new Set(),
    }
  }
}
