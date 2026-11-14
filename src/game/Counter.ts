import { CanvasTexture, LinearFilter, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

/**
 * The passenger counter on a station's sign screen, rendered IN 3D (a 256x128 canvas texture on a
 * plane) so it depth-sorts with the passengers: anyone walking or jumping in front of the sign
 * correctly covers it. (A DOM label always paints over the WebGL canvas.) Zero asset bytes; the
 * canvas is redrawn only when the number changes.
 */
export class Counter {
  readonly mesh: Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private value = -1;
  // damped spring for the "pop" on change (impulses accumulate; see update)
  private pop = 0;
  private popV = 0;

  constructor(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    this.ctx = canvas.getContext('2d')!;
    this.tex = new CanvasTexture(canvas);
    this.tex.minFilter = LinearFilter; // no mipmaps needed: the screen is never tiny
    this.tex.generateMipmaps = false;
    const mat = new ShaderMaterial({
      uniforms: { map: { value: this.tex } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), mat);
    this.mesh.rotation.y = Math.PI; // face -Z, toward the camera
  }

  set(n: number) {
    if (n === this.value) return;
    const first = this.value < 0;
    this.value = n;
    const c = this.ctx;
    c.fillStyle = '#2b3a6b';
    c.fillRect(0, 0, 256, 128);
    c.font = '900 92px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#6ec3ff';
    c.shadowBlur = 18;
    c.fillStyle = '#ffffff';
    c.fillText(String(n), 128, 70);
    c.shadowBlur = 0;
    this.tex.needsUpdate = true;
    if (!first) this.popV = Math.min(this.popV + 5, 9);
  }

  update(dt: number) {
    const step = Math.min(dt, 1 / 30);
    this.popV += (-260 * this.pop - 20 * this.popV) * step;
    this.pop = Math.max(-0.1, Math.min(0.3, this.pop + this.popV * step));
    this.mesh.scale.setScalar(1 + this.pop);
  }
}
