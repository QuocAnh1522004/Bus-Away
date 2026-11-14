import { ColorManagement, Vector3 } from 'three';
import { loadAssets } from './engine/assets';
import { sfx } from './engine/sfx';
import { Stage } from './engine/stage';
import { Game } from './game/Game';
import { Hud } from './game/Hud';
import { LEVEL } from './game/level';
import { BG_COLOR } from './game/palette';
import { onVisibilityChange, openStore, whenAdReady } from './playable/sdk';

// Shaders are ported 1:1 from Cocos and do their own colour decoding — keep Color values raw.
ColorManagement.enabled = false;

declare global {
  interface Window {
    __loadProgress?: (p: number) => void;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const view = import.meta.env.DEV ? params.get('view') : null;

  const assets = await loadAssets((p) => window.__loadProgress?.(p * 0.9));

  if (view) {
    const { runDebugView } = await import('./debug/views');
    return runDebugView(view, assets);
  }

  await whenAdReady();
  const stage = new Stage(document.getElementById('app')!, BG_COLOR);
  const hud = new Hud(LEVEL.capacity);
  stage.insets = () => hud.safeInsets(); // gameplay framing stays clear of the UI bars
  let game = new Game(stage, assets, hud);

  hud.onCta = () => {
    sfx.unlock();
    openStore();
  };
  hud.onRetry = () => {
    hud.hideEnd();
    game.dispose();
    game = new Game(stage, assets, hud);
    sfx.startMusic();
  };

  stage.renderer.domElement.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.tap(e.clientX, e.clientY);
  });

  let paused = false;
  onVisibilityChange((visible) => {
    paused = !visible;
    sfx.setPaused(paused);
  });
  stage.onUpdate = (dt) => {
    if (!paused) game.update(dt);
  };
  if (import.meta.env.DEV && params.has('cam')) {
    // ?cam=x,y,z,tx,ty,tz — inspection camera for screenshots
    const [x, y, z, tx, ty, tz] = params.get('cam')!.split(',').map(Number);
    stage.autoFit = false;
    stage.camera.position.set(x, y, z);
    stage.camera.lookAt(tx, ty, tz);
    stage.camera.near = 0.1;
    stage.camera.updateProjectionMatrix();
  }
  if (import.meta.env.DEV && params.has('bot')) {
    // Headless browsers throttle rAF: the bot steps the simulation itself with a fixed dt.
    stage.onUpdate = () => {};
    const { runBot } = await import('./debug/bot');
    runBot(() => game, Number(params.get('speed') ?? 1));
    (window as unknown as { __info: () => string }).__info = () => {
      const i = stage.renderer.info;
      return `calls=${i.render.calls} tris=${i.render.triangles} progs=${i.programs?.length} geo=${i.memory.geometries} tex=${i.memory.textures}`;
    };
  }

  if (import.meta.env.DEV && params.has('measure')) setTimeout(() => {
    // px per world metre at the bus columns and at the far road / queues (9:16 camera tuning)
    const px = (x: number, z: number) => {
      const a = new Vector3(x, 0, z).project(stage.camera);
      const b = new Vector3(x + 1, 0, z).project(stage.camera);
      return (Math.abs(b.x - a.x) / 2) * stage.width;
    };
    const fp = (window as unknown as { __fitPts: Vector3[] }).__fitPts;
    let l = 9, r = -9, t = -9, b = 9;
    for (const p of fp) {
      const q = p.clone().project(stage.camera);
      l = Math.min(l, q.x); r = Math.max(r, q.x); t = Math.max(t, q.y); b = Math.min(b, q.y);
    }
    const ins = stage.insets();
    document.title = `NDC l=${l.toFixed(2)} r=${r.toFixed(2)} t=${t.toFixed(2)} b=${b.toFixed(2)} insets=${ins.top.toFixed(2)}/${ins.bottom.toFixed(2)} aspect=${stage.camera.aspect.toFixed(3)} | MEASURE buses=${px(0, -9).toFixed(1)}px/m road=${px(0, 14).toFixed(1)}px/m fit=${(window as unknown as { __fit: string }).__fit}`;
    const d = document.createElement('pre');
    d.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;margin:0;padding:4px;font:11px monospace;background:#000c;color:#0f0;white-space:pre-wrap';
    d.textContent = document.title.replaceAll(' | ', '\n');
    document.body.appendChild(d);
  }, 1500);

  // Warm-up: compile every shader before the first visible frame (no hitch on first tap).
  stage.renderer.compile(stage.scene, stage.camera);
  stage.start();

  window.__loadProgress?.(1);
  const loading = document.getElementById('loading');
  loading?.classList.add('hide');
  setTimeout(() => loading?.remove(), 300);
}

if (import.meta.env.DEV) {
  const show = (msg: string) => {
    const d = document.createElement('pre');
    d.style.cssText = 'position:fixed;left:0;top:0;z-index:99;color:#fff;background:#c00;font:12px monospace;white-space:pre-wrap;margin:0;padding:6px';
    d.textContent = msg;
    document.body.appendChild(d);
  };
  window.addEventListener('error', (e) => show(String(e.error?.stack ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => show(String(e.reason?.stack ?? e.reason)));
}

void boot();
