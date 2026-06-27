// Gate — sciviz Inc 5 : streamTubes.js (Stream Tracer + Tube).
//
// Run head-less:  node frontend/test/sciviz/streamTubes.test.js
//
// Gates:
//   • rigid-rotation field u=(−ωy, ωx, 0) → streamline is a CIRCLE
//     (closure error after one period < tol),
//   • uniform field → STRAIGHT line,
//   • seed sources (point/line/sphere/plane) + tube geometry build head-less.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  gridFromField, seedPoints, integrateStreamline, buildTubeGeometry, buildStreamTubes,
} from '../../src/forge-v4/sciviz/streamTubes.js';

let checks = 0;

// ── GATE 1: rigid rotation → closed circle ────────────────────────────────
{
  const L = 1.0, omega = 1.0;
  const cx = L / 2, cy = L / 2, cz = L / 2;
  const r = L / 4;
  // rigid-body rotation about +z through the domain centre
  const field = (x, y, z) => [-omega * (y - cy), omega * (x - cx), 0];
  const grid = gridFromField(field, { nx: 20, ny: 20, nz: 20, Lx: L, Ly: L, Lz: L });

  // verify the sampled field is the analytic field (trilinear exact for affine)
  const probe = integrateStreamline(grid, [cx + r, cy, cz], { dt: 1e-9, maxSteps: 1 });
  assert.ok(probe.length >= 2, 'integrator returned a path');

  // integrate EXACTLY one period: T = 2π/ω, fixed dt
  const Nsteps = 2000;
  const T = (2 * Math.PI) / omega;
  const dt = T / Nsteps;
  const seed = [cx + r, cy, cz];
  const path = integrateStreamline(grid, seed, { dt, maxSteps: Nsteps, direction: 'forward' });
  assert.ok(path.length >= Nsteps, `expected full period, got ${path.length} pts`);

  const end = path[path.length - 1];
  const closure = Math.hypot(end[0] - seed[0], end[1] - seed[1], end[2] - seed[2]);

  // radius should stay constant = r throughout (circle, not spiral)
  let maxRadErr = 0;
  for (const p of path) {
    const rr = Math.hypot(p[0] - cx, p[1] - cy);
    maxRadErr = Math.max(maxRadErr, Math.abs(rr - r));
    assert.ok(Math.abs(p[2] - cz) < 1e-12, 'circle must stay in the z-plane');
  }
  assert.ok(closure < 1e-3, `rigid-rotation closure error ${closure} >= 1e-3`);
  assert.ok(maxRadErr < 1e-4, `circle radius drift ${maxRadErr} >= 1e-4 (spiralling)`);
  checks += 2;
  console.log(`  GATE1 rigid rotation: closure=${closure.toExponential(3)} (<1e-3)  `
    + `maxRadiusDrift=${maxRadErr.toExponential(3)}  r=${r}`);
}

// ── GATE 2: uniform field → straight line ─────────────────────────────────
{
  const L = 1.0, U = 1.0;
  const field = () => [U, 0, 0];
  const grid = gridFromField(field, { nx: 16, ny: 8, nz: 8, Lx: L, Ly: L, Lz: L });
  const seed = [0.2, 0.5, 0.5];
  const path = integrateStreamline(grid, seed, { dt: 1e-3, maxSteps: 300, direction: 'forward' });
  assert.ok(path.length > 10, 'uniform path too short');

  // straightness: deviation of every point from the line through endpoints
  const a = path[0], b = path[path.length - 1];
  const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dlen = Math.hypot(dir[0], dir[1], dir[2]);
  let maxDev = 0;
  for (const p of path) {
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const cr = [
      ap[1] * dir[2] - ap[2] * dir[1],
      ap[2] * dir[0] - ap[0] * dir[2],
      ap[0] * dir[1] - ap[1] * dir[0],
    ];
    maxDev = Math.max(maxDev, Math.hypot(cr[0], cr[1], cr[2]) / (dlen || 1));
    assert.ok(Math.abs(p[1] - seed[1]) < 1e-12 && Math.abs(p[2] - seed[2]) < 1e-12, 'uniform line off-axis');
  }
  assert.ok(maxDev < 1e-12, `uniform field not straight: deviation ${maxDev}`);
  checks++;
  console.log(`  GATE2 uniform field: straight-line max deviation=${maxDev.toExponential(3)} (<1e-12)`);
}

// ── seed sources ──────────────────────────────────────────────────────────
{
  assert.equal(seedPoints({ type: 'point', point: [1, 2, 3] }).length, 1, 'point seed');
  assert.equal(seedPoints({ type: 'line', p1: [0, 0, 0], p2: [1, 0, 0], count: 5 }).length, 5, 'line seed');
  assert.equal(seedPoints({ type: 'sphere', center: [0, 0, 0], radius: 1, count: 20 }).length, 20, 'sphere seed');
  const sp = seedPoints({ type: 'sphere', center: [0, 0, 0], radius: 2, count: 50 });
  for (const p of sp) assert.ok(Math.abs(Math.hypot(...p) - 2) < 1e-9, 'sphere seeds on surface R=2');
  assert.equal(seedPoints({ type: 'plane', origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], nu: 4, nv: 3 }).length, 12, 'plane seed grid');
  checks++;
  console.log('  seed sources: point/line/sphere(on-surface)/plane(grid) all OK');
}

// ── tube geometry (constant + scalar-varying radius), head-less THREE ──────
{
  // build a tube around the uniform straight line
  const pts = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const radial = 8;
  const gConst = buildTubeGeometry(THREE, pts, { radius: 0.1, radialSegments: radial });
  const ring = radial + 1;
  assert.equal(gConst.getAttribute('position').count, pts.length * ring, 'tube vertex count');
  assert.equal(gConst.getIndex().count, (pts.length - 1) * radial * 6, 'tube index count');

  // scalar-varying radius
  const gVar = buildTubeGeometry(THREE, pts, { radii: [0.05, 0.1, 0.15, 0.2], radialSegments: radial });
  const pos = gVar.getAttribute('position');
  // first ring radius ≈ 0.05, last ring ≈ 0.2 (measure from polyline axis y=z=0)
  const ringRadius = (ringIdx) => {
    let rmax = 0;
    for (let s = 0; s < ring; s++) {
      const i = (ringIdx * ring + s) * 3;
      rmax = Math.max(rmax, Math.hypot(pos.getY(ringIdx * ring + s), pos.getZ(ringIdx * ring + s)));
    }
    return rmax;
  };
  assert.ok(Math.abs(ringRadius(0) - 0.05) < 1e-6, 'first ring radius ~0.05');
  assert.ok(Math.abs(ringRadius(3) - 0.2) < 1e-6, 'last ring radius ~0.2');
  checks += 2;
  console.log(`  tube geometry: const + scalar-varying radius OK (rings ${ring}, varyR ${ringRadius(0).toFixed(3)}→${ringRadius(3).toFixed(3)})`);
}

// ── full builder over the rotation grid ───────────────────────────────────
{
  const L = 1.0;
  const field = (x, y, z) => [-(y - 0.5), (x - 0.5), 0];
  const grid = gridFromField(field, { nx: 16, ny: 16, nz: 16, Lx: L, Ly: L, Lz: L });
  const group = buildStreamTubes(THREE, grid, {
    source: { type: 'line', p1: [0.6, 0.5, 0.5], p2: [0.8, 0.5, 0.5], count: 3 },
    dt: 5e-3, maxSteps: 400, radius: 0.01, varyRadiusByScalar: true,
  });
  assert.ok(group.userData.tubeCount >= 1, 'builder produced no tubes');
  assert.ok(group.children.length === group.userData.tubeCount, 'group children == tubeCount');
  checks++;
  console.log(`  buildStreamTubes: ${group.userData.tubeCount} tubes built head-less`);
}

console.log(`[sciviz Inc5 streamTubes] OK — ${checks} checks passed.`);
