import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  console.log('==', f);
  for (const a of doc.getRoot().listAnimations()) {
    console.log(' anim', a.getName());
    for (const c of a.listChannels()) {
      const s = c.getSampler(); const out = s.getOutput(); const inp = s.getInput();
      const first = out.getElement(0, []).map(v=>+v.toFixed(3)); const last = out.getElement(out.getCount()-1, []).map(v=>+v.toFixed(3));
      console.log(`   ${c.getTargetNode().getName().padEnd(26)} ${c.getTargetPath().padEnd(12)} n=${inp.getCount()} ${out.getComponentType()} norm=${out.getNormalized()} first=${first} last=${last}`);
    }
  }
  const skin = doc.getRoot().listSkins()[0];
  console.log(' skin joints', skin.listJoints().map(j=>j.getName()).join(','), 'skeleton', skin.getSkeleton()?.getName());
}
