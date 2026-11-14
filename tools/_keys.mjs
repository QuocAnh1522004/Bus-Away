import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [f, anim, node] = process.argv.slice(2);
const doc = await io.read(f);
const a = doc.getRoot().listAnimations().find(x => x.getName() === anim);
for (const c of a.listChannels()) {
  if (c.getTargetNode().getName() !== node || c.getTargetPath() !== 'rotation') continue;
  const s = c.getSampler(); const I = s.getInput(), O = s.getOutput();
  for (let i = 0; i < I.getCount(); i++) console.log(I.getScalar(i).toFixed(3), O.getElement(i, []).map(v => v.toFixed(3)).join(' '));
}
