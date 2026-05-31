/**
 * measurements smoke — the math underpinning the on-screen ruler.
 */

import assert from 'node:assert/strict';

import { distance, angleAt, polygonArea, summarise, snapToHints }
  from '../measurements.js';

// ---- distance ---------------------------------------------------------
assert.equal(distance([0,0,0], [3,4,0]), 5);
assert.equal(distance([1,1,1], [1,1,1]), 0);
assert.equal(distance(null, [0,0,0]), 0);

// ---- angle at the middle vertex --------------------------------------
{
  // 90° angle: a-b-c with a=(1,0,0), b=(0,0,0), c=(0,1,0)
  const a = [1,0,0], b = [0,0,0], c = [0,1,0];
  const rad = angleAt(a, b, c);
  assert.ok(Math.abs(rad - Math.PI / 2) < 1e-9);
}
{
  // 180° straight line
  const rad = angleAt([1,0,0], [0,0,0], [-1,0,0]);
  assert.ok(Math.abs(rad - Math.PI) < 1e-9);
}

// ---- polygon area (unit square) --------------------------------------
{
  const sq = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
  const a = polygonArea(sq);
  assert.ok(Math.abs(a - 1) < 1e-9, `unit square area should be 1, got ${a}`);
}

// ---- summarise dispatch ----------------------------------------------
assert.equal(summarise([]).kind,            'incomplete');
assert.equal(summarise([[0,0,0]]).kind,     'incomplete');
assert.equal(summarise([[0,0,0],[1,0,0]]).kind, 'distance');
assert.equal(summarise([[1,0,0],[0,0,0],[0,1,0]]).kind, 'angle');
assert.equal(summarise([[0,0,0],[1,0,0],[1,1,0],[0,1,0]]).kind, 'area');

// ---- summarise labels -----------------------------------------------
{
  const s = summarise([[0,0,0],[3,4,0]], { units: 'mm' });
  assert.match(s.label, /5\.000\s+mm/);
}

// ---- snap to hints ---------------------------------------------------
{
  const hints = [
    { point: [10, 10, 10], kind: 'vertex', weight: 3 },
    { point: [20, 20, 20], kind: 'edge',   weight: 2 },
  ];
  // Picking near (10, 10, 11) should snap to the vertex.
  const r = snapToHints([10, 10, 10.5], hints, 5);
  assert.deepEqual(r.point, [10, 10, 10]);
  assert.equal(r.snapped.kind, 'vertex');
  // Far pick — no snap.
  const r2 = snapToHints([100, 100, 100], hints, 5);
  assert.equal(r2.snapped, null);
  assert.deepEqual(r2.point, [100, 100, 100]);
}

console.log('[forge.viewport] measurements smoke passed');
