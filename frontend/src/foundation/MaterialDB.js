/**
 * ArchDisc Foundation — engineering-grade material database with
 * temperature-dependent properties.
 *
 * Each material exposes E(T), nu(T), yield(T), UTS(T), CTE(T),
 * conductivity k(T), specific heat cp(T), density ρ.
 *
 * Data is interpolated piecewise-linearly between tabulated points;
 * extrapolation clamps to the endpoint values (most properties
 * vary smoothly over the qualified range so this is acceptable
 * for design-stage analysis).
 *
 * Materials cover the standard aerospace + general-engineering set:
 *
 *   AL_6061_T6      Aluminum 6061-T6 (general airframe, brackets)
 *   AL_7075_T6      High-strength aluminum (wing skins)
 *   STEEL_4340      Heat-treated alloy steel (gears, shafts)
 *   STAINLESS_316   Corrosion-resistant (fluid systems, fasteners)
 *   TI_6AL_4V       Aerospace titanium (turbine fan, fasteners)
 *   INCONEL_718     Hot-section nickel superalloy (HPT discs)
 *   CMSX_4          Single-crystal nickel (HPT blades)
 *   AISI_1020       Mild carbon steel (weldments)
 *
 * References for tabulated data:
 *   - MMPDS-2017 (Metallic Materials Properties Development and
 *     Standardization Handbook, FAA)
 *   - High Temperature Materials Properties Handbook (NASA SP-5071)
 *   - SAE AMS specs for the alloys
 *
 * Properties have been spot-checked against MIL-HDBK-5J / MMPDS at
 * a few temperatures. The numbers are close to but not identical to
 * any single source — they're a representative consensus suitable
 * for design-stage analysis (NOT for stress reports).
 *
 * Units throughout this module:
 *   E, yield, UTS:  MPa
 *   nu:             dimensionless
 *   density:        kg/m³
 *   CTE:            1/K (× 1e-6)
 *   conductivity:   W/(m·K)
 *   specific heat:  J/(kg·K)
 *   temperature:    °C
 */

/**
 * Piecewise-linear interpolator over (T, value) pairs sorted by T.
 */
function interp(table, T) {
  if (!table.length) return 0;
  if (T <= table[0][0]) return table[0][1];
  if (T >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (T <= table[i][0]) {
      const [t0, v0] = table[i - 1];
      const [t1, v1] = table[i];
      const a = (T - t0) / (t1 - t0);
      return v0 + a * (v1 - v0);
    }
  }
  return table[table.length - 1][1];
}

class Material {
  constructor(name, spec) {
    this.name = name;
    this.alias = spec.alias || [];
    this.density = spec.density;          // kg/m³ (T-independent, except thermal expansion)
    this.cte_table = spec.cte;            // [(T, α × 1e-6 / K)]
    this.E_table = spec.E;                // [(T, MPa)]
    this.nu_table = spec.nu;
    this.yield_table = spec.yield;
    this.UTS_table = spec.UTS;
    this.k_table = spec.k;                // W/(m·K)
    this.cp_table = spec.cp;              // J/(kg·K)
    this.fatigue = spec.fatigue || null;  // { Sf, b, Su }: Basquin
    this.maxServiceTempC = spec.maxServiceTempC ?? Infinity;
  }
  E(T = 20) { return interp(this.E_table, T); }
  nu(T = 20) { return interp(this.nu_table, T); }
  yield(T = 20) { return interp(this.yield_table, T); }
  UTS(T = 20) { return interp(this.UTS_table, T); }
  CTE(T = 20) { return interp(this.cte_table, T) * 1e-6; }
  k(T = 20) { return interp(this.k_table, T); }
  cp(T = 20) { return interp(this.cp_table, T); }
  /** Thermal diffusivity α = k / (ρ cp) in m²/s. */
  alpha(T = 20) { return this.k(T) / (this.density * this.cp(T)); }
  /** Shear modulus G = E / (2(1+ν)) */
  G(T = 20) { return this.E(T) / (2 * (1 + this.nu(T))); }
  /** Sanity: temperature in service envelope? */
  withinService(T) { return T <= this.maxServiceTempC; }
}

// ────────────────────────────────────────────────────────────────
// Tabulated data
// ────────────────────────────────────────────────────────────────
//
// Format for each table: [(T_°C, value), ...] sorted ascending.
// Values are "design-stage representative" (within 5-10% of typical
// vendor data sheets across the qualified range).

export const MaterialDB = {
  AL_6061_T6: new Material('Aluminum 6061-T6', {
    alias: ['Al-6061', '6061', '6061-T6'],
    density: 2700,
    E: [[-50, 71500], [20, 68900], [100, 67400], [200, 64500], [300, 56500], [371, 49000]],
    nu: [[20, 0.33], [200, 0.33], [371, 0.34]],
    yield: [[-50, 285], [20, 276], [100, 262], [200, 214], [300, 103], [371, 41]],
    UTS: [[20, 310], [100, 290], [200, 234], [300, 131], [371, 55]],
    cte: [[20, 23.6], [100, 24.3], [200, 25.2], [300, 26.0]],
    k: [[20, 167], [100, 172], [200, 180], [300, 184]],
    cp: [[20, 896], [100, 921], [200, 946], [300, 970]],
    fatigue: { Sf_at_1e6: 96, slope_b: -0.085, Su: 310 },
    maxServiceTempC: 371,
  }),

  AL_7075_T6: new Material('Aluminum 7075-T6', {
    alias: ['Al-7075', '7075', '7075-T6'],
    density: 2810,
    E: [[20, 71700], [100, 70300], [200, 65500], [300, 50000]],
    nu: [[20, 0.33]],
    yield: [[20, 503], [100, 460], [200, 295], [300, 75]],
    UTS: [[20, 572], [100, 520], [200, 340], [300, 110]],
    cte: [[20, 23.4], [100, 23.9], [200, 24.7]],
    k: [[20, 130], [100, 140], [200, 155]],
    cp: [[20, 960]],
    fatigue: { Sf_at_1e6: 159, slope_b: -0.080, Su: 572 },
    maxServiceTempC: 300,
  }),

  STEEL_4340: new Material('AISI 4340 (heat-treated)', {
    alias: ['4340', 'AISI 4340'],
    density: 7850,
    E: [[20, 200000], [200, 195000], [400, 185000], [538, 170000]],
    nu: [[20, 0.29]],
    yield: [[20, 1100], [200, 1050], [400, 920], [538, 750]],
    UTS: [[20, 1280], [200, 1220], [400, 1080], [538, 880]],
    cte: [[20, 12.3], [200, 13.1], [400, 13.8]],
    k: [[20, 44.5], [200, 42.0], [400, 39.0]],
    cp: [[20, 475]],
    fatigue: { Sf_at_1e6: 600, slope_b: -0.085, Su: 1280 },
    maxServiceTempC: 538,
  }),

  STAINLESS_316: new Material('Stainless 316', {
    alias: ['SS316', '316', 'AISI 316'],
    density: 8000,
    E: [[20, 193000], [200, 184000], [400, 169000], [600, 153000], [815, 130000]],
    nu: [[20, 0.30]],
    yield: [[20, 290], [200, 235], [400, 175], [600, 145], [815, 90]],
    UTS: [[20, 580], [200, 540], [400, 460], [600, 350], [815, 200]],
    cte: [[20, 16.0], [200, 16.7], [400, 17.5], [600, 18.6]],
    k: [[20, 16.3], [200, 17.5], [400, 19.0], [600, 21.5]],
    cp: [[20, 500]],
    fatigue: { Sf_at_1e6: 240, slope_b: -0.085, Su: 580 },
    maxServiceTempC: 870,
  }),

  TI_6AL_4V: new Material('Titanium 6Al-4V', {
    alias: ['Ti-6Al-4V', 'Ti64', 'Ti-6-4'],
    density: 4430,
    E: [[20, 113800], [100, 110000], [200, 105000], [300, 100000], [400, 95000], [550, 85000]],
    nu: [[20, 0.342]],
    yield: [[20, 880], [100, 800], [200, 720], [300, 660], [400, 600], [550, 480]],
    UTS: [[20, 950], [100, 870], [200, 790], [300, 720], [400, 660], [550, 540]],
    cte: [[20, 8.6], [200, 9.0], [400, 9.5]],
    k: [[20, 6.7], [200, 8.5], [400, 11.4]],
    cp: [[20, 526]],
    fatigue: { Sf_at_1e6: 510, slope_b: -0.080, Su: 950 },
    maxServiceTempC: 550,
  }),

  INCONEL_718: new Material('Inconel 718 (aged)', {
    alias: ['IN718', 'Inconel718', 'AMS 5662'],
    density: 8190,
    E: [[20, 207000], [200, 198000], [400, 184000], [600, 167000], [704, 153000]],
    nu: [[20, 0.294]],
    yield: [[20, 1100], [200, 1050], [400, 1000], [600, 930], [704, 850]],
    UTS: [[20, 1370], [200, 1300], [400, 1250], [600, 1130], [704, 1010]],
    cte: [[20, 13.0], [200, 13.4], [400, 14.0], [600, 14.6]],
    k: [[20, 11.2], [200, 13.5], [400, 16.0], [600, 19.0]],
    cp: [[20, 435]],
    fatigue: { Sf_at_1e6: 620, slope_b: -0.085, Su: 1370 },
    maxServiceTempC: 704,
  }),

  CMSX_4: new Material('CMSX-4 single crystal', {
    alias: ['CMSX-4', 'CMSX4'],
    density: 8700,
    // Anisotropic in reality (single crystal); these are <001> avg
    E: [[20, 137000], [400, 130000], [800, 110000], [1000, 92000], [1100, 76000]],
    nu: [[20, 0.39]],
    yield: [[20, 1000], [400, 1050], [800, 1100], [1000, 1000], [1100, 800]],
    UTS: [[20, 1100], [400, 1150], [800, 1200], [1000, 1080], [1100, 870]],
    cte: [[20, 11.5], [400, 12.5], [800, 14.0], [1000, 15.5]],
    k: [[20, 7.5], [400, 12.0], [800, 18.0], [1000, 24.0]],
    cp: [[20, 410]],
    fatigue: { Sf_at_1e6: 500, slope_b: -0.080, Su: 1100 },
    maxServiceTempC: 1100,
  }),

  AISI_1020: new Material('AISI 1020 mild steel', {
    alias: ['1020', 'AISI 1020', 'C1020'],
    density: 7870,
    E: [[20, 205000], [200, 198000], [400, 184000]],
    nu: [[20, 0.29]],
    yield: [[20, 350], [200, 320], [400, 280]],
    UTS: [[20, 420], [200, 400], [400, 360]],
    cte: [[20, 11.7], [200, 12.5]],
    k: [[20, 51.9], [200, 49.0]],
    cp: [[20, 486]],
    fatigue: { Sf_at_1e6: 200, slope_b: -0.085, Su: 420 },
    maxServiceTempC: 538,
  }),
};

/** Look up by name or alias. Case-insensitive. */
export function findMaterial(query) {
  const q = String(query).toLowerCase().replace(/[\s\-_]/g, '');
  for (const key of Object.keys(MaterialDB)) {
    const m = MaterialDB[key];
    const cands = [key, m.name, ...m.alias];
    for (const c of cands) {
      if (String(c).toLowerCase().replace(/[\s\-_]/g, '') === q) return m;
    }
  }
  return null;
}

/** Convenience list of (key, displayName) for UI dropdowns. */
export function listMaterials() {
  return Object.keys(MaterialDB).map(k => ({
    key: k, name: MaterialDB[k].name, density: MaterialDB[k].density,
  }));
}
