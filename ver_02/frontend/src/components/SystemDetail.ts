import type { NSystem, NEvent } from '../types'

export class SystemDetail {
  private container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    this.showEmpty()
  }

  showEmpty() {
    this.container.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;
        align-items:center;justify-content:center;color:#384860;
        text-align:center;padding:20px;gap:10px;">
        <div style="font-size:36px;opacity:.2;">◉</div>
        <div style="font-family:'Syne',sans-serif;font-size:12px;font-weight:600;letter-spacing:.05em;">
          Click a node to inspect
        </div>
        <div style="font-size:10px;line-height:1.7;max-width:160px;color:#283848;">
          View traffic stats, latency, packet loss, and live events for any system in the graph.
        </div>
      </div>`
  }

  show(sys: NSystem, recentEvents: NEvent[]) {
    const critColor = sys.critical_count > 0 ? '#ff2244' : sys.high_count > 0 ? '#ff6600' : '#44aa66'
    const latColor  = sys.avg_latency > 200 ? '#ff2244' : sys.avg_latency > 50 ? '#ffaa00' : '#44aa66'
    const lossColor = sys.avg_packet_loss > 5 ? '#ff2244' : sys.avg_packet_loss > 1 ? '#ffaa00' : '#44aa66'

    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;" class="fade-in">

        <!-- Header -->
        <div style="padding:12px 14px;border-bottom:1px solid #182030;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:10px;height:10px;border-radius:50%;
              background:${this.typeColor(sys.type)};flex-shrink:0;"></div>
            <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;
              color:#c8d8ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sys.label}</div>
          </div>
          <div style="font-size:10px;color:#384860;">
            ${sys.type.replace(/_/g,' ')} · ${sys.ip || 'no IP'} · ${sys.id}
          </div>
        </div>

        <!-- Stat grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;
          border-bottom:1px solid #182030;flex-shrink:0;">
          ${this.stat('EVENTS',    sys.total_events.toLocaleString(), '#00d4ff')}
          ${this.stat('OUT/IN',    `${sys.outbound}/${sys.inbound}`,  '#6888a8')}
          ${this.stat('BYTES',     this.fmtBytes(sys.total_bytes),    '#6888a8')}
          ${this.stat('AVG LAT',   sys.avg_latency.toFixed(1)+'ms',   latColor)}
          ${this.stat('MAX LAT',   sys.max_latency.toFixed(1)+'ms',   latColor)}
          ${this.stat('PKT LOSS',  sys.avg_packet_loss.toFixed(2)+'%',lossColor)}
          ${this.stat('CRITICAL',  String(sys.critical_count),        sys.critical_count>0 ? '#ff2244':'#384860')}
          ${this.stat('HIGH',      String(sys.high_count),            sys.high_count>0 ? '#ff6600':'#384860')}
          ${this.stat('STATUS',    sys.critical_count > 0 ? 'ALERT' : sys.high_count > 0 ? 'WARN' : 'OK', critColor)}
        </div>

        <!-- Recent events -->
        <div style="flex:1;overflow-y:auto;">
          <div style="padding:7px 12px;font-size:9px;color:#384860;
            letter-spacing:.08em;border-bottom:1px solid #0c111a;">
            RECENT EVENTS (${recentEvents.length})
          </div>
          ${recentEvents.length === 0
            ? `<div style="padding:14px 12px;color:#384860;font-size:11px;">No events in window</div>`
            : recentEvents.slice(0, 30).map(e => this.eventRow(e, sys.id)).join('')
          }
        </div>
      </div>`
  }

  private stat(label: string, value: string, color: string): string {
    return `
      <div style="padding:8px 10px;border-right:1px solid #182030;border-bottom:1px solid #182030;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:${color};">${value}</div>
        <div style="font-size:8px;color:#384860;letter-spacing:.07em;margin-top:2px;">${label}</div>
      </div>`
  }

  private eventRow(e: NEvent, sysId: string): string {
    const isOut = e.source === sysId
    const peer = isOut ? (e.target_label || e.target) : (e.source_label || e.source)
    const arrow = isOut ? '→' : '←'
    const color = ({ low:'#182030',medium:'#ffaa00',high:'#ff6600',critical:'#ff2244' } as Record<string,string>)[e.severity]
    const ts = new Date(e.event_time).toISOString().slice(11,19)
    return `
      <div style="padding:5px 12px;border-bottom:1px solid #0c111a;
        border-left:2px solid ${color};font-size:10px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="color:#384860;flex-shrink:0;">${ts}</span>
          <span style="color:#00d4ff;flex-shrink:0;">${arrow}</span>
          <span style="color:#c8d8ec;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${peer}</span>
          <span style="color:#6888a8;flex-shrink:0;">${e.protocol}</span>
        </div>
        <div style="color:#6888a8;margin-top:1px;">${e.event_type.replace(/_/g,' ')} · ${e.latency_ms.toFixed(1)}ms</div>
      </div>`
  }

  private typeColor(t: string): string {
    const m: Record<string,string> = {
      web_server:'#4488ff', database:'#ff6600', cache:'#ffaa00',
      load_balancer:'#00d4ff', worker:'#aa44ff', queue:'#ff44aa',
      monitoring:'#44aa66', security:'#ff2244', siem:'#ff4466',
      external:'#888888', endpoint:'#66aaff', threat:'#ff0044',
      storage:'#44ffaa', firewall:'#ff6644',
    }
    return m[t] || '#5588aa'
  }

  private fmtBytes(b: number): string {
    if (b > 1073741824) return `${(b/1073741824).toFixed(1)}GB`
    if (b > 1048576)    return `${(b/1048576).toFixed(1)}MB`
    if (b > 1024)       return `${(b/1024).toFixed(0)}KB`
    return `${b}B`
  }
}
