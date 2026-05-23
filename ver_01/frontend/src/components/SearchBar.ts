import { api } from '../lib/api';
import type { SearchResult } from '../types';

export class SearchBar {
  private container: HTMLElement;
  private input!: HTMLInputElement;
  private dropdown!: HTMLDivElement;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private results: SearchResult[] = [];
  private selectedIndex = -1;
  public onSelect?: (result: SearchResult) => void;
  public onSearch?: (q: string) => void;
  public onClear?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'position:relative;display:flex;align-items:center;gap:8px;';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;flex:1;';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = '⌕  Search nodes — name, type, country, wallet...';
    this.input.style.cssText = `
      width: 100%; padding: 9px 14px; padding-right: 36px;
      background: rgba(13,17,23,0.9); border: 1px solid #1e2a38;
      border-radius: 6px; color: #c9d8e8; font-size: 13px;
      font-family: 'IBM Plex Mono', monospace;
      transition: border-color 0.15s, box-shadow 0.15s;
    `;

    // ✕ clear button — sits inside the input on the right
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.style.cssText = `
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: #4a6a85; font-size: 13px;
      cursor: pointer; padding: 0 2px; line-height: 1;
      opacity: 0; transition: opacity 0.15s, color 0.15s;
      pointer-events: none;
    `;
    clearBtn.title = 'Clear search & release highlight (Esc)';
    clearBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't steal focus
      this.clearSearch();
    });
    clearBtn.addEventListener('mouseover', () => { clearBtn.style.color = '#00e5ff'; });
    clearBtn.addEventListener('mouseout',  () => { clearBtn.style.color = '#4a6a85'; });

    this.dropdown = document.createElement('div');
    this.dropdown.style.cssText = `
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: rgba(8,12,16,0.98); border: 1px solid #1e2a38;
      border-radius: 6px; z-index: 1000; display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter: blur(12px); overflow: hidden;
    `;

    this.input.addEventListener('input', () => {
      const hasText = this.input.value.length > 0;
      clearBtn.style.opacity = hasText ? '1' : '0';
      clearBtn.style.pointerEvents = hasText ? 'auto' : 'none';
      this.handleInput();
      // If user clears the field manually, release highlight immediately
      if (!hasText) this.onClear?.();
    });
    this.input.addEventListener('keydown', (e) => this.handleKey(e));
    this.input.addEventListener('focus', () => {
      this.input.style.borderColor = '#00e5ff';
      this.input.style.boxShadow = '0 0 0 2px rgba(0,229,255,0.1)';
      if (this.results.length > 0) this.showDropdown();
    });
    this.input.addEventListener('blur', () => {
      this.input.style.borderColor = '#1e2a38';
      this.input.style.boxShadow = 'none';
      setTimeout(() => this.hideDropdown(), 150);
    });

    wrapper.appendChild(this.input);
    wrapper.appendChild(clearBtn);
    wrapper.appendChild(this.dropdown);
    this.container.appendChild(wrapper);

    // Search hint chip
    const hint = document.createElement('span');
    hint.textContent = 'LIVE';
    hint.style.cssText = `
      font-size: 9px; padding: 3px 7px; border-radius: 3px;
      background: rgba(0,229,255,0.08); border: 1px solid rgba(0,229,255,0.2);
      color: #00e5ff; letter-spacing: 0.1em; font-weight: 600;
      animation: pulse 2s ease infinite;
    `;
    this.container.appendChild(hint);
  }

  private handleInput() {
    const q = this.input.value.trim();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!q) { this.hideDropdown(); return; }
    this.debounceTimer = setTimeout(() => this.doSearch(q), 180);
  }

  private async doSearch(q: string) {
    try {
      this.results = await api.search(q, 10);
      this.selectedIndex = -1;
      this.renderDropdown();
    } catch { /* ignore */ }
  }

  private renderDropdown() {
    if (this.results.length === 0) {
      this.dropdown.innerHTML = `<div style="padding:12px 14px;color:#4a6a85;font-size:12px;">No results found</div>`;
    } else {
      this.dropdown.innerHTML = this.results.map((r, i) => {
        const risk = r.risk_score;
        const riskColor = risk > 0.8 ? '#ff2244' : risk > 0.6 ? '#ff6600' : risk > 0.4 ? '#ffcc00' : '#44aa66';
        return `
          <div class="search-item" data-index="${i}" style="
            padding: 9px 14px; cursor: pointer; display: flex;
            align-items: center; gap: 10px; border-bottom: 1px solid #0d1117;
            transition: background 0.1s;
          ">
            <span style="font-size:16px;flex-shrink:0;">${this.typeIcon(r.type_name)}</span>
            <div style="flex:1;min-width:0;">
              <div style="color:#c9d8e8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${this.highlight(r.label, this.input.value)}
              </div>
              <div style="color:#4a6a85;font-size:10px;margin-top:2px;">
                ${r.type_name.replace(/_/g, ' ')} · ${r.country || 'Unknown'}
              </div>
            </div>
            <div style="flex-shrink:0;text-align:right;">
              <div style="font-size:11px;color:${riskColor};font-weight:600;">${(risk * 100).toFixed(0)}%</div>
              <div style="font-size:9px;color:#4a6a85;">risk</div>
            </div>
          </div>
        `;
      }).join('');

      this.dropdown.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('mouseenter', () => {
          (el as HTMLElement).style.background = 'rgba(0,229,255,0.05)';
        });
        el.addEventListener('mouseleave', () => {
          (el as HTMLElement).style.background = 'transparent';
        });
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt((el as HTMLElement).dataset.index || '0');
          this.selectResult(idx);
        });
      });
    }
    this.showDropdown();
  }

  private handleKey(e: KeyboardEvent) {
    if (!this.dropdown.style.display || this.dropdown.style.display === 'none') {
      if (e.key === 'Enter' && this.input.value.trim()) {
        this.onSearch?.(this.input.value.trim());
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
      this.updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
      this.updateSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIndex >= 0) {
        this.selectResult(this.selectedIndex);
      } else if (this.results.length > 0) {
        this.selectResult(0);
      }
    } else if (e.key === 'Escape') {
      this.clearSearch();
    }
  }

  private updateSelection() {
    this.dropdown.querySelectorAll('.search-item').forEach((el, i) => {
      (el as HTMLElement).style.background = i === this.selectedIndex
        ? 'rgba(0,229,255,0.08)' : 'transparent';
    });
  }

  private selectResult(idx: number) {
    const r = this.results[idx];
    if (!r) return;
    this.input.value = r.label;
    this.hideDropdown();
    this.onSelect?.(r);
  }

  private showDropdown() { this.dropdown.style.display = 'block'; }
  private hideDropdown() { this.dropdown.style.display = 'none'; }

  private highlight(text: string, query: string): string {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'),
      '<span style="color:#00e5ff;background:rgba(0,229,255,0.15);border-radius:2px;">$1</span>');
  }

  private typeIcon(type: string): string {
    const icons: Record<string, string> = {
      shell_company: '🏢', bank_account: '🏦', crypto_wallet: '₿',
      individual: '👤', real_estate: '🏠', offshore_fund: '💰',
      server: '🖥️', endpoint: '💻', router: '📡',
    };
    return icons[type] || '◉';
  }

  clearSearch() {
    this.input.value = '';
    this.results = [];
    this.hideDropdown();
    // Hide the ✕ button
    const btn = this.container.querySelector<HTMLButtonElement>('button');
    if (btn) { btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; }
    this.onClear?.();
  }

  // Clears the input text only — does NOT fire onClear (used when node-click sets highlight)
  clearText() {
    this.input.value = '';
    this.results = [];
    this.hideDropdown();
    const btn = this.container.querySelector<HTMLButtonElement>('button');
    if (btn) { btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; }
  }

  clear() { this.clearSearch(); }
}
