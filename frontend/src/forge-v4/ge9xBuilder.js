// ge9xBuilder.js — FORGE FLAGSHIP: PARAMETRIC CFM LEAP-1A TURBOFAN (the demo engine)
// ============================================================================
// RE-TARGETED from the GE9X to the CFM International LEAP-1A — the A320neo
// powerplant and ArchDisc's demo engine. The LEAP-1A is a ~1.98 m-fan, ~11:1
// bypass, dual-spool high-bypass turbofan: SMALLER and SIMPLER than the GE9X
// (78 in vs 134 in fan; 18 vs 22 fan blades; 10-stage vs 11-stage HPC; 7-stage
// vs 6-stage LPT) — which makes it both EASIER to build accurately and more
// recognisable (its CHEVRON sawtooth exhaust + woven-CFRP fan are signatures).
//
// This module builds it as a FULLY PARAMETRIC assembly of a few-THOUSAND real
// components produced by ORGANIZED INSTANCING along the engine's true
// architecture — modules → stages → rows — NOT a confetti scatter.
//
//   • UNIQUE kernel B-rep BODIES stay ~tens (every blade / vane / bolt / nut /
//     cooling-hole plug / nozzle / panel / gear / ball / CHEVRON tooth is ONE
//     lofted/revolved/primitive prototype). The total is reached by INSTANCING
//     each prototype around its ring / bolt-circle / cooling-hole pattern with
//     O(1) assembly transforms (assembly.add-instance), exactly the way a real
//     engine is a few hundred part numbers replicated thousands of times.
//   • Memory stays bounded: a few-k instances ≈ tens of MB RSS, instancing is
//     ~µs each — there is NO per-instance boolean. A blade ring is N discrete
//     assembly components, the engineer-correct model.
//
// The engine axis is WORLD +X (length front→aft):
//   x=0 fan face → LPC booster (3) → HPC (10) → annular combustor → HPT (2) →
//   LPT (7) → CHEVRON exhaust nozzle + tail-cone plug.
// Radial directions are the YZ plane. Revolve profiles are [x_axial, r_radial]
// pairs revolved about +X; blades/vanes are lofted twisted airfoils whose span
// runs +Z then rotated radially to +Y, seated at the hub radius, and replicated
// about +X into a polar ring of discrete instances.
//
// EVERY dimension derives from a small headline parameter set (fanDiameter,
// bypassRatio, per-stage bladeCounts, stageCounts, module, coolingHolesPerBlade,
// boltsPerFlange, chevronCount). Change one and the whole engine + its
// components re-size and re-count coherently.
//
// Every verb goes through dispatchToolCall with a SHARED ctx — the exact call
// surface the Archie fleet was trained on (part.revolve / part.loft / part.cut /
// part.fuse / assembly.add-instance / assembly.add-mate / assembly.solve /
// query-aabb). No imports of external geometry; pure CUA.
//
// EXPORTS (back-compat kept):
//   buildLEAP1A / LEAP1A_SPEC / leap1aDerived   — the canonical LEAP-1A names
//   buildGE9X   / GE9X_SPEC   / ge9xDerived      — preserved ALIASES so existing
//                                                  importers + tests keep working
//   default = buildLEAP1A
//
// USAGE (headless — see forge-kernel/test/leap1a_shell_section_verify.mjs):
//   import { makeHeadlessForge } from '../../../forge-kernel/test/cadscore_harness.mjs';
//   import { buildLEAP1A } from './ge9xBuilder.js';
//   const forge = makeHeadlessForge();
//   const res = await buildLEAP1A(forge);   // ~few-k components; spec overridable
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;

// ───────────────────────────────────────────────────────────────────────────
//  CFM LEAP-1A FLAGSHIP SPEC — the headline parameter set the whole engine + its
//  components derive from. All linear dims in MILLIMETRES.
//  Tuned to the real LEAP-1A architecture (10× accuracy goal).
// ───────────────────────────────────────────────────────────────────────────
export const LEAP1A_SPEC = {
  // ── Overall envelope ──
  //   Real LEAP-1A: 78 in (1.98 m) fan tip Ø; basic engine length ~3.3 m fan
  //   face → core nozzle exit (the nacelle adds a little fwd/aft).
  fanDiameter: 1980,        // fan tip Ø ≈ 1.98 m (78 in) — the real LEAP-1A figure
  engineLength: 3300,       // fan face → core exhaust ≈ 3.3 m (nacelle ≈ +0.4 m)
  bypassRatio: 11,          // ≈ 11:1 — drives nacelle Ø + bypass-duct gap
  opr: 40,                  // overall pressure ratio ≈ 40 (HPC taper)
  hubTipRatio: 0.30,        // fan hub Ø / fan tip Ø
  module: 1.0,              // global blade/airfoil module (gear-style scale knob)

  // ── NACELLE OUTER SHELL (the recognizable turbofan exterior) ──
  //   The cowl-ON exterior is a chain of REVOLVED B-rep solids: a rounded inlet
  //   lip → fan cowl (max-Ø barrel) → core cowl (aft taper) → CHEVRON exhaust
  //   nozzle → tail cone (plug). Every dim derives from fanDiameter + bypassRatio.
  inletLipOverhang: 300,    // nacelle highlight plane ahead of the fan face (mm)
  inletLipRadius: 95,       // rounded-lip torus minor radius (mm) — the "fat" lip
  fanCowlWall: 120,         // fan-cowl shell wall thickness (mm)
  fanCowlCrestFrac: 0.30,   // crest (max-Ø) station as a fraction of cowl length
  nozzleConvergeFrac: 0.66, // convergent nozzle exit Ø / inlet Ø (core exhaust)
  tailConeLenFrac: 0.55,    // tail-cone (plug) length as a fraction of nozzle length
  trCascadeCount: 16,       // thrust-reverser cascade boxes (a hint ring on the cowl)

  // ── CHEVRON (sawtooth) EXHAUST NOZZLE — the LEAP signature ──
  //   The core-nozzle trailing edge carries a ring of triangular chevrons
  //   (sawtooth notches) cut from the exit. chevronCount notches, each a wedge
  //   reaching chevronDepth forward from the exit, chevronWidthFrac of the
  //   per-tooth angular pitch wide at the base.
  chevronCount: 18,         // number of sawtooth chevrons around the core nozzle
  chevronDepth: 120,        // axial depth each chevron notch cuts forward (mm)
  chevronWidthFrac: 0.55,   // notch base width as a fraction of per-tooth pitch

  // ── SECTION-CUT (cutaway display) ──
  //   section:true revolves the shell/casing bodies through sectionAngleDeg
  //   (default 180°) so the cowl context survives as a real half-shell B-rep
  //   while the internal spool stays fully visible — a museum-style cutaway.
  sectionAngleDeg: 180,     // half-revolve angle for sectioned shells/casings

  // ── Fan module ──
  fanBladeCount: 18,        // 18 swept WOVEN-CFRP (3-D woven RTM) fan blades
  ogvCount: 20,             // outlet guide vanes behind the fan

  // ── Booster / LP compressor (3 stages) ──
  lpcStages: 3,
  lpcBladesPerStage: 44,    // rotor blades per booster stage
  lpcVanesPerStage: 52,     // stator vanes per booster stage

  // ── HP compressor (10 stages — LEAP architecture) ──
  hpcStages: 10,
  hpcBladesPerStage: 54,
  hpcVanesPerStage: 64,

  // ── Combustor (annular, twin-annular pre-swirl / TAPS-derived) ──
  fuelNozzleCount: 18,      // fuel/air swirler nozzles (LEAP ≈ 18-19 injectors)
  swirlerCount: 18,         // one swirler per nozzle
  linerPanelCount: 32,      // CMC liner panels (ring of shingles)

  // ── HP turbine (2 stages) — the COOLING-HOLE dominant count ──
  hptStages: 2,
  hptBladesPerStage: 66,    // cooled rotor blades per stage
  hptNozzlesPerStage: 42,   // cooled nozzle guide vanes per stage
  coolingHolesPerBlade: 60, // film-cooling holes PER HPT blade (instanced) —
                            //   66×60×2 ≈ 7.9k holes, the dominant component count

  // ── LP turbine (7 stages — LEAP architecture) ──
  lptStages: 7,
  lptBladesPerStage: 84,
  lptVanesPerStage: 92,

  // ── Structural fasteners (bolt-circle pattern at every major flange) ──
  flangeCount: 24,          // structural flanges along the casing/discs
  boltsPerFlange: 48,       // bolts (each carries a mated nut) per flange

  // ── Rotating hardware ──
  bearingCount: 5,          // main bearings (each a ring of balls)
  ballsPerBearing: 20,      // rolling elements per bearing
  sealCount: 8,             // labyrinth/brush seal rings
  gearboxGearCount: 9,      // accessory gearbox gear train

  // ── Fidelity ──
  bladeStations: 5,         // loft cross-sections along the span
  tessLinear: 1.0,          // mm chord deflection (coarse — many bodies)
  tessAngular: 0.8,
};

// Back-compat ALIAS — the prior GE9X spec name now points at the LEAP-1A spec so
// existing importers (`GE9X_SPEC`) keep resolving. The headline numbers are the
// LEAP-1A's; override any field via buildGE9X(forge, { ...overrides }).
export const GE9X_SPEC = LEAP1A_SPEC;

// ───────────────────────────────────────────────────────────────────────────
//  Transform helpers (row-major 4×4)
// ───────────────────────────────────────────────────────────────────────────
function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

/** Rotation by `ang` rad about +X, then translation `x` along +X. */
function rotXtransX(ang, x) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [1, 0, 0, x, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

/**
 * Place an instance at engine station `x`, on a ring of radius `r`, at polar
 * angle `ang` (about +X), with an optional extra roll `roll` about +X applied
 * BEFORE the ring placement (so a blade keeps its own radial orientation while
 * sitting at angle `ang`). Row-major 4×4.
 *   p_world = Rx(ang) · (translate to radius r) · p_local
 */
function ringPlace(ang, r, x) {
  // local point is already modelled at radius (its hub seat) on +Y; we only need
  // to spin it about +X to angle `ang` and shift along +X to station `x`. The
  // radius `r` is baked into the prototype's local Y, so this is Rx(ang)+transX.
  return rotXtransX(ang, x);
}

/** Ring placement for a prototype modelled at the ORIGIN: spin to `ang`, push
 *  out to radius `r` along the rotated +Y, shift to station `x`. */
function ringPlaceAtRadius(ang, r, x) {
  const c = Math.cos(ang), s = Math.sin(ang);
  // R = Rx(ang); translation = R·[0, r, 0] then +x on X.
  return [1, 0, 0, x, 0, c, -s, c * r, 0, s, c, s * r, 0, 0, 0, 1];
}

/**
 * NACA-4-style symmetric airfoil, scaled to `chord`, staggered by `twistDeg`,
 * returned as a closed [[x,y], …] loop about the quarter-chord.
 */
function airfoilProfile(chord, thick, twistDeg) {
  const N = 14;
  const up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.1260 * t
      - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
    up.push([t, yt]); lo.push([t, -yt]);
  }
  const raw = [...up, ...lo.reverse().slice(1, -1)];
  const cr = Math.cos(twistDeg * DEG), sr = Math.sin(twistDeg * DEG);
  return raw.map(([x, y]) => {
    const X = (x - 0.25) * chord, Y = y * chord;
    return [X * cr - Y * sr, X * sr + Y * cr];
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  Dispatcher — every kernel verb through dispatchToolCall with a SHARED ctx,
//  surfacing real errors (no silent fallback). This IS the Archie call surface.
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
      throw new Error(`forge verb '${name}' produced no solid (got ${JSON.stringify(r).slice(0, 120)})`);
    }
    return r.shape;
  }
  return { call, shapeOf, ctx, log };
}

// ── Prototype geometry builders (each returns ONE unique kernel body) ────────

/** A single twisted, tapered airfoil prototype, oriented radially (+Y span),
 *  modelled at the ORIGIN (root at the origin, span outward +Y). The assembly
 *  later seats it at a hub radius via ringPlaceAtRadius. */
async function buildAirfoil(d, p, { chordRoot, chordTip, twistRoot, thick, span }) {
  const nStat = Math.max(2, p.bladeStations | 0);
  const sections = [];
  for (let i = 0; i < nStat; i++) {
    const f = i / (nStat - 1);
    const chord = (chordRoot + (chordTip - chordRoot) * f) * p.module;
    const twist = twistRoot * (1 - 0.66 * f);
    sections.push({ z: f * span, profile: airfoilProfile(chord, thick, twist) });
  }
  const spanZ = await d.shapeOf('part.loft', { sections, ruled: false });
  // span +Z → radial +Y so ring placement spins it cleanly about +X.
  return d.shapeOf('part.rotate', { shape: spanZ, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
}

/** Revolved annular disk/ring/casing/shaft (axial rectangle revolved about +X),
 *  modelled in WORLD coordinates on the axis. `angleDeg<360` yields a half-shell
 *  B-rep for the section-cut cutaway. */
async function buildAnnulus(d, { x0, x1, rInner, rOuter, angleDeg = 360 }) {
  const profile = [[x0, rInner], [x1, rInner], [x1, rOuter], [x0, rOuter]];
  return d.shapeOf('part.revolve', {
    profile, axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg,
  });
}

/** A hex-head bolt prototype at the ORIGIN: shank along +Y, head at the root. */
async function buildBolt(d, { shankD, shankLen, headD, headH }) {
  let head = await d.shapeOf('part.make-cylinder', { radius: headD / 2, height: headH });
  let shank = await d.shapeOf('part.make-cylinder', { radius: shankD / 2, height: shankLen });
  shank = await d.shapeOf('part.translate', { shape: shank, dx: 0, dy: 0, dz: headH });
  let bolt = await d.shapeOf('part.fuse', { a: head, b: shank });
  // stand it along +Y (radial) so ring placement is consistent with blades
  return d.shapeOf('part.rotate', { shape: bolt, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
}

/** A hex-nut prototype (ring with a bore) at the ORIGIN, along +Y. */
async function buildNut(d, { af, thick, bore }) {
  let nut = await d.shapeOf('part.make-cylinder', { radius: af / 2, height: thick });
  let hole = await d.shapeOf('part.make-cylinder', { radius: bore / 2, height: thick + 4 });
  hole = await d.shapeOf('part.translate', { shape: hole, dx: 0, dy: 0, dz: -2 });
  nut = await d.shapeOf('part.cut', { a: nut, b: hole });
  return d.shapeOf('part.rotate', { shape: nut, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
}

// ───────────────────────────────────────────────────────────────────────────
//  NACELLE OUTER SHELL — the recognizable turbofan exterior, as real REVOLVED
//  B-rep solids. Every body is a closed [x_axial, r_radial] loop revolved about
//  +X. When `angleDeg < 360` the SAME profiles yield a true HALF-SHELL B-rep
//  (the museum cutaway): the cowl context survives while the spool shows through.
//
//  The LEAP signature is the CHEVRON (sawtooth) core nozzle: the convergent
//  nozzle's trailing edge has a polar ring of triangular notches CUT into it.
//
//  Returns { lip, fanCowl, coreCowl, nozzle, tailCone, dims } — five tagged
//  bodies plus the derived stations used by the bypass-duct + reporting.
// ───────────────────────────────────────────────────────────────────────────
async function buildNacelleShell(d, s, k, fanTipR, x, angleDeg) {
  const axisOrigin = [0, 0, 0], axisDir = [1, 0, 0];
  const REV = (profile) => d.shapeOf('part.revolve', { profile, axisOrigin, axisDir, angleDeg });

  // Highlight plane (inlet lip) sits ahead of the fan face; the fan cowl is the
  // big bypass barrel; the core cowl tapers down to the nozzle; the nozzle is a
  // convergent annular duct (with CHEVRON teeth); the tail cone is the plug.
  const nacFront = x.fan - s.inletLipOverhang * k;
  const cowlInnerR = fanTipR + 60 * k;                 // inner cowl wall just outside the fan tips
  const wall = s.fanCowlWall * k;
  const crestR = cowlInnerR + wall + 80 * k * (s.bypassRatio / 11); // max-Ø swells with BPR
  const cowlAft = x.lptStart;                          // fan cowl trailing edge (fwd of the core)
  const cowlLen = cowlAft - nacFront;
  const crestX = nacFront + s.fanCowlCrestFrac * cowlLen;
  const lipR = s.inletLipRadius * k;

  // (1) ROUNDED INLET LIP — a forward torus-section: the fat aerodynamic lip
  //     that wraps the highlight. Profile is a rounded nose loop (front outer →
  //     crest of the lip → inner throat), giving the unmistakable "fat lip".
  const lip = await REV([
    [nacFront + lipR, cowlInnerR],                       // inner throat
    [nacFront + lipR * 0.18, cowlInnerR + lipR * 0.55],  // lower lip curve
    [nacFront, cowlInnerR + lipR * 1.15],                // highlight (forward-most)
    [nacFront + lipR * 0.55, cowlInnerR + lipR * 1.9],   // upper lip curve
    [nacFront + lipR * 1.6, cowlInnerR + lipR * 2.0],    // onto the cowl outer
    [nacFront + lipR * 1.6, cowlInnerR + lipR * 0.2],    // back to inner wall
  ]);

  // (2) FAN COWL — the big bypass barrel: inlet-lip plane → crest (max Ø) → aft
  //     fairing toward the core cowl. A thick revolved wall (outer − inner).
  const fanCowl = await REV([
    [nacFront + lipR * 1.5, cowlInnerR],                 // inner wall @ lip
    [nacFront + lipR * 1.5, cowlInnerR + lipR * 1.95],   // outer wall @ lip
    [crestX, crestR],                                    // crest outer (max Ø)
    [(crestX + cowlAft) / 2, crestR - 35 * k],           // mid outer
    [cowlAft, cowlInnerR + 130 * k],                     // aft outer (boat-tail)
    [cowlAft, cowlInnerR + 95 * k],                      // aft inner
    [(crestX + cowlAft) / 2, cowlInnerR + 25 * k],       // mid inner
    [crestX, cowlInnerR + 8 * k],                        // inner under crest
  ]);

  // (3) CORE COWL — aft fairing over the turbine core, tapering to the nozzle.
  const coreInR = s.coreOuterR ? s.coreOuterR : (480 * k / 2 + 100 * k);
  const coreCowlAft = x.exhaust - 110 * k;
  const coreCowl = await REV([
    [cowlAft - 50 * k, coreInR + 80 * k],                // fwd outer (under fan cowl TE)
    [(cowlAft + coreCowlAft) / 2, coreInR + 60 * k],     // mid outer
    [coreCowlAft, coreInR + 18 * k],                     // aft outer (tapered to nozzle)
    [coreCowlAft, coreInR],                              // aft inner
    [(cowlAft + coreCowlAft) / 2, coreInR + 18 * k],     // mid inner
    [cowlAft - 50 * k, coreInR + 35 * k],                // fwd inner
  ]);

  // (4) CHEVRON EXHAUST NOZZLE — the core gas-path exit: a CONVERGENT annular
  //     duct (exit Ø < inlet Ø) whose TRAILING EDGE carries the LEAP signature
  //     ring of triangular CHEVRON notches. We revolve the convergent duct, then
  //     CUT a polar ring of triangular wedges from the exit lip → the sawtooth.
  const nozIn = coreCowlAft, nozOut = x.exhaust;
  const nozInR = coreInR;
  const nozOutR = nozInR * s.nozzleConvergeFrac;
  const nozWall = 24 * k;
  let nozzle = await REV([
    [nozIn, nozInR],                                     // inlet inner
    [nozIn, nozInR + nozWall],                           // inlet outer
    [nozOut, nozOutR + nozWall * 0.7],                   // exit outer (converged)
    [nozOut, nozOutR],                                   // exit inner
  ]);

  // CHEVRON SAWTOOTH: cut N triangular notches from the nozzle exit edge. Each
  // cutter is a thin wedge spanning chevronWidthFrac of the per-tooth angular
  // pitch, reaching chevronDepth forward from the exit. Cutting them leaves the
  // alternating tooth/notch trailing edge characteristic of the LEAP-1A. Only
  // applied on a FULL (360°) nozzle; a sectioned half-nozzle skips it (the
  // half-shell would expose an open chevron cut). Tracked in dims.chevronCount.
  const nChev = Math.max(0, s.chevronCount | 0);
  let chevronsCut = 0;
  if (angleDeg >= 360 && nChev > 0) {
    const chevDepth = s.chevronDepth * k;
    const pitch = (2 * Math.PI) / nChev;
    const halfBase = pitch * s.chevronWidthFrac * 0.5;   // half-angle of the notch base
    const cutR0 = nozOutR + nozWall + 40 * k;            // cutter reaches well outside the wall
    for (let i = 0; i < nChev; i++) {
      const ang = i * pitch;
      // Triangular notch in the [x, r·θ] sense: a wedge that is wide (±halfBase)
      // at the exit plane (nozOut) and tapers to a point chevDepth forward
      // (nozOut − chevDepth). Built as a thin revolved triangle then placed by
      // the angular range — but a polar wedge cutter is simplest as a small box
      // rotated to the tooth angle, tall enough to clear the wall, with its tip
      // angled so the cut reads as a sawtooth. We use a triangular prism via a
      // revolve of a tiny [x,r] triangle over the notch's angular width.
      const cutter = await d.shapeOf('part.revolve', {
        // triangle in [x_axial, r] revolved over the notch's angular sweep:
        //   apex at (nozOut − chevDepth, exit r) → base spanning the exit plane.
        profile: [
          [nozOut - chevDepth, nozOutR - 5 * k],         // apex (forward, on the lip)
          [nozOut + 30 * k, nozOutR - 5 * k],            // base inner (aft, overhang)
          [nozOut + 30 * k, cutR0],                      // base outer (aft, overhang)
          [nozOut - chevDepth, cutR0],                   // apex outer
        ],
        axisOrigin, axisDir,
        angleDeg: (halfBase * 2) / DEG,                  // angular width of this notch
      });
      // Spin the wedge to the tooth angle (centre it on `ang`).
      const placed = await d.shapeOf('part.rotate', {
        shape: cutter, ax: 1, ay: 0, az: 0, angle: ang - halfBase,
      });
      nozzle = await d.shapeOf('part.cut', { a: nozzle, b: placed });
      chevronsCut++;
    }
  }

  // (5) TAIL CONE / EXHAUST PLUG — the central conical plug inside the nozzle.
  const plugLen = (nozOut - nozIn) * s.tailConeLenFrac + 200 * k;
  const plugR = nozOutR * 0.78;
  const tailCone = await REV([
    [nozIn - 110 * k, 0],                                // fwd apex on axis
    [nozIn - 110 * k, plugR * 0.6],
    [nozIn + plugLen * 0.45, plugR],                     // max plug Ø
    [nozIn + plugLen, plugR * 0.25],                     // aft taper
    [nozIn + plugLen, 0],                                // aft apex on axis
  ]);

  return {
    lip, fanCowl, coreCowl, nozzle, tailCone,
    dims: {
      nacFront, cowlInnerR, crestR, crestX, cowlAft,
      coreInR, coreCowlAft, nozIn, nozOut, nozInR, nozOutR, plugLen, plugR,
      maxR: crestR, chevronsCut, chevronCount: nChev,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Parametric spec → derived dimensions (everything below is a function of the
//  headline params; nothing is hard-coded downstream).
// ───────────────────────────────────────────────────────────────────────────
export function leap1aDerived(spec = {}) {
  const s = { ...LEAP1A_SPEC, ...spec };
  const k = s.fanDiameter / 1980;     // scale vs the LEAP-1A reference fan Ø
  const fanTipR = s.fanDiameter / 2;
  const fanHubR = (s.fanDiameter * s.hubTipRatio) / 2;
  // Core-flowpath ANNULUS radii (mm). A real turbofan core compresses through a
  // converging annulus: the booster/HPC tip Ø shrinks toward the combustor (rising
  // pressure, falling volume), then the turbine annulus re-expands toward the
  // exhaust. We model the hub line rising and the tip line falling so each stage's
  // mean radius is a smooth function of axial position — the geometric signature
  // of a real spool, not constant-radius rings. Radii scaled to the LEAP-1A core
  // (smaller than the GE9X; the LEAP core fits inside a ~0.48 m combustor casing).
  const core = {
    // booster (LPC) inlet/exit casing tip radii
    lpcTipIn: 560 * k / 2 + 24 * k, lpcTipOut: 480 * k / 2 + 24 * k,
    lpcHubIn: 280 * k / 2 + 48 * k, lpcHubOut: 330 * k / 2 + 48 * k,
    // HPC inlet/exit — strong taper (10 stages, OPR≈40)
    hpcTipIn: 440 * k / 2, hpcTipOut: 280 * k / 2,
    hpcHubIn: 300 * k / 2, hpcHubOut: 234 * k / 2,
    // combustor annulus
    combOuterR: 440 * k / 2, combInnerR: 234 * k / 2,
    // HPT re-expands the hot annulus
    hptHubIn: 234 * k / 2 + 48 * k, hptTipIn: 470 * k / 2,
    hptHubOut: 250 * k / 2 + 48 * k, hptTipOut: 520 * k / 2,
    // LPT grows toward the exhaust (low pressure, large volume)
    lptTipIn: 600 * k / 2, lptTipOut: 720 * k / 2,
    lptHubIn: 330 * k / 2 + 56 * k, lptHubOut: 410 * k / 2 + 56 * k,
  };
  return { s, k, fanTipR, fanHubR, core };
}

// Back-compat ALIAS — prior GE9X derived-dims helper now resolves the LEAP-1A.
export const ge9xDerived = leap1aDerived;

/** Linear interpolation helper for the flowpath taper (f∈[0,1]). */
function lerp(a, b, f) { return a + (b - a) * f; }

// ───────────────────────────────────────────────────────────────────────────
//  Main flagship builder
// ───────────────────────────────────────────────────────────────────────────
/**
 * buildLEAP1A(forge, spec?, opts?) → fully-assembled few-thousand-component
 * CFM LEAP-1A turbofan WITH a real revolved NACELLE OUTER SHELL (inlet lip +
 * fan cowl + core cowl + CHEVRON exhaust nozzle + tail-cone plug) and a
 * SECTION-CUT cutaway mode.
 *
 * @param {object} spec  headline parameter overrides (see LEAP1A_SPEC).
 * @param {object} opts  { section?:boolean, sectionAngleDeg?:number,
 *                         sectionGroups?:string[] } — when section:true the
 *   shell/casing groups are revolved through sectionAngleDeg (default 180°) so
 *   the cowl context survives as a half-shell B-rep while the internal spool
 *   shows through (a museum cutaway). sectionGroups picks WHICH groups section
 *   (default: nacelle + cowl + casing); everything else stays a full solid.
 *
 * @returns {Promise<{
 *   spec, derived, axialLayout, section,
 *   bodies: Array<{name, handle, role, group, triangles, vertices, volume, bbox}>,
 *   uniqueBodies: number,
 *   totalComponents: number,         // every assembly instance
 *   hierarchy: Array<{module, stages|rows}>,
 *   bbox: {min,max}, bboxMm: {x,y,z},
 *   assembly: {instances, mates, solve, aabbHits, coherent},
 *   shellBodies, sectionInfo, captureSets, verbLog,
 * }>}
 */
export async function buildLEAP1A(forge, spec = {}, opts = {}) {
  const { s, k, fanTipR, fanHubR, core } = leap1aDerived(spec);
  const d = makeDispatcher(forge);

  // ── SECTION-CUT control ─────────────────────────────────────────────────────
  // The cutaway is achieved by revolving the SHELL + CASING groups through a
  // partial angle (a true half-shell B-rep) instead of a full 360°. A solid
  // half-shell is faster + more robust than a boolean cut and reads identically
  // in a capture; the bypassDuct/coreCasing/combustor liner section the same way.
  const section = opts.section === true;
  const sectionAngleDeg = Math.max(20, Math.min(360, opts.sectionAngleDeg ?? s.sectionAngleDeg));
  const SECTIONABLE = new Set(opts.sectionGroups || ['nacelle', 'cowl', 'casing']);
  // Angle a given group is revolved at: sectionable groups get the half-angle in
  // section mode, everything else stays a full 360° solid.
  const angOf = (group) =>
    (section && SECTIONABLE.has(group)) ? sectionAngleDeg : 360;

  // ── axial layout (x front→aft) ─────────────────────────────────────────────
  // Axial pitches tuned so the fan-face → core-exhaust length lands near the real
  // LEAP-1A ~3.3 m: the LP turbine is the longest module (7 stages) so its pitch
  // is the dominant length lever. Inter-module gaps kept tight (real engines pack
  // the spool densely). The forward nacelle lip adds ~0.3 m to the full envelope.
  const x = { fan: 0 };
  x.fanDiskThk = Math.round(110 * k);
  x.ogv = x.fan + x.fanDiskThk + 150 * k;
  x.lpcStart = x.ogv + 120 * k;
  const lpcPitch = 100 * k;
  x.lpcEnd = x.lpcStart + (s.lpcStages - 1) * lpcPitch;
  x.hpcStart = x.lpcEnd + 150 * k;
  const hpcPitch = 78 * k;
  x.hpcEnd = x.hpcStart + (s.hpcStages - 1) * hpcPitch;
  x.combStart = x.hpcEnd + 120 * k;
  x.combLen = 280 * k;
  x.combEnd = x.combStart + x.combLen;
  x.hptStart = x.combEnd + 110 * k;
  const hptPitch = 130 * k;
  x.hptEnd = x.hptStart + (s.hptStages - 1) * hptPitch;
  x.lptStart = x.hptEnd + 150 * k;
  const lptPitch = 105 * k;
  x.lptEnd = x.lptStart + (s.lptStages - 1) * lptPitch;
  // Core exhaust ~3.3 m fan-face→exit (the LEAP-1A figure). engineLength is the
  // floor; the +220 margin is the nozzle/plug overhang past the last LPT stage.
  x.exhaust = Math.max(s.engineLength, x.lptEnd + 220 * k);

  // ── registries ─────────────────────────────────────────────────────────────
  const bodies = [];   // unique kernel bodies (the prototypes + statics)
  const placements = []; // { body, transform } — one per FINAL component instance
  const hierarchy = []; // labeled module → stages → rows tree (counts only)

  // group ∈ {spool, core, casing, cowl, nacelle, nozzle} — drives the cowl-on vs
  // cutaway capture sets AND which bodies the section-cut half-revolves.
  const addBody = (name, handle, role, group = 'spool') => {
    const b = { name, handle, role, group };
    bodies.push(b);
    return b;
  };
  const place = (body, transform) => { placements.push({ body, transform }); };

  // Replicate a prototype `body` into a polar RING of `count` components at
  // station `x`, seated at radius `r` (prototype modelled at origin along +Y).
  const ring = (body, count, r, station, phase = 0) => {
    const n = Math.max(1, count | 0);
    for (let i = 0; i < n; i++) {
      const ang = phase + (2 * Math.PI * i) / n;
      place(body, ringPlaceAtRadius(ang, r, station));
    }
    return n;
  };
  // Replicate a prototype already modelled in WORLD coords (statics/discs):
  // one identity instance.
  const placeStatic = (body) => { place(body, ident()); return 1; };

  // ════════════════════════════════════════════════════════════════════════
  //  1. FAN MODULE
  // ════════════════════════════════════════════════════════════════════════
  const fanMod = { module: 'fan', rows: {} };
  // fan disk (static, on axis)
  const fanDisk = addBody('fan_disk', await buildAnnulus(d, {
    x0: x.fan - x.fanDiskThk / 2, x1: x.fan + x.fanDiskThk / 2,
    rInner: Math.max(50, fanHubR * 0.4), rOuter: fanHubR,
  }), 'static');
  fanMod.rows.disk = placeStatic(fanDisk);
  // spinner (revolved cone-ish nose)
  const spinner = addBody('fan_spinner', await d.shapeOf('part.revolve', {
    profile: [[x.fan - 220 * k, 0], [x.fan - 24 * k, fanHubR * 0.55],
              [x.fan + 34 * k, fanHubR * 0.9], [x.fan + 34 * k, 0]],
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  }), 'static');
  fanMod.rows.spinner = placeStatic(spinner);
  // 18 swept WOVEN-CFRP fan blades (ring) — wide chord, high root twist
  const fanBladeProto = addBody('fan_blade_woven_cfrp', await buildAirfoil(d, s, {
    chordRoot: 280, chordTip: 170, twistRoot: 44, thick: 0.11, span: fanTipR - fanHubR,
  }), 'blade-proto');
  fanMod.rows.blades = ring(fanBladeProto, s.fanBladeCount, fanHubR, x.fan);
  // 18 blade platforms (ring of small boxes at the hub)
  const platProto = addBody('fan_platform', await (async () => {
    const w = 100 * k, ht = 34 * k, l = 240 * k;
    let b = await d.shapeOf('part.make-box', { dx: l, dy: ht, dz: w });
    b = await d.shapeOf('part.translate', { shape: b, dx: -l / 2, dy: 0, dz: -w / 2 });
    return b;
  })(), 'proto');
  fanMod.rows.platforms = ring(platProto, s.fanBladeCount, fanHubR - 26 * k, x.fan);
  // ~20 outlet guide vanes (ring behind the fan)
  const ogvProto = addBody('fan_ogv', await buildAirfoil(d, s, {
    chordRoot: 140, chordTip: 115, twistRoot: 18, thick: 0.08, span: fanTipR * 0.6 - fanHubR,
  }), 'vane-proto');
  fanMod.rows.ogvs = ring(ogvProto, s.ogvCount, fanHubR + 36 * k, x.ogv);
  // fan containment case (static revolved ring)
  const containment = addBody('fan_containment_case', await buildAnnulus(d, {
    x0: x.fan - 170 * k, x1: x.ogv + 100 * k,
    rInner: fanTipR + 34 * k, rOuter: fanTipR + 95 * k,
  }), 'static');
  fanMod.rows.containment = placeStatic(containment);
  hierarchy.push(fanMod);

  // ════════════════════════════════════════════════════════════════════════
  //  2. BOOSTER / LP COMPRESSOR (3 stages): blades + vanes per stage
  // ════════════════════════════════════════════════════════════════════════
  // One shared blade + one shared vane prototype for the whole booster (the
  // engineer-correct "one part number, many instances"); stages differ only in
  // radius/station, which live in the instance transforms.
  const lpcBladeProto = addBody('lpc_blade', await buildAirfoil(d, s, {
    chordRoot: 82, chordTip: 52, twistRoot: 30, thick: 0.10, span: 180 * k,
  }), 'blade-proto');
  const lpcVaneProto = addBody('lpc_vane', await buildAirfoil(d, s, {
    chordRoot: 70, chordTip: 52, twistRoot: 20, thick: 0.09, span: 160 * k,
  }), 'vane-proto');
  const lpcMod = { module: 'lpc_booster', stages: [] };
  for (let st = 0; st < s.lpcStages; st++) {
    const sx = x.lpcStart + st * lpcPitch;
    const f = s.lpcStages > 1 ? st / (s.lpcStages - 1) : 0;
    // booster hub line rises slightly as the annulus converges toward the HPC.
    const r = lerp(core.lpcHubIn, core.lpcHubOut, f);
    const nb = ring(lpcBladeProto, s.lpcBladesPerStage, r, sx);
    const nv = ring(lpcVaneProto, s.lpcVanesPerStage, r + 16 * k, sx + lpcPitch * 0.45);
    lpcMod.stages.push({ stage: st + 1, blades: nb, vanes: nv, hubR: Math.round(r) });
  }
  hierarchy.push(lpcMod);

  // ════════════════════════════════════════════════════════════════════════
  //  3. HP COMPRESSOR (10 stages): blades + vanes per stage
  // ════════════════════════════════════════════════════════════════════════
  const hpcBladeProto = addBody('hpc_blade', await buildAirfoil(d, s, {
    chordRoot: 60, chordTip: 36, twistRoot: 26, thick: 0.09, span: 120 * k,
  }), 'blade-proto');
  const hpcVaneProto = addBody('hpc_vane', await buildAirfoil(d, s, {
    chordRoot: 50, chordTip: 34, twistRoot: 18, thick: 0.08, span: 105 * k,
  }), 'vane-proto');
  const hpcMod = { module: 'hpc', stages: [] };
  for (let st = 0; st < s.hpcStages; st++) {
    const sx = x.hpcStart + st * hpcPitch;
    const f = s.hpcStages > 1 ? st / (s.hpcStages - 1) : 0;
    // HPC hub line RISES strongly as the tip line falls — the converging
    // high-pressure annulus (OPR≈40). Mean radius stays roughly constant; the
    // blade span (tip−hub) shrinks stage to stage, the real HPC signature.
    const r = lerp(core.hpcHubIn, core.hpcHubOut, f);
    const nb = ring(hpcBladeProto, s.hpcBladesPerStage, r, sx);
    const nv = ring(hpcVaneProto, s.hpcVanesPerStage, r + 12 * k, sx + hpcPitch * 0.45);
    hpcMod.stages.push({ stage: st + 1, blades: nb, vanes: nv, hubR: Math.round(r) });
  }
  hierarchy.push(hpcMod);

  // ════════════════════════════════════════════════════════════════════════
  //  4. COMBUSTOR (annular): liner + fuel nozzles + swirlers + liner panels
  // ════════════════════════════════════════════════════════════════════════
  const combOuterR = core.combOuterR, combInnerR = core.combInnerR;
  // The combustor liner is part of the core casing context → it sections too.
  const combAng = angOf('casing');
  const combLiner = addBody('combustor_liner', await d.shapeOf('part.fuse', {
    a: await buildAnnulus(d, { x0: x.combStart, x1: x.combEnd, rInner: combOuterR - 22 * k, rOuter: combOuterR, angleDeg: combAng }),
    b: await buildAnnulus(d, { x0: x.combStart + 26 * k, x1: x.combEnd - 26 * k, rInner: combInnerR, rOuter: combInnerR + 22 * k, angleDeg: combAng }),
  }), 'static', 'casing');
  const nozzleProto = addBody('fuel_nozzle', await (async () => {
    // a stubby cone + barrel, modelled at origin along +Y
    let barrel = await d.shapeOf('part.make-cylinder', { radius: 24 * k, height: 120 * k });
    let tip = await d.shapeOf('part.make-cone', { r1: 24 * k, r2: 10 * k, h: 44 * k });
    tip = await d.shapeOf('part.translate', { shape: tip, dx: 0, dy: 0, dz: 120 * k });
    let nz = await d.shapeOf('part.fuse', { a: barrel, b: tip });
    return d.shapeOf('part.rotate', { shape: nz, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
  })(), 'proto');
  const swirlerProto = addBody('combustor_swirler', await (async () => {
    let ring0 = await d.shapeOf('part.make-cylinder', { radius: 30 * k, height: 22 * k });
    let bore = await d.shapeOf('part.make-cylinder', { radius: 14 * k, height: 26 * k });
    bore = await d.shapeOf('part.translate', { shape: bore, dx: 0, dy: 0, dz: -2 });
    let sw = await d.shapeOf('part.cut', { a: ring0, b: bore });
    return d.shapeOf('part.rotate', { shape: sw, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
  })(), 'proto');
  const panelProto = addBody('combustor_liner_panel', await (async () => {
    const w = 60 * k, ht = 12 * k, l = 300 * k;
    let b = await d.shapeOf('part.make-box', { dx: l, dy: ht, dz: w });
    return d.shapeOf('part.translate', { shape: b, dx: x.combStart, dy: 0, dz: -w / 2 });
  })(), 'proto');
  const combMod = { module: 'combustor', rows: {} };
  combMod.rows.liner = placeStatic(combLiner);
  combMod.rows.fuelNozzles = ring(nozzleProto, s.fuelNozzleCount, combOuterR + 26 * k, x.combStart - 18 * k);
  combMod.rows.swirlers = ring(swirlerProto, s.swirlerCount, combOuterR - 52 * k, x.combStart + 8 * k);
  // liner panels: a ring of shingles around the outer liner (panel modelled in
  // world X already; ring spins it about +X and pushes out to the liner radius)
  combMod.rows.linerPanels = ring(panelProto, s.linerPanelCount, combOuterR - 34 * k, 0);
  hierarchy.push(combMod);

  // ════════════════════════════════════════════════════════════════════════
  //  5. HP TURBINE (2 stages): cooled blades (+ film-COOLING-HOLES) + nozzles
  //     — the COOLING HOLES are the dominant component count (~8k).
  // ════════════════════════════════════════════════════════════════════════
  const hptHubR = core.hptHubIn, hptTipR = core.hptTipIn;
  const hptBladeProto = addBody('hpt_blade', await buildAirfoil(d, s, {
    chordRoot: 95, chordTip: 70, twistRoot: 30, thick: 0.13, span: hptTipR - hptHubR,
  }), 'blade-proto');
  const hptNozzleProto = addBody('hpt_nozzle', await buildAirfoil(d, s, {
    chordRoot: 105, chordTip: 82, twistRoot: 24, thick: 0.14, span: hptTipR - hptHubR,
  }), 'vane-proto');
  // ONE film-cooling-hole prototype (a tiny cylinder) instanced thousands of
  // times along the blade leading/trailing edges. This single body is the
  // source of ~8k components — organized along each blade, not scattered.
  const coolHoleProto = addBody('hpt_cooling_hole', await (async () => {
    let c = await d.shapeOf('part.make-cylinder', { radius: 1.8 * k, height: 14 * k });
    return d.shapeOf('part.rotate', { shape: c, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2 });
  })(), 'proto');
  const hptMod = { module: 'hpt', stages: [] };
  for (let st = 0; st < s.hptStages; st++) {
    const sx = x.hptStart + st * hptPitch;
    const f = s.hptStages > 1 ? st / (s.hptStages - 1) : 0;
    // HPT annulus re-expands downstream of the combustor (hot, low-density gas).
    const hubR = lerp(core.hptHubIn, core.hptHubOut, f);
    const nb = ring(hptBladeProto, s.hptBladesPerStage, hubR, sx);
    const nn = ring(hptNozzleProto, s.hptNozzlesPerStage, hubR, sx - hptPitch * 0.4);
    // film-cooling holes: for EACH blade in the ring, lay coolingHolesPerBlade
    // holes up the span (organized rows along the airfoil), at the blade's angle.
    let nHoles = 0;
    const nBl = Math.max(1, s.hptBladesPerStage | 0);
    const nH = Math.max(1, s.coolingHolesPerBlade | 0);
    const tipR = lerp(core.hptTipIn, core.hptTipOut, f);
    const spanLo = hubR + 26 * k, spanHi = tipR - 26 * k;
    for (let bi = 0; bi < nBl; bi++) {
      const bAng = (2 * Math.PI * bi) / nBl;
      for (let hi = 0; hi < nH; hi++) {
        const fh = nH > 1 ? hi / (nH - 1) : 0;
        const rr = spanLo + (spanHi - spanLo) * fh;
        // two staggered columns (LE + TE) → slight angular offset per column
        const col = (hi % 2) ? +0.9 * DEG : -0.9 * DEG;
        place(coolHoleProto, ringPlaceAtRadius(bAng + col, rr, sx));
        nHoles++;
      }
    }
    hptMod.stages.push({ stage: st + 1, blades: nb, nozzles: nn, coolingHoles: nHoles, hubR: Math.round(hubR) });
  }
  hierarchy.push(hptMod);

  // ════════════════════════════════════════════════════════════════════════
  //  6. LP TURBINE (7 stages): blades + vanes per stage
  // ════════════════════════════════════════════════════════════════════════
  const lptBladeProto = addBody('lpt_blade', await buildAirfoil(d, s, {
    chordRoot: 110, chordTip: 82, twistRoot: 28, thick: 0.14, span: 220 * k,
  }), 'blade-proto');
  const lptVaneProto = addBody('lpt_vane', await buildAirfoil(d, s, {
    chordRoot: 95, chordTip: 78, twistRoot: 20, thick: 0.13, span: 195 * k,
  }), 'vane-proto');
  const lptMod = { module: 'lpt', stages: [] };
  for (let st = 0; st < s.lptStages; st++) {
    const sx = x.lptStart + st * lptPitch;
    const f = s.lptStages > 1 ? st / (s.lptStages - 1) : 0;
    // LPT annulus GROWS toward the exhaust (low pressure, large volume) — the
    // characteristic widening rear of a high-bypass engine.
    const r = lerp(core.lptHubIn, core.lptHubOut, f);
    const nb = ring(lptBladeProto, s.lptBladesPerStage, r, sx);
    const nv = ring(lptVaneProto, s.lptVanesPerStage, r + 14 * k, sx + lptPitch * 0.45);
    lptMod.stages.push({ stage: st + 1, blades: nb, vanes: nv, hubR: Math.round(r) });
  }
  hierarchy.push(lptMod);

  // ════════════════════════════════════════════════════════════════════════
  //  7. STRUCTURAL FASTENERS: bolts + nuts on a bolt-circle at every flange.
  // ════════════════════════════════════════════════════════════════════════
  const boltProto = addBody('flange_bolt', await buildBolt(d, {
    shankD: 14 * k, shankLen: 52 * k, headD: 22 * k, headH: 12 * k,
  }), 'proto');
  const nutProto = addBody('flange_nut', await buildNut(d, {
    af: 22 * k, thick: 12 * k, bore: 14 * k,
  }), 'proto');
  const fastMod = { module: 'fasteners', flanges: [] };
  const nFl = Math.max(1, s.flangeCount | 0);
  for (let fl = 0; fl < nFl; fl++) {
    // distribute flanges along the engine length at sensible casing radii.
    const f = nFl > 1 ? fl / (nFl - 1) : 0;
    const sx = x.fan + f * (x.exhaust - x.fan);
    const r = (combOuterR + 100 * k) + 70 * k * Math.sin(f * Math.PI); // bulge mid-engine
    const nB = ring(boltProto, s.boltsPerFlange, r, sx);
    const nN = ring(nutProto, s.boltsPerFlange, r, sx + 34 * k); // nut on the far face
    fastMod.flanges.push({ flange: fl + 1, bolts: nB, nuts: nN });
  }
  hierarchy.push(fastMod);

  // ════════════════════════════════════════════════════════════════════════
  //  8. ROTATING HARDWARE: shafts, bearings (ball rings), seals, gearbox gears.
  // ════════════════════════════════════════════════════════════════════════
  const rotMod = { module: 'rotating_hardware', rows: {} };
  // LP shaft (full length, solid) — the long, slim LP spool through the core
  const lpShaft = addBody('lp_shaft', await buildAnnulus(d, {
    x0: x.fan, x1: x.lptEnd, rInner: 0, rOuter: 120 * k / 2,
  }), 'static');
  rotMod.rows.lpShaft = placeStatic(lpShaft);
  // HP shaft (hollow tube around LP shaft) — the short, fat HP spool
  const hpShaft = addBody('hp_shaft', await buildAnnulus(d, {
    x0: x.hpcStart - 34 * k, x1: x.hptEnd + 34 * k,
    rInner: 200 * k / 2 - 26 * k, rOuter: 200 * k / 2,
  }), 'static');
  rotMod.rows.hpShaft = placeStatic(hpShaft);
  // ── CORE CASING (the inner static structure the cowls wrap) ──
  s.coreOuterR = combOuterR + 100 * k;       // shared with buildNacelleShell
  const coreCasing = addBody('core_casing', await buildAnnulus(d, {
    x0: x.lpcStart - 50 * k, x1: x.exhaust,
    rInner: combOuterR + 66 * k, rOuter: s.coreOuterR, angleDeg: angOf('casing'),
  }), 'static', 'casing');
  rotMod.rows.coreCasing = placeStatic(coreCasing);

  // ── BYPASS DUCT — sized by BYPASS RATIO ≈ 11:1. The annular fan-flow passage
  //    between the core casing OD and the fan-cowl inner wall. Its radial gap is
  //    proportional to √(BPR) so the bypass annulus AREA scales ~linearly with
  //    BPR (the engineer-correct sizing: more bypass air → more annulus area).
  const ductInnerR = s.coreOuterR + 18 * k;
  const bpGap = 200 * k * Math.sqrt(s.bypassRatio / 11);  // radial gap from BPR
  const bypassDuct = addBody('bypass_duct', await buildAnnulus(d, {
    x0: x.lpcStart, x1: x.lptStart - 34 * k,
    rInner: ductInnerR, rOuter: ductInnerR + bpGap, angleDeg: angOf('casing'),
  }), 'static', 'casing');
  rotMod.rows.bypassDuct = placeStatic(bypassDuct);

  // ── NACELLE OUTER SHELL — the recognizable turbofan exterior, as real
  //    revolved B-rep solids (inlet lip → fan cowl → core cowl → CHEVRON
  //    exhaust nozzle → tail-cone plug). Each is tagged so a capture can toggle
  //    cowl-ON (these visible) vs CUTAWAY (these half-revolved / hidden).
  const shell = await buildNacelleShell(d, s, k, fanTipR, x, angOf('nacelle'));
  const lipBody     = addBody('nacelle_inlet_lip', shell.lip, 'static', 'nacelle');
  const fanCowlBody = addBody('nacelle_fan_cowl',  shell.fanCowl, 'static', 'cowl');
  const coreCowlBody = addBody('nacelle_core_cowl', shell.coreCowl, 'static', 'cowl');
  const nozzleBody  = addBody('chevron_exhaust_nozzle', shell.nozzle, 'static', 'nozzle');
  const tailConeBody = addBody('exhaust_tail_cone', shell.tailCone, 'static', 'nozzle');
  rotMod.rows.inletLip = placeStatic(lipBody);
  rotMod.rows.fanCowl = placeStatic(fanCowlBody);
  rotMod.rows.coreCowl = placeStatic(coreCowlBody);
  rotMod.rows.chevronNozzle = placeStatic(nozzleBody);
  rotMod.rows.tailCone = placeStatic(tailConeBody);
  const shellBodyList = [lipBody, fanCowlBody, coreCowlBody, nozzleBody, tailConeBody];

  // ── THRUST-REVERSER CASCADE HINT — a ring of small boxes set into the aft fan
  //    cowl. A geometric HINT of the LEAP TR cascade vents (not a full mechanism);
  //    tagged 'cowl' so it follows the cowl-on / cutaway toggle with the skins.
  const trBoxProto = addBody('tr_cascade_box', await (async () => {
    const w = 70 * k, ht = 50 * k, l = 90 * k;
    let b = await d.shapeOf('part.make-box', { dx: l, dy: ht, dz: w });
    return d.shapeOf('part.translate', { shape: b, dx: 0, dy: 0, dz: -w / 2 });
  })(), 'proto', 'cowl');
  const trX = shell.dims.cowlAft - 120 * k;             // aft fan-cowl, fwd of the TE
  const trR = shell.dims.crestR - 60 * k;               // set into the cowl skin
  const nTR = ring(trBoxProto, s.trCascadeCount, trR, trX);
  rotMod.rows.trCascade = nTR;
  // bearings: each a ring of balls (one ball prototype, instanced per bearing)
  const ballProto = addBody('bearing_ball', await d.shapeOf('part.make-sphere', { radius: 12 * k }), 'proto');
  let nBalls = 0;
  const bearingStations = [];
  for (let bi = 0; bi < Math.max(1, s.bearingCount | 0); bi++) {
    const f = s.bearingCount > 1 ? bi / (s.bearingCount - 1) : 0;
    const sx = x.fan + 80 * k + f * (x.lptEnd - x.fan - 160 * k);
    bearingStations.push(sx);
    nBalls += ring(ballProto, s.ballsPerBearing, 95 * k, sx);
  }
  rotMod.rows.bearingBalls = nBalls;
  // seals: labyrinth seal rings (one knife-edge ring prototype, one per station)
  const sealProto = addBody('labyrinth_seal', await buildAnnulus(d, {
    x0: -7 * k, x1: 7 * k, rInner: 76 * k, rOuter: 94 * k,
  }), 'proto-world');
  let nSeals = 0;
  for (let si = 0; si < Math.max(1, s.sealCount | 0); si++) {
    const f = s.sealCount > 1 ? si / (s.sealCount - 1) : 0;
    const sx = x.hpcStart + f * (x.lptStart - x.hpcStart);
    place(sealProto, ident().map((v, i) => (i === 3 ? sx : v))); // translate +X to sx
    nSeals++;
  }
  rotMod.rows.seals = nSeals;
  // accessory gearbox gears: a small train of revolved gear blanks
  const gearProto = addBody('gearbox_gear', await d.shapeOf('part.make-cylinder', { radius: 58 * k, height: 26 * k }), 'proto');
  let nGears = 0;
  for (let gi = 0; gi < Math.max(1, s.gearboxGearCount | 0); gi++) {
    const ang = (2 * Math.PI * gi) / Math.max(1, s.gearboxGearCount);
    // gearbox sits below the core, behind the fan; lay gears on a small circle.
    const gx = x.lpcStart + 50 * k;
    const gr = combOuterR + 220 * k;
    place(gearProto, ringPlaceAtRadius(ang, gr, gx));
    nGears++;
  }
  rotMod.rows.gearboxGears = nGears;
  // structural discs (one per HPC/LPT/HPT stage) — revolved rims, instanced statically
  const discProto = addBody('rotor_disc', await buildAnnulus(d, {
    x0: -22 * k, x1: 22 * k, rInner: 76 * k, rOuter: 130 * k,
  }), 'proto-world');
  let nDiscs = 0;
  const discStations = [
    ...Array.from({ length: s.hpcStages }, (_, i) => x.hpcStart + i * hpcPitch),
    ...Array.from({ length: s.lptStages }, (_, i) => x.lptStart + i * lptPitch),
    ...Array.from({ length: s.hptStages }, (_, i) => x.hptStart + i * hptPitch),
  ];
  for (const sx of discStations) {
    place(discProto, ident().map((v, i) => (i === 3 ? sx : v)));
    nDiscs++;
  }
  rotMod.rows.discs = nDiscs;
  hierarchy.push(rotMod);

  // ── Tessellate every UNIQUE body; assert triangles > 0; capture bbox/volume ─
  let totalTriangles = 0;
  for (const b of bodies) {
    const m = forge.tessellate(b.handle, s.tessLinear, s.tessAngular);
    const tris = m.triangleCount ?? (m.indices ? m.indices.length / 3 : 0);
    if (!tris || tris <= 0) throw new Error(`body '${b.name}' tessellated to ZERO triangles`);
    let volume = null, bbox = null;
    try { const mp = forge.massProps(b.handle); volume = mp && typeof mp.volume === 'number' ? mp.volume : null; } catch { /* optional */ }
    const P = m.positions;
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

  // ── ASSEMBLE: emit EVERY component as a discrete assembly instance through
  //    assembly.add-instance. O(1) transforms, no booleans.
  // ─────────────────────────────────────────────────────────────────────────
  const firstInstanceOf = new Map();   // body → first instanceId (for mating)
  // Group every instance's world transform by its source body so the viewport
  // can render the FULL engine as one THREE.InstancedMesh per unique prototype
  // (every instance, not just the ~30 overlapping prototypes at the origin).
  const transformsByBody = new Map();  // body → Array<4×4 row-major transform>
  let totalComponents = 0;
  for (const pl of placements) {
    const r = await d.call('assembly.add-instance', {
      shape: pl.body.handle, transform: pl.transform,
    });
    if (!firstInstanceOf.has(pl.body)) firstInstanceOf.set(pl.body, r.instanceId);
    if (!transformsByBody.has(pl.body)) transformsByBody.set(pl.body, []);
    transformsByBody.get(pl.body).push(pl.transform);
    totalComponents++;
  }
  // Flatten to a render-friendly list: one entry per unique body, carrying its
  // kernel handle + every world transform (row-major 4×4). This is what the
  // flagship render helper (forgeFlagshipRender.renderAssemblyInstances) turns
  // into a per-body InstancedMesh so the assembled engine is visible.
  const assemblyInstances = [];
  for (const b of bodies) {
    const xforms = transformsByBody.get(b) || [];
    if (xforms.length) {
      assemblyInstances.push({ name: b.name, handle: b.handle, role: b.role,
                               group: b.group, transforms: xforms });
    }
  }

  // Fix the fan disk as datum, then mate ONE representative instance of every
  // OTHER unique body Concentric to it on the engine +X axis (records the
  // coaxial relationship the whole stack shares without N×(total) mate explosion).
  const datum = firstInstanceOf.get(fanDisk);
  await d.call('assembly.set-fixed', { instance: datum, fixed: true });
  const mates = [];
  for (const b of bodies) {
    if (b === fanDisk) continue;
    const inst = firstInstanceOf.get(b);
    if (inst == null) continue;
    const r = await d.call('assembly.add-mate', {
      kind: 'Concentric', instA: datum, topoA: 1, instB: inst, topoB: 1, value: 0,
    });
    mates.push({ a: fanDisk.name, b: b.name, mateId: r.mateId });
  }
  const solve = await d.call('assembly.solve', {});
  const aabb = await d.call('assembly.query-aabb', {
    box: [-10000, -10000, -10000, 10000, 10000, 10000],
  });

  // ── overall envelope from the per-instance AABBs is exact; approximate from
  //    the unique-body bboxes (each modelled at/around its world station). ────
  const env = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of bodies) {
    if (!b.bbox) continue;
    for (let a = 0; a < 3; a++) {
      env.min[a] = Math.min(env.min[a], b.bbox.min[a]);
      env.max[a] = Math.max(env.max[a], b.bbox.max[a]);
    }
  }
  // ring-placed prototypes sit at radius — their world envelope is ±(max ring
  // radius) in Y/Z and [fan..exhaust] in X. The cowl crest sets the max Ø; the
  // nacelle inlet lip sets the forward-most station. Use the true engine envelope.
  const maxR = shell.dims.crestR + 34 * k;
  const worldBbox = {
    min: [shell.dims.nacFront - 50 * k, -maxR, -maxR],
    max: [x.exhaust, maxR, maxR],
  };
  const bboxMm = {
    x: worldBbox.max[0] - worldBbox.min[0],
    y: worldBbox.max[1] - worldBbox.min[1],
    z: worldBbox.max[2] - worldBbox.min[2],
  };

  // ── VALIDITY of the new shell + sectioned bodies (real solids, not sheets) ──
  // checkValidity confirms each revolved shell/nozzle/cutaway body is a closed,
  // manifold, oriented solid — the gate that distinguishes a true B-rep from a
  // degenerate sheet. Reported so the harness can assert it. The chevron nozzle
  // is a boolean-cut body so it is checked here too.
  const shellNames = new Set([
    'nacelle_inlet_lip', 'nacelle_fan_cowl', 'nacelle_core_cowl',
    'chevron_exhaust_nozzle', 'exhaust_tail_cone', 'core_casing', 'bypass_duct', 'combustor_liner',
  ]);
  const shellValidity = [];
  for (const b of bodies) {
    if (!shellNames.has(b.name)) continue;
    let valid = null, vol = b.volume;
    try {
      const v = forge.heal && forge.heal.checkValidity ? forge.heal.checkValidity(b.handle) : null;
      if (v) {
        // badFaces/badEdges come back as an array OR an object map → count both.
        const badCount = (x) => Array.isArray(x) ? x.length
          : (x && typeof x === 'object') ? Object.keys(x).length : (Number(x) || 0);
        valid = !!v.isClosed && !!v.isManifold && !!v.isOriented &&
          !v.hasSelfIntersect && badCount(v.badFaces) === 0;
      }
    } catch { /* heal optional */ }
    shellValidity.push({ name: b.name, group: b.group, valid, solid: (vol || 0) > 0, volume: vol });
  }

  // ── COWL-ON vs CUTAWAY capture sets ─────────────────────────────────────────
  // The capture toggles the body GROUPS, not geometry: render the named groups
  // for each view. cowl-ON shows the full exterior (every group); CUTAWAY hides
  // the OUTER cowl skins so the spool/core read through, while in `section`
  // builds those skins are ALSO half-revolved B-reps so a sliver of cowl context
  // survives. Drive it from the render harness or window flag (see captureSets).
  const groupOf = (names) => bodies.filter((b) => names.has(b.group)).map((b) => b.name);
  const allGroups = ['spool', 'core', 'casing', 'cowl', 'nacelle', 'nozzle'];
  const captureSets = {
    // exterior — everything visible (the full nacelle look)
    cowlOn: {
      visibleGroups: allGroups,
      bodies: bodies.map((b) => b.name),
      note: 'full nacelle exterior: inlet lip + fan cowl + core cowl + chevron nozzle + tail cone',
    },
    // cutaway — hide the outer skins (cowl + nacelle), keep nozzle + everything
    // inside so the spool shows; in section:true the kept skins are half-shells.
    cutaway: {
      hiddenGroups: ['cowl', 'nacelle'],
      visibleGroups: ['spool', 'core', 'casing', 'nozzle'],
      bodies: groupOf(new Set(['spool', 'core', 'casing', 'nozzle'])),
      note: section
        ? 'section build: casing/combustor are half-shell B-reps → spool shows through with shell context'
        : 'full build: hide cowl+nacelle groups to reveal the internal spool',
    },
  };

  const sectionInfo = {
    enabled: section,
    angleDeg: section ? sectionAngleDeg : 360,
    sectionedGroups: section ? [...SECTIONABLE] : [],
    // The chevron sawtooth is only cut on a FULL (cowl-on) nozzle; a sectioned
    // half-nozzle skips the chevron cut (the half-shell would expose an open
    // notch). shell.dims.chevronsCut reflects how many were actually cut.
    chevronsCut: shell.dims.chevronsCut,
    chevronCount: shell.dims.chevronCount,
    // HOW TO DRIVE IT:
    //   • headless / programmatic: buildLEAP1A(forge, spec, { section:true,
    //       sectionAngleDeg:180, sectionGroups:['nacelle','cowl','casing'] })
    //   • render harness / window: set window.__leap1aSection = { on, angleDeg,
    //       groups } before the build, OR pick the capture set by GROUP
    //       visibility (captureSets.cowlOn vs captureSets.cutaway) at render time
    //       — body.group is on every assemblyInstances entry for instant masking.
    drive: {
      programmatic: "buildLEAP1A(forge, spec, { section:true, sectionAngleDeg:180 })",
      renderFlag: "window.__leap1aSection = { on:true, angleDeg:180, groups:['nacelle','cowl','casing'] }",
      captureToggle: "render captureSets.cowlOn.visibleGroups vs captureSets.cutaway.visibleGroups (mask by assemblyInstances[].group)",
    },
  };

  return {
    engine: 'CFM LEAP-1A',
    spec: s,
    derived: { k, fanTipR, fanHubR },
    axialLayout: x,
    section: sectionInfo,
    shellBodies: shellBodyList.map((b) => ({ name: b.name, handle: b.handle, group: b.group })),
    shellValidity,
    captureSets,
    bodies: bodies.map((b) => ({
      name: b.name, handle: b.handle, role: b.role, group: b.group,
      triangles: b.triangles, vertices: b.vertices, volume: b.volume, bbox: b.bbox,
    })),
    uniqueBodies: bodies.length,
    totalComponents,
    // Per-unique-body world transforms for every instance. The flagship render
    // helper consumes this to build one InstancedMesh per prototype so the FULL
    // engine (every blade ring / bolt circle / cooling-hole row) is visible in
    // the viewport — not just the overlapping origin prototypes.
    assemblyInstances,
    hierarchy,
    totalTriangles,
    bbox: worldBbox,
    bboxMm,
    bboxLocalUnion: env,
    assembly: {
      uniqueBodies: bodies.length,
      instances: totalComponents,
      mates: mates.length,
      mateList: mates,
      solve,
      aabbHits: aabb.hitCount,
      coherent: solve && solve.converged === true && aabb.hitCount === totalComponents,
    },
    verbLog: d.log,
    // camera/render guidance for the offline harness: bound to the engine,
    // hide gizmos, frame the full envelope.
    render: {
      bindToEngine: true,
      hideGizmos: true,
      target: [(worldBbox.min[0] + worldBbox.max[0]) / 2, 0, 0],
      fitRadius: maxR,
      axis: [1, 0, 0],
    },
  };
}

// Back-compat ALIAS — prior `buildGE9X(forge, spec, opts)` callers + tests now
// build the LEAP-1A. Same signature, same return shape (plus `engine` + chevron
// fields). The default export is the canonical LEAP-1A builder.
export const buildGE9X = buildLEAP1A;

export default buildLEAP1A;
