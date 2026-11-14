import { CanvasTexture, LinearFilter, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * ROAD counter (buses on the road / capacity), IN THE WORLD: a flat sign lying on the snow inside
 * the loop, drawn on a canvas texture. Being part of the 3D scene it depth-sorts with everything,
 * so a bus driving past always covers it — a DOM badge would paint over the buses.
 *
 * Look (from the reference): blue rounded pill, white front-view bus icon, white "n/cap" with a
 * navy outline. The plane is stretched in depth to cancel the camera tilt, so it reads with the
 * reference's proportions on screen. Punch = a short vertical (on screen) stretch.
 */
const CW = 512;
const CH = 224;
const NAVY = '#163a6b';
/** On-screen width / height of the badge. */
const ASPECT = CW / CH;
/** Camera pitch (stage.ts): a flat plane of depth d shows as d * sin(pitch) on screen. */
const FORESHORTEN = Math.sin((64 * Math.PI) / 180);

/** Punch keyframes [t, scaleY] over PUNCH_T seconds (as the old CSS rcPunch). */
const PUNCH_T = 0.4;
const PUNCH_KEYS: [number, number][] = [[0, 1], [0.2, 1.15], [0.45, 0.94], [0.7, 1.04], [1, 1]];

export class RoadCounter {
  readonly mesh: Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private text = '';
  private punchAge = -1;

  /** `width` = world width of the badge (m); it lies flat at `at`. */
  constructor(at: Vector3, width: number, private readonly capacity: number) {
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    this.ctx = canvas.getContext('2d')!;
    this.tex = new CanvasTexture(canvas);
    this.tex.minFilter = LinearFilter;
    this.tex.generateMipmaps = false;
    const geo = new PlaneGeometry(width, width / ASPECT / FORESHORTEN);
    geo.rotateX(-Math.PI / 2); // lie flat (texture top toward the camera ...)
    // raw colours like every other shader here (MeshBasicMaterial would sRGB-encode them -> washed out)
    const mat = new ShaderMaterial({
      uniforms: { map: { value: this.tex } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(map, vUv); }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.rotation.y = Math.PI; // ... so turn it round to read upright from the camera
    this.mesh.position.copy(at).setY(0.02);
    this.mesh.renderOrder = 1; // over the ground / slot decals, under every bus (depth-tested)
    this.set(0);
  }

  /** Buses on the road; redraws (and punches) only when the number changes. */
  set(n: number) {
    const t = `${n}/${this.capacity}`;
    if (t === this.text) return;
    const first = this.text === '';
    this.text = t;
    this.draw();
    if (!first) this.punch();
  }

  punch() {
    this.punchAge = 0;
  }

  update(dt: number) {
    if (this.punchAge < 0) return;
    this.punchAge += dt;
    const k = Math.min(1, this.punchAge / PUNCH_T);
    let s = 1;
    for (let i = 1; i < PUNCH_KEYS.length; i++) {
      const [t0, v0] = PUNCH_KEYS[i - 1];
      const [t1, v1] = PUNCH_KEYS[i];
      if (k <= t1) {
        const u = (k - t0) / (t1 - t0);
        s = v0 + (v1 - v0) * (1 - (1 - u) * (1 - u)); // ease-out per segment
        break;
      }
    }
    this.mesh.scale.set(1, 1, s); // world depth = screen vertical
    if (k >= 1) {
      this.punchAge = -1;
      this.mesh.scale.set(1, 1, 1);
    }
  }

  private draw() {
    const c = this.ctx;
    c.clearRect(0, 0, CW, CH);
    // pill: soft shadow, blue gradient, light top rim, darker bottom lip
    const pad = 14;
    const r = 48;
    const x = pad, y = pad, w = CW - pad * 2, h = CH - pad * 2 - 8;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.3)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 8;
    rounded(c, x, y, w, h, r);
    c.fillStyle = '#1d5cba';
    c.fill();
    c.restore();
    rounded(c, x, y, w, h - 10, r);
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#3e8cec');
    g.addColorStop(1, '#2468d0');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 6;
    rounded(c, x + 5, y + 5, w - 10, h - 20, r - 5);
    c.stroke();

    // bus icon (front view), white with a navy outline
    const ix = 48, iy = 40, s = 2.9; // icon box 48x48 units
    c.save();
    c.translate(ix, iy);
    c.scale(s, s);
    c.lineJoin = 'round';
    c.lineWidth = 3;
    c.strokeStyle = NAVY;
    c.fillStyle = '#fff';
    const box = (bx: number, by: number, bw: number, bh: number, br: number, fill = '#fff') => {
      rounded(c, bx, by, bw, bh, br);
      c.fillStyle = fill;
      c.fill();
      c.stroke();
    };
    box(3, 12, 6, 10, 2.5); // mirrors
    box(39, 12, 6, 10, 2.5);
    box(11, 37, 8, 8, 2.5); // wheels
    box(29, 37, 8, 8, 2.5);
    box(8, 4, 32, 36, 8); // body
    c.lineWidth = 2.5;
    box(13, 10, 22, 13, 3, '#2a6fd6'); // windscreen
    c.fillStyle = '#2a6fd6';
    for (const hx of [16, 32]) {
      c.beginPath();
      c.arc(hx, 32, 2.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // "n/cap": white, thick navy outline
    c.font = '900 122px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 18;
    c.strokeStyle = NAVY;
    c.strokeText(this.text, 330, 104);
    c.fillStyle = '#fff';
    c.fillText(this.text, 330, 104);
    this.tex.needsUpdate = true;
  }
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
