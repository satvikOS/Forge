// Drawings smoke (Forge-10) — exercises the HLR projection plus the
// JS ForgeDrawing / SVG-export layer.
//
// Setup: 50×30×20 box with a 10-radius cylinder cut off-centre.
// We project front / top / right views, assert the front view has between
// 4 and 12 distinct polylines, then build a ForgeDrawing on A3 landscape
// with a 50-mm Linear dimension and write `/tmp/forge-drawing-smoke.svg`.
//
// This test is CJS (the root package.json is type=commonjs) but the
// frontend ForgeDrawing module is ESM, so we use dynamic import.

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[drawings-smoke] version =', forge.version());

// ---------------------------------------------------------- geometry
const box = forge.makeBox(50, 30, 20);
const cyl = forge.makeCylinder(10, 30);
// Off-centre the cylinder so the cut leaves a definite hole signature.
const tcyl = forge.translate(cyl, 15, 12, -5);
const part = forge.cut(box, tcyl);
console.log('[drawings-smoke] part handle =', part);

// ---------------------------------------------------------- projection
const front = forge.drawings.projectShape(part, 'front');
const top   = forge.drawings.projectShape(part, 'top');
const right = forge.drawings.projectShape(part, 'right');

console.log(`[drawings-smoke] front: visible=${front.visibleCount}, hidden=${front.hiddenCount}, outline=${front.outlineCount}`);
console.log(`[drawings-smoke] top:   visible=${top.visibleCount},   hidden=${top.hiddenCount},   outline=${top.outlineCount}`);
console.log(`[drawings-smoke] right: visible=${right.visibleCount}, hidden=${right.hiddenCount}, outline=${right.outlineCount}`);

assert.ok(front.visibleCount > 0, 'front view produced 0 visible polylines');
assert.ok(top.visibleCount   > 0, 'top view produced 0 visible polylines');
assert.ok(right.visibleCount > 0, 'right view produced 0 visible polylines');

assert.ok(
  front.visibleCount >= 4 && front.visibleCount <= 12,
  `front visible polyline count ${front.visibleCount} out of expected [4, 12]`,
);

// Spot-check that the front view's bbox width is ≈50 (box.dx).
let minX = Infinity, maxX = -Infinity;
for (let i = 0; i < front.visible.length; i += 2) {
  if (front.visible[i] < minX) minX = front.visible[i];
  if (front.visible[i] > maxX) maxX = front.visible[i];
}
const widthMm = maxX - minX;
console.log(`[drawings-smoke] front bbox width ≈ ${widthMm.toFixed(3)} mm`);
assert.ok(
  Math.abs(widthMm - 50) < 0.5,
  `front bbox width ${widthMm} not ≈ 50 mm`,
);

// ---------------------------------------------------------- SVG export
//
// Dynamic import because the frontend module is ESM.
(async () => {
  const mod = await import(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'kernel', 'forge', 'Drawings.js'));
  // The frontend `getForge()` reads `window.forge`; in Node we inject
  // the kernel directly.
  mod._setForgeKernel(forge);

  const drawing = new mod.ForgeDrawing({
    title: 'Forge-10 Smoke',
    titleBlock: { drawnBy: 'satvikOS', scale: '1:1' },
  });
  const vFront = drawing.addView(part, 'front', 1.0, 'FRONT');
  drawing.addView(part, 'top',   1.0, 'TOP');
  drawing.addView(part, 'right', 1.0, 'RIGHT');

  // Linear dimension across the 50 mm front-view width. We use the
  // front bbox endpoints (model-space, view-local coords).
  vFront.addDimension(mod.DimensionLinear(
    [vFront.bbox.minX, vFront.bbox.minY],
    [vFront.bbox.maxX, vFront.bbox.minY],
    8.0,   // 8 mm offset below the geometry
  ));

  const svg = drawing.toSvg('A3', 'landscape');
  const outPath = '/tmp/forge-drawing-smoke.svg';
  fs.writeFileSync(outPath, svg, 'utf8');
  const bytes = fs.statSync(outPath).size;
  console.log(`[drawings-smoke] wrote ${outPath} (${bytes} bytes)`);

  assert.ok(fs.existsSync(outPath), 'SVG file missing');
  assert.ok(bytes > 1000, `SVG only ${bytes} bytes — too small`);

  // Lightweight validity check: well-formed XML opener + closer + paths.
  const head = svg.slice(0, 200);
  assert.ok(/<\?xml/.test(head), 'SVG missing XML declaration');
  assert.ok(/<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg), 'svg root tag malformed');
  assert.ok(svg.trim().endsWith('</svg>'), 'svg does not close cleanly');
  assert.ok(/<path /.test(svg), 'no <path> elements in SVG');

  // The Linear dimension text should appear.
  assert.ok(svg.includes('>50.00<') || svg.includes('>50.0<') || / 50\.00 /.test(svg),
    'linear dimension text "50.00" not present in SVG');

  // Bracket: ensure we have all three view groups.
  const groupHits = (svg.match(/data-label="FRONT"|data-label="TOP"|data-label="RIGHT"/g) || []).length;
  assert.ok(groupHits >= 3, `expected 3 view groups, got ${groupHits}`);

  // Liveness restoration check — release temporaries and confirm count drops.
  const before = forge.liveCount();
  forge.release(part);
  const after = forge.liveCount();
  assert.ok(after < before, 'liveCount did not decrement on release');

  console.log('[drawings-smoke] ALL PASS');
})().catch((e) => {
  console.error('[drawings-smoke] FAIL —', e.stack || e.message);
  process.exit(1);
});
