/**
 * ArchDisc Foundation — transient (dynamic) structural response.
 *
 * A static FEA gives one stress number for one instant. A real test is
 * dynamic: the load arrives in time, the part accelerates, deflects past
 * its static position, oscillates, and settles. The peak DYNAMIC stress
 * is what the part must survive — for a suddenly-applied load it is up to
 * ~2× the static value (the dynamic amplification factor).
 *
 *   transientCantilever — the time response of a cantilever (a bracket /
 *   beam, L×b×h) to a step tip load. First-mode model:
 *
 *     ω₁ = (1.875104)² · √( E·I / (ρ·A·L⁴) )        natural frequency
 *     δ_static = P·L³ / (3·E·I)                      static tip deflection
 *     δ(t) = δ_static · [ 1 − e^(−ζω₁t)( cos ω_d t + (ζ/√(1−ζ²)) sin ω_d t ) ]
 *
 *   It returns a frame-by-frame time history — the deflected centreline
 *   at each instant — so the motion can be rendered as an animation, and
 *   a dynamic safety factor from the peak dynamic stress.
 *
 * Honest scope: a single-mode (fundamental) transient model with viscous
 * damping. It captures the dominant dynamic amplification and the
 * oscillation/settling; it is not a full multi-mode transient FE solve.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const BETA1 = 1.875104;   // first cantilever eigenvalue (β₁·L)

/**
 * Transient response of an L×b×h cantilever to a step tip load P.
 *
 * @param {object} o
 *   L_mm, b_mm, h_mm   cantilever length / width / height (mm)
 *   P_N                tip load, suddenly applied (N)
 *   E_MPa              Young's modulus (MPa)
 *   density            kg/m³                       (default 2700, Al)
 *   yield_MPa          material yield               (default 276)
 *   dampingRatio       viscous ζ                    (default 0.02)
 *   periods            how many oscillation periods to simulate (default 5)
 *   framesPerPeriod    time samples per period      (default 16)
 * @returns dynamic result + a renderable frame history
 */
export function transientCantilever(o = {}) {
  const L = (o.L_mm ?? 120) / 1000;
  const b = (o.b_mm ?? 40) / 1000;
  const h = (o.h_mm ?? 6) / 1000;
  const P = o.P_N ?? 1000;
  const E = (o.E_MPa ?? 69000) * 1e6;
  const rho = o.density ?? 2700;
  const yieldPa = (o.yield_MPa ?? 276) * 1e6;
  const zeta = Math.max(1e-4, Math.min(0.5, o.dampingRatio ?? 0.02));
  const nPeriods = o.periods ?? 5;
  const fpp = o.framesPerPeriod ?? 16;

  const A = b * h;
  const I = (b * h * h * h) / 12;
  const omega1 = BETA1 * BETA1 * Math.sqrt((E * I) / (rho * A * L * L * L * L));
  const f1 = omega1 / (2 * Math.PI);
  const omegaD = omega1 * Math.sqrt(1 - zeta * zeta);
  const period = (2 * Math.PI) / omegaD;

  const deltaStatic = (P * L * L * L) / (3 * E * I);          // m
  const sigmaStatic = ((P * L) * (h / 2)) / I;                // Pa, root bending

  // Unit step response of an under-damped 1-DOF oscillator.
  const resp = (t) => 1 - Math.exp(-zeta * omega1 * t)
    * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t));
  // Static cantilever deflected shape, normalised to the tip (u = x/L).
  const shapeFn = (u) => (3 * u * u - u * u * u) / 2;

  const nShape = 12;
  const frames = [];
  let peakRatio = 0;
  const totalFrames = nPeriods * fpp;
  for (let i = 0; i <= totalFrames; i++) {
    const t = (i / fpp) * period;
    const r = resp(t);
    if (r > peakRatio) peakRatio = r;
    const tip_mm = deltaStatic * r * 1000;
    const shape = [];
    for (let s = 0; s <= nShape; s++) {
      const u = s / nShape;
      shape.push([u * L * 1000, shapeFn(u) * tip_mm]);   // [x_mm, y_mm]
    }
    frames.push({ t, tipDeflection_mm: tip_mm, ratio: r, shape });
  }

  const DAF = peakRatio;                                  // dynamic amplification
  const peakStressPa = sigmaStatic * DAF;
  const dynamicSF = peakStressPa > 0 ? yieldPa / peakStressPa : Infinity;

  return {
    naturalFrequencyHz: +f1.toFixed(2),
    periodS: +period.toFixed(5),
    staticDeflection_mm: +(deltaStatic * 1000).toFixed(4),
    peakDynamicDeflection_mm: +(deltaStatic * DAF * 1000).toFixed(4),
    dynamicAmplificationFactor: +DAF.toFixed(3),
    staticStressMPa: +(sigmaStatic / 1e6).toFixed(2),
    peakDynamicStressMPa: +(peakStressPa / 1e6).toFixed(2),
    dynamicSafetyFactor: +dynamicSF.toFixed(3),
    settledRatio: +frames[frames.length - 1].ratio.toFixed(3),
    frameCount: frames.length,
    frames,
  };
}

/**
 * Rotordynamic critical (whirl) speed of a simply-supported shaft with a
 * mid-span disk — the Jeffcott rotor. The lowest lateral natural
 * frequency is the synchronous critical speed; the rotor must run
 * sub-critical (operating speed safely below it).
 *
 *   k     = 48·E·I / L³            mid-span lateral stiffness (N/m)
 *   m_eff = m_disk + ½·m_shaft     effective mid-span mass
 *   f₁    = (1/2π)·√(k / m_eff)    first whirl frequency
 *   Ω_cr  = 60·f₁                  critical speed (RPM)
 *
 * Strict SI internally (this is the correct-units rotordynamic check —
 * ArchDisc's older `Rotordynamics` tool mixes N/mm with kg and reports
 * critical speeds ~475× low; use this instead).
 *
 * @param {object} o
 *   length_mm, diameter_mm     shaft geometry
 *   E_MPa                      modulus (default 200000, steel)
 *   density_kg_m3              shaft density (default 7850, steel)
 *   diskMass_kg                mid-span rotor mass (default 5)
 *   operatingRPM               the speed it must run at (default 3000)
 */
export function shaftCriticalSpeed(o = {}) {
  const L = (o.length_mm ?? 600) / 1000;
  const D = (o.diameter_mm ?? 30) / 1000;
  const E = (o.E_MPa ?? 200000) * 1e6;
  const rho = o.density_kg_m3 ?? 7850;
  const diskMass = o.diskMass_kg ?? 5;
  const operatingRPM = o.operatingRPM ?? 3000;

  const A = (Math.PI * D * D) / 4;
  const I = (Math.PI * Math.pow(D, 4)) / 64;
  const k = (48 * E * I) / (L * L * L);                  // N/m
  const shaftMass = rho * A * L;
  const mEff = diskMass + 0.5 * shaftMass;
  const omega = Math.sqrt(k / mEff);
  const f1 = omega / (2 * Math.PI);
  const criticalRPM = 60 * f1;

  return {
    diameter_mm: o.diameter_mm ?? 30,
    length_mm: o.length_mm ?? 600,
    firstWhirlHz: +f1.toFixed(2),
    criticalSpeedRPM: +criticalRPM.toFixed(0),
    operatingRPM,
    marginRatio: +(criticalRPM / operatingRPM).toFixed(3),
    subcritical: criticalRPM > operatingRPM,
    shaftMass_kg: +shaftMass.toFixed(2),
    midspanStiffness_N_per_mm: +(k / 1000).toFixed(1),
  };
}

/**
 * Transient (dynamic) response of a clamped square panel to a suddenly
 * applied uniform pressure — a pressure-loaded plate archetype (a cover,
 * a bulkhead, a tank wall). Distinct from a point-loaded beam.
 *
 *   D     = E·t³ / (12(1−ν²))                       flexural rigidity
 *   δ     = 0.00126·P·a⁴ / D                         static centre deflection
 *   σ     = 0.308·P·(a/t)²                           static peak (mid-edge) stress
 *   f₁    = (35.99/2π)·√(D / (ρ·t·a⁴))               fundamental frequency
 *   peak dynamic = static × DAF (≈2 for a step load)
 *
 * Strict SI internally. Honest scope: thin-plate (Kirchhoff) theory with
 * the standard clamped-square coefficients + a single-mode dynamic
 * amplification — design-grade, not a full plate FE transient.
 *
 * @param {object} o
 *   side_mm, thickness_mm   panel geometry
 *   pressure_kPa            suddenly-applied uniform pressure
 *   E_MPa, nu, yield_MPa    material (default Al 6061)
 *   density, dampingRatio
 */
export function transientPressurePanel(o = {}) {
  const a = (o.side_mm ?? 200) / 1000;
  const t = (o.thickness_mm ?? 5) / 1000;
  const P = (o.pressure_kPa ?? 100) * 1000;
  const E = (o.E_MPa ?? 69000) * 1e6;
  const nu = o.nu ?? 0.33;
  const rho = o.density ?? 2700;
  const yieldPa = (o.yield_MPa ?? 276) * 1e6;
  const zeta = Math.max(1e-4, Math.min(0.5, o.dampingRatio ?? 0.02));

  const Dr = (E * Math.pow(t, 3)) / (12 * (1 - nu * nu));
  const deltaStatic = (0.00126 * P * Math.pow(a, 4)) / Dr;
  const sigmaStatic = 0.308 * P * Math.pow(a / t, 2);
  const f1 = (35.99 / (2 * Math.PI)) * Math.sqrt(Dr / (rho * t * Math.pow(a, 4)));
  const DAF = 1 + Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
  const peakStressPa = sigmaStatic * DAF;
  const dynamicSF = peakStressPa > 0 ? yieldPa / peakStressPa : Infinity;

  return {
    side_mm: o.side_mm ?? 200,
    thickness_mm: o.thickness_mm ?? 5,
    naturalFrequencyHz: +f1.toFixed(1),
    staticDeflection_mm: +(deltaStatic * 1000).toFixed(3),
    peakDynamicDeflection_mm: +(deltaStatic * DAF * 1000).toFixed(3),
    dynamicAmplificationFactor: +DAF.toFixed(3),
    staticStressMPa: +(sigmaStatic / 1e6).toFixed(1),
    peakDynamicStressMPa: +(peakStressPa / 1e6).toFixed(1),
    dynamicSafetyFactor: +dynamicSF.toFixed(3),
  };
}
