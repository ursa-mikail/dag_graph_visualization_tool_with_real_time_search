import type { Node, Edge } from '../types';

export class Tooltip {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
  }

  showNode(node: Node, x: number, y: number) {
    const risk = node.risk_score;
    const riskColor = risk > 0.8 ? '#ff2244' : risk > 0.6 ? '#ff6600' : risk > 0.4 ? '#ffcc00' : '#44aa66';
    const meta = typeof node.metadata === 'string' ? JSON.parse(node.metadata as string) : (node.metadata || {});
    const keyMeta = Object.entries(meta).slice(0, 3);

    this.el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${node.color || '#4488ff'};flex-shrink:0;"></div>
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:#c9d8e8;">
          ${node.label}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;">
        <span style="color:#4a6a85;">Type</span><span style="color:#c9d8e8;">${node.type_name.replace(/_/g,' ')}</span>
        <span style="color:#4a6a85;">Country</span><span style="color:#c9d8e8;">${node.country || 'Unknown'}</span>
        <span style="color:#4a6a85;">Risk</span><span style="color:${riskColor};font-weight:600;">${(risk*100).toFixed(1)}%</span>
        ${node.edge_count ? `<span style="color:#4a6a85;">Links</span><span style="color:#c9d8e8;">${node.edge_count}</span>` : ''}
        ${keyMeta.map(([k, v]) => `
          <span style="color:#4a6a85;">${k}</span>
          <span style="color:#c9d8e8;">${String(v).slice(0, 30)}</span>
        `).join('')}
      </div>
    `;
    this.position(x, y);
    this.el.style.display = 'block';
  }

  showEdge(edge: Edge, x: number, y: number) {
    const meta = typeof edge.metadata === 'string' ? JSON.parse(edge.metadata as string) : (edge.metadata || {});
    const amount = (meta as Record<string, string>).amount_usd;
    const date = (meta as Record<string, string>).date;

    this.el.innerHTML = `
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:12px;color:#c9d8e8;margin-bottom:6px;">
        ${edge.label.replace(/_/g,' ')}
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;">
        ${amount ? `<span style="color:#4a6a85;">Amount</span><span style="color:#00e5ff;font-weight:600;">$${parseFloat(amount).toLocaleString()}</span>` : ''}
        ${date ? `<span style="color:#4a6a85;">Date</span><span style="color:#c9d8e8;">${date}</span>` : ''}
        <span style="color:#4a6a85;">Weight</span><span style="color:#c9d8e8;">${edge.weight.toFixed(0)}</span>
        ${(meta as Record<string, boolean>).flagged ? `<span style="color:#4a6a85;">Status</span><span style="color:#ff4444;font-weight:600;">⚠ FLAGGED</span>` : ''}
      </div>
    `;
    this.position(x, y);
    this.el.style.display = 'block';
  }

  hide() { this.el.style.display = 'none'; }

  private position(x: number, y: number) {
    const pad = 14;
    const elW = 260, elH = 120;
    let left = x + pad;
    let top = y - pad;
    if (left + elW > window.innerWidth) left = x - elW - pad;
    if (top + elH > window.innerHeight) top = y - elH - pad;
    this.el.style.left = left + 'px';
    this.el.style.top = top + 'px';
  }
}
