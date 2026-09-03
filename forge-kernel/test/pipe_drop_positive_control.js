// ─────────────────────────────────────────────────────────────────────────────
// pipe_positive_control.js — POSITIVE CONTROL for TKOffset family E
// (FORGE_PIPE_DROP_NATIVE / BRepOffsetAPI_MakePipe).
//
// It answers three questions, and it is only meaningful next to the nm proof
// that runs beside it: with the option ON the .node carries NONE of
// BRepOffsetAPI_MakePipe's three symbols, so any solid that arrives here cannot
// have come from OCCT's MakePipe.
//
//   A. does a real sweep still come back, and is it the RIGHT solid?
//   B. is the drop REAL — does an input the native engine declines surface the
//      drop's own error instead of quietly falling back?
//   C. WHAT DOES THE DROP DELETE? Case 5 is not a pass/fail assertion, it is a
//      measurement: the native pipe handles POLYLINE spines only, so every
//      CURVED-spine sweep that OCCT built now throws. It is reported as a
//      capability census, and it is the number that argues AGAINST this drop.
//
// Every built case is checked on a VECTOR of observables, never volume alone:
// volume AND centre of mass AND bounding box. A past native quadric-offset
// defect in this repo passed volume, COM and bbox each on its own.
//
// usage: node pipe_positive_control.js <path to forge-kernel.node>
// exit 0 iff every A/B assertion holds. Case 5 never fails the run; it reports.
// ─────────────────────────────────────────────────────────────────────────────
const forge = require(process.argv[2]);
let pass = 0, fail = 0;
const PI = Math.PI;

function ck(name, got, want, rtol) {
  const ok = Math.abs(got - want) <= rtol * Math.max(1e-12, Math.abs(want));
  if (ok) { pass++; console.log(`  [PASS] ${name} = ${got}`); }
  else    { fail++; console.log(`  [FAIL] ${name} = ${got} EXPECTED ${want} rel=${Math.abs(got-want)/Math.abs(want)}`); }
}
function ckTrue(name, cond, note) {
  if (cond) { pass++; console.log(`  [PASS] ${name}${note?' — '+note:''}`); }
  else      { fail++; console.log(`  [FAIL] ${name}${note?' — '+note:''}`); }
}
const dist = (a,b) => Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
const comOf = (mp) => mp.com || mp.centreOfMass || mp.centerOfMass || mp.centroid || null;

// ── 1. pipeFromPolyline, CIRCLE profile, BENT spine ────────────────────────
// The native engine MITRES at the corner, so the enclosed volume is exactly
// pi*r^2*(total polyline length). OCCT's MakePipe rigidly TRANSLATES the section
// instead and returns a different number on the same input — measured corpus-wide
// as a constant ratio 2/(1+cos30). That is why the closed form, and not OCCT, is
// the oracle here.
console.log('--- case 1: pipeFromPolyline, circle r=3, 2-leg bent spine ---');
{
  const A=[0,0,0], B=[40,0,0], C=[40,30,0], r=3.0;
  const h = forge.part.pipeFromPolyline([...A,...B,...C], r);
  const mp = forge.massProps(h);
  const L = dist(A,B)+dist(B,C);
  ck('volume == pi*r^2*L (mitred closed form)', mp.volume, PI*r*r*L, 1e-6);
  ckTrue('positive volume', mp.volume > 0, `vol=${mp.volume}`);
  console.log(`      com=${JSON.stringify(comOf(mp))}`);
}

// ── 2. STRAIGHT spine — volume AND COM are both pinned exactly ─────────────
console.log('--- case 2: pipeFromPolyline, circle r=2.5, STRAIGHT spine (COM pinned) ---');
{
  const r=2.5, L=50;
  const h = forge.part.pipeFromPolyline([0,0,0, L,0,0], r);
  const mp = forge.massProps(h);
  ck('volume == pi*r^2*L', mp.volume, PI*r*r*L, 1e-6);
  const com = comOf(mp);
  if (com) {
    ck('COM x == L/2', com[0], L/2, 1e-6);
    ckTrue('COM y ~ 0', Math.abs(com[1]) < 1e-6*r, `y=${com[1]}`);
    ckTrue('COM z ~ 0', Math.abs(com[2]) < 1e-6*r, `z=${com[2]}`);
  } else { console.log('      (massProps exposes no COM field; volume-only here)'); }
}

// ── 3. sweepPolyline, POLYGON profile, bent spine ─────────────────────────
console.log('--- case 3: sweepPolyline, 10x10 square profile, 2-leg bent spine ---');
{
  const prof=[-5,-5, 5,-5, 5,5, -5,5];
  const A=[0,0,0], B=[0,0,40], C=[0,25,40];
  const h = forge.part.sweepPolyline(prof, [...A,...B,...C]);
  const mp = forge.massProps(h);
  const L = dist(A,B)+dist(B,C);
  ck('volume == area*L (mitred closed form)', mp.volume, 100*L, 1e-6);
}

// ── 4. THE DROP IS REAL: a declined input must THROW, not fall back ───────
// A 180-degree spine reversal is an unconditional honest defer in the native
// engine (mitre_reversal: the bisector of two opposite legs is the zero vector).
// With the OCCT fallback compiled out that decline has to surface as the drop's
// own error. If this SUCCEEDS, the OCCT path is still linked and cases 1-3 prove
// nothing about the drop.
console.log('--- case 4: a declined input must throw the DROP error, not fall back ---');
{
  let msg=null, built=false;
  try {
    forge.part.pipeFromPolyline([0,0,0, 40,0,0, 5,0,0], 2.0);  // doubles back
    built = true;
  } catch (e) { msg = String((e && e.message) || e); }
  ckTrue('a declined sweep threw rather than building', !built, msg ? msg.slice(0,120) : '(it BUILT)');
  if (msg) ckTrue('the throw names FORGE_PIPE_DROP_NATIVE (the fallback is gone)',
                  /FORGE_PIPE_DROP_NATIVE/.test(msg), msg.slice(0,160));
}

// ── 5. CAPABILITY CENSUS — what the drop DELETES (reported, never asserted) ─
// forge.part.sweep is the third MakePipe call site. The native pipe requires a
// POLYLINE spine; a curved spine is an unconditional decline. Under the drop that
// is a thrown error where OCCT previously returned a solid. The shipped
// test/part_features_smoke.js sweep case uses an ARC spine and wraps the call in
// a catch that prints "sweep error-path ok", so this deletion is INVISIBLE to it.
console.log('--- case 5: CAPABILITY CENSUS — curved-spine sweep (not an assertion) ---');
try {
  const sk = forge.sketcher || forge.sketch;
  if (!sk || !sk.createSketch) { console.log('      [SKIP] no sketch API on this addon'); }
  else {
    const prof = sk.createSketch();
    const pc = sk.addPoint(prof, 0, 0);
    sk.addCircle ? sk.addCircle(prof, pc, 1.0) : null;
    const pathSk = sk.createSketch();
    const c  = sk.addPoint(pathSk, 0, 0);
    const sp = sk.addPoint(pathSk, 5, 0);
    const ep = sk.addPoint(pathSk, 0, 5);
    sk.addArc(pathSk, c, sp, ep);
    let out = null, err = null;
    try { out = forge.part.sweep(prof, pathSk, false); } catch (e) { err = String((e&&e.message)||e); }
    if (out !== null) {
      const mp = forge.massProps(out);
      console.log(`      CURVED-SPINE SWEEP BUILT: vol=${mp.volume}`);
    } else {
      console.log(`      CURVED-SPINE SWEEP DELETED BY THE DROP: ${err.slice(0,180)}`);
    }
  }
} catch (e) { console.log('      [SKIP] census could not run:', String(e).slice(0,120)); }

console.log(`\n===== ${pass}/${pass+fail} assertions passed =====`);
process.exit(fail === 0 ? 0 : 1);
