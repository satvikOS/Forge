// Forge-204 — standard parts smoke.

const kernel = require('../build/Release/forge-kernel.node');
const sp = kernel.stdparts;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// (1) M8 bolt with 30 mm length: head ≈ 13 mm AF, head height 5.2 mm.
const b8 = sp.specForMetricBolt(8, 30);
ck(b8.diameter === 8, `b8 diameter ${b8.diameter}`);
ck(b8.length === 30, `b8 length ${b8.length}`);
ck(Math.abs(b8.headWidth - 13.0) < 0.01, `b8 headWidth ${b8.headWidth}`);
ck(Math.abs(b8.headHeight - 5.2) < 0.01, `b8 headHeight ${b8.headHeight}`);

const boltMesh = sp.makeBolt(b8, 24);
ck(boltMesh.positions.length / 3 > 0, `bolt has positions`);
ck(boltMesh.indices.length > 0 && boltMesh.indices.length % 3 === 0, `bolt indices`);

// (2) M8 nut: AF 13, height 6.8.
const n8 = sp.specForMetricNut(8);
ck(Math.abs(n8.width - 13.0) < 0.01, `n8 width ${n8.width}`);
ck(Math.abs(n8.height - 6.8) < 0.01, `n8 height ${n8.height}`);
const nutMesh = sp.makeNut(n8, 24);
ck(nutMesh.indices.length > 0, `nut has triangles`);

// (3) Washer 8.5/16/1.6 mm
const w = sp.makeWasher({ innerDiameter: 8.5, outerDiameter: 16, thickness: 1.6 }, 24);
ck(w.indices.length / 3 === 24 * 8, `washer tri count ${w.indices.length/3} (expected ${24*8})`);

// (4) Bearing 6004: id 20, od 42, w 12
const bg = sp.makeBearing({ innerDiameter: 20, outerDiameter: 42, width: 12 }, 24);
// 2 races × (24 segs × 8 tris) = 384 tris
ck(bg.indices.length / 3 === 24 * 8 * 2, `bearing tri count ${bg.indices.length/3}`);

// (5) Spur gear m=1, z=20, face width 5
const g = sp.makeSpurGear({ module: 1.0, teeth: 20, faceWidth: 5, pressureAngle: 0.349 }, 12);
ck(g.indices.length / 3 > 0, `gear has tris`);
// 20 teeth × 4 verts per tooth = 80 ring verts × 2 levels = 160 + 2 centres = 162
ck(g.positions.length / 3 === 162, `gear vert count ${g.positions.length/3}`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-204 stdparts smoke: OK');
console.log(`  M8×30 bolt: ${boltMesh.positions.length/3} verts, ${boltMesh.indices.length/3} tris`);
console.log(`  M8 nut:     ${nutMesh.positions.length/3} verts, ${nutMesh.indices.length/3} tris`);
console.log(`  washer:     ${w.positions.length/3} verts, ${w.indices.length/3} tris`);
console.log(`  bearing:    ${bg.positions.length/3} verts, ${bg.indices.length/3} tris`);
console.log(`  spur gear z=20 m=1: ${g.positions.length/3} verts, ${g.indices.length/3} tris`);
