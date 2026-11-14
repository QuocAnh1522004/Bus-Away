import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, type Object3D, type AnimationClip, Texture, TextureLoader, ClampToEdgeWrapping, RepeatWrapping } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// All of these resolve to base64 data URIs in the production build (single-file HTML).
import modelsUrl from '../assets/gen/models.glb?url';
import vehicleUrl from '../assets/gen/Vehicle.webp?url';
import assetUrl from '../assets/gen/Asset_Texture.webp?url';
import matcapUrl from '../assets/gen/Matcap.webp?url';
import shadowUrl from '../assets/gen/FakeShadow.webp?url';
import roadUrl from '../assets/gen/Road_Mask.webp?url';
import slotUrl from '../assets/gen/slot.webp?url';

export type Assets = {
  models: Object3D;
  clips: AnimationClip[];
  tex: {
    vehicle: Texture;
    asset: Texture;
    matcap: Texture;
    shadow: Texture;
    road: Texture;
    slot: Texture;
  };
};

export async function loadAssets(onProgress: (p: number) => void): Promise<Assets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new TextureLoader();
  let done = 0;
  const total = 7;
  const tick = <T>(v: T) => {
    onProgress(++done / total);
    return v;
  };

  const tex = (url: string, repeat = false) =>
    texLoader.loadAsync(url).then((t) => {
      t.flipY = false; // glTF UV convention
      t.colorSpace = NoColorSpace; // shaders decode explicitly (Cocos-style)
      t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      return tick(t);
    });

  const [gltf, vehicle, asset, matcap, shadow, road, slot] = await Promise.all([
    loader.loadAsync(modelsUrl).then(tick),
    tex(vehicleUrl),
    tex(assetUrl),
    tex(matcapUrl),
    tex(shadowUrl),
    tex(roadUrl, true),
    tex(slotUrl),
  ]);
  slot.flipY = true;
  slot.needsUpdate = true;

  return { models: gltf.scene, clips: gltf.animations, tex: { vehicle, asset, matcap, shadow, road, slot } };
}
