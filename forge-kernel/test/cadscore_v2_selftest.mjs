// ─────────────────────────────────────────────────────────────────────────────
// ForgeCADScore v2 — kernel-free self-test of the canonical CADGenBench formulas.
// Pins the v1→v2 alignment (topology squared-ratio, interface IoU ramp, TRUE
// volume IoU, shape = 0.5·(F1+volIoU)) to the verbatim metrics_page.py forms in
// CADGENBENCH_SPEC.md — no kernel/corpus needed. Run:
//   node forge-kernel/test/cadscore_v2_selftest.mjs
// Exits non-zero on any mismatch.
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import {
  topologyCredit, interfaceRamp, volumeIoU, surfaceF1, shapeFromTess, bboxDiag,
} from './cadscore_harness.mjs';

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); pass++; };
const near = (name, got, want, tol) => {
  const d = Math.abs(got - want);
  assert.ok(d <= tol, `${name}: got ${got.toFixed(4)} want ${want.toFixed(4)} (±${tol})`);
  console.log(`  ✓ ${name}  (${got.toFixed(4)} ≈ ${want})`);
  pass++;
};

// A closed axis-aligned box tessellation (12 triangles) — ray-parity-correct.
function box(lo, hi) {
  const v = [
    [lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]],
    [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const positions = new Float32Array(v.flat());
  const indices = new Uint32Array(f.flat());
  return { positions, indices };
}
function bboxObj(lo, hi) { return { min: lo.slice(), max: hi.slice() }; }

console.log('— topologyCredit: s_i = ((min+1)/(max+1))² —');
near('credit(2,4) = (3/5)² = 0.36', topologyCredit(2, 4), 0.36, 1e-9);
near('credit(4,2) symmetric', topologyCredit(4, 2), 0.36, 1e-9);
near('credit(1,1) = 1', topologyCredit(1, 1), 1, 1e-9);
near('credit(0,0) = 1', topologyCredit(0, 0), 1, 1e-9);
near('credit(1,4) = (2/5)² = 0.16', topologyCredit(1, 4), 0.16, 1e-9);
// Canonical worked example: GT (1,2,0) vs cand (1,4,0) → product 0.36.
const topo = topologyCredit(1, 1) * topologyCredit(2, 4) * topologyCredit(0, 0);
near('topology product (1,2,0)v(1,4,0) = 0.36', topo, 0.36, 1e-9);

console.log('— interfaceRamp: ≥0.95→1, ≤0.80→0, linear —');
near('ramp(0.95) = 1', interfaceRamp(0.95), 1, 1e-9);
near('ramp(0.80) = 0', interfaceRamp(0.80), 0, 1e-9);
near('ramp(0.875) = 0.5', interfaceRamp(0.875), 0.5, 1e-9);
near('ramp(0.70) = 0 (clamp)', interfaceRamp(0.70), 0, 1e-9);
near('ramp(1.00) = 1 (clamp)', interfaceRamp(1.00), 1, 1e-9);
near('ramp(0.90) = 0.6667', interfaceRamp(0.90), 2 / 3, 1e-6);

console.log('— volumeIoU: TRUE Monte-Carlo IoU (not the v1 proxy) —');
const unit = box([0, 0, 0], [1, 1, 1]);
near('IoU(box, same box) ≈ 1', volumeIoU(unit, box([0, 0, 0], [1, 1, 1])), 1, 0.02);
near('IoU(box, disjoint box) ≈ 0', volumeIoU(unit, box([3, 3, 3], [4, 4, 4])), 0, 0.01);
// shift +0.5 in x: ∩ = [0.5,1]×[0,1]×[0,1]=0.5; ∪ = 1+1-0.5 = 1.5; IoU = 1/3.
near('IoU(box, x+0.5 box) ≈ 1/3', volumeIoU(unit, box([0.5, 0, 0], [1.5, 1, 1])), 1 / 3, 0.02);
// The v1 PROXY failure case: two equal-volume, fully-disjoint cubes. Proxy gave ~1;
// true IoU must be ~0. This is the bug v2 fixes.
ok('v1-proxy bug fixed: equal-volume disjoint cubes IoU ≈ 0 (not ~1)',
  volumeIoU(unit, box([2, 2, 2], [3, 3, 3])) < 0.01);

console.log('— surfaceF1 + shapeFromTess composite —');
const diag = bboxDiag(bboxObj([0, 0, 0], [1, 1, 1]));
near('bboxDiag(unit cube) = √3', diag, Math.sqrt(3), 1e-6);
near('surfaceF1(box, same box) ≈ 1', surfaceF1(unit, box([0, 0, 0], [1, 1, 1]), 8000, 0.005 * diag), 1, 0.02);
// shape = 0.5·(F1 + volIoU). Identical snapshots → ≈1; a shifted box → clearly lower.
const snapSame = { tess: unit, bbox: bboxObj([0, 0, 0], [1, 1, 1]) };
const snapSame2 = { tess: box([0, 0, 0], [1, 1, 1]), bbox: bboxObj([0, 0, 0], [1, 1, 1]) };
const snapShift = { tess: box([0.5, 0, 0], [1.5, 1, 1]), bbox: bboxObj([0.5, 0, 0], [1.5, 1, 1]) };
near('shapeFromTess(same) ≈ 1', shapeFromTess(snapSame, snapSame2).shape, 1, 0.03);
ok('shapeFromTess(shifted) clearly < same', shapeFromTess(snapSame, snapShift).shape < 0.75);

console.log(`\n✅ ForgeCADScore v2 self-test: ${pass}/${pass} canonical-formula checks PASS`);
