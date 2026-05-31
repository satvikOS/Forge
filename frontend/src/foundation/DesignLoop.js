/**
 * ArchDisc Foundation — closing design → analyse → redesign loop.
 *
 * This is the difference between an engineering artefact and a mock: a
 * part is not "done" because it was drawn — it is done when a real
 * analysis on its OWN mesh meets the criteria, and when it does not, the
 * design is changed and re-analysed until it does (or the loop reports
 * that it cannot converge).
 *
 *   runDesignLoop  — general fixed-point loop: build → analyse → judge →
 *                    redesign, until accepted or the iteration budget runs
 *                    out. Records every iteration so the convergence is
 *                    auditable.
 *
 *   sizeRotatingDisc — a concrete agent built on the loop. It sizes a
 *                    turbine/compressor disc's hub thickness so the peak
 *                    centrifugal von-Mises stress sits inside the material
 *                    allowable. Real FEM (foundation.solveLinearStatic) on
 *                    a real annular tet mesh; the centrifugal body load is
 *                    applied as consistent nodal forces m·ω²·r.
 *
 * Honest scope / idealisations (flagged, not hidden):
 *   • linear-elastic, small-strain FEM (no plasticity, no creep — a hot
 *     turbine disc in service also creeps; this loop sizes the elastic
 *     stress only).
 *   • the bore is modelled as fully clamped (shaft/shrink-fit idealisation)
 *     — conservative: it puts the peak stress at the bore.
 *   • structured Kuhn tet mesh — adequate for the disc body, not a
 *     surface-conforming mesh of fillet details.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

import { solveLinearStatic } from './LinearTetFEM.js';
import { MaterialDB, findMaterial } from './MaterialDB.js';

const resolveMaterial = (m) => {
  if (m && typeof m.yield === 'function') return m;
  return findMaterial(m) || MaterialDB[m] || MaterialDB.INCONEL_718;
};

/**
 * General closing design loop.
 *
 * @param {object} o
 *   params         initial design parameters (object)
 *   build(params)              → a candidate (geometry / model)
 *   analyse(candidate, params) → an analysis result object
 *   judge(analysis, params)    → { pass:boolean, ratio:number, message:string }
 *   redesign(params, judged, analysis) → next params
 *   maxIterations  iteration budget (default 12)
 * @returns {{ converged, iterations, params, candidate, analysis, judged, history }}
 */
export function runDesignLoop({ params, build, analyse, judge, redesign, maxIterations = 12 }) {
  const history = [];
  let cur = { ...params };
  let candidate, analysis, judged;
  for (let iter = 1; iter <= maxIterations; iter++) {
    candidate = build(cur);
    analysis = analyse(candidate, cur);
    judged = judge(analysis, cur);
    history.push({
      iteration: iter,
      params: { ...cur },
      ratio: judged.ratio,
      pass: judged.pass,
      message: judged.message,
    });
    if (judged.pass) {
      return { converged: true, iterations: iter, params: cur, candidate, analysis, judged, history };
    }
    cur = redesign(cur, judged, analysis);
  }
  return { converged: false, iterations: maxIterations, params: cur, candidate, analysis, judged, history };
}

const tetVolume = (a, b, c, d) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
  return Math.abs(
    ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx),
  ) / 6;
};

/**
 * Annular disc tet mesh (metres). Thickness tapers linearly from `tHub`
 * at the bore to `tRim` at the rim — the classic stress-relieving disc
 * profile. The full annulus is meshed (θ wraps) so no cyclic BC is
 * needed. Returns plain { vertices, tets } + the bore node list.
 */
export function annularDiscMesh(rBore, rRim, tHub, tRim, nr, nTheta, nz) {
  const vertices = [];
  const id = new Map();
  const key = (ir, it, iz) => ir * nTheta * (nz + 1) + (((it % nTheta) + nTheta) % nTheta) * (nz + 1) + iz;
  const vid = (ir, it, iz) => id.get(key(ir, it, iz));
  for (let ir = 0; ir <= nr; ir++) {
    const fr = ir / nr;
    const r = rBore + fr * (rRim - rBore);
    const th = tHub + fr * (tRim - tHub);
    for (let it = 0; it < nTheta; it++) {
      const ang = (it / nTheta) * 2 * Math.PI;
      const cx = Math.cos(ang), cy = Math.sin(ang);
      for (let iz = 0; iz <= nz; iz++) {
        const z = -th / 2 + (iz / nz) * th;
        id.set(key(ir, it, iz), vertices.length);
        vertices.push([r * cx, r * cy, z]);
      }
    }
  }
  const KUHN = [
    [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
    [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
  ];
  const tets = [];
  for (let ir = 0; ir < nr; ir++)
    for (let it = 0; it < nTheta; it++)
      for (let iz = 0; iz < nz; iz++) {
        const c = [
          vid(ir, it, iz), vid(ir + 1, it, iz), vid(ir, it + 1, iz), vid(ir + 1, it + 1, iz),
          vid(ir, it, iz + 1), vid(ir + 1, it, iz + 1), vid(ir, it + 1, iz + 1), vid(ir + 1, it + 1, iz + 1),
        ];
        for (const k of KUHN) tets.push([c[k[0]], c[k[1]], c[k[2]], c[k[3]]]);
      }
  const boreNodes = [];
  for (let it = 0; it < nTheta; it++)
    for (let iz = 0; iz <= nz; iz++) boreNodes.push(vid(0, it, iz));
  return { vertices, tets, boreNodes };
}

/** Total volume of a tet mesh (m³). */
function meshVolume(mesh) {
  let v = 0;
  for (const t of mesh.tets) {
    v += tetVolume(mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]], mesh.vertices[t[3]]);
  }
  return v;
}

/**
 * Consistent centrifugal nodal load set for a body spinning at ω about
 * the Z axis: each node carries F = m_node · ω² · r outward, where
 * m_node is the lumped (ρ·ΣVₑ/4) mass.
 */
function centrifugalLoads(mesh, density, omega) {
  const m = new Float64Array(mesh.vertices.length);
  for (const t of mesh.tets) {
    const Ve = tetVolume(mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]], mesh.vertices[t[3]]);
    const mn = density * Ve / 4;
    for (const n of t) m[n] += mn;
  }
  const loads = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    const x = mesh.vertices[i][0], y = mesh.vertices[i][1];
    const r = Math.hypot(x, y);
    if (r < 1e-9) continue;
    const F = m[i] * omega * omega * r;
    loads.push({ node: i, dof: 0, value: F * x / r });
    loads.push({ node: i, dof: 1, value: F * y / r });
  }
  return loads;
}

/**
 * Size a rotating disc by closing the centrifugal-stress loop.
 *
 * The design variable is the hub thickness `tHub`; the loop drives the
 * peak von-Mises stress to ~90 % of the temperature-derated material
 * allowable (yield / safetyFactor) — a passing AND weight-efficient
 * design, not merely a passing one.
 *
 * @param {object} o
 *   material        material key / Material   (default INCONEL_718)
 *   rpm             rotor speed                (default 10000)
 *   rBore_m         bore radius      (m)       (default 0.12)
 *   rRim_m          rim radius       (m)       (default 0.35)
 *   rimThickness_m  fixed rim thickness (m)    (default 0.020)
 *   operatingTempC  disc metal temperature     (default 550)
 *   safetyFactor    on yield                   (default 1.5)
 *   tHub0_m         starting hub thickness (m) (default 0.015 — deliberately thin)
 * @returns rich result with the closing-loop history
 */
export function sizeRotatingDisc(o = {}) {
  const mat = resolveMaterial(o.material);
  const rpm = o.rpm ?? 10000;
  const rBore = o.rBore_m ?? 0.12;
  const rRim = o.rRim_m ?? 0.35;
  const tRim = o.rimThickness_m ?? 0.020;
  const tempC = o.operatingTempC ?? 550;
  const SF = o.safetyFactor ?? 1.5;
  const omega = (rpm * 2 * Math.PI) / 60;

  const E = mat.E(tempC) * 1e6;                // Pa
  const nu = mat.nu(tempC);
  const density = mat.density;
  const allowablePa = (mat.yield(tempC) * 1e6) / SF;
  const targetRatio = 0.90;
  const tMin = tRim * 0.5, tMax = rRim * 0.9;   // hub-thickness design range

  const loop = runDesignLoop({
    params: { tHub: o.tHub0_m ?? 0.015 },
    maxIterations: o.maxIterations ?? 14,

    build: ({ tHub }) => annularDiscMesh(rBore, rRim, tHub, tRim, 6, 24, 3),

    analyse: (mesh) => {
      const loads = centrifugalLoads(mesh, density, omega);
      const fea = solveLinearStatic({
        mesh, material: { E, nu, density },
        fixedNodes: mesh.boundaryFixed ?? mesh.boreNodes,
        loads, options: { tol: 1e-8, maxIter: 8000 },
      });
      return {
        peakStressPa: fea.maxStress,
        peakStressMPa: fea.maxStress / 1e6,
        maxDisplacement_mm: fea.maxDisplacement * 1000,
        massKg: density * meshVolume(mesh),
        cgIterations: fea.cgIterations,
      };
    },

    judge: (a, p) => {
      const ratio = a.peakStressPa / allowablePa;
      const atMin = p.tHub <= tMin * 1.001;
      const atMax = p.tHub >= tMax * 0.999;
      const safe = ratio <= 1.0;
      const efficient = ratio >= 0.78;
      // Done when the part is safe AND either weight-efficient or already
      // at a geometry limit (you cannot do better within the design var).
      const pass = safe && (efficient || atMin);
      let message;
      if (pass && !efficient) {
        message = `safe at minimum hub — ${a.peakStressMPa.toFixed(0)} MPa, `
          + `${(ratio * 100).toFixed(0)}% of allowable (geometry-limited)`;
      } else if (pass) {
        message = `peak ${a.peakStressMPa.toFixed(0)} MPa at `
          + `${(ratio * 100).toFixed(0)}% of allowable — accepted`;
      } else if (!safe && atMax) {
        message = `cannot pass — over-stressed (${(ratio * 100).toFixed(0)}%) `
          + `even at maximum hub thickness`;
      } else if (!safe) {
        message = `over-stressed: ${a.peakStressMPa.toFixed(0)} MPa = `
          + `${(ratio * 100).toFixed(0)}% of allowable`;
      } else {
        message = `over-built: ${(ratio * 100).toFixed(0)}% of allowable — trim the hub`;
      }
      return { pass, ratio, message };
    },

    // Peak bore stress falls roughly as the hub thickens; scale tHub to
    // move the stress ratio toward the target, clamped to the design range.
    redesign: ({ tHub }, judged) => {
      const next = tHub * Math.max(0.45, Math.min(2.4, judged.ratio / targetRatio));
      return { tHub: Math.max(tMin, Math.min(tMax, next)) };
    },
  });

  const a = loop.analysis;
  return {
    part: 'rotating disc',
    material: mat.name,
    inputs: { rpm, rBore_m: rBore, rRim_m: rRim, rimThickness_m: tRim, operatingTempC: tempC, safetyFactor: SF },
    converged: loop.converged,
    iterations: loop.iterations,
    finalHubThickness_mm: loop.params.tHub * 1000,
    peakStressMPa: +a.peakStressMPa.toFixed(1),
    allowableMPa: +(allowablePa / 1e6).toFixed(1),
    utilisationPct: +((a.peakStressPa / allowablePa) * 100).toFixed(1),
    massKg: +a.massKg.toFixed(2),
    verdict: loop.judged.message,
    history: loop.history.map((h) => ({
      iteration: h.iteration,
      hubThickness_mm: +(h.params.tHub * 1000).toFixed(2),
      stressRatioPct: +(h.ratio * 100).toFixed(1),
      pass: h.pass,
    })),
  };
}
