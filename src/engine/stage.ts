import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';

/**
 * Renderer + camera + resize + frame loop. The camera frames a fixed world-space box
 * (the playfield) for any aspect ratio: portrait phones, tablets and landscape.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 1, 200);
  /** Called every frame with dt in seconds (clamped). */
  onUpdate: (dt: number) => void = () => {};
  onResize: () => void = () => {};

  private last = 0;
  private readonly focus = new Vector3();
  private readonly tilt: number; // camera pitch (radians from horizontal)
  private fitPoints: Vector3[] = [new Vector3(-1, 0, -1), new Vector3(1, 0, 1)];
  width = 1;
  height = 1;
  /** Disable to drive the camera manually (debug views, cinematic moments). */
  autoFit = true;
  /** Viewport fractions reserved by UI (top bar / bottom CTA); the fit keeps content out of them. */
  insets: () => { top: number; bottom: number } = () => ({ top: 0, bottom: 0 });

  constructor(host: HTMLElement, clearColor: number) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(clearColor);
    host.appendChild(this.renderer.domElement);
    this.tilt = (58 * Math.PI) / 180;
    const resize = () => this.resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
  }

  /** World-space points that must always be visible (camera fits them for any aspect). */
  frame(points: Vector3[]) {
    this.fitPoints = points;
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    // Cap DPR at 2: retina-sharp without paying 3x fill-rate on high-end phones.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.autoFit) this.fitCamera();
    else this.camera.updateProjectionMatrix();
    this.onResize();
  }

  /**
   * Place the camera on the -Z side, pitched down by `tilt`, looking toward +Z, and pull it back
   * until every fit point projects inside the viewport band left free by the UI (with a margin),
   * then re-centre the content in that band. Screen right == world -X (see README).
   */
  private fitCamera() {
    const cam = this.camera;
    const pts = this.fitPoints;
    const { top: insetTop, bottom: insetBottom } = this.insets();
    // free vertical band in NDC: [-1 + 2*bottom, 1 - 2*top]
    const bandHalf = 1 - insetTop - insetBottom;
    const bandMid = insetBottom - insetTop;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.focus.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const dir = new Vector3(0, Math.sin(this.tilt), -Math.cos(this.tilt)); // from focus to camera
    const tmp = new Vector3();
    const extents = () => {
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let t = -Infinity, b = Infinity, l = Infinity, r = -Infinity;
      for (const c of pts) {
        const p = tmp.copy(c).project(cam);
        t = Math.max(t, p.y);
        b = Math.min(b, p.y);
        l = Math.min(l, p.x);
        r = Math.max(r, p.x);
      }
      return { t, b, l, r };
    };

    // Binary-search the distance: content (centred) must fit the free band.
    const margin = 1.04;
    let lo = 5;
    let hi = 150;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      cam.position.copy(this.focus).addScaledVector(dir, d);
      cam.lookAt(this.focus);
      const e = extents();
      const fits = ((e.t - e.b) / 2) * margin <= bandHalf && ((e.r - e.l) / 2) * margin <= 1;
      if (fits) hi = d;
      else lo = d;
    }
    cam.position.copy(this.focus).addScaledVector(dir, hi);
    cam.lookAt(this.focus);

    // Re-centre (a few Newton steps: perspective makes the shift slightly non-linear).
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const side = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const worldPerNdcY = hi * Math.tan((cam.fov * Math.PI) / 360);
    for (let k = 0; k < 4; k++) {
      const e = extents();
      cam.position.addScaledVector(up, ((e.t + e.b) / 2 - bandMid) * worldPerNdcY);
      cam.position.addScaledVector(side, ((e.l + e.r) / 2) * worldPerNdcY * cam.aspect);
    }
    cam.near = Math.max(0.5, hi * 0.2);
    cam.far = hi * 3;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }

  start() {
    const loop = (t: number) => {
      const dt = this.last ? Math.min((t - this.last) / 1000, 1 / 20) : 1 / 60;
      this.last = t;
      this.onUpdate(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
