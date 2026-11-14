/** Gameplay colours. Values are sRGB hex; shaders decode them like the Cocos originals. */
export const COLORS = {
  red: 0xe8303a,
  blue: 0x2f8cff,
  green: 0x37c94a,
  yellow: 0xffc21a,
  purple: 0x9a3cff,
  orange: 0xff7a1a,
} as const;

export type ColorName = keyof typeof COLORS;

/** road.mtl colour1 / colour2 (snow / asphalt). */
export const ROAD_COLORS = {
  light: 0xb9c7f3,
  dark: 0x56637d,
};

export const BG_COLOR = 0xcfe6ff;
