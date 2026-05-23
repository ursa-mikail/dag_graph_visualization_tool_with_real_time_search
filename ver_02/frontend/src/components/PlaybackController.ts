export interface PlaybackOptions {
  onTick: (currentMs: number) => void
  onEnd:  () => void
}

export class PlaybackController {
  private minMs = 0
  private maxMs = 0
  private currentMs = 0
  private playing = false
  private speed = 1          // real-time multiplier
  private lastRaf = 0
  private rafId = 0
  private windowMs = 5_000  // 5-second event window shown at once

  // UI elements
  private playBtn!: HTMLButtonElement
  private speedEl!: HTMLElement
  private scrubber!: HTMLInputElement
  private currentTimeEl!: HTMLElement
  private totalTimeEl!: HTMLElement
  private windowEl!: HTMLSelectElement
  private container: HTMLElement
  private opts: PlaybackOptions

  // Speeds in real-time multiples: 1 real-second = N dataset-seconds
  private speeds = [0.5, 1, 2, 5, 10, 30, 60, 120]
  private speedIdx = 2   // default 2x

  constructor(container: HTMLElement, opts: PlaybackOptions) {
    this.container = container
    this.opts = opts
    this.speed = this.speeds[this.speedIdx]
    this.build()
  }

  private build() {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;
        background:rgba(7,9,13,.97);border-top:1px solid #182030;">

        <!-- Scrubber row -->
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="cur-time" style="font-size:10px;color:#6888a8;min-width:140px;font-family:'IBM Plex Mono',monospace;">
            —
          </span>
          <input id="scrubber" type="range" min="0" max="1000" value="0" step="1"
            style="flex:1;height:4px;accent-color:#00d4ff;cursor:pointer;">
          <span id="tot-time" style="font-size:10px;color:#6888a8;min-width:140px;
            text-align:right;font-family:'IBM Plex Mono',monospace;">—</span>
        </div>

        <!-- Controls row -->
        <div style="display:flex;align-items:center;gap:8px;">

          <!-- Rewind to start -->
          <button id="btn-start" class="btn" title="Jump to start" style="padding:5px 9px;font-size:13px;">⏮</button>

          <!-- Step back -->
          <button id="btn-back" class="btn" title="Step back 10s" style="padding:5px 9px;font-size:13px;">⏪</button>

          <!-- Play / Pause -->
          <button id="btn-play" class="btn btn-accent" style="padding:5px 16px;font-size:15px;min-width:46px;">▶</button>

          <!-- Step forward -->
          <button id="btn-fwd" class="btn" title="Step forward 10s" style="padding:5px 9px;font-size:13px;">⏩</button>

          <!-- Jump to end -->
          <button id="btn-end" class="btn" title="Jump to end" style="padding:5px 9px;font-size:13px;">⏭</button>

          <!-- Speed -->
          <div style="display:flex;align-items:center;gap:5px;margin-left:6px;">
            <button id="btn-slower" class="btn" style="padding:4px 8px;font-size:11px;">−</button>
            <span id="speed-label" style="font-size:12px;color:#00d4ff;min-width:38px;
              text-align:center;font-family:'Syne',sans-serif;font-weight:700;">2×</span>
            <button id="btn-faster" class="btn" style="padding:4px 8px;font-size:11px;">+</button>
            <span style="font-size:9px;color:#384860;margin-left:2px;">SPEED</span>
          </div>

          <!-- Window size -->
          <div style="display:flex;align-items:center;gap:5px;margin-left:6px;">
            <span style="font-size:9px;color:#384860;">WINDOW</span>
            <select id="window-sel" style="font-size:11px;padding:4px 6px;">
              <option value="1000">1 s</option>
              <option value="5000" selected>5 s</option>
              <option value="15000">15 s</option>
              <option value="30000">30 s</option>
              <option value="60000">1 min</option>
              <option value="300000">5 min</option>
              <option value="900000">15 min</option>
              <option value="3600000">1 hr</option>
            </select>
          </div>

          <div style="flex:1"></div>

          <!-- Progress bar info -->
          <span id="progress-pct" style="font-size:10px;color:#384860;">0%</span>
        </div>
      </div>
    `

    this.playBtn       = this.container.querySelector('#btn-play')!
    this.speedEl       = this.container.querySelector('#speed-label')!
    this.scrubber      = this.container.querySelector('#scrubber')!
    this.currentTimeEl = this.container.querySelector('#cur-time')!
    this.totalTimeEl   = this.container.querySelector('#tot-time')!
    this.windowEl      = this.container.querySelector('#window-sel')!

    this.playBtn.addEventListener('click', () => this.togglePlay())

    this.container.querySelector('#btn-start')!.addEventListener('click', () => {
      this.seek(this.minMs); this.refresh()
    })
    this.container.querySelector('#btn-end')!.addEventListener('click', () => {
      this.seek(this.maxMs); this.refresh()
    })
    this.container.querySelector('#btn-back')!.addEventListener('click', () => {
      this.seek(Math.max(this.minMs, this.currentMs - 10_000)); this.refresh()
    })
    this.container.querySelector('#btn-fwd')!.addEventListener('click', () => {
      this.seek(Math.min(this.maxMs, this.currentMs + 10_000)); this.refresh()
    })

    this.container.querySelector('#btn-slower')!.addEventListener('click', () => {
      this.speedIdx = Math.max(0, this.speedIdx - 1)
      this.speed = this.speeds[this.speedIdx]
      this.updateSpeedLabel()
    })
    this.container.querySelector('#btn-faster')!.addEventListener('click', () => {
      this.speedIdx = Math.min(this.speeds.length - 1, this.speedIdx + 1)
      this.speed = this.speeds[this.speedIdx]
      this.updateSpeedLabel()
    })

    this.scrubber.addEventListener('input', () => {
      const pct = parseInt(this.scrubber.value) / 1000
      this.seek(this.minMs + pct * (this.maxMs - this.minMs))
      this.refresh()
    })

    this.windowEl.addEventListener('change', () => {
      this.windowMs = parseInt(this.windowEl.value)
    })
  }

  setRange(minMs: number, maxMs: number) {
    this.minMs = minMs
    this.maxMs = maxMs
    this.currentMs = minMs
    this.totalTimeEl.textContent = this.formatDate(maxMs)
    this.refresh()
  }

  seek(ms: number) {
    this.currentMs = Math.max(this.minMs, Math.min(this.maxMs, ms))
  }

  get windowSize() { return this.windowMs }
  get current()    { return this.currentMs }
  get isPlaying()  { return this.playing }

  togglePlay() {
    if (this.playing) this.pause()
    else this.play()
  }

  play() {
    if (this.maxMs === 0) return
    if (this.currentMs >= this.maxMs) this.currentMs = this.minMs
    this.playing = true
    this.playBtn.textContent = '⏸'
    this.lastRaf = performance.now()
    this.rafId = requestAnimationFrame(ts => this.tick(ts))
  }

  pause() {
    this.playing = false
    this.playBtn.textContent = '▶'
    cancelAnimationFrame(this.rafId)
  }

  private tick(ts: number) {
    const dt = ts - this.lastRaf  // real ms elapsed
    this.lastRaf = ts
    this.currentMs += dt * this.speed  // advance dataset time

    if (this.currentMs >= this.maxMs) {
      this.currentMs = this.maxMs
      this.pause()
      this.opts.onEnd()
    }

    this.refresh()
    this.opts.onTick(this.currentMs)

    if (this.playing) {
      this.rafId = requestAnimationFrame(ts2 => this.tick(ts2))
    }
  }

  private refresh() {
    if (this.maxMs === this.minMs) return
    const pct = (this.currentMs - this.minMs) / (this.maxMs - this.minMs)
    this.scrubber.value = String(Math.round(pct * 1000))
    this.currentTimeEl.textContent = this.formatDate(this.currentMs)
    const pctEl = this.container.querySelector('#progress-pct')
    if (pctEl) pctEl.textContent = `${(pct * 100).toFixed(1)}%`
  }

  private updateSpeedLabel() {
    const s = this.speeds[this.speedIdx]
    this.speedEl.textContent = s < 1 ? `½×` : `${s}×`
  }

  private formatDate(ms: number): string {
    if (!ms) return '—'
    const d = new Date(ms)
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  }

  destroy() { cancelAnimationFrame(this.rafId) }
}
