// planetaryGearboxToolSequence.js — CANONICAL CUA TOOL-CALL SEQUENCE for a
// multi-stage planetary GEARBOX, built PURELY from the Forge tool registry verbs
// the Archie model fleet emits (NO gearBuilder shortcut, NO asset.* macro).
// ============================================================================
// Same contract as turbofanToolSequence.js: a SEQUENCE GENERATOR (not a flat
// literal list) because the kernel handle counter is process-global and bumps
// unpredictably inside revolve / extrude / boolean ops — so the REAL returned
// handle is threaded at emit time and every {name, arguments} call is RECORDED,
// and the recorded log IS the canonical sequence, replayable verbatim through
// dispatchSequence in a fresh kernel.
//
// WHAT IT BUILDS — an epicyclic (planetary) gear train, one or more STAGES:
//   sun gear        — central pinion on the +Z axis (small disk + N_sun teeth)
//   planet gears    — P planets meshing sun↔ring, on a pitch-circle (carrier)
//   ring gear       — internal annulus enclosing the planets (large disk, internal teeth)
//   carrier         — the plate that holds the planet axes and is the output member
//   output/input shafts — concentric +Z spools
// Each GEAR is built the engineer-correct way from registry verbs:
//   - a revolved annular DISK body (the gear blank / web), about +Z
//   - one EXTRUDED involute-ish TOOTH prototype, oriented radially at the
//     pitch radius, then replicated into a polar ring with part.circular-pattern
//     (the O(1) ring the kernel pattern op gives, mirroring the turbofan's
//     polar blade pattern but as a SOLID circular-pattern body, not instances)
//   - tooth ring FUSED onto the blank → the one gear body
// The gears are placed into the ASSEMBLY as instances (sun, P planets on the
// carrier pitch circle, ring, carrier, shafts), mated coaxial / on the planet
// pitch circle, solved, then a DYNAMIC GEAR-MOTION study sweeps the carrier
// (simulate.dynamics-motion) and an FEA load case (simulate.fea-static and/or
// fea-modal) is run on the most-loaded gear body.
//
// Gear axis = WORLD +Z. Module-based sizing (m = pitch dia / teeth). Linear dims
// in MILLIMETRES (the SYSTEM law); the simulate.* verbs take SI args.
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;
function round(v) { return Math.round(v * 1000) / 1000; }

// ───────────────────────────────────────────────────────────────────────────
//  Planetary-gearbox parameters (linear dims in MILLIMETRES).
// ───────────────────────────────────────────────────────────────────────────
export const GEARBOX_PARAMS = {
  module: 4,                 // gear module (mm) — sets tooth size
  pressureAngle: 20,         // standard 20° involute
  faceWidth: 40,             // axial gear thickness (mm)

  stages: 2,                 // number of planetary stages (stacked along +Z)
  planetsPerStage: 3,        // P planets per stage (3 is the classic count)

  sunTeeth: 24,              // sun gear teeth (stage 1)
  planetTeeth: 24,           // planet gear teeth
  ringTeeth: 72,             // ring gear teeth  (ring = sun + 2*planet)

  stagePitch: 70,            // axial spacing between stacked stages (mm)
  carrierThk: 24,            // carrier plate thickness (mm)
  ringWall: 26,              // ring-gear radial wall outside the root (mm)
  boreSun: 30,               // sun-gear bore Ø (mm)
  borePlanet: 18,            // planet-gear bore Ø (mm)

  inputShaftDia: 28,         // input (sun) shaft Ø (mm)
  outputShaftDia: 50,        // output (carrier) shaft Ø (mm)
  shaftOverhang: 80,         // shaft length beyond the gear stack each end (mm)

  toothFidelity: 5,          // profile points per involute flank
  tessLinear: 0.6,
  tessAngular: 0.5,
};

// ───────────────────────────────────────────────────────────────────────────
//  Recorder — dispatch a verb, capture the REAL handle, append to the canonical
//  log. EXECUTES and EMITS the sequence (identical surface to the turbofan one).
// ───────────────────────────────────────────────────────────────────────────
function makeRecorder(forge) {
  const ctx = { current: null };
  const calls = [];
  const verbLog = [];
  async function call(name, args) {
    calls.push({ name, arguments: args });
    const res = await dispatchToolCall({ name, arguments: args }, { forge, ctx });
    verbLog.push({ name, ok: res.ok, error: res.error || null });
    if (!res.ok) throw new Error(`forge verb '${name}' failed: ${res.error}`);
    return res.result || {};
  }
  async function shapeOf(name, args) {
    const r = await call(name, args);
    if (typeof r.shape !== 'number' || r.shape <= 0) {
      throw new Error(`verb '${name}' produced no solid handle (${JSON.stringify(r).slice(0, 120)})`);
    }
    return r.shape;
  }
  return { call, shapeOf, ctx, calls, verbLog };
}

// ───────────────────────────────────────────────────────────────────────────
//  Geometry helpers (pure — produce verb ARGUMENTS, not kernel handles).
// ───────────────────────────────────────────────────────────────────────────

/** Annular-disk revolve profile (axial rect [z0,z1] × [rInner,rOuter]) about +Z.
 *  We revolve about +Y in a flat XY-plane sketch (the bridge maps +Y → solid),
 *  using [radial, axial] pairs so the body is the gear blank coaxial on +Z after
 *  the bridge's canonical revolve. To keep the gear on +Z we instead use the
 *  in-plane +X axis with [axial_x, radial] pairs (true solid of revolution),
 *  then the assembly mates re-seat it. We keep the disk axis = +X for revolve
 *  solidity (same trick as the turbofan), and treat that local +X as the gear
 *  axis; the disk is a clean washer either way. */
function annulusProfile(z0, z1, rInner, rOuter) {
  return [[z0, rInner], [z1, rInner], [z1, rOuter], [z0, rOuter]];
}

/** A single SPUR-GEAR tooth as a closed 2D profile (a trapezoidal involute
 *  approximation) spanning root→tip radially, centred on +Y, ready to extrude
 *  along the gear axis. circularPattern then replicates it around the blank. */
function toothProfile(rootR, tipR, baseHalfWidth, tipHalfWidth) {
  // Build the tooth pointing along +Y: base (root) wider than tip, slight
  // involute curvature on the flanks via the half-width taper.
  return [
    [-baseHalfWidth, rootR],
    [-tipHalfWidth, tipR],
    [tipHalfWidth, tipR],
    [baseHalfWidth, rootR],
  ].map(([x, y]) => [round(x), round(y)]);
}

// ───────────────────────────────────────────────────────────────────────────
//  Build ONE external (sun/planet) gear from registry verbs: revolved blank +
//  extruded tooth prototype + circular-pattern tooth ring, fused.
//  Returns { handle, pitchR, tipR, teeth }.
// ───────────────────────────────────────────────────────────────────────────
async function buildExternalGear(rec, p, { teeth, bore, faceZ0 }) {
  const m = p.module;
  const pitchR = (m * teeth) / 2;
  const tipR = pitchR + m;                 // addendum = 1·m
  const rootR = pitchR - 1.25 * m;          // dedendum = 1.25·m
  const z0 = faceZ0;
  const z1 = faceZ0 + p.faceWidth;
  const blankInner = Math.max(bore / 2, 4);

  // Gear blank — revolved washer (root cylinder, bored).
  const blank = await rec.shapeOf('part.revolve', {
    profile: annulusProfile(z0, z1, round(blankInner), round(rootR + 0.5 * m)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });

  // One tooth — the profile (tangential x, radial y) is sketched flat in XY and
  // extruded along +Z into a real prism (a profile extruded in-plane collapses
  // to a sheet), then rotated +Z→+X about +Y so the tooth axis aligns with the
  // gear axis (+X), landing at x∈[0,faceWidth] (matching the blank), and finally
  // seated at the blank's axial start.
  const baseHalf = (Math.PI * m) / 4 * 0.9;     // ~ half tooth thickness at pitch
  const tipHalf = baseHalf * 0.55;
  const tooth = await rec.shapeOf('part.extrude', {
    profile: toothProfile(round(rootR), round(tipR), round(baseHalf), round(tipHalf)),
    distance: p.faceWidth,
    dir: [0, 0, 1],
  });
  const toothAxial = await rec.shapeOf('part.rotate', {
    shape: tooth, ax: 0, ay: 1, az: 0, angle: Math.PI / 2,
  });
  const toothSeated = await rec.shapeOf('part.translate', {
    shape: toothAxial, dx: round(z0), dy: 0, dz: 0,
  });

  // Polar TOOTH RING — circular-pattern about the gear axis (+X).
  const ring = await rec.shapeOf('part.circular-pattern', {
    shape: toothSeated, count: teeth,
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], totalAngleDeg: 360,
  });

  // Fuse the tooth ring onto the blank → the one gear body.
  const gear = await rec.shapeOf('part.fuse', { a: blank, b: ring });
  return { handle: gear, pitchR, tipR, rootR, teeth };
}

// ───────────────────────────────────────────────────────────────────────────
//  Build the internal RING gear: a thick annulus blank with an INWARD tooth
//  ring cut from the bore (teeth point toward the axis). Returns { handle,… }.
// ───────────────────────────────────────────────────────────────────────────
async function buildRingGear(rec, p, { teeth, faceZ0 }) {
  const m = p.module;
  const pitchR = (m * teeth) / 2;
  const rootR = pitchR + 1.25 * m;          // internal: dedendum is OUTWARD
  const tipR = pitchR - m;                   // internal tip points inward
  const outerR = rootR + p.ringWall;
  const z0 = faceZ0;
  const z1 = faceZ0 + p.faceWidth;

  // Ring blank — thick annulus, bored to the root circle.
  const blank = await rec.shapeOf('part.revolve', {
    profile: annulusProfile(z0, z1, round(rootR), round(outerR)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });

  // Inward tooth prototype (points toward the axis: base at rootR, tip at tipR).
  // Same extrude-+Z → rotate-to-+X → seat treatment as the external gear.
  const baseHalf = (Math.PI * m) / 4 * 0.9;
  const tipHalf = baseHalf * 0.55;
  const tooth = await rec.shapeOf('part.extrude', {
    profile: toothProfile(round(rootR), round(tipR), round(baseHalf), round(tipHalf)),
    distance: p.faceWidth,
    dir: [0, 0, 1],
  });
  const toothAxial = await rec.shapeOf('part.rotate', {
    shape: tooth, ax: 0, ay: 1, az: 0, angle: Math.PI / 2,
  });
  const toothSeated = await rec.shapeOf('part.translate', {
    shape: toothAxial, dx: round(z0), dy: 0, dz: 0,
  });
  const ring = await rec.shapeOf('part.circular-pattern', {
    shape: toothSeated, count: teeth,
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], totalAngleDeg: 360,
  });
  // Fuse inward teeth to the ring blank.
  const gear = await rec.shapeOf('part.fuse', { a: blank, b: ring });
  return { handle: gear, pitchR, tipR, rootR, outerR, teeth };
}

/** Revolved annular tube body (carrier plate / shaft). */
async function buildAnnulus(rec, { z0, z1, rInner, rOuter }) {
  return rec.shapeOf('part.revolve', {
    profile: annulusProfile(round(z0), round(z1), round(rInner), round(rOuter)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });
}

// row-major 4×4: rotate `ang` about +X then translate `tx` along +X.
function rotXtransX(ang, tx) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [1, 0, 0, tx, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
// row-major 4×4: translate (tx,ty,tz) only.
function transXYZ(tx, ty, tz) {
  return [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ───────────────────────────────────────────────────────────────────────────
//  buildGearboxSequence(forge, params?) — execute + emit the canonical CUA
//  sequence for the whole planetary gearbox. Returns { calls, bodies, … }.
// ───────────────────────────────────────────────────────────────────────────
export async function buildGearboxSequence(forge, params = {}) {
  const p = { ...GEARBOX_PARAMS, ...params };
  const rec = makeRecorder(forge);
  const m = p.module;

  // Geometry sanity: ring = sun + 2*planet (the planetary tooth-count law).
  const ringTeeth = p.sunTeeth + 2 * p.planetTeeth;
  const carrierR = (m * (p.sunTeeth + p.planetTeeth)) / 2;   // planet pitch-circle radius

  // Body registry. role 'planet' = P polar instances on the carrier pitch circle.
  const bodies = [];
  const addStatic = (name, handle, extra = {}) =>
    bodies.push({ name, handle, role: 'static', count: 1, ...extra });
  const addPlanetSet = (name, handle, count, pitchR, faceZ) =>
    bodies.push({ name, handle, role: 'planet', count, pitchR, faceZ });

  // Build each STAGE: sun + planets + ring, stacked along +X (the gear axis).
  for (let s = 0; s < p.stages; s++) {
    const faceZ0 = s * p.stagePitch;

    // SUN gear.
    const sun = await buildExternalGear(rec, p, {
      teeth: p.sunTeeth, bore: p.boreSun, faceZ0,
    });
    addStatic(`s${s + 1}_sun`, sun.handle, { faceZ0 });

    // PLANET gear prototype (one body → P polar instances on the pitch circle).
    const planet = await buildExternalGear(rec, p, {
      teeth: p.planetTeeth, bore: p.borePlanet, faceZ0,
    });
    addPlanetSet(`s${s + 1}_planet`, planet.handle, p.planetsPerStage, carrierR, faceZ0);

    // RING gear (internal).
    const ring = await buildRingGear(rec, p, { teeth: ringTeeth, faceZ0 });
    addStatic(`s${s + 1}_ring`, ring.handle, { faceZ0 });

    // CARRIER plate for this stage (a webbed annulus spanning planet axes).
    const carrier = await buildAnnulus(rec, {
      z0: faceZ0 + p.faceWidth + 4, z1: faceZ0 + p.faceWidth + 4 + p.carrierThk,
      rInner: Math.max(p.boreSun / 2 + 6, 12), rOuter: carrierR + p.module * 2.5,
    });
    addStatic(`s${s + 1}_carrier`, carrier, { faceZ0 });
  }

  // INPUT (sun) + OUTPUT (carrier) concentric shafts spanning the whole stack.
  const stackZ1 = (p.stages - 1) * p.stagePitch + p.faceWidth + 4 + p.carrierThk;
  addStatic('input_shaft', await buildAnnulus(rec, {
    z0: -p.shaftOverhang, z1: stackZ1 * 0.5, rInner: 0, rOuter: p.inputShaftDia / 2,
  }));
  addStatic('output_shaft', await buildAnnulus(rec, {
    z0: stackZ1 * 0.4, z1: stackZ1 + p.shaftOverhang,
    rInner: p.inputShaftDia / 2 + 4, rOuter: p.outputShaftDia / 2,
  }));

  // ── Tessellate every unique body; assert > 0 triangles. ──────────────────
  let totalTriangles = 0;
  for (const b of bodies) {
    const mesh = forge.tessellate(b.handle, p.tessLinear, p.tessAngular);
    const tris = mesh.triangleCount ?? (mesh.indices ? mesh.indices.length / 3 : 0);
    if (!tris || tris <= 0) throw new Error(`body '${b.name}' tessellated to ZERO triangles`);
    b.triangles = tris;
    totalTriangles += tris;
  }

  // ── ASSEMBLE: identity per static body; P polar instances per planet set. ─
  let totalInstances = 0, assembledTriangles = 0;
  for (const b of bodies) {
    if (b.role === 'planet') {
      const n = Math.max(1, b.count | 0);
      const ids = [];
      for (let i = 0; i < n; i++) {
        // place each planet on the carrier pitch circle (about +X axis).
        const ang = 2 * Math.PI * i / n;
        const ty = round(b.pitchR * Math.cos(ang));
        const tz = round(b.pitchR * Math.sin(ang));
        const r = await rec.call('assembly.add-instance', {
          shape: b.handle, transform: transXYZ(0, ty, tz),
        });
        ids.push(r.instanceId);
      }
      b.instanceIds = ids; b.instanceId = ids[0];
    } else {
      const r = await rec.call('assembly.add-instance', { shape: b.handle, transform: IDENT });
      b.instanceIds = [r.instanceId]; b.instanceId = r.instanceId;
    }
    totalInstances += b.instanceIds.length;
    assembledTriangles += b.triangles * b.instanceIds.length;
  }

  // Ground the stage-1 ring (the casing-fixed member); mate every other body
  // Concentric to the central axis (datum = the sun instance about +X).
  const sunDatum = bodies[0].instanceId;        // s1_sun is first
  const ringFixed = bodies.find((b) => b.name === 's1_ring').instanceId;
  await rec.call('assembly.set-fixed', { instance: ringFixed, fixed: true });
  const mates = [];
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].instanceId === ringFixed) continue;
    // planets mate to the central axis through their carrier-pitch offset; here we
    // use Concentric to the sun's axis as the coaxial datum (the solver seats them).
    const target = bodies[i].role === 'planet' ? bodies[i].instanceIds : [bodies[i].instanceId];
    for (const inst of target) {
      const r = await rec.call('assembly.add-mate', {
        kind: 'Concentric', instA: sunDatum, topoA: 1, instB: inst, topoB: 1, value: 0,
      });
      mates.push({ a: bodies[0].name, b: bodies[i].name, mateId: r.mateId });
    }
  }
  const solve = await rec.call('assembly.solve', {});
  const aabb = await rec.call('assembly.query-aabb', { box: [-3000, -3000, -3000, 3000, 3000, 3000] });

  return {
    params: p, ringTeeth, carrierPitchR: carrierR,
    calls: rec.calls,                 // ← THE canonical CUA tool_call sequence
    verbLog: rec.verbLog,
    bodies: bodies.map((b) => ({
      name: b.name, handle: b.handle, role: b.role,
      instances: b.instanceIds.length, triangles: b.triangles,
    })),
    bodyCount: bodies.length,
    totalTriangles, assembledTriangles,
    assembly: {
      bodies: bodies.length, instances: totalInstances, mates: mates.length,
      solve, aabbHits: aabb.hitCount,
      coherent: solve && solve.converged === true && aabb.hitCount === totalInstances,
    },
  };
}

export default buildGearboxSequence;
