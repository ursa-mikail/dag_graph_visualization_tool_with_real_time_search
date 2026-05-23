import type { NEvent } from '../types'

const SEV_COLOR: Record<string,string> = {
  low:'#182030', medium:'#ffaa00', high:'#ff6600', critical:'#ff2244'
}

export class EventLog {
  private container: HTMLElement
  private events: NEvent[] = []
  private max = 200

  constructor(container: HTMLElement) {
    this.container = container
    this.render()
  }

  push(events: NEvent[]) {
    this.events = [...events, ...this.events].slice(0, this.max)
    this.render()
  }

  clear() { this.events = []; this.render() }

  private render() {
    const list = this.events
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <div style="padding:8px 12px;border-bottom:1px solid #182030;flex-shrink:0;
          display:flex;align-items:center;gap:6px;">
          <span style="font-family:'Syne',sans-serif;font-size:10px;font-weight:700;
            letter-spacing:.1em;text-transform:uppercase;color:#6888a8;">Event Log</span>
          ${list.length ? `<span style="font-size:9px;padding:1px 5px;border-radius:3px;
            background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;">
            ${list.length}</span>` : ''}
          <div style="flex:1"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#00d4ff;animation:pulse 2s ease infinite;"></div>
        </div>
        <div style="flex:1;overflow-y:auto;" id="log-inner">
          ${list.length === 0
            ? `<div style="display:flex;align-items:center;justify-content:center;
                height:100%;color:#384860;flex-direction:column;gap:8px;font-size:11px;">
                <div style="font-size:28px;opacity:.2;">≡</div>
                <div>No events in window</div>
              </div>`
            : list.map(e => this.row(e)).join('')
          }
        </div>
      </div>
    `
  }

  private row(e: NEvent): string {
    const color = SEV_COLOR[e.severity] || '#182030'
    const ts = new Date(e.event_time).toISOString().slice(11,19)
    const bytes = e.bytes_sent + e.bytes_recv
    const bytesStr = bytes > 1048576 ? `${(bytes/1048576).toFixed(1)}MB`
      : bytes > 1024 ? `${(bytes/1024).toFixed(0)}KB` : `${bytes}B`
    return `
      <div class="fade-in" style="padding:5px 12px;border-bottom:1px solid #0c111a;
        border-left:2px solid ${color};font-size:10px;line-height:1.5;">
        <div style="display:flex;justify-content:space-between;gap:6px;">
          <span style="color:#384860;flex-shrink:0;">${ts}</span>
          <span style="color:#c8d8ec;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${e.source_label || e.source} → ${e.target_label || e.target}
          </span>
          <span class="badge badge-${e.severity}" style="flex-shrink:0;">${e.severity}</span>
        </div>
        <div style="display:flex;gap:10px;margin-top:1px;color:#6888a8;">
          <span>${e.protocol}:${e.port}</span>
          <span>${e.event_type.replace(/_/g,' ')}</span>
          <span>${bytesStr}</span>
          <span>${e.latency_ms.toFixed(1)}ms</span>
          ${e.packet_loss > 0 ? `<span style="color:#ff6600;">${e.packet_loss}% loss</span>` : ''}
        </div>
      </div>
    `
  }
}
