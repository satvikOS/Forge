// turbofanBuilder.js — PARAMETRIC high-bypass TURBOFAN (GE/Rolls-Royce class)
// ============================================================================
// Builds a next-generation high-bypass turbofan as REAL OCCT B-rep solids and
// a coherent assembly, headless. Every curved / bladed feature is produced with
// the Forge kernel's PARAMETRIC verbs — revolve (disks, casing, nacelle cowl,
// annular combustor, bypass duct), loft (twisted airfoil blades), and the
// polar circular-pattern (blade rings) — NOT stacks of boxes.
//
// The engine axis is the WORLD +X axis (length runs front→aft along +X):
//   x = 0      : fan face (front)
//   x grows aft: LP/HP compressor → combustor → HP/LP turbine → exhaust
// Radial directions are the world YZ plane. Profiles handed to part.revolve are
// [x_axial, r_radial] pairs revolved about +X (the axis is in-plane with the
// XY sketch plane → revolveProfile yields a true SOLID of revolution).
//
// Blades are built once as a lofted twisted airfoil whose span runs along +Z
// (the loft-stack axis), then rotated so the span lies radially (+Y) at the hub
// radius and replicated with part.circular-pattern about +X → a real polar ring
// of N twisted blades. Each ring is then fused onto its disk to form one named
// rotor body.
//
// USAGE (headless):
//   import { makeHeadlessForge } from '../../../forge-kernel/test/cadscore_harness.mjs';
//   import { buildTurbofan } from './turbofanBuilder.js';
//   const forge = makeHeadlessForge();
//   const res = await buildTurbofan(forge);     // params optional
//   // res.bodies = [{ name, handle, triangles, volume, bbox }, …]
//   // res.assembly = { instances, mates, solve, aabb }
//
// Every verb goes through dispatchToolCall with a SHARED context object, so the
// build is exactly the call sequence the Archie fleet was trained to emit. Where
// the context (build123d-style) verbs are the cleaner choice they are used; the
// curved/parametric/assembly verbs are reached the same way.
// ============================================================================

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

const DEG = Math.PI / 180;

// ───────────────────────────────────────────────────────────────────────────
//  Default parameters — realistic GE9X / Trent-XWB-class high-bypass turbofan.
//  All linear dimensions in MILLIMETRES (Forge kernel convention).
// ───────────────────────────────────────────────────────────────────────────
export const DEFAULT_PARAMS = {
  // Overall envelope
  fanDiameter: 2500,        // fan tip Ø ~2.5 m (GE9X is ~3.4 m; this is a
                            //   conservative wide-body class)
  engineLength: 3600,       // fan face → exhaust plane, ~3.6 m
  bypassRatio: 10,          // informational; drives nacelle/duct sizing

  // Fan stage
  fanBladeCount: 22,        // ~22 swept composite fan blades
  fanHubDiameter: 700,      // fan disk (hub) Ø
  fanDiskAxialThk: 110,     // fan disk axial thickness
  fanBladeChordRoot: 320,   // root chord
  fanBladeChordTip: 180,    // tip chord
  fanBladeTwistRoot: 38,    // root stagger/twist (deg) — large for a fan
  fanBladeThick: 0.10,      // airfoil thickness ratio

  // LP compressor (booster) — 3 stages, gently decreasing tip Ø
  lpcStages: 3,
  lpcStartDiameter: 820,
  lpcEndDiameter: 700,
  lpcHubDiameter: 360,
  lpcBladeCount: 38,
  lpcStagePitch: 130,       // axial pitch between stages

  // HP compressor — 5 stages, strongly decreasing Ø (high-pressure spool)
  hpcStages: 5,
  hpcStartDiameter: 640,
  hpcEndDiameter: 360,
  hpcHubDiameter: 280,
  hpcBladeCount: 46,
  hpcStagePitch: 95,

  // Annular combustor
  combustorLength: 360,
  combustorOuterDiameter: 560,
  combustorInnerDiameter: 300,
  combustorWall: 26,

  // HP turbine — 2 stages
  hptStages: 2,
  hptDiameter: 620,
  hptHubDiameter: 300,
  hptBladeCount: 52,
  hptStagePitch: 150,

  // LP turbine — 5 stages, increasing Ø toward the exhaust
  lptStages: 5,
  lptStartDiameter: 700,
  lptEndDiameter: 1000,
  lptHubDiameter: 360,
  lptBladeCount: 60,
  lptStagePitch: 160,

  // Spools (concentric shafts)
  hpShaftOuterDiameter: 240,   // HP spool — hollow, surrounds LP shaft
  hpShaftWall: 30,
  lpShaftDiameter: 150,        // LP shaft — runs the full length, fan→LP turbine

  // Nacelle + bypass duct (revolved cowl)
  nacelleWall: 60,
  bypassDuctGap: 240,          // radial gap of the bypass annulus
  inletLipOverhang: 140,       // nacelle inlet extends forward of the fan face
  coreCasingWall: 40,

  // Tessellation tolerance (mm chord deflection / rad)
  tessLinear: 0.6,
  tessAngular: 0.6,

  // Blade loft fidelity (cross-sections along the span)
  bladeStations: 6,
};

// ───────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ───────────────────────────────────────────────────────────────────────────

/** Identity 4×4 row-major. */
function ident() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Row-major 4×4 pure translation along the engine axis (+X). */
function translX(x) {
  return [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Row-major 4×4 = rotation by `ang` rad about the engine axis (+X) followed by
 * a translation of `x` along +X. Used to place each blade of a polar ring as a
 * discrete assembly instance — a true O(1) polar PATTERN with NO heavy boolean
 * fuse (the kernel's solid circularPattern fuses N copies pairwise, which is
 * ~3 s/blade on a 60-blade turbine stage; assembly instancing is microseconds
 * and is also the engineer-correct model — blades ARE discrete components).
 */
function rotXtransX(ang, x) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [1, 0, 0, x, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

/**
 * Closed NACA-4-style symmetric airfoil profile, scaled to `chord`, rotated by
 * `twistDeg` (stagger) and returned as a closed [[x,y], …] loop. Built around
 * the quarter-chord so a per-station twist pivots realistically.
 */
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
  // upper LE→TE then lower TE→LE (drop shared LE/TE to keep a clean closed loop)
  const raw = [...up, ...lo.reverse().slice(1, -1)];
  const cr = Math.cos(twistDeg * DEG), sr = Math.sin(twistDeg * DEG);
  return raw.map(([x, y]) => {
    const X = (x - 0.25) * chord;   // pivot at quarter-chord
    const Y = y * chord;
    return [X * cr - Y * sr, X * sr + Y * cr];
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  A thin wrapper that records every kernel verb through dispatchToolCall with
//  a SHARED ctx, surfaces real errors (no silent fallback), and returns the
//  produced handle. This IS the Archie-trained call surface.
// ───────────────────────────────────────────────────────────────────────────
function makeDispatcher(forge) {
  const ctx = { current: null };
  const log = [];
  async function call(name, args) {
    const res = await dispatchToolCall({ name, arguments: args }, { forge, ctx });
    log.push({ name, ok: res.ok, error: res.error || null });
    if (!res.ok) {
      throw new Error(`forge verb '${name}' failed: ${res.error}`);
    }
    return res.result || {};
  }
  /** Most geometry verbs return { shape }. */
  async function shapeOf(name, args) {
    const r = await call(name, args);
    if (typeof r.shape !== 'number' || r.shape <= 0) {
      throw new Error(`forge verb '${name}' did not produce a solid handle (got ${JSON.stringify(r).slice(0, 120)})`);
    }
    return r.shape;
  }
  return { call, shapeOf, ctx, log };
}

/**
 * Build ONE rotor stage as TWO B-rep bodies:
 *   • a revolved annular DISK solid (the rim/web/bore), and
 *   • a single lofted twisted airfoil BLADE solid, already oriented radially and
 *     seated at the hub radius (the prototype that the assembly replicates into
 *     a polar ring of `bladeCount` discrete instances).
 *
 * The blade is positioned at its final axial station (`stationX`) so the whole
 * stage lives in world coordinates; the assembly then places ONE disk instance
 * and `bladeCount` blade instances rotated about +X — the polar PATTERN, done
 * with O(1) transforms instead of O(N) heavy OCCT booleans. Returns handles +
 * geometry for the caller to register.
 *
 *  - tipDiameter   : blade tip Ø (sets the span)
 *  - hubDiameter   : disk bore-to-rim — blades start at hubDiameter/2
 *  - diskAxialThk  : axial thickness of the disk
 *  - chordRoot/Tip : airfoil chord at hub / tip
 *  - twistRoot     : stagger at the root (linearly relaxes to ~⅓ at the tip)
 *  - thick         : airfoil thickness ratio
 *  - bladeCount    : blades in the polar pattern
 *  - stationX      : axial world position of the stage
 */
async function buildRotorStage(d, p, {
  tipDiameter, hubDiameter, diskAxialThk, chordRoot, chordTip,
  twistRoot, thick, bladeCount, stationX,
}) {
  const hubR = hubDiameter / 2;
  const tipR = tipDiameter / 2;
  const span = tipR - hubR;          // blade radial span
  const halfThk = diskAxialThk / 2;

  // --- disk: revolve an annular rectangle [x_axial, r_radial] about +X ---
  // bore radius = a fraction of the hub so the disk has a real web + rim.
  const boreR = Math.max(40, hubR * 0.45);
  const diskProfile = [
    [stationX - halfThk, boreR],
    [stationX + halfThk, boreR],
    [stationX + halfThk, hubR],
    [stationX - halfThk, hubR],
  ];
  const disk = await d.shapeOf('part.revolve', {
    profile: diskProfile,
    axisOrigin: [0, 0, 0],
    axisDir: [1, 0, 0],
    angleDeg: 360,
  });

  // --- one blade: loft twisted airfoil sections stacked along +Z (the span) ---
  const nStat = Math.max(2, p.bladeStations | 0);
  const sections = [];
  for (let i = 0; i < nStat; i++) {
    const f = i / (nStat - 1);
    const chord = chordRoot + (chordTip - chordRoot) * f;
    const twist = twistRoot * (1 - 0.66 * f);   // relax twist toward the tip
    sections.push({ z: f * span, profile: airfoilProfile(chord, thick, twist) });
  }
  const bladeSpanZ = await d.shapeOf('part.loft', { sections, ruled: false });

  // Re-orient the blade: span +Z → radial +Y (rotate −90° about +X), seat the
  // root at the hub radius, and slide to the stage's axial station. This is the
  // "blade at 0°"; the assembly clones it around the ring.
  let blade = await d.shapeOf('part.rotate', {
    shape: bladeSpanZ, ax: 1, ay: 0, az: 0, angle: -Math.PI / 2,
  });
  blade = await d.shapeOf('part.translate', { shape: blade, dx: stationX, dy: hubR, dz: 0 });

  return { diskHandle: disk, bladeHandle: blade, tipR, hubR, span, bladeCount, stationX };
}

/**
 * Revolved annular tube body (casing / shaft / duct shell). Profile is the
 * axial rectangle [x∈(x0,x1)] × [r∈(rInner,rOuter)] revolved about +X.
 */
async function buildAnnulus(d, { x0, x1, rInner, rOuter }) {
  const profile = [
    [x0, rInner],
    [x1, rInner],
    [x1, rOuter],
    [x0, rOuter],
  ];
  return d.shapeOf('part.revolve', {
    profile, axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  Main builder
// ───────────────────────────────────────────────────────────────────────────

/**
 * buildTurbofan(forge, params?) → assembled high-bypass turbofan.
 *
 * @param {object} forge   headless or Electron Forge kernel facade
 * @param {object} [params] overrides merged over DEFAULT_PARAMS
 * @returns {Promise<{
 *   params: object,
 *   bodies: Array<{ name, handle, triangles, vertices, volume, bbox }>,
 *   totalTriangles: number,
 *   assembly: { instances, mates, solve, aabb },
 *   verbLog: Array<{name, ok, error}>,
 * }>}
 */
export async function buildTurbofan(forge, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const d = makeDispatcher(forge);

  // axial layout (x along the engine axis, front at x=0) ----------------------
  const x = { fan: 0 };
  x.lpcStart = x.fan + p.fanDiskAxialThk + 120;
  x.lpcEnd = x.lpcStart + (p.lpcStages - 1) * p.lpcStagePitch;
  x.hpcStart = x.lpcEnd + 200;
  x.hpcEnd = x.hpcStart + (p.hpcStages - 1) * p.hpcStagePitch;
  x.combustorStart = x.hpcEnd + 150;
  x.combustorEnd = x.combustorStart + p.combustorLength;
  x.hptStart = x.combustorEnd + 120;
  x.hptEnd = x.hptStart + (p.hptStages - 1) * p.hptStagePitch;
  x.lptStart = x.hptEnd + 180;
  x.lptEnd = x.lptStart + (p.lptStages - 1) * p.lptStagePitch;
  x.exhaust = Math.max(p.engineLength, x.lptEnd + 250);

  // Body registry. role:
  //   'static' — placed once (casing/shaft/combustor/nacelle/disk)
  //   'blade'  — a single-blade prototype the assembly clones into a polar ring
  //              of `bladeCount` instances about +X at axial `stationX`.
  const bodies = [];
  const addStatic = (name, handle) => {
    bodies.push({ name, handle, role: 'static', bladeCount: 1 });
    return handle;
  };
  const addStage = (prefix, stage) => {
    bodies.push({ name: `${prefix}_disk`, handle: stage.diskHandle, role: 'static', bladeCount: 1 });
    bodies.push({
      name: `${prefix}_blade`, handle: stage.bladeHandle, role: 'blade',
      bladeCount: stage.bladeCount, stationX: stage.stationX,
    });
  };

  // ── 1. FAN: large disk + polar ring of ~22 swept/twisted fan blades ───────
  addStage('fan', await buildRotorStage(d, p, {
    tipDiameter: p.fanDiameter, hubDiameter: p.fanHubDiameter,
    diskAxialThk: p.fanDiskAxialThk, chordRoot: p.fanBladeChordRoot,
    chordTip: p.fanBladeChordTip, twistRoot: p.fanBladeTwistRoot,
    thick: p.fanBladeThick, bladeCount: p.fanBladeCount, stationX: x.fan,
  }));

  // ── 2. LP COMPRESSOR (booster): a few decreasing-Ø stages ─────────────────
  for (let s = 0; s < p.lpcStages; s++) {
    const f = p.lpcStages > 1 ? s / (p.lpcStages - 1) : 0;
    const tipD = p.lpcStartDiameter + (p.lpcEndDiameter - p.lpcStartDiameter) * f;
    addStage(`lpc_s${s + 1}`, await buildRotorStage(d, p, {
      tipDiameter: tipD, hubDiameter: p.lpcHubDiameter, diskAxialThk: 60,
      chordRoot: 95, chordTip: 60, twistRoot: 30, thick: 0.10,
      bladeCount: p.lpcBladeCount, stationX: x.lpcStart + s * p.lpcStagePitch,
    }));
  }

  // ── 3. HP COMPRESSOR: more stages, strongly decreasing Ø ──────────────────
  for (let s = 0; s < p.hpcStages; s++) {
    const f = p.hpcStages > 1 ? s / (p.hpcStages - 1) : 0;
    const tipD = p.hpcStartDiameter + (p.hpcEndDiameter - p.hpcStartDiameter) * f;
    addStage(`hpc_s${s + 1}`, await buildRotorStage(d, p, {
      tipDiameter: tipD, hubDiameter: p.hpcHubDiameter, diskAxialThk: 48,
      chordRoot: 70, chordTip: 42, twistRoot: 26, thick: 0.09,
      bladeCount: p.hpcBladeCount, stationX: x.hpcStart + s * p.hpcStagePitch,
    }));
  }

  // ── 4. COMBUSTOR: annular chamber (revolved double-wall annulus) ──────────
  // Outer + inner liner walls revolved about +X → a real annular chamber.
  const combOuter = await buildAnnulus(d, {
    x0: x.combustorStart, x1: x.combustorEnd,
    rInner: p.combustorOuterDiameter / 2 - p.combustorWall,
    rOuter: p.combustorOuterDiameter / 2,
  });
  const combInner = await buildAnnulus(d, {
    x0: x.combustorStart + 30, x1: x.combustorEnd - 30,
    rInner: p.combustorInnerDiameter / 2,
    rOuter: p.combustorInnerDiameter / 2 + p.combustorWall,
  });
  addStatic('combustor', await d.shapeOf('part.fuse', { a: combOuter, b: combInner }));

  // ── 5. HP TURBINE: stages (disk + blades) ─────────────────────────────────
  for (let s = 0; s < p.hptStages; s++) {
    addStage(`hpt_s${s + 1}`, await buildRotorStage(d, p, {
      tipDiameter: p.hptDiameter, hubDiameter: p.hptHubDiameter, diskAxialThk: 70,
      chordRoot: 110, chordTip: 80, twistRoot: 30, thick: 0.13,
      bladeCount: p.hptBladeCount, stationX: x.hptStart + s * p.hptStagePitch,
    }));
  }

  // ── 6. LP TURBINE: stages, increasing Ø toward exhaust ────────────────────
  for (let s = 0; s < p.lptStages; s++) {
    const f = p.lptStages > 1 ? s / (p.lptStages - 1) : 0;
    const tipD = p.lptStartDiameter + (p.lptEndDiameter - p.lptStartDiameter) * f;
    addStage(`lpt_s${s + 1}`, await buildRotorStage(d, p, {
      tipDiameter: tipD, hubDiameter: p.lptHubDiameter, diskAxialThk: 80,
      chordRoot: 130, chordTip: 95, twistRoot: 28, thick: 0.14,
      bladeCount: p.lptBladeCount, stationX: x.lptStart + s * p.lptStagePitch,
    }));
  }

  // ── 7. SHAFTS: concentric LP / HP spools ──────────────────────────────────
  // LP shaft: solid rod fan → LP turbine (full length).
  addStatic('lp_shaft', await buildAnnulus(d, {
    x0: x.fan, x1: x.lptEnd,
    rInner: 0, rOuter: p.lpShaftDiameter / 2,
  }));
  // HP shaft: hollow tube surrounding the LP shaft, HP compressor → HP turbine.
  addStatic('hp_shaft', await buildAnnulus(d, {
    x0: x.hpcStart - 40, x1: x.hptEnd + 40,
    rInner: p.hpShaftOuterDiameter / 2 - p.hpShaftWall,
    rOuter: p.hpShaftOuterDiameter / 2,
  }));

  // ── 8. CORE CASING: revolved tube enclosing the compressor→turbine core ───
  const coreOuterR = p.lptEndDiameter / 2 + 90;
  addStatic('core_casing', await buildAnnulus(d, {
    x0: x.lpcStart - 60, x1: x.exhaust,
    rInner: coreOuterR - p.coreCasingWall,
    rOuter: coreOuterR,
  }));

  // ── 9. NACELLE + BYPASS DUCT: revolved cowl with the bypass annulus ───────
  // The nacelle is a curved cowl (revolved profile with an aero inlet lip and a
  // tapered aft fairing). The bypass duct is the annular gap between the core
  // casing OD and the nacelle inner wall — modelled as its own revolved annulus.
  const fanTipR = p.fanDiameter / 2;
  const nacInnerR = fanTipR + 80;                 // inner cowl wall just outside fan tips
  const nacOuterR = nacInnerR + p.nacelleWall;
  const nacFront = x.fan - p.inletLipOverhang;    // inlet lip ahead of fan face
  const nacAft = x.exhaust - 120;
  // Curved outer cowl profile (axial x, radial r): inlet lip → max-Ø → aft taper.
  const cowlProfile = [
    [nacFront, nacInnerR],                                  // inlet lip inner
    [nacFront, nacOuterR - 30],                             // lip outer
    [nacFront + 260, nacOuterR + 70],                       // cowl crest (max Ø)
    [(nacFront + nacAft) / 2, nacOuterR + 40],              // mid
    [nacAft, nacInnerR + 130],                              // aft taper outer
    [nacAft, nacInnerR],                                    // aft inner
  ];
  addStatic('nacelle', await d.shapeOf('part.revolve', {
    profile: cowlProfile, axisOrigin: [0, 0, 0], axisDir: [1, 0, 0], angleDeg: 360,
  }));
  // Bypass duct: annular flow passage between core casing OD and nacelle inner.
  addStatic('bypass_duct', await buildAnnulus(d, {
    x0: x.lpcStart, x1: nacAft - 40,
    rInner: coreOuterR + 20,
    rOuter: coreOuterR + 20 + p.bypassDuctGap,
  }));

  // ── Tessellate every body; assert triangles > 0 ───────────────────────────
  let totalTriangles = 0;
  for (const b of bodies) {
    const m = forge.tessellate(b.handle, p.tessLinear, p.tessAngular);
    const tris = m.triangleCount ?? (m.indices ? m.indices.length / 3 : 0);
    if (!tris || tris <= 0) {
      throw new Error(`body '${b.name}' (handle ${b.handle}) tessellated to ZERO triangles`);
    }
    let volume = null, bbox = null;
    try {
      const mp = forge.massProps(b.handle);
      volume = mp && typeof mp.volume === 'number' ? mp.volume : null;
    } catch { /* mass props optional */ }
    // bbox from the mesh positions
    const P = m.positions;
    if (P && P.length) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const v = P[i + a];
          if (v < mn[a]) mn[a] = v;
          if (v > mx[a]) mx[a] = v;
        }
      }
      bbox = { min: mn, max: mx };
    }
    b.triangles = tris;
    b.vertices = P ? P.length / 3 : 0;
    b.volume = volume;
    b.bbox = bbox;
    totalTriangles += tris;
  }

  // ── ASSEMBLE: place every body, replicate blades into polar rings, then mate
  //    everything CONCENTRIC on the engine +X axis. ──────────────────────────
  // Static bodies (disks, casings, shafts, combustor, nacelle, duct) get ONE
  // identity instance — they are already modelled in world coordinates on the
  // axis. Blade prototypes get `bladeCount` instances rotated about +X → a real
  // POLAR PATTERN realised as discrete assembly components (the engineer-correct
  // model, and O(1) per blade vs. the kernel's O(N) boolean circularPattern).
  const instances = [];        // { name, instanceId } — first instance per body
  let totalInstances = 0;
  for (const b of bodies) {
    if (b.role === 'blade') {
      const n = Math.max(1, b.bladeCount | 0);
      const ids = [];
      for (let i = 0; i < n; i++) {
        const ang = 2 * Math.PI * i / n;
        const r = await d.call('assembly.add-instance', {
          shape: b.handle, transform: rotXtransX(ang, 0),
        });
        ids.push(r.instanceId);
      }
      b.instanceIds = ids;
      b.instanceId = ids[0];   // representative for mating + reporting
      totalInstances += ids.length;
    } else {
      const r = await d.call('assembly.add-instance', { shape: b.handle, transform: ident() });
      b.instanceId = r.instanceId;
      b.instanceIds = [r.instanceId];
      totalInstances += 1;
    }
    instances.push({ name: b.name, instanceId: b.instanceId, count: b.instanceIds.length });
  }

  // Fix the fan disk as the ground/datum, then mate every OTHER body's
  // representative instance Concentric to it about the engine axis (topo 1 =
  // axis selector) — recording the real coaxial relationship the whole rotor +
  // stator stack shares.
  const datum = bodies[0].instanceId;   // fan_disk
  await d.call('assembly.set-fixed', { instance: datum, fixed: true });
  const mates = [];
  for (let i = 1; i < bodies.length; i++) {
    const r = await d.call('assembly.add-mate', {
      kind: 'Concentric', instA: datum, topoA: 1,
      instB: bodies[i].instanceId, topoB: 1, value: 0,
    });
    mates.push({ a: bodies[0].name, b: bodies[i].name, mateId: r.mateId });
  }
  const solve = await d.call('assembly.solve', {});
  const aabb = await d.call('assembly.query-aabb', {
    box: [-5000, -5000, -5000, 5000, 5000, 5000],
  });

  // Triangles across the FULL assembled engine (each blade counted bladeCount×).
  let assembledTriangles = 0;
  for (const b of bodies) assembledTriangles += b.triangles * b.instanceIds.length;

  return {
    params: p,
    axialLayout: x,
    bodies: bodies.map((b) => ({
      name: b.name,
      handle: b.handle,
      role: b.role,
      instanceId: b.instanceId,
      instances: b.instanceIds.length,   // 1 for static, bladeCount for blades
      triangles: b.triangles,            // per single body
      vertices: b.vertices,
      volume: b.volume,
      bbox: b.bbox,
    })),
    totalTriangles,             // sum over the N UNIQUE bodies (one each)
    assembledTriangles,         // sum over EVERY instance (blades × count)
    assembly: {
      bodies: bodies.length,
      instances: totalInstances,
      mates: mates.length,
      mateList: mates,
      solve,
      aabbHits: aabb.hitCount,
      coherent: solve && solve.converged === true && aabb.hitCount === totalInstances,
    },
    verbLog: d.log,
  };
}

export default buildTurbofan;
