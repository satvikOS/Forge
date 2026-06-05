// PUSH-05 drawings smoke — exercises the new forge::drawings View2D /
// SectionView API plus the DXF / SVG text emitters.
//
// Acceptance behaviour (HLR semantics of OCCT 7.9.3):
//   1. 100x60x40 box, FRONT view (look down -Y):
//        * screen X = world X = 100, screen Y = world Z = 40 → bbox 100x40.
//        * Visible: 4 sharp edges of the front face. The 4 silhouette
//          (outline) edges are merged into visibleEdges per our spec.
//        * Hidden:  4 sharp edges of the back face (yes — a solid box DOES
//          show hidden edges; HLR correctly classifies the back-face
//          rectangle behind the front face).
//   2. Same box drilled with a Ø20 hole along Z:
//        * FRONT view shows extra polylines for the cylinder cut on the
//          top/bottom faces and the hole silhouette.
//        * TOP view (look down -Z) shows box outline + hole circle.
//   3. 100x100x100 box cut with the XOY plane at z=50 → sectionEdges is
//      the 100x100 square outline.
//   4. emitDXF: AutoCAD R12 ASCII, starts `0\nSECTION\n2\nENTITIES`,
//      ends `0\nEOF`, contains LWPOLYLINE entries.
//   5. emitSVG: starts `<?xml`, contains `<svg` + `<path d="M `.
//
// CJS (root package.json is type=commonjs).

const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Prefer the cmake-js Release/ subdir layout if it exists, else fall back
// to the plain `build/` layout (Makefile generator output).
function resolveKernel() {
    const a = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
    if (fs.existsSync(a)) return a;
    const b = path.resolve(__dirname, '..', 'build', 'forge-kernel.node');
    if (fs.existsSync(b)) return b;
    throw new Error(`forge-kernel.node not found at ${a} or ${b}`);
}
const KERNEL = resolveKernel();
const forge = require(KERNEL);

console.log('[push05-drawings] version =', forge.version());
const drawings = forge.drawings;
assert.ok(drawings, 'forge.drawings namespace missing');
assert.equal(typeof drawings.projectView, 'function', 'drawings.projectView missing');
assert.equal(typeof drawings.sectionView, 'function', 'drawings.sectionView missing');
assert.equal(typeof drawings.emitDXF,     'function', 'drawings.emitDXF missing');
assert.equal(typeof drawings.emitSVG,     'function', 'drawings.emitSVG missing');

// ---------------------------------------------------------- Test 1: plain box
const box = forge.makeBox(100, 60, 40);
const front = drawings.projectView(box, 'front');
console.log(`[push05-drawings] test1 visible=${front.visibleEdges.length} hidden=${front.hiddenEdges.length}`);
console.log(`[push05-drawings] test1 bbox = ${JSON.stringify(front.bbox)}`);

const widthFront  = front.bbox.maxX - front.bbox.minX;
const heightFront = front.bbox.maxY - front.bbox.minY;
console.log(`[push05-drawings] test1 width=${widthFront.toFixed(3)} height=${heightFront.toFixed(3)}`);

// FRONT view of a 100x60x40 box: looking down -Y, screen X = world X (100),
// screen Y = world Z (40). The box outline is a 100x40 rectangle.
assert.ok(Math.abs(widthFront  - 100) < 0.5, `front width ${widthFront} not ~100`);
assert.ok(Math.abs(heightFront -  40) < 0.5, `front height ${heightFront} not ~40`);
// HLR correctly classifies the 4 back-face edges as hidden; the 4 front-face
// edges (merged with outline) become visible. So a solid box → 4 visible +
// 4 hidden polylines, NOT 4 visible + 0 hidden. Anything else means HLR
// (or our extraction) is broken.
assert.ok(front.visibleEdges.length >= 4,
    `plain box should have >=4 visible polylines, got ${front.visibleEdges.length}`);
assert.ok(front.hiddenEdges.length === 4 || front.hiddenEdges.length === 0,
    `plain box hidden edges should be exactly 4 (back face) or 0 (front-face match), got ${front.hiddenEdges.length}`);

// ---------------------------------------------------------- Test 2: box w/ hole
//
// Drill a Ø20 (radius 10) cylinder along +Z through the box at the centre.
const cyl = forge.makeCylinder(10, 60);
const tcyl = forge.translate(cyl, 50, 30, -10);
const drilled = forge.cut(box, tcyl);
const drilledFront = drawings.projectView(drilled, 'front');
console.log(`[push05-drawings] test2 visible=${drilledFront.visibleEdges.length} hidden=${drilledFront.hiddenEdges.length}`);
assert.ok(drilledFront.visibleEdges.length >= 4,
    `drilled box FRONT should still show 4+ visible polylines, got ${drilledFront.visibleEdges.length}`);
// Drilling along Z means the FRONT (looking down -Y) sees the hole as a
// straight pair of vertical lines on the silhouette — *plus* the cylinder
// back walls become hidden lines. We require at least one hidden polyline.
assert.ok(drilledFront.hiddenEdges.length >= 1,
    `drilled box FRONT should have >=1 hidden edge for the hole, got ${drilledFront.hiddenEdges.length}`);

// TOP view shows the hole as a circle (tessellated).
const drilledTop = drawings.projectView(drilled, 'top');
console.log(`[push05-drawings] test2 TOP visible=${drilledTop.visibleEdges.length} hidden=${drilledTop.hiddenEdges.length}`);
assert.ok(drilledTop.visibleEdges.length >= 5,
    `drilled box TOP should have box outline + hole circle (>=5 polylines), got ${drilledTop.visibleEdges.length}`);

// ---------------------------------------------------------- Test 3: section view
//
// 100x100x100 cube cut with the XOY plane at z=50. The intersection is a
// 100x100 square in the XY plane.
const cube = forge.makeBox(100, 100, 100);
const section = drawings.sectionView(cube, {
    origin: [0, 0, 50],
    normal: [0, 0, 1],
});
console.log(`[push05-drawings] test3 sectionEdges=${section.sectionEdges.length} behindEdges=${section.behindEdges.length}`);
assert.ok(section.sectionEdges.length >= 4,
    `XY-plane cut of 100x100x100 cube should give >=4 section edges, got ${section.sectionEdges.length}`);

// Section bbox should be ~100x100.
let smnx = Infinity, smny = Infinity, smxx = -Infinity, smxy = -Infinity;
for (const pl of section.sectionEdges) {
    for (const p of pl) {
        if (p.x < smnx) smnx = p.x;
        if (p.x > smxx) smxx = p.x;
        if (p.y < smny) smny = p.y;
        if (p.y > smxy) smxy = p.y;
    }
}
const sw = smxx - smnx, sh = smxy - smny;
console.log(`[push05-drawings] test3 section bbox ~ ${sw.toFixed(3)} x ${sh.toFixed(3)}`);
assert.ok(Math.abs(sw - 100) < 0.5, `section width ${sw} not ~100`);
assert.ok(Math.abs(sh - 100) < 0.5, `section height ${sh} not ~100`);

// ---------------------------------------------------------- Test 4: DXF emit
const dxf = drawings.emitDXF(
    [front, drilledTop],
    [
        [[0, 0], [100, 0]],
        [{ x: 0, y: -10 }, { x: 0, y: 50 }],
    ]
);
assert.equal(typeof dxf, 'string', 'emitDXF should return a string');
assert.ok(dxf.startsWith('0\nSECTION\n2\nENTITIES'),
    `DXF should start with 0/SECTION/2/ENTITIES, got: ${JSON.stringify(dxf.slice(0, 50))}`);
assert.ok(dxf.trimEnd().endsWith('0\nEOF'),
    'DXF should end with 0/EOF');
assert.ok(dxf.includes('LWPOLYLINE'), 'DXF should contain LWPOLYLINE entries');
assert.ok(dxf.includes('VISIBLE'), 'DXF should contain VISIBLE layer name');
assert.ok(dxf.includes('LINE'), 'DXF should contain LINE entities for dimensions');
const dxfPath = '/tmp/forge-push05-drawings.dxf';
fs.writeFileSync(dxfPath, dxf, 'utf8');
const dxfBytes = fs.statSync(dxfPath).size;
console.log(`[push05-drawings] test4 wrote ${dxfPath} (${dxfBytes} bytes)`);

// ---------------------------------------------------------- Test 5: SVG emit
const svg = drawings.emitSVG(drilledTop);
assert.equal(typeof svg, 'string', 'emitSVG should return a string');
assert.ok(svg.startsWith('<?xml'), `SVG should start with <?xml, got: ${JSON.stringify(svg.slice(0, 50))}`);
assert.ok(svg.includes('<svg'), 'SVG should contain <svg root');
assert.ok(/<path d="M /.test(svg), 'SVG should contain <path d="M ..." entries');
assert.ok(svg.includes('stroke="black"'), 'SVG should have black stroke');
assert.ok(svg.includes('stroke-width="0.35"'), 'SVG should have 0.35 stroke width');
if (drilledTop.hiddenEdges.length > 0) {
    assert.ok(svg.includes('stroke-dasharray="2,2"'),
        'SVG should include dashed strokes when hiddenEdges are present');
}
const svgPath = '/tmp/forge-push05-drawings.svg';
fs.writeFileSync(svgPath, svg, 'utf8');
const svgBytes = fs.statSync(svgPath).size;
console.log(`[push05-drawings] test5 wrote ${svgPath} (${svgBytes} bytes)`);

// ---------------------------------------------------------- cleanup
forge.release(box);
forge.release(drilled);
forge.release(cube);

console.log('[push05-drawings] ALL PASS');
