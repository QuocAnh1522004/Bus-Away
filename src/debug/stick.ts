// DEV-only: `?view=stick[&t=0.3]` — stickman poses side by side with a +Z arrow, viewed from +X,
// for checking facing / clip quality. `t` = Walk clip time.
import { BoxGeometry, Mesh, Vector3 } from 'three';
import type { Assets } from '../engine/assets';
import { createFlatMaterial } from '../engine/materials';
import { Stage } from '../engine/stage';
import { Models } from '../game/models';
import { BG_COLOR, COLORS } from '../game/palette';
import { Passenger } from '../game/Passenger';

export function runStick(assets: Assets) {
  const stage = new Stage(document.getElementById('app')!, BG_COLOR);
  const models = new Models(assets);
  const t = Number(new URLSearchParams(location.search).get('t') ?? 0.3);
  const poses = ['Idle', 'Walk', 'Sit'] as const;
  const people = poses.map((pose, i) => {
    const p = new Passenger(models, (['red', 'blue', 'green'] as const)[i]);
    p.root.position.set(0, 0, (i - 1) * 2);
    p.root.scale.setScalar(1);
    p.play(pose, 0);
    p.update(pose === 'Walk' ? t : 0.5);
    stage.scene.add(p.root);
    return p;
  });
  // +Z arrow (game forward)
  const arrow = new Mesh(new BoxGeometry(0.08, 0.08, 1.6), createFlatMaterial(0xff2222));
  arrow.position.set(0, 0.05, 3.4);
  const tip = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), createFlatMaterial(0xff2222));
  tip.position.set(0, 0.05, 4.3);
  stage.scene.add(arrow, tip);
  stage.autoFit = false;
  const close = new URLSearchParams(location.search).has('close');
  stage.camera.position.set(close ? 3.2 : 9, close ? 1.0 : 1.6, close ? 0 : 0.6);
  stage.camera.lookAt(new Vector3(0, close ? 0.7 : 0.8, close ? 0 : 0.6));
  stage.camera.fov = 40;
  stage.camera.near = 0.1;
  stage.resize();
  stage.start();
  document.getElementById('loading')?.remove();
  if (new URLSearchParams(location.search).has('stress')) stress(models);
  void people;
  void COLORS;
}

/** Random pose switching; reports worst root twist (deg) and minimum summed action weight. */
function stress(models: Models) {
  const p = new Passenger(models, 'red');
  const old = new URLSearchParams(location.search).has('old');
  type A = { reset(): A; play(): A; stop(): A; crossFadeTo(b: A, d: number, w: boolean): A; getEffectiveWeight(): number; isRunning(): boolean };
  const acts = (p as unknown as { actions: Record<string, A> }).actions;
  let cur = 'Idle';
  if (old) p.model.quaternion.set(0, 0.996, 0, -0.092).normalize(); // file rest yaw (pre-fix)
  const oldPlay = (pose: string, fade: number) => {
    if (cur === pose) return;
    acts[pose].reset().play();
    acts[cur].crossFadeTo(acts[pose], fade, false);
    cur = pose;
  };
  const poses = ['Idle', 'Walk', 'Sit'] as const;
  let maxTwist = 0;
  let minWeight = Infinity;
  let next = 0;
  const dt = 1 / 60;
  for (let t = 0; t < 20; t += dt) {
    if (t >= next) {
      const pose = poses[Math.floor(Math.random() * 3)];
      const fade = 0.05 + Math.random() * 0.15;
      if (old) oldPlay(pose, fade);
      else p.play(pose, fade);
      next = t + 0.03 + Math.random() * 0.12;
    }
    p.update(dt);
    const q = p.model.quaternion;
    maxTwist = Math.max(maxTwist, (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI);
    let sum = 0;
    for (const a of Object.values(acts)) if (a.isRunning()) sum += a.getEffectiveWeight();
    minWeight = Math.min(minWeight, sum);
  }
  document.title = `STRESS maxTwist=${maxTwist.toFixed(2)}deg minWeightSum=${minWeight.toFixed(3)}`;
}
