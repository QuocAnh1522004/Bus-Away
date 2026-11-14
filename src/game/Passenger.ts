import { AnimationMixer, Group, type AnimationAction, type Object3D } from 'three';
import type { Models } from './models';
import { COLORS, type ColorName } from './palette';

export type Pose = 'Idle' | 'Walk' | 'Sit';

export const STAND_SCALE = 0.82;
/** Yaw that turns the art's rest facing into the game's +Z forward. */
export const FACING = 0;
export const SEAT_SCALE = 0.5;

/** A stickman: skinned clone + its own mixer. `root` is what the game moves/rotates. */
export class Passenger {
  readonly root = new Group();
  readonly model: Object3D;
  readonly mixer: AnimationMixer;
  private readonly actions: Record<Pose, AnimationAction>;
  private current: Pose | null = null;

  constructor(
    models: Models,
    readonly color: ColorName,
  ) {
    this.model = models.stickman(COLORS[color]);
    // Every clip keys the model root's rotation (to identity), so facing must live on a wrapper,
    // never on the animated node itself.
    const facing = new Group();
    facing.rotation.y = FACING;
    facing.add(this.model);
    this.root.add(facing);
    this.root.scale.setScalar(STAND_SCALE);
    this.mixer = new AnimationMixer(this.model);
    this.actions = {
      Idle: this.mixer.clipAction(models.clip('Idle')),
      Walk: this.mixer.clipAction(models.clip('Walk')),
      Sit: this.mixer.clipAction(models.clip('Sit')),
    };
    this.play('Idle', 0);
    // De-sync idles so a queue doesn't breathe in unison.
    this.actions.Idle.time = Math.random() * this.actions.Idle.getClip().duration;
  }

  /**
   * Crossfade to `pose`. Any third action still fading from an interrupted transition is stopped,
   * and the outgoing action restarts its fade from full weight, so weights always sum to 1
   * (a sum < 1 makes three.js blend toward the bind pose = visible popping).
   */
  play(pose: Pose, fade = 0.15) {
    if (this.current === pose) return;
    const next = this.actions[pose];
    const prev = this.current ? this.actions[this.current] : null;
    for (const a of Object.values(this.actions)) if (a !== next && a !== prev) a.stop();
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) {
      prev.stopFading().setEffectiveWeight(1);
      prev.crossFadeTo(next, fade, false);
    } else prev?.stop();
    this.current = pose;
  }

  /** Bumped on every new move tween, so a superseded tween's completion is ignored. */
  moveId = 0;

  /** Seated passengers freeze on the Sit pose: evaluate once, then stop ticking the mixer. */
  frozen = false;

  update(dt: number) {
    if (!this.frozen) this.mixer.update(dt);
  }
}
