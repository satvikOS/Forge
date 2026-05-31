import assert from 'node:assert/strict';
import { ForgeTopoIdRegistry } from '../PersistentTopoIds.js';

// ─────────── Birth: a fresh cube has 6 faces + 12 edges + 8 vertices.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 6, edge: 12, vertex: 8 });
  assert.equal(pids.face.length, 6);
  assert.equal(pids.edge.length, 12);
  assert.equal(pids.vertex.length, 8);
  // pids are unique.
  assert.equal(new Set([...pids.face, ...pids.edge, ...pids.vertex]).size,
               6 + 12 + 8);
  // Queries work both ways.
  assert.equal(reg.occtOf(pids.face[0]), 1);
  assert.equal(reg.pidOf('face', 1), pids.face[0]);
  // livePids tally.
  assert.equal(reg.livePids('face').length, 6);
}

// ─────────── Survivor — single boolean that touches one face renumbers
// the rest. PIDs survive the OCCT renumbering.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 3 });
  // After the op:
  //   face pid#0 → new occt 2 (renumbered)
  //   face pid#1 → new occt 1
  //   face pid#2 → DEAD (consumed by the boolean)
  reg.applyOp('boolean.cut', [
    { kind: 'survivor', oldPid: pids.face[0], newOcctIndex: 2 },
    { kind: 'survivor', oldPid: pids.face[1], newOcctIndex: 1 },
    { kind: 'death',    oldPid: pids.face[2] },
  ]);
  // User's reference to pids.face[0] still resolves — to a NEW occt index.
  assert.equal(reg.occtOf(pids.face[0]), 2);
  assert.equal(reg.occtOf(pids.face[1]), 1);
  assert.equal(reg.occtOf(pids.face[2]), null);   // dead
  // Inverse: occt index 1 maps back to the same persistent face.
  assert.equal(reg.pidOf('face', 1), pids.face[1]);
}

// ─────────── Split — a fillet on a single face turns it into 3 faces.
// All three survivors share the original pid as their lineage root, with
// the lowest occt index keeping the original pid and the rest getting
// new pids whose splitFrom = oldPid.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 1 });
  const oldPid = pids.face[0];
  reg.applyOp('fillet.edges', [
    { kind: 'split', oldPid, newOcctIndices: [5, 1, 3] },
  ]);
  // The original pid follows occt index 1 (lowest).
  assert.equal(reg.occtOf(oldPid), 1);
  assert.equal(reg.pidOf('face', 1), oldPid);
  // Two new pids exist for occt 3 and 5, both pointing back at oldPid.
  const newPid3 = reg.pidOf('face', 3);
  const newPid5 = reg.pidOf('face', 5);
  assert.ok(newPid3 && newPid5 && newPid3 !== oldPid && newPid5 !== oldPid);
  assert.equal(reg.recordOf(newPid3).splitFrom, oldPid);
  assert.equal(reg.recordOf(newPid5).splitFrom, oldPid);
  assert.equal(reg.livePids('face').length, 3);
}

// ─────────── Merge — a boolean that fuses two coplanar faces. First
// input's pid wins; loser is retired but recorded in mergedFrom.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 2 });
  reg.applyOp('boolean.fuse', [
    { kind: 'merge', oldPids: [pids.face[0], pids.face[1]], newOcctIndex: 1 },
  ]);
  assert.equal(reg.occtOf(pids.face[0]), 1, 'winner pid follows the merge');
  assert.equal(reg.occtOf(pids.face[1]), null, 'loser dies');
  assert.deepEqual(reg.recordOf(pids.face[0]).mergedFrom, [pids.face[1]]);
}

// ─────────── Birth — extruding a profile creates 4 brand-new side faces
// + 1 cap face. Fresh pids; no lineage back.
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 1 });   // the profile face
  reg.applyOp('part.extrude', [
    { kind: 'survivor', oldPid: pids.face[0], newOcctIndex: 1 },
    { kind: 'birth', entityKind: 'face', newOcctIndex: 2 },
    { kind: 'birth', entityKind: 'face', newOcctIndex: 3 },
    { kind: 'birth', entityKind: 'face', newOcctIndex: 4 },
    { kind: 'birth', entityKind: 'face', newOcctIndex: 5 },
    { kind: 'birth', entityKind: 'face', newOcctIndex: 6 },
  ]);
  assert.equal(reg.livePids('face').length, 6);
  // Original profile pid still resolves.
  assert.equal(reg.occtOf(pids.face[0]), 1);
  // New pids have originOp tag.
  const cap = reg.pidOf('face', 6);
  assert.equal(reg.recordOf(cap).originOp, 'part.extrude');
}

// ─────────── Chain — birth → survivor → split. The initial pid for the
// profile follows through every op and the registry stays consistent.
{
  const reg2 = new ForgeTopoIdRegistry();
  const seed = reg2.bornBody({ face: 1 });
  const seedPid = seed.face[0];
  reg2.applyOp('extrude', [
    { kind: 'survivor', oldPid: seedPid, newOcctIndex: 1 },
    { kind: 'birth',    newOcctIndex: 2 },
  ]);
  const capPid = reg2.pidOf('face', 2);
  reg2.applyOp('cut', [
    { kind: 'split', oldPid: capPid, newOcctIndices: [2, 5] },
    { kind: 'survivor', oldPid: seedPid, newOcctIndex: 1 },
  ]);
  // After cut the cap split — pid still resolves.
  assert.equal(reg2.occtOf(capPid), 2);
  // Survivor pid for the seed face is still valid through 2 ops.
  assert.equal(reg2.occtOf(seedPid), 1);
}

// ─────────── Sanity — an unmentioned pid is retired (the registry does
// not silently keep stale references that the kernel never confirmed).
{
  const reg = new ForgeTopoIdRegistry();
  const pids = reg.bornBody({ face: 2 });
  reg.applyOp('cut', [
    { kind: 'survivor', oldPid: pids.face[0], newOcctIndex: 1 },
    // pids.face[1] is unmentioned.
  ]);
  assert.equal(reg.occtOf(pids.face[0]), 1);
  assert.equal(reg.occtOf(pids.face[1]), null, 'unmentioned pid is retired');
}

console.log('[forge.persistent-topo-ids] all tests passed');
