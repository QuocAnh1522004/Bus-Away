import fontUrl from '../assets/gen/game-font.woff2?url';

/**
 * Game font: Baloo 2 ExtraBold (SIL OFL), subset to printable ASCII by tools/build-assets.mjs and
 * inlined as a data URI. Loaded before the first frame so the canvas-drawn signs (station counters,
 * ROAD counter) use it from their first draw; falls back to the system font if it fails.
 */
export const GAME_FONT = '"Baloo2Game", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function loadGameFont(): Promise<void> {
  if (typeof FontFace === 'undefined') return Promise.resolve();
  const face = new FontFace('Baloo2Game', `url(${fontUrl}) format("woff2")`, { weight: '100 900' });
  const load = face
    .load()
    .then((f) => void document.fonts.add(f))
    .catch(() => {});
  // never hold the ad back for a font
  return Promise.race([load, new Promise<void>((r) => setTimeout(r, 1500))]);
}
