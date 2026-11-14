// Asset pipeline: art-src/ (FBX + PNG from the Cocos project) -> src/assets/gen/ (runtime assets).
//
//   1. FBX2glTF converts every FBX to a temporary GLB.
//   2. glTF-Transform merges them into ONE document (one request, one decoder pass, shared buffers),
//      strips what the custom shaders never read (vertex colors, unused UVs, embedded materials),
//      quantizes vertex data and applies EXT_meshopt_compression.
//   3. sharp resizes textures to the resolution they are actually sampled at and re-encodes them.
//
// Run: npm run assets
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'art-src');
const OUT = join(ROOT, 'src', 'assets', 'gen');
const FBX2GLTF_OS = { win32: 'Windows_NT', darwin: 'Darwin', linux: 'Linux' }[process.platform];
const FBX2GLTF = join(ROOT, 'node_modules', 'fbx2gltf', 'bin', FBX2GLTF_OS, process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'busaway-'));

// ---------------------------------------------------------------- meshes
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const fbxFiles = readdirSync(join(SRC, 'meshes')).filter((f) => f.toLowerCase().endsWith('.fbx'));
const doc = await io.read(convert(fbxFiles[0]));
for (const f of fbxFiles.slice(1)) mergeDocuments(doc, await io.read(convert(f)));

const root = doc.getRoot();
const [mainScene, ...extraScenes] = root.listScenes();
for (const scene of extraScenes) {
  for (const node of scene.listChildren()) mainScene.addChild(node);
  scene.dispose();
}

// Flatten FBX2glTF "RootNode" wrappers and namespace child names ("Vehicle_06__Lid"; GLTFLoader turns "." into "_") so names stay
// unique after merging (GLTFLoader would otherwise suffix duplicates: Lid, Lid_1, Lid_2 ...).
for (const wrapper of mainScene.listChildren()) {
  for (const model of wrapper.listChildren()) {
    mainScene.addChild(model);
    model.traverse((n) => {
      if (n !== model) n.setName(`${model.getName()}__${n.getName()}`);
    });
  }
  wrapper.dispose();
}

// Materials are recreated at runtime (ported Cocos shaders). Keep only the material NAME as a tag
// on the primitive extras so the runtime knows which shader to bind (vehicle / asset / road / shadow).
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '';
    prim.setExtras({ mat: name.split('_')[0] }); // "Vehicle_Red" -> "Vehicle", "Stickman_Green" -> "Stickman"
    prim.setMaterial(null);
    // Shaders never read vertex colors.
    const color = prim.getAttribute('COLOR_0');
    if (color) prim.setAttribute('COLOR_0', null);
    // Stickman shader is matcap-only: no UVs needed.
    if (name.startsWith('Stickman')) prim.setAttribute('TEXCOORD_0', null);
    // Road/ground mask shader and blob shadows are unlit: no normals needed (-1/3 of the road mesh).
    if (name === 'Road' || name === 'FakeShadow') prim.setAttribute('NORMAL', null);
  }
}
for (const m of root.listMaterials()) m.dispose();
for (const t of root.listTextures()) t.dispose();

// Bake the road centerline (bus path) from the spline mesh BEFORE quantization.
writeFileSync(join(OUT, 'road-path.json'), JSON.stringify(extractRoadCenterline(doc)));

await doc.transform(
  resample(), // drop redundant animation keys
  dedup(),
  prune(),
  unpartition(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }), // quantize + filters + EXT_meshopt_compression
);

const glbPath = join(OUT, 'models.glb');
writeFileSync(glbPath, await io.writeBinary(doc));

// ---------------------------------------------------------------- textures
// [file, max size, format]. Masks/data textures stay lossless; size = what the shader really needs.
const TEXTURES = [
  ['Vehicle.png', 256, 'lossless'],
  ['Asset_Texture.png', 64, 'lossless'], // vertical gradient strips: 64px is visually identical
  ['Matcap.png', 128, 'lossless'], // matcap lookups are low-frequency
  ['FakeShadow.png', 128, 'lossless'], // soft blur needs a little resolution
  ['Road_Mask.png', 128, 'lossless'],
  ['slot.png', 128, 'lossless'],
];
for (const [file, size, mode] of TEXTURES) {
  const out = join(OUT, file.replace(/\.png$/, '.webp'));
  await sharp(join(SRC, 'textures', file))
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp(mode === 'lossless' ? { lossless: true, effort: 6, exact: true } : { quality: 85, effort: 6 })
    .toFile(out);
}

rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------------- report
let total = 0;
for (const f of readdirSync(OUT)) {
  const s = statSync(join(OUT, f)).size;
  total += s;
  console.log(`${f.padEnd(24)} ${(s / 1024).toFixed(1).padStart(8)} KB`);
}
console.log(`${'TOTAL'.padEnd(24)} ${(total / 1024).toFixed(1).padStart(8)} KB`);

/**
 * Road centerline from SplineMesh: take the flat asphalt triangles (u≈0.743, y≈0), walk their
 * boundary loop, cut it at the two 2 m end caps into left/right rails, and average the rails
 * (closest-point pairing). Output: [[x, z], ...] from the left road end to the right road end,
 * resampled every 0.25 m.
 */
function extractRoadCenterline(document) {
  const node = document.getRoot().listNodes().find((n) => n.getName() === 'SplineMesh');
  const m = node.getWorldMatrix();
  const prim = node.getMesh().listPrimitives()[0];
  const P = prim.getAttribute('POSITION');
  const UV = prim.getAttribute('TEXCOORD_0');
  const I = prim.getIndices().getArray();
  const world = (i) => {
    const p = P.getElement(i, []);
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  };
  const isSurface = (i) => Math.abs(UV.getElement(i, [])[0] - 0.743) < 0.01 && Math.abs(world(i)[1]) < 0.02;
  const key = (p) => `${p[0].toFixed(3)},${p[2].toFixed(3)}`;

  const edgeCount = new Map();
  const pos = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    if (!tri.every(isSurface)) continue;
    const ks = tri.map((i) => {
      const p = world(i);
      pos.set(key(p), p);
      return key(p);
    });
    for (const [a, b] of [[ks[0], ks[1]], [ks[1], ks[2]], [ks[2], ks[0]]]) {
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
    }
  }
  const adj = new Map();
  for (const [e, n] of edgeCount) {
    if (n !== 1) continue;
    const [a, b] = e.split('|');
    (adj.get(a) ?? adj.set(a, []).get(a)).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)).push(a);
  }
  const start = adj.keys().next().value;
  const loop = [start];
  for (let prev = null, cur = start; ; ) {
    const next = adj.get(cur).find((n) => n !== prev);
    if (!next || next === start) break;
    loop.push(next);
    prev = cur;
    cur = next;
  }
  const L = loop.map((k) => pos.get(k)).map((p) => [p[0], p[2]]);
  const segLen = (i) => Math.hypot(L[(i + 1) % L.length][0] - L[i][0], L[(i + 1) % L.length][1] - L[i][1]);
  const caps = L.map((_, i) => i).sort((a, b) => segLen(b) - segLen(a)).slice(0, 2).sort((a, b) => a - b);
  // rail A: caps[0]+1 .. caps[1] ; rail B: caps[0] .. caps[1]+1 walking backwards
  const railA = L.slice(caps[0] + 1, caps[1] + 1);
  const railB = [];
  for (let i = caps[0]; ; i = (i - 1 + L.length) % L.length) {
    railB.push(L[i]);
    if (i === (caps[1] + 1) % L.length) break;
  }
  const A = resamplePolyline(railA, 0.1);
  const mid = A.map((a) => {
    let best = railB[0];
    let bd = Infinity;
    for (let i = 0; i < railB.length - 1; i++) {
      const q = closestOnSegment(a, railB[i], railB[i + 1]);
      const d = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return [(a[0] + best[0]) / 2, (a[1] + best[1]) / 2];
  });
  let path = resamplePolyline(mid, 0.25);
  // Always run from the end with the smaller x (left on the authoring axis) to the other.
  if (path[0][0] > path[path.length - 1][0]) path.reverse();
  return path.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]);
}

function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return [a[0] + dx * t, a[1] + dz * t];
}

function resamplePolyline(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last);
  return out;
}

function convert(file) {
  const out = join(tmp, basename(file, '.fbx'));
  // bake30: the Cocos clips are authored at 30 fps. The default 24 fps bake samples between keys
  // and FBX Euler curves flip there (leg twist spikes, a -127° knee on the last Walk frame).
  execFileSync(FBX2GLTF, ['--binary', '--anim-framerate', 'bake30', '--input', join(SRC, 'meshes', file), '--output', out], { stdio: 'pipe' });
  return `${out}.glb`;
}
