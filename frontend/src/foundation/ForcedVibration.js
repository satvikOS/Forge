/**
 * ArchDisc Foundation — harmonic forced-vibration response.
 *
 * Extends the modal-analysis module with frequency-response
 * functions (FRF) for single-DOF and multi-DOF systems under
 * harmonic excitation. Standard NVH / dynamics-analysis tool.
 *
 * Single-DOF mass-spring-damper:
 *
 *   m ẍ + c ẋ + k x = F_0 cos(ω t)
 *
 *   Steady-state amplitude:    X = F_0 / √[(k − m ω²)² + (c ω)²]
 *   Dynamic magnification:     D = X / (F_0 / k)
 *   Phase lag:                 φ = atan2(c ω, k − m ω²)
 *
 * In dimensionless form with r = ω/ω_n, ζ = c/(2 √(mk)):
 *
 *   D = 1 / √[(1 − r²)² + (2 ζ r)²]
 *   φ = atan2(2 ζ r, 1 − r²)
 *
 * Transmissibility T_R (force or motion transmitted to base):
 *
 *   T_R = √[(1 + (2ζr)²) / ((1 − r²)² + (2ζr)²)]
 *
 *   Resonance at r = 1: D_max = 1/(2ζ), T_R = √(1 + 1/(4ζ²)) ≈ 1/(2ζ)
 *   r > √2: T_R < 1 (isolation regime).
 *
 * Half-power bandwidth (damping ID): Δω/ω_n ≈ 2ζ.
 *
 * Reference: Rao "Mechanical Vibrations" 6th ed Ch 3, Inman 4th ed.
 *
 * Validation: at r=1, D = 1/(2ζ) within machine precision;
 *             at r=√2, T_R = 1 exact.
 */

const PI = Math.PI;

/**
 * SDOF dynamic magnification factor and phase.
 *
 * @param {number} r        frequency ratio ω/ω_n
 * @param {number} zeta     damping ratio
 */
export function sdofFRF(r, zeta) {
  const denom2 = (1 - r * r) ** 2 + (2 * zeta * r) ** 2;
  const D = 1 / Math.sqrt(denom2);
  const phi = Math.atan2(2 * zeta * r, 1 - r * r);
  return { D, phase_rad: phi, phase_deg: phi * 180 / PI };
}

/**
 * SDOF transmissibility (force-from-base or motion-from-base).
 */
export function sdofTransmissibility(r, zeta) {
  const num = 1 + (2 * zeta * r) ** 2;
  const den = (1 - r * r) ** 2 + (2 * zeta * r) ** 2;
  return Math.sqrt(num / den);
}

/**
 * Sweep the FRF over a frequency range — for plotting Bode-style.
 *
 * @param {object} args
 * @param {number} args.fn_Hz       natural frequency
 * @param {number} args.zeta
 * @param {number=} args.f_min_Hz
 * @param {number=} args.f_max_Hz
 * @param {number=} args.steps      sample count
 */
export function frfSweep({
  fn_Hz, zeta, f_min_Hz = 1, f_max_Hz = null, steps = 100,
}) {
  const fmax = f_max_Hz ?? fn_Hz * 5;
  const freqs = [];
  const mag = [];
  const phase = [];
  const trans = [];
  for (let i = 0; i < steps; i++) {
    const f = f_min_Hz + (fmax - f_min_Hz) * i / (steps - 1);
    const r = f / fn_Hz;
    const ff = sdofFRF(r, zeta);
    freqs.push(f);
    mag.push(ff.D);
    phase.push(ff.phase_deg);
    trans.push(sdofTransmissibility(r, zeta));
  }
  return { fn_Hz, zeta, freq_Hz: freqs, magnitude: mag, phase_deg: phase, transmissibility: trans };
}

/**
 * Half-power bandwidth → damping ratio estimate.
 *
 *   ζ ≈ (f₂ − f₁) / (2 f_n)
 *
 * where f₁, f₂ are the frequencies at which the magnitude drops to
 * D_peak / √2 (−3 dB).
 *
 * Given the natural frequency and damping ratio, return the −3 dB
 * frequencies f₁ and f₂.
 */
export function halfPowerFrequencies(fn_Hz, zeta) {
  const D_peak = 1 / (2 * zeta);
  const D_half = D_peak / Math.sqrt(2);
  // Solve  (1 − r²)² + (2ζr)² = (1/D_half)²   for r:
  const k = 1 / (D_half * D_half);
  // Let u = r². Then (1−u)² + 4ζ² u = k
  //   u² − (2 − 4ζ²) u + (1 − k) = 0
  const b = 2 - 4 * zeta * zeta;
  const c = 1 - k;
  const disc = Math.max(0, b * b - 4 * c);
  const u1 = (b - Math.sqrt(disc)) / 2;
  const u2 = (b + Math.sqrt(disc)) / 2;
  const f1 = fn_Hz * Math.sqrt(Math.max(u1, 0));
  const f2 = fn_Hz * Math.sqrt(Math.max(u2, 0));
  return { f1_Hz: f1, f2_Hz: f2, zeta_check: (f2 - f1) / (2 * fn_Hz) };
}

/**
 * Steady-state response amplitude in physical units.
 *
 * @param {object} args
 * @param {number} args.F0_N
 * @param {number} args.k_N_per_m
 * @param {number} args.m_kg
 * @param {number} args.c_Ns_per_m
 * @param {number} args.omega_rad_s
 * @returns {{ X_m, phase_deg, omega_n_rad_s, zeta }}
 */
export function sdofSteadyState({ F0_N, k_N_per_m, m_kg, c_Ns_per_m, omega_rad_s }) {
  const omega_n = Math.sqrt(k_N_per_m / m_kg);
  const zeta = c_Ns_per_m / (2 * Math.sqrt(k_N_per_m * m_kg));
  const r = omega_rad_s / omega_n;
  const X_static = F0_N / k_N_per_m;
  const frf = sdofFRF(r, zeta);
  return {
    X_m: X_static * frf.D,
    X_static_m: X_static,
    magnification: frf.D,
    phase_deg: frf.phase_deg,
    omega_n_rad_s: omega_n,
    fn_Hz: omega_n / (2 * PI),
    zeta,
    r,
  };
}
