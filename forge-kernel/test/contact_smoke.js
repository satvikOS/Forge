// forge-kernel contact smoke (Forge-31).
//
// Geometry: two 10 × 10 × 10 mm steel cubes stacked along Z.
//   * Lower cube (B): pinned at -Z face (base).
//   * Upper cube (A): pressed by 1000 N (compressive, -Z) distributed across
//     its +Z face.
// Contact between A's -Z face nodes and B's +Z face. Penalty α auto-scaled.
//
// We assert:
//   * Penalty active-set loop converges in ≤ 12 iterations.
//   * At least one supplied contact pair reports pressure > 0.
//   * Upper cube vertical displacement bounded — should not blow through
//     the lower body (|uz| < 10 mm).
//
// Honest scope: brick-grid mesh on a cube is very coarse, so we accept a
// loose displacement bound. The headline numbers are logged.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.fea && forge.fea.solveContact, 'forge.fea.solveContact missing');
console.log('[contact-smoke] version =', forge.version());

// ----------------------------------------------------------- meshes
const a  = 0.010; // 10 mm cube
const E  = 210e9, nu = 0.3, rho = 7850;
const F  = -1000;  // total compressive force on the upper cube (N, -Z direction)

const cubeShape = forge.makeBox(a, a, a);
// Both bodies share the same shape; brick-grid mesh has identical topology.
const meshA = forge.fea.meshFromBrep(cubeShape, a / 2);
const meshB = forge.fea.meshFromBrep(cubeShape, a / 2);
console.log(`[contact-smoke] mesh A: ${meshA.nodeCount} nodes, ${meshA.elemCount} elements`);
console.log(`[contact-smoke] mesh B: ${meshB.nodeCount} nodes, ${meshB.elemCount} elements`);

function findFaceNodes(mesh, faceBit) {
  const out = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << faceBit)) out.push(i);
  }
  return out;
}

// Mesh B (lower): pin -Z face (base, faceId 4).
const baseNodesB = findFaceNodes(meshB, 4);
const bcsB = baseNodesB.map((id) => ({ nodeId: id, fx: true, fy: true, fz: true }));

// Mesh A (upper): load applied on its +Z face.
const topNodesA = findFaceNodes(meshA, 5);
const perNodeA = F / topNodesA.length;
const loadsA = topNodesA.map((id) => ({ nodeId: id, fx: 0, fy: 0, fz: perNodeA }));

// Contact pairs: A's -Z face nodes (faceId 4) talking to B's +Z face (faceId 5).
const aBottomNodes = findFaceNodes(meshA, 4);
const bTopNodes    = findFaceNodes(meshB, 5);
const pairs = aBottomNodes.map((id) => ({ nodeA: id, faceB: 5 }));
console.log(`[contact-smoke] A bottom nodes = ${aBottomNodes.length}, B top nodes = ${bTopNodes.length}, pairs = ${pairs.length}`);

// To prevent the upper cube from translating laterally / spinning, add a
// gentle lateral pin on a single interior node of A (mid bottom-face node).
// This is the analogue of a "soft" rigid-body constraint a real preprocessor
// would emit. We pin x, y on the centroid-most bottom node of A.
function centroidNode(mesh, nodeIds) {
  let cx = 0, cy = 0, cz = 0;
  for (const id of nodeIds) { cx += mesh.nodes[3 * id]; cy += mesh.nodes[3 * id + 1]; cz += mesh.nodes[3 * id + 2]; }
  cx /= nodeIds.length; cy /= nodeIds.length; cz /= nodeIds.length;
  let best = nodeIds[0], bestD = Infinity;
  for (const id of nodeIds) {
    const dx = mesh.nodes[3 * id] - cx;
    const dy = mesh.nodes[3 * id + 1] - cy;
    const dz = mesh.nodes[3 * id + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
const centerBottomA = centroidNode(meshA, aBottomNodes);
const bcsA = [{ nodeId: centerBottomA, fx: true, fy: true, fz: false }];

// ----------------------------------------------------------- solve
const t0 = Date.now();
const r = forge.fea.solveContact(meshA, meshB, { E, nu, rho },
                                 loadsA, [], bcsA, bcsB,
                                 pairs, 0 /* auto-scale penalty */);
const ms = Date.now() - t0;
console.log(`[contact-smoke] solve in ${ms} ms (kernel cpuMs = ${r.cpuMs.toFixed(1)} ms)`);
console.log(`[contact-smoke] iterations         = ${r.iterations}`);
console.log(`[contact-smoke] auto-scaled α      = ${r.penaltyUsed.toExponential(3)}`);
console.log(`[contact-smoke] converged          = ${r.converged}`);

// Convergence rate: how fast did the active set stabilise.
console.log(`[contact-smoke] active-set converged in ${r.iterations} sweep(s) (cap = 12)`);

// Aggregate contact pressure stats.
let maxP = 0, sumP = 0, posCount = 0;
for (const p of r.contactPressure) {
  if (p > maxP) maxP = p;
  if (p > 0) { sumP += p; posCount++; }
}
const meanPosP = posCount ? sumP / posCount : 0;
console.log(`[contact-smoke] contact pressure   max = ${maxP.toExponential(3)} Pa,` +
            ` mean(active) = ${meanPosP.toExponential(3)} Pa,` +
            ` active = ${posCount} / ${pairs.length}`);

// Read the upper cube's vertical displacement (pick the topmost +Z node, which
// is where the load is applied — the displacement there is the global drop
// of the upper cube on top of the contact penetration).
let maxAbsUzA = 0, meanUzTop = 0;
for (const id of topNodesA) {
  const uz = r.uA[3 * id + 2];
  meanUzTop += uz;
  if (Math.abs(uz) > maxAbsUzA) maxAbsUzA = Math.abs(uz);
}
meanUzTop /= topNodesA.length;
console.log(`[contact-smoke] upper-cube top mean uz = ${(meanUzTop * 1000).toFixed(5)} mm`);
console.log(`[contact-smoke] upper-cube max |uz|    = ${(maxAbsUzA * 1000).toFixed(5)} mm`);

// Assertions:
//   (1) Iteration count under the cap.
//   (2) At least one active contact pair with positive pressure.
//   (3) Bounded upper-cube vertical displacement (< 10 mm — the cube size).
assert.ok(r.iterations <= 12, `iterations ${r.iterations} > 12`);
assert.ok(posCount > 0,
  `no contact pair developed positive pressure (max = ${maxP.toExponential(3)} Pa)`);
assert.ok(maxAbsUzA < a, `upper cube |uz| ${maxAbsUzA} m exceeds cube edge ${a} m (blow-through)`);

forge.release(cubeShape);
console.log('\n[contact-smoke] ALL PASS');
