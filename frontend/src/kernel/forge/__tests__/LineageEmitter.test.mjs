import assert from 'node:assert/strict';
import { ForgeTopoIdRegistry } from '../PersistentTopoIds.js';
import { summariseFaces, deriveLineage,
         cutWithLineage, fuseWithLineage, filletWithLineage } from '../LineageEmitter.js';

// 1) summariseFaces aggregates per-face area + centroid + normal from
//    a per-triangle face-id map.
{
  // Two unit triangles: face 0 at z=0 (xy plane), face 1 at z=1 (parallel).
  const positions = new Float32Array([
    0, 0, 0,   1, 0, 0,   0, 1, 0,    // face 0
    0, 0, 1,   1, 0, 1,   0, 1, 1,    // face 1
  ]);
  const indices = new Uint32Array([0,1,2, 3,4,5]);
  const faceMap = [0, 1];
  const faces = summariseFaces({ positions, indices, faceMap });
  assert.equal(faces.length, 2);
  // Each unit right triangle has area 0.5.
  assert.ok(Math.abs(faces[0].area - 0.5) < 1e-6);
  assert.ok(Math.abs(faces[1].area - 0.5) < 1e-6);
  // Normal of face 0 is +z (positive area means CCW); face 1 same.
  assert.ok(Math.abs(faces[0].normal[2] - 1) < 1e-6);
  assert.ok(Math.abs(faces[1].normal[2] - 1) < 1e-6);
}

// 2) deriveLineage with no change → all survivors.
{
  const inFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
    { id: 2, area: 1, centroid: [1,0,0], normal: [1,0,0] },
  ];
  const outFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
    { id: 2, area: 1, centroid: [1,0,0], normal: [1,0,0] },
  ];
  const entries = deriveLineage(inFaces, outFaces, ['p1', 'p2']);
  const survs = entries.filter((e) => e.kind === 'survivor');
  assert.equal(survs.length, 2);
  assert.equal(survs[0].oldPid, 'p1');
  assert.equal(survs[1].oldPid, 'p2');
}

// 3) deriveLineage detects a split — one input → 3 outputs sharing its
//    normal.
{
  const inFaces = [
    { id: 1, area: 9, centroid: [0,0,0], normal: [0,0,1] },
  ];
  const outFaces = [
    { id: 1, area: 3, centroid: [-1,0,0], normal: [0,0,1] },
    { id: 2, area: 3, centroid: [ 0,0,0], normal: [0,0,1] },
    { id: 3, area: 3, centroid: [ 1,0,0], normal: [0,0,1] },
  ];
  const entries = deriveLineage(inFaces, outFaces, ['p1']);
  const splits = entries.filter((e) => e.kind === 'split');
  assert.equal(splits.length, 1);
  assert.deepEqual(splits[0].newOcctIndices.sort(), [1, 2, 3]);
}

// 4) Births — new output face with no matching input normal.
{
  const inFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
  ];
  const outFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
    { id: 2, area: 1, centroid: [0,1,0], normal: [0,1,0] }, // new side face
  ];
  const entries = deriveLineage(inFaces, outFaces, ['p1'], { originOp: 'extrude' });
  const births = entries.filter((e) => e.kind === 'birth');
  assert.equal(births.length, 1);
  assert.equal(births[0].newOcctIndex, 2);
  assert.equal(births[0].originOp, 'extrude');
}

// 5) Death — input face has no matching output normal (consumed).
{
  const inFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
    { id: 2, area: 1, centroid: [1,0,0], normal: [1,0,0] },
  ];
  const outFaces = [
    { id: 1, area: 1, centroid: [0,0,0], normal: [0,0,1] },
  ];
  const entries = deriveLineage(inFaces, outFaces, ['p1', 'p2']);
  const deaths = entries.filter((e) => e.kind === 'death');
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].oldPid, 'p2');
}

// 6) End-to-end: cutWithLineage wires the kernel-shaped stub through
//    ForgeTopoIdRegistry — the registry sees the lineage entries.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 2 });

  // Stub kernel that simulates "cut removes the +x face, keeps +z".
  const meshOf = (handle) => {
    if (handle === 100) {  // input
      return {
        positions: new Float32Array([
          // face 1 (id=1, +z)
          0,0,0, 1,0,0, 0,1,0,
          // face 2 (id=2, +x)
          0,0,0, 0,1,0, 0,0,1,
        ]),
        indices: new Uint32Array([0,1,2, 3,4,5]),
        faceMap: [1, 2],
      };
    }
    // output handle 200: only face 1 survives, renumbered to 1.
    return {
      positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
      indices:   new Uint32Array([0,1,2]),
      faceMap:   [1],
    };
  };
  const forge = {
    tessellate: meshOf,
    cut: (a, b) => 200,
    fuse: (a, b) => 200,
  };
  const { outHandle, lineage } = cutWithLineage({
    forge, registry: reg, aHandle: 100, bHandle: 0,
    aPids: pids.face,
  });
  assert.equal(outHandle, 200);
  assert.ok(lineage.length >= 1);
  // p1 survives, p2 dies.
  const surv = lineage.find((e) => e.kind === 'survivor');
  const death = lineage.find((e) => e.kind === 'death');
  assert.ok(surv && death);
  assert.equal(surv.oldPid, pids.face[0]);
  assert.equal(death.oldPid, pids.face[1]);
  // Registry reflects the op.
  assert.equal(reg.occtOf(pids.face[0]), 1);
  assert.equal(reg.occtOf(pids.face[1]), null);
}

// 7) fuseWithLineage + filletWithLineage shape sanity — they exist,
//    return {outHandle, lineage}, and feed the registry.
{
  const forge = {
    tessellate: () => ({
      positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
      indices: new Uint32Array([0,1,2]),
      faceMap: [1],
    }),
    fuse: () => 42,
    part: { filletEdges: () => 43 },
  };
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 1 });
  const f = fuseWithLineage({ forge, registry: reg, aHandle: 10, bHandle: 11,
                              aPids: pids.face });
  assert.equal(f.outHandle, 42);
  const reg2 = new ForgeTopoIdRegistry();
  const pids2 = reg2.bornBody({ face: 1 });
  const g = filletWithLineage({ forge, registry: reg2, shapeHandle: 10,
                                edgeIds: [1, 2], radius: 0.5, shapePids: pids2.face });
  assert.equal(g.outHandle, 43);
}

console.log('[forge.lineage-emitter] all tests passed');
