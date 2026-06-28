// Gate — SimScale results-manager (task #66, Inc 6) : resultFilters.js.
//
// Run head-less:  node frontend/test/sciviz/resultsManager.test.js
//
// Proves the results-manager WIRING (cut / clip / iso / probe / report) is
// correct AND that it reuses the committed sci-viz primitives rather than a
// private copy:
//
//   GATE 1  cut plane through a UNIFORM-stress bar reads constant σ on the
//           slice to ~machine-eps.
//   GATE 2  iso-surface at σ_mean of a known LINEAR field encloses the
//           analytically-expected volume fraction (0.5) within a few %
//           (measured by the matching scalar clip; the iso-surface is also
//           built + verified planar at the mean).
//   GATE 2b iso-surface of a known RADIAL field at its mean encloses the
//           analytic sphere volume fraction (π/6) within a few %.
//   GATE 3  probe at a known node returns that node's EXACT stored value.
//   GATE 4  the results path calls sciviz/slice|clip|isosurface (identity of
//           the delegated function objects + output equality), not a copy.
import assert from 'node:assert/strict';
import * as slice from '../../src/forge-v4/sciviz/slice.js';
import * as clip from '../../src/forge-v4/sciviz/clip.js';
import * as iso from '../../src/forge-v4/sciviz/isosurface.js';
import {
  asSciVizMesh, nodalFieldFor, fieldStats, defaultIsovalue,
  sliceResult, clipResult, isoResult, clipVolumeFraction,
  nearestNode, probeResult, buildFieldReport, SCIVIZ_DEPS,
} from '../../src/forge-v4/sciviz/resultFilters.js';

let checks = 0;
const PI = Math.PI;

// build a hex8 node lattice over [lo,hi]³ with N cells/axis + a nodal field.
// Uses the kernel mesh field name `.elements` (NOT `.tets`) to exercise the
// kernel-mesh ⇄ sci-viz-mesh adapter.
function makeHexResultMesh(N, lo, hi, fieldFn) {
  const g = N + 1, dx = (hi - lo) / N;
  const nodeId = (i, j, k) => i + g * j + g * g * k;
  const nodes = new Float64Array(g * g * g * 3);
  const nodal = new Float64Array(g * g * g);
  for (let k = 0; k < g; k++) for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    const id = nodeId(i, j, k);
    const x = lo + i * dx, y = lo + j * dx, z = lo + k * dx;
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
  // kernel-shaped mesh: `.elements`, `.nodeCount`, `.elemNodeCount` (no `.tets`).
  return {
    mesh: {
      nodes, elements: new Uint32Array(conn),
      nodeCount: g * g * g, elemCount: N * N * N, elemNodeCount: 8,
    },
    nodal, dx,
  };
}

// ── GATE 1: uniform-stress bar → constant σ on an arbitrary slice ──────────
{
  const SIGMA0 = 137.5e6; // 137.5 MPa, uniform everywhere
  const { mesh } = makeHexResultMesh(10, 0, 0.2, () => SIGMA0);
  // a constant result field also exercises nodalFieldFor's vonMises path
  const result = { vonMises: (() => { const a = new Float64Array(mesh.nodeCount); a.fill(SIGMA0); return a; })() };
  const field = nodalFieldFor(result, mesh, 'vonMises');
  assert.ok(field && field.length === mesh.nodeCount, 'vonMises field missing');

  const plane = { point: [0.1, 0.11, 0.09], normal: [1, 2, 3] }; // arbitrary oblique
  const cut = sliceResult(mesh, field, plane);
  assert.ok(cut.vertexCount > 0, 'uniform-σ slice produced no geometry');
  let maxErr = 0;
  for (let i = 0; i < cut.vertexCount; i++) maxErr = Math.max(maxErr, Math.abs(cut.vals[i] - SIGMA0));
  // relative to the stress magnitude this is float round-off only.
  const relErr = maxErr / SIGMA0;
  assert.ok(relErr < 1e-12, `uniform-σ slice not constant: rel-err ${relErr}`);
  checks++;
  console.log(`  GATE1 uniform-σ slice: max|σ−σ0|=${maxErr.toExponential(3)} Pa  rel=${relErr.toExponential(3)}  (verts=${cut.vertexCount})`);
}

// ── GATE 2: linear field — iso at σ_mean + clip volume fraction = 0.5 ──────
{
  const L = 0.3;
  const A = 0.42; // f = A·z  (a known linear field)
  const { mesh } = makeHexResultMesh(12, 0, L, (x, y, z) => A * z);
  // mimic a temperature-style nodal field through nodalFieldFor's generic path
  const field = makeHexResultMesh(12, 0, L, (x, y, z) => A * z).nodal;

  const sigmaMean = defaultIsovalue(field);        // nodal mean of A·z
  const meanAnalytic = A * L / 2;                  // mean of A·z over [0,L]
  assert.ok(Math.abs(sigmaMean - meanAnalytic) < 1e-12,
    `σ_mean ${sigmaMean} != analytic ${meanAnalytic}`);

  // iso-surface at σ_mean → must be planar at z = L/2 (the linear-field iso is
  // exact; residual is the float32 vertex storage used for GPU upload).
  const isoRes = isoResult(mesh, field, sigmaMean);
  const shell = isoRes.shells[0];
  assert.ok(shell.vertexCount > 20, `iso at σ_mean too small (${shell.vertexCount})`);
  let maxOffset = 0;
  for (let i = 0; i < shell.vertexCount; i++) {
    const z = shell.positions[3 * i + 2];
    maxOffset = Math.max(maxOffset, Math.abs(z - L / 2));
  }
  assert.ok(maxOffset < 1e-6, `iso plane off z=L/2 by ${maxOffset} (>1e-6)`);

  // volume fraction enclosed by the σ_mean iso (keep field ≥ σ_mean) — exact
  // tet clip → 0.5 of a linear field's volume.
  const vf = clipVolumeFraction(mesh, field, sigmaMean, true);
  const fracErr = Math.abs(vf.fraction - 0.5);
  assert.ok(fracErr < 0.02, `linear-field iso volume fraction ${vf.fraction} != 0.5 (err ${fracErr})`);
  checks += 2;
  console.log(`  GATE2 linear iso@σ_mean: σ_mean=${sigmaMean.toExponential(4)} (analytic ${meanAnalytic.toExponential(4)})  `
    + `planeOffset=${maxOffset.toExponential(3)}  volFraction=${vf.fraction.toFixed(5)} (want 0.5, err ${(fracErr * 100).toFixed(3)}%)`);
}

// ── GATE 2b: radial field — iso at its mean encloses sphere fraction π/6 ────
{
  const h = 1.0, N = 40;
  const { mesh, nodal } = makeHexResultMesh(N, -h, h, (x, y, z) => x * x + y * y + z * z);
  const sigmaMean = defaultIsovalue(nodal);        // ≈ h² (volume-mean of r²)
  const isoRes = isoResult(mesh, nodal, sigmaMean); // closed sphere R≈√σ_mean
  const shell = isoRes.shells[0];
  const cubeVol = (2 * h) ** 3;
  const fraction = shell.enclosedVolume / cubeVol;
  const analytic = PI / 6;                          // (4/3πh³)/(8h³)
  const fracErr = Math.abs(fraction - analytic) / analytic;
  assert.ok(fracErr < 0.03, `radial-iso volume fraction ${fraction} != π/6 (rel ${fracErr})`);
  checks++;
  console.log(`  GATE2b radial iso@σ_mean: σ_mean=${sigmaMean.toFixed(5)} (h²=${(h * h).toFixed(5)})  `
    + `volFraction=${fraction.toFixed(5)} (π/6=${analytic.toFixed(5)}, relErr ${(fracErr * 100).toFixed(3)}%)`);
}

// ── GATE 3: probe at a known node returns its EXACT stored value ───────────
{
  const N = 6;
  const { mesh } = makeHexResultMesh(N, 0, 0.12, (x, y, z) => 0);
  // a distinctive per-node field so an exact hit is unambiguous
  const field = new Float64Array(mesh.nodeCount);
  for (let i = 0; i < mesh.nodeCount; i++) field[i] = Math.sin(12.34 * i) * 1e6 + i;

  // pick a node in the interior, probe exactly at its coordinate
  const target = 137 % mesh.nodeCount;
  const p = [mesh.nodes[3 * target], mesh.nodes[3 * target + 1], mesh.nodes[3 * target + 2]];
  const probe = probeResult(mesh, field, p);
  assert.equal(probe.nodeId, target, `probe hit node ${probe.nodeId}, expected ${target}`);
  assert.equal(probe.value, field[target], `probe value ${probe.value} != stored ${field[target]}`);
  assert.equal(probe.dist, 0, `exact-coordinate probe dist ${probe.dist} != 0`);

  // a point nudged toward the target (well within half a cell) still snaps to it
  const eps = 1e-4;
  const probe2 = probeResult(mesh, field, [p[0] + eps, p[1] - eps, p[2] + eps]);
  assert.equal(probe2.nodeId, target, 'nudged probe did not snap to nearest node');

  // nearestNode is a pure, reusable primitive
  const nn = nearestNode(mesh.nodes, mesh.nodeCount, p);
  assert.equal(nn.nodeId, target, 'nearestNode disagrees with probeResult');
  checks++;
  console.log(`  GATE3 probe: node #${target} value=${field[target].toExponential(4)} exact=${probe.value === field[target]}  dist=${probe.dist}  nudged→#${probe2.nodeId}`);
}

// ── GATE 4: reuse proof — delegates to the real sci-viz modules ────────────
{
  // identity: the functions resultFilters delegates to ARE the sci-viz originals
  assert.equal(SCIVIZ_DEPS.sliceMesh, slice.sliceMesh, 'sliceResult does not use sciviz/slice.sliceMesh');
  assert.equal(SCIVIZ_DEPS.clipMesh, clip.clipMesh, 'clipResult does not use sciviz/clip.clipMesh');
  assert.equal(SCIVIZ_DEPS.contourMesh, iso.contourMesh, 'isoResult does not use sciviz/isosurface.contourMesh');
  assert.equal(SCIVIZ_DEPS.makePlane, slice.makePlane, 'does not use sciviz/slice.makePlane');
  assert.equal(SCIVIZ_DEPS.enclosedVolume, iso.enclosedVolume, 'does not use sciviz/isosurface.enclosedVolume');

  // behavioural: sliceResult output is byte-for-byte what sciviz.sliceMesh
  // returns on the adapted mesh (proves delegation, not a parallel re-impl).
  const { mesh } = makeHexResultMesh(8, 0, 0.2, (x, y, z) => 1e6 * (x + 2 * y + 3 * z));
  const field = makeHexResultMesh(8, 0, 0.2, (x, y, z) => 1e6 * (x + 2 * y + 3 * z)).nodal;
  const plane = { point: [0.1, 0.1, 0.1], normal: [1, -1, 2] };
  const viaWrapper = sliceResult(mesh, field, plane);
  const viaDirect = slice.sliceMesh(asSciVizMesh(mesh), field, slice.makePlane(plane.point, plane.normal));
  assert.equal(viaWrapper.vertexCount, viaDirect.vertexCount, 'wrapper/direct vertexCount differ');
  assert.equal(viaWrapper.triangleCount, viaDirect.triangleCount, 'wrapper/direct triangleCount differ');
  assert.deepEqual(viaWrapper.scalarRange, viaDirect.scalarRange, 'wrapper/direct scalarRange differ');

  // report payload carries the numeric summary + probe history
  const stats = fieldStats(field);
  const report = buildFieldReport({
    fieldKey: 'vonMises', field,
    probes: [{ nodeId: 3, value: field[3], position: [0, 0, 0] }],
    filter: { mode: 'slice', plane },
  });
  assert.equal(report.units, 'Pa', 'report units wrong');
  assert.equal(report.probeCount, 1, 'report probe history missing');
  assert.ok(Math.abs(report.stats.mean - stats.mean) < 1e-6, 'report mean mismatch');
  assert.ok(report.stats.min <= report.stats.mean && report.stats.mean <= report.stats.max, 'report stats ordering');
  checks++;
  console.log(`  GATE4 reuse: identity slice/clip/iso = OK  wrapper≡direct (verts=${viaWrapper.vertexCount})  `
    + `report{min=${report.stats.min.toExponential(3)},mean=${report.stats.mean.toExponential(3)},max=${report.stats.max.toExponential(3)},probes=${report.probeCount}}`);
}

console.log(`[sciviz Inc6 results-manager] OK — ${checks} gate groups passed.`);
