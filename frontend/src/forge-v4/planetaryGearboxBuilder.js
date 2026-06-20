// planetaryGearboxBuilder.js — FORGE FLAGSHIP PARAMETRIC PLANETARY GEARBOX
// ============================================================================
// FORGE FLAGSHIP project #2. Builds a complete single-stage epicyclic
// (planetary) gear drive as REAL OCCT B-rep solids, fully parametric, headless:
//
//   sun gear (input)  +  N planet gears (instanced on the carrier)  +
//   ring / internal (annulus) gear  +  carrier (front+back cheek plates with
//   planet pins)  +  input shaft  +  output shaft  +  two bearings  +  housing.
//
// EVERY dimension is DERIVED from the parameters {module m, pressure angle φ,
// sunTeeth, planetTeeth, planetCount, faceWidth, …}. The standard meshing /
// coaxiality law that ties an epicyclic train together is ENFORCED:
//
//     Zring = Zsun + 2·Zplanet                       (coaxial centres)
//     carrier-circle R = Rsun + Rplanet = Rring − Rplanet   (real meshing)
//     ratio (ring fixed, sun in, carrier out) = 1 + Zring / Zsun
//
// Because the carrier circle equals BOTH the sun↔planet centre distance and the
// ring↔planet centre distance, the three pitch circles are mutually tangent at
// the meshes — the teeth ACTUALLY INTERLOCK at the pitch circles by construction.
//
// TOOTH GEOMETRY — involute. Each flank is sampled from the TRUE involute of the
// gear's base circle  rb = Rp·cos φ  ( x = rb(cos t + t sin t), y = rb(sin t −
// t cos t) ), from the base/root radius up to the tip radius, mirrored to the
// opposite flank, capped by a tip land and joined by a root land. The tooth
// THICKNESS at the pitch circle is the standard π·m/2 (minus backlash); the
// addendum (a = m) and dedendum (b = 1.25 m) set the tip/root circles. The
// profile is a closed polyline whose vertices lie ON the involute, so the flanks
// are involute-accurate to the sampling density (the kernel verbs extrude
// polylines, not analytic splines — see VERB GAPS). Tooth count, pitch / tip /
// root radii, centre distances and mesh phase are all exact.
//
// Engine axis = WORLD +Z (gears lie in XY, stack along +Z) — matches the
// kernel's cylinder / extrude z-up convention so the polar tooth ring and the
// part.* primitives line up without extra rotation.
//
// PURE CUA / NO IMPORTS: every kernel op goes through dispatchToolCall with a
// SHARED ctx — the exact Archie-trained tool-call surface (part.make-cylinder /
// extrude / revolve / circular-pattern / fuse / cut / translate, part.begin /
// add / subtract / finish, assembly.*). No STEP/STL import, no external geometry.
//
// INSTANCING keeps memory bounded: only ~12 UNIQUE kernel bodies are built; the
// N planets are ONE body replicated as discrete assembly instances, so the build
// stays light (tens of bodies) even if planetCount is cranked to the thousands.
//
// USAGE (headless):
//   import { makeHeadlessForge } from '../../../forge-kernel/test/cadscore_harness.mjs';
//   import { buildPlanetaryGearbox } from './planetaryGearboxBuilder.js';
//   const forge = makeHeadlessForge();
//   const res = await buildPlanetaryGearbox(forge);          // defaults
//   const r2  = await buildPlanetaryGearbox(forge, { sunTeeth: 24, planetTeeth: 24, planetCount: 5 });
//   // res.gearTrain = { Zsun, Zplanet, Zring, planetCount, ratio, carrierR, … }
//   // res.bodies    = [{ name, handle, role, instances, triangles, bbox, volume }, …]
//   // res.assembly  = { uniqueBodies, instances, mates, solve, ratio, coherent }
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;

// ───────────────────────────────────────────────────────────────────────────
//  Default parameters — a stout single-stage planetary reduction.
//  All linear dimensions in MILLIMETRES; tooth counts are integers.
//    ratio = 1 + Zring/Zsun = 1 + (18 + 2·21)/18 = 1 + 60/18 = 4.333 : 1
// ───────────────────────────────────────────────────────────────────────────
export const DEFAULT_PARAMS = {
  // ── Gear set (the parametric heart) ──────────────────────────────────────
  module: 4,             // gear module m (mm/tooth) — sets every pitch radius
  pressureAngle: 20,     // standard 20° involute pressure angle (deg)
  sunTeeth: 18,          // Zsun  (input)
  planetTeeth: 21,       // Zplanet  → Zring = 18 + 2·21 = 60 (derived)
  planetCount: 3,        // N planets (3 is the canonical balanced count)
  faceWidth: 30,         // axial gear thickness (face width) mm
  flankSamples: 8,       // involute flank sample points per side (per tooth)
  backlash: 0.08,        // circumferential backlash trimmed off each flank (mm)

  // ── Bores & shafts ───────────────────────────────────────────────────────
  sunBore: 16,           // sun centre bore Ø mm (input-shaft fit)
  planetBore: 12,        // planet centre bore Ø mm (rides the carrier pin)
  inputShaftDia: 16,     // input shaft Ø mm (drives the sun)
  inputShaftLen: 70,     // input shaft protrusion length mm
  outputShaftDia: 30,    // output shaft Ø mm (driven by the carrier)
  outputShaftLen: 80,    // output shaft protrusion length mm

  // ── Carrier ──────────────────────────────────────────────────────────────
  carrierPlateThk: 12,   // each carrier cheek-plate thickness mm
  carrierPlateClear: 5,  // axial clearance between gear face and carrier plate
  carrierPinDia: 11.5,   // planet pin Ø mm (slight clearance inside planetBore)
  carrierHubBore: 18,    // carrier central hub bore Ø mm

  // ── Ring rim & housing ───────────────────────────────────────────────────
  ringRimWidth: 18,      // radial rim thickness OUTSIDE the ring tip circle
  housingWall: 8,        // cylindrical housing wall thickness mm
  housingEndThk: 9,      // housing end-cap thickness (front & back) mm
  housingClear: 4,       // radial gap between ring OD and housing bore mm

  // ── Bearings (real annular races at each shaft) ──────────────────────────
  bearingWidth: 12,      // bearing axial width mm
  bearingWall: 6,        // race radial wall mm

  // ── Tessellation tolerance (mm chord deflection / rad) ───────────────────
  tessLinear: 0.5,
  tessAngular: 0.6,
};

// ───────────────────────────────────────────────────────────────────────────
//  4×4 row-major transform helpers (assembly instancing)
// ───────────────────────────────────────────────────────────────────────────
function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
/** Pure translation to (x,y,z). */
function transl(x, y, z) { return [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1]; }
/** Rotate by `ang` (rad) about +Z, then translate to (x,y,z). Seats + clocks a planet. */
function rotZtransl(ang, x, y, z) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [c, -s, 0, x, s, c, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

// ───────────────────────────────────────────────────────────────────────────
//  Gear math — every radius derived from module + tooth count (involute std).
//    pitch    Rp  = m·Z / 2
//    base     rb  = Rp·cos φ
//    addendum a   = m            → tip  Ra = Rp + m   (external)
//    dedendum b   = 1.25·m       → root Rf = Rp − 1.25·m (external)
//    circular pitch p = π·m ; tooth thickness at pitch = p/2
// ───────────────────────────────────────────────────────────────────────────
function gearGeom(m, Z, phiDeg) {
  const Rp = (m * Z) / 2;
  const rb = Rp * Math.cos(phiDeg * DEG);
  return {
    Z, module: m, pitchR: Rp, baseR: rb,
    tipR: Rp + m,
    rootR: Math.max(0.5, Rp - 1.25 * m),
    addendum: m, dedendum: 1.25 * m,
    toothThick: (Math.PI * m) / 2,   // tooth thickness at the pitch circle
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  INVOLUTE TOOTH PROFILE GENERATION
// ───────────────────────────────────────────────────────────────────────────
/** Involute point at unwinding angle t (rad) on a base circle of radius rb. */
function involutePoint(rb, t) {
  return [rb * (Math.cos(t) + t * Math.sin(t)), rb * (Math.sin(t) - t * Math.cos(t))];
}
/** Polar angle (about the axis) of the involute point that reaches radius r. */
function involuteAngleAt(rb, r) {
  if (r <= rb) return 0;
  const t = Math.sqrt((r * r) / (rb * rb) - 1);
  const p = involutePoint(rb, t);
  return Math.atan2(p[1], p[0]);
}

/**
 * Build ONE external gear tooth as a closed [[x,y], …] loop centred on the +X
 * axis, with INVOLUTE flanks. Returns the loop; replicate it Z× around the axis
 * (part.circular-pattern) to form the full gear.
 *
 * The flank is sampled from max(base, root) up to the tip. The tooth is centred
 * on +X (angle 0): each flank point at radius r sits at the polar angle
 *   ± [ halfToothAngle + (invAtPitch − invAt(r)) ]
 * so the flank passes through the pitch circle at exactly the half-tooth angle
 * (standard tooth thickness π·m/2, minus half the backlash on each side).
 */
function externalToothLoop(g, phiDeg, flankSamples, backlash) {
  const rb = g.baseR;
  const rLo = Math.max(rb, g.rootR);     // involute begins at base (or root if higher)
  const rHi = g.tipR;
  const n = Math.max(3, flankSamples | 0);

  const blAngle = backlash > 0 ? (backlash / 2) / g.pitchR : 0;
  const halfTooth = Math.PI / (2 * g.Z) - blAngle;          // half tooth-thickness angle
  const invAtPitch = involuteAngleAt(rb, g.pitchR);

  // +flank: root → tip on the +angle side.
  const plus = [];
  for (let i = 0; i <= n; i++) {
    const r = rLo + (rHi - rLo) * (i / n);
    const ang = halfTooth + (invAtPitch - involuteAngleAt(rb, r));
    plus.push([r * Math.cos(ang), r * Math.sin(ang)]);
  }
  // tip land: short arc across the tip from +flank end to −flank end.
  const tipAng = Math.atan2(plus[plus.length - 1][1], plus[plus.length - 1][0]);
  const tip = [];
  const tipSteps = 2;
  for (let i = 1; i < tipSteps; i++) {
    const a = tipAng + (-tipAng - tipAng) * (i / tipSteps);
    tip.push([g.tipR * Math.cos(a), g.tipR * Math.sin(a)]);
  }
  // −flank: tip → root on the −angle side (mirror of +flank).
  const minus = plus.map(([x, y]) => [x, -y]).reverse();
  // Drop the root point below the base if the root is below base (extends the
  // flank down to the root circle with a short radial segment).
  const rootGap = [];
  if (g.rootR < rLo - 1e-6) {
    const a0 = Math.atan2(minus[minus.length - 1][1], minus[minus.length - 1][0]);
    const a1 = Math.atan2(plus[0][1], plus[0][0]);
    rootGap.push([g.rootR * Math.cos(a0), g.rootR * Math.sin(a0)]);
    rootGap.push([g.rootR * Math.cos(a1), g.rootR * Math.sin(a1)]);
  }
  // tooth = +flank (root→tip) + tip land + −flank (tip→root) + optional root drop
  return [...plus, ...tip, ...minus, ...rootGap];
}

/**
 * Build ONE internal (ring) tooth-SPACE cavity as a closed [[x,y], …] loop. For
 * an internal gear the teeth point INWARD; the material BETWEEN teeth is the
 * tooth space. We model the gear by cutting a polar ring of tooth-shaped solids
 * from the rim bore, so this loop is the tooth solid that gets removed — its
 * flanks are the involute of the internal gear's base circle, spanning from the
 * tip circle (Rp − m) outward to the root circle (Rp + 1.25·m).
 */
function internalToothLoop(g, phiDeg, flankSamples, backlash) {
  const m = g.module;
  const rb = g.baseR;
  const Ra = g.pitchR - m;         // internal tip radius (innermost)
  const Rf = g.pitchR + 1.25 * m;  // internal root radius (outermost)
  const rLo = Math.max(rb, Ra);
  const rHi = Rf;
  const n = Math.max(3, flankSamples | 0);

  const blAngle = backlash > 0 ? (backlash / 2) / g.pitchR : 0;
  // internal tooth thickness = space width of a meshing external gear ≈ π·m/2.
  const halfTooth = Math.PI / (2 * g.Z) + blAngle;
  const invAtPitch = involuteAngleAt(rb, g.pitchR);

  const plus = [];
  for (let i = 0; i <= n; i++) {
    const r = rLo + (rHi - rLo) * (i / n);
    const ang = halfTooth + (invAtPitch - involuteAngleAt(rb, r));
    plus.push([r * Math.cos(ang), r * Math.sin(ang)]);
  }
  const minus = plus.map(([x, y]) => [x, -y]).reverse();
  return [...plus, ...minus];
}

// ───────────────────────────────────────────────────────────────────────────
//  Dispatcher wrapper (shared ctx) — identical contract to turbofanBuilder.
// ───────────────────────────────────────────────────────────────────────────
function makeDispatcher(forge) {
  const ctx = { current: null };
  const log = [];
  async function call(name, args) {
    const res = await dispatchToolCall({ name, arguments: args }, { forge, ctx });
    log.push({ name, ok: res.ok, error: res.error || null });
    if (!res.ok) throw new Error(`forge verb '${name}' failed: ${res.error}`);
    return res.result || {};
  }
  async function shapeOf(name, args) {
    const r = await call(name, args);
    if (typeof r.shape !== 'number' || r.shape <= 0) {
      throw new Error(`forge verb '${name}' did not produce a solid handle (got ${JSON.stringify(r).slice(0, 120)})`);
    }
    return r.shape;
  }
  return { call, shapeOf, ctx, log };
}

// ───────────────────────────────────────────────────────────────────────────
//  Gear / part body builders (all through the bridge verbs)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build ONE external gear body (sun or planet): a solid disk blank to the ROOT
 * radius + a polar RING of Z extruded INVOLUTE teeth fused on, with a centre
 * bore. Returns the final single-body handle, centred on the origin, z∈[0,fw].
 */
async function buildExternalGear(d, p, g, { bore }) {
  const fw = p.faceWidth;
  // Disk blank (gear web) up to the root circle.
  let body = await d.shapeOf('part.make-cylinder', { radius: g.rootR, height: fw });

  // One involute tooth, extruded by the face width.
  const toothProf = externalToothLoop(g, p.pressureAngle, p.flankSamples, p.backlash);
  const tooth = await d.shapeOf('part.extrude', { profile: toothProf, distance: fw, dir: [0, 0, 1] });
  // Polar ring of Z teeth about +Z, fused onto the blank.
  const teethRing = await d.shapeOf('part.circular-pattern', {
    shape: tooth, count: g.Z, axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], totalAngleDeg: 360,
  });
  body = await d.shapeOf('part.fuse', { a: body, b: teethRing });

  // Centre bore (through).
  let drill = await d.shapeOf('part.make-cylinder', { radius: bore / 2, height: fw + 4 });
  drill = await d.shapeOf('part.translate', { shape: drill, dx: 0, dy: 0, dz: -2 });
  body = await d.shapeOf('part.cut', { a: body, b: drill });
  return body;
}

/**
 * Build the RING (internal/annulus) gear: an annular rim whose bore is the
 * internal-tip circle (Rp − m), with a polar ring of involute tooth-shaped
 * cavities cut into the bore wall. Returns one body, z∈[0, faceWidth].
 */
async function buildRingGear(d, p, g) {
  const fw = p.faceWidth;
  const tipR = g.pitchR - g.module;            // internal tip (bore) radius
  const outerR = g.pitchR + 1.25 * g.module + p.ringRimWidth; // OD past the root + rim
  // Annular rim: outer cylinder minus the bore to the internal-tip radius.
  let rim = await d.shapeOf('part.make-cylinder', { radius: outerR, height: fw });
  let boreCyl = await d.shapeOf('part.make-cylinder', { radius: tipR, height: fw + 4 });
  boreCyl = await d.shapeOf('part.translate', { shape: boreCyl, dx: 0, dy: 0, dz: -2 });
  let body = await d.shapeOf('part.cut', { a: rim, b: boreCyl });

  // Internal teeth: cut a polar ring of involute tooth solids from the bore wall.
  const cavProf = internalToothLoop(g, p.pressureAngle, p.flankSamples, p.backlash);
  let cav = await d.shapeOf('part.extrude', { profile: cavProf, distance: fw + 4, dir: [0, 0, 1] });
  cav = await d.shapeOf('part.translate', { shape: cav, dx: 0, dy: 0, dz: -2 });
  const cavRing = await d.shapeOf('part.circular-pattern', {
    shape: cav, count: g.Z, axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], totalAngleDeg: 360,
  });
  body = await d.shapeOf('part.cut', { a: body, b: cavRing });
  return { handle: body, outerR };
}

/**
 * Build a carrier cheek-plate centred on the origin, z∈[0, carrierPlateThk].
 * `withPins` fuses a polar ring of planet pins reaching across the gear face.
 * Returns the plate handle (uses the context verbs part.begin/subtract/finish
 * for the disk + bore, and part.pattern-feature for the pins).
 */
async function buildCarrierPlate(d, p, { plateR, carrierR, planetCount, withPins, pinLen, hubBore }) {
  await d.call('part.begin', { primitive: 'cylinder', diameter: 2 * plateR, depth: p.carrierPlateThk });
  if (hubBore && hubBore > 0) {
    await d.call('part.subtract', { primitive: 'cylinder', diameter: hubBore, depth: p.carrierPlateThk });
  }
  if (withPins && planetCount > 0 && pinLen > 0) {
    await d.call('part.pattern-feature', {
      primitive: 'cylinder', diameter: p.carrierPinDia, depth: pinLen,
      kind: 'polar', count: planetCount, bcd: 2 * carrierR, total_angle: 360, op: 'add',
    });
  }
  const r = await d.call('part.finish', {});
  return r.shape;
}

/**
 * Revolved annular tube (bearing race / housing shell), z∈[z0, z0+len]. The
 * profile is an [radius, z] rectangle revolved about +Z. The bridge's revolve
 * maps an axis-coplanar profile to a true solid of revolution; we pass the
 * profile in the XY sketch plane (x=radius, y=axial) and revolve about +Y so the
 * profile and the axis are coplanar, then it stands the tube up along +Z.
 */
async function buildTube(d, { rInner, rOuter, z0, len }) {
  // Revolve a solid annular ring as a cylinder difference (robust + simple):
  const outer = await d.shapeOf('part.make-cylinder', { radius: rOuter, height: len });
  let inner = await d.shapeOf('part.make-cylinder', { radius: rInner, height: len + 4 });
  inner = await d.shapeOf('part.translate', { shape: inner, dx: 0, dy: 0, dz: -2 });
  let tube = await d.shapeOf('part.cut', { a: outer, b: inner });
  if (z0) tube = await d.shapeOf('part.translate', { shape: tube, dx: 0, dy: 0, dz: z0 });
  return tube;
}

// ───────────────────────────────────────────────────────────────────────────
//  Main builder
// ───────────────────────────────────────────────────────────────────────────

/**
 * buildPlanetaryGearbox(forge, params?) → assembled epicyclic gear drive.
 *
 * @param {object} forge    headless or Electron Forge kernel facade
 * @param {object} [params] overrides merged over DEFAULT_PARAMS
 * @returns {Promise<{
 *   params, gearTrain, axialLayout, bodies, uniqueBodies, totalComponents,
 *   totalTriangles, assembledTriangles, bbox,
 *   assembly:{ uniqueBodies, instances, mates, solve, ratio, coherent }, verbLog
 * }>}
 */
export async function buildPlanetaryGearbox(forge, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const d = makeDispatcher(forge);

  // ── PARAMETRIC GEAR TRAIN — enforce the planetary tooth-count law ─────────
  // Zring is DERIVED from the coaxial-centre constraint; any caller-supplied
  // ringTeeth is ignored so the train is always physically realisable.
  const Zsun = Math.max(8, p.sunTeeth | 0);
  const Zplanet = Math.max(8, p.planetTeeth | 0);
  const N = Math.max(2, p.planetCount | 0);
  const Zring = Zsun + 2 * Zplanet;            // ENFORCED meshing constraint
  const ratio = 1 + Zring / Zsun;              // carrier-output reduction

  const sunG = gearGeom(p.module, Zsun, p.pressureAngle);
  const planetG = gearGeom(p.module, Zplanet, p.pressureAngle);
  const ringG = gearGeom(p.module, Zring, p.pressureAngle);
  // Carrier circle radius = sun pitch + planet pitch (= ring pitch − planet
  // pitch). The two expressions must agree → the three pitch circles are
  // mutually tangent (real meshing).
  const carrierR = sunG.pitchR + planetG.pitchR;
  const carrierRcheck = ringG.pitchR - planetG.pitchR;
  const meshTangencyOk = Math.abs(carrierR - carrierRcheck) < 1e-6;

  const gearTrain = {
    module: p.module, pressureAngle: p.pressureAngle,
    Zsun, Zplanet, Zring, planetCount: N,
    constraint: 'Zring = Zsun + 2·Zplanet',
    constraintHolds: Zring === Zsun + 2 * Zplanet,
    sunPitchR: sunG.pitchR, planetPitchR: planetG.pitchR, ringPitchR: ringG.pitchR,
    sunBaseR: sunG.baseR, planetBaseR: planetG.baseR, ringBaseR: ringG.baseR,
    carrierR, carrierRcheck, meshTangencyOk,
    ratio: Math.round(ratio * 1e4) / 1e4,
    ratioFormula: '1 + Zring/Zsun',
  };

  // ── Axial layout (z along the axis, housing front face at z=0) ────────────
  const z = {};
  const fw = p.faceWidth;
  z.frontCap = 0;
  z.carrierFront = z.frontCap + p.housingEndThk + p.bearingWidth + 4;
  z.gearPlane = z.carrierFront + p.carrierPlateThk + p.carrierPlateClear;
  z.carrierBack = z.gearPlane + fw + p.carrierPlateClear;
  z.backCap = z.carrierBack + p.carrierPlateThk + p.bearingWidth + 4;
  const totalLen = z.backCap + p.housingEndThk;

  // ── Build the UNIQUE bodies ───────────────────────────────────────────────
  const bodies = [];
  const addStatic = (name, handle, extra = {}) => {
    bodies.push({ name, handle, role: 'static', count: 1, transform: ident(), ...extra });
    return handle;
  };

  // 1. SUN GEAR (input) — seated at the gear plane.
  const sunRaw = await buildExternalGear(d, p, sunG, { bore: p.sunBore });
  const sun = await d.shapeOf('part.translate', { shape: sunRaw, dx: 0, dy: 0, dz: z.gearPlane });
  addStatic('sun_gear', sun, { teeth: Zsun, pitchR: sunG.pitchR });

  // 2. PLANET GEAR prototype — ONE body, instanced ×N on the carrier circle.
  const planetRaw = await buildExternalGear(d, p, planetG, { bore: p.planetBore });
  const planet = await d.shapeOf('part.translate', { shape: planetRaw, dx: 0, dy: 0, dz: z.gearPlane });
  bodies.push({
    name: 'planet_gear', handle: planet, role: 'planet', count: N,
    teeth: Zplanet, pitchR: planetG.pitchR,
  });

  // 3. RING (internal/annulus) GEAR — seated at the gear plane.
  const ringB = await buildRingGear(d, p, ringG);
  const ring = await d.shapeOf('part.translate', { shape: ringB.handle, dx: 0, dy: 0, dz: z.gearPlane });
  addStatic('ring_gear', ring, { teeth: Zring, pitchR: ringG.pitchR, outerR: ringB.outerR });

  // 4. CARRIER — front plate (carries the planet pins) + back plate (closes cage).
  const plateR = carrierR + p.carrierPinDia;   // plate spans just past the pins
  const pinLen = p.carrierPlateThk + p.carrierPlateClear + fw
    + p.carrierPlateClear + p.carrierPlateThk - 2;   // pin reaches across the gear
  const carrierFrontRaw = await buildCarrierPlate(d, p, {
    plateR, carrierR, planetCount: N, withPins: true, pinLen, hubBore: p.carrierHubBore,
  });
  const carrierFront = await d.shapeOf('part.translate', {
    shape: carrierFrontRaw, dx: 0, dy: 0, dz: z.carrierFront,
  });
  addStatic('carrier_front', carrierFront, { carrierR });

  const carrierBackRaw = await buildCarrierPlate(d, p, {
    plateR, carrierR, planetCount: N, withPins: false, pinLen: 0, hubBore: 0,
  });
  const carrierBack = await d.shapeOf('part.translate', {
    shape: carrierBackRaw, dx: 0, dy: 0, dz: z.carrierBack,
  });
  addStatic('carrier_back', carrierBack, { carrierR });

  // 5. INPUT SHAFT (drives the sun) — protrudes ahead of the front cap.
  const inputShaftRaw = await d.shapeOf('part.make-cylinder', {
    radius: p.inputShaftDia / 2, height: p.inputShaftLen,
  });
  const inputShaft = await d.shapeOf('part.translate', {
    shape: inputShaftRaw, dx: 0, dy: 0, dz: z.gearPlane + fw / 2 - p.inputShaftLen,
  });
  addStatic('input_shaft', inputShaft);

  // 6. OUTPUT SHAFT (driven by the carrier) — protrudes behind the back cap.
  const outputShaftRaw = await d.shapeOf('part.make-cylinder', {
    radius: p.outputShaftDia / 2, height: p.outputShaftLen,
  });
  const outputShaft = await d.shapeOf('part.translate', {
    shape: outputShaftRaw, dx: 0, dy: 0, dz: z.carrierBack + p.carrierPlateThk - 4,
  });
  addStatic('output_shaft', outputShaft);

  // 7. BEARINGS — annular races at the front (input) and back (output) shafts.
  const frontBearing = await buildTube(d, {
    rInner: p.inputShaftDia / 2, rOuter: p.inputShaftDia / 2 + p.bearingWall,
    z0: z.frontCap + p.housingEndThk + 2, len: p.bearingWidth,
  });
  addStatic('bearing_front', frontBearing);
  const backBearing = await buildTube(d, {
    rInner: p.outputShaftDia / 2, rOuter: p.outputShaftDia / 2 + p.bearingWall,
    z0: z.backCap - p.housingEndThk - p.bearingWidth - 2, len: p.bearingWidth,
  });
  addStatic('bearing_back', backBearing);

  // 8. HOUSING — cylindrical shell + front & back end caps.
  const housingBoreR = ringB.outerR + p.housingClear;
  const housingOuterR = housingBoreR + p.housingWall;
  const housingShell = await buildTube(d, {
    rInner: housingBoreR, rOuter: housingOuterR, z0: z.frontCap, len: totalLen,
  });
  addStatic('housing_shell', housingShell);

  // Front end cap: disk with the input-shaft clearance bore.
  await d.call('part.begin', { primitive: 'cylinder', diameter: 2 * housingOuterR, depth: p.housingEndThk });
  await d.call('part.subtract', { primitive: 'cylinder', diameter: p.inputShaftDia + 4, depth: p.housingEndThk });
  const frontCapR = await d.call('part.finish', {});
  const frontCap = await d.shapeOf('part.translate', { shape: frontCapR.shape, dx: 0, dy: 0, dz: z.frontCap });
  addStatic('housing_front_cap', frontCap);

  // Back end cap: disk with the output-shaft clearance bore.
  await d.call('part.begin', { primitive: 'cylinder', diameter: 2 * housingOuterR, depth: p.housingEndThk });
  await d.call('part.subtract', { primitive: 'cylinder', diameter: p.outputShaftDia + 4, depth: p.housingEndThk });
  const backCapR = await d.call('part.finish', {});
  const backCap = await d.shapeOf('part.translate', { shape: backCapR.shape, dx: 0, dy: 0, dz: z.backCap });
  addStatic('housing_back_cap', backCap);

  // ── Tessellate every UNIQUE body; assert triangles > 0; capture bbox/vol ──
  let totalTriangles = 0;
  for (const b of bodies) {
    const mesh = forge.tessellate(b.handle, p.tessLinear, p.tessAngular);
    const tris = mesh.triangleCount ?? (mesh.indices ? mesh.indices.length / 3 : 0);
    if (!tris || tris <= 0) throw new Error(`body '${b.name}' (handle ${b.handle}) tessellated to ZERO triangles`);
    let volume = null;
    try { const mp = forge.massProps(b.handle); volume = mp && typeof mp.volume === 'number' ? mp.volume : null; } catch { /* optional */ }
    const P = mesh.positions; let bbox = null;
    if (P && P.length) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
        const v = P[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v;
      }
      bbox = { min: mn, max: mx };
    }
    b.triangles = tris; b.vertices = P ? P.length / 3 : 0; b.volume = volume; b.bbox = bbox;
    totalTriangles += tris;
  }

  // ── ASSEMBLE — place every body; planets → polar ring of CLOCKED instances;
  //    then mate the coaxial bodies Concentric on the +Z axis. ──────────────
  const instances = [];
  let totalInstances = 0;
  for (const b of bodies) {
    if (b.role === 'planet') {
      const ids = [];
      for (let i = 0; i < N; i++) {
        const theta = (2 * Math.PI * i) / N;             // station angle on carrier
        const px = carrierR * Math.cos(theta), py = carrierR * Math.sin(theta);
        // Self-clock: a planet meshing with the sun must rotate about its own
        // axis by −(Zsun/Zplanet)·θ to stay in phase as it goes around; with
        // Zring = Zsun + 2·Zplanet this same clock keeps the ring mesh in phase.
        const clock = -(Zsun / Zplanet) * theta;
        const r = await d.call('assembly.add-instance', {
          shape: b.handle, transform: rotZtransl(clock, px, py, 0),
        });
        ids.push(r.instanceId);
      }
      b.instanceIds = ids; b.instanceId = ids[0]; totalInstances += ids.length;
    } else {
      const r = await d.call('assembly.add-instance', { shape: b.handle, transform: b.transform || ident() });
      b.instanceId = r.instanceId; b.instanceIds = [r.instanceId]; totalInstances += 1;
    }
    instances.push({ name: b.name, instanceId: b.instanceId, count: b.instanceIds.length });
  }

  // Fix the housing shell (ground), then mate every coaxial body Concentric to
  // it on the +Z axis (topo 1 = axis selector) — the coaxial relationship the
  // sun, ring, carriers, shafts and bearings share. Planets sit at off-axis
  // stations (their pitch circles mesh on-axis) so they are mated PARALLEL to
  // the sun axis instead of Concentric.
  const datumBody = bodies.find((b) => b.name === 'housing_shell') || bodies[0];
  const datum = datumBody.instanceId;
  await d.call('assembly.set-fixed', { instance: datum, fixed: true });
  const mates = [];
  const sunInst = bodies.find((b) => b.name === 'sun_gear').instanceId;
  for (const b of bodies) {
    if (b.instanceId === datum) continue;
    if (b.role === 'planet') {
      for (const pid of b.instanceIds) {
        const r = await d.call('assembly.add-mate', {
          kind: 'Parallel', instA: sunInst, topoA: 1, instB: pid, topoB: 1, value: 0,
        });
        mates.push({ a: 'sun_gear', b: 'planet_gear', mateId: r.mateId });
      }
      continue;
    }
    const r = await d.call('assembly.add-mate', {
      kind: 'Concentric', instA: datum, topoA: 1, instB: b.instanceId, topoB: 1, value: 0,
    });
    mates.push({ a: datumBody.name, b: b.name, mateId: r.mateId });
  }
  const solve = await d.call('assembly.solve', {});

  // World-space AABB over the whole assembled gearbox.
  const span = Math.max(housingOuterR, totalLen) * 2 + 300;
  const aabb = await d.call('assembly.query-aabb', {
    box: [-span, -span, -Math.max(span, totalLen) - 200, span, span, totalLen + 300],
  });

  // Assembly bbox from the unique-body meshes (planets expanded to their station).
  const asmMin = [Infinity, Infinity, Infinity], asmMax = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    if (!b.bbox) continue;
    if (b.role === 'planet') {
      const reach = carrierR + (b.pitchR + p.module);
      asmMin[0] = Math.min(asmMin[0], -reach); asmMax[0] = Math.max(asmMax[0], reach);
      asmMin[1] = Math.min(asmMin[1], -reach); asmMax[1] = Math.max(asmMax[1], reach);
      asmMin[2] = Math.min(asmMin[2], b.bbox.min[2]); asmMax[2] = Math.max(asmMax[2], b.bbox.max[2]);
    } else {
      for (let a = 0; a < 3; a++) {
        asmMin[a] = Math.min(asmMin[a], b.bbox.min[a]);
        asmMax[a] = Math.max(asmMax[a], b.bbox.max[a]);
      }
    }
  }
  const bbox = { min: asmMin, max: asmMax };

  // Triangles across the FULL assembled gearbox (planets counted ×N).
  let assembledTriangles = 0;
  for (const b of bodies) assembledTriangles += b.triangles * b.instanceIds.length;

  return {
    params: p,
    gearTrain,
    axialLayout: z,
    bodies: bodies.map((b) => ({
      name: b.name, handle: b.handle, role: b.role,
      instanceId: b.instanceId, instances: b.instanceIds.length,
      teeth: b.teeth ?? null, pitchR: b.pitchR ?? null,
      triangles: b.triangles, vertices: b.vertices, volume: b.volume, bbox: b.bbox,
    })),
    uniqueBodies: bodies.length,
    totalComponents: totalInstances,
    totalTriangles,
    assembledTriangles,
    bbox,
    assembly: {
      uniqueBodies: bodies.length,
      instances: totalInstances,
      mates: mates.length,
      mateList: mates,
      solve,
      aabbHits: aabb.hitCount,
      ratio: gearTrain.ratio,
      coherent: solve && solve.converged === true,
    },
    verbLog: d.log,
  };
}

export default buildPlanetaryGearbox;

// ───────────────────────────────────────────────────────────────────────────
//  VERB GAPS (precise, for bridging — what the current kernel verbs CAN'T do):
//   • No analytic INVOLUTE/SPLINE profile. part.extrude consumes straight
//     polylines, so each involute flank is a sampled polyline (vertices ON the
//     true involute, accurate to `flankSamples`), not a single analytic curve.
//     A `part.spline-extrude{profile:[{x,y,bulge}],…}` or a dedicated
//     `part.involute-gear{module,Z,phi,faceWidth,helix?}` verb would give exact
//     analytic flanks and root fillets. Tooth count / pitch / tip / root radii /
//     centre distances / mesh phase are EXACT today.
//   • No helical / herringbone teeth. part.sweep needs a polyline path; true
//     helical teeth need a helical guide curve. A `part.helical-extrude{
//     profile,height,turns}` would unlock helical & herringbone gears.
//   • No trochoidal ROOT FILLET (the true generated fillet a hob leaves at the
//     tooth root). Modelled here as a straight root land. A generation-based
//     `part.gear-root-fillet` verb would add it.
//   • No GEAR-MESH KINEMATIC mate. assembly.add-mate has no Gear kind, so the
//     planets are seated + clocked geometrically and mated Parallel, not driven
//     by a rolling-contact constraint. A `Gear` MateKind (ratio-coupled) would
//     let assembly.solve / simulate.dynamics-motion spin the train.
// ───────────────────────────────────────────────────────────────────────────
