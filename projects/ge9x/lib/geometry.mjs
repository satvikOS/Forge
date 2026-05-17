/**
 * GE9X build — 3-D geometry generation.
 *
 * The GE9X gas path is almost entirely axisymmetric: casings, ducts,
 * cones, discs and shafts are surfaces of revolution; the fan and the
 * compressor/turbine stages are blade rows. This module generates real
 * triangle-mesh geometry for every module from the parametric spec.
 *
 * Engine centreline = +X. Units: mm.
 */

import { GE9X } from './spec.mjs';
import { mergeMeshes } from './meshio.mjs';

const TAU = Math.PI * 2;

// ── Surface of revolution ──────────────────────────────────────────

/**
 * Revolve a profile [[x,r],...] about the +X axis.
 * @param {object=} opts { segs, capStart, capEnd }
 */
export function revolve(profile, opts = {}) {
  const segs = opts.segs ?? 72;
  const vertices = [];
  const triangles = [];
  const ringStart = [];
  for (let i = 0; i < profile.length; i++) {
    const [x, r] = profile[i];
    ringStart.push(vertices.length);
    if (r <= 1e-6) {
      vertices.push([x, 0, 0]);                    // pole
    } else {
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        vertices.push([x, r * Math.cos(a), r * Math.sin(a)]);
      }
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a0 = ringStart[i], a1 = ringStart[i + 1];
    const r0pole = profile[i][1] <= 1e-6, r1pole = profile[i + 1][1] <= 1e-6;
    for (let s = 0; s < segs; s++) {
      const sn = (s + 1) % segs;
      if (r0pole && !r1pole) {
        triangles.push([a0, a1 + s, a1 + sn]);
      } else if (!r0pole && r1pole) {
        triangles.push([a0 + s, a1, a0 + sn]);
      } else if (!r0pole && !r1pole) {
        triangles.push([a0 + s, a1 + s, a1 + sn]);
        triangles.push([a0 + s, a1 + sn, a0 + sn]);
      }
    }
  }
  return { vertices, triangles };
}

// ── Aerofoil blade ─────────────────────────────────────────────────

/** Symmetric aerofoil half-thickness at chord fraction s∈[0,1] (NACA-style). */
function thicknessFrac(s) {
  return 1.4845 * Math.sqrt(s) - 0.63 * s - 1.758 * s * s + 1.4215 * s ** 3 - 0.5075 * s ** 4;
}

/**
 * One aerofoil blade, hub→tip, with chord taper and twist (stagger).
 * @param {object} o
 *   rHub, rTip      radial span (mm)
 *   xMid            axial position of the chord mid-point (mm)
 *   chordHub,chordTip  chord length (mm)
 *   thickRatio      max thickness / chord
 *   staggerHub,staggerTip  stagger angle (rad, from axial)
 *   phi             angular position of the blade (rad)
 *   spanSteps, chordPts
 */
export function aerofoilBlade(o) {
  const spanSteps = o.spanSteps ?? 10;
  const chordPts = o.chordPts ?? 14;
  const vertices = [];
  const triangles = [];
  const ring = [];          // index of each station's section loop start

  for (let i = 0; i <= spanSteps; i++) {
    const f = i / spanSteps;
    const r = o.rHub + (o.rTip - o.rHub) * f;
    const chord = o.chordHub + (o.chordTip - o.chordHub) * f;
    const stagger = o.staggerHub + (o.staggerTip - o.staggerHub) * f;
    const phi = o.phi;
    // Frames at this radius/angle.
    const radial = [0, Math.cos(phi), Math.sin(phi)];
    const tangent = [0, -Math.sin(phi), Math.cos(phi)];
    const axial = [1, 0, 0];
    // Chord direction = stagger blend of axial and tangential.
    const cd = axial.map((a, k) => a * Math.cos(stagger) + tangent[k] * Math.sin(stagger));
    // Thickness direction ⟂ chord and radial.
    const nd = [
      radial[1] * cd[2] - radial[2] * cd[1],
      radial[2] * cd[0] - radial[0] * cd[2],
      radial[0] * cd[1] - radial[1] * cd[0],
    ];
    const ndL = Math.hypot(...nd) || 1;
    const ndu = [nd[0] / ndL, nd[1] / ndL, nd[2] / ndL];
    const center = [o.xMid, r * Math.cos(phi), r * Math.sin(phi)];
    ring.push(vertices.length);
    // Section loop: upper LE→TE then lower TE→LE.
    for (let c = 0; c < chordPts; c++) {
      const s = c / (chordPts - 1);
      const half = 0.5 * o.thickRatio * chord * thicknessFrac(s);
      const along = (s - 0.5) * chord;
      vertices.push([
        center[0] + cd[0] * along + ndu[0] * half,
        center[1] + cd[1] * along + ndu[1] * half,
        center[2] + cd[2] * along + ndu[2] * half,
      ]);
    }
    for (let c = chordPts - 1; c >= 0; c--) {
      const s = c / (chordPts - 1);
      const half = 0.5 * o.thickRatio * chord * thicknessFrac(s);
      const along = (s - 0.5) * chord;
      vertices.push([
        center[0] + cd[0] * along - ndu[0] * half,
        center[1] + cd[1] * along - ndu[1] * half,
        center[2] + cd[2] * along - ndu[2] * half,
      ]);
    }
  }
  const loop = chordPts * 2;
  for (let i = 0; i < spanSteps; i++) {
    for (let c = 0; c < loop; c++) {
      const cn = (c + 1) % loop;
      const a = ring[i] + c, b = ring[i] + cn;
      const d = ring[i + 1] + c, e = ring[i + 1] + cn;
      triangles.push([a, d, e]);
      triangles.push([a, e, b]);
    }
  }
  return { vertices, triangles };
}

/** A full blade row: `count` aerofoil blades evenly around the axis. */
export function bladeRow(o) {
  const blades = [];
  for (let b = 0; b < o.count; b++) {
    blades.push(aerofoilBlade({ ...o, phi: (b / o.count) * TAU }));
  }
  return mergeMeshes(blades);
}

/** An annular disc (revolved rectangle) at axial position x. */
export function disc(x, rInner, rOuter, thickness) {
  return revolve([
    [x, rInner], [x, rOuter],
    [x + thickness, rOuter], [x + thickness, rInner], [x, rInner],
  ], { segs: 64 });
}

// ── Module builders ────────────────────────────────────────────────

function smoothCone(x0, x1, rRoot, rTip, n = 24) {
  // Ogive-ish cone profile.
  const profile = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const r = rRoot + (rTip - rRoot) * Math.sin(f * Math.PI / 2);
    profile.push([x0 + (x1 - x0) * f, Math.max(0, r)]);
  }
  return profile;
}

function tube(x0, x1, rInner, rOuter) {
  return revolve([
    [x0, rInner], [x0, rOuter], [x1, rOuter], [x1, rInner], [x0, rInner],
  ], { segs: 80 });
}

/** Build every module of the GE9X as a named mesh. */
export function buildEngine() {
  const m = GE9X.modules;
  const modules = {};

  // Spinner — ogive cone (the tip points -X, so reverse the cone).
  modules.spinner = revolve(smoothCone(m.spinner.x1, m.spinner.x0, m.spinner.rTip, 0));

  // Fan — 16 large swept composite blades + hub disc.
  modules.fan = mergeMeshes([
    disc(m.fan.x0, m.fan.rHub - 60, m.fan.rHub, m.fan.x1 - m.fan.x0),
    bladeRow({
      count: m.fan.blades, rHub: m.fan.rHub, rTip: m.fan.rTip,
      xMid: (m.fan.x0 + m.fan.x1) / 2,
      chordHub: 320, chordTip: 520, thickRatio: 0.09,
      staggerHub: 1.05, staggerTip: 0.42, spanSteps: 14, chordPts: 18,
    }),
  ]);

  // Fan case + nacelle (cowl) + inlet lip.
  modules.fanCase = tube(m.fanCase.x0, m.fanCase.x1, m.fanCase.rInner, m.fanCase.rOuter);
  modules.nacelle = revolve([
    [m.nacelle.x0, m.nacelle.rInner + 40],
    [m.nacelle.x0 - 40, (m.nacelle.rInner + m.nacelle.rOuter) / 2],
    [m.nacelle.x0, m.nacelle.rOuter],
    [m.nacelle.x0 + 1400, m.nacelle.rOuter + 20],
    [m.nacelle.x1, m.nacelle.rOuter - 120],
    [m.nacelle.x1, m.nacelle.rInner],
  ], { segs: 80 });

  // Compressors — booster + HPC, stage by stage.
  modules.booster = buildCompressor(m.booster, GE9X.stageData.booster, 38, 0.6);
  modules.hpc = buildCompressor(m.hpc, GE9X.stageData.hpc, 54, 0.5);

  // Combustor — annular TAPS liner (inner + outer, with a domed head).
  modules.combustor = mergeMeshes([
    tube(m.combustor.x0, m.combustor.x1, m.combustor.rInner, m.combustor.rInner + 30),
    tube(m.combustor.x0, m.combustor.x1, m.combustor.rOuter - 30, m.combustor.rOuter),
    revolve([
      [m.combustor.x0, m.combustor.rInner], [m.combustor.x0 - 70, (m.combustor.rInner + m.combustor.rOuter) / 2],
      [m.combustor.x0, m.combustor.rOuter],
    ], { segs: 64 }),
  ]);

  // Turbines — HPT + LPT.
  modules.hpt = buildTurbine(m.hpt, GE9X.stageData.hpt, 76);
  modules.lpt = buildTurbine(m.lpt, GE9X.stageData.lpt, 90);

  // Shafts — concentric LP (inner) and HP (outer hollow).
  modules.lpShaft = tube(m.lpShaft.x0, m.lpShaft.x1, m.lpShaft.rOuter - 22, m.lpShaft.rOuter);
  modules.hpShaft = tube(m.hpShaft.x0, m.hpShaft.x1, m.hpShaft.rInner, m.hpShaft.rOuter);

  // Core exhaust nozzle (converging) + centre plug.
  modules.coreNozzle = revolve([
    [m.coreNozzle.x0, m.coreNozzle.rInner], [m.coreNozzle.x0, m.coreNozzle.rOuter],
    [m.coreNozzle.x1, m.coreNozzle.rOuter - 180], [m.coreNozzle.x1, m.coreNozzle.rInner],
  ], { segs: 72 });
  modules.plug = revolve(smoothCone(m.plug.x0, m.plug.x1, m.plug.rRoot, 0));

  const assembly = mergeMeshes(Object.values(modules));
  return { modules, assembly };
}

/** A multi-stage axial compressor: rotor row + stator row + disc per stage. */
function buildCompressor(mod, stagePR, bladesPerRow, thickRatio) {
  const parts = [];
  const n = mod.stages;
  const span = (mod.x1 - mod.x0) / n;
  for (let s = 0; s < n; s++) {
    const x = mod.x0 + s * span;
    const f = s / Math.max(1, n - 1);
    const rTip = mod.rTip - (mod.rTip - mod.rHub - 40) * f * 0.35;   // gentle taper
    parts.push(disc(x + span * 0.1, mod.rHub - 50, mod.rHub, span * 0.3));
    parts.push(bladeRow({
      count: bladesPerRow, rHub: mod.rHub, rTip,
      xMid: x + span * 0.35, chordHub: span * 0.5, chordTip: span * 0.42,
      thickRatio, staggerHub: 0.78, staggerTip: 0.5, spanSteps: 6, chordPts: 12,
    }));
    parts.push(bladeRow({                                            // stator
      count: bladesPerRow + 6, rHub: mod.rHub, rTip,
      xMid: x + span * 0.72, chordHub: span * 0.4, chordTip: span * 0.36,
      thickRatio: thickRatio * 0.8, staggerHub: -0.5, staggerTip: -0.32,
      spanSteps: 5, chordPts: 10,
    }));
  }
  return mergeMeshes(parts);
}

/** A multi-stage axial turbine: nozzle + rotor + disc per stage. */
function buildTurbine(mod, stagePR, bladesPerRow) {
  const parts = [];
  const n = mod.stages;
  const span = (mod.x1 - mod.x0) / n;
  for (let s = 0; s < n; s++) {
    const x = mod.x0 + s * span;
    const f = s / Math.max(1, n - 1);
    const rTip = mod.rHub + (mod.rTip - mod.rHub) * (0.6 + 0.4 * f);   // turbine flares out
    parts.push(disc(x + span * 0.1, mod.rHub - 60, mod.rHub, span * 0.32));
    parts.push(bladeRow({                                              // nozzle guide vanes
      count: bladesPerRow, rHub: mod.rHub, rTip,
      xMid: x + span * 0.3, chordHub: span * 0.46, chordTip: span * 0.44,
      thickRatio: 0.16, staggerHub: -0.7, staggerTip: -0.55,
      spanSteps: 6, chordPts: 12,
    }));
    parts.push(bladeRow({                                              // rotor
      count: bladesPerRow + 10, rHub: mod.rHub, rTip,
      xMid: x + span * 0.68, chordHub: span * 0.5, chordTip: span * 0.46,
      thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.48,
      spanSteps: 7, chordPts: 12,
    }));
  }
  return mergeMeshes(parts);
}
