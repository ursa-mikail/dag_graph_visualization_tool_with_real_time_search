import { api } from '../lib/api';
import type { Node, Alert } from '../types';

export class NodeDetail {
  private container: HTMLElement;
  private currentNode: Node | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.showEmpty();
  }

  private showEmpty() {
    this.container.innerHTML = `
      <div style="
        height: 100%; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        color: #2a3a4a; text-align: center; padding: 24px; gap: 12px;
      ">
        <div style="font-size:40px;opacity:0.3;">◉</div>
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.05em;">
          Click a node to inspect
        </div>
        <div style="font-size:11px;line-height:1.6;max-width:180px;color:#1e2a38;">
          Select any entity in the graph to view its connections, risk score, and metadata.
        </div>
        <div style="margin-top:8px;font-size:10px;color:#1e3a28;letter-spacing:0.08em;">
          TIP: Double-click to expand neighborhood
        </div>
      </div>
    `;
  }

  async show(node: Node) {
    this.currentNode = node;
    const risk = node.risk_score;
    const riskColor = risk > 0.8 ? '#ff2244' : risk > 0.6 ? '#ff6600' : risk > 0.4 ? '#ffcc00' : '#44aa66';
    const riskLabel = risk > 0.8 ? 'CRITICAL' : risk > 0.6 ? 'HIGH' : risk > 0.4 ? 'MEDIUM' : 'LOW';

    const meta = typeof node.metadata === 'string'
      ? JSON.parse(node.metadata as string)
      : (node.metadata || {});

    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;" class="fade-in">
        <!-- Node header -->
        <div style="padding:14px 16px;border-bottom:1px solid #1e2a38;flex-shrink:0;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="
              width:36px;height:36px;border-radius:50%;border:2px solid ${riskColor};
              display:flex;align-items:center;justify-content:center;font-size:18px;
              background:${riskColor}18;flex-shrink:0;
            ">${this.icon(node.type_name)}</div>
            <div style="min-width:0;flex:1;">
              <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;
                color:#c9d8e8;line-height:1.3;word-break:break-word;">${node.label}</div>
              <div style="font-size:10px;color:#4a6a85;margin-top:3px;">
                ${node.type_name.replace(/_/g,' ')} · ${node.country || 'Unknown'}
              </div>
            </div>
          </div>

          <!-- Risk bar -->
          <div style="margin-top:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:10px;color:#4a6a85;letter-spacing:0.05em;">RISK SCORE</span>
              <span style="font-size:10px;font-weight:700;color:${riskColor};">${riskLabel} ${(risk*100).toFixed(1)}%</span>
            </div>
            <div style="height:4px;background:#1e2a38;border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${risk*100}%;background:${riskColor};
                border-radius:2px;transition:width 0.6s ease;
                box-shadow:0 0 8px ${riskColor}66;"></div>
            </div>
          </div>
        </div>

        <!-- Stats row -->
        <div style="display:flex;border-bottom:1px solid #1e2a38;flex-shrink:0;">
          ${[
            { label: 'CONNECTIONS', value: node.edge_count || 0 },
            { label: 'VOLUME', value: node.volume ? '$' + this.fmtNum(node.volume) : '—' },
          ].map(s => `
            <div style="flex:1;padding:10px 14px;text-align:center;border-right:1px solid #1e2a38;">
              <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#c9d8e8;">${s.value}</div>
              <div style="font-size:9px;color:#4a6a85;letter-spacing:0.08em;margin-top:2px;">${s.label}</div>
            </div>
          `).join('')}
          <div style="flex:1;padding:10px 14px;text-align:center;">
            <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:${riskColor};">${(risk*100).toFixed(0)}</div>
            <div style="font-size:9px;color:#4a6a85;letter-spacing:0.08em;margin-top:2px;">RISK %</div>
          </div>
        </div>

        <!-- Scroll area -->
        <div style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:12px;">
          <!-- Metadata -->
          <div>
            <div style="font-size:9px;color:#4a6a85;letter-spacing:0.1em;margin-bottom:8px;font-weight:600;">
              METADATA
            </div>
            ${Object.entries(meta).map(([k, v]) => `
              <div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #0d1117;font-size:11px;">
                <span style="color:#4a6a85;min-width:100px;flex-shrink:0;">${k}</span>
                <span style="color:#c9d8e8;word-break:break-all;">${
                  typeof v === 'boolean' ? (v ? '<span style="color:#44aa66">true</span>' : '<span style="color:#ff4444">false</span>')
                  : String(v)
                }</span>
              </div>
            `).join('') || '<div style="color:#2a3a4a;font-size:11px;">No metadata</div>'}
          </div>

          <!-- Alerts section -->
          <div id="node-alerts">
            <div style="font-size:9px;color:#4a6a85;letter-spacing:0.1em;margin-bottom:8px;font-weight:600;">
              ACTIVE ALERTS
            </div>
            <div class="loader" style="width:14px;height:14px;"></div>
          </div>

          <!-- Created at -->
          <div style="font-size:10px;color:#2a3a4a;padding-top:4px;">
            Created: ${new Date(node.created_at).toLocaleString()}
          </div>
        </div>

        <!-- Actions -->
        <div style="padding:10px 16px;border-top:1px solid #1e2a38;display:flex;gap:8px;flex-shrink:0;">
          <button id="expand-btn" class="btn btn-accent" style="flex:1;font-size:11px;padding:7px;">
            ⊕ Expand
          </button>
          <button id="copy-id-btn" class="btn" style="font-size:11px;padding:7px 10px;" title="Copy ID">
            ⎘ ID
          </button>
        </div>
      </div>
    `;

    // Load alerts for this node
    this.loadNodeAlerts(node.id);

    this.container.querySelector('#copy-id-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(node.id);
    });
  }

  private async loadNodeAlerts(nodeId: string) {
    const el = this.container.querySelector('#node-alerts');
    if (!el) return;
    try {
      const alerts = await api.getAlerts(20);
      const nodeAlerts = alerts.filter((a: Alert) => a.node_id === nodeId);
      if (nodeAlerts.length === 0) {
        el.querySelector('.loader')?.remove();
        el.innerHTML += `<div style="font-size:11px;color:#2a3a4a;">No active alerts</div>`;
        return;
      }
      el.querySelector('.loader')?.remove();
      el.innerHTML += nodeAlerts.map(a => `
        <div style="padding:7px 10px;background:#0d1117;border-radius:4px;
          border-left:3px solid ${this.severityColor(a.severity)};margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:10px;font-weight:600;color:${this.severityColor(a.severity)};">
              ${a.rule_name}
            </span>
            <span class="badge badge-${a.severity}" style="font-size:9px;">${a.severity}</span>
          </div>
          <div style="font-size:10px;color:#7a9ab5;line-height:1.4;">${a.description}</div>
        </div>
      `).join('');
    } catch {
      el.innerHTML = `<div style="font-size:11px;color:#2a3a4a;">Could not load alerts</div>`;
    }
  }

  get onExpand(): (() => void) | undefined { return undefined; }

  getExpandButton(): HTMLButtonElement | null {
    return this.container.querySelector<HTMLButtonElement>('#expand-btn');
  }

  getCurrentNode() { return this.currentNode; }

  private icon(type: string): string {
    const m: Record<string, string> = {
      shell_company: '🏢', bank_account: '🏦', crypto_wallet: '₿',
      individual: '👤', real_estate: '🏠', offshore_fund: '💰',
      server: '🖥️', endpoint: '💻', router: '📡',
    };
    return m[type] || '◉';
  }

  private severityColor(s: string): string {
    return { critical: '#ff2244', high: '#ff6600', medium: '#ffcc00', low: '#44aa66' }[s] || '#7a9ab5';
  }

  private fmtNum(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  }
}
