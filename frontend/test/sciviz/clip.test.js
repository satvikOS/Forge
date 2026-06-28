// Gate — sciviz Inc 2 : clip.js (ParaView "Clip": plane / box / scalar).
//
// Run head-less:  node frontend/test/sciviz/clip.test.js
//
// Gates (analytic, no GPU):
//   • clip a unit cube at axis fraction f → kept volume == f·V (machine tol),
//     and the kept volume is mesh-independent (1 hex == 4³ grid),
//   • degenerate cuts (plane exactly through cube vertices) give the exact
//     analytic volume without crashing or double-counting,
//   • box-clip a voxelised sphere → kept volume vs the analytic sphere∩box
//     (sphere − Σ disjoint spherical caps) within a few %,
//   • scalar-clip a quadratic field → a ball whose volume matches (4/3)πR³,
//   • boundary surface = skin + non-empty cut caps, caps lie ON the cut plane.
import assert from 'node:assert/strict';
import {
  clipStructuredGrid, clipMesh, tetsFromVoxelGrid, clipTets, tetsVolume,
  boundaryFaces,
} from '../../src/forge-v4/sciviz/clip.js';

let checks = 0;
const PI = Math.PI;

// ── GATE 1: unit cube, axis plane fraction f → kept volume == f ────────────
{
  // single hex (1×1×1) AND a 4×4×4 grid of the same cube → both must give f.
  const oneHex = { nx: 1, ny: 1, nz: 1, dx: 1, dy: 1, dz: 1, origin: [0, 0, 0] };
  const grid4 = { nx: 4, ny: 4, nz: 4, dx: 0.25, dy: 0.25, dz: 0.25, origin: [0, 0, 0] };
  let worst = 0, worstMesh = 0;
  for (const f of [0.2, 0.5, 0.73, 0.91]) {
    const spec = { type: 'plane', plane: { point: [f, 0, 0], normal: [1, 0, 0] } }; // keep x ≤ f
    const a = clipStructuredGrid(oneHex, null, spec, { boundary: false });
    const b = clipStructuredGrid(grid4, null, spec, { boundary: false });
    worst = Math.max(worst, Math.abs(a.keptVolume - f), Math.abs(b.keptVolume - f));
    worstMesh = Math.max(worstMesh, Math.abs(a.keptVolume - b.keptVolume));
  }
  assert.ok(worst < 1e-12, `cube axis-fraction kept-volume error ${worst} >= 1e-12`);
  assert.ok(worstMesh < 1e-12, `cube kept-volume mesh-dependence ${worstMesh} >= 1e-12`);
  checks += 2;
  console.log(`  GATE1 cube axis fraction: max|kept−f|=${worst.toExponential(3)}  `
    + `1hex-vs-4³ mismatch=${worstMesh.toExponential(3)}`);
}

// ── GATE 1b: oblique plane — re-tessellation invariance (1 hex == 6³ grid) ──
{
  const oneHex = { nx: 1, ny: 1, nz: 1, dx: 1, dy: 1, dz: 1, origin: [0, 0, 0] };
  const grid6 = { nx: 6, ny: 6, nz: 6, dx: 1 / 6, dy: 1 / 6, dz: 1 / 6, origin: [0, 0, 0] };
  const spec = { type: 'plane', plane: { point: [0.55, 0.48, 0.5], normal: [0.6, 0.7, -0.39] } };
  const a = clipStructuredGrid(oneHex, null, spec, { boundary: false });
  const b = clipStructuredGrid(grid6, null, spec, { boundary: false });
  assert.ok(a.keptVolume > 1e-3 && a.keptVolume < 1 - 1e-3, 'oblique cut should be a partial volume');
  assert.ok(Math.abs(a.keptVolume - b.keptVolume) < 1e-12,
    `oblique re-tessellation mismatch ${Math.abs(a.keptVolume - b.keptVolume)} >= 1e-12`);
  checks++;
  console.log(`  GATE1b oblique plane: kept(1hex)=${a.keptVolume.toFixed(12)} `
    + `kept(6³)=${b.keptVolume.toFixed(12)} Δ=${Math.abs(a.keptVolume - b.keptVolume).toExponential(3)}`);
}

// ── GATE 2: degenerate — plane exactly through 3 cube vertices ─────────────
{
  // plane x+y+z = 2 passes through (1,1,0),(1,0,1),(0,1,1); keep x+y+z ≤ 2.
  // removed corner simplex at (1,1,1) has volume 1/6 → kept = 5/6.
  const oneHex = { nx: 1, ny: 1, nz: 1, dx: 1, dy: 1, dz: 1, origin: [0, 0, 0] };
  const spec = { type: 'plane', plane: { point: [2, 0, 0], normal: [1, 1, 1] } };
  const r = clipStructuredGrid(oneHex, null, spec, { boundary: false });
  assert.ok(Math.abs(r.keptVolume - 5 / 6) < 1e-12,
    `vertex-degenerate kept ${r.keptVolume} != 5/6 (${5 / 6})`);

  // plane through a single vertex (0,0,0): keep x+y+z ≤ 0 → only that corner → ~0.
  const spec0 = { type: 'plane', plane: { point: [0, 0, 0], normal: [1, 1, 1] } };
  const r0 = clipStructuredGrid(oneHex, null, spec0, { boundary: false });
  assert.ok(r0.keptVolume < 1e-12, `single-vertex cut should keep ~0, got ${r0.keptVolume}`);
  checks += 2;
  console.log(`  GATE2 degenerate: 3-vertex plane kept=${r.keptVolume.toFixed(12)} (==5/6=${(5 / 6).toFixed(12)}); `
    + `1-vertex plane kept=${r0.keptVolume.toExponential(3)}`);
}

// ── GATE 3: box-clip a voxelised sphere vs analytic sphere∩box ─────────────
{
  const R = 1.0, C = [0, 0, 0];
  const N = 48, half = 1.2, dx = (2 * half) / N;     // grid over [−1.2,1.2]³
  const grid = { nx: N, ny: N, nz: N, dx, dy: dx, dz: dx, origin: [-half, -half, -half] };
  const inside = (i, j, k, cx, cy, cz) => (cx - C[0]) ** 2 + (cy - C[1]) ** 2 + (cz - C[2]) ** 2 < R * R;

  // box whose 6 faces each shave a disjoint cap (every |bound| ≥ 0.8 ⇒ any two
  // cut half-spaces miss the sphere, so caps don't overlap → analytic exact).
  const bounds = [-0.9, 0.85, -0.8, 0.9, -0.95, 0.88]; // xmin,xmax,ymin,ymax,zmin,zmax
  const cap = (h) => PI * h * h * (3 * R - h) / 3;      // spherical cap volume
  let analytic = (4 / 3) * PI * R ** 3;
  for (const b of bounds) analytic -= cap(R - Math.abs(b));

  // independent voxel reference of the full ball (isolates the voxelisation
  // error from the clip operation)
  const fullTets = tetsFromVoxelGrid(grid, null, { include: inside });
  const fullVol = tetsVolume(fullTets);

  const res = clipStructuredGrid(grid, null, { type: 'box', bounds }, { include: inside, boundary: false });
  const relErr = Math.abs(res.keptVolume - analytic) / analytic;
  assert.ok(relErr < 0.04, `sphere∩box volume rel-error ${relErr} >= 4%`);
  checks++;
  console.log(`  GATE3 box∩sphere: kept=${res.keptVolume.toFixed(5)} analytic=${analytic.toFixed(5)} `
    + `relErr=${(relErr * 100).toFixed(2)}%  (voxel full-ball=${fullVol.toFixed(4)} vs 4/3πR³=${((4 / 3) * PI).toFixed(4)})`);
}

// ── GATE 4: scalar-clip a quadratic field → a ball, vol vs (4/3)πR³ ────────
{
  const R = 1.0, N = 50, half = 1.3, dx = (2 * half) / N;
  const grid = { nx: N, ny: N, nz: N, dx, dy: dx, dz: dx, origin: [-half, -half, -half] };
  const fieldFn = (x, y, z) => x * x + y * y + z * z;     // iso R² ⇒ sphere radius R
  // keep field ≤ R² (inside the ball)
  const res = clipStructuredGrid(grid, null, { type: 'scalar', isovalue: R * R },
    { cornerField: fieldFn, boundary: false });
  const analytic = (4 / 3) * PI * R ** 3;
  const relErr = Math.abs(res.keptVolume - analytic) / analytic;
  assert.ok(relErr < 0.02, `scalar-clip ball volume rel-error ${relErr} >= 2%`);
  checks++;
  console.log(`  GATE4 scalar-clip ball: kept=${res.keptVolume.toFixed(5)} (4/3)πR³=${analytic.toFixed(5)} `
    + `relErr=${(relErr * 100).toFixed(2)}%`);
}

// ── GATE 5: boundary = skin + caps; caps lie on the cut plane ──────────────
{
  const grid = { nx: 4, ny: 4, nz: 4, dx: 0.25, dy: 0.25, dz: 0.25, origin: [0, 0, 0] };
  // colour by x via cornerField so the skin/caps carry a real scalar
  const spec = { type: 'plane', plane: { point: [0.55, 0.5, 0.5], normal: [1, 0.2, 0.1] } };
  const res = clipStructuredGrid(grid, null, spec, { cornerField: (x) => x });
  assert.ok(res.skinCount > 0, 'clip produced no skin faces');
  assert.ok(res.capCount > 0, 'clip produced no cut-cap faces');
  // every cap vertex must lie on the cut plane (signed distance ≈ 0)
  const n = [1, 0.2, 0.1]; const len = Math.hypot(...n); const nn = n.map((v) => v / len);
  const q = [0.55, 0.5, 0.5];
  let maxOff = 0;
  for (const f of res.boundary) {
    if (!f.cap) continue;
    for (const p of f.verts) {
      maxOff = Math.max(maxOff, Math.abs((p[0] - q[0]) * nn[0] + (p[1] - q[1]) * nn[1] + (p[2] - q[2]) * nn[2]));
    }
  }
  assert.ok(maxOff < 1e-9, `cap vertices off the cut plane by ${maxOff}`);
  checks += 3;
  console.log(`  GATE5 boundary: skin=${res.skinCount} caps=${res.capCount} `
    + `maxCapPlaneOffset=${maxOff.toExponential(3)}  keptVol=${res.keptVolume.toFixed(5)}`);
}

// ── GATE 6: hex8 FE-mesh path (clipMesh) volume sanity ─────────────────────
{
  // a 3×1×1 row of unit cubes; nodal field = node-x; clip plane x ≤ 1.4.
  const NX = 3, NY = 1, NZ = 1, gx = NX + 1, gy = NY + 1, gz = NZ + 1;
  const nodeId = (i, j, k) => i + gx * j + gx * gy * k;
  const nodes = new Float64Array(gx * gy * gz * 3);
  for (let k = 0; k < gz; k++) for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const id = nodeId(i, j, k); nodes[3 * id] = i; nodes[3 * id + 1] = j; nodes[3 * id + 2] = k;
  }
  const conn = [];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    conn.push(
      nodeId(i, j, k), nodeId(i + 1, j, k), nodeId(i + 1, j + 1, k), nodeId(i, j + 1, k),
      nodeId(i, j, k + 1), nodeId(i + 1, j, k + 1), nodeId(i + 1, j + 1, k + 1), nodeId(i, j + 1, k + 1),
    );
  }
  const mesh = { nodes, tets: new Uint32Array(conn), nodeCount: gx * gy * gz, elemCount: NX * NY * NZ, elemNodeCount: 8 };
  const nodal = new Float64Array(mesh.nodeCount);
  for (let id = 0; id < mesh.nodeCount; id++) nodal[id] = nodes[3 * id];
  const res = clipMesh(mesh, nodal, { type: 'plane', plane: { point: [1.4, 0, 0], normal: [1, 0, 0] } });
  // keep x ≤ 1.4 of a 3×1×1 box (total vol 3): exact kept volume = 1.4
  assert.ok(Math.abs(res.keptVolume - 1.4) < 1e-12, `hex-mesh clip kept ${res.keptVolume} != 1.4`);
  assert.ok(res.capCount > 0, 'hex-mesh clip produced no cap');
  checks += 2;
  console.log(`  GATE6 hex-mesh clip: keptVol=${res.keptVolume.toFixed(12)} (==1.4) caps=${res.capCount}`);
}

console.log(`[sciviz Inc2 clip] OK — ${checks} checks passed.`);
