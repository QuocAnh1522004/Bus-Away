import { Mesh, SkinnedMesh, type Object3D, type Material, Color, type AnimationClip } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../engine/assets';
import {
  createAssetMaterial,
  createOutlineMaterial,
  createRoadMaterial,
  createShadowMaterial,
  createStickmanMaterial,
  createVehicleMaterial,
} from '../engine/materials';
import { ROAD_COLORS } from './palette';

/**
 * Model factory: clones nodes out of the merged models.glb and binds the ported materials.
 * Shared materials are created once; per-colour materials are cached by colour.
 */
export class Models {
  private readonly src: Object3D;
  readonly shared: {
    asset: Material;
    road: Material;
    shadow: Material;
  };
  private readonly stickmanMats = new Map<number, Material>();
  private readonly outlineMats = new Map<number, Material>();

  constructor(private readonly assets: Assets) {
    this.src = assets.models;
    this.shared = {
      asset: createAssetMaterial(assets.tex.asset),
      road: createRoadMaterial(assets.tex.road, ROAD_COLORS.light, ROAD_COLORS.dark),
      shadow: createShadowMaterial(assets.tex.shadow),
    };
  }

  private find(name: string) {
    const node = this.src.getObjectByName(name);
    if (!node) throw new Error(`model ${name} missing`);
    return node;
  }

  stickmanMaterial(color: number) {
    let m = this.stickmanMats.get(color);
    if (!m) this.stickmanMats.set(color, (m = createStickmanMaterial(this.assets.tex.matcap, color)));
    return m;
  }

  outlineMaterial(color: number) {
    let m = this.outlineMats.get(color);
    if (!m) {
      const c = new Color(color).multiplyScalar(0.45);
      this.outlineMats.set(color, (m = createOutlineMaterial(c)));
    }
    return m;
  }

  /** Static prop (Ground, SplineMesh, Barrier, Tunnel__1_): materials by primitive tag. */
  prop(name: string) {
    const obj = this.find(name).clone();
    obj.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const tag = m.geometry.userData.mat as string;
      m.material = tag === 'Road' ? this.shared.road : tag === 'FakeShadow' ? this.shared.shadow : this.shared.asset;
      if (tag === 'FakeShadow') m.renderOrder = 1;
    });
    return obj;
  }

  /**
   * Vehicle_04 / _06 / _10 tinted with `color`, with silhouette outline on the body.
   * Each vehicle gets its own material instance (same program, so no extra compile) so per-bus
   * effects like the tap flash don't leak to other buses of the same colour.
   */
  vehicle(seats: 4 | 6 | 10, color: number) {
    const obj = this.find(`Vehicle_${String(seats).padStart(2, '0')}`).clone();
    const body = createVehicleMaterial(this.assets.tex.vehicle, color);
    obj.userData.material = body;
    const outlines: Mesh[] = [];
    obj.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m.geometry.userData.mat === 'FakeShadow') {
        m.material = this.shared.shadow;
        m.renderOrder = 1;
        return;
      }
      m.material = body;
      if (!m.name.includes('__Wheel')) outlines.push(m);
    });
    for (const m of outlines) {
      const hull = new Mesh(m.geometry, this.outlineMaterial(color));
      hull.name = `${m.name}_outline`;
      hull.raycast = () => {};
      m.add(hull);
    }
    return obj;
  }

  /** Skinned stickman (own skeleton) tinted with `color`. */
  stickman(color: number) {
    const obj = cloneSkinned(this.find('Stickman'));
    // The file's rest yaw is ~190°, but every clip keys this node to identity. three.js blends any
    // missing weight during a crossfade with the REST value, which made bodies whip around mid-fade.
    // Match the rest to what the clips expect (facing is applied on a wrapper by Passenger).
    obj.quaternion.identity();
    const mat = this.stickmanMaterial(color);
    const skinned: SkinnedMesh[] = [];
    obj.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m.geometry.userData.mat === 'FakeShadow') {
        m.material = this.shared.shadow;
        m.renderOrder = 1;
      } else {
        m.material = mat;
        m.frustumCulled = false; // skinned bounds are bind-pose only
        if ((m as SkinnedMesh).isSkinnedMesh) skinned.push(m as SkinnedMesh);
      }
    });
    // Silhouette outline (stickman.mtl USE_OUTLINE_PASS): an inverted hull that shares the geometry
    // and is bound to the SAME skeleton, so it deforms with every animation.
    for (const m of skinned) {
      const hull = new SkinnedMesh(m.geometry, this.outlineMaterial(color));
      hull.name = `${m.name}_outline`;
      hull.frustumCulled = false;
      hull.bind(m.skeleton, m.bindMatrix);
      hull.raycast = () => {};
      m.parent!.add(hull);
      hull.position.copy(m.position);
      hull.quaternion.copy(m.quaternion);
      hull.scale.copy(m.scale);
    }
    return obj;
  }

  private readonly clips = new Map<string, AnimationClip>();

  clip(name: string) {
    let c = this.clips.get(name);
    if (c) return c;
    const src = this.assets.clips.find((a) => a.name === name);
    if (!src) throw new Error(`clip ${name} missing`);
    // FBX export stops Walk one frame short of its loop point: close it so the wrap blends.
    c = name === 'Walk' ? closeLoop(src) : src;
    this.clips.set(name, c);
    return c;
  }
}

/** Append frame 0 one frame (1/30 s) after the end of every track, so a looping clip wraps smoothly. */
function closeLoop(src: AnimationClip, fps = 30) {
  const clip = src.clone();
  const end = clip.duration + 1 / fps;
  for (const t of clip.tracks) {
    const n = t.getValueSize();
    const times = new Float32Array(t.times.length + 1);
    times.set(t.times);
    times[t.times.length] = end;
    const values = new Float32Array(t.values.length + n);
    values.set(t.values);
    values.set(t.values.subarray(0, n), t.values.length);
    t.times = times;
    t.values = values;
  }
  clip.duration = end;
  return clip;
}
