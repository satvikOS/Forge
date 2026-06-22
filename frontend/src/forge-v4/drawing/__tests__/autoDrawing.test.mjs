/**
 * Node test for the AUTO-2D-DRAWING engine (Task #27).
 *   node --test frontend/src/forge-v4/drawing/__tests__/autoDrawing.test.mjs
 *
 * Drives the REAL prebuilt kernel (`forge-kernel.node`, OCCT HLR) over a
 * part with KNOWN dimensions + PMI and asserts the verifiable-without-a-
 * viewer contract:
 *   (a) the standard front/top/right/iso views are present with valid 2D
 *       projection geometry (non-empty visible polylines, hidden edges,
 *       correct silhouette spans),
 *   (b) the auto-dimension VALUES equal the part's actual W/H/D + hole Ø
 *       (an 80×60×12 plate → 80.0 / 60.0 / 12.0; a Ø20 hole → Ø20.0),
 *   (c) GD&T authored on the part's semantic PMI appears on the sheet,
 *   (d) a parameter change (width 80→120) regenerates the drawing and the
 *       width dimension reads 120.0 — the killer "drawings stay manual"
 *       gap, closed,
 *   (e) the emitted sheet is Y14.5-conformant (SVG root, border, title
 *       block, one <g> per view),
 *   (f) the ForgeToolBridge `drawing.generate` op dispatches and produces
 *       a serialisable artifact.
 *
 * No new npm packages (Forge rule) — inline SVG/DXF writers only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  generateDrawing,
  regenerateDrawing,
  rebuildShape,
  placeStandardViews,
  setForgeKernel,
  ALL_DIRS,
} from '../autoDrawing.js';
import {
  addAnnotation,
  __TEST__ as PMI_TEST,
} from '../../pmiAnnotations.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── load the prebuilt kernel (required for this suite — real HLR) ───────────
let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
  setForgeKernel(forge);
} catch (e) {
  // No prebuilt kernel — skip the whole suite rather than fake the geometry.
  // (Drawings MUST be real 2D projections; there is no fallback by design.)
  console.error('[autoDrawing.test] forge-kernel.node unavailable — skipping:', e.message);
}

const TOL = 0.05;   // mm — kernel HLR bbox is exact to well within this.

// Known plate: 80 (X/width) × 60 (Y/height) × 12 (Z/depth), Ø20 thru-hole
// centred at (40, 30) on the top face.
function buildPlate(params = {}) {
  return rebuildShape('plate-hole', {
    dx: 80, dy: 60, dz: 12, holeR: 10, ...params,
  });
}

// ── (a) standard views present with valid 2D projection geometry ────────────
test('standard views: front/top/right/iso present with valid HLR geometry', { skip: !forge }, () => {
  const shape = buildPlate();
  const placed = placeStandardViews(shape, { sheet: 'A3' });

  for (const dir of ALL_DIRS) {
    assert.ok(placed.v2[dir], `view '${dir}' projected`);
    assert.ok(placed.v2[dir].visibleEdges.length >= 1,
      `view '${dir}' has visible polylines`);
  }
  // Box silhouette: 4 visible edges on the rectangular ortho faces.
  assert.ok(placed.v2.front.visibleEdges.length >= 4, 'front has ≥4 visible edges');
  // The hole punches hidden edges into the front/right (through-feature).
  assert.ok(placed.v2.front.hiddenEdges.length >= 1, 'front shows hidden hole edges');

  // Silhouette spans must match the real geometry (the projection convention:
  // front X=width, top Y=height, front Y=depth).
  const fbb = placed.v2.front.bbox;
  const tbb = placed.v2.top.bbox;
  assert.ok(Math.abs((fbb.maxX - fbb.minX) - 80) < TOL, 'front X-span = 80 (width)');
  assert.ok(Math.abs((fbb.maxY - fbb.minY) - 12) < TOL, 'front Y-span = 12 (depth)');
  assert.ok(Math.abs((tbb.maxY - tbb.minY) - 60) < TOL, 'top Y-span = 60 (height)');

  // Each placed DrawingView is scaled + positioned on the sheet.
  for (const dir of ALL_DIRS) {
    const v = placed.views[dir];
    assert.ok(Number.isFinite(v.anchor.x) && Number.isFinite(v.anchor.y),
      `view '${dir}' has a finite sheet anchor`);
  }
});

// ── (b) auto-dimension VALUES equal the real part geometry ──────────────────
test('auto-dimension: values equal actual W/H/D + hole Ø', { skip: !forge }, () => {
  PMI_TEST.reset();
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'plate-b', title: 'PLATE B' },
    { sheet: 'A3', pmi: false });

  const byLabel = (label) => d.dimensions.find((x) => x.label === label);
  const width = byLabel('width');
  const height = byLabel('height');
  const depth = byLabel('depth');
  assert.ok(width && Math.abs(width.value - 80) < TOL, `width dim = 80 (got ${width?.value})`);
  assert.ok(height && Math.abs(height.value - 60) < TOL, `height dim = 60 (got ${height?.value})`);
  assert.ok(depth && Math.abs(depth.value - 12) < TOL, `depth dim = 12 (got ${depth?.value})`);

  // The rendered text is the value, to 1 dp — what reads on the sheet.
  assert.equal(width.text, '80.0', 'width text renders 80.0');
  assert.equal(height.text, '60.0', 'height text renders 60.0');
  assert.equal(depth.text, '12.0', 'depth text renders 12.0');

  // Ø20 hole → a radial dim whose value ≈ 20 and text reads Ø20.0.
  const hole = d.dimensions.find((x) => x.kind === 'radial');
  assert.ok(hole, 'a radial (hole) dimension was placed');
  assert.ok(Math.abs(hole.value - 20) < 0.1, `hole Ø = 20 (got ${hole.value})`);
  assert.equal(hole.text, 'Ø20.0', 'hole text renders Ø20.0');
});

// ── (c) GD&T from the part's semantic PMI appears on the sheet ──────────────
test('GD&T: a positional FCF from PMI is placed on the drawing', { skip: !forge }, () => {
  PMI_TEST.reset();
  addAnnotation({
    kind: 'gdt', bodyId: 'plate-c', faceTag: 1,
    payload: {
      characteristic: 'position', tolerance: 0.1, zoneShape: 'diameter',
      datums: [{ ref: 'A' }, { ref: 'B' }],
    },
  });
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'plate-c', title: 'PLATE C' },
    { sheet: 'A3', pmi: true });

  assert.equal(d.gdt.length, 1, 'one GD&T frame placed');
  const fcf = d.gdt[0];
  assert.equal(fcf.characteristic, 'position');
  assert.deepEqual(fcf.datums, ['A', 'B'], 'both datums carried');
  assert.equal(fcf.fcf, '[⊕|⌀0.1|A|B]', 'canonical FCF string');

  // The FCF + datum flags are present in the emitted SVG.
  assert.ok(d.svg.includes('⊕'), 'SVG carries the position glyph ⊕');
  assert.ok(d.svg.includes('⌀0.1'), 'SVG carries the Ø-zone tolerance ⌀0.1');
  assert.ok(d.svg.includes('data-label="gdt-pmi"'), 'SVG has a gdt-pmi group');
  assert.ok(d.svg.includes('data-label="datum-flag"'), 'SVG has datum flags');
});

// ── (d) PARAMETER-CHANGE PROPAGATION — the killer gap ───────────────────────
test('param change: width 80→120 regenerates the width dimension to 120.0', { skip: !forge }, () => {
  PMI_TEST.reset();
  const shape = buildPlate();
  const part = {
    shape, bodyId: 'plate-d', kind: 'plate-hole',
    params: { dx: 80, dy: 60, dz: 12, holeR: 10 },
  };

  // Baseline drawing reads 80.0.
  const before = generateDrawing(part, { sheet: 'A3', pmi: false });
  const wBefore = before.dimensions.find((x) => x.label === 'width');
  assert.ok(Math.abs(wBefore.value - 80) < TOL, 'baseline width = 80');

  // Change the width parameter and regenerate from the REBUILT geometry.
  const after = regenerateDrawing(part, { dx: 120 }, { sheet: 'A3', pmi: false });
  const wAfter = after.dimensions.find((x) => x.label === 'width');
  assert.ok(Math.abs(wAfter.value - 120) < TOL,
    `regenerated width = 120 (got ${wAfter.value}) — drawing re-derived from new geometry`);
  assert.equal(wAfter.text, '120.0', 'width text now reads 120.0');

  // Height/depth are unchanged → proves we re-projected, not edited text.
  const hAfter = after.dimensions.find((x) => x.label === 'height');
  const dAfter = after.dimensions.find((x) => x.label === 'depth');
  assert.ok(Math.abs(hAfter.value - 60) < TOL, 'height still 60');
  assert.ok(Math.abs(dAfter.value - 12) < TOL, 'depth still 12');
  // The front-view silhouette actually widened.
  assert.ok(Math.abs((after.views.find((v) => v.dir === 'front').bbox.maxX
    - after.views.find((v) => v.dir === 'front').bbox.minX) - 120) < TOL,
    'front view X-span reflowed to 120');
});

// ── (e) Y14.5-conformant sheet structure ────────────────────────────────────
test('sheet: conformant SVG (root, border, title block, one <g> per view)', { skip: !forge }, () => {
  PMI_TEST.reset();
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'plate-e', title: 'PLATE E' },
    { sheet: 'A3', orientation: 'landscape', pmi: false });

  assert.ok(d.svg.includes('<svg'), 'SVG root element present');
  assert.ok(/data-sheet="A3"/.test(d.svg), 'sheet size recorded on the SVG');
  assert.ok(/<rect x="0\.5" y="0\.5"/.test(d.svg), 'sheet border rect present');
  assert.ok(d.svg.includes('data-label="title-block"'), 'title block present');
  for (const label of ['FRONT', 'TOP', 'RIGHT', 'ISO']) {
    assert.ok(d.svg.includes(`data-label="${label}"`), `view group <g> for ${label}`);
  }
  // DXF bonus.
  const dxfRun = generateDrawing({ shape, bodyId: 'plate-e' },
    { sheet: 'A3', pmi: false, dxf: true });
  assert.ok(typeof dxfRun.dxf === 'string' && dxfRun.dxf.includes('ENTITIES'),
    'DXF bonus emitted with an ENTITIES section');
});

// ── (f) ForgeToolBridge drawing.generate op ─────────────────────────────────
test('bridge: drawing.generate dispatches and returns an artifact', { skip: !forge }, async () => {
  PMI_TEST.reset();
  addAnnotation({
    kind: 'gdt', bodyId: 'plate-f', faceTag: 1,
    payload: { characteristic: 'flatness', tolerance: 0.05, zoneShape: 'none', datums: [] },
  });
  const { dispatchToolCall } = await import('../../../ai/ForgeToolBridge.js');
  const shape = buildPlate();

  const res = await dispatchToolCall(
    { name: 'drawing.generate', arguments: { shape, bodyId: 'plate-f', sheet: 'A3', pmi: true } },
    { forge },
  );
  assert.equal(res.ok, true, `dispatch ok (${res.error || ''})`);
  assert.equal(res.tool, 'drawing.generate');
  assert.ok(res.result.views >= 3, `≥3 views (got ${res.result.views})`);
  assert.ok(res.result.dimensions >= 3, `≥3 dimensions (got ${res.result.dimensions})`);
  assert.ok(res.result.gdt >= 1, `≥1 GD&T frame (got ${res.result.gdt})`);
  assert.ok(res.result.svgLength > 100, 'an SVG sheet was produced');
});
