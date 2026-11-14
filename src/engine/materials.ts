import {
  BackSide,
  Color,
  ShaderMaterial,
  type Texture,
  type IUniform,
} from 'three';

/**
 * Hand-ported versions of the Cocos Creator effects shipped with the asset pack
 * (assets/shaders/*.effect). They are deliberately tiny unlit ShaderMaterials:
 * no three.js lights, no shadow maps, no PBR — the art style bakes lighting into
 * a hardcoded light direction + matcap, exactly like the original effects.
 *
 * Colour handling mirrors Cocos: inputs flagged `linear: true` in the effect are
 * decoded with the same cheap gamma-2 approximation (x*x) and the result is encoded
 * back with sqrt() (Cocos `SRGBToLinear` / `LinearToSRGB`).
 */

const GAMMA = /* glsl */ `
  vec3 toLinear(vec3 c) { return c * c; }
  vec3 toGamma(vec3 c) { return sqrt(max(c, 0.0)); }
`;

const VERT_WORLD = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vUv = uv;
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const u = <T>(value: T): IUniform<T> => ({ value });

/** vehicle.effect — tinted body with darker/brighter mask zones + raw-texture override via alpha. */
export function createVehicleMaterial(mask: Texture, color: Color | number) {
  return new ShaderMaterial({
    name: 'Vehicle',
    uniforms: {
      map: u(mask),
      color: u(new Color(color)),
      smoothness: u(0.01),
      flash: u(0), // game-feel: white flash on tap / board
    },
    vertexShader: VERT_WORLD,
    fragmentShader: /* glsl */ `
      ${GAMMA}
      uniform sampler2D map;
      uniform vec3 color;
      uniform float smoothness;
      uniform float flash;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vec4 tex = texture2D(map, vUv);
        tex.rgb = toLinear(tex.rgb);
        vec3 base = toLinear(color);
        vec3 mixed = mix(base, base * 0.6, tex.g) + 0.02 * tex.b;
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(vec3(-0.2, 0.9, -0.1));
        float diffuse = clamp(smoothstep(-0.29, 1.1, dot(L, N)), 0.0, 1.0);
        vec3 lit = mix(mixed * 0.5, mixed, diffuse);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 R = reflect(L, N);
        float spec = pow(clamp(smoothstep(-0.1, 1.0, -dot(R, V)), 0.0, 1.0), smoothness * 5.0) * smoothness;
        vec3 c = lit + spec * (1.0 - lit);
        c = mix(c, tex.rgb, tex.a);
        c = mix(c, vec3(1.0), flash);
        gl_FragColor = vec4(toGamma(c), 1.0);
      }
    `,
  });
}

/** asset.effect — props (barrier, sign): gradient-strip atlas, tex^2 in shadow, phong screen spec. */
export function createAssetMaterial(atlas: Texture) {
  return new ShaderMaterial({
    name: 'Asset',
    uniforms: { map: u(atlas), smoothness: u(1.11) },
    vertexShader: VERT_WORLD,
    fragmentShader: /* glsl */ `
      ${GAMMA}
      uniform sampler2D map;
      uniform float smoothness;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 tex = toLinear(texture2D(map, vUv).rgb);
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(vec3(-0.34, 1.0, -0.2));
        float diffuse = clamp(smoothstep(0.2, 1.5, dot(L, N)), 0.0, 1.0);
        vec3 lit = mix(tex * tex, tex, diffuse);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 R = reflect(L, N);
        float spec = pow(clamp(-dot(R, V), 0.0, 1.0), smoothness * 20.0) * smoothness;
        gl_FragColor = vec4(toGamma(lit + spec * (1.0 - lit)), 1.0);
      }
    `,
  });
}

const VERT_UV = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** road.effect — two-colour mask: G picks colour1/colour2, R darkens (curbs, AO). Unlit: no normals. */
export function createRoadMaterial(mask: Texture, color1: number, color2: number) {
  return new ShaderMaterial({
    name: 'Road',
    uniforms: { map: u(mask), color1: u(new Color(color1)), color2: u(new Color(color2)) },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      ${GAMMA}
      uniform sampler2D map;
      uniform vec3 color1;
      uniform vec3 color2;
      varying vec2 vUv;
      void main() {
        vec2 m = texture2D(map, vUv).rg;
        vec3 col = mix(color2, color1, m.g);
        col = mix(col * col * 0.3, col, m.r);
        gl_FragColor = vec4(toGamma(col), 1.0);
      }
    `,
  });
}

/** stickman.effect — matcap: R blends dark/light tint, G adds a screen-blended highlight. */
export function createStickmanMaterial(matcap: Texture, color: Color | number) {
  return new ShaderMaterial({
    name: 'Stickman',
    uniforms: {
      matcap: u(matcap),
      color: u(new Color(color)),
      multiply: u(2.3),
      spec: u(0.15),
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vViewNormal;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vViewNormal = normalize(normalMatrix * objectNormal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GAMMA}
      uniform sampler2D matcap;
      uniform vec3 color;
      uniform float multiply;
      uniform float spec;
      varying vec3 vViewNormal;
      void main() {
        vec2 muv = normalize(vViewNormal).xy * 0.5 + 0.5;
        vec4 m = texture2D(matcap, muv);
        vec3 c = toLinear(color);
        vec3 base = mix(c * multiply, c + 0.15, m.r);
        vec3 hi = c + spec;
        vec3 outC = mix(base, base + hi * (1.0 - base), m.g);
        gl_FragColor = vec4(toGamma(outC), 1.0);
      }
    `,
  });
}

/** FakeShadow.effect — blob shadow quads: alpha = (1 - mask.r) * colour.a. */
export function createShadowMaterial(mask: Texture, opacity = 104 / 255) {
  return new ShaderMaterial({
    name: 'FakeShadow',
    uniforms: { map: u(mask), opacity: u(opacity) },
    transparent: true,
    depthWrite: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        float r = texture2D(map, vUv).r;
        r *= r;
        gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - r) * opacity);
      }
    `,
  });
}

/**
 * Silhouette-edge pass (Cocos `USE_OUTLINE_PASS`): inverted hull, object-space normal extrusion,
 * front faces culled. lineWidth 22.2 in the materials -> 0.0222 units.
 */
export function createOutlineMaterial(color: Color | number, width = 0.0222) {
  return new ShaderMaterial({
    name: 'Outline',
    side: BackSide,
    uniforms: { color: u(new Color(color)), width: u(width) },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      uniform float width;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        transformed += normalize(objectNormal) * width;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }
    `,
  });
}

/** Flat unlit colour (road dashes, debug markers). Instancing-aware. */
export function createFlatMaterial(color: number, opacity = 1) {
  return new ShaderMaterial({
    name: 'Flat',
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    uniforms: { color: u(new Color(color)), opacity: u(opacity) },
    vertexShader: /* glsl */ `
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      void main() { gl_FragColor = vec4(color, opacity); }
    `,
  });
}

/** Textured unlit quad with alpha (parking slot decal). */
export function createDecalMaterial(map: Texture, color: number, opacity = 1) {
  return new ShaderMaterial({
    name: 'Decal',
    transparent: true,
    depthWrite: false,
    uniforms: { map: u(map), color: u(new Color(color)), opacity: u(opacity) },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(color * t.rgb, t.a * opacity);
      }
    `,
  });
}
