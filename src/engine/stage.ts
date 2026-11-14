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
   * until all 8 corners of the playfield box project inside the viewport (with a margin).
   * Screen right == world -X (see README: authoring axis note).
   */
  private fitCamera() {
    const cam = this.camera;
    const corners = this.fitPoints;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.focus.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const dir = new Vector3(0, Math.sin(this.tilt), -Math.cos(this.tilt)); // from focus to camera

    const margin = 1.04;
    let lo = 5;
    let hi = 150;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      cam.position.copy(this.focus).addScaledVector(dir, d);
      cam.lookAt(this.focus);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let fits = true;
      for (const c of corners) {
        const p = c.clone().project(cam);
        if (Math.abs(p.x) * margin > 1 || Math.abs(p.y) * margin > 1 || p.z > 1) {
          fits = false;
          break;
        }
      }
      if (fits) hi = d;
      else lo = d;
    }
    cam.position.copy(this.focus).addScaledVector(dir, hi);
    cam.lookAt(this.focus);
    // Re-centre vertically: shift so the box is centred on screen (perspective makes it bottom-heavy).
    cam.updateMatrixWorld();
    let top = -Infinity;
    let bottom = Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(cam);
      top = Math.max(top, p.y);
      bottom = Math.min(bottom, p.y);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
    }
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const side = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const worldPerNdcY = hi * Math.tan((cam.fov * Math.PI) / 360);
    cam.position.addScaledVector(up, ((top + bottom) / 2) * worldPerNdcY * 0.9);
    cam.position.addScaledVector(side, ((left + right) / 2) * worldPerNdcY * cam.aspect * 0.9);
    cam.updateMatrixWorld();
    cam.near = Math.max(0.5, hi * 0.2);
    cam.far = hi * 3;
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
