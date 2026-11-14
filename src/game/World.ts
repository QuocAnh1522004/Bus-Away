import { Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type Object3D } from 'three';
import { createDecalMaterial, createFlatMaterial } from '../engine/materials';
import type { Path } from '../engine/path';
import { createPropMaterial, pineGeometry, snowmanGeometry } from '../engine/procedural';
import { ease, type Tweens } from '../engine/tween';
import type { Assets } from '../engine/assets';
import { LEVEL, LOT } from './level';
import type { Models } from './models';

/** Static environment: lot, road, gate barrier, parking decals. */
export class World {
  readonly group = new Group();
  private readonly gateArm: Object3D;
  private gateUsers = 0;
  private gateAngle = 0;
  readonly slotDecals: Mesh[] = [];

  constructor(parent: Object3D, models: Models, assets: Assets, road: Path, private readonly tweens: Tweens) {
    this.group.add(models.prop('Ground_01'), models.prop('SplineMesh'));
    this.addRoadDashes(road);
    this.addScenery();

    // Gate barrier: post on the lot edge, arm across the exit lane. Re-pivot the arm on its hinge.
    const barrier = models.prop('Barrier');
    barrier.position.copy(LOT.gate);
    barrier.rotation.y = Math.PI; // arm points +Z, across the lane
    const arm = barrier.getObjectByName('Barrier__Barrier_Open')!;
    const hinge = new Group();
    hinge.position.set(0, arm.position.y, 0);
    arm.position.y = 0;
    arm.parent!.add(hinge);
    hinge.add(arm);
    this.gateArm = hinge;
    this.group.add(barrier);

    // Parking slot decals.
    const slotGeo = new PlaneGeometry(1.8, 3.2);
    slotGeo.rotateX(-Math.PI / 2);
    const slotMat = createDecalMaterial(assets.tex.slot, 0xffffff, 0.55);
    for (const x of LEVEL.slots) {
      const d = new Mesh(slotGeo, slotMat);
      d.position.set(x, 0.015, LOT.slotZ);
      d.rotation.y = Math.PI; // "P" reads upright from the camera
      d.renderOrder = 0;
      this.slotDecals.push(d);
      this.group.add(d);
    }
    parent.add(this.group);
  }

  /** White centre-line dashes along the loop: one InstancedMesh. */
  private addRoadDashes(road: Path) {
    const geo = new PlaneGeometry(0.11, 0.42);
    geo.rotateX(-Math.PI / 2);
    const step = 0.95;
    const count = Math.floor((road.length - 1.6) / step);
    const mesh = new InstancedMesh(geo, createFlatMaterial(0xf4f7ff, 0.9), count);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const s = 0.8 + i * step;
      const p = road.pointAt(s).setY(0.012);
      const t = road.tangentAt(s);
      q.setFromAxisAngle(up, Math.atan2(t.x, t.z));
      m.compose(p, q, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  /** Snowy pines + a snowman inside the loop and around the lot (procedural, instanced). */
  private addScenery() {
    // [x, z, scale] — inside the loop, and outside it clear of the station queues
    const trees: [number, number, number][] = [
      [1.0, 3.9, 1.0], [2.3, 7.9, 1.15], [0.2, 11.1, 0.9], [-0.4, 5.9, 0.75], [2.0, 11.9, 0.7],
      [-6.9, 8.4, 1.1], [-7.6, 11.9, 0.9], [7.4, 12.7, 1.0], [8.4, 3.3, 0.9],
    ];
    const mat = createPropMaterial();
    const pines = new InstancedMesh(pineGeometry(), mat, trees.length);
    const m = new Matrix4();
    const q = new Quaternion();
    trees.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), i * 1.7);
      m.compose(new Vector3(x, 0, z), q, new Vector3(s, s, s));
      pines.setMatrixAt(i, m);
    });
    this.group.add(pines);
    const snowman = new Mesh(snowmanGeometry(), mat);
    snowman.position.set(0.8, 0, 7.5);
    snowman.rotation.y = Math.PI + 0.4;
    snowman.scale.setScalar(0.75);
    this.group.add(snowman);
  }

  /** Reference-counted: the arm stays up while any bus is passing. */
  openGate() {
    if (this.gateUsers++ === 0) this.swingGate(1);
  }

  closeGate() {
    this.gateUsers = Math.max(0, this.gateUsers - 1);
    if (this.gateUsers === 0) this.swingGate(0);
  }

  private swingGate(target: number) {
    const from = this.gateAngle;
    this.tweens.kill(this.gateArm);
    void this.tweens.to(
      0.35,
      (k) => {
        this.gateAngle = from + (target - from) * k;
        this.gateArm.rotation.x = -this.gateAngle * 1.35;
      },
      { ease: target ? ease.outBack : ease.outBounce, owner: this.gateArm },
    );
  }

  /** Pulse a slot decal (where a bus is heading). */
  pulseSlot(i: number) {
    const d = this.slotDecals[i];
    if (!d) return;
    void this.tweens.to(0.4, (k) => d.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.12), { ease: ease.linear });
  }
}
