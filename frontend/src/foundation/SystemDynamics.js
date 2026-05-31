/**
 * ArchDisc Foundation — system-level transient (dynamic) response.
 *
 * A product is not verified by testing its parts in isolation — the
 * assembled system has its own stiffness, its own mass, its own natural
 * frequency and its own transient response to a load. This module takes
 * the designed members of an assembly, combines their stiffnesses along
 * the real load path, and returns the assembled system's DYNAMIC
 * response — time-stepped, with a frame history so the motion of the
 * whole product can be rendered.
 *
 *   systemTransientResponse — reduced-order assembly dynamics:
 *     • each member's tip stiffness k = 3·E·I / L³  (cantilever)
 *     • members labelled "support" act in PARALLEL (they share the load)
 *     • a member labelled "span" acts in SERIES with the supports
 *       (the load passes through the span into the supports)
 *     • the carried mass on that combined stiffness is a 1-DOF
 *       oscillator → system natural frequency + transient response
 *
 * Honest scope: a reduced-order (1-DOF) assembly model — it captures the
 * combined stiffness, the system natural frequency and the dynamic
 * amplification of the assembled product. It is not a full assembled
 * finite-element model with joint compliance.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const G = 9.81;

/** Cantilever tip stiffness of an L×b×h member, SI. k = 3EI/L³ (N/m). */
function memberStiffness(member, E_Pa) {
  const L = member.L_mm / 1000, b = member.b_mm / 1000, h = member.h_mm / 1000;
  const I = (b * h * h * h) / 12;
  return (3 * E_Pa * I) / (L * L * L);
}

/**
 * Assembled-system transient response.
 *
 * @param {object} o
 *   members      [{ name, role, L_mm, b_mm, h_mm }]  role: 'support' | 'span'
 *   totalLoad_N  the load the assembled product carries (N)
 *   E_MPa        member modulus (default 69000, Al)
 *   dampingRatio viscous ζ (default 0.03)
 *   periods, framesPerPeriod  time sampling
 * @returns system dynamics + a renderable frame history
 */
export function systemTransientResponse(o = {}) {
  const members = o.members || [];
  if (!members.length) throw new Error('systemTransientResponse: no members');
  const E = (o.E_MPa ?? 69000) * 1e6;
  const totalLoad = o.totalLoad_N ?? 600;
  const zeta = Math.max(1e-4, Math.min(0.5, o.dampingRatio ?? 0.03));
  const nPeriods = o.periods ?? 5;
  const fpp = o.framesPerPeriod ?? 16;

  // Each member's stiffness, grouped by role.
  const stiff = members.map((m) => ({
    name: m.name, role: m.role || 'support', k: memberStiffness(m, E),
    L_mm: m.L_mm, b_mm: m.b_mm, h_mm: m.h_mm,
  }));
  const supports = stiff.filter((s) => s.role === 'support');
  const spans = stiff.filter((s) => s.role === 'span');

  // Supports in parallel; a span (if any) in series with them.
  const kSupports = supports.reduce((a, s) => a + s.k, 0)
    || stiff.reduce((a, s) => a + s.k, 0);          // fallback: all parallel
  const kSpan = spans.length ? spans.reduce((a, s) => a + s.k, 0) : Infinity;
  const kSystem = 1 / (1 / kSpan + 1 / kSupports);

  const M = totalLoad / G;                          // carried mass (kg)
  const omega = Math.sqrt(kSystem / M);
  const f = omega / (2 * Math.PI);
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const period = (2 * Math.PI) / omegaD;
  const deltaStatic = totalLoad / kSystem;          // m

  const resp = (t) => 1 - Math.exp(-zeta * omega * t)
    * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t));

  const frames = [];
  let peak = 0;
  const total = nPeriods * fpp;
  for (let i = 0; i <= total; i++) {
    const t = (i / fpp) * period;
    const r = resp(t);
    if (r > peak) peak = r;
    frames.push({ t, systemDeflection_mm: deltaStatic * r * 1000, ratio: r });
  }
  const DAF = peak;

  return {
    memberCount: members.length,
    systemStiffness_N_per_mm: +(kSystem / 1000).toFixed(1),
    carriedMass_kg: +M.toFixed(1),
    systemNaturalFrequencyHz: +f.toFixed(2),
    staticDeflection_mm: +(deltaStatic * 1000).toFixed(3),
    peakDynamicDeflection_mm: +(deltaStatic * DAF * 1000).toFixed(3),
    dynamicAmplificationFactor: +DAF.toFixed(3),
    settledRatio: +frames[frames.length - 1].ratio.toFixed(3),
    members: stiff.map((s) => ({
      name: s.name, role: s.role, stiffness_N_per_mm: +(s.k / 1000).toFixed(1),
    })),
    frameCount: frames.length,
    frames,
  };
}
