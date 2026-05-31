/**
 * ArchDisc AI Verifier — checks each plan step's output against
 * known analytical/empirical bounds. Catches the "AI made up a
 * number" failure mode by anchoring every metric to physics.
 *
 * For each tool the registry specifies the metrics it produces.
 * The Verifier additionally specifies BOUNDS rules per metric —
 * the same rules our e2e tests use, hoisted into a runtime check
 * that fires on every plan execution.
 *
 * Output: { ok, violations: [{stepIndex, tool, metric, expected, actual, severity}] }
 *
 * Severity:
 *   'info'    — for reporting only (e.g. "thrust is in expected band")
 *   'warn'    — design rule violated but not necessarily fatal
 *   'error'   — physics violated; plan should not proceed
 */

import { findTool } from './ToolRegistry.js';

/** Get a value from a nested object using a dotted path. */
function getPath(obj, p) {
  if (!obj) return undefined;
  return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * Bounds rules, keyed by `${tool} :: ${metric}`. Each rule is
 * { min, max, severity, description }.
 */
const BOUNDS = {
  // ─── Propulsion ─────────────────────────────────────────────
  'Mission :: range.range_km': { min: 1000, max: 20000, severity: 'warn',
    description: 'Aircraft mission range typically 1–20 Mm; outside flags an unusual configuration.' },
  'Brayton Cycle :: thrust_N': { min: 1000, max: 1000000, severity: 'error',
    description: 'Single engine thrust 1 kN-1 MN; outside is non-physical for a turbofan.' },
  'Brayton Cycle :: SFC_lb_per_lbf_hr': { min: 0.3, max: 2.0, severity: 'warn',
    description: 'Modern turbofan SFC 0.5-1.0; turbojet up to 1.5; outside is suspect.' },
  'Brayton Cycle :: OPR': { min: 5, max: 60, severity: 'warn',
    description: 'Overall pressure ratio typically 10-55 for turbofans.' },
  'Compressor Stage :: work.stagePR': { min: 1.0, max: 2.0, severity: 'warn',
    description: 'Single compressor stage PR 1.1-1.8; > 1.8 implies transonic with high losses.' },
  'Combustor :: emissions.EI_NOx_g_per_kgFuel': { min: 0, max: 200, severity: 'warn',
    description: 'NOx EI typically 5-100 g/kg for modern combustors.' },
  'Turbine Stage :: work.stagePR_drop': { min: 0.2, max: 1.0, severity: 'warn',
    description: 'Single turbine stage PR_drop 0.4-0.8 typical.' },
  'Blade Cooling :: T_metal_max_K': { min: 800, max: 1473, severity: 'error',
    description: 'CMSX-4 long-life limit ~1373 K; > 1473 K (1200 °C) is unsurvivable.' },
  'Blade Cooling :: survives_long_life': { equals: true, severity: 'warn',
    description: 'Long-life cooling design rule violated.' },
  'Nozzle :: conv.choked': { equals: true, severity: 'info',
    description: 'Convergent nozzle should be choked for typical engine PR.' },
  'Heat Exchanger :: effectiveness': { min: 0, max: 1, severity: 'error',
    description: 'Effectiveness must be in [0, 1] by definition.' },

  // ─── Structural ─────────────────────────────────────────────
  'Linear Static FEA :: errorPct': { min: -20, max: 20, severity: 'warn',
    description: 'Bending error vs Euler-Bernoulli typically < 5% for quad-tet on fine mesh.' },
  'Linear Static FEA :: safetyFactor': { min: 1.0, max: Infinity, severity: 'error',
    description: 'Safety factor below 1 implies yielding.' },
  'Modal Analysis :: fundamentalHz': { min: 0.1, max: 100000, severity: 'error',
    description: 'Natural frequency must be positive and physical.' },
  'Fatigue Analysis :: goodmanSF': { min: 1.0, max: Infinity, severity: 'warn',
    description: 'Goodman SF < 1 means stress range exceeds fatigue capacity.' },
  'Forced Vibration :: transmissibility_r_sqrt2': { near: 1.0, tol: 0.01, severity: 'info',
    description: 'TR at r=√2 should be exactly 1 regardless of damping (universal property).' },

  // ─── Machine elements ───────────────────────────────────────
  'Bearing Life :: life.L10_hours': { min: 100, max: 1e8, severity: 'warn',
    description: 'Bearing L10 100 hr - 100 Mhr typical; outside suggests load/rating error.' },
  'Gear Mesh :: safetyFactors.bending': { min: 1.5, max: Infinity, severity: 'warn',
    description: 'AGMA bending SF should be ≥ 1.5 for production gears.' },
  'Shaft Sizing :: goodman.diameter_mm': { min: 3, max: 500, severity: 'warn',
    description: 'Shaft diameter in a sensible engineering range.' },
  'Bolted Joint :: safetyFactors.separation': { min: 1.0, max: Infinity, severity: 'error',
    description: 'Bolted joint must not separate under design load.' },

  // ─── Geometric ──────────────────────────────────────────────
  'Linear Pattern :: volume': { min: 0, max: 1e12, severity: 'error',
    description: 'Manifold volume must be positive.' },
  'Mass Properties :: mass_kg': { min: 0, max: 1e6, severity: 'error',
    description: 'Mass must be positive.' },
  'Mass Properties :: volume_mm3': { min: 0, max: 1e15, severity: 'error',
    description: 'Volume must be positive.' },
};

/**
 * Verify a single step's state against bounds.
 *
 * @param {object} step                from PlanExecutor (has .tool and .state)
 * @returns {Array}                    violations array (possibly empty)
 */
export function verifyStep(step) {
  const meta = findTool(step.tool);
  if (!meta) return [];
  const metrics = meta.metrics || [];
  const violations = [];
  for (const metric of metrics) {
    const key = `${step.tool} :: ${metric}`;
    const rule = BOUNDS[key];
    if (!rule) continue;            // no bounds defined → silent pass
    const actual = getPath(step.state, metric);
    if (actual === undefined) continue;

    let violated = false;
    let expected;
    if (rule.equals !== undefined) {
      violated = actual !== rule.equals;
      expected = `== ${rule.equals}`;
    } else if (rule.near !== undefined) {
      violated = Math.abs(actual - rule.near) > (rule.tol ?? 0);
      expected = `~ ${rule.near} ± ${rule.tol ?? 0}`;
    } else {
      const min = rule.min ?? -Infinity;
      const max = rule.max ?? Infinity;
      violated = actual < min || actual > max;
      expected = `[${min}, ${max}]`;
    }
    if (violated) {
      violations.push({
        stepIndex: step.stepIndex,
        tool: step.tool,
        metric,
        expected,
        actual,
        severity: rule.severity,
        description: rule.description,
      });
    }
  }
  return violations;
}

/**
 * Verify an entire plan-executor result. Returns:
 *   {
 *     ok: false if any 'error' violation, true otherwise,
 *     violations: [...],
 *     errorCount, warnCount, infoCount,
 *   }
 */
export function verifyPlan(planResult) {
  const all = [];
  for (const step of planResult.steps || []) {
    all.push(...verifyStep(step));
  }
  const errorCount = all.filter(v => v.severity === 'error').length;
  const warnCount = all.filter(v => v.severity === 'warn').length;
  const infoCount = all.filter(v => v.severity === 'info').length;
  return {
    ok: errorCount === 0,
    violations: all,
    errorCount, warnCount, infoCount,
  };
}

export const BOUNDS_RULES = BOUNDS;
