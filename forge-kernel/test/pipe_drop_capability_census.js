// ─────────────────────────────────────────────────────────────────────────────
// pipe_capability_census.js — WHAT DOES FORGE_PIPE_DROP_NATIVE DELETE?
//
// Not a pass/fail gate. It runs the shapes the tree's REAL consumers of the three
// BRepOffsetAPI_MakePipe call sites actually build, and reports, per shape,
// whether the binary under test returns a solid or throws. Run it against the
// OFF build and the ON build and diff the two columns: the difference IS the
// deleted capability, measured rather than argued.
//
// The consumers, from grep over the repo (not assumed):
//   src/ft/FeatureTreeCompiler.cpp opSweep -> pipeFromPolyline / sweepPolyline
//        the Feature-Tree IR's SWEEP op. Its path is a 3D POLYLINE by construction,
//        so this call site cannot present a curved spine at all.
//   frontend/src/forge-v4/threadGenerator.js -> part.sweep(profileWire, helixWire)
//        helixWire = makePolylineWire(helixPoints): a DISCRETISED helix, i.e. also
//        a polyline. (Checked -- it is not a true helical curve.)
//   frontend/src/forge-v4/kernelDispatch.js -> part.sweep(currentSketch, pathSketch)
//        an arbitrary user sketch, which MAY contain arcs. This is the one that
//        can present a curved spine.
//
// usage: node pipe_capability_census.js <forge-kernel.node> <label>
// ─────────────────────────────────────────────────────────────────────────────
const forge = require(process.argv[2]);
const label = process.argv[3] || '?';
const sk = forge.sketcher;

function run(name, fn) {
  let out = null, err = null;
  try { out = fn(); } catch (e) { err = String((e && e.message) || e); }
  if (out !== null && out !== undefined) {
    let v = NaN;
    try { v = forge.massProps(out).volume; } catch (e) { v = NaN; }
    console.log(`  ${label.padEnd(8)} ${name.padEnd(46)} BUILT   vol=${v}`);
    return { built: true, vol: v };
  }
  console.log(`  ${label.padEnd(8)} ${name.padEnd(46)} THREW   ${String(err).slice(0,110)}`);
  return { built: false, err };
}

// 1. IR SWEEP, pipe form — polyline path, circular section.
run('IR SWEEP pipe (polyline, r=2)', () =>
  forge.part.pipeFromPolyline([0,0,0, 30,0,0, 30,20,0, 30,20,25], 2.0));

// 2. IR SWEEP, profile form — polyline path, polygon section.
run('IR SWEEP profile (polyline, hex ring)', () => {
  const n = 6, R = 4, prof = [];
  for (let i = 0; i < n; i++) prof.push(R*Math.cos(2*Math.PI*i/n), R*Math.sin(2*Math.PI*i/n));
  return forge.part.sweepPolyline(prof, [0,0,0, 0,0,30, 0,18,30]);
});

// 3. threadGenerator's REAL shape: a DISCRETISED helix polyline as the spine.
//    24 segments/turn, 3 turns, coil radius 8, pitch 2 — a many-leg polyline with
//    a small turn per node. This is the shape that decides whether V-thread
//    generation survives the drop.
run('threadGen discretised helix (3 turns, 72 legs)', () => {
  const segPerTurn = 24, turns = 3, R = 8, pitch = 2, pts = [];
  for (let i = 0; i <= segPerTurn*turns; i++) {
    const t = 2*Math.PI*i/segPerTurn;
    pts.push(R*Math.cos(t), R*Math.sin(t), pitch*i/segPerTurn);
  }
  return forge.part.pipeFromPolyline(pts, 0.5);
});

// 4. kernelDispatch's risky shape: a sketch path containing an ARC (curved spine).
run('part.sweep with an ARC spine sketch', () => {
  const prof = sk.createSketch();
  const pc = sk.addPoint(prof, 0, 0);
  sk.addCircle(prof, pc, 1.0);
  const path = sk.createSketch();
  const c = sk.addPoint(path, 0, 0), s = sk.addPoint(path, 5, 0), e = sk.addPoint(path, 0, 5);
  sk.addArc(path, c, s, e);
  return forge.part.sweep(prof, path, false);
});

// 5. part.sweep with a straight LINE spine sketch (the polyline control for #4).
run('part.sweep with a LINE spine sketch', () => {
  const prof = sk.createSketch();
  const pc = sk.addPoint(prof, 0, 0);
  sk.addCircle(prof, pc, 1.0);
  const path = sk.createSketch();
  const a = sk.addPoint(path, 0, 0), b = sk.addPoint(path, 10, 0);
  sk.addLine(path, a, b);
  return forge.part.sweep(prof, path, false);
});

// ── 6. THE DEFECT, CHARACTERISED IN CLOSED FORM ─────────────────────────────
// Sweep a circle along a 2-leg spine and turn the second leg through a range of
// angles. This is the single measurement that says what each engine COMPUTES,
// rather than whether it returns something.
//
//   native : A*(L1+L2), CONSTANT in theta — what a mitred sweep must give, since
//            the volume of a swept prism does not depend on how the spine turns.
//   OCCT   : A*(L1 + L2*cos theta) — it contributes only the PROJECTION of the
//            second leg onto the first leg's direction.
//
// theta = 0 is the CONTROL: a straight spine needs no mitre, OCCT is a valid
// oracle there, and the two engines agree exactly. Every other row is OCCT
// under-integrating, by 64% at 120 degrees.
//
// It also reconciles two readings that look inconsistent elsewhere: with 90-degree
// elbows cos theta = 0, the cascade collapses and OCCT returns EXACTLY the first
// leg; with the corpus harness's 30-degree turn it returns A(L1 + L2*cos30), i.e.
// the ratio 2/(1+cos30) = 1.0717968 measured on 599 of 600 corpus parts.
console.log('--- case 6: what each engine COMPUTES, vs closed form (r=2, L1=40, L2=30) ---');
{
  const r = 2, L1 = 40, L2 = 30, A = Math.PI * r * r;
  console.log(`  ${label.padEnd(8)} ${'theta'.padStart(6)} ${'volume'.padStart(14)}` +
              ` ${'A(L1+L2cos)'.padStart(13)} ${'A(L1+L2)'.padStart(11)}`);
  for (const deg of [0, 30, 60, 90, 120]) {
    const th = deg * Math.PI / 180;
    const pts = [0,0,0, L1,0,0, L1 + L2*Math.cos(th), L2*Math.sin(th), 0];
    let v = NaN;
    try { v = forge.massProps(forge.part.pipeFromPolyline(pts, r)).volume; }
    catch (e) { v = NaN; }
    console.log(`  ${label.padEnd(8)} ${(deg+'deg').padStart(6)} ${v.toFixed(6).padStart(14)}` +
                ` ${(A*(L1+L2*Math.cos(th))).toFixed(6).padStart(13)}` +
                ` ${(A*(L1+L2)).toFixed(6).padStart(11)}`);
  }
}
