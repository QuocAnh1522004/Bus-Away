import { Vector3, type Camera } from 'three';
import logoUrl from '../assets/gen/logo.webp?url';

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
/** Design-px bands the HUD reserves (top: ROAD pill; bottom: CTA in portrait only). */
const BAND_TOP = 140; // ROAD pill only: the start tip may overlay the scene (it hides on the first tap)
const BAND_BOTTOM = 200; // PLAY NOW, bottom-centre in both orientations

const CSS = `
#ui{position:fixed;inset:0;pointer-events:none;z-index:10;overflow:hidden;color:#fff;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--s:1}
#ui *{box-sizing:border-box}
#ui .world,#ui .dim{position:absolute;inset:0}
#ui .frame{position:absolute;left:0;top:0;transform-origin:0 0}

/* ---- world-anchored (sizes follow the frame scale --s) */
/* ROAD counter (buses on the road / capacity), anchored inside the loop; sizes follow --s */
.rcount{position:absolute;left:0;top:0;will-change:transform}
.rc{display:flex;align-items:center;gap:calc(14px*var(--s));height:calc(100px*var(--s));padding:0 calc(34px*var(--s)) 0 calc(22px*var(--s));
  transform:translate(-50%,-50%);border-radius:calc(24px*var(--s));background:linear-gradient(#3b88e8,#2266cc);
  box-shadow:inset 0 calc(4px*var(--s)) 0 rgba(255,255,255,.35),inset 0 calc(-7px*var(--s)) 0 rgba(0,0,0,.22),0 calc(6px*var(--s)) calc(12px*var(--s)) rgba(0,0,0,.28)}
.rc svg{width:calc(70px*var(--s));height:calc(70px*var(--s))}
.rc b{font:900 calc(64px*var(--s))/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;letter-spacing:.02em;
  -webkit-text-stroke:calc(8px*var(--s)) #163a6b;paint-order:stroke fill;font-variant-numeric:tabular-nums}
.rc.punch{animation:rcPunch .35s}
@keyframes rcPunch{0%{scale:1 1}25%{scale:1 1.06}55%{scale:1 .98}80%{scale:1 1.01}100%{scale:1 1}} /* y only, subtle */
.hand{position:absolute;left:0;top:0;width:calc(150px*var(--s));height:calc(150px*var(--s));opacity:0;transition:opacity .25s;will-change:transform}
.hand.show{opacity:1}
.hand svg{width:100%;height:100%;animation:tapAnim 1s ease-in-out infinite;transform-origin:30% 10%;filter:drop-shadow(0 4px 4px rgba(0,0,0,.3))}
@keyframes tapAnim{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-4%,-6%) scale(.88)}}
.ring{position:absolute;left:0;top:0;width:calc(120px*var(--s));height:calc(120px*var(--s));margin:calc(-60px*var(--s)) 0 0 calc(-60px*var(--s));
  border-radius:50%;border:calc(9px*var(--s)) solid #fff;opacity:0}
.hand.show .ring{animation:ring 1s ease-out infinite}
@keyframes ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.3)}}

/* ---- design-resolution frame (px = design pixels) */
/* top bar (timer · ROAD · moves): kept in the DOM and updated, but hidden by design */
.top{position:absolute;left:0;right:0;top:36px;display:none;justify-content:center;gap:20px}
.stat{padding:14px 28px;gap:12px;font-variant-numeric:tabular-nums}
.stat b{font-weight:900;min-width:1.6em;text-align:center}
.stat.low{background:rgba(232,48,58,.92);animation:pulse .8s ease-in-out infinite}
@keyframes pulse{50%{scale:1.08}}
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
.toast{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.85);opacity:0;transition:.25s;padding:22px 56px;border-radius:999px;
  background:rgba(0,0,0,.82);font-weight:800;font-size:48px;white-space:nowrap}
.toast.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.cta{position:absolute;left:50%;bottom:56px;translate:-50% 0;pointer-events:auto;cursor:pointer;border:0;padding:26px 96px;border-radius:999px;
  font:900 56px system-ui,sans-serif;color:#fff;background:linear-gradient(#5fd35a,#2ea33a);box-shadow:0 9px 0 #1d7a28;animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{50%{scale:1.07}}
/* PLAY NOW lives outside the frame: pinned to the real bottom-centre of the screen, sized with --s */
#ui .main-cta{bottom:calc(56px*var(--s) + env(safe-area-inset-bottom,0px));padding:calc(26px*var(--s)) calc(96px*var(--s));
  font-size:calc(56px*var(--s));box-shadow:0 calc(9px*var(--s)) 0 #1d7a28}
.dim{background:rgba(0,0,0,.6);opacity:0;transition:opacity .35s}
.dim.show{opacity:1}
/* end card: the in-game HUD fades out under the dim (only the logo + CTA stay bright) */
.frame .top,.frame .tip{transition:opacity .35s}
.frame.ended .top,.frame.ended .tip,.frame.ended .toast{opacity:0}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;opacity:0;transition:opacity .35s}
.end.show{opacity:1;pointer-events:auto}
/* hidden end card must not swallow taps (its logo / button would open the store mid-game) */
.end:not(.show),.end:not(.show) *{pointer-events:none!important}
.end .logo{width:600px;height:600px;border-radius:120px;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 18px 30px rgba(0,0,0,.45));
  transform:scale(.6);transition:transform .5s cubic-bezier(.2,1.6,.4,1)}
.end.show .logo{transform:scale(1);animation:logoBob 2.4s ease-in-out .6s infinite}
@keyframes logoBob{50%{translate:0 -14px}}
.end .cta{position:static;translate:none;font-size:64px;padding:30px 120px}
.confetti{position:absolute;top:-4%;width:20px;height:34px;border-radius:3px;animation:fall linear forwards}
@keyframes fall{to{transform:translateY(2100px) rotate(720deg)}}
`;

const BUS_SVG = `<svg viewBox="0 0 48 48" stroke="#163a6b" stroke-width="3" stroke-linejoin="round"><rect x="3" y="12" width="6" height="10" rx="2.5" fill="#fff"/><rect x="39" y="12" width="6" height="10" rx="2.5" fill="#fff"/><rect x="11" y="37" width="8" height="8" rx="2.5" fill="#fff"/><rect x="29" y="37" width="8" height="8" rx="2.5" fill="#fff"/><rect x="8" y="4" width="32" height="36" rx="8" fill="#fff"/><rect x="13" y="10" width="22" height="13" rx="3" fill="#2a6fd6" stroke-width="2.5"/><circle cx="16" cy="32" r="2.6" fill="#2a6fd6" stroke="none"/><circle cx="32" cy="32" r="2.6" fill="#2a6fd6" stroke="none"/></svg>`;

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

  private readonly counter: HTMLDivElement;
  private readonly counterText: HTMLElement;
  private counterAnchor: Vector3 | null = null;

  constructor(private readonly capacity: number) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'ui';
    el.innerHTML = `
      <div class="world"><div class="rcount"><div class="rc">${BUS_SVG}<b></b></div></div><div class="hand"><div class="ring"></div>${HAND_SVG}</div></div>
      <div class="dim"></div>
      <div class="frame">
        <div class="top"><div class="pill stat timer-pill"><svg viewBox="0 0 24 24" width="44" height="44"><circle cx="12" cy="13" r="9" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M12 8v5l3 2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M9 2.5h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg><b class="timer"></b></div><div class="pill cap-pill">ROAD <div class="cap"></div></div><div class="pill stat moves-pill">MOVES <b class="moves"></b></div></div>
        <div class="tip hide"></div>
        <div class="toast"></div>
        <div class="end"><img class="logo" alt="" draggable="false" src="${logoUrl}"><button class="cta">PLAY NOW</button></div>
      </div>
      <button class="cta main-cta">PLAY NOW</button>`;
    document.body.appendChild(el);
    this.el = el;
    this.frame = el.querySelector('.frame')!;
    this.dim = el.querySelector('.dim')!;
    this.mainCta = el.querySelector('.main-cta')!;
    this.capPill = el.querySelector('.cap-pill')!;
    const cap = el.querySelector('.cap')!;
    for (let i = 0; i < capacity; i++) this.capCells.push(cap.appendChild(document.createElement('i')));
    this.hand = el.querySelector('.hand')!;
    this.counter = el.querySelector('.rc')!;
    this.counterText = this.counter.querySelector('b')!;
    this.counterText.textContent = `0/${capacity}`;
    this.toastEl = el.querySelector('.toast')!;
    this.tipEl = el.querySelector('.tip')!;
    this.end = el.querySelector('.end')!;
    // PLAY NOW buttons + the end-card logo all open the store
    el.querySelectorAll<HTMLElement>('.cta, .end .logo').forEach((b) =>
      b.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onCta();
      }),
    );
    this.layout();
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
  }

  private laidOut = { w: 0, h: 0 };

  /** Fit the design frame into the viewport (contain), centred. */
  layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.laidOut = { w, h };
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
    return { top: (pad + BAND_TOP * s) / h, bottom: (pad + BAND_BOTTOM * s) / h };
  }

  /** Road slots: `colors[i]` (hex) is the bus in slot i; missing entries are free slots. */
  setRoad(colors: number[]) {
    const txt = `${colors.length}/${this.capacity}`;
    if (this.counterText.textContent !== txt) {
      this.counterText.textContent = txt;
      this.punchCounter(); // punch on every change (bus sent out / bus left the road)
    }
    this.capCells.forEach((c, i) => {
      const col = colors[i];
      c.classList.toggle('on', col !== undefined);
      c.style.background = col !== undefined ? `#${col.toString(16).padStart(6, '0')}` : '';
    });
  }

  /** Moves left (pill turns red and pulses when low). */
  setMoves(n: number, low: boolean) {
    const el = this.el.querySelector('.moves')!;
    if (el.textContent !== String(n)) el.textContent = String(n);
    this.el.querySelector('.moves-pill')!.classList.toggle('low', low);
  }

  /** Countdown in seconds (shown m:ss; pill turns red and pulses when low). */
  setTime(seconds: number, low: boolean) {
    const t = Math.max(0, Math.ceil(seconds));
    const txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const el = this.el.querySelector('.timer')!;
    if (el.textContent !== txt) el.textContent = txt;
    this.el.querySelector('.timer-pill')!.classList.toggle('low', low);
  }

  /** Where the ROAD counter sits in the world (projected every frame). */
  setCounterAnchor(p: Vector3) {
    this.counterAnchor = p;
  }

  /** Punch-scale the ROAD counter (a bus was sent out). */
  punchCounter() {
    this.restartAnim(this.counter, 'punch');
  }

  private restartAnim(el: HTMLElement, cls: string) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  warnCapacity() {
    this.restartAnim(this.counter, 'punch');
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
    this.end.classList.add('show');
    this.dim.classList.add('show');
    this.frame.classList.add('ended');
    this.mainCta.style.display = 'none'; // the end card has its own CTA
    this.toastTimer = 0;
    this.toastEl.classList.remove('show'); // never peeks out behind the end card
    this.showHand(null);
    this.showTip(null);
    if (win) this.confetti();
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
    if (window.innerWidth !== this.laidOut.w || window.innerHeight !== this.laidOut.h) this.layout(); // missed resize event
    if (this.counterAnchor) {
      const p = v.copy(this.counterAnchor).project(camera);
      (this.counter.parentElement as HTMLElement).style.transform = `translate(${((p.x + 1) / 2) * w}px,${((1 - p.y) / 2) * h}px)`;
    }
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
