import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { SchemaTable } from '../types';

export class SchemaPanel {
  private container: HTMLElement;
  private currentTable = 'nodes';
  private currentPage = 1;
  private pageSize = 15;
  private data: SchemaTable | null = null;
  private tables: string[] = [];
  private importType: 'nodes' | 'edges' = 'nodes';

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private async build() {
    this.tables = await api.getTables().catch(() => ['nodes', 'edges', 'events', 'alerts']);
    this.render();
    await this.loadData();
  }

  private render() {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;gap:0;">
        <!-- Header -->
        <div style="
          padding: 12px 16px; border-bottom: 1px solid #1e2a38;
          display: flex; align-items: center; gap: 10px; flex-shrink:0;
        ">
          <span style="font-family:'Syne',sans-serif;font-size:11px;font-weight:700;
            letter-spacing:0.12em;text-transform:uppercase;color:#7a9ab5;">
            DB Explorer
          </span>
          <div style="flex:1;"></div>
          <select id="table-select" style="font-size:11px;padding:5px 8px;background:#0d1117;
            border:1px solid #1e2a38;color:#c9d8e8;border-radius:4px;cursor:pointer;">
            ${this.tables.map(t => `<option value="${t}" ${t === this.currentTable ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>

        <!-- Schema columns -->
        <div id="schema-cols" style="padding:10px 16px;border-bottom:1px solid #1e2a38;flex-shrink:0;"></div>

        <!-- Data table -->
        <div style="flex:1;overflow:auto;" id="data-area">
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#4a6a85;">
            <div class="loader"></div>
          </div>
        </div>

        <!-- Footer: pagination + CSV -->
        <div style="
          padding: 10px 16px; border-top: 1px solid #1e2a38;
          display: flex; align-items: center; gap: 8px; flex-shrink:0;
          background: #080c10;
        ">
          <button id="prev-page" class="btn" style="padding:5px 10px;font-size:11px;">‹ Prev</button>
          <span id="page-info" style="color:#4a6a85;font-size:11px;flex:1;text-align:center;"></span>
          <button id="next-page" class="btn" style="padding:5px 10px;font-size:11px;">Next ›</button>
          <div style="width:1px;height:20px;background:#1e2a38;margin:0 4px;"></div>
          <select id="import-type-sel" style="font-size:11px;padding:5px 8px;background:#0d1117;
            border:1px solid #1e2a38;color:#7a9ab5;border-radius:4px;">
            <option value="nodes">Nodes CSV</option>
            <option value="edges">Edges CSV</option>
          </select>
          <label class="btn btn-green" style="padding:5px 10px;font-size:11px;cursor:pointer;">
            ↑ Import
            <input type="file" id="csv-upload" accept=".csv" style="display:none;">
          </label>
          <button id="export-nodes" class="btn" style="padding:5px 10px;font-size:11px;">↓ Nodes</button>
          <button id="export-edges" class="btn" style="padding:5px 10px;font-size:11px;">↓ Edges</button>
        </div>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents() {
    const sel = this.container.querySelector<HTMLSelectElement>('#table-select');
    sel?.addEventListener('change', () => {
      this.currentTable = sel.value;
      this.currentPage = 1;
      this.loadData();
    });

    const prev = this.container.querySelector<HTMLButtonElement>('#prev-page');
    const next = this.container.querySelector<HTMLButtonElement>('#next-page');
    prev?.addEventListener('click', () => { if (this.currentPage > 1) { this.currentPage--; this.loadData(); } });
    next?.addEventListener('click', () => {
      if (this.data && this.currentPage * this.pageSize < this.data.total_rows) {
        this.currentPage++;
        this.loadData();
      }
    });

    const importTypeSel = this.container.querySelector<HTMLSelectElement>('#import-type-sel');
    importTypeSel?.addEventListener('change', () => {
      this.importType = importTypeSel.value as 'nodes' | 'edges';
    });

    const fileInput = this.container.querySelector<HTMLInputElement>('#csv-upload');
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        toast(`Importing ${file.name}...`, 'info', 2000);
        const result = await api.importCSV(file, this.importType);
        toast(`✓ Imported ${result.imported} ${this.importType}${result.errors.length ? ` (${result.errors.length} errors)` : ''}`, 'success');
        await this.loadData();
      } catch (e) {
        toast('Import failed: ' + (e as Error).message, 'critical');
      }
      fileInput.value = '';
    });

    this.container.querySelector<HTMLButtonElement>('#export-nodes')
      ?.addEventListener('click', () => { api.exportCSV('nodes'); toast('Exporting nodes…', 'info', 1500); });
    this.container.querySelector<HTMLButtonElement>('#export-edges')
      ?.addEventListener('click', () => { api.exportCSV('edges'); toast('Exporting edges…', 'info', 1500); });
  }

  private async loadData() {
    const area = this.container.querySelector<HTMLDivElement>('#data-area');
    if (area) area.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div class="loader"></div></div>`;

    try {
      this.data = await api.getSchema(this.currentTable, this.currentPage, this.pageSize);
      this.renderColumns();
      this.renderTable();
      this.renderPagination();
    } catch {
      if (area) area.innerHTML = `<div style="padding:16px;color:#ff4444;font-size:12px;">Failed to load data</div>`;
    }
  }

  private renderColumns() {
    const el = this.container.querySelector('#schema-cols');
    if (!el || !this.data) return;
    el.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:10px;color:#4a6a85;letter-spacing:0.05em;margin-right:4px;">COLUMNS:</span>
        ${this.data.columns.map(c => `
          <span title="${c.data_type}${c.nullable ? ' · nullable' : ''}" style="
            padding: 2px 8px; border-radius: 3px; font-size: 10px;
            background: #0d1117; border: 1px solid #1e2a38; color: #7a9ab5;
            cursor: default; white-space: nowrap;
          ">${c.name} <span style="color:#4a6a85;">${c.data_type.replace('character varying','varchar').replace('timestamp with time zone','timestamptz')}</span></span>
        `).join('')}
      </div>
    `;
  }

  private renderTable() {
    const area = this.container.querySelector<HTMLDivElement>('#data-area');
    if (!area || !this.data) return;

    if (this.data.sample_rows.length === 0) {
      area.innerHTML = `<div style="padding:24px;color:#4a6a85;text-align:center;font-size:12px;">No data found</div>`;
      return;
    }

    const cols = this.data.columns.map(c => c.name);
    area.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#0d1117;position:sticky;top:0;z-index:1;">
            ${cols.map(c => `
              <th style="padding:8px 12px;text-align:left;color:#4a6a85;font-weight:500;
                letter-spacing:0.05em;border-bottom:1px solid #1e2a38;white-space:nowrap;
                font-size:10px;text-transform:uppercase;">${c}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${this.data.sample_rows.map((row, i) => `
            <tr style="border-bottom:1px solid #0d1117;transition:background 0.1s;"
              onmouseover="this.style.background='rgba(0,229,255,0.03)'"
              onmouseout="this.style.background='transparent'">
              ${cols.map(c => {
                const val = row[c];
                const str = val == null ? '<span style="color:#2a3a4a">null</span>'
                  : typeof val === 'object' ? `<span style="color:#4a6a85;font-size:10px;">${JSON.stringify(val).slice(0, 60)}${JSON.stringify(val).length > 60 ? '…' : ''}</span>`
                  : String(val).length > 40 ? `<span title="${String(val)}">${String(val).slice(0, 38)}…</span>`
                  : String(val);
                const isRisk = c === 'risk_score';
                const riskVal = isRisk ? parseFloat(String(val)) : 0;
                const riskColor = isRisk
                  ? (riskVal > 0.8 ? '#ff2244' : riskVal > 0.6 ? '#ff6600' : riskVal > 0.4 ? '#ffcc00' : '#44aa66')
                  : '#c9d8e8';
                return `<td style="padding:6px 12px;color:${riskColor};vertical-align:top;
                  max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${str}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private renderPagination() {
    const el = this.container.querySelector('#page-info');
    if (!el || !this.data) return;
    const total = this.data.total_rows;
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, total);
    el.textContent = `${start}–${end} of ${total.toLocaleString()} rows`;
  }
}
