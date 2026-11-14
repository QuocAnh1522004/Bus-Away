import { Vector3, type Camera } from 'three';

/**
 * UI, fully decoupled from gameplay rendering (DOM over the WebGL canvas):
 *
 *   #ui
 *   ├─ .world   screen-space layer for 3D-anchored widgets (hint hand), projected every frame.
 *   │           (Station counters are NOT here: they are 3D, see Counter.ts, so passengers
 *   │           in front of a sign correctly hide it.)
 *   ├─ .dim     full-screen backdrop for the end card
 *   └─ .frame   DESIGN-RESOLUTION container: 1080x1920 (portrait) or 3413x1920 (landscape),
 *               uniformly scaled to fit and centred. All HUD layout is in design pixels, so the
 *               UI looks the same on every aspect ratio and never depends on the 3D camera.
 *
 * Text and buttons stay HTML/CSS: crisp at any DPR, zero texture bytes, no 2D engine in the bundle.
 */
// Both orientations are 1920 design-px tall, so UI keeps the same size relative to screen height.
const PORTRAIT = { w: 1080, h: 1920 };
const LANDSCAPE = { w: 3413, h: 1920 };
/** Design-px bands the HUD occupies (top: pill + tip; bottom: CTA in portrait only). */
const BAND_TOP = 250;
const BAND_BOTTOM_PORTRAIT = 200;
const BAND_BOTTOM_LANDSCAPE = 40;

const CSS = `
#ui{position:fixed;inset:0;pointer-events:none;z-index:10;overflow:hidden;color:#fff;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--s:1}
#ui *{box-sizing:border-box}
#ui .world,#ui .dim{position:absolute;inset:0}
#ui .frame{position:absolute;left:0;top:0;transform-origin:0 0}

/* ---- world-anchored (sizes follow the frame scale --s) */
.hand{position:absolute;left:0;top:0;width:calc(150px*var(--s));height:calc(150px*var(--s));opacity:0;transition:opacity .25s;will-change:transform}
.hand.show{opacity:1}
.hand svg{width:100%;height:100%;animation:tapAnim 1s ease-in-out infinite;transform-origin:30% 10%;filter:drop-shadow(0 4px 4px rgba(0,0,0,.3))}
@keyframes tapAnim{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-4%,-6%) scale(.88)}}
.ring{position:absolute;left:0;top:0;width:calc(120px*var(--s));height:calc(120px*var(--s));margin:calc(-60px*var(--s)) 0 0 calc(-60px*var(--s));
  border-radius:50%;border:calc(9px*var(--s)) solid #fff;opacity:0}
.hand.show .ring{animation:ring 1s ease-out infinite}
@keyframes ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.3)}}

/* ---- design-resolution frame (px = design pixels) */
.top{position:absolute;left:0;right:0;top:36px;display:flex;justify-content:center}
.pill{display:flex;align-items:center;gap:16px;padding:14px 34px;border-radius:999px;background:rgba(32,46,86,.82);
  box-shadow:0 6px 0 rgba(0,0,0,.18);font-weight:800;font-size:44px;letter-spacing:.02em}
.cap{display:flex;gap:10px}
.cap i{position:relative;width:62px;height:38px;border-radius:10px;background:rgba(255,255,255,.22);transition:background .2s,transform .25s cubic-bezier(.2,1.6,.4,1)}
.cap i.on{transform:translateY(-4px);box-shadow:inset 0 -6px 0 rgba(0,0,0,.22),0 0 0 3px rgba(255,255,255,.85)}
.cap i.on::after{content:"";position:absolute;left:9px;right:9px;top:8px;height:9px;border-radius:4px;background:rgba(255,255,255,.55)}
.pill.warn{animation:warn .45s}
@keyframes warn{0%,100%{transform:none;background:rgba(32,46,86,.82)}25%{transform:translateX(-10px);background:#e8303a}75%{transform:translateX(10px);background:#e8303a}}
.tip{position:absolute;left:50%;top:140px;transform:translateX(-50%);padding:20px 48px;border-radius:30px;
  background:rgba(32,46,86,.88);font-weight:900;font-size:46px;white-space:nowrap;transition:opacity .3s;animation:bob 1.4s ease-in-out infinite}
.tip.hide{opacity:0}
@keyframes bob{50%{transform:translate(-50%,-8px)}}
.toast{position:absolute;left:50%;top:250px;transform:translate(-50%,-20px);opacity:0;transition:.25s;padding:16px 44px;border-radius:999px;
  background:rgba(232,48,58,.95);font-weight:800;font-size:42px;white-space:nowrap}
.toast.show{opacity:1;transform:translate(-50%,0)}
.cta{position:absolute;left:50%;bottom:56px;translate:-50% 0;pointer-events:auto;cursor:pointer;border:0;padding:26px 96px;border-radius:999px;
  font:900 56px system-ui,sans-serif;color:#fff;background:linear-gradient(#5fd35a,#2ea33a);box-shadow:0 9px 0 #1d7a28;animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{50%{scale:1.07}}
.frame.land .main-cta{left:auto;right:120px;bottom:110px;translate:none}
.dim{background:rgba(18,28,58,.62);opacity:0;transition:opacity .35s}
.dim.show{opacity:1}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;opacity:0;transition:opacity .35s}
.end.show{opacity:1;pointer-events:auto}
.card{display:flex;flex-direction:column;align-items:center;gap:30px;width:860px;padding:70px 60px;border-radius:60px;background:#fff;color:#2b3a6b;
  box-shadow:0 15px 0 rgba(0,0,0,.25);transform:scale(.6);transition:transform .45s cubic-bezier(.2,1.6,.4,1)}
.end.show .card{transform:scale(1)}
.card h1{margin:0;font-size:92px;font-weight:900}
.card p{margin:0;font-size:44px;font-weight:700;opacity:.75;text-align:center}
.card .stars{font-size:110px;letter-spacing:10px;color:#ffc21a}
.card .cta{position:static;translate:none;font-size:64px;padding:30px 110px}
.retry{pointer-events:auto;cursor:pointer;background:none;border:0;color:#fff;font:800 44px system-ui,sans-serif;text-decoration:underline;opacity:.9}
.confetti{position:absolute;top:-4%;width:20px;height:34px;border-radius:3px;animation:fall linear forwards}
@keyframes fall{to{transform:translateY(2100px) rotate(720deg)}}
`;

const HAND_SVG = `<svg viewBox="0 0 64 64"><path fill="#fff" stroke="#2b3a6b" stroke-width="3" stroke-linejoin="round"
 d="M20 6c3 0 5 2 5 5v17l2-1c3-1 5 0 6 2l1 2 2-1c3-1 5 0 6 2v1l2-1c3-1 6 1 6 4v12c0 9-6 15-15 15h-3c-6 0-10-3-13-8L10 40c-2-3-1-6 2-7 2-1 4 0 6 2l2 3V11c0-3 0-5 0-5z"/></svg>`;

export class Hud {
  readonly el: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly dim: HTMLDivElement;
  private readonly mainCta: HTMLButtonElement;
  private readonly capPill: HTMLDivElement;
  private readonly capCells: HTMLElement[] = [];
  private readonly hand: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly tipEl: HTMLDivElement;
  private readonly end: HTMLDivElement;
  private toastTimer = 0;
  private handTarget: Vector3 | null = null;
  onCta: () => void = () => {};
  onRetry: () => void = () => {};

  constructor(capacity: number) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'ui';
    el.innerHTML = `
      <div class="world"><div class="hand"><div class="ring"></div>${HAND_SVG}</div></div>
      <div class="dim"></div>
      <div class="frame">
        <div class="top"><div class="pill cap-pill">ROAD <div class="cap"></div></div></div>
        <div class="tip hide"></div>
        <div class="toast"></div>
        <button class="cta main-cta">PLAY NOW</button>
        <div class="end"><div class="card"><div class="stars"></div><h1></h1><p></p><button class="cta">PLAY NOW</button></div>
          <button class="retry">Try again</button></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.frame = el.querySelector('.frame')!;
    this.dim = el.querySelector('.dim')!;
    this.mainCta = el.querySelector('.main-cta')!;
    this.capPill = el.querySelector('.cap-pill')!;
    const cap = el.querySelector('.cap')!;
    for (let i = 0; i < capacity; i++) this.capCells.push(cap.appendChild(document.createElement('i')));
    this.hand = el.querySelector('.hand')!;
    this.toastEl = el.querySelector('.toast')!;
    this.tipEl = el.querySelector('.tip')!;
    this.end = el.querySelector('.end')!;
    el.querySelectorAll<HTMLButtonElement>('.cta').forEach((b) =>
      b.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onCta();
      }),
    );
    el.querySelector('.retry')!.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.onRetry();
    });
    this.layout();
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
  }

  /** Fit the design frame into the viewport (contain), centred. */
  layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = w > h ? LANDSCAPE : PORTRAIT;
    const s = Math.min(w / d.w, h / d.h);
    this.frame.classList.toggle('land', w > h);
    this.frame.style.width = `${d.w}px`;
    this.frame.style.height = `${d.h}px`;
    this.frame.style.transform = `translate(${(w - d.w * s) / 2}px,${(h - d.h * s) / 2}px) scale(${s})`;
    this.el.style.setProperty('--s', String(s));
  }

  /**
   * Fractions of the viewport height covered by the top HUD bar and the bottom CTA, so the 3D
   * camera can keep gameplay out from under them (the two layers never overlap).
   */
  safeInsets() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const land = w > h;
    const d = land ? LANDSCAPE : PORTRAIT;
    const s = Math.min(w / d.w, h / d.h);
    const pad = (h - d.h * s) / 2;
    return { top: (pad + BAND_TOP * s) / h, bottom: (pad + (land ? BAND_BOTTOM_LANDSCAPE : BAND_BOTTOM_PORTRAIT) * s) / h };
  }

  /** Road slots: `colors[i]` (hex) is the bus in slot i; missing entries are free slots. */
  setRoad(colors: number[]) {
    this.capCells.forEach((c, i) => {
      const col = colors[i];
      c.classList.toggle('on', col !== undefined);
      c.style.background = col !== undefined ? `#${col.toString(16).padStart(6, '0')}` : '';
    });
  }

  warnCapacity() {
    this.capPill.classList.remove('warn');
    void this.capPill.offsetWidth; // restart animation
    this.capPill.classList.add('warn');
  }

  toast(text: string, seconds = 1.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  /** Persistent instruction line (null hides it). */
  showTip(text: string | null) {
    if (text) this.tipEl.textContent = text;
    this.tipEl.classList.toggle('hide', !text);
  }

  showHand(target: Vector3 | null) {
    this.handTarget = target;
    this.hand.classList.toggle('show', !!target);
  }

  showEnd(win: boolean) {
    const card = this.end.querySelector('.card')!;
    card.querySelector('.stars')!.textContent = win ? '★★★' : '';
    card.querySelector('h1')!.textContent = win ? 'Level Complete!' : 'Out of Parking!';
    card.querySelector('p')!.textContent = win ? 'Every passenger got home on time.' : 'Plan your buses better next time.';
    this.end.classList.add('show');
    this.dim.classList.add('show');
    this.mainCta.style.display = 'none'; // the card has its own CTA
    this.showHand(null);
    this.showTip(null);
    if (win) this.confetti();
  }

  hideEnd() {
    this.end.classList.remove('show');
    this.dim.classList.remove('show');
    this.mainCta.style.display = '';
  }

  private confetti() {
    const colors = ['#e8303a', '#2f8cff', '#37c94a', '#ffc21a', '#9a3cff'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      this.end.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  }

  /** Per-frame: project the hint hand's 3D anchor into the world layer, tick the toast. */
  update(dt: number, camera: Camera, w: number, h: number) {
    if (this.handTarget) {
      const p = v.copy(this.handTarget).project(camera);
      this.hand.style.transform = `translate(${((p.x + 1) / 2) * w}px,${((1 - p.y) / 2) * h}px) translate(-22%,-8%)`;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}

const v = new Vector3();
