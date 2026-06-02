// Forge-207 — DXF round-trip smoke.

const kernel = require('../build/Release/forge-kernel.node');
const dxf = kernel.dxf;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// (1) Round-trip a hand-crafted DXF with all four entity types.
const original = {
  entities: [
    { type: 'line', layer: 'TRIM', x0: 0, y0: 0, x1: 10, y1: 5,
      vertices: new Float64Array(), closed: false, radius: 0,
      startAngleDeg: 0, endAngleDeg: 0 },
    { type: 'circle', layer: '0', x0: 5, y0: 5, radius: 2.5,
      x1: 0, y1: 0, vertices: new Float64Array(),
      closed: false, startAngleDeg: 0, endAngleDeg: 0 },
    { type: 'arc', layer: 'GRID', x0: 0, y0: 0, radius: 4,
      startAngleDeg: 0, endAngleDeg: 90, x1: 0, y1: 0,
      vertices: new Float64Array(), closed: false },
    { type: 'lwpolyline', layer: 'PATH',
      vertices: new Float64Array([0, 0,  10, 0,  10, 10,  0, 10]),
      closed: true,
      x0: 0, y0: 0, x1: 0, y1: 0,
      radius: 0, startAngleDeg: 0, endAngleDeg: 0 },
  ],
};

const text = dxf.write(original);
ck(text.includes('LINE'),       'output mentions LINE');
ck(text.includes('CIRCLE'),     'output mentions CIRCLE');
ck(text.includes('ARC'),        'output mentions ARC');
ck(text.includes('LWPOLYLINE'), 'output mentions LWPOLYLINE');
ck(text.includes('TRIM') && text.includes('GRID') && text.includes('PATH'),
   'output preserves layer names');

const parsed = dxf.parse(text);
ck(parsed.entities.length === 4, `parsed entity count ${parsed.entities.length}`);
ck(parsed.entities[0].type === 'line',  'first is line');
ck(parsed.entities[0].layer === 'TRIM', 'first layer TRIM');
ck(Math.abs(parsed.entities[0].x1 - 10) < 1e-9, 'line x1');
ck(parsed.entities[1].type === 'circle', 'second is circle');
ck(Math.abs(parsed.entities[1].radius - 2.5) < 1e-9, 'circle radius');
ck(parsed.entities[2].type === 'arc',    'third is arc');
ck(Math.abs(parsed.entities[2].endAngleDeg - 90) < 1e-9, 'arc end angle');
ck(parsed.entities[3].type === 'lwpolyline', 'fourth is lwpolyline');
ck(parsed.entities[3].closed === true, 'lwpolyline closed flag');
ck(parsed.entities[3].vertices.length === 8, `lwpolyline vert count ${parsed.entities[3].vertices.length}`);

// (2) Tolerate a DXF without ENTITIES section header (no entities).
const empty = dxf.parse('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n');
ck(empty.entities.length === 0, `empty doc parsed`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-207 DXF smoke: OK');
console.log(`  wrote ${text.length} chars across ${original.entities.length} entities`);
console.log(`  round-trip parse: ${parsed.entities.length} entities back`);
