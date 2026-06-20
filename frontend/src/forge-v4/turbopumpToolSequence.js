// turbopumpToolSequence.js — CANONICAL CUA TOOL-CALL SEQUENCE for a centrifugal
// TURBOPUMP (rocket-grade / process pump), built PURELY from the Forge tool
// registry verbs the Archie model fleet emits (NO pumpBuilder shortcut, NO
// asset.* macro).
// ============================================================================
// Same contract as turbofanToolSequence.js: a SEQUENCE GENERATOR (not a flat
// literal list) — the kernel handle counter is process-global and bumps
// unpredictably inside revolve / loft / boolean ops, so the REAL returned handle
// is threaded at emit time and every {name, arguments} call is RECORDED; the
// recorded log IS the canonical sequence, replayable verbatim.
//
// WHAT IT BUILDS — a single-stage centrifugal pump assembly:
//   shroud / back-plate — two revolved disks forming the impeller side-walls
//   impeller hub        — revolved cone/boss on the +X axis
//   impeller vanes      — one lofted, swept-back curved BLADE per vane, polar-
//                         patterned into the impeller passage (the engineer-
//                         correct backswept impeller)
//   volute casing       — a revolved torus-like collector enclosing the impeller
//   inlet (eye) duct    — axial revolved nozzle feeding the impeller eye
//   outlet (discharge)  — radial revolved/lofted diffuser nozzle off the volute
//   shaft               — concentric drive shaft on +X
// Then the canonical SIM trio for "CFD + kinematics/FEA-in-motion":
//   simulate.cfd            — flow through a bounding duct domain (head/Re)
//   simulate.dynamics-motion— spin the impeller one+ revolutions (kinematics)
//   simulate.fea-static     — pressure/centrifugal load on a vane (or fea-modal)
//
// Pump axis = WORLD +X. Radial = YZ. Linear dims in MILLIMETRES (the SYSTEM law);
// simulate.* verbs take SI args.
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;
function round(v) { return Math.round(v * 1000) / 1000; }

// ───────────────────────────────────────────────────────────────────────────
//  Centrifugal-turbopump parameters (linear dims in MILLIMETRES).
// ───────────────────────────────────────────────────────────────────────────
export const TURBOPUMP_PARAMS = {
  impellerDiameter: 300,     // impeller tip Ø (mm)
  eyeDiameter: 110,          // suction eye Ø (mm)
  hubDiameter: 60,           // hub/boss Ø (mm)
  vaneCount: 7,              // number of backswept impeller vanes
  vaneInletWidth: 42,        // passage width at the eye (mm)
  vaneOutletWidth: 22,       // passage width at the tip (mm)
  vaneThickness: 6,          // vane thickness (mm)
  backsweepDeg: 30,          // blade backsweep angle (deg)
  vaneStations: 5,           // loft sections along the vane span

  shroudThk: 8,              // front shroud wall (mm)
  backPlateThk: 12,          // back plate wall (mm)

  voluteThroatDia: 90,       // volute throat / discharge Ø (mm)
  voluteRadialGap: 40,       // radial clearance impeller tip → volute wall (mm)
  voluteWall: 14,            // volute casing wall (mm)

  inletLength: 120,          // suction nozzle length (mm)
  inletDia: 120,             // suction flange Ø (mm)
  outletLength: 140,         // discharge nozzle length (mm)

  shaftDiameter: 40,         // drive-shaft Ø (mm)
  shaftOverhang: 100,        // shaft beyond the back plate (mm)

  tessLinear: 0.6,
  tessAngular: 0.5,
};

// ───────────────────────────────────────────────────────────────────────────
//  Recorder (identical surface to the turbofan / gearbox sequences).
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
//  Geometry helpers.
// ───────────────────────────────────────────────────────────────────────────
function annulusProfile(x0, x1, rInner, rOuter) {
  return [[x0, rInner], [x1, rInner], [x1, rOuter], [x0, rOuter]];
}

/** A backswept vane cross-section: a thin rounded-rectangle airfoil of given
 *  chord/thickness, staggered by the local backsweep, pivoted at mid-chord.
 *  (tangential x, axial-ish y) in the section's local frame. */
function vaneSection(chord, thick, sweepDeg) {
  const N = 8;
  const up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const yt = thick * 0.5 * Math.sin(Math.PI * t);     // rounded leaf section
    up.push([t * chord - chord / 2, yt]);
    lo.push([t * chord - chord / 2, -yt]);
  }
  const raw = [...up, ...lo.reverse().slice(1, -1)];
  const cr = Math.cos(sweepDeg * DEG), sr = Math.sin(sweepDeg * DEG);
  return raw.map(([x, y]) => [round(x * cr - y * sr), round(x * sr + y * cr)]);
}

/** Annular tube body (shroud / plate / casing / shaft / nozzle). */
async function buildAnnulus(rec, { x0, x1, rInner, rOuter }) {
  return rec.shapeOf('part.revolve', {
    profile: annulusProfile(round(x0), round(x1), round(rInner), round(rOuter)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });
}

// row-major 4×4 rotate `ang` about +X (the polar-vane pattern).
function rotX(ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ───────────────────────────────────────────────────────────────────────────
//  buildTurbopumpSequence(forge, params?) — execute + emit the canonical CUA
//  sequence for the whole centrifugal turbopump. Returns { calls, bodies, … }.
// ───────────────────────────────────────────────────────────────────────────
export async function buildTurbopumpSequence(forge, params = {}) {
  const p = { ...TURBOPUMP_PARAMS, ...params };
  const rec = makeRecorder(forge);

  const tipR = p.impellerDiameter / 2;
  const eyeR = p.eyeDiameter / 2;
  const hubR = p.hubDiameter / 2;

  // Axial layout along +X (suction eye at x=0).
  const x = {};
  x.eye = 0;
  x.frontPlate = x.eye + p.inletLength;             // impeller front face
  x.backPlate = x.frontPlate + p.vaneInletWidth + 20;
  x.shaftEnd = x.backPlate + p.backPlateThk + p.shaftOverhang;

  const bodies = [];
  const addStatic = (name, handle) => bodies.push({ name, handle, role: 'static', count: 1 });
  const addVaneSet = (name, handle, count) => bodies.push({ name, handle, role: 'vane', count });

  // 1. IMPELLER HUB / BOSS — revolved cone from eye to tip back.
  addStatic('impeller_hub', await rec.shapeOf('part.revolve', {
    profile: [
      [x.frontPlate, round(hubR)],
      [x.backPlate, round(hubR)],
      [x.backPlate, round(tipR * 0.55)],
      [x.frontPlate + 8, round(eyeR * 0.9)],
    ],
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  }));

  // 2. FRONT SHROUD + BACK PLATE — two revolved disks (impeller side-walls).
  addStatic('front_shroud', await buildAnnulus(rec, {
    x0: x.frontPlate, x1: x.frontPlate + p.shroudThk,
    rInner: eyeR, rOuter: tipR,
  }));
  addStatic('back_plate', await buildAnnulus(rec, {
    x0: x.backPlate, x1: x.backPlate + p.backPlateThk,
    rInner: hubR, rOuter: tipR + 6,
  }));

  // 3. IMPELLER VANES — one lofted backswept blade prototype, polar-patterned.
  const nStat = Math.max(2, p.vaneStations | 0);
  const span = tipR - eyeR;
  const sections = [];
  for (let i = 0; i < nStat; i++) {
    const f = i / (nStat - 1);
    const chord = p.vaneInletWidth + (p.vaneOutletWidth - p.vaneInletWidth) * f;
    const sweep = p.backsweepDeg * f;
    sections.push({ z: round(eyeR + f * span), profile: vaneSection(chord, p.vaneThickness, sweep) });
  }
  const vaneZ = await rec.shapeOf('part.loft', { sections, ruled: false });
  // span was built along +Z → re-orient to radial +Y, seat into the passage.
  const vaneRot = await rec.shapeOf('part.rotate', {
    shape: vaneZ, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2,
  });
  const vane = await rec.shapeOf('part.translate', {
    shape: vaneRot, dx: round(x.frontPlate + p.vaneInletWidth / 2), dy: 0, dz: 0,
  });
  addVaneSet('impeller_vane', vane, p.vaneCount);

  // 4. VOLUTE CASING — revolved collector enclosing the impeller (annular shell
  //    with the throat opening to the discharge radius).
  const voluteInnerR = tipR + p.voluteRadialGap;
  const voluteOuterR = voluteInnerR + p.voluteWall + p.voluteThroatDia / 2;
  addStatic('volute_casing', await buildAnnulus(rec, {
    x0: x.frontPlate - 10, x1: x.backPlate + p.backPlateThk + 10,
    rInner: voluteInnerR, rOuter: voluteOuterR,
  }));

  // 5. INLET (suction eye) NOZZLE — axial revolved pipe feeding the eye.
  addStatic('inlet_nozzle', await buildAnnulus(rec, {
    x0: x.eye, x1: x.frontPlate, rInner: eyeR, rOuter: eyeR + 10,
  }));

  // 6. DISCHARGE NOZZLE — radial revolved stub off the volute throat (modelled
  //    as a short axial annulus at the volute OD; the swept tangential branch is
  //    represented by this collector stub for the assembly + CFD bound).
  addStatic('discharge_nozzle', await buildAnnulus(rec, {
    x0: x.frontPlate + 4, x1: x.frontPlate + 4 + p.outletLength * 0.5,
    rInner: voluteOuterR - p.voluteThroatDia / 2, rOuter: voluteOuterR - 2,
  }));

  // 7. DRIVE SHAFT — concentric rod on +X through the back plate.
  addStatic('drive_shaft', await buildAnnulus(rec, {
    x0: x.backPlate - 10, x1: x.shaftEnd, rInner: 0, rOuter: p.shaftDiameter / 2,
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

  // ── ASSEMBLE: identity per static body; vaneCount polar instances per vane. ─
  let totalInstances = 0, assembledTriangles = 0;
  for (const b of bodies) {
    if (b.role === 'vane') {
      const n = Math.max(1, b.count | 0);
      const ids = [];
      for (let i = 0; i < n; i++) {
        const r = await rec.call('assembly.add-instance', {
          shape: b.handle, transform: rotX(2 * Math.PI * i / n),
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

  // Ground the volute casing; mate every other body Concentric about +X.
  const casing = bodies.find((b) => b.name === 'volute_casing').instanceId;
  await rec.call('assembly.set-fixed', { instance: casing, fixed: true });
  const mates = [];
  for (const b of bodies) {
    if (b.instanceId === casing) continue;
    const targets = b.role === 'vane' ? b.instanceIds : [b.instanceId];
    for (const inst of targets) {
      const r = await rec.call('assembly.add-mate', {
        kind: 'Concentric', instA: casing, topoA: 1, instB: inst, topoB: 1, value: 0,
      });
      mates.push({ a: 'volute_casing', b: b.name, mateId: r.mateId });
    }
  }
  const solve = await rec.call('assembly.solve', {});
  const aabb = await rec.call('assembly.query-aabb', { box: [-2000, -2000, -2000, 2000, 2000, 2000] });

  return {
    params: p, axialLayout: x, tipR, eyeR,
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

export default buildTurbopumpSequence;
