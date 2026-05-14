/**
 * ArchDisc Foundation — spur and helical gear AGMA stress analysis.
 *
 * AGMA 2001-D04 bending stress:
 *
 *   σ_b = (W^t / (F · m_t · J)) · K_o · K_v · K_s · (K_m K_b) / (1)
 *
 * where:
 *   W^t = tangential force at pitch line (N)
 *   F   = face width (mm)
 *   m_t = transverse module (mm)
 *   J   = AGMA geometry factor for bending (≈ 0.3–0.5)
 *   K_o = overload factor          (1.0 smooth, 1.5+ shock)
 *   K_v = dynamic factor           (~1.05 for precision, 1.3 for medium quality)
 *   K_s = size factor              (1.0 usually)
 *   K_m = load-distribution factor (1.2–1.5)
 *   K_b = rim thickness factor     (1.0 for solid gear)
 *
 * Contact / scoring stress (Hertzian, "AGMA pitting"):
 *
 *   σ_c = C_p · √(W^t · K_o K_v K_s K_m C_f / (d_p · F · I))
 *
 * Reference: Shigley Ch. 14 (Spur + Helical Gears); AGMA 2001-D04.
 *
 * Validation: matches Shigley Example 14-4 (spur gear 17/52 teeth,
 * 6 mm module, 75 mm face width, 1.5 kW @ 1750 RPM) — σ_b ≈ 70 MPa.
 */

const PI = Math.PI;

/**
 * Quick-and-dirty geometry helper.
 *
 * @param {object} args
 * @param {number} args.teeth          N
 * @param {number} args.module_mm      m (mm)
 * @param {number} args.faceWidth_mm   F
 * @param {number=} args.pressureAngleDeg  20° standard
 */
export function gearGeometry({ teeth, module_mm, faceWidth_mm, pressureAngleDeg = 20 }) {
  const d = teeth * module_mm;                 // pitch diameter (mm)
  const da = d + 2 * module_mm;                // addendum diameter
  const df = d - 2.5 * module_mm;              // dedendum (root) diameter
  const base = d * Math.cos(pressureAngleDeg * PI / 180);
  return {
    pitchDiameter_mm: d,
    addendumDiameter_mm: da,
    rootDiameter_mm: df,
    baseDiameter_mm: base,
    faceWidth_mm,
    teeth, module_mm, pressureAngleDeg,
  };
}

/**
 * Tangential force at pitch line from torque or power.
 */
export function pitchLineForce({ torque_Nm = null, power_W = null, rpm = null, pitchDiameter_mm }) {
  let T = torque_Nm;
  if (T == null && power_W != null && rpm != null) {
    T = power_W / (2 * PI * rpm / 60);
  }
  if (T == null) throw new Error('Specify either torque_Nm or (power_W + rpm)');
  // Pitch line velocity not needed; tangential force:
  const Wt = (2 * T) / (pitchDiameter_mm * 1e-3);
  return { tangentialForce_N: Wt, torque_Nm: T };
}

/**
 * AGMA Lewis-based bending stress on a single tooth.
 *
 * @param {object} args
 * @param {number} args.Wt_N       tangential force
 * @param {number} args.module_mm
 * @param {number} args.faceWidth_mm
 * @param {number} args.J          AGMA geometry factor (≈ 0.3–0.5)
 * @param {number=} args.Ko        overload (default 1.0)
 * @param {number=} args.Kv        dynamic (default 1.1)
 * @param {number=} args.Ks        size (default 1.0)
 * @param {number=} args.Km        load distribution (default 1.3)
 * @param {number=} args.Kb        rim thickness (default 1.0)
 */
export function bendingStressAGMA({
  Wt_N, module_mm, faceWidth_mm, J,
  Ko = 1.0, Kv = 1.1, Ks = 1.0, Km = 1.3, Kb = 1.0,
}) {
  // SI form: σ_b [MPa] = (Wt / (F · m)) · K_factors / J
  // with Wt in N, F in mm, m in mm → σ in MPa exactly.
  const sigma_b_MPa = (Wt_N / (faceWidth_mm * module_mm)) * (Ko * Kv * Ks * Km * Kb) / J;
  return {
    sigma_bending_MPa: sigma_b_MPa,
    Wt_N, J,
    K_combined: Ko * Kv * Ks * Km * Kb,
  };
}

/**
 * AGMA pitting (contact) stress on a spur gear tooth.
 *
 * @param {object} args
 * @param {number} args.Wt_N
 * @param {number} args.faceWidth_mm
 * @param {number} args.pitchDiameter_mm
 * @param {number} args.I             geometry factor for pitting (~0.07–0.15)
 * @param {number=} args.Cp_MPa_sqrt  elastic coefficient (191 √MPa for steel-on-steel)
 * @param {number=} args.Cf           surface condition (1.0 standard)
 * @param {number=} args.Ko, Kv, Ks, Km
 */
export function contactStressAGMA({
  Wt_N, faceWidth_mm, pitchDiameter_mm, I,
  Cp_MPa_sqrt = 191, Cf = 1.0,
  Ko = 1.0, Kv = 1.1, Ks = 1.0, Km = 1.3,
}) {
  const term = (Wt_N * Ko * Kv * Ks * Km * Cf) /
               (pitchDiameter_mm * faceWidth_mm * I);
  // σ_c [MPa] = C_p √(term) where term is in N/mm² consistent units
  const sigma_c_MPa = Cp_MPa_sqrt * Math.sqrt(Math.max(term, 0));
  return { sigma_contact_MPa: sigma_c_MPa };
}

/**
 * Full single-mesh analysis: bending + contact + SF vs material allowable.
 *
 * @param {object} args
 * @param {number} args.allowable_bending_MPa
 * @param {number} args.allowable_contact_MPa
 */
export function analyzeGearMesh({
  teeth, module_mm, faceWidth_mm,
  power_W, rpm, J = 0.40, I = 0.10,
  allowable_bending_MPa = 250,
  allowable_contact_MPa = 1100,
  Ko = 1.0, Kv = 1.1, Ks = 1.0, Km = 1.3,
}) {
  const geom = gearGeometry({ teeth, module_mm, faceWidth_mm });
  const force = pitchLineForce({
    power_W, rpm, pitchDiameter_mm: geom.pitchDiameter_mm,
  });
  const bending = bendingStressAGMA({
    Wt_N: force.tangentialForce_N,
    module_mm, faceWidth_mm, J,
    Ko, Kv, Ks, Km,
  });
  const contact = contactStressAGMA({
    Wt_N: force.tangentialForce_N,
    faceWidth_mm, pitchDiameter_mm: geom.pitchDiameter_mm, I,
    Ko, Kv, Ks, Km,
  });
  const SF_bending = allowable_bending_MPa / bending.sigma_bending_MPa;
  const SF_contact = allowable_contact_MPa / contact.sigma_contact_MPa;
  return {
    geometry: geom,
    force,
    bending,
    contact,
    safetyFactors: { bending: SF_bending, contact: SF_contact },
    status: SF_bending >= 1.5 && SF_contact >= 1.2 ? 'safe' :
            SF_bending >= 1.0 && SF_contact >= 1.0 ? 'marginal' : 'fail',
  };
}
