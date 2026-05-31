import assert from 'node:assert/strict';
import { ForgeTopoIdRegistry } from '../PersistentTopoIds.js';
import { cutWithLineage, fuseWithLineage } from '../LineageEmitter.js';

// Forge-60: when the kernel exposes `forge.lineageFor(handle)`, the
// emitter must prefer the kernel's entries over JS centroid heuristics.
// We stub the kernel to return canonical lineage and verify the
// registry sees survivor / split / birth / death entries with the
// caller's pids substituted for the kernel's 1-based TopExp indices.

function stubKernelLineageForCut(outHandle) {
  return [
    { kind: 'survivor', entityKind: 'face', originOp: 'cut',
      oldIndices: [1], newIndices: [1] },
    { kind: 'survivor', entityKind: 'face', originOp: 'cut',
      oldIndices: [2], newIndices: [2] },
    { kind: 'split',    entityKind: 'face', originOp: 'cut',
      oldIndices: [3], newIndices: [3, 7] },
    { kind: 'death',    entityKind: 'face', originOp: 'cut',
      oldIndices: [4], newIndices: [] },
    { kind: 'birth',    entityKind: 'face', originOp: 'cut',
      oldIndices: [],  newIndices: [4] },
    { kind: 'birth',    entityKind: 'face', originOp: 'cut',
      oldIndices: [],  newIndices: [5] },
    { kind: 'birth',    entityKind: 'face', originOp: 'cut',
      oldIndices: [],  newIndices: [6] },
  ];
}

// 1) cutWithLineage prefers kernel emission and feeds the registry.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 4 });
  const forge = {
    cut: () => 1000,
    fuse: () => 1000,
    tessellate: () => ({ positions: new Float32Array(),
                         indices: new Uint32Array(), faceMap: [] }),
    lineageFor: (h) => stubKernelLineageForCut(h),
  };
  const { outHandle, lineage } = cutWithLineage({
    forge, registry: reg,
    aHandle: 100, bHandle: 200, aPids: pids.face,
  });
  assert.equal(outHandle, 1000);
  // Survivor / split / death / birth all represented.
  const kinds = lineage.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['birth','birth','birth','death','split','survivor','survivor']);

  // First survivor maps pid #0 → newOcctIndex 1.
  const surv0 = lineage.find((e) => e.kind === 'survivor' && e.oldPid === pids.face[0]);
  assert.ok(surv0);
  assert.equal(surv0.newOcctIndex, 1);

  // Split keeps pid #2 alive across all three new indices [3, 7].
  const split = lineage.find((e) => e.kind === 'split');
  assert.equal(split.oldPid, pids.face[2]);
  assert.deepEqual(split.newOcctIndices, [3, 7]);

  // Death of pid #3.
  const death = lineage.find((e) => e.kind === 'death');
  assert.equal(death.oldPid, pids.face[3]);

  // Births carry no oldPid + have originOp 'cut'.
  const births = lineage.filter((e) => e.kind === 'birth');
  assert.equal(births.length, 3);
  for (const b of births) {
    assert.equal(b.originOp, 'cut');
    assert.ok(!b.oldPid);
  }

  // The registry applied the op: pid 0 still resolves to occt 1.
  assert.equal(reg.occtOf(pids.face[0]), 1);
  // pid 2 still resolves to occt 3 (the lowest survivor in a split).
  assert.equal(reg.occtOf(pids.face[2]), 3);
  // pid 3 is dead.
  assert.equal(reg.occtOf(pids.face[3]), null);
}

// 2) When forge.lineageFor returns an empty array (op didn't record),
//    falls back to JS centroid-derived lineage.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 1 });
  const meshOf = () => ({
    positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    indices:   new Uint32Array([0,1,2]),
    faceMap:   [1],
  });
  const forge = {
    fuse: () => 9999,
    tessellate: meshOf,
    lineageFor: () => [], // empty → fallback
  };
  const r = fuseWithLineage({
    forge, registry: reg,
    aHandle: 1, bHandle: 2, aPids: pids.face,
  });
  assert.equal(r.outHandle, 9999);
  assert.ok(r.lineage.length >= 1, 'fallback derivation produced entries');
}

// 3) When forge.lineageFor is absent entirely, falls back to JS path.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 1 });
  const meshOf = () => ({
    positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    indices:   new Uint32Array([0,1,2]),
    faceMap:   [1],
  });
  const forge = {
    cut: () => 7777,
    tessellate: meshOf,
    // No lineageFor at all.
  };
  const r = cutWithLineage({
    forge, registry: reg,
    aHandle: 1, bHandle: 2, aPids: pids.face,
  });
  assert.equal(r.outHandle, 7777);
  assert.ok(r.lineage.length >= 1);
}

console.log('[forge.lineage-emitter-kernel] all tests passed');
