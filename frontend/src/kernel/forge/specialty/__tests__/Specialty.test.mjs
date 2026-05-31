import assert from 'node:assert/strict';
import { Route, RoutePoint, RouteKind } from '../Routing.js';
import { Schematic, SchematicSymbol } from '../ElectricalSchematic.js';
import { MoldLayout, EjectorPin, Runner, Gate, GateKind } from '../MoldDesign.js';
import { FCF, Datum, AnnotationSet, FCFKind } from '../MBDAnnotation.js';

// ---- Routing: bend-radius enforcement ------------------------------
{
  const r = new Route({ kind: RouteKind.Pipe, diameter: 20, minBendRadius: 50 });
  r.addPoint({ position: [0,  0,  0] });
  r.addPoint({ position: [40, 0,  0] });
  r.addPoint({ position: [40, 30, 0] }); // 25 mm circumradius — below 50
  const vio = r.checkBendRadius();
  assert.equal(vio.length, 1, 'sharp 90° bend should violate min-bend-radius');
  assert.ok(vio[0].actualRadius < 50);
  assert.ok(r.length() > 60);

  // And a slack bend that should NOT violate.
  const r2 = new Route({ kind: RouteKind.Pipe, diameter: 20, minBendRadius: 50 });
  r2.addPoint({ position: [0,   0, 0] });
  r2.addPoint({ position: [100, 0, 0] });
  r2.addPoint({ position: [110, 0, 0.1] });   // very shallow kink → big radius
  assert.equal(r2.checkBendRadius().length, 0);
}

// ---- Electrical: connectivity + netlist + SPICE -------------------
{
  const sch = new Schematic({ name: 'RC' });
  const r = sch.addSymbol({ kind: 'resistor',  label: 'R1', value: '1k',
                             pins: [[-5,0],[5,0]] });
  const c = sch.addSymbol({ kind: 'capacitor', label: 'C1', value: '10uF',
                             pins: [[-5,0],[5,0]] });
  const v = sch.addSymbol({ kind: 'vsource',   label: 'V1', value: '5V',
                             pins: [[0,5],[0,-5]] });
  const g = sch.addSymbol({ kind: 'gnd',                                    pins: [[0,0]] });

  // Wire R1.pin1 → V1.+, R1.pin2 → C1.pin1, C1.pin2 → gnd, V1.− → gnd.
  sch.connect(r.pins[0].pinId, v.pins[0].pinId);
  sch.connect(r.pins[1].pinId, c.pins[0].pinId);
  sch.connect(c.pins[1].pinId, g.pins[0].pinId);
  sch.connect(v.pins[1].pinId, g.pins[0].pinId);

  const nets = sch.netlist();
  assert.equal(nets.length, 3, '3 distinct nets (R-V, R-C, gnd)');
  const spice = sch.toSpice();
  assert.match(spice, /^\* RC/);
  assert.match(spice, /R1 .* 1k/);
  assert.match(spice, /V1 .* 5V/);
  assert.match(spice, /\.end\s*$/);
}

// ---- Mold: ejector + runner volume + gate suggestion --------------
{
  const m = new MoldLayout({ partName: 'Bezel' });
  m.addEjector({ position: [10, 10, 0], diameter: 3, length: 30 });
  m.addRunner({ diameter: 5, path: [[0,0,0],[50,0,0],[50,50,0]] });
  const v = m.runnerVolume();
  // π·2.5²·100 ≈ 1963 mm³.
  assert.ok(v > 1900 && v < 2050, `runner volume ≈ 1963, got ${v.toFixed(1)}`);

  assert.equal(MoldLayout.suggestGate({ partThickness: 1 }),       GateKind.Fan);
  assert.equal(MoldLayout.suggestGate({ isCosmetic: true }),       GateKind.Tunnel);
  assert.equal(MoldLayout.suggestGate({ cavityCount: 4 }),         GateKind.Submarine);
  assert.equal(MoldLayout.suggestGate({}),                         GateKind.Edge);
}

// ---- MBD: FCF formatting + datums + set ---------------------------
{
  const fcf = new FCF({
    shapeId: 1, topoId: 5,
    control: FCFKind.Perpendicularity, tolerance: 0.05,
    datums: ['A'], modifiers: ['M'],
    leader: [10, 0, 0], position: [12, 0, 0],
  });
  assert.match(fcf.text, /^\[⊥\|0\.050M\|A\]$/);

  const dat = new Datum({ name: 'B', shapeId: 1, topoId: 9 });
  assert.equal(dat.text, '[B]');

  const set = new AnnotationSet();
  set.add(fcf); set.add(dat);
  assert.equal(set.byShape(1).length, 2);
}

console.log('[forge.specialty] all tests passed');
