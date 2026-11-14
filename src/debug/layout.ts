// DEV-only: `?view=layout` — game camera + environment + road path markers, for placing level props.
import { BoxGeometry, Mesh, Vector3, AnimationMixer } from 'three';
import type { Assets } from '../engine/assets';
import { createFlatMaterial } from '../engine/materials';
import { Path } from '../engine/path';
import { Stage } from '../engine/stage';
import { Models } from '../game/models';
import { BG_COLOR, COLORS } from '../game/palette';
import roadPath from '../assets/gen/road-path.json';

export function runLayout(assets: Assets) {
  const stage = new Stage(document.getElementById('app')!, BG_COLOR);
  const models = new Models(assets);
  stage.scene.add(models.prop('Ground_01'), models.prop('SplineMesh'));
  const path = Path.fromXZ(roadPath.path, 0.05);
  const box = new BoxGeometry(0.25, 0.25, 0.25);
  for (let s = 0; s <= path.length; s += 1) {
    const k = s / path.length;
    const m = new Mesh(box, createFlatMaterial(s % 5 === 0 ? 0x000000 : (Math.round(255 * k) << 16) | (Math.round(255 * (1 - k)) << 8)));
    m.position.copy(path.pointAt(s));
    stage.scene.add(m);
  }
  // origin + axis markers
  const ax = new Mesh(new BoxGeometry(2, 0.1, 0.1), createFlatMaterial(0xff0000));
  ax.position.set(1, 0.1, 0);
  stage.scene.add(ax);
  const az = new Mesh(new BoxGeometry(0.1, 0.1, 2), createFlatMaterial(0x0000ff));
  az.position.set(0, 0.1, 1);
  stage.scene.add(az);

  const b4 = models.vehicle(4, COLORS.red);
  b4.position.set(0, 0, -8);
  const b6 = models.vehicle(6, COLORS.blue);
  b6.position.set(2.5, 0, -8);
  const b10 = models.vehicle(10, COLORS.green);
  b10.position.set(-2.5, 0, -8);
  stage.scene.add(b4, b6, b10);
  const st = models.stickman(COLORS.purple);
  st.position.set(-5, 0, -3);
  stage.scene.add(st);
  const mixer = new AnimationMixer(st);
  mixer.clipAction(models.clip('Idle')).play();
  mixer.update(0.5);

  stage.frame([new Vector3(-7.5, 0, -17.5), new Vector3(7.5, 0.5, 17.3)]);
  stage.start();
  if (location.search.includes('close')) {
    stage.autoFit = false;
    if (location.search.includes('front')) stage.camera.position.set(3, 4, -3); else stage.camera.position.set(-4, 5, -14);
    stage.camera.lookAt(0, 0.5, -8);
    stage.camera.fov = 40;
    stage.camera.near = 0.1;
    stage.camera.updateProjectionMatrix();
    for (const b of [b4, b6, b10]) b.getObjectByName(b.name + '__Lid')!.visible = false;
    if (location.search.includes('top')) { stage.camera.position.set(0, 9, -8.3); stage.camera.lookAt(0, 0, -8); }
  }
  document.getElementById('loading')?.remove();
  (window as any).__stage = stage;
}
