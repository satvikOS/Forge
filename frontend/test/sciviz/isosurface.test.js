// Gate — sciviz Inc 6 : isosurface.js (ParaView "Contour" over a result field).
//
// Run head-less:  node frontend/test/sciviz/isosurface.test.js
//
// Gates (analytic, no GPU):
//   • contour the SAMPLED field f=x²+y²+z² at iso=R² → a sphere: mean radius
//     error and enclosed volume vs (4/3)πR³ both < ~1% (structured MC path),
//   • a LINEAR field f=a·x+b·y+c·z → a planar iso at the exact analytic offset
//     (the contour math is exact: F(p)=Fa+t·(Fb−Fa)=iso; the residual is only
//     the float32 vertex storage used for GPU upload — ~1e-8 here),
//   • MULTI-isovalue → nested, non-intersecting shells (ordered radii),
//   • the FE hex/tet marching-tets path reproduces the same sphere volume,
//   • colouring by a SECOND array carries that array's values onto the surface.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  contourStructuredGrid, contourMesh, enclosedVolume, radialStats, buildIsosurfaceMesh,
} from '../../src/forge-v4/sciviz/isosurface.js';

let checks = 0;
const PI = Math.PI;

// ── helpers ────────────────────────────────────────────────────────────────
function makeCellGrid(N, half, fieldFn) {
  // cell-centred grid over [−half, half]³, value = fieldFn at the cell centre.
  const dx = (2 * half) / N;
  const grid = { nx: N, ny: N, nz: N, dx, dy: dx, dz: dx, origin: [-half, -half, -half], sliceXY: N * N, N: N * N * N };
  const f = new Float64Array(N * N * N);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + (i + 0.5) * dx, y = -half + (j + 0.5) * dx, z = -half + (k + 0.5) * dx;
    f[i + N * j + N * N * k] = fieldFn(x, y, z);
  }
  return { grid, field: f, dx };
}

// build a hex8 node lattice over [−half,half]³ with N cells/axis + a nodal field
function makeHexMesh(N, half, fieldFn) {
  const g = N + 1, dx = (2 * half) / N;
  const nodeId = (i, j, k) => i + g * j + g * g * k;
  const nodes = new Float64Array(g * g * g * 3);
  const nodal = new Float64Array(g * g * g);
  for (let k = 0; k < g; k++) for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    const id = nodeId(i, j, k);
    const x = -half + i * dx, y = -half + j * dx, z = -half + k * dx;
    nodes[3 * id] = x; nodes[3 * id + 1] = y; nodes[3 * id + 2] = z;
    nodal[id] = fieldFn(x, y, z);
  }
  const conn = [];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    conn.push(
      nodeId(i, j, k), nodeId(i + 1, j, k), nodeId(i + 1, j + 1, k), nodeId(i, j + 1, k),
      nodeId(i, j, k + 1), nodeId(i + 1, j, k + 1), nodeId(i + 1, j + 1, k + 1), nodeId(i, j + 1, k + 1),
    );
  }
  return { nodes, tets: new Uint32Array(conn), nodeCount: g * g * g, elemCount: N * N * N, elemNodeCount: 8, nodal, dx };
}

// ── GATE 1: sampled sphere (structured MC path) ────────────────────────────
{
  const R = 0.8, half = 1.1, N = 64;
  const { grid, field, dx } = makeCellGrid(N, half, (x, y, z) => x * x + y * y + z * z);
  const res = contourStructuredGrid(grid, field, R * R);  // iso = R²
  const shell = res.shells[0];
  assert.ok(shell.vertexCount > 100, `sphere contour too small (${shell.vertexCount} verts)`);
  const rs = radialStats(shell.positions, [0, 0, 0]);
  const radErr = Math.abs(rs.mean - R) / R;
  const volAnalytic = (4 / 3) * PI * R ** 3;
  const volErr = Math.abs(shell.enclosedVolume - volAnalytic) / volAnalytic;
  assert.ok(radErr < 0.01, `sphere mean-radius rel-error ${radErr} >= 1%`);
  assert.ok(volErr < 0.01, `sphere enclosed-volume rel-error ${volErr} >= 1%`);
  checks += 2;
  console.log(`  GATE1 MC sphere: r_mean=${rs.mean.toFixed(5)} (R=${R}) radErr=${(radErr * 100).toFixed(3)}%  `
    + `vol=${shell.enclosedVolume.toFixed(5)} (4/3πR³=${volAnalytic.toFixed(5)}) volErr=${(volErr * 100).toFixed(3)}%  `
    + `tris=${shell.triangleCount} dx=${dx.toFixed(4)}`);
}

// ── GATE 2: linear field → planar iso at the exact analytic offset ─────────
{
  const A = 0.37, B = -0.51, Cc = 0.62, iso = 0.4;
  const lin = (x, y, z) => A * x + B * y + Cc * z;
  // FE marching-tets path — the crossing math is exact; the residual is the
  // float32 vertex storage (≈ float32 eps × coord ≈ 1e-7).
  const m = makeHexMesh(10, 1.0, lin);
  const resFE = contourMesh(m, m.nodal, iso);
  const sFE = resFE.shells[0];
  assert.ok(sFE.vertexCount > 30, `FE planar iso too small (${sFE.vertexCount})`);
  let maxFE = 0;
  for (let i = 0; i < sFE.vertexCount; i++) {
    const p = [sFE.positions[3 * i], sFE.positions[3 * i + 1], sFE.positions[3 * i + 2]];
    maxFE = Math.max(maxFE, Math.abs(A * p[0] + B * p[1] + Cc * p[2] - iso));
  }
  assert.ok(maxFE < 1e-6, `FE planar-iso offset error ${maxFE} >= 1e-6 (float32 storage)`);

  // structured MC path → float32 positions → exact to ~float32
  const { grid, field } = makeCellGrid(40, 1.0, lin);
  const resMC = contourStructuredGrid(grid, field, iso);
  const sMC = resMC.shells[0];
  let maxMC = 0;
  for (let i = 0; i < sMC.vertexCount; i++) {
    const p = [sMC.positions[3 * i], sMC.positions[3 * i + 1], sMC.positions[3 * i + 2]];
    maxMC = Math.max(maxMC, Math.abs(A * p[0] + B * p[1] + Cc * p[2] - iso));
  }
  assert.ok(maxMC < 1e-4, `MC planar-iso offset error ${maxMC} >= 1e-4 (float32)`);
  checks += 2;
  console.log(`  GATE2 linear iso (float32 storage): FE offsetErr=${maxFE.toExponential(3)} (<1e-6)  `
    + `MC offsetErr=${maxMC.toExponential(3)} (<1e-4)`);
}

// ── GATE 3: multi-isovalue → nested, non-intersecting shells ───────────────
{
  const half = 1.3, N = 72;
  const { grid, field } = makeCellGrid(N, half, (x, y, z) => x * x + y * y + z * z);
  const Rs = [0.4, 0.7, 1.05];
  const res = contourStructuredGrid(grid, field, Rs.map((r) => r * r));
  assert.equal(res.shells.length, 3, 'expected 3 shells');
  const stats = res.shells.map((s) => radialStats(s.positions, [0, 0, 0]));
  // each shell's mean radius ≈ its R (within 1.5%) AND ordered & separated:
  // the OUTER extent of shell k must be inside the INNER extent of shell k+1.
  for (let k = 0; k < 3; k++) {
    const e = Math.abs(stats[k].mean - Rs[k]) / Rs[k];
    assert.ok(e < 0.015, `shell ${k} radius ${stats[k].mean} != ${Rs[k]} (${e})`);
  }
  for (let k = 0; k < 2; k++) {
    assert.ok(stats[k].max < stats[k + 1].min,
      `shells ${k}/${k + 1} intersect: max_${k}=${stats[k].max} >= min_${k + 1}=${stats[k + 1].min}`);
  }
  checks += 2;
  console.log(`  GATE3 nested shells: r̄=[${stats.map((s) => s.mean.toFixed(4)).join(', ')}] `
    + `(want ${Rs.join(', ')}); separations max_k<min_{k+1}: `
    + `${stats[0].max.toFixed(4)}<${stats[1].min.toFixed(4)}, ${stats[1].max.toFixed(4)}<${stats[2].min.toFixed(4)}`);
}

// ── GATE 4: FE hex marching-tets reproduces the sphere volume ──────────────
{
  const R = 0.8, half = 1.1, N = 56;
  const m = makeHexMesh(N, half, (x, y, z) => x * x + y * y + z * z);
  const res = contourMesh(m, m.nodal, R * R);
  const shell = res.shells[0];
  const volAnalytic = (4 / 3) * PI * R ** 3;
  const vol = enclosedVolume(shell.positions, shell.indices);
  const volErr = Math.abs(vol - volAnalytic) / volAnalytic;
  const rs = radialStats(shell.positions, [0, 0, 0]);
  const radErr = Math.abs(rs.mean - R) / R;
  assert.ok(volErr < 0.02, `FE-tet sphere volume rel-error ${volErr} >= 2%`);
  assert.ok(radErr < 0.01, `FE-tet sphere radius rel-error ${radErr} >= 1%`);
  checks += 2;
  console.log(`  GATE4 FE-tet sphere: vol=${vol.toFixed(5)} (4/3πR³=${volAnalytic.toFixed(5)}) `
    + `volErr=${(volErr * 100).toFixed(3)}%  r_mean=${rs.mean.toFixed(5)} radErr=${(radErr * 100).toFixed(3)}%`);
}

// ── GATE 5: colour by a SECOND array ───────────────────────────────────────
{
  // contour the sphere field but colour by x → each surface vertex's colour
  // value must equal its own x coordinate (within interpolation error).
  const R = 0.8, half = 1.1, N = 56;
  const { grid, field } = makeCellGrid(N, half, (x, y, z) => x * x + y * y + z * z);
  const res = contourStructuredGrid(grid, field, R * R, { colorField: makeXField(N, half) });
  const shell = res.shells[0];
  let maxErr = 0;
  for (let i = 0; i < shell.vertexCount; i++) {
    const x = shell.positions[3 * i];
    maxErr = Math.max(maxErr, Math.abs(shell.colorVals[i] - x));
  }
  assert.ok(maxErr < 2 * grid.dx, `colour-by-x error ${maxErr} >= 2 cells (${2 * grid.dx})`);
  assert.ok(shell.colorRange[0] < -0.3 && shell.colorRange[1] > 0.3, 'colour range should span the sphere x-extent');
  // also build a render group head-less (multi-shell, varying opacity)
  const res2 = contourStructuredGrid(grid, field, [0.3 * 0.3, R * R]);
  const group = buildIsosurfaceMesh(THREE, res2, null, { opacities: [0.3, 1] });
  assert.equal(group.children.length, 2, 'render group should have one mesh per shell');
  checks += 3;
  console.log(`  GATE5 colour-by-2nd-array: max|colorVal−x|=${maxErr.toExponential(3)} (<2 cells=${(2 * grid.dx).toFixed(4)})  `
    + `range=[${shell.colorRange[0].toFixed(3)}, ${shell.colorRange[1].toFixed(3)}]  renderGroup children=${group.children.length}`);
}

function makeXField(N, half) {
  const dx = (2 * half) / N;
  const f = new Float64Array(N * N * N);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    f[i + N * j + N * N * k] = -half + (i + 0.5) * dx;   // = cell-centre x
  }
  return f;
}

console.log(`[sciviz Inc6 isosurface] OK — ${checks} checks passed.`);
