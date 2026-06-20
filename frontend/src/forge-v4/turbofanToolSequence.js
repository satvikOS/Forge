// turbofanToolSequence.js — CANONICAL CUA TOOL-CALL SEQUENCE for a GE9X-class
// high-bypass turbofan, built PURELY from the Forge tool registry verbs the
// Archie model fleet emits (NO turbofanBuilder shortcut, NO asset.* macro).
// ============================================================================
// This is the EXPERT computer-use op-sequence: every body comes from the same
// handle-free / parametric verbs the model is trained on, dispatched through the
// identical `dispatchToolCall` path. The deliverable is a SEQUENCE GENERATOR
// (the prompt allows "the full tool_call sequence OR its generator"): a literal
// flat list is not portable because the kernel handle counter is process-global
// and bumps unpredictably inside revolve/loft (a loft allocates its profile
// wires first → the loft body is handle base+nSections, not base+1). So we
// thread the REAL returned handle at emit time, exactly as the model's executor
// does, and RECORD every {name, arguments} call so the recorded log IS the
// canonical sequence — replayable verbatim through dispatchSequence in a fresh
// kernel.
//
// Verbs used (all from ForgeToolBridge.FORGE_TOOLS, all dispatchToolCall):
//   part.revolve          — fan/compressor/turbine DISKS, annular COMBUSTOR
//                           liners, concentric LP/HP SHAFTS, CORE CASING,
//                           NACELLE cowl, BYPASS duct  (solids of revolution)
//   part.loft             — one twisted NACA airfoil BLADE per stage (skinned
//                           through 6 chord/twist cross-sections along the span)
//   part.rotate / .translate — orient + seat the blade prototype radially
//   assembly.add-instance — POLAR BLADE PATTERN: bladeCount discrete instances
//                           rotated about the engine +X axis (the engineer-
//                           correct, O(1) ring; the kernel solid circularPattern
//                           fuse of a bladed disk fails / is O(N) slow)
//   part.fuse             — fuse the combustor inner+outer liner into one body
//   assembly.set-fixed / add-mate / solve / query-aabb — coaxial assembly
//
// Engine axis = WORLD +X (front at x=0). Radial = YZ plane. Revolve profiles are
// [x_axial, r_radial] pairs revolved about +X (axis in-plane with the z=0 sketch
// plane → revolveProfile yields a true SOLID). GE9X-class dims (fan Ø ~3.4 m).
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;

// ───────────────────────────────────────────────────────────────────────────
//  GE9X-class parameters (all linear dims in MILLIMETRES).
// ───────────────────────────────────────────────────────────────────────────
export const GE9X_PARAMS = {
  fanDiameter: 3400,        // GE9X fan tip Ø ≈ 3.4 m (largest commercial turbofan)
  engineLength: 5200,       // fan face → exhaust plane
  bypassRatio: 10,

  // Fan: ~16 wide-chord composite blades on the real GE9X; spec asks ~22.
  fanBladeCount: 22,
  fanHubDiameter: 1050,
  fanDiskAxialThk: 150,
  fanBladeChordRoot: 520,
  fanBladeChordTip: 300,
  fanBladeTwistRoot: 40,
  fanBladeThick: 0.10,

  // LP compressor / booster — 3 stages, gently decreasing tip Ø.
  lpcStages: 3,
  lpcStartDiameter: 1150,
  lpcEndDiameter: 980,
  lpcHubDiameter: 520,
  lpcBladeCount: 38,
  lpcStagePitch: 170,
  lpcDiskThk: 80,

  // HP compressor — 11 stages on the real GE9X; model 6, strongly decreasing Ø.
  hpcStages: 6,
  hpcStartDiameter: 900,
  hpcEndDiameter: 480,
  hpcHubDiameter: 380,
  hpcBladeCount: 46,
  hpcStagePitch: 120,
  hpcDiskThk: 60,

  // Annular combustor (TAPS III on the real engine) — revolved double liner.
  combustorLength: 480,
  combustorOuterDiameter: 760,
  combustorInnerDiameter: 420,
  combustorWall: 32,

  // HP turbine — 2 stages.
  hptStages: 2,
  hptDiameter: 840,
  hptHubDiameter: 420,
  hptBladeCount: 52,
  hptStagePitch: 190,
  hptDiskThk: 90,

  // LP turbine — 6 stages, increasing Ø toward the exhaust.
  lptStages: 6,
  lptStartDiameter: 980,
  lptEndDiameter: 1400,
  lptHubDiameter: 520,
  lptBladeCount: 60,
  lptStagePitch: 200,
  lptDiskThk: 100,

  // Concentric spools.
  hpShaftOuterDiameter: 320,
  hpShaftWall: 36,
  lpShaftDiameter: 200,

  // Nacelle + bypass duct + core casing.
  nacelleWall: 80,
  bypassDuctGap: 320,
  inletLipOverhang: 200,
  coreCasingWall: 50,

  // Blade loft fidelity + tessellation.
  bladeStations: 6,
  tessLinear: 0.8,
  tessAngular: 0.6,
};

// ───────────────────────────────────────────────────────────────────────────
//  Geometry helpers (pure — produce verb ARGUMENTS, not kernel handles).
// ───────────────────────────────────────────────────────────────────────────

/** Closed NACA-4-style symmetric airfoil, scaled to chord, staggered by twistDeg.
 *  Returned as a closed [[x,y],…] loop pivoted at the quarter-chord. */
function airfoilProfile(chord, thick, twistDeg) {
  const N = 18;
  const up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.1260 * t
      - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
    up.push([t, yt]);
    lo.push([t, -yt]);
  }
  const raw = [...up, ...lo.reverse().slice(1, -1)];
  const cr = Math.cos(twistDeg * DEG), sr = Math.sin(twistDeg * DEG);
  return raw.map(([x, y]) => {
    const X = (x - 0.25) * chord;
    const Y = y * chord;
    return [round(X * cr - Y * sr), round(X * sr + Y * cr)];
  });
}
function round(v) { return Math.round(v * 1000) / 1000; }

/** Row-major 4×4: rotate by `ang` rad about +X then translate `x` along +X. */
function rotXtransX(ang, x) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [1, 0, 0, x, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Annular-disk revolve profile (axial rect [x0,x1]×[rInner,rOuter]) about +X. */
function annulusProfile(x0, x1, rInner, rOuter) {
  return [[x0, rInner], [x1, rInner], [x1, rOuter], [x0, rOuter]];
}

// ───────────────────────────────────────────────────────────────────────────
//  Recorder: dispatch a verb, capture the REAL handle, append the call to the
//  canonical log. This single object both EXECUTES the sequence and EMITS it.
// ───────────────────────────────────────────────────────────────────────────
function makeRecorder(forge) {
  const ctx = { current: null };
  const calls = [];          // canonical {name, arguments} sequence (the deliverable)
  const verbLog = [];        // per-call {name, ok, error} diagnostics
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
//  One rotor stage = a revolved annular DISK body + a single lofted twisted
//  BLADE prototype, oriented radially and seated at the hub radius / station.
// ───────────────────────────────────────────────────────────────────────────
async function buildRotorStage(rec, p, {
  tipDiameter, hubDiameter, diskAxialThk, chordRoot, chordTip,
  twistRoot, thick, bladeCount, stationX,
}) {
  const hubR = hubDiameter / 2;
  const tipR = tipDiameter / 2;
  const span = tipR - hubR;
  const halfThk = diskAxialThk / 2;
  const boreR = Math.max(60, hubR * 0.45);

  // DISK — revolve an annular rectangle about +X.
  const disk = await rec.shapeOf('part.revolve', {
    profile: annulusProfile(stationX - halfThk, stationX + halfThk, round(boreR), round(hubR)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });

  // BLADE — loft a twisted airfoil through bladeStations sections along +Z.
  const nStat = Math.max(2, p.bladeStations | 0);
  const sections = [];
  for (let i = 0; i < nStat; i++) {
    const f = i / (nStat - 1);
    const chord = chordRoot + (chordTip - chordRoot) * f;
    const twist = twistRoot * (1 - 0.66 * f);
    sections.push({ z: round(f * span), profile: airfoilProfile(chord, thick, twist) });
  }
  const bladeZ = await rec.shapeOf('part.loft', { sections, ruled: false });
  // Re-orient span +Z → radial +Y, seat at hub radius, slide to station.
  const bladeRot = await rec.shapeOf('part.rotate', {
    shape: bladeZ, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2,
  });
  const blade = await rec.shapeOf('part.translate', {
    shape: bladeRot, dx: stationX, dy: round(hubR), dz: 0,
  });

  return { diskHandle: disk, bladeHandle: blade, bladeCount, stationX, tipR, hubR };
}

/** Revolved annular tube body (casing / shaft / duct shell / combustor liner). */
async function buildAnnulus(rec, { x0, x1, rInner, rOuter }) {
  return rec.shapeOf('part.revolve', {
    profile: annulusProfile(round(x0), round(x1), round(rInner), round(rOuter)),
    axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  buildTurbofanSequence(forge, params?) — execute + emit the canonical CUA
//  sequence for the whole GE9X. Returns { calls, bodies, assembly, … }.
// ───────────────────────────────────────────────────────────────────────────
export async function buildTurbofanSequence(forge, params = {}) {
  const p = { ...GE9X_PARAMS, ...params };
  const rec = makeRecorder(forge);

  // Axial layout (x along +X, front at x=0).
  const x = { fan: 0 };
  x.lpcStart = x.fan + p.fanDiskAxialThk + 180;
  x.lpcEnd = x.lpcStart + (p.lpcStages - 1) * p.lpcStagePitch;
  x.hpcStart = x.lpcEnd + 280;
  x.hpcEnd = x.hpcStart + (p.hpcStages - 1) * p.hpcStagePitch;
  x.combustorStart = x.hpcEnd + 200;
  x.combustorEnd = x.combustorStart + p.combustorLength;
  x.hptStart = x.combustorEnd + 160;
  x.hptEnd = x.hptStart + (p.hptStages - 1) * p.hptStagePitch;
  x.lptStart = x.hptEnd + 240;
  x.lptEnd = x.lptStart + (p.lptStages - 1) * p.lptStagePitch;
  x.exhaust = Math.max(p.engineLength, x.lptEnd + 320);

  // Body registry. role 'static' = one identity instance; 'blade' = bladeCount
  // polar instances about +X.
  const bodies = [];
  const addStatic = (name, handle) => { bodies.push({ name, handle, role: 'static', bladeCount: 1 }); };
  const addStage = (prefix, st) => {
    bodies.push({ name: `${prefix}_disk`, handle: st.diskHandle, role: 'static', bladeCount: 1 });
    bodies.push({ name: `${prefix}_blade`, handle: st.bladeHandle, role: 'blade', bladeCount: st.bladeCount, stationX: st.stationX });
  };

  // 1. FAN ─ large disk + polar ring of ~22 wide-chord blades.
  addStage('fan', await buildRotorStage(rec, p, {
    tipDiameter: p.fanDiameter, hubDiameter: p.fanHubDiameter, diskAxialThk: p.fanDiskAxialThk,
    chordRoot: p.fanBladeChordRoot, chordTip: p.fanBladeChordTip, twistRoot: p.fanBladeTwistRoot,
    thick: p.fanBladeThick, bladeCount: p.fanBladeCount, stationX: x.fan,
  }));

  // 2. LP COMPRESSOR ─ decreasing-Ø stages.
  for (let s = 0; s < p.lpcStages; s++) {
    const f = p.lpcStages > 1 ? s / (p.lpcStages - 1) : 0;
    const tipD = p.lpcStartDiameter + (p.lpcEndDiameter - p.lpcStartDiameter) * f;
    addStage(`lpc_s${s + 1}`, await buildRotorStage(rec, p, {
      tipDiameter: tipD, hubDiameter: p.lpcHubDiameter, diskAxialThk: p.lpcDiskThk,
      chordRoot: 150, chordTip: 95, twistRoot: 32, thick: 0.10,
      bladeCount: p.lpcBladeCount, stationX: x.lpcStart + s * p.lpcStagePitch,
    }));
  }

  // 3. HP COMPRESSOR ─ more stages, strongly decreasing Ø.
  for (let s = 0; s < p.hpcStages; s++) {
    const f = p.hpcStages > 1 ? s / (p.hpcStages - 1) : 0;
    const tipD = p.hpcStartDiameter + (p.hpcEndDiameter - p.hpcStartDiameter) * f;
    addStage(`hpc_s${s + 1}`, await buildRotorStage(rec, p, {
      tipDiameter: tipD, hubDiameter: p.hpcHubDiameter, diskAxialThk: p.hpcDiskThk,
      chordRoot: 110, chordTip: 62, twistRoot: 26, thick: 0.09,
      bladeCount: p.hpcBladeCount, stationX: x.hpcStart + s * p.hpcStagePitch,
    }));
  }

  // 4. COMBUSTOR ─ annular double liner (two revolved annuli fused).
  const combOuter = await buildAnnulus(rec, {
    x0: x.combustorStart, x1: x.combustorEnd,
    rInner: p.combustorOuterDiameter / 2 - p.combustorWall, rOuter: p.combustorOuterDiameter / 2,
  });
  const combInner = await buildAnnulus(rec, {
    x0: x.combustorStart + 40, x1: x.combustorEnd - 40,
    rInner: p.combustorInnerDiameter / 2, rOuter: p.combustorInnerDiameter / 2 + p.combustorWall,
  });
  addStatic('combustor', await rec.shapeOf('part.fuse', { a: combOuter, b: combInner }));

  // 5. HP TURBINE ─ stages.
  for (let s = 0; s < p.hptStages; s++) {
    addStage(`hpt_s${s + 1}`, await buildRotorStage(rec, p, {
      tipDiameter: p.hptDiameter, hubDiameter: p.hptHubDiameter, diskAxialThk: p.hptDiskThk,
      chordRoot: 170, chordTip: 120, twistRoot: 30, thick: 0.13,
      bladeCount: p.hptBladeCount, stationX: x.hptStart + s * p.hptStagePitch,
    }));
  }

  // 6. LP TURBINE ─ increasing-Ø stages toward exhaust.
  for (let s = 0; s < p.lptStages; s++) {
    const f = p.lptStages > 1 ? s / (p.lptStages - 1) : 0;
    const tipD = p.lptStartDiameter + (p.lptEndDiameter - p.lptStartDiameter) * f;
    addStage(`lpt_s${s + 1}`, await buildRotorStage(rec, p, {
      tipDiameter: tipD, hubDiameter: p.lptHubDiameter, diskAxialThk: p.lptDiskThk,
      chordRoot: 190, chordTip: 130, twistRoot: 28, thick: 0.14,
      bladeCount: p.lptBladeCount, stationX: x.lptStart + s * p.lptStagePitch,
    }));
  }

  // 7. SHAFTS ─ concentric LP (solid full-length rod) + HP (hollow tube) spools.
  addStatic('lp_shaft', await buildAnnulus(rec, {
    x0: x.fan, x1: x.lptEnd, rInner: 0, rOuter: p.lpShaftDiameter / 2,
  }));
  addStatic('hp_shaft', await buildAnnulus(rec, {
    x0: x.hpcStart - 60, x1: x.hptEnd + 60,
    rInner: p.hpShaftOuterDiameter / 2 - p.hpShaftWall, rOuter: p.hpShaftOuterDiameter / 2,
  }));

  // 8. CORE CASING ─ revolved tube enclosing the compressor→turbine core.
  const coreOuterR = p.lptEndDiameter / 2 + 120;
  addStatic('core_casing', await buildAnnulus(rec, {
    x0: x.lpcStart - 80, x1: x.exhaust,
    rInner: coreOuterR - p.coreCasingWall, rOuter: coreOuterR,
  }));

  // 9. NACELLE + BYPASS DUCT ─ curved revolved cowl + annular bypass passage.
  const fanTipR = p.fanDiameter / 2;
  const nacInnerR = fanTipR + 110;
  const nacOuterR = nacInnerR + p.nacelleWall;
  const nacFront = x.fan - p.inletLipOverhang;
  const nacAft = x.exhaust - 160;
  const cowlProfile = [
    [round(nacFront), round(nacInnerR)],
    [round(nacFront), round(nacOuterR - 40)],
    [round(nacFront + 360), round(nacOuterR + 90)],     // cowl crest (max Ø)
    [round((nacFront + nacAft) / 2), round(nacOuterR + 50)],
    [round(nacAft), round(nacInnerR + 170)],
    [round(nacAft), round(nacInnerR)],
  ];
  addStatic('nacelle', await rec.shapeOf('part.revolve', {
    profile: cowlProfile, axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  }));
  addStatic('bypass_duct', await buildAnnulus(rec, {
    x0: x.lpcStart, x1: nacAft - 60,
    rInner: coreOuterR + 30, rOuter: coreOuterR + 30 + p.bypassDuctGap,
  }));

  // ── Tessellate every unique body; assert > 0 triangles. ──────────────────
  let totalTriangles = 0;
  for (const b of bodies) {
    const m = forge.tessellate(b.handle, p.tessLinear, p.tessAngular);
    const tris = m.triangleCount ?? (m.indices ? m.indices.length / 3 : 0);
    if (!tris || tris <= 0) throw new Error(`body '${b.name}' tessellated to ZERO triangles`);
    b.triangles = tris;
    totalTriangles += tris;
  }

  // ── ASSEMBLE: identity instance per static body, bladeCount polar instances
  //    per blade prototype (the polar PATTERN), then mate everything coaxial. ─
  let totalInstances = 0, assembledTriangles = 0;
  for (const b of bodies) {
    if (b.role === 'blade') {
      const n = Math.max(1, b.bladeCount | 0);
      const ids = [];
      for (let i = 0; i < n; i++) {
        const r = await rec.call('assembly.add-instance', {
          shape: b.handle, transform: rotXtransX(2 * Math.PI * i / n, 0),
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

  // Ground the fan disk; mate every other body Concentric to it about +X.
  const datum = bodies[0].instanceId;
  await rec.call('assembly.set-fixed', { instance: datum, fixed: true });
  const mates = [];
  for (let i = 1; i < bodies.length; i++) {
    const r = await rec.call('assembly.add-mate', {
      kind: 'Concentric', instA: datum, topoA: 1, instB: bodies[i].instanceId, topoB: 1, value: 0,
    });
    mates.push({ a: bodies[0].name, b: bodies[i].name, mateId: r.mateId });
  }
  const solve = await rec.call('assembly.solve', {});
  const aabb = await rec.call('assembly.query-aabb', { box: [-6000, -6000, -6000, 6000, 6000, 6000] });

  return {
    params: p, axialLayout: x,
    calls: rec.calls,                 // ← THE canonical CUA tool_call sequence
    verbLog: rec.verbLog,
    bodies: bodies.map((b) => ({
      name: b.name, handle: b.handle, role: b.role,
      instances: b.instanceIds.length, triangles: b.triangles,
    })),
    bodyCount: bodies.length,
    totalTriangles,                   // sum over unique bodies
    assembledTriangles,               // sum over every instance (blades × count)
    assembly: {
      bodies: bodies.length, instances: totalInstances, mates: mates.length,
      solve, aabbHits: aabb.hitCount,
      coherent: solve && solve.converged === true && aabb.hitCount === totalInstances,
    },
  };
}

export default buildTurbofanSequence;
