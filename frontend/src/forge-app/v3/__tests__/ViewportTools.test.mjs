import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gizmo, MeasurementOverlay, SectionPlane, polygonAreaXY }
  from '../ViewportTools.jsx';

// 1) SSR: all three primitives render null (or empty) when the THREE
//    bundle hasn't lazy-loaded — guaranteed by lazy-import gating.
{
  const refStub = { current: null };
  const a = renderToStaticMarkup(React.createElement(Gizmo, {
    mode: 'translate', enabled: true, targetRef: refStub,
  }));
  assert.equal(a, '', 'Gizmo SSR is empty');

  const b = renderToStaticMarkup(React.createElement(MeasurementOverlay, {
    mode: 'distance', points: [[0,0,0],[10,0,0]],
  }));
  assert.equal(b, '', 'MeasurementOverlay SSR is empty');

  const c = renderToStaticMarkup(React.createElement(SectionPlane, {
    enabled: true,
  }));
  assert.equal(c, '', 'SectionPlane SSR is empty');
}

// 2) polygonAreaXY — known cases.
{
  // Unit square in xy plane.
  const square = [[0,0,0], [1,0,0], [1,1,0], [0,1,0]];
  assert.ok(Math.abs(polygonAreaXY(square) - 1) < 1e-6, 'unit square area = 1');

  // Right triangle in yz plane (drop x).
  const tri = [[0,0,0], [0,3,0], [0,0,4]];
  assert.ok(Math.abs(polygonAreaXY(tri) - 6) < 1e-6,
            `right triangle 3×4 area = 6 (got ${polygonAreaXY(tri)})`);

  // Square in xz plane (drop y).
  const xzSq = [[0,0,0], [2,0,0], [2,0,2], [0,0,2]];
  assert.ok(Math.abs(polygonAreaXY(xzSq) - 4) < 1e-6,
            `xz square 2×2 area = 4 (got ${polygonAreaXY(xzSq)})`);

  // Degenerate (< 3 points) → 0.
  assert.equal(polygonAreaXY([[0,0,0]]), 0);
  assert.equal(polygonAreaXY([[0,0,0],[1,0,0]]), 0);
}

console.log('[forge.v3.viewport-tools] all tests passed');
