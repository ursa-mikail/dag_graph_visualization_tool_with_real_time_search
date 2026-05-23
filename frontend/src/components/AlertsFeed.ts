import type { Alert } from '../types';

export class AlertsFeed {
  private container: HTMLElement;
  private alerts: Alert[] = [];
  private maxAlerts = 50;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  addAlert(alert: Alert) {
    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }
    this.render();
  }

  setAlerts(alerts: Alert[]) {
    this.alerts = alerts.slice(0, this.maxAlerts);
    this.render();
  }

  private render() {
    const empty = this.alerts.length === 0;
    this.container.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;">
        <div style="padding:10px 14px;border-bottom:1px solid #1e2a38;flex-shrink:0;display:flex;align-items:center;gap:8px;">
          <span style="font-family:'Syne',sans-serif;font-size:10px;font-weight:700;
            letter-spacing:0.12em;text-transform:uppercase;color:#7a9ab5;">Alerts</span>
          ${this.alerts.length > 0 ? `
            <span style="padding:2px 6px;background:rgba(255,34,68,0.15);border:1px solid rgba(255,34,68,0.3);
              border-radius:3px;font-size:9px;color:#ff2244;font-weight:600;">${this.alerts.length}</span>
          ` : ''}
          <div style="flex:1;"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#ff2244;animation:pulse 1.5s ease infinite;"></div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:8px;">
          ${empty ? `
            <div style="display:flex;align-items:center;justify-content:center;
              height:100%;color:#2a3a4a;font-size:11px;flex-direction:column;gap:8px;">
              <div style="font-size:24px;opacity:0.3;">🛡</div>
              <div>No active alerts</div>
            </div>
          ` : this.alerts.map(a => this.renderAlert(a)).join('')}
        </div>
      </div>
    `;
  }

  private renderAlert(a: Alert): string {
    const color = { critical: '#ff2244', high: '#ff6600', medium: '#ffcc00', low: '#44aa66' }[a.severity] || '#7a9ab5';
    const time = this.formatTime(a.created_at);
    return `
      <div class="fade-in" style="
        padding: 8px 10px; margin-bottom: 4px; border-radius: 4px;
        background: #0d1117; border-left: 3px solid ${color};
        border: 1px solid #1e2a38; border-left: 3px solid ${color};
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
          <span style="font-size:10px;font-weight:600;color:${color};letter-spacing:0.04em;">${a.rule_name}</span>
          <span style="font-size:9px;color:#4a6a85;">${time}</span>
        </div>
        <div style="font-size:10px;color:#c9d8e8;margin-bottom:3px;font-weight:500;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.node_label || 'Unknown entity'}</div>
        <div style="font-size:10px;color:#7a9ab5;line-height:1.4;">${a.description}</div>
      </div>
    `;
  }

  private formatTime(ts: string): string {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = (now.getTime() - d.getTime()) / 1000;
      if (diff < 60) return `${Math.round(diff)}s ago`;
      if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
      return d.toLocaleTimeString();
    } catch { return ''; }
  }
}
