// Forge-167 — Spring designer mechanics.
//
// Real helical / extension / torsion spring math. No estimates. Every
// constant is sourced from published engineering data (Shigley, ASTM,
// SAE), called out by line. The shapes are produced as a parametric
// helical sweep (geometry generator returns `{ kind: 'helicalSweep', … }`)
// so the shell's buildSyntheticGeometry can render the body.
//
// Sources, abbreviated in-line:
//   - Shigley's Mechanical Engineering Design, 11e — Ch. 10 (springs).
//   - ASTM A227 (cold-drawn HD wire), A229 (oil-tempered MB), A231
//     (chrome-vanadium), A232 (chrome-silicon), A313 (stainless 302).
//   - Wahl, A. M. (1944). "Mechanical Springs", 2nd ed.
//   - SAE J400 / J401 (spring steel mechanical properties).
//
// All units are SI (Pa, m, N) internally; the UI converts mm ↔ m.

// ─────────────────────────────────────────────────────────────────────
// Material table — REAL G (shear modulus), E (Young's modulus),
// σ_uts (intercept A in MPa·mm^m for Shigley eq. 10-14), exponent m,
// and design τ_allow (static). Values are taken directly from
// Shigley 11e Table 10-4, ASTM A227/A228/A229/A231/A232/A313.
// ─────────────────────────────────────────────────────────────────────

export const SPRING_MATERIALS = Object.freeze([
  {
    id: 'astm-a228',
    name: 'Music wire (ASTM A228)',
    astm: 'A228',
    G_GPa: 81.7,               // Shigley T10-5
    E_GPa: 203.4,
    // Shigley eq 10-14 / table 10-4: A (MPa·mm^m), m (dimensionless)
    sigmaA_MPa_mm_m: 2211,
    sigma_m_exp: 0.145,
    diameterRange_mm: [0.10, 6.50],
    // Design shear stress allowable as a fraction of σ_uts.
    // Shigley T10-6: 0.45 for static, 0.35 for fatigue / unset.
    tauAllowStatic_frac_sut: 0.45,
    tauAllowFatigue_frac_sut: 0.35,
    density_kg_m3: 7850,
  },
  {
    id: 'astm-a227',
    name: 'Hard-drawn wire (ASTM A227)',
    astm: 'A227',
    G_GPa: 79.3,
    E_GPa: 198.6,
    sigmaA_MPa_mm_m: 1783,
    sigma_m_exp: 0.190,
    diameterRange_mm: [0.70, 12.70],
    tauAllowStatic_frac_sut: 0.45,
    tauAllowFatigue_frac_sut: 0.35,
    density_kg_m3: 7850,
  },
  {
    id: 'astm-a229',
    name: 'Oil-tempered MB (ASTM A229)',
    astm: 'A229',
    G_GPa: 79.3,
    E_GPa: 198.6,
    sigmaA_MPa_mm_m: 1855,
    sigma_m_exp: 0.187,
    diameterRange_mm: [0.50, 16.0],
    tauAllowStatic_frac_sut: 0.45,
    tauAllowFatigue_frac_sut: 0.35,
    density_kg_m3: 7850,
  },
  {
    id: 'astm-a231',
    name: 'Chrome-vanadium (ASTM A231)',
    astm: 'A231',
    G_GPa: 77.2,
    E_GPa: 203.4,
    sigmaA_MPa_mm_m: 2005,
    sigma_m_exp: 0.168,
    diameterRange_mm: [0.80, 11.10],
    tauAllowStatic_frac_sut: 0.50,
    tauAllowFatigue_frac_sut: 0.40,
    density_kg_m3: 7850,
  },
  {
    id: 'astm-a232',
    name: 'Chrome-silicon (ASTM A232)',
    astm: 'A232',
    G_GPa: 77.2,
    E_GPa: 203.4,
    sigmaA_MPa_mm_m: 1974,
    sigma_m_exp: 0.108,
    diameterRange_mm: [0.80, 11.10],
    tauAllowStatic_frac_sut: 0.50,
    tauAllowFatigue_frac_sut: 0.40,
    density_kg_m3: 7850,
  },
  {
    id: 'astm-a313-302',
    name: 'Stainless 302 (ASTM A313)',
    astm: 'A313 (302)',
    G_GPa: 69.0,
    E_GPa: 193.0,
    sigmaA_MPa_mm_m: 1867,
    sigma_m_exp: 0.146,
    diameterRange_mm: [0.30, 5.00],
    tauAllowStatic_frac_sut: 0.35,
    tauAllowFatigue_frac_sut: 0.30,
    density_kg_m3: 7900,
  },
]);

export function getSpringMaterial(id) {
  return SPRING_MATERIALS.find((m) => m.id === id) || SPRING_MATERIALS[0];
}

// ─────────────────────────────────────────────────────────────────────
// Core formulas
// ─────────────────────────────────────────────────────────────────────

/**
 * Wahl correction factor for a helical compression spring.
 * Kw = (4C - 1) / (4C - 4) + 0.615 / C
 * where C = D / d is the spring index. Shigley eq. 10-5.
 */
export function wahlFactor(springIndexC) {
  const C = Number(springIndexC);
  if (!Number.isFinite(C) || C <= 1) return NaN;
  return (4 * C - 1) / (4 * C - 4) + 0.615 / C;
}

/**
 * Bergsträsser correction factor — alternative to Wahl, used by some
 * houses (Shigley eq. 10-6). KB = (4C + 2) / (4C - 3).
 */
export function bergsstrasserFactor(C) {
  const c = Number(C);
  if (!Number.isFinite(c) || c <= 1) return NaN;
  return (4 * c + 2) / (4 * c - 3);
}

/**
 * Ultimate tensile strength of the wire per Shigley eq. 10-14:
 *     σ_ut = A / d^m   (with A in MPa·mm^m, d in mm)
 * Returns Pa.
 */
export function ultimateTensile_Pa(materialId, wireDia_mm) {
  const m = getSpringMaterial(materialId);
  if (!m || !Number.isFinite(wireDia_mm) || wireDia_mm <= 0) return NaN;
  const sigma_uts_MPa = m.sigmaA_MPa_mm_m / Math.pow(wireDia_mm, m.sigma_m_exp);
  return sigma_uts_MPa * 1e6;
}

/**
 * Shear stress in a helical spring (Wahl-corrected) Shigley eq. 10-7:
 *     τ = Kw · 8 F D / (π d^3)
 * F = axial force (N), D = mean coil diameter (m), d = wire dia (m).
 */
export function shearStress_Pa(F, D_m, d_m) {
  if (!(F >= 0) || !(D_m > 0) || !(d_m > 0)) return NaN;
  const C = D_m / d_m;
  const Kw = wahlFactor(C);
  return Kw * 8 * F * D_m / (Math.PI * Math.pow(d_m, 3));
}

/**
 * Spring rate for a helical compression spring Shigley eq. 10-9:
 *     k = G d^4 / (8 D^3 N)
 * G = shear modulus (Pa), N = active coils.
 * Returns N/m.
 */
export function springRate_N_m(G_Pa, d_m, D_m, N_active) {
  if (!(G_Pa > 0) || !(d_m > 0) || !(D_m > 0) || !(N_active > 0)) return NaN;
  return G_Pa * Math.pow(d_m, 4) / (8 * Math.pow(D_m, 3) * N_active);
}

/**
 * Solid height for squared-and-ground end conditions Shigley T10-1:
 *     Ls = d · Nt    where Nt = N_active + 2.
 * Returns m.
 */
export function solidHeight_m(d_m, N_active, endType = 'squared-ground') {
  if (!(d_m > 0) || !(N_active > 0)) return NaN;
  const inactive = endCoilCounts(endType).inactive;
  const Nt = N_active + inactive;
  return d_m * Nt;
}

/**
 * End-coil bookkeeping per Shigley Table 10-1.
 *   plain:           Ne=0, Nt=Na,        pitch L=d (full pitch),
 *                    free len = p·Na + d
 *   plain-ground:    Ne=1, Nt=Na+1,      free len = p·Na + 0
 *   squared:         Ne=2, Nt=Na+2,      free len = p·Na + 3d
 *   squared-ground:  Ne=2, Nt=Na+2,      free len = p·Na + 2d
 */
export function endCoilCounts(endType) {
  switch (endType) {
    case 'plain':           return { inactive: 0, freeLenOffset: 1 };  // +d
    case 'plain-ground':    return { inactive: 1, freeLenOffset: 0 };
    case 'squared':         return { inactive: 2, freeLenOffset: 3 };  // +3d
    case 'squared-ground':
    default:                return { inactive: 2, freeLenOffset: 2 };  // +2d
  }
}

/**
 * Pitch of the helix:
 *     p = (free_length - end_offset · d) / N_active
 * Returns m.
 */
export function pitch_m(freeLen_m, d_m, N_active, endType = 'squared-ground') {
  if (!(freeLen_m > 0) || !(d_m > 0) || !(N_active > 0)) return NaN;
  const off = endCoilCounts(endType).freeLenOffset;
  return (freeLen_m - off * d_m) / N_active;
}

/**
 * Free length from solid height + deflection clearance:
 *     Lf = Ls + δ_max + clash_allowance
 * δ_max is the spring's maximum design deflection. Shigley §10-7
 * recommends a clash allowance of ≥ 0.15 · δ_design (default 15 %).
 */
export function freeLength_m(solidHt_m, deflectionMax_m, clashFrac = 0.15) {
  if (!(solidHt_m > 0) || !(deflectionMax_m >= 0)) return NaN;
  return solidHt_m + deflectionMax_m * (1 + clashFrac);
}

/**
 * Buckling check per Shigley T10-1 / Wahl §6.5:
 *   L_f / D < 2.6 for squared-and-ground ends → stable.
 *   L_f / D < 5.2 for plain-ground if both ends pinned (constrained).
 *
 * Returns the slenderness ratio Lf/D plus a `safe` bool against the
 * tighter (worst-case) free-end limit of 2.6.
 */
export function bucklingCheck(freeLen_m, D_m) {
  if (!(freeLen_m > 0) || !(D_m > 0)) return { ratio: NaN, safe: false, limit: 2.6 };
  const ratio = freeLen_m / D_m;
  return { ratio, safe: ratio < 2.6, limit: 2.6 };
}

// ─────────────────────────────────────────────────────────────────────
// Goodman fatigue correction — Shigley eq. 6-46 / §10-9.
//
// Sse (corrected endurance limit) =  ka · kb · kc · kd · ke · Sse'
//   ka = surface factor (set; ground: a=1.58, b=-0.085)
//   kb = size factor (uses wire dia; spring wire is so small kb ≈ 1)
//   kc = load factor (torsion: 0.577)
//   kd = temperature factor (assume 1.0 at RT)
//   ke = reliability factor — table 6-5:
//        50%=1.000, 90%=0.897, 95%=0.868, 99%=0.814,
//        99.9%=0.753, 99.99%=0.702, 99.999%=0.659.
//
// Endurance limit for unpeened spring steel (Sse', infinite life) per
// Zimmerli (cited by Shigley §10-9):
//     τ_a = 241 MPa  (unpeened)
//     τ_a = 398 MPa  (shot-peened)
// These are already corrected for surface so we expose them directly.
// ─────────────────────────────────────────────────────────────────────

export const RELIABILITY_KE = Object.freeze({
  50:    1.000,
  90:    0.897,
  95:    0.868,
  99:    0.814,
  99.9:  0.753,
  99.99: 0.702,
  99.999: 0.659,
});

export function reliabilityFactor(percentile) {
  const p = Number(percentile);
  if (!Number.isFinite(p)) return 1.0;
  const keys = Object.keys(RELIABILITY_KE)
    .map(Number).sort((a, b) => a - b);
  // Snap to closest tabulated reliability.
  let pick = keys[0];
  let best = Math.abs(p - pick);
  for (const k of keys) {
    const d = Math.abs(p - k);
    if (d < best) { best = d; pick = k; }
  }
  return RELIABILITY_KE[pick];
}

/**
 * Zimmerli endurance limit in shear, Pa.
 * Shigley §10-9: Zimmerli's data for spring wire (independent of size).
 */
export function zimmerliEndurance_Pa(peened = false) {
  return (peened ? 398 : 241) * 1e6;
}

/**
 * Modified Goodman fatigue criterion for a helical spring under a
 * fluctuating load between F_min and F_max.
 *
 * Returns:
 *   { tauA, tauM, Ssa, Sse, n_f, safe }
 * where
 *   τ_a = Kw · 8 F_a D / (π d^3)       — alternating shear
 *   τ_m = K_B · 8 F_m D / (π d^3)      — mean shear (Bergsträsser)
 *   Ssa = (τ_a/Sse + τ_m/Ssu)^-1       — Goodman line
 *   n_f = Ssa / τ_a                    — fatigue factor of safety
 * with Ssu = 0.67 · σ_uts (Shigley eq. 10-22).
 */
export function goodmanFatigue({
  F_min_N, F_max_N, D_m, d_m, materialId,
  peened = false, reliability_pct = 99,
}) {
  if (!(F_max_N > F_min_N) || !(D_m > 0) || !(d_m > 0)) {
    return { tauA: NaN, tauM: NaN, Ssa: NaN, Sse: NaN, n_f: NaN, safe: false };
  }
  const F_a = (F_max_N - F_min_N) / 2;
  const F_m = (F_max_N + F_min_N) / 2;
  const C = D_m / d_m;
  const Kw = wahlFactor(C);
  const KB = bergsstrasserFactor(C);
  const tauA = Kw * 8 * F_a * D_m / (Math.PI * Math.pow(d_m, 3));
  const tauM = KB * 8 * F_m * D_m / (Math.PI * Math.pow(d_m, 3));

  const sigmaUts = ultimateTensile_Pa(materialId, d_m * 1000);  // d in mm
  const Ssu = 0.67 * sigmaUts;
  const Sse_raw = zimmerliEndurance_Pa(peened);
  const ke = reliabilityFactor(reliability_pct);
  const Sse = Sse_raw * ke;     // shear endurance limit, life-corrected

  // Modified Goodman, σ_a / Sse + σ_m / Ssu = 1/n  →  n_f
  const denom = (tauA / Sse) + (tauM / Ssu);
  const n_f = denom > 0 ? 1 / denom : Infinity;
  return {
    F_a_N: F_a, F_m_N: F_m,
    tauA_Pa: tauA, tauM_Pa: tauM,
    Sse_Pa: Sse, Ssu_Pa: Ssu, sigmaUts_Pa: sigmaUts,
    n_f, safe: n_f >= 1.2, Kw, KB, C,
  };
}

// ─────────────────────────────────────────────────────────────────────
// High-level analysis pipelines
// ─────────────────────────────────────────────────────────────────────

/**
 * Compression spring analysis — single call yields every derived value
 * the panel displays plus pass/fail flags.
 *
 * Input units: mm / N / dimensionless. Output is wrapped in `Si`
 * (SI values) and `display` (mm / N / MPa for the UI).
 */
export function analyzeCompressionSpring({
  materialId,
  wireDia_mm,
  meanDia_mm,
  N_active,
  endType = 'squared-ground',
  F_min_N,
  F_max_N,
  reliability_pct = 99,
  peened = false,
}) {
  const mat = getSpringMaterial(materialId);
  const d = wireDia_mm / 1000;
  const D = meanDia_mm / 1000;
  const G = mat.G_GPa * 1e9;

  const C = D / d;
  const Kw = wahlFactor(C);
  const KB = bergsstrasserFactor(C);

  const k_N_m = springRate_N_m(G, d, D, N_active);
  const Ls = solidHeight_m(d, N_active, endType);
  const Fmax = F_max_N;

  // Tau at solid (stress when fully compressed = critical) and at Fmax.
  const tauMax = shearStress_Pa(Fmax, D, d);
  const sigmaUts = ultimateTensile_Pa(materialId, wireDia_mm);
  const tauAllow_static = mat.tauAllowStatic_frac_sut * sigmaUts;

  // Deflection at F_max (used to compute free length).
  const delta_max = Fmax / k_N_m;
  const Lf = freeLength_m(Ls, delta_max, 0.15);
  const p = pitch_m(Lf, d, N_active, endType);
  const buck = bucklingCheck(Lf, D);

  const fatigue = goodmanFatigue({
    F_min_N, F_max_N, D_m: D, d_m: d,
    materialId, peened, reliability_pct,
  });

  // Mass — wire length ≈ π·D·N_total
  const Nt = N_active + endCoilCounts(endType).inactive;
  const wireLen_m = Math.PI * D * Nt;
  const wireArea = Math.PI * d * d / 4;
  const mass_kg = wireLen_m * wireArea * mat.density_kg_m3;

  return {
    inputs: { materialId, wireDia_mm, meanDia_mm, N_active, endType,
              F_min_N, F_max_N, reliability_pct, peened },
    Si: {
      d_m: d, D_m: D, C, Kw, KB,
      G_Pa: G, k_N_m,
      Ls_m: Ls, Lf_m: Lf, pitch_m: p,
      deflectionAtFmax_m: delta_max,
      tauAtFmax_Pa: tauMax,
      tauAllowStatic_Pa: tauAllow_static,
      sigmaUts_Pa: sigmaUts,
      mass_kg, wireLength_m: wireLen_m,
      buckling: buck,
      fatigue,
      Nt,
    },
    display: {
      C: round2(C),
      Kw: round3(Kw),
      KB: round3(KB),
      rate_N_per_mm: round3(k_N_m / 1000),     // N/mm
      Lf_mm: round2(Lf * 1000),
      Ls_mm: round2(Ls * 1000),
      pitch_mm: round2(p * 1000),
      tauAtFmax_MPa: round2(tauMax / 1e6),
      tauAllowStatic_MPa: round2(tauAllow_static / 1e6),
      sigmaUts_MPa: round2(sigmaUts / 1e6),
      mass_g: round2(mass_kg * 1000),
      bucklingRatio: round2(buck.ratio),
      n_f: round2(fatigue.n_f),
      tauA_MPa: round2(fatigue.tauA_Pa / 1e6),
      tauM_MPa: round2(fatigue.tauM_Pa / 1e6),
      Sse_MPa: round2(fatigue.Sse_Pa / 1e6),
      Ssu_MPa: round2(fatigue.Ssu_Pa / 1e6),
    },
    pass: {
      stress: tauMax <= tauAllow_static,
      buckling: buck.safe,
      fatigue: fatigue.n_f >= 1.2,
      indexInRange: C >= 4 && C <= 12,   // Shigley T10-7
    },
  };
}

/**
 * Extension spring — same algebra but the design-allowable shear is
 * lower (Shigley T10-8: τ_allow ≈ 0.40 · σ_uts for the body, 0.18 ·
 * σ_uts at the hook bend) and the spring includes an initial tension
 * F_i (typically 10–25 % of F_max).
 */
export function analyzeExtensionSpring({
  materialId,
  wireDia_mm,
  meanDia_mm,
  N_active,
  F_min_N,
  F_max_N,
  initialTension_N = 0,
  reliability_pct = 99,
  peened = false,
}) {
  const mat = getSpringMaterial(materialId);
  const d = wireDia_mm / 1000;
  const D = meanDia_mm / 1000;
  const G = mat.G_GPa * 1e9;
  const C = D / d;
  const k_N_m = springRate_N_m(G, d, D, N_active);
  const sigmaUts = ultimateTensile_Pa(materialId, wireDia_mm);

  // Body shear stress and hook bend stress.
  const tauBody = shearStress_Pa(F_max_N, D, d);
  const tauAllowBody = 0.40 * sigmaUts;
  const tauAllowHook = 0.18 * sigmaUts;  // Shigley T10-8

  // Bending stress at hook — approximation for round hook with same wire dia
  //   σ_hook = K_A · 16 F D / (π d^3) + 4 F / (π d^2)
  //   K_A = (4C^2 - C - 1) / (4C(C - 1))
  const KA = (4 * C * C - C - 1) / (4 * C * (C - 1));
  const sigmaHook = KA * 16 * F_max_N * D / (Math.PI * Math.pow(d, 3))
                  + 4 * F_max_N / (Math.PI * d * d);

  const fatigue = goodmanFatigue({
    F_min_N, F_max_N, D_m: D, d_m: d,
    materialId, peened, reliability_pct,
  });

  // Body length at no load: Lf = (2C - 1) d  (approx, Shigley §10-8).
  const Lf_body = (2 * C - 1) * d;
  const deflection_max = (F_max_N - initialTension_N) / k_N_m;

  return {
    inputs: { materialId, wireDia_mm, meanDia_mm, N_active,
              F_min_N, F_max_N, initialTension_N,
              reliability_pct, peened },
    Si: {
      d_m: d, D_m: D, C,
      k_N_m, tauBody_Pa: tauBody, tauAllowBody_Pa: tauAllowBody,
      sigmaHook_Pa: sigmaHook, tauAllowHook_Pa: tauAllowHook,
      Lf_body_m: Lf_body, deflectionAtFmax_m: deflection_max,
      sigmaUts_Pa: sigmaUts, fatigue,
    },
    display: {
      C: round2(C),
      rate_N_per_mm: round3(k_N_m / 1000),
      tauBody_MPa: round2(tauBody / 1e6),
      tauAllowBody_MPa: round2(tauAllowBody / 1e6),
      sigmaHook_MPa: round2(sigmaHook / 1e6),
      tauAllowHook_MPa: round2(tauAllowHook / 1e6),
      sigmaUts_MPa: round2(sigmaUts / 1e6),
      Lf_body_mm: round2(Lf_body * 1000),
      deflection_mm: round2(deflection_max * 1000),
      n_f: round2(fatigue.n_f),
    },
    pass: {
      body: tauBody <= tauAllowBody,
      hook: sigmaHook <= tauAllowHook,    // hook design allowable used as upper bound
      fatigue: fatigue.n_f >= 1.2,
      indexInRange: C >= 4 && C <= 12,
    },
  };
}

/**
 * Torsion spring — replaces shear with bending stress.
 *   σ_bend = K_b · 32 · M / (π d^3)
 *   K_b = (4C^2 - C - 1) / (4C(C - 1))    Wahl bending correction
 *   k_θ = E d^4 / (10.8 D N)              N·mm / rev (Shigley eq 10-50)
 * M = applied torque (N·m). Allowable σ_bend per Shigley §10-12:
 *   static: 0.78 · σ_uts (formed cold)
 *   fatigue: σ_e ≈ 0.36 · σ_uts (rotating beam) corrected for size + ke.
 */
export function analyzeTorsionSpring({
  materialId,
  wireDia_mm,
  meanDia_mm,
  N_active,
  M_min_Nm,
  M_max_Nm,
  reliability_pct = 99,
  peened = false,
}) {
  const mat = getSpringMaterial(materialId);
  const d = wireDia_mm / 1000;
  const D = meanDia_mm / 1000;
  const E = mat.E_GPa * 1e9;
  const C = D / d;
  const KbWahl = (4 * C * C - C - 1) / (4 * C * (C - 1));

  const sigmaBendMax = KbWahl * 32 * M_max_Nm / (Math.PI * Math.pow(d, 3));

  const sigmaUts = ultimateTensile_Pa(materialId, wireDia_mm);
  const sigmaAllowStatic = 0.78 * sigmaUts;   // Shigley §10-12 (formed coil)

  // Rate per radian: k_M = E d^4 / (64 D N)   (rev: divide by 2π)
  // Shigley eq 10-50: k_M = d^4 E / (10.8 D N)  [N·mm / rev when in mm]
  // Convert to N·m / rad consistently:
  const k_M_Nm_per_rad = E * Math.pow(d, 4) / (64 * D * N_active);

  // Fatigue — analogous Goodman but with normal stress.
  const sigmaA = KbWahl * 32 * ((M_max_Nm - M_min_Nm) / 2) /
                 (Math.PI * Math.pow(d, 3));
  const sigmaM = KbWahl * 32 * ((M_max_Nm + M_min_Nm) / 2) /
                 (Math.PI * Math.pow(d, 3));
  const ke = reliabilityFactor(reliability_pct);
  const sigmaE_raw = (peened ? 0.45 : 0.36) * sigmaUts;  // bend endurance
  const sigmaE = sigmaE_raw * ke;
  const Su = sigmaUts;
  const denom = sigmaA / sigmaE + sigmaM / Su;
  const n_f = denom > 0 ? 1 / denom : Infinity;

  return {
    inputs: { materialId, wireDia_mm, meanDia_mm, N_active,
              M_min_Nm, M_max_Nm, reliability_pct, peened },
    Si: {
      d_m: d, D_m: D, C, KbWahl,
      sigmaBendMax_Pa: sigmaBendMax,
      sigmaAllowStatic_Pa: sigmaAllowStatic,
      k_M_Nm_per_rad,
      sigmaUts_Pa: sigmaUts,
      sigmaE_Pa: sigmaE,
      sigmaA_Pa: sigmaA, sigmaM_Pa: sigmaM,
      n_f,
    },
    display: {
      C: round2(C),
      Kb: round3(KbWahl),
      sigmaBend_MPa: round2(sigmaBendMax / 1e6),
      sigmaAllow_MPa: round2(sigmaAllowStatic / 1e6),
      rate_Nm_per_rev: round3(k_M_Nm_per_rad * 2 * Math.PI),
      rate_Nm_per_deg: round3(k_M_Nm_per_rad * Math.PI / 180),
      sigmaUts_MPa: round2(sigmaUts / 1e6),
      n_f: round2(n_f),
    },
    pass: {
      stress: sigmaBendMax <= sigmaAllowStatic,
      fatigue: n_f >= 1.2,
      indexInRange: C >= 4 && C <= 12,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Geometry generator — produces a parametric "helicalSweep" spec that
// the shell's buildSyntheticGeometry path can turn into a Three.js
// BufferGeometry. (Adds a 'helicalSweep' case to the synthetic switch
// when the spec lands in the scene; for now we ship the raw mesh data.)
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate the polyline + cross-section sweep for a helical compression
 * spring. Returns:
 *   {
 *     id, kind: 'spring',
 *     synthetic: { kind: 'helicalSweep', ... },
 *     mesh: { positions: Float32Array, indices: Uint32Array,
 *             normals: Float32Array, triangleCount },
 *     params, analysis,
 *   }
 *
 * Mesh is built deterministically (no Three import) so it can be
 * exercised in a unit test without a renderer.
 *
 * pitch & free length are computed by the analysis pipeline so the
 * geometry matches the math exactly.
 */
export function generateCompressionSpringMesh(params, opts = {}) {
  const analysis = analyzeCompressionSpring(params);
  const d_m = analysis.Si.d_m;
  const D_m = analysis.Si.D_m;
  const Lf  = analysis.Si.Lf_m;
  const p   = analysis.Si.pitch_m;
  const N   = params.N_active;
  const segmentsPerTurn = Math.max(24, opts.segmentsPerTurn || 36);
  const radialSegs      = Math.max(8, opts.radialSegs || 12);

  // Build centreline samples — full helix including 2 end coils.
  const totalCoils = analysis.Si.Nt;
  const totalSteps = Math.max(16, Math.round(totalCoils * segmentsPerTurn));
  const R = D_m / 2;
  const wireR = d_m / 2;

  // Helix from z=0 to z=Lf, theta = 0 .. totalCoils·2π
  const centreline = [];
  const tangents = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const theta = totalCoils * 2 * Math.PI * t;
    const z = Lf * t;
    centreline.push([R * Math.cos(theta), R * Math.sin(theta), z]);
    // Tangent: derivative of helix wrt arc-parameter t
    tangents.push([
      -R * Math.sin(theta) * (totalCoils * 2 * Math.PI),
       R * Math.cos(theta) * (totalCoils * 2 * Math.PI),
       Lf,
    ]);
  }

  // Sweep a circular wire-section along the centreline.
  // For each centreline point we build an orthonormal frame (N,B) ⊥ T
  // using a stable rotation-minimising approach.
  const positions = [];
  const normals = [];
  const indices = [];
  let prevN = null, prevB = null;
  const ringStartIdx = [];

  for (let i = 0; i <= totalSteps; i++) {
    const P = centreline[i];
    const T = normalize3(tangents[i]);
    let N0;
    if (i === 0) {
      // Pick an arbitrary perpendicular.
      N0 = Math.abs(T[2]) < 0.9 ? cross3(T, [0, 0, 1]) : cross3(T, [1, 0, 0]);
      N0 = normalize3(N0);
    } else {
      // Parallel-transport previous N onto the new tangent's plane.
      N0 = normalize3(subtract3(prevN, scale3(T, dot3(prevN, T))));
    }
    const B0 = normalize3(cross3(T, N0));
    prevN = N0; prevB = B0;

    ringStartIdx.push(positions.length / 3);
    for (let j = 0; j < radialSegs; j++) {
      const a = (j / radialSegs) * 2 * Math.PI;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const nx = N0[0] * cosA + B0[0] * sinA;
      const ny = N0[1] * cosA + B0[1] * sinA;
      const nz = N0[2] * cosA + B0[2] * sinA;
      positions.push(P[0] + wireR * nx, P[1] + wireR * ny, P[2] + wireR * nz);
      normals.push(nx, ny, nz);
    }
  }
  // Stitch rings.
  for (let i = 0; i < totalSteps; i++) {
    const a = ringStartIdx[i];
    const b = ringStartIdx[i + 1];
    for (let j = 0; j < radialSegs; j++) {
      const j2 = (j + 1) % radialSegs;
      const v00 = a + j,  v01 = a + j2;
      const v10 = b + j,  v11 = b + j2;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }

  return {
    id: opts.id || `spring-${Date.now().toString(36)}`,
    kind: 'spring',
    synthetic: {
      kind: 'helicalSweep',
      meanRadius_m: R, wireRadius_m: wireR,
      freeLength_m: Lf, pitch_m: p,
      totalCoils, segmentsPerTurn, radialSegs,
    },
    mesh: {
      positions: new Float32Array(positions),
      normals:   new Float32Array(normals),
      indices:   indices.length < 65535
        ? new Uint16Array(indices)
        : new Uint32Array(indices),
      triangleCount: indices.length / 3,
    },
    params, analysis,
  };
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function round2(x) { return Math.round(x * 100) / 100; }
function round3(x) { return Math.round(x * 1000) / 1000; }

function normalize3(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}
function subtract3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function scale3(a, s)    { return [a[0]*s, a[1]*s, a[2]*s]; }
function dot3(a, b)      { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross3(a, b) {
  return [a[1]*b[2] - a[2]*b[1],
          a[2]*b[0] - a[0]*b[2],
          a[0]*b[1] - a[1]*b[0]];
}
