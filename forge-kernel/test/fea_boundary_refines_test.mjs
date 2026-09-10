// Does the tet mesher's BOUNDARY refine when you ask for a finer mesh?
//
// forge::fea::tet::meshShape densifies the CAD surface triangulation once, before
// Bowyer-Watson: it walks the ORIGINAL triangle list (`ntri` is captured before the
// loop) and adds each triangle's edge midpoints and barycentre exactly once. Those
// points go into `bndPts` and never back into `triangles`, so a second pass has
// nothing new to subdivide. Boundary spacing therefore floors at a fraction of the
// BRepMesh facet size and is INDEPENDENT of targetEdge, while the interior AABB
// lattice tracks targetEdge normally.
//
// A box is the cleanest exhibit: BRepMesh gives each planar face exactly two
// triangles and four corner vertices, so one densification pass can only ever produce
// corners + edge midpoints + barycentres — the same handful of points at every
// requested edge length.
//
// This measures the MESH, not the answer. Accuracy against NAFEMS targets is a
// separate question and is deliberately not asserted here: the root-cause note
// declines to predict it, so this test declines too.
//
//   node test/fea_boundary_refines_test.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The addon lands in build/Release/ under a multi-config generator and in build/
// under Makefiles. Resolve either rather than assuming one, so this test does not
// silently "fail to build" when it was only built somewhere else.
import fs from 'fs';
const CANDIDATES = [
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'),
  path.resolve(__dirname, '..', 'build', 'forge-kernel.node'),
];
const addon = CANDIDATES.find(p => fs.existsSync(p));
if (!addon) {
  console.error('forge-kernel.node not found. Looked in:\n  ' + CANDIDATES.join('\n  '));
  console.error('Build it with -DFORGE_BUILD_NODE_ADDON=ON (the default build sets it OFF).');
  process.exit(2);
}
const forge = require(addon);

let CHECKS = 0;
const FAILURES = [];
function check(cond, label, detail = '') {
  CHECKS++;
  if (!cond) {
    FAILURES.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL ${label}${detail ? `  [${detail}]` : ''}`);
  }
  return cond;
}

const L = 1.0;                       // 1 m cube
const EDGES = [0.5, 0.25, 0.125, 0.0625];
const TOL = 1e-9;

function faceStats(m, axis, value) {
  // nodes lying on the plane axis == value
  const pts = [];
  for (let i = 0; i < m.nodeCount; i++) {
    const p = [m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]];
    if (Math.abs(p[axis] - value) < 1e-7) pts.push(p);
  }
  // distinct stations along the first in-plane axis
  const other = axis === 0 ? 1 : 0;
  const xs = [...new Set(pts.map(p => Math.round(p[other] / TOL) * TOL))].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < xs.length; i++) maxGap = Math.max(maxGap, xs[i] - xs[i - 1]);
  if (xs.length === 1) maxGap = L;
  return { n: pts.length, distinct: xs.length, maxGap };
}

const rows = [];
for (const e of EDGES) {
  const box = forge.makeBox(L, L, L);
  const m = forge.fea.tet.meshShape(box, e);
  const f = faceStats(m, 2, 0.0);                       // the z = 0 face
  rows.push({ e, tets: m.tetCount, nodes: m.nodeCount, ...f });
  forge.release(box);
}

console.log('  targetEdge   tets   nodes | z=0 face: nodes  distinct-x  max-gap');
for (const r of rows) {
  console.log(`  ${String(r.e).padEnd(10)} ${String(r.tets).padStart(6)} ${String(r.nodes).padStart(6)} |` +
              `            ${String(r.n).padStart(5)} ${String(r.distinct).padStart(11)} ${r.maxGap.toFixed(5).padStart(9)}`);
}
console.log('');

// ---- CONTROL: the mesh as a whole must be refining, or this proves nothing -------
// This passes before AND after the fix. It isolates the claim to the BOUNDARY: if the
// interior stopped refining too, the boundary assertions below would be measuring a
// broken sweep rather than a boundary defect.
let interiorGrows = true;
for (let i = 1; i < rows.length; i++) if (rows[i].tets <= rows[i - 1].tets) interiorGrows = false;
check(interiorGrows, 'CONTROL: total tet count grows with each refinement',
      rows.map(r => r.tets).join(' -> '));

// ---- the boundary must refine too ----------------------------------------------
let nodesGrow = true;
for (let i = 1; i < rows.length; i++) if (rows[i].n <= rows[i - 1].n) nodesGrow = false;
check(nodesGrow, 'the z=0 face gains nodes at every refinement',
      rows.map(r => r.n).join(' -> '));

let gapShrinks = true;
for (let i = 1; i < rows.length; i++) if (!(rows[i].maxGap < rows[i - 1].maxGap - 1e-12)) gapShrinks = false;
check(gapShrinks, 'the largest gap between boundary stations shrinks at every refinement',
      rows.map(r => r.maxGap.toFixed(5)).join(' -> '));

const fine = rows[rows.length - 1];
check(fine.maxGap <= 3 * fine.e,
      'at the finest level the boundary gap TRACKS targetEdge (<= 3x)',
      `maxGap ${fine.maxGap.toFixed(5)} vs 3*edge ${(3 * fine.e).toFixed(5)}`);

// The sharpest statement of the defect: the coarsest and finest meshes must not
// agree exactly. Byte-identical boundary stations across a large tet increase is the
// signature this test exists to catch.
check(!(rows[0].distinct === fine.distinct && Math.abs(rows[0].maxGap - fine.maxGap) < 1e-12),
      'the boundary station set is NOT byte-identical between coarsest and finest',
      `${rows[0].distinct} stations / gap ${rows[0].maxGap.toFixed(5)} vs ` +
      `${fine.distinct} / ${fine.maxGap.toFixed(5)}, across ${rows[0].tets} -> ${fine.tets} tets`);

console.log(`[boundary-refines] ${CHECKS} checks, ${FAILURES.length} failures`);
for (const f of FAILURES) console.log(`   - ${f}`);
process.exit(FAILURES.length ? 1 : 0);
