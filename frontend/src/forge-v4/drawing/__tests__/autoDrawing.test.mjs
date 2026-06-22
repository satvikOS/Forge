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
  regenerate,
  rebuildShape,
  placeStandardViews,
  placeSectionView,
  placeDetailView,
  buildBom,
  placeBomBalloons,
  hatchSpacingForArea,
  nearestVisibleEdgePoint,
  project3dToView,
  setForgeKernel,
  HATCH_ANGLE_CYCLE,
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

// ════════════════════════════════════════════════════════════════════════════
// Task #45 — COMPLETE the engine. Each test drives the REAL kernel (OCCT cut +
// HLR) and asserts the PUBLISHED drafting standards are honored. CITED:
//   ASME Y14.2 (line conventions / section callout), Y14.3 (views / detail),
//   Y14.5 (GD&T), Y14.34 (BOM/balloons); ISO 128 (lines/hatching), 129 (dims).
// ════════════════════════════════════════════════════════════════════════════

// Walk a flat-packed bucket (visible/cut/hatch + starts) → [[ [x,y],… ],…].
function iterFlat(flat, starts, count) {
  const out = [];
  if (!flat || !starts || !count) return out;
  for (let i = 0; i < count; i += 1) {
    const s = starts[i] * 2, e = starts[i + 1] * 2;
    const v = [];
    for (let k = s; k < e; k += 2) v.push([flat[k], flat[k + 1]]);
    out.push(v);
  }
  return out;
}

// Angle of a 2-pt line in [0,180) degrees.
function lineAngleDeg(seg) {
  let a = Math.atan2(seg[seg.length - 1][1] - seg[0][1],
                     seg[seg.length - 1][0] - seg[0][0]) * 180 / Math.PI;
  if (a < 0) a += 180;
  if (a >= 180) a -= 180;
  return a;
}

// Perpendicular spacings between consecutive parallel hatch lines, for the
// hatch family at `angleDeg`. Projects each line's midpoint onto the family
// normal and returns the sorted positive gaps (uniform-spacing check).
function hatchSpacings(lines, angleDeg) {
  const th = angleDeg * Math.PI / 180;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const proj = lines.map((seg) => {
    const mx = (seg[0][0] + seg[seg.length - 1][0]) / 2;
    const my = (seg[0][1] + seg[seg.length - 1][1]) / 2;
    return mx * nx + my * ny;
  }).sort((p, q) => p - q);
  const gaps = [];
  for (let i = 1; i < proj.length; i += 1) {
    const g = proj[i] - proj[i - 1];
    if (g > 1e-3) gaps.push(g);
  }
  return gaps;
}

// ── #45 (A) SECTION — ISO 128-50 hatch (angle + UNIFORM spacing) + Y14.2 ─────
test('#45 (A) section: ISO 128-50 hatch at the spec angle with uniform spacing', { skip: !forge }, () => {
  PMI_TEST.reset();
  const plate = buildPlate();
  const placed = placeStandardViews(plate, { sheet: 'A3' });
  // Cut at mid-height (world Y=30), projected looking front; callout on top.
  const sv = placeSectionView(placed, { shape: plate },
    { origin: [0, 30, 0], normal: [0, 1, 0] },
    { direction: 'front', parentDir: 'top', hatchAngle: 45 });

  const proj = sv.view.projection;
  // Real cut: the section boundary + hatch buckets are non-empty.
  assert.ok((proj.cutCount || 0) >= 1, `section has a real cut face (cutCount=${proj.cutCount})`);
  assert.ok((proj.hatchCount || 0) >= 3, `section is hatched (hatchCount=${proj.hatchCount})`);

  // ISO 128-50: hatch lines are ALL at 45° (the spec angle).
  const hatch = iterFlat(proj.hatch, proj.hatchStarts, proj.hatchCount);
  const angles = hatch.map(lineAngleDeg);
  for (const a of angles) {
    assert.ok(Math.abs(a - 45) < 0.5, `every hatch line is at 45° (got ${a.toFixed(2)})`);
  }
  // ISO 128-50: the hatch is a REGULAR parallel family at one base spacing. The
  // plate's Ø20 hole omits the lines that fall in the void (correct — hatch is
  // clipped to material), so consecutive perpendicular gaps must each be an
  // INTEGER MULTIPLE of the base spacing (not all identical — that would mean the
  // hatch wrongly filled through the hole).
  const gaps = hatchSpacings(hatch, 45);
  assert.ok(gaps.length >= 1, 'measurable hatch spacing');
  const base = Math.min(...gaps);
  assert.ok(base > 0.5, `positive base hatch spacing (got ${base.toFixed(3)})`);
  for (const g of gaps) {
    const k = g / base;
    assert.ok(Math.abs(k - Math.round(k)) < 0.05,
      `gap ${g.toFixed(3)} is an integer multiple of the base spacing ${base.toFixed(3)} (k=${k.toFixed(2)})`);
  }

  // ASME Y14.2: the cutting-plane line + SECTION letter callout lands on the
  // PARENT view (a 'section-line' decoration), not the section itself.
  const parent = placed.views.top;
  const secLine = (parent.decorations || []).find((d) => d.kind === 'section-line');
  assert.ok(secLine, 'parent view carries the Y14.2 cutting-plane line decoration');
  assert.ok(/^[A-Z]$/.test(secLine.letter), 'cutting-plane line carries a section letter');
  assert.ok(/^SECTION [A-Z]-[A-Z]$/.test(sv.label), `Y14.2 label "SECTION A-A" (got ${sv.label})`);
});

// ── #45 (A) SECTION HATCH CLIPPING — no leak through holes/voids (ISO 128-50) ─
// ISO 128-50 requires hatch confined to the CUT FACE (material only). The cut at
// world Y=30 passes through the Ø20 hole, so the section face has a VOID; before
// the bbox-fill fix, hatch lines crossed the hole. Assert every emitted hatch
// segment lies inside the cut material (even-odd over the cut loops), proving
// the hatch is clipped to the face and skips the hole — not a bbox fill.
test('#45 (A) section hatch is CLIPPED to the cut face — no leak through the hole [ISO 128-50]', { skip: !forge }, () => {
  PMI_TEST.reset();
  const plate = buildPlate(); // 80×60×12, Ø20 thru-hole at centre
  const placed = placeStandardViews(plate, { sheet: 'A3' });
  const sv = placeSectionView(placed, { shape: plate },
    { origin: [0, 30, 0], normal: [0, 1, 0] }, // cut through the hole centre
    { direction: 'front', parentDir: 'top', hatchAngle: 45 });
  const proj = sv.view.projection;
  // The cut outline is delivered as an EDGE SOUP (2-pt segments); collect edges.
  const E = [];
  for (const pl of iterFlat(proj.cut, proj.cutStarts, proj.cutCount)) {
    for (let s = 0; s + 1 < pl.length; s += 1) E.push([pl[s][0], pl[s][1], pl[s + 1][0], pl[s + 1][1]]);
  }
  assert.ok(E.length >= 4, `section has a real cut boundary (edges=${E.length})`);
  // even-odd crossing test against the boundary edges (void → even → outside).
  const inMat = (px, py) => {
    let c = false;
    for (const e of E) {
      const xi = e[0], yi = e[1], xj = e[2], yj = e[3];
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-30) + xi)) c = !c;
    }
    return c;
  };
  // Non-vacuous: prove a VOID exists — grid-sample the cut bbox and confirm some
  // interior points are NOT material (the Ø20 hole), so 'no leak' is meaningful.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const e of E) { bx0 = Math.min(bx0, e[0], e[2]); by0 = Math.min(by0, e[1], e[3]); bx1 = Math.max(bx1, e[0], e[2]); by1 = Math.max(by1, e[1], e[3]); }
  let voidPts = 0;
  for (let i = 1; i < 40; i += 1) for (let j = 1; j < 20; j += 1) {
    if (!inMat(bx0 + (bx1 - bx0) * i / 40, by0 + (by1 - by0) * j / 20)) voidPts += 1;
  }
  assert.ok(voidPts > 0, 'the section face contains a void (the hole) to clip against');
  const hatch = iterFlat(proj.hatch, proj.hatchStarts, proj.hatchCount);
  assert.ok(hatch.length >= 3, 'section is still hatched after clipping (material remains)');
  let leaks = 0;
  for (const seg of hatch) {
    const mx = (seg[0][0] + seg[seg.length - 1][0]) / 2;
    const my = (seg[0][1] + seg[seg.length - 1][1]) / 2;
    if (!inMat(mx, my)) leaks += 1;
  }
  assert.equal(leaks, 0,
    `every hatch segment is inside cut material — none leak through the hole/void; leaks=${leaks}/${hatch.length}`);
});

// ── #45 (A) MULTI-BODY SECTION — distinct hatch angles per body ──────────────
test('#45 (A) multi-body section: adjacent bodies get DISTINCT hatch angles', { skip: !forge }, () => {
  PMI_TEST.reset();
  const boxA = forge.makeBox(40, 60, 12);
  const boxB = forge.translate(forge.makeBox(40, 60, 12), 50, 0, 0);
  const placed = placeStandardViews(boxA, { sheet: 'A3' });
  const sv = placeSectionView(placed, { bodies: [{ shape: boxA }, { shape: boxB }] },
    { origin: [0, 30, 0], normal: [0, 1, 0] },
    { direction: 'front', parentDir: 'top' });

  // Two bodies → two hatch reports, at DISTINCT angles (ISO 128-50: adjacent
  // parts hatched at different angles so they are visually separable).
  assert.equal(sv.hatch.length, 2, 'a hatch report per body');
  const angs = sv.hatch.map((h) => h.angleDeg);
  assert.equal(new Set(angs).size, angs.length, `distinct angles per body (got ${JSON.stringify(angs)})`);
  assert.equal(angs[0], HATCH_ANGLE_CYCLE[0], 'first body at 45°');
  assert.equal(angs[1], HATCH_ANGLE_CYCLE[1], 'second body at 135°');

  // The SECOND body's hatch geometry is actually at its assigned angle.
  const ev = sv.extraViews[0];
  const h2 = iterFlat(ev.projection.hatch, ev.projection.hatchStarts, ev.projection.hatchCount);
  assert.ok(h2.length >= 1, 'second body is hatched');
  for (const seg of h2) {
    assert.ok(Math.abs(lineAngleDeg(seg) - 135) < 0.5, 'second body hatch is at 135°');
  }
  // And UNIFORM spacing within that body.
  const gaps = hatchSpacings(h2, 135);
  if (gaps.length) {
    assert.ok((Math.max(...gaps) - Math.min(...gaps)) < 0.05, 'second body hatch spacing uniform');
  }
});

// ── #45 (A) area-scaled spacing (ISO 128-50) ────────────────────────────────
test('#45 (A) hatch spacing scales with sectioned area (ISO 128-50)', { skip: !forge }, () => {
  // Pure-math contract: bigger cut area → larger (clamped) spacing.
  const small = hatchSpacingForArea({ minX: 0, minY: 0, maxX: 8, maxY: 8 });    // area 64
  const big = hatchSpacingForArea({ minX: 0, minY: 0, maxX: 400, maxY: 400 });  // area 160k
  assert.ok(small >= 1.5 && small <= 6, `small-face spacing clamped (${small})`);
  assert.ok(big >= 1.5 && big <= 6, `big-face spacing clamped (${big})`);
  assert.ok(big > small, 'larger sectioned area → coarser hatch spacing');
});

// ── #45 (B) DETAIL VIEW (ASME Y14.3) ────────────────────────────────────────
test('#45 (B) detail: focus circle on source view + enlarged DETAIL view', { skip: !forge }, () => {
  PMI_TEST.reset();
  const plate = buildPlate();
  const placed = placeStandardViews(plate, { sheet: 'A3' });
  const before = placed.drawing.views.length;
  const dv = placeDetailView(placed, { shape: plate }, 'front', { x: 40, y: -6, r: 14 }, 2);

  // ASME Y14.3: the SOURCE view gets a dashed focus-circle + letter callout.
  const src = placed.views.front;
  const callout = (src.decorations || []).find((d) => d.kind === 'detail-callout');
  assert.ok(callout, 'source view carries a detail-callout');
  assert.ok(Math.abs(callout.cx - 40) < 1e-6 && Math.abs(callout.r - 14) < 1e-6,
    'callout circle matches the requested focus circle');
  assert.ok(/^[A-Z]$/.test(callout.letter), 'detail callout carries a letter');

  // A NEW enlarged view was added, labeled "DETAIL <L> (2:1)".
  assert.equal(placed.drawing.views.length, before + 1, 'one detail view added');
  assert.ok(/^DETAIL [A-Z] \(2:1\)$/.test(dv.label), `Y14.3 detail label (got ${dv.label})`);
  assert.equal(dv.scale, 2, 'detail enlarged at 2:1');
  // The enlarged detail carries real projected geometry.
  assert.ok((dv.view.projection.visibleCount || 0) >= 1, 'detail view has projected geometry');
});

// ── #45 (C) PMI EDGE ANCHOR — lands on a VISIBLE edge, never a hidden one ────
test('#45 (C) FCF anchor lands on a projected VISIBLE edge (ISO 129-1)', { skip: !forge }, () => {
  PMI_TEST.reset();
  // anchor stored as a 3-vector (addAnnotation persists `anchor` verbatim);
  // [80,30,0] projects (front: x→X, z→-Y) to [80,0] — the top-right corner.
  addAnnotation({
    kind: 'gdt', bodyId: 'plate-anch', faceTag: 1, anchor: [80, 30, 0],
    payload: { characteristic: 'perpendicularity', tolerance: 0.05, zoneShape: 'none', datums: [{ ref: 'A' }] },
  });
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'plate-anch', title: 'ANCH' }, { sheet: 'A3', pmi: true });

  assert.equal(d.gdt.length, 1, 'one FCF placed');
  const g = d.gdt[0];
  // The leader is bound to a SPECIFIC visible edge (anchor id + landing pt).
  assert.equal(g.anchorKind, 'edge', 'anchored to a model edge');
  assert.ok(Number.isInteger(g.anchorEdge) && g.anchorEdge >= 0, `edge id recorded (${g.anchorEdge})`);
  assert.equal(g.anchorOnHidden, false, 'NOT anchored to a hidden line (ISO 129-1)');

  // The landing point lies ON a real VISIBLE edge of that view (dist ≈ 0)…
  const v2 = d.placed.v2[g.view];
  const hit = nearestVisibleEdgePoint(g.anchorPoint, v2);
  assert.ok(hit && hit.dist < TOL, `leader endpoint lies on a visible edge (dist ${hit?.dist?.toFixed(4)})`);
  // …and it is NOT the floating bbox-corner the old code used.
  const bb = v2.bbox;
  const isFreeCorner = (Math.abs(g.anchorPoint[0] - bb.minX) < 1e-6 && Math.abs(g.anchorPoint[1] - bb.minY) < 1e-6);
  assert.ok(!isFreeCorner, 'anchor is a real edge point, not the floating bbox corner');
  // For the [80,0] projection it lands exactly on the top visible edge.
  assert.ok(Math.abs(g.anchorPoint[0] - 80) < TOL && Math.abs(g.anchorPoint[1] - 0) < TOL,
    `anchor landed at the projected edge point [80,0] (got ${JSON.stringify(g.anchorPoint)})`);
});

// ── #45 (C) positional FCF binds to the hole-axis centre + centre lines ─────
test('#45 (C) positional FCF binds to the hole centre + ISO-128 centre marks', { skip: !forge }, () => {
  PMI_TEST.reset();
  addAnnotation({
    kind: 'gdt', bodyId: 'plate-pos', faceTag: 1,
    payload: { characteristic: 'position', tolerance: 0.1, zoneShape: 'diameter', datums: [{ ref: 'A' }, { ref: 'B' }] },
  });
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'plate-pos', title: 'POS' }, { sheet: 'A3', pmi: true });

  const g = d.gdt[0];
  assert.equal(g.anchorKind, 'hole-center', 'position tolerance references the feature axis');
  // Hole centred at (40,30) on the top face → top view centre ≈ (40,30).
  assert.ok(Math.abs(g.anchorPoint[0] - 40) < 1.0 && Math.abs(g.anchorPoint[1] - 30) < 1.0,
    `position FCF binds to the hole centre (got ${JSON.stringify(g.anchorPoint)})`);

  // ISO 128-24 centre marks were emitted for the detected hole.
  assert.ok(d.centerMarks.length >= 1, 'centre marks placed for the hole');
  assert.ok(d.svg.includes('data-label="center-lines"'), 'SVG carries the centre-line group');
});

// ── #45 (D) BALLOON ↔ BOM 1:1 (ASME Y14.34) ─────────────────────────────────
test('#45 (D) balloon numbers map 1:1 to BOM rows (ASME Y14.34)', { skip: !forge }, () => {
  PMI_TEST.reset();
  const asm = forge.makeBox(120, 120, 20);
  // 3 instances of 2 distinct parts (BOLT ×2 + PLATE ×1).
  const assembly = [
    { partNumber: 'BOLT-M8', description: 'Hex bolt M8×30', qty: 1, view: 'top', anchor: [20, 20, 0] },
    { partNumber: 'PLATE-1', description: 'Base plate', qty: 1, view: 'top', anchor: [60, 60, 0] },
    { partNumber: 'BOLT-M8', description: 'Hex bolt M8×30', qty: 1, view: 'top', anchor: [100, 20, 0] },
  ];
  const d = generateDrawing({ shape: asm, bodyId: 'asm' }, { sheet: 'A3', pmi: false, assembly });

  // BOM: 2 rows, item numbers 1..N, qty summed per part.
  assert.equal(d.bom.length, 2, 'two BOM rows (deduped by partNumber)');
  assert.deepEqual(d.bom.map((r) => r.item), [1, 2], 'item numbers 1..N');
  const bolt = d.bom.find((r) => r.partNumber === 'BOLT-M8');
  assert.equal(bolt.qty, 2, 'BOLT qty summed across instances');

  // 1:1 — one balloon per BOM row, with matching numbers.
  assert.equal(d.balloons.length, 2, 'one balloon per part (N balloons for N rows)');
  const itemNums = new Set(d.bom.map((r) => r.item));
  const balloonNums = new Set(d.balloons.map((b) => b.item));
  assert.deepEqual([...balloonNums].sort(), [...itemNums].sort(), 'balloon numbers == BOM item numbers (1:1)');

  // The balloons carry a real leader (anchor ≠ balloon position).
  for (const b of d.balloons) {
    const moved = Math.hypot(b.balloonAt[0] - b.anchor2d[0], b.balloonAt[1] - b.anchor2d[1]);
    assert.ok(moved > 1, 'balloon offset from its anchor → a real leader line');
  }
  // The BOM table is in the SVG with one row per item.
  assert.ok(d.svg.includes('data-label="bom-table"'), 'BOM table emitted');
  for (const r of d.bom) {
    assert.ok(d.svg.includes(`data-bom-item="${r.item}"`), `BOM row for item ${r.item}`);
  }
});

// ── #45 (D) buildBom is a pure, deterministic 1:1 index ─────────────────────
test('#45 (D) buildBom collapses instances → ordered rows with an item index', () => {
  const { rows, itemOf } = buildBom([
    { partNumber: 'X', qty: 2 }, { partNumber: 'Y' }, { partNumber: 'X' },
  ]);
  assert.deepEqual(rows.map((r) => [r.item, r.partNumber, r.qty]), [[1, 'X', 3], [2, 'Y', 1]]);
  assert.equal(itemOf.get('X'), 1);
  assert.equal(itemOf.get('Y'), 2);
});

// ── #45 (E) REGENERATE an ARBITRARY changed part — dims track new geometry ──
test('#45 (E) regenerate(arbitrary part): views/dims/sections all reflow', { skip: !forge }, () => {
  PMI_TEST.reset();
  // First sheet: an arbitrary part (a live handle), WITH a section.
  const p1 = rebuildShape('plate-hole', { dx: 80, dy: 60, dz: 12, holeR: 10 });
  const before = generateDrawing({ shape: p1, bodyId: 'rg' }, {
    sheet: 'A3', pmi: false,
    sections: [{ plane: { origin: [0, 30, 0], normal: [0, 1, 0] }, parentDir: 'top', direction: 'front' }],
    details: [{ sourceDir: 'front', center: [40, -6], radius: 14, scale: 2 }],
  });
  const wBefore = before.dimensions.find((x) => x.label === 'width');
  assert.ok(Math.abs(wBefore.value - 80) < TOL, 'baseline width = 80');
  assert.equal(before.sections.length, 1, 'baseline has a section');
  assert.equal(before.details.length, 1, 'baseline has a detail');

  // Resize to a NON-recipe live handle (a wider plate). regenerate() reuses
  // the recorded composition (section + detail) against the new geometry.
  const p2 = rebuildShape('plate-hole', { dx: 140, dy: 60, dz: 12, holeR: 10 });
  const after = regenerate(before, { shape: p2, bodyId: 'rg' });

  const wAfter = after.dimensions.find((x) => x.label === 'width');
  assert.ok(Math.abs(wAfter.value - 140) < TOL, `regen width = 140 (got ${wAfter.value}) — dims track geometry`);
  assert.equal(wAfter.text, '140.0', 'width text reflowed to 140.0');
  // Height/depth unchanged → proves a re-projection, not a text edit.
  assert.ok(Math.abs(after.dimensions.find((x) => x.label === 'height').value - 60) < TOL, 'height still 60');
  // The recorded section + detail were re-emitted against the new part.
  assert.equal(after.sections.length, 1, 'section reflowed');
  assert.equal(after.details.length, 1, 'detail reflowed');
  // The front silhouette actually widened to 140.
  const fb = after.views.find((v) => v.dir === 'front').bbox;
  assert.ok(Math.abs((fb.maxX - fb.minX) - 140) < TOL, 'front view X-span reflowed to 140');
});

// ── #45 line conventions on the emitted sheet (ASME Y14.2 / ISO 128) ────────
test('#45 sheet line conventions + projection symbol (Y14.2 / ISO 128 / 5456)', { skip: !forge }, () => {
  PMI_TEST.reset();
  const shape = buildPlate();
  const d = generateDrawing({ shape, bodyId: 'lc' }, {
    sheet: 'A3', pmi: false,
    sections: [{ plane: { origin: [0, 30, 0], normal: [0, 1, 0] }, parentDir: 'top' }],
  });
  // ISO 128-20: visible 0.4 mm solid + hidden 0.25 mm dashed are present.
  assert.ok(/stroke-width="0\.4"/.test(d.svg), 'visible lines at 0.4 mm (ISO 128-20)');
  assert.ok(/stroke-dasharray="2 1\.5"/.test(d.svg), 'hidden lines dashed (ISO 128-20)');
  // ISO 128-24: section cut at 0.6 mm + the chain-dash cutting-plane line.
  assert.ok(/stroke-width="0\.6"/.test(d.svg), 'cut/cutting-plane lines at 0.6 mm');
  assert.ok(/stroke-dasharray="6 1\.5 2 1\.5"/.test(d.svg), 'cutting-plane chain-dash line (ISO 128-24)');
  // ISO 5456 / ASME Y14.3: the projection-method symbol is on the sheet.
  assert.ok(d.svg.includes('data-label="projection-symbol"'), 'projection symbol present');
  assert.ok(/data-projection="third-angle"/.test(d.svg), 'declares third-angle projection');
});

// ── #45 bridge verbs: section-view / detail-view / regenerate / bom ─────────
test('#45 bridge: drawing.section-view dispatches with a real hatch report', { skip: !forge }, async () => {
  PMI_TEST.reset();
  const { dispatchToolCall } = await import('../../../ai/ForgeToolBridge.js');
  const shape = buildPlate();
  const res = await dispatchToolCall({
    name: 'drawing.section-view',
    arguments: { shape, origin: [0, 30, 0], normal: [0, 1, 0], direction: 'front', parentDir: 'top', sheet: 'A3' },
  }, { forge });
  assert.equal(res.ok, true, `dispatch ok (${res.error || ''})`);
  assert.equal(res.result.op, 'drawing-section');
  assert.ok(/^[A-Z]$/.test(res.result.sectionLetter), 'a section letter was assigned');
  assert.ok(Array.isArray(res.result.hatch) && res.result.hatch.length >= 1, 'a per-body hatch report');
  assert.equal(res.result.hatch[0].angleDeg, 45, 'single-body hatch at 45°');
  assert.ok(res.result.hatch[0].count >= 1, 'real hatch lines emitted');
  assert.ok(res.result.svgLength > 100, 'an SVG sheet was produced');
});

test('#45 bridge: drawing.detail-view dispatches with a DETAIL label', { skip: !forge }, async () => {
  PMI_TEST.reset();
  const { dispatchToolCall } = await import('../../../ai/ForgeToolBridge.js');
  const shape = buildPlate();
  const res = await dispatchToolCall({
    name: 'drawing.detail-view',
    arguments: { shape, sourceDir: 'front', center: [40, -6], radius: 14, scale: 2, sheet: 'A3' },
  }, { forge });
  assert.equal(res.ok, true, `dispatch ok (${res.error || ''})`);
  assert.equal(res.result.op, 'drawing-detail');
  assert.ok(/^[A-Z]$/.test(res.result.detailLetter), 'a detail letter was assigned');
  assert.ok(/^DETAIL [A-Z] \(2:1\)$/.test(res.result.label), `Y14.3 label (got ${res.result.label})`);
});

test('#45 bridge: drawing.balloon-bom is 1:1 + drawing.regenerate(arbitrary)', { skip: !forge }, async () => {
  PMI_TEST.reset();
  const { dispatchToolCall } = await import('../../../ai/ForgeToolBridge.js');
  const asm = forge.makeBox(120, 120, 20);
  const bom = await dispatchToolCall({
    name: 'drawing.balloon-bom',
    arguments: { shape: asm, assembly: [
      { partNumber: 'A', qty: 2, view: 'top', anchor: [20, 20, 0] },
      { partNumber: 'B', qty: 1, view: 'top', anchor: [80, 80, 0] },
    ], sheet: 'A3' },
  }, { forge });
  assert.equal(bom.ok, true, `bom dispatch ok (${bom.error || ''})`);
  assert.deepEqual(bom.result.itemNumbers, bom.result.balloonNumbers, 'balloon numbers == BOM items (1:1)');

  // Arbitrary-part regenerate via the bridge — a wider live handle reflows.
  const reg = await dispatchToolCall({
    name: 'drawing.regenerate',
    arguments: { shape: forge.makeBox(150, 60, 12), sheet: 'A3', pmi: false,
      sections: [{ plane: { origin: [0, 30, 0], normal: [0, 1, 0] }, parentDir: 'top' }] },
  }, { forge });
  assert.equal(reg.ok, true, `regen dispatch ok (${reg.error || ''})`);
  assert.equal(reg.result.mode, 'arbitrary', 'arbitrary-part regenerate mode');
  assert.equal(reg.result.sections, 1, 'section re-emitted on regen');
  const w = reg.result.dimValues.find((x) => x.label === 'width');
  assert.ok(w && Math.abs(w.value - 150) < TOL, `regen width = 150 (got ${w?.value})`);
});
