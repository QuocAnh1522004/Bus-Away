# Bus Away playable: optimization notes

These notes explain how I kept the playable small and fast, and where I chose to spend bytes on
quality instead. Each variant ships as one HTML file with no external requests.

| Build | Size |
| --- | --- |
| Level 1, packed (`dist/index.html`) | 742.5 KB |
| Level 2, packed (`dist-level2/index.html`) | 742.4 KB |
| Either level, uncompressed fallback | about 1.29 MB |

The smallest network limit I targeted is Meta's 2 MB, so both builds have plenty of headroom.
`npm run build` and `npm run build:level2` reproduce them, and `tools/report-size.mjs` prints the
size against each network's limit after every build.

## Why Three.js

I compared three options before starting:

- Unity WebGL brings a runtime of several MB before any game content. Inlined as base64 it gets a
  third bigger again, and it starts slowly on low-end phones. Tools like Luna help, but need a licence
  and setup time.
- Pixi.js is 2D. The buses turn smoothly along a curved road under a tilted camera, so in 2D I would
  need pre-rendered rotation frames for every bus size and colour. That costs more than the 3D meshes.
- Three.js can render the original low-poly meshes directly. Geometry stays sharp at any screen
  density, and the minified engine is about 620 KB of text, which compresses well (see "Code size and
  packing").

The UI is plain HTML and CSS on top of the canvas, so I didn't need a 2D engine at all.

## Asset pipeline

The art arrived as a Cocos Creator 3.8 project: FBX meshes, PNG textures and custom shaders.
`npm run assets` (`tools/build-assets.mjs`) converts all of it, so the output can be rebuilt at any time.

### Meshes: about 946 KB of FBX down to a 136 KB GLB

1. Convert FBX to glTF with FBX2glTF, then merge everything into one GLB with glTF-Transform, so there
   is one file and one decode at load.
2. Remove data the shaders never read: embedded materials (recreated in code), vertex colours, the
   stickman's UVs, and the normals of the road, ground and shadow meshes, which are drawn unlit. The
   road is the largest mesh, so dropping its normals alone saved about a third of it.
3. Quantize vertex data (positions and normals to 16-bit, UVs to 16-bit, skin weights to 8-bit), then
   compress with meshopt. The meshopt decoder costs about 28 KB and saves much more than that.
4. Bake the stickman animations at 30 fps, the rate they were authored at. The converter's default of
   24 fps sampled between keys and produced a twisted knee on the last walk frame.

A useful side effect of quantization: each mesh is recentred on its own node, so the wheels already
sit on their axles and can spin without any extra pivot setup.

### Textures: about 732 KB of PNG down to 52 KB of WebP

Every texture is encoded as lossless WebP in "exact" mode. Several of them are data masks (tint zones,
road colour selection) rather than pictures, and lossy compression would damage those channels.

| Texture | Source | Shipped | Notes |
| --- | --- | --- | --- |
| Vehicle | 512², 53 KB | 512², 21.9 KB | Kept at full size so bus windows and trims stay crisp |
| Matcap | 1024², 524 KB | 256², 17.9 KB | Smooth lighting gradient, 256 is enough |
| FakeShadow | 512², 60 KB | 256², 7.1 KB | Blurred blob; 128 showed slight stepping |
| Asset_Texture | 512², 83 KB | 64², 2.1 KB | Vertical gradient strips, no visible difference at 64 |
| Parking slot | 180×318, 7.3 KB | 180×318, 1.6 KB | Full size |
| Road mask | 64×128, 2.7 KB | 64×128, 0.9 KB | Full size |

`Stripe.png` is not used by the game, so it isn't shipped.

### Placing and fitting the road

The road model is exported at its own origin, without the offset it had in the Cocos scene. Instead of
placing it by eye, the pipeline finds the two gaps in the parking lot's front curb and the lot's front
edge in the mesh data, then moves the road so its ends sit exactly in those gaps.

The original loop is tall and narrow, so on a 9:16 phone the road only filled part of the width. The
pipeline stretches the road, the lot and the bus path horizontally by 1.3 around the same centre, so the
road ends still line up with the curb gaps. Both shaders are unlit, so the stretch doesn't affect shading.

### Bus path baked at build time

The path the buses drive along is computed from the road mesh during the build: trace the outline of the
asphalt, split it into the left and right edges, and average them. The result is a 1.9 KB JSON file, so
there was no hand-placed path to maintain and nothing to compute when the game starts.

## What is built in code instead of shipped as files

| Feature | How it's made |
| --- | --- |
| Sound effects (tap, boarding, lid, win, lose) | Synthesized with WebAudio from a few oscillators per sound |
| UI, end card, tap-hint hand | HTML, CSS and inline SVG (about 4 KB of CSS), sharp on any screen |
| Station counters and the ROAD counter | Drawn on small canvas textures, redrawn only when the number changes |
| Trees, snowman, signposts | Low-poly geometry generated in code, with trees drawn as one instanced mesh |
| Road centre dashes | One instanced mesh placed along the baked path |
| Confetti when a bus fills | One pooled instanced mesh of up to 270 pieces, a single draw call |
| Level 2's road | Generated in code (see below) |

Level 2 needed a differently shaped road, but the art pack only has one road model. Rather than ship a
second mesh, I measured the original road's cross-section (asphalt, curb, snow bank and curb shadow) and
sweep that profile along a new path made of straight lines and arcs. It shades exactly like the
original. Every bend is wider than the snow bank, so the banks never fold over. The new road costs a few
KB of code and no asset data.

## Where I spent bytes on purpose

Some content is worth its size in an ad:

| Asset | Size | Reason |
| --- | --- | --- |
| Background music (MP3) | 211.6 KB | Trimmed to the 18 s loop and encoded at 96 kbps; music matters for engagement |
| "Road full" sound effect (MP3) | 4.9 KB | A real recorded sound reads better than a synthesized beep |
| Game font, Baloo 2 ExtraBold | 11.0 KB | Same look on every phone; cut down to basic letters, numbers and punctuation |
| End-card logo (WebP) | 15.8 KB | The game's icon |
| Higher-resolution textures | about +27 KB | Sharper buses and parking spots on high-density phones |

Together these roughly doubled the build compared with an earlier version of about 370 KB. I think the
difference is worth it, and 742 KB is still about 37% of Meta's limit.

## Code size and packing

- The five Cocos shaders (vehicle, prop, road, stickman, fake shadow) and the passenger outline are
  re-implemented as small custom shaders with the same maths. The game never uses Three.js lights,
  shadow maps or PBR materials, so that code isn't needed.
- Vite tree-shaking and Terser minification. Debug tools only exist in the dev server and are removed
  from the build.
- Everything is inlined into one HTML file. A small post-build step turns the module script into a
  classic script, because some ad webviews ignore `type="module"`.
- Ad networks limit the raw file size, not the download size, and minified code compresses well. So
  `tools/pack.mjs` stores the bundle as compressed data plus a 3.6 KB decompressor, and unpacks it in one
  pass when the page loads. This takes the build from about 1.29 MB to 742 KB. The gain is smaller than
  it was before the music, because MP3 and WebP data are already compressed.
- The uncompressed version is kept as well, for networks whose validators reject scripts created at
  runtime.

## Runtime performance

- Mid-game, level 1 draws about 147 calls and 53k triangles, and level 2 about 260 calls and 92k
  triangles, with 15 shader programs. Everything is unlit, so each pixel is a texture read and a little
  arithmetic.
- Materials are shared: one per prop type and one outline per colour. Each bus has its own material
  instance only so its tap flash doesn't light up other buses; it uses the same shader, so nothing extra
  is compiled.
- Seated passengers stop animating once they sit down, and are hidden when the bus lid closes.
- All shaders are compiled before the first frame, so the first tap doesn't stutter.
- Rendering resolution is capped at 2× the screen's base resolution. That keeps text and edges sharp
  without the extra GPU cost of rendering at 3× on high-end phones.
- The camera fits the playfield to any aspect ratio (portrait, tablet, landscape) without letterboxing.
- Frame time is clamped so the game doesn't jump after a tab switch, and the game and audio pause when
  the ad is hidden.

## Testing

- `?bot` plays the level automatically with a fixed time step, and `?bot=bad` plays it badly. Level 1
  wins in about 30 s and the bad bot loses at about 17 s; level 2 wins in about 44 s and the bad bot
  loses at about 15 s. This confirms each level can be won, the lose rules work, and the length fits a
  playable.
- `?moves=` and `?time=` override the move and time limits to test those lose paths.
- During development I also ran a temporary check for buses overlapping in the parking lot, and fixed
  the traffic rules until both levels ran without collisions.
- I took headless screenshots (`tools/shot.mjs`) in portrait, square and landscape, and opened the built
  files directly from disk to confirm they run without a server. I haven't profiled on physical phones
  yet.
