# Optimization report — Bus Away playable

**Final build: `dist/index.html` = 370.7 KB**, a single file with no external requests.
It fits every major network limit, including Meta's 2 MB.

| | Size |
| --- | --- |
| Source art (FBX 968 KB + PNG 750 KB) | 1,718 KB |
| Runtime assets after the pipeline (GLB + WebP + path JSON) | **161 KB** (−90.6 %) |
| Single-file build, uncompressed (`index.uncompressed.html`) | 912.4 KB |
| Single-file build, self-extracting (`index.html`) | **370.7 KB** (−59 % vs uncompressed) |

Run `npm run build` to reproduce. `tools/report-size.mjs` prints the breakdown and checks it against each network's limit.

---

## 1. Engine choice: Three.js, not Unity or Pixi

- **Unity WebGL** ships a multi-MB runtime (wasm + data + loader) before any game content. When inlined
  as base64 into one HTML file it grows another 33 %, starts slowly and uses a lot of memory on low-end
  phones. The usual way around that (Luna) needs a licence and setup time.
- **Pixi.js** is 2D. Buses turn continuously along a curved road under a tilted camera, so faking that
  needs pre-rendered rotation frames for every bus size and colour. That costs far more bytes than the
  meshes themselves, and higher resolution means bigger textures.
- **Three.js** renders the original low-poly meshes. Geometry stays sharp at any device pixel ratio for free,
  and the whole engine minifies to about 620 KB, which compresses well (see §4).

No 2D engine is bundled: the UI is plain HTML/CSS (see §3).

## 2. Asset pipeline (`npm run assets` → `tools/build-assets.mjs`)

The art came as a **Cocos Creator 3.8 project**: FBX meshes, PNG textures and custom `.effect` shaders.
The pipeline is fully scripted and reproducible.

### Meshes: 968 KB FBX → 134.6 KB GLB

1. **FBX → glTF** with FBX2glTF.
2. **Merge into one GLB** with glTF-Transform. One request, one decoder pass, shared buffers. The
   `RootNode` wrappers are flattened and node names are namespaced (`Vehicle_06__Lid`), because
   GLTFLoader renames duplicates.
3. **Strip what the shaders never read:**
   - Embedded materials and texture references are dropped; materials are recreated at runtime.
   - Vertex colours are dropped.
   - The stickman's UVs are dropped (its shader is matcap-only).
   - **Normals are dropped on the road, ground and blob-shadow quads**, which use unlit shaders. That
     saves a third of the road mesh, the largest asset (5,250 vertices).
4. **Quantization** (KHR_mesh_quantization): positions/normals → int16, UVs → uint16, skin weights → uint8.
5. **meshopt compression** (EXT_meshopt_compression, `high` level with octahedral normal filters).
   The decoder is about 28 KB, which pays for itself several times over.
6. **Animation baking at 30 fps** (`--anim-framerate bake30`), the clips' authoring rate. FBX2glTF's
   default 24 fps bake samples between source keys, where the FBX Euler curves flip. That produced leg
   twist spikes and a −127° knee on the last Walk frame. Then redundant keyframes are removed
   (`resample`), and Walk is closed back to frame 0 at runtime so it loops seamlessly.
7. **A free win:** quantization recentres each mesh on its own node. The wheel nodes therefore sit on
   their axles, so wheels can spin without any re-pivoting.

### Textures: 750 KB PNG → 24.5 KB WebP

Each texture is resized to the resolution the shader actually samples. All are encoded as **lossless WebP
with `exact` mode**: they are data masks (vehicle tint zones in G/A, road mask in R/G), so lossy
compression or premultiplied-alpha cleanup would corrupt the channels.

| Texture | Before | After | Why it's safe |
| --- | --- | --- | --- |
| Matcap 1024² | 536 KB | **6.6 KB** (128²) | Matcap lookups are low-frequency gradients |
| Asset_Texture 512² | 85 KB | 2.1 KB (64²) | Vertical gradient strips |
| FakeShadow 512² | 62 KB | 2.6 KB (128²) | Blurred blobs |
| Vehicle mask 512² | 55 KB | 8.3 KB (256²) | Tint zones + wheel art |
| Road mask, slot | 10 KB | 4.6 KB | — |

`Stripe.png` was unused and is not shipped.

### Road placement, measured instead of eyeballed

In the Cocos scene the road prefab carries an offset; FBX2glTF exports each mesh at its own origin.
The pipeline finds the two road gaps in the lot's front curb (as holes in the x-coverage of the raised
curb triangles: x = ±4.40, each 2.02 m wide) and the lot edge (z = 1.011). It then moves the road so its
2.02 m end caps sit in the gaps, flush with the edge (dx = +1.905, dz = −0.719).

### Baked data instead of runtime work

The **road centerline (bus path)** is computed at build time from the spline mesh: walk the boundary loop
of the asphalt triangles, cut it at the two end caps into left and right rails, then average them. That
produces 1.9 KB of JSON. No path editor, no hand-placed waypoints, and nothing to compute at runtime.

## 3. Zero-byte content

| Feature | Usual approach | Here |
| --- | --- | --- |
| Sound effects | MP3/OGG files (tens of KB each) | **WebAudio synthesis**: a few oscillators per cue, 0 bytes of audio |
| UI, end card, hand cursor | Sprite atlases + bitmap fonts | **HTML/CSS + inline SVG**: sharp at any DPR, about 4 KB of CSS |
| Station counters, signposts | Number sprites + sign model | **Canvas-texture digits** on a procedural signpost, redrawn only on change |
| Trees, snowman | Extra models + textures | **Procedural low-poly geometry** with vertex colours, merged and instanced |
| Road centre dashes | Texture or extra mesh | One **InstancedMesh** of quads along the baked path |
| Confetti | Particle textures | CSS animation |

## 4. Code size

- **Ported shaders instead of three.js built-in materials.** The five Cocos effects (vehicle, asset,
  road, stickman matcap, fake shadow) plus the silhouette-outline pass are re-implemented as small
  `ShaderMaterial`s with the same maths. The look matches the source project, and the game never
  touches lights, shadow maps or PBR.
- Vite/Rolldown tree-shaking and Terser (3 passes, `drop_console`, no comments). Debug tools sit
  behind `import.meta.env.DEV` and are removed from production.
- **Single file** via `vite-plugin-singlefile`. A post step converts the module script into a classic
  IIFE, because some MRAID webviews ignore `type="module"`.
- **Self-extracting packer** (`tools/pack.mjs`). Ad networks limit the **raw** file size, not the
  transfer size, and minified three.js plus base64 assets deflate very well. So the bundle is stored as
  `base64(deflateRaw(bundle))` with a **3.6 KB inflater** (fflate's `inflateSync` only). At boot it is
  inflated (a single synchronous pass over ~270 KB; not profiled on devices yet) and injected as a classic script.
  Result: **912.4 KB → 370.7 KB**.
  `dist/index.uncompressed.html` is kept for networks whose validators reject runtime script injection.

## 5. Runtime performance

- About **115 draw calls / 47k triangles** mid-game, 10 shader programs. Everything is unlit, so
  fragment cost is a texture fetch and a few multiply-adds.
- **Shared materials**: one per prop type and one outline per colour. Buses get their own material
  *instance* only so the tap flash stays local; it uses the same program, so there's no extra compile.
- **Instancing** for trees and road dashes.
- **Seated passengers stop costing CPU and draw calls.** Once seated, their `AnimationMixer` freezes
  on the Sit pose. When the lid closes they are hidden.
- **Shader warm-up**: `renderer.compile()` runs before the first visible frame, so the first tap
  doesn't hitch.
- **DPR capped at 2**: retina-sharp without paying 9× fill-rate on 3× phones.
- **Camera fit** to the important points (road, queues, lot) for any aspect ratio: portrait, tablet
  and landscape all work with no letterboxing logic.
- Delta time is clamped (no simulation jumps after a tab switch). The game pauses (logic and audio)
  when hidden or not viewable.
- Hot paths reuse scratch vectors; arc-length lookups are binary searches.

## 6. How it was verified

- `?bot` autoplay (fixed-step simulation) finishes the level in **~48 s**. `?bot=bad` loses at **~27 s**.
  This checks that the level is solvable, that the lose rule works, and that the length fits the brief's
  30–60 s.
- Headless screenshots (`tools/shot.mjs`) at 540×960, 768×1024 and 960×540. The **built** file was
  also loaded from `file://` (packed and uncompressed) to confirm it runs with no server.
