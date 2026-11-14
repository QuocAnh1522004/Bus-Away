// Dev helper: print node hierarchy, bounds, materials and animations of GLB files.
// Usage: node tools/inspect-glb.mjs file1.glb [file2.glb ...]
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const fmt = (a) => a.map((v) => +v.toFixed(3));

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const b = getBounds(scene);
  console.log(`===== ${file.split(/[\\/]/).pop()}  bounds ${fmt(b.min)} .. ${fmt(b.max)}`);

  const walk = (n, depth) => {
    const mesh = n.getMesh();
    let info = '';
    if (mesh) {
      info = mesh
        .listPrimitives()
        .map((p) => `[${p.getAttribute('POSITION').getCount()}v mat=${p.getMaterial()?.getName()} ${p.listSemantics().join(',')}]`)
        .join(' ');
      const nb = getBounds(n);
      info += ` bounds=${fmt(nb.min)}..${fmt(nb.max)}`;
    }
    const skin = n.getSkin() ? ' SKIN' : '';
    console.log(`${'  '.repeat(depth)}${n.getName()} t=${fmt(n.getTranslation())} r=${fmt(n.getRotation())} s=${fmt(n.getScale())}${skin} ${info}`);
    n.listChildren().forEach((c) => walk(c, depth + 1));
  };
  scene.listChildren().forEach((n) => walk(n, 1));

  root.listMaterials().forEach((m) => console.log(`  material ${m.getName()} color=${fmt(m.getBaseColorFactor())}`));
  root.listAnimations().forEach((a) => console.log(`  animation ${a.getName()} channels=${a.listChannels().length}`));
}
