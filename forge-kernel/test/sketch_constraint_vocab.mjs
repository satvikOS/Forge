#!/usr/bin/env node
// test/sketch_constraint_vocab.mjs — KNOWN-ANSWER gate for the constraint
// vocabulary the IR sketch layer needs (docs/UNIFIED_IR.md §C).
//
// Every case drives the C++ facade and then reads the geometry BACK OUT of the
// solver (forge.sketcher.readEntity) to check the constraint actually moved the
// geometry to the stated value. Asserting on the INPUT would pass even if the
// dispatch were a no-op, which is the failure mode this file exists to catch.
//
//   node test/sketch_constraint_vocab.mjs
//
// Covers, in order:
//   * Radius / Diameter on circles AND arcs      (were absent from the facade)
//   * Equal on arc pairs and mixed circle/arc    (previously THREW)
//   * Tangent line-arc                           (previously threw "not a Circle")
//   * PointOnObject -> line / circle / arc       (arc was unreachable)
//   * Angle: line-to-line, and an arc's swept angle
//   * the two refusals that must stay LOUD

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  '/Users/account_clawteam1/archdisc-Mech/forge-kernel/build/Release/forge-kernel.node';
const f = require(KERNEL);
const S = f.sketcher, K = S.kinds;

let pass = 0, fail = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
}
const DEG = Math.PI / 180;

// helper: a fresh sketch with an arc of radius r centred at (cx,cy)
function arcOn(sk, cx, cy, r, a0, a1) {
  const c = S.addPoint(sk, cx, cy);
  const s = S.addPoint(sk, cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  const e = S.addPoint(sk, cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  return { eid: S.addArc(sk, c, s, e), c, s, e };
}

// ---------------------------------------------------- Radius / Diameter
{
  const sk = S.createSketch();
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 10);
  S.addConstraint(sk, K.Diameter, [c], 50);
  S.solve(sk);
  check('Diameter on a circle drives radius to value/2',
        near(S.readEntity(sk, c).r, 25, 1e-5), `r=${S.readEntity(sk, c).r}`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 10);
  S.addConstraint(sk, K.Radius, [c], 7);
  S.solve(sk);
  check('Radius on a circle drives radius exactly',
        near(S.readEntity(sk, c).r, 7, 1e-5), `r=${S.readEntity(sk, c).r}`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const a = arcOn(sk, 0, 0, 10, 0, Math.PI / 2);
  S.addConstraint(sk, K.Radius, [a.eid], 7);
  S.solve(sk);
  check('Radius on an ARC (planegcs addConstraintArcRadius)',
        near(S.readEntity(sk, a.eid).r, 7, 1e-5), `r=${S.readEntity(sk, a.eid).r}`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const a = arcOn(sk, 0, 0, 10, 0, Math.PI / 2);
  S.addConstraint(sk, K.Diameter, [a.eid], 25);
  S.solve(sk);
  check('Diameter on an ARC',
        near(S.readEntity(sk, a.eid).r, 12.5, 1e-5), `r=${S.readEntity(sk, a.eid).r}`);
  S.destroySketch(sk);
}

// ---------------------------------------------------- Equal on curves
{
  const sk = S.createSketch();
  const a1 = arcOn(sk, 0, 0, 10, 0, 1);
  const a2 = arcOn(sk, 100, 0, 20, 0, 1);
  S.addConstraint(sk, K.Equal, [a1.eid, a2.eid], 0);   // used to THROW
  S.addConstraint(sk, K.Radius, [a1.eid], 15);
  S.solve(sk);
  const r1 = S.readEntity(sk, a1.eid).r, r2 = S.readEntity(sk, a2.eid).r;
  check('Equal(arc, arc) equalises radii', near(r1, 15, 1e-4) && near(r2, 15, 1e-4),
        `r1=${r1} r2=${r2}`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 10);
  const a = arcOn(sk, 100, 0, 20, 0, 1);
  S.addConstraint(sk, K.Equal, [c, a.eid], 0);
  S.addConstraint(sk, K.Radius, [c], 12);
  S.solve(sk);
  check('Equal(circle, arc) equalises radii',
        near(S.readEntity(sk, c).r, 12, 1e-4) && near(S.readEntity(sk, a.eid).r, 12, 1e-4),
        `rc=${S.readEntity(sk, c).r} ra=${S.readEntity(sk, a.eid).r}`);
  S.destroySketch(sk);
}
{
  // the SWAPPED ordering: planegcs only ships (Circle, Arc), so the facade must
  // reorder rather than refuse or silently mis-pair.
  const sk = S.createSketch();
  const a = arcOn(sk, 100, 0, 20, 0, 1);
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 10);
  S.addConstraint(sk, K.Equal, [a.eid, c], 0);
  S.addConstraint(sk, K.Radius, [a.eid], 9);
  S.solve(sk);
  check('Equal(arc, circle) — argument order swapped, not refused',
        near(S.readEntity(sk, c).r, 9, 1e-4) && near(S.readEntity(sk, a.eid).r, 9, 1e-4),
        `rc=${S.readEntity(sk, c).r} ra=${S.readEntity(sk, a.eid).r}`);
  S.destroySketch(sk);
}

// ---------------------------------------------------- Tangent line <-> arc
{
  const sk = S.createSketch();
  const a = arcOn(sk, 0, 0, 10, 0, Math.PI);
  const p0 = S.addPoint(sk, -50, 30), p1 = S.addPoint(sk, 50, 30);
  const L = S.addLine(sk, p0, p1);
  S.addConstraint(sk, K.Radius, [a.eid], 10);
  S.addConstraint(sk, K.Horizontal, [L], 0);
  S.addConstraint(sk, K.Tangent, [L, a.eid], 0);      // used to throw "not a Circle"
  S.solve(sk);
  const A = S.readPoint(sk, p0), B = S.readPoint(sk, p1), E = S.readEntity(sk, a.eid);
  // perpendicular distance from the solved arc centre to the solved line
  const d = Math.abs((B.x - A.x) * (A.y - E.y0) - (A.x - E.x0) * (B.y - A.y)) /
            Math.hypot(B.x - A.x, B.y - A.y);
  check('Tangent(line, arc) puts the line one radius from the centre',
        near(d, E.r, 1e-4), `dist=${d} r=${E.r}`);
  S.destroySketch(sk);
}

// ---------------------------------------------------- PointOnObject
{
  const sk = S.createSketch();
  const a = arcOn(sk, 0, 0, 10, 0, Math.PI);
  const p = S.addPoint(sk, 3, 2);
  S.addConstraint(sk, K.Radius, [a.eid], 10);
  S.addConstraint(sk, K.PointOnObject, [p, a.eid], 0); // arc target was unreachable
  S.solve(sk);
  const P = S.readPoint(sk, p), E = S.readEntity(sk, a.eid);
  check('PointOnObject -> ARC lands the point on the arc',
        near(Math.hypot(P.x - E.x0, P.y - E.y0), E.r, 1e-4),
        `|p-c|=${Math.hypot(P.x - E.x0, P.y - E.y0)} r=${E.r}`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 10);
  const p = S.addPoint(sk, 3, 2);
  S.addConstraint(sk, K.Radius, [c], 10);
  S.addConstraint(sk, K.PointOnObject, [p, c], 0);
  S.solve(sk);
  const P = S.readPoint(sk, p), E = S.readEntity(sk, c);
  check('PointOnObject -> CIRCLE dispatches by target kind',
        near(Math.hypot(P.x - E.x0, P.y - E.y0), E.r, 1e-4));
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const L = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 100, 0));
  const p = S.addPoint(sk, 50, 25);
  S.addConstraint(sk, K.Horizontal, [L], 0);
  S.addConstraint(sk, K.PointOnObject, [p, L], 0);
  S.solve(sk);
  const P = S.readPoint(sk, p), E = S.readEntity(sk, L);
  const d = Math.abs((E.x1 - E.x0) * (E.y0 - P.y) - (E.x0 - P.x) * (E.y1 - E.y0)) /
            Math.hypot(E.x1 - E.x0, E.y1 - E.y0);
  check('PointOnObject -> LINE dispatches by target kind', near(d, 0, 1e-6), `d=${d}`);
  S.destroySketch(sk);
}

// ---------------------------------------------------- Angle
{
  const sk = S.createSketch();
  const a = arcOn(sk, 0, 0, 10, 0, Math.PI / 2);     // 90 deg sweep
  S.addConstraint(sk, K.Angle, [a.eid], 45 * DEG);   // drive it to 45
  S.solve(sk);
  const E = S.readEntity(sk, a.eid);
  check("Angle on one arc drives its SWEPT angle (end - start)",
        near(E.a1 - E.a0, 45 * DEG, 1e-6), `sweep=${(E.a1 - E.a0) / DEG} deg`);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const L1 = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 100, 0));
  const L2 = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 100, 10));
  S.addConstraint(sk, K.Horizontal, [L1], 0);
  S.addConstraint(sk, K.Angle, [L1, L2], 30 * DEG);
  S.solve(sk);
  const A = S.readEntity(sk, L1), B = S.readEntity(sk, L2);
  let d = Math.atan2(B.y1 - B.y0, B.x1 - B.x0) - Math.atan2(A.y1 - A.y0, A.x1 - A.x0);
  while (d < 0) d += 2 * Math.PI;
  check('Angle(line, line) drives the included angle',
        near(d, 30 * DEG, 1e-5), `angle=${d / DEG} deg`);
  S.destroySketch(sk);
}

// ---------------------------------------------------- refusals stay LOUD
{
  const sk = S.createSketch();
  const L = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 10, 0));
  const c = S.addCircle(sk, S.addPoint(sk, 0, 0), 5);
  let threw = false;
  try { S.addConstraint(sk, K.Equal, [L, c], 0); } catch { threw = true; }
  check('Equal(line, curve) is REFUSED, not silently guessed', threw);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const L1 = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 10, 0));
  const L2 = S.addLine(sk, S.addPoint(sk, 0, 5), S.addPoint(sk, 10, 5));
  let threw = false;
  try { S.addConstraint(sk, K.Tangent, [L1, L2], 0); } catch { threw = true; }
  check('Tangent(line, line) is REFUSED', threw);
  S.destroySketch(sk);
}
{
  const sk = S.createSketch();
  const L = S.addLine(sk, S.addPoint(sk, 0, 0), S.addPoint(sk, 10, 0));
  let threw = false;
  try { S.addConstraint(sk, K.Radius, [L], 5); } catch { threw = true; }
  check('Radius on a LINE is REFUSED', threw);
  S.destroySketch(sk);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('===== ALL PASS =====');
