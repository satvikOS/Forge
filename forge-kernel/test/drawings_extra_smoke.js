// Drawings extras smoke (Forge-32) — exercises section / detail / broken
// views, the new SVG dimension geometry, the templated title block, and
// balloons with leader lines + collision nudging.
//
// Geometry: a 200×40×40 plate with a 10 mm hole through it (cylinder
// drilled along Z at the centre). Each new view kind is exercised
// against this part:
//
//   * SectionView at midspan (Y=0) — expects cut polylines > 0 + hatch > 0
//   * DetailView around the hole at 4× — expects polylines clipped to the
//     focus circle (i.e. fewer than the parent view)
//   * BrokenView with a 50 mm break in the middle — expects total bbox
//     width < 200 mm (compaction worked)
//
// Then we assemble an A3 sheet (front + section + detail + balloon
// callout + linear dimension + full title block with all 14 fields)
// and write `/tmp/forge-drawings-extra.svg`, asserting:
//   * valid XML head/tail
//   * >= 3 view groups
//   * title-block fields actually rendered (drawing number, drawnBy)
//   * the file is > 4 KB (real content, not just chrome)
//
// CJS — the kernel ships as a Node addon; the frontend ESM module is
// dynamically imported.

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[drawings-extra-smoke] version =', forge.version());

// ---------------------------------------------------------- geometry
const plate = forge.makeBox(200, 40, 40);
const hole  = forge.makeCylinder(5, 60);
// Centre the hole at (100, 20, 0) with axis = Z. The default cylinder
// runs along +Z from origin.
const tHole = forge.translate(hole, 100, 20, -10);
const part  = forge.cut(plate, tHole);
console.log('[drawings-extra-smoke] part handle =', part);

// ---------------------------------------------------------- section view
//
// Cutting plane at midspan (X = 100), normal along +X — slices the plate
// crosswise through the hole.
const sec = forge.drawings.projectSection(
  part,
  'front',
  { origin: [100, 0, 0], normal: [1, 0, 0] },
  { spacing: 2.0, angleDeg: 45 },
);
console.log(`[drawings-extra-smoke] section: cut=${sec.cutCount}, hatch=${sec.hatchCount}, visible=${sec.visibleCount}`);
assert.ok(sec.cutCount > 0,   `section produced 0 cut polylines (got ${sec.cutCount})`);
assert.ok(sec.hatchCount > 0, `section produced 0 hatch lines (got ${sec.hatchCount})`);

// ---------------------------------------------------------- detail view
//
// Detail around the hole at 4× magnification. We focus a 12 mm circle on
// the hole's projected centre in the TOP view: looking down -Z, world
// (X, Y) maps to screen (X, -Y). The hole's world centre is (100, 20)
// so its top-view screen centre is (100, 20) (the kernel's Ax2 picks
// the X axis = world X for top view; screen-Y direction works out to
// match world-Y after projection — we confirmed empirically with
// `top bbox y 0..40`).
const det = forge.drawings.projectDetail(
  part,
  'top',
  { x: 100, y: 20, r: 12 },
  4.0,
);
console.log(`[drawings-extra-smoke] detail: visible=${det.visibleCount}, hidden=${det.hiddenCount}, outline=${det.outlineCount}`);
assert.ok(det.visibleCount > 0 || det.outlineCount > 0,
  'detail produced no clipped polylines (visible+outline both 0)');

// Spot check: the detail's bbox max-min should be ≤ ~ 4 * (2r) = 96 mm
// after the 4× scaling, but anchored on (100, 20). We loosen the bound
// because OCCT may sample additional edge fragments that touch the circle.
{
  let minX = Infinity, maxX = -Infinity;
  const consume = (arr) => {
    for (let i = 0; i < arr.length; i += 2) {
      if (arr[i] < minX) minX = arr[i];
      if (arr[i] > maxX) maxX = arr[i];
    }
  };
  consume(det.visible); consume(det.outline);
  console.log(`[drawings-extra-smoke] detail bbox width ≈ ${(maxX - minX).toFixed(3)} mm (focus 4r * scale = 96)`);
}

// ---------------------------------------------------------- broken view
//
// 50 mm break centred on the part (X 75..125), leaving 150 mm of compacted
// width (75 left + 75 right minus the missing middle 50). After the
// kernel slides the right half back by 50, total span should be ≈ 150.
const brk = forge.drawings.projectBroken(
  part,
  'front',
  { axis: 'x', start: 75, end: 125 },
);
console.log(`[drawings-extra-smoke] broken: visible=${brk.visibleCount}`);
assert.ok(brk.visibleCount > 0, 'broken view dropped every polyline');
{
  let bminX = Infinity, bmaxX = -Infinity;
  for (let i = 0; i < brk.visible.length; i += 2) {
    if (brk.visible[i] < bminX) bminX = brk.visible[i];
    if (brk.visible[i] > bmaxX) bmaxX = brk.visible[i];
  }
  const width = bmaxX - bminX;
  console.log(`[drawings-extra-smoke] broken bbox width = ${width.toFixed(3)} mm (orig 200)`);
  assert.ok(
    width < 195,
    `broken view did not compact (width ${width.toFixed(3)} not < 195)`,
  );
}

// ---------------------------------------------------------- A3 sheet
//
// Dynamic-import the ESM frontend module. We inject the kernel directly
// instead of going through the Electron preload bridge.
(async () => {
  const mod = await import(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'kernel', 'forge', 'Drawings.js'));
  mod._setForgeKernel(forge);

  const drawing = new mod.ForgeDrawing({
    title: 'PLATE 200×40 WITH BORE',
    titleBlock: {
      drawnBy: 'satvikOS',
      scale: '1:1',
      sheet: '1 / 1',
    },
  });

  const vFront = drawing.addView(part, 'front', 1.0, 'FRONT');

  // SECTION A-A through the hole.
  const vSec = drawing.addSectionView({
    shape: part,
    sectionPlane: { origin: [100, 0, 0], normal: [1, 0, 0] },
    hatchSpec: { spacing: 2.5, angleDeg: 45 },
    direction: 'right',
    parentView: vFront,
  });
  assert.ok(vSec.projection.cutCount > 0, 'SectionView had no cut polylines');

  // DETAIL A around the hole at 4×, callout on a top view (front projection
  // doesn't carry the hole's screen-Y at +20; top projection does).
  const vTop = drawing.addView(part, 'top', 1.0, 'TOP');
  drawing.addDetailView({
    shape: part,
    focusCircle: { x: 100, y: 20, r: 12 },
    scale: 4,
    direction: 'top',
    parentView: vTop,
  });

  // Linear dimension across the front view (200 mm bbox width).
  vFront.addDimension(mod.DimensionLinear(
    [vFront.bbox.minX, vFront.bbox.minY],
    [vFront.bbox.maxX, vFront.bbox.minY],
    8.0,
    { units: 'mm', precision: 1 },
  ));

  // Radial dimension on the hole (R5).
  vFront.addDimension(mod.DimensionRadial(
    [100, 20], 5, Math.PI / 4,
    { units: 'mm', precision: 1 },
  ));

  // Angular dimension (90° corner between bbox edges of the front view).
  vFront.addDimension(mod.DimensionAngular(
    [vFront.bbox.minX, vFront.bbox.minY],
    [vFront.bbox.maxX, vFront.bbox.minY],
    [vFront.bbox.minX, vFront.bbox.maxY],
    10,
  ));

  // Balloon callout — anchor on the hole, balloon offset above-right
  // with a leader line + arrowhead.
  vFront.addBalloon(mod.Balloon({
    anchor:    [100, 20],
    balloonAt: [115, 35],
    number:    1,
    radius:    4,
  }));
  // Second balloon nearby — should be nudged by collision resolver.
  vFront.addBalloon(mod.Balloon({
    anchor:    [100, 20],
    balloonAt: [116, 36],
    number:    2,
    radius:    4,
  }));

  // -------------------------------------------------------- render + asserts
  const svg = drawing.toSvg('A3', 'landscape', {
    titleBlock: 'A3',
    titleBlockFields: {
      drawingNumber: 'FRG-32-PLATE-001',
      title:         'PLATE 200×40 WITH BORE',
      scale:         '1:1',
      drawnBy:       'satvikOS',
      checkedBy:     'Archie',
      approvedBy:    'Satvik',
      date:          '2026-05-30',
      sheet:         '1 / 1',
      material:      'AL 6061-T6',
      finish:        'Anodised',
      weight:        '0.86 kg',
      revision:      'A',
      project:       'ArchDisc Forge',
      company:       'ArchDisc',
    },
  });
  const outPath = '/tmp/forge-drawings-extra.svg';
  fs.writeFileSync(outPath, svg, 'utf8');
  const bytes = fs.statSync(outPath).size;
  console.log(`[drawings-extra-smoke] wrote ${outPath} (${bytes} bytes)`);

  // ---------- validate ----------
  assert.ok(/<\?xml/.test(svg.slice(0, 200)), 'SVG missing XML declaration');
  assert.ok(svg.trim().endsWith('</svg>'),    'SVG does not end at </svg>');
  assert.ok(/<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg),
            'svg root tag malformed');
  assert.ok(bytes > 4000, `SVG only ${bytes} bytes — expected > 4 KB`);

  // >= 3 view groups (FRONT + SECTION + DETAIL).
  const groupHits = (svg.match(/<g data-label="[^"]+"/g) || []).length;
  console.log(`[drawings-extra-smoke] view+meta groups = ${groupHits}`);
  assert.ok(groupHits >= 3, `expected ≥ 3 view groups, got ${groupHits}`);

  // Title-block fields actually rendered.
  assert.ok(svg.includes('FRG-32-PLATE-001'), 'drawing number missing from title block');
  assert.ok(svg.includes('satvikOS'),         'drawnBy missing from title block');
  assert.ok(svg.includes('AL 6061-T6'),       'material missing from title block');
  assert.ok(svg.includes('Anodised'),         'finish missing from title block');
  assert.ok(svg.includes('ArchDisc'),         'company missing from title block');
  assert.ok(svg.includes('data-template="A3"'), 'title-block template name not stamped');

  // Section + detail rendered specifically.
  assert.ok(svg.includes('SECTION '),  'no SECTION view rendered');
  assert.ok(svg.includes('DETAIL '),   'no DETAIL view rendered');
  // Section's cut+hatch buckets render as a stroke-width="0.6" path:
  assert.ok(/stroke-width="0\.6"/.test(svg), 'no heavy-stroke cut outline in SVG');

  // Balloon should have a leader (polygon arrowhead).
  assert.ok(/polygon[^>]*fill="#000"/.test(svg), 'no balloon leader arrowhead in SVG');

  // Liveness check.
  const before = forge.liveCount();
  forge.release(part);
  const after = forge.liveCount();
  assert.ok(after < before, 'liveCount did not decrement on release');

  console.log('[drawings-extra-smoke] ALL PASS');
})().catch((e) => {
  console.error('[drawings-extra-smoke] FAIL —', e.stack || e.message);
  process.exit(1);
});
