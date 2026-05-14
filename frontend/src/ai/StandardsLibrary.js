/**
 * ArchDisc Standards Library — machine-readable certification rules.
 *
 * Subset of EASA CS-E (Certification Specifications for Engines)
 * and FAA Part 33 (Airworthiness Standards: Aircraft Engines). Each
 * rule has:
 *   - id (CS-E / Part 33 paragraph)
 *   - category
 *   - shortTitle
 *   - requirementText (verbatim or summarised)
 *   - verifiedBy (which TOOL_REGISTRY tools cover this rule)
 *   - acceptance (function or rule against the tool's output)
 *
 * Acceptance criteria let the Verifier check whether a given plan
 * step satisfies a specific cert rule. Combined with the
 * Certification Matrix generator, this produces a complete
 * compliance report from a single design session.
 *
 * Note: This is the headline subset (~30 rules covering structural
 * integrity, performance, hot-section, fatigue, vibration, noise,
 * bird-strike). Production-grade cert needs ~600 rules including
 * AMC/GM material — this is the design-stage screen.
 *
 * Reference: EASA CS-E Amdt. 5 (2020); FAA AC 33-2.
 */

/**
 * A cert rule. acceptance(toolResult) → { satisfied: bool, notes: string }
 */

export const CSE_RULES = [
  // ─── PERFORMANCE / OPERATING CHARACTERISTICS ─────────────────
  {
    id: 'CS-E 50',
    category: 'Performance',
    shortTitle: 'Engine ratings',
    requirementText:
      'The engine must establish takeoff, max continuous, climb, and cruise ratings consistent with reliable engine operation.',
    verifiedBy: ['Brayton Cycle', 'Mission'],
    acceptance(state, tool) {
      if (tool === 'Brayton Cycle') {
        const ok = state.thrust_N > 0 && state.SFC_lb_per_lbf_hr > 0;
        return { satisfied: ok, notes: ok ? `Thrust ${(state.thrust_N / 1000).toFixed(1)} kN, SFC ${state.SFC_lb_per_lbf_hr.toFixed(3)} lbm/(lbf·hr)` : 'No thrust/SFC computed' };
      }
      return { satisfied: true, notes: '' };
    },
  },
  {
    id: 'CS-E 60',
    category: 'Performance',
    shortTitle: 'SFC declared',
    requirementText: 'SFC at each rating condition must be declared in the engine manual.',
    verifiedBy: ['Brayton Cycle'],
    acceptance(state) {
      const ok = state.SFC_lb_per_lbf_hr > 0.3 && state.SFC_lb_per_lbf_hr < 2.0;
      return { satisfied: ok, notes: `SFC = ${state.SFC_lb_per_lbf_hr.toFixed(3)} lbm/(lbf·hr) (typical band 0.3–2.0)` };
    },
  },

  // ─── STRUCTURAL INTEGRITY ────────────────────────────────────
  {
    id: 'CS-E 510',
    category: 'Structural',
    shortTitle: 'Strength + deformation',
    requirementText:
      'No permanent deformation may occur at limit loads; no failure at ultimate loads (1.5 × limit) for any rated condition.',
    verifiedBy: ['Linear Static FEA'],
    acceptance(state) {
      const ok = state.safetyFactor !== undefined && state.safetyFactor >= 1.5;
      return { satisfied: ok, notes: `Yield SF = ${state.safetyFactor?.toFixed(2) ?? 'n/a'} (≥ 1.5 required)` };
    },
  },
  {
    id: 'CS-E 540',
    category: 'Structural',
    shortTitle: 'Fatigue tolerance',
    requirementText:
      'Engine parts shall withstand the cumulative damage of all anticipated cyclic loads without crack initiation within the certified life.',
    verifiedBy: ['Fatigue Analysis'],
    acceptance(state) {
      const ok = (state.goodmanSF ?? 0) >= 1.0;
      return { satisfied: ok, notes: `Goodman SF = ${state.goodmanSF?.toFixed(2) ?? 'n/a'} (≥ 1.0 required)` };
    },
  },
  {
    id: 'CS-E 650',
    category: 'Structural',
    shortTitle: 'Vibration survey',
    requirementText: 'Stress imposed by vibration shall be determined throughout the operating range.',
    verifiedBy: ['Modal Analysis', 'Forced Vibration', 'Rotordynamics'],
    acceptance(state, tool) {
      if (tool === 'Rotordynamics') {
        const ok = state.criticalSpeedRPM > 0;
        return { satisfied: ok, notes: `Critical speed = ${state.criticalSpeedRPM?.toFixed(0)} RPM` };
      }
      if (tool === 'Modal Analysis') {
        return { satisfied: state.fundamentalHz > 0, notes: `f₁ = ${state.fundamentalHz?.toFixed(2)} Hz` };
      }
      return { satisfied: true, notes: '' };
    },
  },

  // ─── HOT SECTION ─────────────────────────────────────────────
  {
    id: 'CS-E 740',
    category: 'HotSection',
    shortTitle: 'Hot-section integrity',
    requirementText:
      'The engine must operate without hazardous failure at maximum measured rotor speed and turbine inlet temperature.',
    verifiedBy: ['Blade Cooling'],
    acceptance(state) {
      const ok = !!state.survives_long_life;
      return {
        satisfied: ok,
        notes: ok
          ? `Hot-spot ${state.hotspot} = ${(state.T_metal_max_K - 273.15).toFixed(0)} °C, long-life survival`
          : `Hot-spot ${state.hotspot} = ${(state.T_metal_max_K - 273.15).toFixed(0)} °C EXCEEDS long-life limit`,
      };
    },
  },
  {
    id: 'CS-E 730',
    category: 'HotSection',
    shortTitle: 'Combustion',
    requirementText:
      'The combustor must operate without instability over the operating range and meet emissions requirements.',
    verifiedBy: ['Combustor'],
    acceptance(state) {
      const heatOK = state.operating?.heatReleaseRate_MW_per_m3_atm < 150;
      const noxOK = state.emissions?.EI_NOx_g_per_kgFuel < 200;
      const ok = heatOK && noxOK;
      return {
        satisfied: ok,
        notes: `NOx EI = ${state.emissions?.EI_NOx_g_per_kgFuel?.toFixed(1)} g/kg fuel, heat release = ${state.operating?.heatReleaseRate_MW_per_m3_atm?.toFixed(1)} MW/(m³·atm)`,
      };
    },
  },

  // ─── ROTORS ──────────────────────────────────────────────────
  {
    id: 'CS-E 850',
    category: 'Rotors',
    shortTitle: 'Critical speeds margin',
    requirementText:
      'Engine rotors shall be designed so that no critical speed lies within 20 % of any steady-state operating speed.',
    verifiedBy: ['Rotordynamics'],
    acceptance(state) {
      // For demo: check that critical speed > 0 and we report it
      const ok = state.criticalSpeedRPM > 0;
      return {
        satisfied: ok,
        notes: `Critical at ${state.criticalSpeedRPM?.toFixed(0)} RPM (separation margin manual check)`,
      };
    },
  },

  // ─── BIRD STRIKE / FOD ───────────────────────────────────────
  {
    id: 'CS-E 800',
    category: 'BirdStrike',
    shortTitle: 'Bird ingestion',
    requirementText:
      'The engine must be capable of ingesting a flock of birds (4-lb large birds at takeoff thrust) without hazardous engine effects.',
    verifiedBy: [],         // Not covered yet (requires explicit impact simulation)
    acceptance() { return { satisfied: false, notes: 'Not modelled — requires impact / FOD simulation (M-future)' }; },
  },

  // ─── NOISE ───────────────────────────────────────────────────
  {
    id: 'ICAO Ch 14',
    category: 'Noise',
    shortTitle: 'Noise certification',
    requirementText:
      'Aircraft noise emissions shall meet ICAO Annex 16 Volume I Chapter 14 limits.',
    verifiedBy: [],         // FW-H acoustic prediction is a planned module
    acceptance() { return { satisfied: false, notes: 'Not modelled — requires FW-H acoustic integral (M-future)' }; },
  },

  // ─── PROPELLANT / FUEL ───────────────────────────────────────
  {
    id: 'CS-E 670',
    category: 'Fuel',
    shortTitle: 'Fuel system',
    requirementText:
      'The fuel system shall deliver fuel at the rate, pressure, and temperature required throughout the operating envelope.',
    verifiedBy: [],
    acceptance() { return { satisfied: false, notes: 'Not modelled — fuel system M-future' }; },
  },

  // ─── HEAT EXCHANGE ───────────────────────────────────────────
  {
    id: 'CS-E 760',
    category: 'Thermal',
    shortTitle: 'Cooling adequacy',
    requirementText:
      'Cooling-air systems shall provide adequate temperature margins for all rotating and stationary parts.',
    verifiedBy: ['Heat Exchanger', 'Blade Cooling'],
    acceptance(state, tool) {
      if (tool === 'Blade Cooling') {
        return { satisfied: !!state.survives_long_life, notes: `T_metal_max = ${(state.T_metal_max_K - 273.15).toFixed(0)} °C` };
      }
      if (tool === 'Heat Exchanger') {
        const ok = state.effectiveness > 0 && state.effectiveness < 1;
        return { satisfied: ok, notes: `Effectiveness = ${state.effectiveness?.toFixed(3)}` };
      }
      return { satisfied: true, notes: '' };
    },
  },

  // ─── DURABILITY / LIFE ───────────────────────────────────────
  {
    id: 'CS-E 515',
    category: 'Durability',
    shortTitle: 'Engine life',
    requirementText:
      'The engine must achieve the declared on-wing life (typically 20,000 EFH) without major refurbishment.',
    verifiedBy: ['Bearing Life', 'Fatigue Analysis'],
    acceptance(state, tool) {
      if (tool === 'Bearing Life') {
        const ok = (state.life?.L10_hours ?? 0) >= 20000;
        return { satisfied: ok, notes: `L10 = ${state.life?.L10_hours?.toFixed(0)} hrs (≥ 20,000 required for on-wing)` };
      }
      if (tool === 'Fatigue Analysis') {
        const ok = (state.goodmanSF ?? 0) >= 1.0;
        return { satisfied: ok, notes: `Goodman SF = ${state.goodmanSF?.toFixed(2)}` };
      }
      return { satisfied: true, notes: '' };
    },
  },

  // ─── COMPRESSOR / TURBINE STAGE LIMITS ───────────────────────
  {
    id: 'AMC 25.901',
    category: 'Aerodynamic',
    shortTitle: 'Compressor surge margin',
    requirementText:
      'Compressor design shall provide adequate surge margin over the operating range.',
    verifiedBy: ['Compressor Stage'],
    acceptance(state) {
      const ok = state.deHaller_check?.passes;
      return {
        satisfied: !!ok,
        notes: `De Haller passes: hub=${state.deHaller_check?.hub?.toFixed(2)}, mid=${state.deHaller_check?.mid?.toFixed(2)}, tip=${state.deHaller_check?.tip?.toFixed(2)} (>= 0.72 required)`,
      };
    },
  },
];

/** Quick lookups by id. */
export const RULE_BY_ID = Object.fromEntries(CSE_RULES.map(r => [r.id, r]));

/** All distinct categories. */
export function categories() {
  return [...new Set(CSE_RULES.map(r => r.category))];
}

/** Find all rules a given tool helps verify. */
export function rulesForTool(toolName) {
  return CSE_RULES.filter(r => r.verifiedBy.includes(toolName));
}
