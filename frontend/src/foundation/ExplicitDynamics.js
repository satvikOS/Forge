/**
 * ArchDisc Foundation — general explicit-dynamics impact solver.
 *
 * A transient solver for impact events — bird strike, fan-blade-out
 * debris, drop tests, crash. It is GENERAL: any body discretised as a
 * mass-spring network, struck by any rigid impactor.
 *
 * Model: nodes carry mass + velocity; springs carry axial stiffness and
 * an optional break strain (damage). A rigid spherical impactor
 * contacts body nodes through a penalty force. Time integration is
 * semi-implicit (symplectic) Euler — energy-stable for spring networks
 * when dt < 2√(m/k_max).
 *
 * Honest scope: this is an engineering-grade lumped-parameter explicit
 * solver. It shows the real transient deformation, energy transfer,
 * contact-force history and spring-level damage. It is NOT a continuum
 * finite-element explicit code (LS-DYNA / Abaqus-Explicit grade) — no
 * 3-D stress field, no plasticity, no self-contact.
 *
 * Validated (see e2e): energy conservation of a free oscillator to <1%,
 * momentum conservation through an impact, and 1-D wave speed matching
 * c = √(k·L₀²/m).
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Build a flat rectangular mass-spring panel in the XY plane (z=0),
 * nx×ny nodes, with structural + diagonal (shear) springs. The four
 * edges are clamped.
 *
 * @returns {{ nodes, springs }}
 */
export function gridPanel(opts = {}) {
  const nx = opts.nx ?? 9, ny = opts.ny ?? 9;
  const spacing = opts.spacing ?? 0.02;        // m (SI throughout)
  const nodeMass = opts.nodeMass ?? 0.05;      // kg
  const k = opts.stiffness ?? 8000;            // N/m
  const breakStrain = opts.breakStrain ?? null;
  const nodes = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      nodes.push({
        pos: [i * spacing, j * spacing, 0],
        vel: [0, 0, 0],
        mass: nodeMass,
        fixed: edge,
      });
    }
  }
  const idx = (i, j) => j * nx + i;
  const springs = [];
  const link = (a, b) => {
    const L0 = norm(sub(nodes[b].pos, nodes[a].pos));
    springs.push({ a, b, k, L0, breakStrain, broken: false });
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i + 1 < nx) link(idx(i, j), idx(i + 1, j));            // structural X
      if (j + 1 < ny) link(idx(i, j), idx(i, j + 1));            // structural Y
      if (i + 1 < nx && j + 1 < ny) {                            // shear diagonals
        link(idx(i, j), idx(i + 1, j + 1));
        link(idx(i + 1, j), idx(i, j + 1));
      }
    }
  }
  return { nodes, springs };
}

/** Total linear momentum (nodes + impactor). */
function momentum(nodes, impactor) {
  const p = [0, 0, 0];
  for (const n of nodes) for (let c = 0; c < 3; c++) p[c] += n.mass * n.vel[c];
  if (impactor) for (let c = 0; c < 3; c++) p[c] += impactor.mass * impactor.vel[c];
  return p;
}

/** Total kinetic + spring potential energy of the model (impactor included). */
function energy(nodes, springs, impactor) {
  let KE = 0;
  for (const n of nodes) KE += 0.5 * n.mass * (n.vel[0] ** 2 + n.vel[1] ** 2 + n.vel[2] ** 2);
  if (impactor) {
    KE += 0.5 * impactor.mass
      * (impactor.vel[0] ** 2 + impactor.vel[1] ** 2 + impactor.vel[2] ** 2);
  }
  let PE = 0;
  for (const s of springs) {
    if (s.broken) continue;
    const L = norm(sub(nodes[s.b].pos, nodes[s.a].pos));
    PE += 0.5 * s.k * (L - s.L0) ** 2;
  }
  return { KE, PE, total: KE + PE };
}

/**
 * Run an explicit-dynamics impact simulation.
 *
 * @param {object} model
 *   nodes, springs           — the deformable body (see gridPanel)
 *   impactor?                — { pos, vel, mass, radius }  rigid sphere
 *   damping?                 — viscous coefficient (N·s/m), default 0
 *   contactStiffness?        — penalty contact stiffness (N/m)
 * @param {object} opts       — { dt, steps, recordEvery }
 * @returns {{ frames, summary }}
 */
export function simulateImpact(model, opts = {}) {
  const nodes = model.nodes.map((n) => ({
    pos: [...n.pos], vel: [...n.vel], mass: n.mass, fixed: !!n.fixed,
  }));
  const springs = model.springs.map((s) => ({ ...s, broken: false }));
  const impactor = model.impactor
    ? { pos: [...model.impactor.pos], vel: [...model.impactor.vel],
        mass: model.impactor.mass, radius: model.impactor.radius }
    : null;
  const damping = model.damping ?? 0;
  const contactK = model.contactStiffness ?? 5e5;
  const nodeRadius = model.nodeRadius ?? 0;

  const dt = opts.dt ?? 2e-5;
  const steps = opts.steps ?? 4000;
  const recordEvery = opts.recordEvery ?? Math.max(1, Math.floor(steps / 60));

  const frames = [];
  let peakContactForce = 0, peakDeflection = 0;
  const e0 = energy(nodes, springs, impactor);
  const p0 = momentum(nodes, impactor);
  const impactorV0 = impactor ? norm(impactor.vel) : 0;

  for (let step = 0; step <= steps; step++) {
    const F = nodes.map(() => [0, 0, 0]);
    // Spring forces (+ damage check).
    for (const s of springs) {
      if (s.broken) continue;
      const d = sub(nodes[s.b].pos, nodes[s.a].pos);
      const L = norm(d) || 1e-9;
      const strain = (L - s.L0) / s.L0;
      if (s.breakStrain != null && Math.abs(strain) > s.breakStrain) { s.broken = true; continue; }
      const fmag = s.k * (L - s.L0);
      const u = [d[0] / L, d[1] / L, d[2] / L];
      for (let c = 0; c < 3; c++) {
        F[s.a][c] += fmag * u[c];
        F[s.b][c] -= fmag * u[c];
      }
    }
    // Penalty contact with the rigid impactor.
    let impactorForce = [0, 0, 0];
    let contactForce = 0;
    if (impactor) {
      for (let i = 0; i < nodes.length; i++) {
        const d = sub(nodes[i].pos, impactor.pos);
        const dist = norm(d) || 1e-9;
        const pen = (impactor.radius + nodeRadius) - dist;
        if (pen > 0) {
          const cf = contactK * pen;
          contactForce += cf;
          const u = [d[0] / dist, d[1] / dist, d[2] / dist];
          for (let c = 0; c < 3; c++) {
            F[i][c] += cf * u[c];
            impactorForce[c] -= cf * u[c];
          }
        }
      }
    }
    peakContactForce = Math.max(peakContactForce, contactForce);
    // Integrate body nodes — semi-implicit Euler with viscous damping.
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.fixed) { n.vel = [0, 0, 0]; continue; }
      for (let c = 0; c < 3; c++) {
        const a = (F[i][c] - damping * n.vel[c]) / n.mass;
        n.vel[c] += a * dt;
        n.pos[c] += n.vel[c] * dt;
      }
      // Track structural deflection only — a node that has flown past
      // 0.5 m is a detached fragment, not deformation of the structure.
      if (Math.abs(n.pos[2]) < 0.5) {
        peakDeflection = Math.max(peakDeflection, Math.abs(n.pos[2]));
      }
    }
    // Integrate the impactor.
    if (impactor) {
      for (let c = 0; c < 3; c++) {
        impactor.vel[c] += (impactorForce[c] / impactor.mass) * dt;
        impactor.pos[c] += impactor.vel[c] * dt;
      }
    }
    if (step % recordEvery === 0) {
      const e = energy(nodes, springs, impactor);
      frames.push({
        t: step * dt,
        nodePos: nodes.map((n) => [...n.pos]),
        impactorPos: impactor ? [...impactor.pos] : null,
        contactForce, KE: e.KE, PE: e.PE, total: e.total,
      });
    }
  }
  const eN = energy(nodes, springs, impactor);
  const pN = momentum(nodes, impactor);
  const brokenSprings = springs.filter((s) => s.broken).length;
  return {
    frames,
    summary: {
      method: 'explicit mass-spring transient dynamics (engineering-grade, not continuum FE)',
      steps, dt, simTime: steps * dt,
      energyStart: e0.total, energyEnd: eN.total,
      energyDriftPct: e0.total > 0 ? 100 * (eN.total - e0.total) / e0.total : 0,
      momentumStart: p0, momentumEnd: pN,
      momentumDrift: norm(sub(pN, p0)),
      peakContactForce_N: peakContactForce,
      peakDeflection_mm: peakDeflection * 1000,
      impactorVelStart: impactorV0,
      impactorVelEnd: impactor ? norm(impactor.vel) : 0,
      energyAbsorbed_J: impactor ? 0.5 * impactor.mass * (impactorV0 ** 2 - norm(impactor.vel) ** 2) : 0,
      brokenSprings, totalSprings: springs.length,
    },
  };
}

/** 1-D spring-chain wave speed c = √(k·L₀²/m) — closed-form reference. */
export function springChainWaveSpeed(k, L0, m) {
  return Math.sqrt(k * L0 * L0 / m);
}
