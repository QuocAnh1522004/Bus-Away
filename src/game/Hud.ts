import { Vector3, type Camera } from 'three';

/**
 * DOM overlay. Text/UI stays in HTML/CSS: crisp at any DPR, zero texture bytes, and no 2D engine
 * in the bundle. 3D-anchored labels are projected once per frame.
 */
const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;z-index:10;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;
  --ui:min(1vw,0.56vh);}
#hud *{box-sizing:border-box}
.top{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 2.2*var(--ui));display:flex;justify-content:center;gap:calc(2.4*var(--ui))}
.pill{display:flex;align-items:center;gap:calc(1.6*var(--ui));padding:calc(1.4*var(--ui)) calc(3.2*var(--ui));border-radius:999px;
  background:rgba(32,46,86,.82);box-shadow:0 calc(.6*var(--ui)) 0 rgba(0,0,0,.18);font-weight:800;font-size:calc(4.2*var(--ui));letter-spacing:.02em}
.cap{display:flex;gap:calc(1*var(--ui))}
.cap i{width:calc(5.4*var(--ui));height:calc(3.4*var(--ui));border-radius:calc(1*var(--ui));background:rgba(255,255,255,.22);transition:background .2s,transform .2s}
.cap i.on{background:#ffc21a;transform:translateY(calc(-.4*var(--ui)))}
.pill.warn{animation:warn .45s}
@keyframes warn{0%,100%{transform:none;background:rgba(32,46,86,.82)}25%{transform:translateX(-6px);background:#e8303a}75%{transform:translateX(6px);background:#e8303a}}
.lbl{position:absolute;left:0;top:0;transform:translate(-50%,-100%);min-width:calc(9*var(--ui));padding:calc(.8*var(--ui)) calc(2*var(--ui));
  border-radius:calc(2.2*var(--ui));background:#2b3a6b;border:calc(.6*var(--ui)) solid #fff;font-weight:900;font-size:calc(4.6*var(--ui));text-align:center;
  box-shadow:0 calc(.6*var(--ui)) 0 rgba(0,0,0,.2);will-change:transform}
.lbl.pop{animation:pop .25s}
@keyframes pop{50%{scale:1.25}}
.hand{position:absolute;left:0;top:0;width:calc(15*var(--ui));height:calc(15*var(--ui));opacity:0;transition:opacity .25s;will-change:transform}
.hand.show{opacity:1}
.hand svg{width:100%;height:100%;animation:tapAnim 1s ease-in-out infinite;transform-origin:30% 10%;filter:drop-shadow(0 4px 4px rgba(0,0,0,.3))}
@keyframes tapAnim{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-4%,-6%) scale(.88)}}
.ring{position:absolute;left:0;top:0;width:calc(12*var(--ui));height:calc(12*var(--ui));margin:calc(-6*var(--ui)) 0 0 calc(-6*var(--ui));border-radius:50%;
  border:calc(.9*var(--ui)) solid #fff;opacity:0}
.hand.show .ring{animation:ring 1s ease-out infinite}
@keyframes ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.3)}}
.toast{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 14*var(--ui));transform:translate(-50%,-20px);opacity:0;transition:.25s;
  padding:calc(1.6*var(--ui)) calc(4*var(--ui));border-radius:999px;background:rgba(232,48,58,.95);font-weight:800;font-size:calc(4*var(--ui));white-space:nowrap}
.toast.show{opacity:1;transform:translate(-50%,0)}
.tip{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 13*var(--ui));transform:translateX(-50%);padding:calc(2*var(--ui)) calc(5*var(--ui));
  border-radius:calc(3*var(--ui));background:rgba(32,46,86,.88);font-weight:900;font-size:calc(4.6*var(--ui));white-space:nowrap;transition:opacity .3s;
  animation:bob 1.4s ease-in-out infinite}
.tip.hide{opacity:0}
@keyframes bob{50%{transform:translate(-50%,-6px)}}
.cta{position:absolute;right:calc(3*var(--ui));bottom:calc(env(safe-area-inset-bottom,0px) + 3*var(--ui));pointer-events:auto;cursor:pointer;border:0;
  padding:calc(2.2*var(--ui)) calc(5*var(--ui));border-radius:999px;font:900 calc(4.4*var(--ui)) system-ui,sans-serif;color:#fff;
  background:linear-gradient(#5fd35a,#2ea33a);box-shadow:0 calc(.9*var(--ui)) 0 #1d7a28;animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{50%{transform:scale(1.07)}}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(4*var(--ui));
  background:rgba(18,28,58,.62);opacity:0;pointer-events:none;transition:opacity .35s}
.end.show{opacity:1;pointer-events:auto}
.card{display:flex;flex-direction:column;align-items:center;gap:calc(3*var(--ui));padding:calc(7*var(--ui)) calc(8*var(--ui));border-radius:calc(6*var(--ui));
  background:#fff;color:#2b3a6b;box-shadow:0 calc(1.5*var(--ui)) 0 rgba(0,0,0,.25);transform:scale(.6);transition:transform .45s cubic-bezier(.2,1.6,.4,1)}
.end.show .card{transform:scale(1)}
.card h1{margin:0;font-size:calc(9*var(--ui));font-weight:900;letter-spacing:.01em}
.card p{margin:0;font-size:calc(4.4*var(--ui));font-weight:700;opacity:.75;text-align:center}
.card .stars{font-size:calc(10*var(--ui));letter-spacing:calc(1*var(--ui))}
.card .big{position:static;animation:breathe 1.4s ease-in-out infinite;font-size:calc(6.4*var(--ui));padding:calc(3*var(--ui)) calc(10*var(--ui))}
.retry{pointer-events:auto;cursor:pointer;background:none;border:0;color:#fff;font:800 calc(4.2*var(--ui)) system-ui,sans-serif;text-decoration:underline;opacity:.9}
.confetti{position:absolute;top:-4%;width:calc(2*var(--ui));height:calc(3.4*var(--ui));border-radius:2px;animation:fall linear forwards}
@keyframes fall{to{transform:translateY(110vh) rotate(720deg)}}
`;

const HAND_SVG = `<svg viewBox="0 0 64 64"><path fill="#fff" stroke="#2b3a6b" stroke-width="3" stroke-linejoin="round"
 d="M20 6c3 0 5 2 5 5v17l2-1c3-1 5 0 6 2l1 2 2-1c3-1 5 0 6 2v1l2-1c3-1 6 1 6 4v12c0 9-6 15-15 15h-3c-6 0-10-3-13-8L10 40c-2-3-1-6 2-7 2-1 4 0 6 2l2 3V11c0-3 0-5 0-5z"/></svg>`;

export class Hud {
  readonly el: HTMLDivElement;
  private readonly capPill: HTMLDivElement;
  private readonly capCells: HTMLElement[] = [];
  private readonly hand: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly tipEl: HTMLDivElement;
  private readonly end: HTMLDivElement;
  private readonly labels: { el: HTMLDivElement; anchor: Vector3; value: number }[] = [];
  private toastTimer = 0;
  private handTarget: Vector3 | null = null;
  onCta: () => void = () => {};
  onRetry: () => void = () => {};

  constructor(capacity: number) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <div class="top"><div class="pill cap-pill">ROAD <div class="cap"></div></div></div>
      <div class="toast"></div>
      <div class="tip hide"></div>
      <div class="hand"><div class="ring"></div>${HAND_SVG}</div>
      <button class="cta">PLAY NOW</button>
      <div class="end"><div class="card"><div class="stars"></div><h1></h1><p></p><button class="cta big">PLAY NOW</button></div>
        <button class="retry">Try again</button></div>`;
    document.body.appendChild(el);
    this.el = el;
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
  }

  setCapacity(used: number) {
    this.capCells.forEach((c, i) => c.classList.toggle('on', i < used));
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

  addLabel(anchor: Vector3, value: number) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.textContent = String(value);
    this.el.insertBefore(el, this.hand);
    const label = { el, anchor, value };
    this.labels.push(label);
    return (v: number) => {
      if (v === label.value) return;
      label.value = v;
      el.textContent = String(v);
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
      el.style.opacity = v > 0 ? '1' : '0';
    };
  }

  clearLabels() {
    for (const l of this.labels) l.el.remove();
    this.labels.length = 0;
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
    this.showHand(null);
    if (win) this.confetti();
  }

  hideEnd() {
    this.end.classList.remove('show');
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

  /** Per-frame: project 3D anchors, tick toast. */
  update(dt: number, camera: Camera, w: number, h: number) {
    for (const l of this.labels) {
      const p = v.copy(l.anchor).project(camera);
      l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px,${((1 - p.y) / 2) * h}px) translate(-50%,-100%)`;
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
