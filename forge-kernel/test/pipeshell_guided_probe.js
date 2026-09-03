// forge-kernel/test/pipeshell_guided_probe.js
//
// WHAT THIS MEASURES. The GUIDED sweep — BRepOffsetAPI_MakePipeShell driven with
// an auxiliary spine via SetMode(guideWire, CurvilinearEquivalence). That is the
// entire reason all three MakePipeShell call sites exist rather than calling
// MakePipe: an unguided sweep is family E's job.
//
// WHY IT EXISTS. FORGE_PIPESHELL_DROP_NATIVE compiles the OCCT fallback out of
// all three sites, and the native engine (src/native/brep/NativeLoftPipe.cpp,
// pipeShell()) declines EVERY guide unconditionally — `if (!guides.empty())
// FK_DEFER("guides_present")`, the first statement in the function. So the option
// deletes the guided sweep outright. Nothing in the tree measured that: the two
// smoke tests that drive a guided sweep (test/part_features_smoke.js:624,
// test/push07_classa_smoke.js:190) both wrap the call in a try/catch that PRINTS
// the exception and continues — "error-path ok" — so a build in which the guided
// sweep has ceased to exist passes both of them unchanged.
//
// This probe therefore does not catch; it REPORTS, as one JSON line per case, so
// the two builds can be differenced. run_pipeshell_guided_gate.sh is the gate.
//
// usage: FORGE_KERNEL=<path to forge-kernel.node> node test/pipeshell_guided_probe.js
const path = require('path');
const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
let forge;
try { forge = require(KERNEL); }
catch (e) { console.log(JSON.stringify({fatal: `load ${KERNEL}: ${e.message}`})); process.exit(2); }

const sk = forge.sketcher, part = forge.part;
const out = [];
function record(name, guided, fn) {
  try {
    const h = fn();
    // A bare "it returned a handle" is not evidence of geometry. MEASURED: every
    // case here comes back with volume 0 because MakePipeShell.MakeSolid() on a
    // WIRE profile yields a shell, so AREA and the tessellated TRIANGLE COUNT are
    // the observables that separate "built a surface" from "returned a handle to
    // nothing". A success is only reported as such when both are non-zero.
    let vol = null, area = null, tris = null;
    try { const m = forge.massProps(h); vol = m.volume; area = m.area; } catch (e) { /* not a solid */ }
    try { tris = forge.tessellate(h, 0.1, 0.5).triangleCount; } catch (e) { /* not tessellable */ }
    out.push({ case: name, guided, ok: true, volume: vol, area, tris,
               substantiated: !!(area > 0 && tris > 0), error: null });
  } catch (e) {
    out.push({ case: name, guided, ok: false, volume: null, area: null, tris: null,
               substantiated: false, error: String(e.message).slice(0, 160) });
  }
}

function circleSketch(r) { const h = sk.createSketch(); const c = sk.addPoint(h, 0, 0); sk.addCircle(h, c, r); return h; }
function arcSketch(r) {
  const h = sk.createSketch();
  const c = sk.addPoint(h, 0, 0), s = sk.addPoint(h, r, 0), e = sk.addPoint(h, 0, r);
  sk.addArc(h, c, s, e);
  return h;
}

// 1) THE GUIDED SWEEP — one guide. This is the capability under test.
record('part.sweepWithGuides/1guide', true,
  () => part.sweepWithGuides(circleSketch(1.0), arcSketch(5.0), [arcSketch(6.0)]));

// 2) THE SAME ENTRY POINT WITH NO GUIDE — the CONTROL that separates
//    "the guided sweep was deleted" from "sweepWithGuides was deleted entirely".
//    The native engine can serve this one, so it must survive the drop.
record('part.sweepWithGuides/0guides', false,
  () => part.sweepWithGuides(circleSketch(1.0), arcSketch(5.0), []));

// 3) A STRAIGHT spine with no guide — the case the native engine is
//    strongest on. A second control: if THIS breaks, the drop broke the
//    unguided path too and the reading of case 1 would be confounded.
record('part.sweepWithGuides/0guides-straight', false, () => {
  const p = sk.createSketch();
  const a = sk.addPoint(p, 0, 0), b = sk.addPoint(p, 0, 10);
  sk.addLine(p, a, b);
  return part.sweepWithGuides(circleSketch(1.0), p, []);
});

for (const r of out) console.log(JSON.stringify(r));
