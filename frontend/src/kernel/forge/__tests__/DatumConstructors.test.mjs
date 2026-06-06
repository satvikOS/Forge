// Slice-4 — parametric datum constructors (offset / 3-point / mid-plane /
// axis-from-2-points / axis-from-plane-intersection). Pure-geometry unit
// tests, no kernel needed.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  offsetPlaneSpec, planeThrough3PointsSpec, midPlaneSpec,
  axisFrom2PointsSpec, axisFromPlaneIntersectionSpec,
} from '../ReferenceGeometry.js';

test('offsetPlaneSpec moves origin along normal', () => {
  const p = offsetPlaneSpec({ origin: [0, 0, 0], normal: [0, 0, 1] }, 50);
  assert.deepEqual(p.origin, [0, 0, 50]);
  assert.deepEqual(p.normal, [0, 0, 1]);
  const down = offsetPlaneSpec({ origin: [0, 0, 0], normal: [0, 0, 1] }, -20);
  assert.deepEqual(down.origin, [0, 0, -20]);
});

test('planeThrough3PointsSpec builds a plane; collinear throws', () => {
  const p = planeThrough3PointsSpec([0, 0, 5], [10, 0, 5], [0, 10, 5]);
  assert.equal(p.origin[2], 5);
  assert.ok(Math.abs(p.normal[2]) > 0.999);
  assert.throws(() => planeThrough3PointsSpec([0, 0, 0], [1, 0, 0], [2, 0, 0]));
});

test('midPlaneSpec is halfway between two parallel planes', () => {
  const mp = midPlaneSpec(
    { origin: [0, 0, 0], normal: [0, 0, 1] },
    { origin: [0, 0, 100], normal: [0, 0, 1] });
  assert.deepEqual(mp.origin, [0, 0, 50]);
});

test('axisFrom2PointsSpec; coincident throws', () => {
  const ax = axisFrom2PointsSpec([0, 0, 0], [0, 0, 10]);
  assert.deepEqual(ax.direction, [0, 0, 1]);
  assert.throws(() => axisFrom2PointsSpec([1, 1, 1], [1, 1, 1]));
});

test('axisFromPlaneIntersectionSpec; parallel throws', () => {
  const ai = axisFromPlaneIntersectionSpec(
    { origin: [0, 0, 0], normal: [0, 0, 1] },
    { origin: [0, 0, 0], normal: [0, 1, 0] });
  assert.ok(Math.abs(Math.abs(ai.direction[0]) - 1) < 1e-9);  // X axis
  assert.throws(() => axisFromPlaneIntersectionSpec(
    { origin: [0, 0, 0], normal: [0, 0, 1] },
    { origin: [0, 0, 5], normal: [0, 0, 1] }));
});
