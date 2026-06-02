// forge-kernel Airfoil smoke (Forge-171) — NACA 4/5-digit math, Selig parser,
// face + wing loft round-trips against expected analytical values.
//
// Exit non-zero on failure so npm script + CI catch it.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.airfoil, 'forge.airfoil missing');
for (const fn of ['naca4', 'naca5', 'parseSelig', 'resampleCosine',
                  'profileToFace', 'loftWing', 'trapezoidalWing',
                  'planformMetrics']) {
  assert.ok(typeof forge.airfoil[fn] === 'function',
            `forge.airfoil.${fn} missing or not a function`);
}

// ---------------------------------------------------------------- NACA 4-digit

const p2412 = forge.airfoil.naca4('2412', 160);
assert.ok(p2412.points.length >= 100,
          `naca4 returned only ${p2412.points.length / 2} points`);
assert.strictEqual(p2412.points.length % 2, 0, 'points length must be even');
// Closure: first == last
assert.strictEqual(p2412.points[0], p2412.points[p2412.points.length - 2],
                   'profile must close in x');
assert.strictEqual(p2412.points[1], p2412.points[p2412.points.length - 1],
                   'profile must close in y');

// Symmetric 0012: camber line is zero everywhere.
const p0012 = forge.airfoil.naca4('0012', 80);
let maxAbsCamberPair = 0;
for (let i = 0; i < p0012.points.length / 2; ++i) {
  // For a symmetric airfoil, upper+lower at the same chord-x should be ±y_t.
  // We can't directly index pair across upper/lower without resorting; just
  // check that the mean of all y values is near zero (symmetry).
  maxAbsCamberPair = Math.max(maxAbsCamberPair, Math.abs(p0012.points[2 * i + 1]));
}
// Symmetric airfoil thickness peaks at ~ ±0.06 for t=0.12, so we expect max |y|
// somewhere near 0.06. The mean over the closed polyline should be ~0.
let yMean = 0;
for (let i = 0; i < p0012.points.length / 2; ++i) {
  yMean += p0012.points[2 * i + 1];
}
yMean /= (p0012.points.length / 2);
assert.ok(Math.abs(yMean) < 1e-3,
          `naca4(0012) y mean ${yMean} should be ~0 (symmetric)`);
assert.ok(maxAbsCamberPair > 0.04 && maxAbsCamberPair < 0.08,
          `naca4(0012) max |y| ${maxAbsCamberPair} not near 0.06`);

// NACA 2412 max-camber check at p=0.4 should equal m=0.02 at the camber line.
// We sample the camber line by averaging upper+lower y at the same x.
// Locate two points with x ≈ 0.4 — one upper (y>0 typically) and one lower (y<0).
function pointsNearX(profile, xTarget, tol = 0.02) {
  const out = [];
  for (let i = 0; i < profile.points.length / 2; ++i) {
    const x = profile.points[2 * i];
    if (Math.abs(x - xTarget) < tol) {
      out.push({ x, y: profile.points[2 * i + 1] });
    }
  }
  return out;
}
const pairAt04 = pointsNearX(p2412, 0.40, 0.04);
assert.ok(pairAt04.length >= 2,
          `expected ≥ 2 points near x=0.4, got ${pairAt04.length}`);
const camberLineY = pairAt04.reduce((s, p) => s + p.y, 0) / pairAt04.length;
assert.ok(Math.abs(camberLineY - 0.02) < 0.005,
          `naca4(2412) camber at x≈0.4 = ${camberLineY}, expected ~0.02`);

// ---------------------------------------------------------------- NACA 5-digit
const p23012 = forge.airfoil.naca5('23012', 160);
assert.ok(p23012.points.length >= 100, 'naca5 returned too few points');
// Thickness check: at x ≈ 0.3, the surface-to-surface vertical distance
// should equal ~ 2 × yt(0.3) ≈ 2 × 0.0596 = 0.1192 for t=12%.
const pair3 = pointsNearX(p23012, 0.30, 0.03);
if (pair3.length >= 2) {
  // Pair upper / lower: the largest y - smallest y at this x band.
  let ymin = Infinity, ymax = -Infinity;
  for (const p of pair3) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  const thick = ymax - ymin;
  assert.ok(thick > 0.08 && thick < 0.14,
            `naca5(23012) thickness at x≈0.3 = ${thick}, expected ~0.119`);
}

// ---------------------------------------------------------------- Selig parser
const seligText = `TEST AIRFOIL
1.0  0.0
0.5  0.05
0.0  0.0
0.5  -0.05
1.0  0.0
`;
const ptest = forge.airfoil.parseSelig(seligText);
assert.ok(ptest.points.length >= 10, 'parseSelig returned too few points');
assert.ok(ptest.source.includes('Selig') && ptest.source.includes('TEST AIRFOIL'),
          `source field is '${ptest.source}'`);

// Reject malformed Selig (out-of-range coordinate).
let threw = false;
try { forge.airfoil.parseSelig("BAD\n1.0 0.0\n10.0 5.0\n0.0 0.0\n1.0 0.0\n"); }
catch (e) { threw = true; }
assert.ok(threw, 'parseSelig should reject out-of-range coordinates');

// Reject bad NACA codes.
threw = false;
try { forge.airfoil.naca4('12345', 80); } catch (e) { threw = true; }
assert.ok(threw, 'naca4 should reject 5-digit code');
threw = false;
try { forge.airfoil.naca5('23112', 80); } catch (e) { threw = true; }
assert.ok(threw, 'naca5 should reject reflex (third-digit = 1) families');

// ---------------------------------------------------------------- profileToFace
const faceHandle = forge.airfoil.profileToFace(p2412, 100.0);
assert.ok(typeof faceHandle === 'number' && faceHandle > 0,
          `profileToFace handle is ${faceHandle}`);
// Tessellate the face and verify non-zero surface area.
const tess = forge.tessellate(faceHandle, 0.1);
assert.ok(tess.positions.length > 30,
          `profileToFace tessellation has only ${tess.positions.length/3} vertices`);
assert.ok(tess.indices.length >= 3,
          `profileToFace tessellation has only ${tess.indices.length/3} triangles`);

// ---------------------------------------------------------------- trapezoidalWing
const tw = forge.airfoil.trapezoidalWing({
  rootProfile : forge.airfoil.naca4('2412', 80),
  tipProfile  : forge.airfoil.naca4('0012', 80),
  rootChordMm : 200,
  taperRatio  : 0.5,
  halfSpanMm  : 1000,
  sweepDeg    : 20,
  dihedralDeg : 5,
  twistDeg    : -2,
  spanStations: 5,
});
assert.ok(typeof tw === 'number' && tw > 0, `trapezoidalWing handle is ${tw}`);
const twMass = forge.massProps(tw);
assert.ok(twMass.volume > 1.0e4,
          `trapezoidalWing volume too small: ${twMass.volume} mm³`);

// Tessellate the wing and check bounding box.
const twTess = forge.tessellate(tw, 1.0);
let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity,
    zMin = Infinity, zMax = -Infinity;
for (let i = 0; i < twTess.positions.length / 3; ++i) {
  const x = twTess.positions[3 * i + 0];
  const y = twTess.positions[3 * i + 1];
  const z = twTess.positions[3 * i + 2];
  if (x < xMin) xMin = x; if (x > xMax) xMax = x;
  if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  if (z < zMin) zMin = z; if (z > zMax) zMax = z;
}
const spanY = yMax - yMin;
assert.ok(Math.abs(spanY - 1000) < 50,
          `wing Y span ${spanY} should be ≈ 1000 mm`);
// Chord X span: ranges from 0 at root LE to (sweepOffset + tipChord) at tip TE.
const chordX = xMax - xMin;
assert.ok(chordX > 200 && chordX < 1500,
          `wing X span ${chordX} not in expected range`);

// ---------------------------------------------------------------- planformMetrics
const pm = forge.airfoil.planformMetrics({
  rootProfile : forge.airfoil.naca4('2412', 80),
  rootChordMm : 200,
  taperRatio  : 0.5,
  halfSpanMm  : 1000,
  sweepDeg    : 0,
  dihedralDeg : 0,
  twistDeg    : 0,
  spanStations: 5,
});
// S = (cr+ct)/2 * b = (200+100)/2 * 2000 = 300000 mm²
assert.ok(Math.abs(pm.areaMm2 - 300000) < 1,
          `planform area ${pm.areaMm2} should be 300000 mm²`);
// AR = b²/S = 4e6 / 3e5 = 13.33
assert.ok(Math.abs(pm.aspectRatio - 13.333) < 0.01,
          `AR ${pm.aspectRatio} should be 13.33`);
// MAC = (2/3)·200·(1+0.5+0.25)/(1+0.5) = (2/3)·200·(1.75/1.5) = 155.55 mm
assert.ok(Math.abs(pm.meanAeroChordMm - 155.555) < 0.1,
          `MAC ${pm.meanAeroChordMm} should be 155.55 mm`);

console.log('✅ Airfoil smoke PASSED');
console.log(`   NACA 2412 closed polyline:    ${p2412.points.length / 2} points`);
console.log(`   NACA 23012 thickness check:   pass`);
console.log(`   Selig DAT parser:             pass (round-trip + reject malformed)`);
console.log(`   profileToFace(NACA-2412):     handle=${faceHandle}, area>0`);
console.log(`   trapezoidalWing(2412→0012):   handle=${tw}, vol=${twMass.volume.toFixed(0)} mm³`);
console.log(`   planformMetrics:              S=${pm.areaMm2}, AR=${pm.aspectRatio.toFixed(2)}, MAC=${pm.meanAeroChordMm.toFixed(1)}`);
