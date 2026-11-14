# Bus Away — Playable Ad (Three.js)

A playable ad for **Bus Away**: send colour-matched buses around a loop to pick up queuing passengers.
It ships as a single self-contained `index.html` (**~370 KB**), built with Three.js + TypeScript + Vite.

> Optimization write-up: **[OPTIMIZATION.md](OPTIMIZATION.md)**

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/index.html (packed, ~370 KB) + dist/index.uncompressed.html (~910 KB)
npm run assets       # rebuild src/assets/gen/ from art-src/ (FBX/PNG -> GLB/WebP + road path)
npm run typecheck
```

## Gameplay (rules from the brief)

| Brief | Implementation |
| --- | --- |
| Buses wait in columns, one colour each, 4 / 6 / 10 seats | `LEVEL.columns` in [src/game/level.ts](src/game/level.ts); models `Vehicle_04/06/10` |
| Only the **front** bus of a column can go; tap to send it | `Game.tryLaunch` (non-front -> shake + toast) |
| Max buses on the road = **CAPACITY** | `LEVEL.capacity` (3), HUD "ROAD" pill, refused taps flash it |
| Stations spawn passengers in a single queue | `Station` (8 visible, the rest counted on the sign) |
| A passenger boards only if: head of queue + same colour + free seat | `Game.canBoard` / `Game.board` |
| Buses drive clockwise and stop only when they can board | `Game.updateTraffic` (decides ~2.6 m before the stop, brakes smoothly) |
| Full -> close lid -> gate -> leave, CAPACITY -1 | `Bus.closeLid`, `Game.leaveThroughGate` |
| Not full after a lap -> first free parking slot | `Game.roadEnd` (backs into the slot) |
| Win: every bus left · Lose: lap finished, not full, no free slot | `Game.checkWin` / `Game.lose` |

Parked buses can be tapped again to do another lap. One level takes about 45–50 s with sensible play
(`?bot` below plays it in ~48 s; a colour-blind bot loses at ~27 s).

**Game feel:** squash-and-stretch on tap, white flash, smooth accel/brake curves, wheel spin, pitch on
braking, passengers hop into their seats with rising-pitch blips, the lid drops on with a bounce, the gate
arm swings, the queue shuffles forward, counters pop, hint hand after 3 s idle, confetti end card.
Sounds are synthesized with WebAudio (no audio files).

## Project layout

```
art-src/              original art from the Cocos Creator project (FBX + PNG)
tools/
  build-assets.mjs    FBX -> merged, quantized, meshopt GLB; textures -> WebP; bakes road centerline
  pack.mjs            post-build self-extracting packer (deflate + tiny inflater)
  report-size.mjs     size report vs ad-network limits
  shot.mjs            headless screenshot of the dev server (used for visual checks)
  inspect-glb.mjs     prints GLB node tree / bounds / animations
src/
  main.ts             boot: load -> MRAID ready -> game loop
  engine/             Stage (renderer/camera fit), Path, Tweens, ported shaders, procedural props, sfx
  game/               Game (rules), Bus, Station, Passenger, World, Hud, level data, palette
  playable/sdk.ts     CTA + lifecycle for MRAID / Meta / ironSource / Google / Mintegral
  debug/              DEV-only tools (tree-shaken from production)
```

### UI architecture

The UI is a DOM layer (`#ui`) fully decoupled from the WebGL canvas
([src/game/Hud.ts](src/game/Hud.ts)):

- `.world`: screen-space widgets anchored to 3D points (station counters, hint hand), projected each frame.
- `.frame`: a **design-resolution container**, 1080×1920 in portrait and 3413×1920 in landscape.
  It is uniformly scaled to fit and centred. All HUD layout (ROAD pill, tip, toast, PLAY NOW, end card)
  is in design pixels, so it looks identical on any aspect ratio. The CTA is bottom-centre in portrait
  and bottom-right in landscape.
- `Hud.safeInsets()` reports the screen bands the HUD occupies. The 3D camera fit
  (`Stage.fitCamera`) keeps gameplay inside the free band, so the two layers never overlap.

### Dev tools (dev server only)

- `?bot&speed=4` plays the level automatically and writes the result into `document.title`.
  `?bot=bad` plays badly, to exercise the lose path. `&snap=12` freezes the sim at t = 12 s.
- `?cam=x,y,z,tx,ty,tz` overrides the camera for close-up inspection.
- `?view=layout` shows the environment with the baked road path drawn as markers.
- `?view=stick[&close&t=0.4]` shows stickman poses side by side. `&stress` runs a crossfade stress test
  that reports the worst body twist and the minimum total animation weight.
- `node tools/shot.mjs "?bot&speed=4&snap=8" shots/x.png 540 960` takes a headless screenshot.

### Authoring axis note

The camera looks from −Z toward +Z, so **screen-right is world −X**. The road centerline is baked from
the art's spline mesh, left to right on the authoring axis, and played in reverse so buses drive
clockwise on screen.

## Ad-network notes

- `openStore()` tries, in order: Mintegral `install()`, Meta `FbPlayableAd.onCTAClick()`, ironSource
  `dapi.openStoreUrl()`, Google `ExitApi.exit()`, MRAID `mraid.open(url)`, then falls back to `window.open`.
- The game starts after MRAID `ready` + `viewable`. It pauses (game time and audio) when hidden.
- `gameEnd()` is called on win/lose.
- Store URLs in [src/playable/sdk.ts](src/playable/sdk.ts) are placeholders.
- `index.html` references `mraid.js` (AppLovin / Unity style). Remove that tag for networks that
  reject external script references (Meta, Google).
- Use `dist/index.uncompressed.html` for networks whose validators reject runtime script injection.

Assets © iKame — used only for this test.
