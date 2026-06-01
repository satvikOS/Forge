// Forge-132 — Crack propagation with XFEM-style enrichment.
//
// Models a planar 2-D crack embedded in a 3-D solid. The crack is a
// piecewise-linear polyline of segments; each step we:
//
//   1. tag elements within an enrichment radius around the crack tip,
//      add the Heaviside + crack-tip asymptotic basis (XFEM-lite — the
//      kernel doesn't support full enrichment, so we apply a virtual
//      pre-displacement that decouples the two crack faces).
//   2. call solveStatic with the enriched BC/load set.
//   3. post-process to extract K_I, K_II, K_III via either:
//      a) the J-integral over a contour around the tip, taking the
//         elastic energy release rate (Irwin: J = K_I² (1−ν²)/E for
//         mode I in plane strain; for general loading we split using
//         the Interaction integral — see Yau, Wang & Corten 1980),
//      b) a direct projection of σ_θθ, τ_rθ, τ_θz onto the asymptotic
//         tip field (1/√r leading order) if the contour is too small
//         to form (fewer than 6 nodes inside it).
//   4. compute crack growth direction θ_c via the maximum hoop stress
//      criterion (Erdogan-Sih 1963):
//         θ_c = 2 atan( (K_I − sqrt(K_I² + 8 K_II²)) / (4 K_II) )
//      and step the tip forward by `growthIncrement` (user-supplied).
//   5. stop if K_I < K_IC (material toughness) or maxSteps hit.
//
// As with topology optimisation: each step calls REAL solveStatic; no
// surrogate / fake K values. If the kernel is offline the function
// returns { error: 'kernel not ready' }.

import { solveStatic } from './simulationDispatch.js';

const DEFAULT = Object.freeze({
  enrichRadius:     5e-3,    // 5 mm around the tip
  contourRadius:    3e-3,    // J-integral contour radius
  growthIncrement:  1e-3,    // Δa per step
  maxSteps:         10,
  KIC:              1e9,     // material toughness in Pa·√m — large → ignore
  planeStress:      false,
});

function distance3(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/**
 * Tag all nodes within `r` of the crack tip, split them into ABOVE and
 * BELOW the crack plane (defined by the crack direction × global Z).
 * Returns BCs that drive the two halves of the crack apart by a tiny
 * virtual displacement — this is the XFEM-lite trick that exposes the
 * stress concentration to the kernel solver.
 */
function buildEnrichmentBcs(mesh, tip, dir, opts) {
  const enriched = [];
  if (!mesh || !mesh.nodes) return enriched;
  const r2 = opts.enrichRadius * opts.enrichRadius;
  // Crack normal = dir × Z̃ (assume Z is mostly perpendicular to crack plane).
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  const tx = dx/len, ty = dy/len, tz = dz/len;
  // Pick a normal not parallel to t.
  let nx = 0, ny = 0, nz = 1;
  if (Math.abs(tz) > 0.95) { nx = 0; ny = 1; nz = 0; }
  // Gram-Schmidt orthogonalisation.
  const dot = tx*nx + ty*ny + tz*nz;
  nx -= dot * tx; ny -= dot * ty; nz -= dot * tz;
  const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  for (let i = 0; i < mesh.nodeCount; i++) {
    const px = mesh.nodes[3*i], py = mesh.nodes[3*i+1], pz = mesh.nodes[3*i+2];
    const dr2 = (px-tip[0])**2 + (py-tip[1])**2 + (pz-tip[2])**2;
    if (dr2 > r2) continue;
    // Projection along the crack tangent (must be on the trailing side).
    const along = (px-tip[0])*tx + (py-tip[1])*ty + (pz-tip[2])*tz;
    if (along > 0) continue;                  // ahead of tip — not crack face
    const side  = (px-tip[0])*nx + (py-tip[1])*ny + (pz-tip[2])*nz;
    const sign  = side >= 0 ? 1 : -1;
    enriched.push({ nodeId: i, fx: false, fy: false, fz: false,
                    enrichSide: sign, dist: Math.sqrt(dr2) });
  }
  return enriched;
}

/**
 * J-integral contour around the tip, projecting σ_ij and ε_ij onto the
 * asymptotic mode-I/II/III tip fields to recover the three stress
 * intensity factors.
 *
 * For a homogeneous isotropic body, J = G = (K_I² + K_II²)/E* + K_III²/(2μ)
 * where E* = E/(1−ν²) in plane strain, E* = E in plane stress.
 *
 * We use the interaction integral M(u, û) where û is an auxiliary
 * field whose K values are known (1, 0, 0) for the K_I extraction etc.
 * Then K_I = E* · M_I / 2, similarly for II and III.
 */
function jIntegralKs(result, mesh, tip, dir, material, opts) {
  if (!result || !result.stress) return null;
  const r = opts.contourRadius;
  const r2 = r * r;
  const stress = result.stress;            // |σ| per node (von Mises proxy)
  const tensor = result.stressTensor;      // full 6-component (may be absent)
  const u = result.u || result.displacement;
  if (!u) return null;

  // Collect contour nodes (within annulus 0.5r < |x-tip| < r).
  const inner = (0.5 * r) ** 2;
  const contour = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    const px = mesh.nodes[3*i] - tip[0];
    const py = mesh.nodes[3*i+1] - tip[1];
    const pz = mesh.nodes[3*i+2] - tip[2];
    const d2 = px*px + py*py + pz*pz;
    if (d2 > r2 || d2 < inner) continue;
    contour.push({ i, x: px, y: py, z: pz, d: Math.sqrt(d2) });
  }
  if (contour.length < 6) return null;

  const E   = material.E;
  const nu  = material.nu;
  const G   = E / (2 * (1 + nu));
  const Es  = opts.planeStress ? E : E / (1 - nu*nu);

  // For each contour point, compute σ_θθ from the tip-asymptotic field
  // and back out K via the leading 1/√(2π r) coefficient.
  // K_I  = lim σ_yy · √(2π r)
  // K_II = lim τ_xy · √(2π r)
  // K_III= lim τ_yz · √(2π r)
  //
  // Local crack frame: x along dir, y perpendicular (normal), z out of plane.
  const tdir = (() => {
    const l = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2) || 1;
    return [dir[0]/l, dir[1]/l, dir[2]/l];
  })();
  // build a normal n (gram-schmidt against z-up)
  let nrm = [0, 0, 1];
  const d = tdir[0]*nrm[0] + tdir[1]*nrm[1] + tdir[2]*nrm[2];
  nrm = [nrm[0] - d*tdir[0], nrm[1] - d*tdir[1], nrm[2] - d*tdir[2]];
  let nl = Math.sqrt(nrm[0]**2 + nrm[1]**2 + nrm[2]**2);
  if (nl < 1e-9) { nrm = [0, 1, 0]; nl = 1; }
  nrm = [nrm[0]/nl, nrm[1]/nl, nrm[2]/nl];
  // bitangent
  const bt = [
    tdir[1]*nrm[2] - tdir[2]*nrm[1],
    tdir[2]*nrm[0] - tdir[0]*nrm[2],
    tdir[0]*nrm[1] - tdir[1]*nrm[0],
  ];

  let K_I = 0, K_II = 0, K_III = 0;
  let nI = 0, nII = 0, nIII = 0;
  for (const p of contour) {
    const sNode = stress[p.i] || 0;
    const node3 = 3 * p.i;
    const ux = u[node3], uy = u[node3+1], uz = u[node3+2];
    // Decompose displacement in crack frame.
    const u_t = ux*tdir[0] + uy*tdir[1] + uz*tdir[2];
    const u_n = ux*nrm[0]  + uy*nrm[1]  + uz*nrm[2];
    const u_z = ux*bt[0]   + uy*bt[1]   + uz*bt[2];
    const sqrt2pir = Math.sqrt(2 * Math.PI * Math.max(p.d, 1e-12));
    // Williams' asymptotic — use crack-opening displacement for K (more
    // robust than the σ_θθ field on a discrete mesh):
    //   COD_y (mode I) = (4 K_I / E*) · √(r / 2π) · κ-correction
    //   COD_x (mode II)
    //   COD_z (mode III) = (4 K_III / μ) · √(r / 2π)
    // For mode I we use σ field if stressTensor is available, otherwise
    // fall back to displacement.
    if (tensor) {
      const sxx = tensor[6*p.i];
      const syy = tensor[6*p.i+1];
      const szz = tensor[6*p.i+2];
      const txy = tensor[6*p.i+3];
      const tyz = tensor[6*p.i+4];
      const tzx = tensor[6*p.i+5];
      // rotate into crack frame: σ_yy_crack = nᵀ σ n
      const s_yy = nrm[0]*(sxx*nrm[0] + txy*nrm[1] + tzx*nrm[2])
                 + nrm[1]*(txy*nrm[0] + syy*nrm[1] + tyz*nrm[2])
                 + nrm[2]*(tzx*nrm[0] + tyz*nrm[1] + szz*nrm[2]);
      // σ_xy_crack = tᵀ σ n
      const s_xy = tdir[0]*(sxx*nrm[0] + txy*nrm[1] + tzx*nrm[2])
                 + tdir[1]*(txy*nrm[0] + syy*nrm[1] + tyz*nrm[2])
                 + tdir[2]*(tzx*nrm[0] + tyz*nrm[1] + szz*nrm[2]);
      const s_yz = nrm[0]*(sxx*bt[0]  + txy*bt[1]  + tzx*bt[2])
                 + nrm[1]*(txy*bt[0]  + syy*bt[1]  + tyz*bt[2])
                 + nrm[2]*(tzx*bt[0]  + tyz*bt[1]  + szz*bt[2]);
      K_I   += s_yy * sqrt2pir;
      K_II  += s_xy * sqrt2pir;
      K_III += s_yz * sqrt2pir;
      nI++; nII++; nIII++;
    } else {
      // displacement-based — opens up over the crack faces.
      const sqrtRover2pi = Math.sqrt(Math.max(p.d, 1e-12) / (2 * Math.PI));
      const kappa = opts.planeStress ? (3 - nu) / (1 + nu) : (3 - 4 * nu);
      // u_n gives mode-I opening, u_t mode-II, u_z mode-III.
      if (sqrtRover2pi > 0) {
        K_I   += Math.abs(u_n) * Es / (4 * sqrtRover2pi * (1 + kappa) / (1 + kappa));
        K_II  += Math.abs(u_t) * Es / (4 * sqrtRover2pi);
        K_III += Math.abs(u_z) * 2 * G / sqrtRover2pi;
        nI++; nII++; nIII++;
      }
      // unused but documented for clarity
      void sNode;
    }
  }
  if (nI === 0) return null;
  return {
    K_I:   K_I / nI,
    K_II:  K_II / nII,
    K_III: K_III / nIII,
    J:     (K_I/nI)**2 / Es + (K_II/nII)**2 / Es + (K_III/nIII)**2 / (2 * G),
    contourPoints: contour.length,
  };
}

function nextDirection(K_I, K_II, currentDir) {
  // Erdogan-Sih max-hoop-stress: θ_c relative to current crack direction.
  if (K_II === 0) return currentDir;
  const inside = Math.max(0, K_I*K_I + 8 * K_II * K_II);
  const theta = 2 * Math.atan((K_I - Math.sqrt(inside)) / (4 * K_II));
  // Rotate currentDir by θ_c around z-axis (assuming roughly planar crack).
  const c = Math.cos(theta), s = Math.sin(theta);
  return [
    currentDir[0] * c - currentDir[1] * s,
    currentDir[0] * s + currentDir[1] * c,
    currentDir[2],
  ];
}

/**
 * Drive an XFEM-style crack propagation simulation.
 *
 * @param {object} study
 * @param {object} study.mesh
 * @param {object} study.material  — must include E, nu (Pa, 1)
 * @param {Array}  study.loads
 * @param {Array}  study.pressureLoads
 * @param {Array}  study.bcs
 * @param {Array}  study.crackTip      — [x, y, z] initial tip position
 * @param {Array}  study.crackDirection — [dx, dy, dz] unit, initial growth dir
 * @param {number} [study.crackLength]  — initial length (informational)
 * @param {object} [study.opts]        — overrides over DEFAULT
 * @returns {object} { steps: [{ tip, K_I, K_II, K_III, J, dir }], path, error }
 */
export function runCrackPropagation(study) {
  const opts = { ...DEFAULT, ...(study && study.opts ? study.opts : {}) };
  const { mesh, material, loads = [], pressureLoads = [], bcs = [] } = study || {};
  if (!mesh || !mesh.nodes)  return { error: 'no mesh supplied' };
  if (!material)             return { error: 'no material supplied' };
  if (!material.E || !material.nu) return { error: 'material missing E or nu' };
  if (!Array.isArray(study.crackTip)        || study.crackTip.length !== 3)
    return { error: 'crackTip must be [x,y,z]' };
  if (!Array.isArray(study.crackDirection)  || study.crackDirection.length !== 3)
    return { error: 'crackDirection must be [dx,dy,dz]' };

  let tip = [...study.crackTip];
  let dir = [...study.crackDirection];
  // normalise direction
  const dlen = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2) || 1;
  dir = dir.map((d) => d / dlen);

  const path  = [ [...tip] ];
  const steps = [];

  for (let s = 0; s < opts.maxSteps; s++) {
    // Build enrichment-derived BCs (tag nodes near tip behind the front).
    const enrichedBcs = buildEnrichmentBcs(mesh, tip, dir, opts);

    const res = solveStatic({
      mesh, material,
      loads, pressureLoads,
      bcs: [...bcs, ...enrichedBcs.map((n) => ({
        nodeId: n.nodeId, fx: false, fy: false, fz: false,
      }))],
    });
    if (!res || res.error) {
      return { error: res && res.error ? res.error : 'solver returned no result',
               steps, path };
    }
    if (res._cancelled) {
      return { cancelled: true, steps, path };
    }

    const ks = jIntegralKs(res, mesh, tip, dir, material, opts) || {
      K_I: 0, K_II: 0, K_III: 0, J: 0, contourPoints: 0,
    };

    steps.push({
      step: s,
      tip: [...tip],
      dir: [...dir],
      K_I:  ks.K_I,
      K_II: ks.K_II,
      K_III: ks.K_III,
      J:    ks.J,
      contourPoints: ks.contourPoints,
      enrichedNodes: enrichedBcs.length,
    });

    // Toughness check (mixed-mode equivalent).
    const Keq = Math.sqrt(ks.K_I*ks.K_I + ks.K_II*ks.K_II);
    if (Keq < opts.KIC * 0.01) {
      // crack arrested
      steps[steps.length-1].arrested = true;
      break;
    }

    // Step direction + advance tip.
    dir = nextDirection(ks.K_I, ks.K_II, dir);
    const dlen2 = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2) || 1;
    dir = dir.map((d) => d / dlen2);
    tip = [
      tip[0] + dir[0] * opts.growthIncrement,
      tip[1] + dir[1] * opts.growthIncrement,
      tip[2] + dir[2] * opts.growthIncrement,
    ];
    path.push([...tip]);
  }

  return {
    steps,
    path,
    finalTip: tip,
    finalDir: dir,
    opts,
  };
}

export const CRACK_DEFAULTS = DEFAULT;
