// Lightweight assert-based tests for ReferenceGeometry.
// Run with: node frontend/src/kernel/forge/__tests__/ReferenceGeometry.test.mjs
// Avoids pulling Vitest just for a slice.

import assert from 'node:assert/strict';
import {
  ReferencePlane,
  ReferenceAxis,
  ReferenceCoordSystem,
  ReferenceFrame,
} from '../ReferenceGeometry.js';

// ---- ReferencePlane -------------------------------------------------
{
  const p = new ReferencePlane({ normal: [0, 0, 2], name: 'P' });
  assert.deepEqual(p.normal, [0, 0, 1], 'normal normalised');
  assert.equal(p.containsPoint([5, 5, 0]), true);
  assert.equal(p.containsPoint([0, 0, 1]), false);
}

// ---- ReferenceCoordSystem ------------------------------------------
{
  // y given non-orthogonal to x; should be Gram-Schmidted.
  const c = new ReferenceCoordSystem({
    xAxis: [2, 0, 0],
    yAxis: [3, 4, 0],
    name: 'Tilted',
  });
  assert.deepEqual(c.xAxis, [1, 0, 0]);
  assert.deepEqual(c.yAxis, [0, 1, 0]);
  assert.deepEqual(c.zAxis, [0, 0, 1]);
  const m = c.toMatrix();
  assert.equal(m.length, 16);
  assert.equal(m[0], 1); assert.equal(m[5], 1); assert.equal(m[10], 1); assert.equal(m[15], 1);
}

// ---- ReferenceFrame defaults ---------------------------------------
{
  const f = new ReferenceFrame();
  assert.equal(f.list().length, 4); // 3 planes + origin csys
  assert.ok(f.byName('Front Plane (XY)'));
  assert.ok(f.byName('Top Plane (XZ)'));
  assert.ok(f.byName('Right Plane (YZ)'));
  assert.ok(f.byName('Origin'));
  assert.equal(f.byKind('plane').length, 3);
  assert.equal(f.byKind('csys').length, 1);
}

// ---- add / remove ---------------------------------------------------
{
  const f = new ReferenceFrame();
  const a = f.add(new ReferenceAxis({ direction: [1, 0, 0], name: 'X' }));
  assert.equal(f.byId(a.id), a);
  assert.equal(f.byKind('axis').length, 1);
  f.remove(a.id);
  assert.equal(f.byKind('axis').length, 0);
}

// ---- serialize / deserialize round-trip ----------------------------
{
  const f = new ReferenceFrame();
  f.add(new ReferenceAxis({ direction: [0, 0, 1], name: 'Spin' }));
  const json = f.serialize();
  const g = ReferenceFrame.deserialize(json);
  assert.equal(g.list().length, f.list().length);
  assert.ok(g.byName('Spin'));
  assert.ok(g.byName('Front Plane (XY)'));
}

// ---- error paths ----------------------------------------------------
{
  assert.throws(() => new ReferencePlane({ normal: [0, 0, 0] }),
                /zero-length/i);
  assert.throws(() => new ReferenceCoordSystem({ xAxis: [1, 0, 0] }),
                /CSys requires/);
}

console.log('[forge.ref] all tests passed');
