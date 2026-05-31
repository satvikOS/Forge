/**
 * sectionPlane smoke — math for the cutting plane UI.
 */

import assert from 'node:assert/strict';

import { makeSectionState, slidePlane, worldToPlaneOffset,
         clippingDescriptor, reorientPlane } from '../sectionPlaneLogic.js';

// ---- normalisation ---------------------------------------------------
{
  const s = makeSectionState({ normal: [2, 0, 0], offset: 5, enabled: true });
  assert.deepEqual(s.normal, [1, 0, 0]);
  assert.equal(s.offset, 5);
}

// ---- slide ----------------------------------------------------------
{
  const s = makeSectionState({ offset: 0, enabled: true });
  const s2 = slidePlane(s, 3);
  assert.equal(s2.offset, 3);
  const s3 = slidePlane(s2, -1);
  assert.equal(s3.offset, 2);
}

// ---- world → offset projection --------------------------------------
{
  const s = makeSectionState({ normal: [0, 0, 1] });
  const off = worldToPlaneOffset([5, 6, 7], s);
  assert.equal(off, 7);
}

// ---- clipping descriptor: disabled returns null ----------------------
{
  assert.equal(clippingDescriptor(null), null);
  assert.equal(clippingDescriptor({ enabled: false, normal: [1,0,0], offset: 1 }), null);
}

// ---- clipping descriptor: enabled inverts offset → constant ----------
{
  const s = makeSectionState({ normal: [1, 0, 0], offset: 4, enabled: true });
  const d = clippingDescriptor(s);
  assert.deepEqual(d.normal, [1, 0, 0]);
  assert.equal(d.constant, -4);
}

// ---- reorient anchors plane to a point ------------------------------
{
  const s = makeSectionState({ normal: [1, 0, 0], offset: 0, enabled: true });
  const s2 = reorientPlane(s, [0, 0, 1], [0, 0, 10]);
  assert.deepEqual(s2.normal, [0, 0, 1]);
  assert.equal(s2.offset, 10);
}

console.log('[forge.viewport] sectionPlane smoke passed');
