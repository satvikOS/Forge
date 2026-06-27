// Gate — sciviz Inc 1 : slice.js (arbitrary-plane Slice).
//
// Run head-less:  node frontend/test/sciviz/slice.test.js
//
// Gates:
//   • slicing a linear field f=ax+by+cz reproduces the EXACT analytic value
//     on the plane to ~1e-10 (linear interp is exact),
//   • slicing a sphere SDF iso at offset d yields a circle of analytic radius
//     √(R²−d²) within < 1 cell,
//   • also verifies the hex-mesh path (sliceMesh) on the same linear field.
import assert from 'node:assert/strict';
import {
  makePlane, sliceStructuredGrid, sliceMesh, isoContourOnSlice,
} from '../../src/forge-v4/sciviz/slice.js';

let checks = 0;

// ── build a structured cell-centred grid ──────────────────────────────────
function makeGrid(n, L, fieldFn) {
  const dx = L / n;
  const grid = { nx: n, ny: n, nz: n, dx, dy: dx, dz: dx, sliceXY: n * n, N: n * n * n, Lx: L, Ly: L, Lz: L };
  const f = new Float64Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dx, z = (k + 0.5) * dx;
    f[i + n * j + n * n * k] = fieldFn(x, y, z);
  }
  return { grid, field: f, dx };
}

// ── GATE 1: linear field exactness (structured grid) ──────────────────────
const A = 0.37, B = -0.21, C = 0.59, D = 1.13;
const linFn = (x, y, z) => A * x + B * y + C * z + D;
{
  const { grid, field } = makeGrid(8, 4.0, linFn);
  const plane = makePlane([2.0, 2.1, 1.9], [1, 2, 3]); // arbitrary oblique plane
  const slice = sliceStructuredGrid(grid, field, plane);
  assert.ok(slice.vertexCount > 0, 'linear slice produced no geometry');
  let maxErr = 0;
  for (let i = 0; i < slice.vertexCount; i++) {
    const p = slice.verts[i];
    const analytic = linFn(p[0], p[1], p[2]);
    maxErr = Math.max(maxErr, Math.abs(slice.vals[i] - analytic));
  }
  assert.ok(maxErr < 1e-10, `structured linear-field slice error ${maxErr} >= 1e-10`);
  checks++;
  console.log(`  GATE1 structured linear-field max error = ${maxErr.toExponential(3)} (verts=${slice.vertexCount})`);
}

// ── GATE 1b: linear field exactness (hex FE mesh path) ────────────────────
{
  // one hex8 element spanning a unit-ish box, node scalars = linFn at nodes.
  const corners = [
    [0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0],
    [0, 0, 2], [2, 0, 2], [2, 2, 2], [0, 2, 2],
  ];
  const nodes = new Float64Array(8 * 3);
  const nodal = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    nodes[3 * i] = corners[i][0]; nodes[3 * i + 1] = corners[i][1]; nodes[3 * i + 2] = corners[i][2];
    nodal[i] = linFn(corners[i][0], corners[i][1], corners[i][2]);
  }
  const mesh = { nodes, tets: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]), nodeCount: 8, elemCount: 1, elemNodeCount: 8 };
  const plane = makePlane([1, 1, 1], [2, -1, 1]);
  const slice = sliceMesh(mesh, nodal, plane);
  assert.ok(slice.vertexCount > 0, 'hex mesh slice produced no geometry');
  let maxErr = 0;
  for (let i = 0; i < slice.vertexCount; i++) {
    const p = slice.verts[i];
    maxErr = Math.max(maxErr, Math.abs(slice.vals[i] - linFn(p[0], p[1], p[2])));
  }
  assert.ok(maxErr < 1e-10, `hex-mesh linear-field slice error ${maxErr} >= 1e-10`);
  checks++;
  console.log(`  GATE1b hex-mesh linear-field max error = ${maxErr.toExponential(3)} (verts=${slice.vertexCount})`);
}

// ── GATE 2: sphere SDF slice → circle of radius √(R²−d²) within < 1 cell ───
{
  const n = 48, L = 1.0;
  const Cx = L / 2, Cy = L / 2, Cz = L / 2;
  const R = 0.40, d = 0.15;
  const sdf = (x, y, z) => Math.hypot(x - Cx, y - Cy, z - Cz) - R;
  const { grid, field, dx } = makeGrid(n, L, sdf);
  const plane = makePlane([Cx, Cy, Cz + d], [0, 0, 1]); // slice at z = Cz + d
  const slice = sliceStructuredGrid(grid, field, plane);
  const iso = isoContourOnSlice(slice, 0);
  assert.ok(iso.count > 16, `expected a closed iso-contour, got ${iso.count} points`);

  const rAnalytic = Math.sqrt(R * R - d * d);
  let sum = 0, maxDev = 0;
  for (const p of iso.points) {
    const r = Math.hypot(p[0] - Cx, p[1] - Cy);
    sum += r;
    maxDev = Math.max(maxDev, Math.abs(r - rAnalytic));
  }
  const rMean = sum / iso.points.length;
  const meanErr = Math.abs(rMean - rAnalytic);
  assert.ok(meanErr < dx, `sphere-slice mean radius error ${meanErr} >= 1 cell (${dx})`);
  assert.ok(maxDev < 2 * dx, `sphere-slice max radius deviation ${maxDev} >= 2 cells`);
  checks++;
  console.log(`  GATE2 sphere-SDF: r_analytic=${rAnalytic.toFixed(5)} r_mean=${rMean.toFixed(5)} `
    + `meanErr=${meanErr.toExponential(3)} (<1 cell=${dx.toFixed(5)}) maxDev=${maxDev.toExponential(3)} pts=${iso.count}`);
}

console.log(`[sciviz Inc1 slice] OK — ${checks} gate groups passed.`);
