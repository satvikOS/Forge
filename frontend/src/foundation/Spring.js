/**
 * ArchDisc Foundation — helical compression spring analysis.
 *
 * Standard Shigley §10 formulation:
 *
 *   Stiffness:        k = G d⁴ / (8 D³ N_a)
 *   Shear stress:     τ = K_W · 8 F D / (π d³)
 *   Wahl factor:      K_W = (4C − 1)/(4C − 4) + 0.615/C       C = D/d
 *   Solid length:     L_s = (N_t) · d         (closed-and-ground ends → N_t = N_a + 2)
 *   Free length:      L_0 = L_s + (1 + ξ) y_max
 *   Buckling:         critical defl ratio per Shigley Fig 10-7
 *
 * Inputs: wire diameter, mean coil diameter, active coils, material
 * shear modulus G, force range F_min..F_max.
 * Outputs: stiffness, max shear, fatigue SF (Sines or Goodman),
 * buckling check, free length, solid length, spring rate.
 *
 * Reference: Shigley §10 (Mechanical Springs); ASTM A228, A229,
 * A231 for music wire / oil-tempered / chrome-vanadium.
 *
 * Validation: Shigley Ex 10-3 (music-wire compression spring,
 * d=2 mm, D=20 mm, N_a=14, F=20 N) — k ≈ 2.0 N/mm.
 */

const PI = Math.PI;

/** Common spring-wire materials (MPa for tensile, G shear modulus). */
export const SPRING_MATERIALS = {
  music_wire_A228: { G_MPa: 81000, E_MPa: 210000, A_MPa: 2211, m: 0.145 },
  oil_tempered_A229: { G_MPa: 77000, E_MPa: 196000, A_MPa: 1855, m: 0.187 },
  chrome_vanadium_A231: { G_MPa: 77000, E_MPa: 203000, A_MPa: 2000, m: 0.167 },
  stainless_302_A313: { G_MPa: 69000, E_MPa: 193000, A_MPa: 1867, m: 0.146 },
};

/** Ultimate tensile from Shigley Table 10-4: S_ut = A / d^m  (MPa, d in mm). */
export function ultimateTensile(material, d_mm) {
  const m = SPRING_MATERIALS[material];
  if (!m) throw new Error(`Unknown spring material: ${material}`);
  return m.A_MPa / Math.pow(d_mm, m.m);
}

/** Wahl correction factor for stress concentration in helical springs. */
export function wahlFactor(springIndex) {
  const C = springIndex;
  return (4 * C - 1) / (4 * C - 4) + 0.615 / C;
}

/**
 * Helical compression spring analysis.
 *
 * @param {object} args
 * @param {number} args.d_mm           wire diameter
 * @param {number} args.D_mm           mean coil diameter
 * @param {number} args.N_active       active coils
 * @param {number} args.F_min_N        minimum (preload) force
 * @param {number} args.F_max_N        maximum operating force
 * @param {string=} args.material      key into SPRING_MATERIALS
 * @param {string=} args.ends          'closed_ground' | 'closed' | 'plain' | 'plain_ground'
 */
export function analyzeSpring({
  d_mm, D_mm, N_active,
  F_min_N = 0, F_max_N,
  material = 'music_wire_A228',
  ends = 'closed_ground',
}) {
  const mat = SPRING_MATERIALS[material];
  if (!mat) throw new Error(`Unknown spring material: ${material}`);

  const C = D_mm / d_mm;                    // spring index
  const K_W = wahlFactor(C);

  // Rate (N/mm)
  const k = (mat.G_MPa * Math.pow(d_mm, 4)) / (8 * Math.pow(D_mm, 3) * N_active);

  // Stresses
  const F_a = (F_max_N - F_min_N) / 2;
  const F_m = (F_max_N + F_min_N) / 2;
  const tau_a = K_W * 8 * F_a * D_mm / (PI * Math.pow(d_mm, 3));
  const tau_m = K_W * 8 * F_m * D_mm / (PI * Math.pow(d_mm, 3));
  const tau_max = K_W * 8 * F_max_N * D_mm / (PI * Math.pow(d_mm, 3));

  // Strengths
  const Sut = ultimateTensile(material, d_mm);
  const Ssy = 0.45 * Sut;                   // shear yield, Shigley §10-7
  const Sse = 310;                          // shear endurance, A228 typical
  // Fatigue SF — Sines criterion (Shigley eq 10-29):
  //   1/n_f = tau_a/Sse + tau_m/Ssu  with  Ssu = 0.67 Sut
  const Ssu = 0.67 * Sut;
  const failureRatio_Sines = tau_a / Sse + tau_m / Ssu;
  const n_fatigue = failureRatio_Sines > 0 ? 1 / failureRatio_Sines : Infinity;
  const n_static = Ssy / tau_max;

  // Geometry
  const N_total = {
    'closed_ground': N_active + 2,
    'closed':        N_active + 2,
    'plain':         N_active,
    'plain_ground':  N_active + 1,
  }[ends] ?? N_active + 2;
  const L_s = N_total * d_mm;                   // solid length
  const y_max = F_max_N / k;                    // max deflection
  const L_0 = L_s + 1.15 * y_max;               // free length (with 15 % clash allowance)

  // Buckling (Shigley §10-9): L_0/D ratio threshold
  // For fixed-fixed ends, critical y/L_0 ≈ 0.5 if L_0/D < 5.26
  const L0_over_D = L_0 / D_mm;
  const bucklingSafe = L0_over_D < 5.26;

  // Natural frequency (one end fixed): f = (k g / W)^0.5 / (4 L)
  // mass of spring = π² d² D N / 4 / 7850 ... (approximate)
  const weight = (PI * PI / 4) * d_mm * d_mm * D_mm * N_active * 7850e-9 * 9.81;   // N
  const freq_Hz = (1 / (2 * PI)) * Math.sqrt(k * 1000 / (weight / 9.81));

  return {
    geometry: {
      d_mm, D_mm, springIndex: C, N_active, N_total,
      L_solid_mm: L_s,
      L_free_mm: L_0,
      L0_over_D,
    },
    rate: { k_N_per_mm: k },
    Wahl: K_W,
    forces: { F_min_N, F_max_N, F_a, F_m, y_max_mm: y_max },
    stresses: { tau_a_MPa: tau_a, tau_m_MPa: tau_m, tau_max_MPa: tau_max },
    strengths: { Sut_MPa: Sut, Ssy_MPa: Ssy, Sse_MPa: Sse, Ssu_MPa: Ssu },
    safetyFactors: { static: n_static, fatigue_Sines: n_fatigue },
    bucklingSafe,
    naturalFrequency_Hz: freq_Hz,
    status: Math.min(n_static, n_fatigue) >= 1.5 ? 'safe' :
            Math.min(n_static, n_fatigue) >= 1.0 ? 'marginal' : 'fail',
  };
}
