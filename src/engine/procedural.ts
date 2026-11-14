import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, ShaderMaterial, SphereGeometry } from 'three';

/**
 * Procedural low-poly props (no asset bytes): merged into one vertex-coloured geometry so a whole
 * forest is a single InstancedMesh draw call.
 */
function colored(geo: BufferGeometry, color: number, ty = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.translate(0, ty, 0);
  g.computeVertexNormals();
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function merge(parts: BufferGeometry[]) {
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(arrays.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const a of arrays) {
      merged.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new BufferAttribute(merged, 3));
  }
  return out;
}

/** Snowy pine: trunk + 3 cone tiers, each with a white snow cap. Height ~2.2 at scale 1. */
export function pineGeometry() {
  const seg = 7;
  return merge([
    colored(new CylinderGeometry(0.1, 0.13, 0.5, 6), 0x8a5a3c, 0.25),
    colored(new ConeGeometry(0.85, 0.9, seg), 0x2f9e63, 0.85),
    colored(new ConeGeometry(0.62, 0.32, seg), 0xf4f8ff, 1.2),
    colored(new ConeGeometry(0.68, 0.8, seg), 0x37b06e, 1.35),
    colored(new ConeGeometry(0.48, 0.3, seg), 0xf4f8ff, 1.66),
    colored(new ConeGeometry(0.48, 0.72, seg), 0x40bf78, 1.8),
    colored(new ConeGeometry(0.3, 0.32, seg), 0xf4f8ff, 2.05),
  ]);
}

/** Counter signpost: pole + framed screen (the number is a DOM label drawn on the screen). */
export const SIGN_BOARD = { w: 1.95, h: 1.045, y: 1.45 }; // screen = (w-0.14) x (h-0.14) = 2:1
export function signpostGeometry() {
  const { w, h, y } = SIGN_BOARD;
  const frame = new BoxGeometry(w, h, 0.12);
  const screen = new BoxGeometry(w - 0.14, h - 0.14, 0.02);
  screen.translate(0, 0, -0.065); // faces -Z (toward the camera)
  return merge([
    colored(new CylinderGeometry(0.05, 0.06, y, 8), 0x3a4766, y / 2),
    colored(frame, 0xdfe6f5, y),
    colored(screen, 0x2b3a6b, y),
  ]);
}

/** Snowman: three spheres + carrot nose. */
export function snowmanGeometry() {
  const nose = new ConeGeometry(0.06, 0.28, 6);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.3);
  return merge([
    colored(new SphereGeometry(0.5, 10, 8), 0xf4f8ff, 0.45),
    colored(new SphereGeometry(0.36, 10, 8), 0xf4f8ff, 1.12),
    colored(new SphereGeometry(0.26, 10, 8), 0xf4f8ff, 1.6),
    colored(nose, 0xff8a1f, 1.62),
    colored(new CylinderGeometry(0.2, 0.22, 0.06, 10), 0x2b3a6b, 1.82),
    colored(new CylinderGeometry(0.14, 0.14, 0.26, 10), 0x2b3a6b, 1.98),
  ]);
}

/** Vertex-colour toon shading with the same baked light as the asset shader. Instancing-aware. */
export function createPropMaterial() {
  return new ShaderMaterial({
    name: 'Prop',
    vertexColors: true,
    vertexShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vN;
      void main() {
        vColor = color;
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vN;
      void main() {
        float d = clamp(smoothstep(-0.2, 1.2, dot(normalize(vN), normalize(vec3(-0.34, 1.0, -0.2)))), 0.0, 1.0);
        gl_FragColor = vec4(vColor * mix(0.62, 1.08, d), 1.0);
      }
    `,
  });
}
