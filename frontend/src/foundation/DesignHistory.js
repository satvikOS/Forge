/**
 * ArchDisc Design History — append-only log of foundation tool runs.
 *
 * Every time a ribbon tool computes a result (Brayton, Combustor,
 * Blade Cooling, etc.), it pushes an entry here. The right-aside
 * DesignHistoryPanel subscribes via onChange() and re-renders, so
 * after a 13-step AI plan the user sees a 13-row timeline with
 * tool name, category, timestamp, and a one-line headline metric.
 *
 * This is the missing "design intent" surface — analogous to
 * Fusion 360's Browser / SolidWorks' FeatureManager / Onshape's
 * Parts list, but for analysis ops rather than geometry features.
 *
 * Storage: in-memory only (the SessionMemory module persists to
 * disk when needed). On a hard reload, the history starts empty.
 */

class DesignHistory {
  constructor() {
    this.entries = [];
    this._listeners = new Set();
  }

  /**
   * Record a tool run.
   *
   * @param {{ tool, tab, category, headline?, payloadKey?, payload? }} e
   */
  record(e) {
    if (!e || !e.tool) return;
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      when: new Date().toISOString(),
      tool: e.tool,
      tab: e.tab ?? null,
      category: e.category ?? null,
      headline: e.headline ?? '',
      payloadKey: e.payloadKey ?? null,
    };
    this.entries.push(entry);
    this._notify();
  }

  clear() {
    this.entries = [];
    this._notify();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) {
      try { fn(this.entries); } catch (err) { console.warn('history listener', err); }
    }
  }

  toJSON() { return [...this.entries]; }
}

const HISTORY = new DesignHistory();

if (typeof window !== 'undefined') {
  window.__archdiscHistory = HISTORY;
}

export function getHistory() { return HISTORY; }
export function recordToolRun(e) { HISTORY.record(e); }
export function clearHistory() { HISTORY.clear(); }

/**
 * Tool-specific headline formatters. Given the produced state,
 * return ONE punchy line for the timeline ("Thrust 380 kN, SFC 0.55").
 * Unknown tools fall back to a generic JSON-key summary.
 */
const FORMATTERS = {
  'Brayton Cycle': (s) => s && s.thrust_N
    ? `${(s.thrust_N / 1000).toFixed(1)} kN, SFC ${s.SFC_lb_per_lbf_hr?.toFixed(3) ?? '?'}`
    : '',
  'Combustor': (s) => s?.emissions
    ? `NOx EI ${s.emissions.EI_NOx_g_per_kgFuel?.toFixed(1)} g/kg, q' ${s.operating?.heatReleaseRate_MW_per_m3_atm?.toFixed(1)} MW/m³·atm`
    : '',
  'Blade Cooling': (s) => s?.T_metal_max_K
    ? `T_metal ${(s.T_metal_max_K - 273.15).toFixed(0)}°C ${s.survives_long_life ? '✓' : '✗'}`
    : '',
  'Compressor Stage': (s) => s?.deHaller_check
    ? `de Haller ${s.deHaller_check.passes ? 'OK' : 'FAIL'} (hub ${s.deHaller_check.hub?.toFixed(2)})`
    : '',
  'Turbine Stage': (s) => s?.work_per_kg ? `Δh ${(s.work_per_kg / 1000).toFixed(0)} kJ/kg` : '',
  'Nozzle': (s) => s?.conv?.Pe ? `P_exit ${(s.conv.Pe / 1000).toFixed(0)} kPa, V_exit ${s.conv.Ve_actual?.toFixed(0)} m/s` : '',
  'Heat Exchanger': (s) => s?.effectiveness ? `ε ${s.effectiveness.toFixed(3)}` : '',
  'Mission': (s) => s?.thrust_required_per_engine_N
    ? `${(s.thrust_required_per_engine_N / 1000).toFixed(1)} kN per engine`
    : '',
  'Rotordynamics': (s) => s?.criticalSpeedRPM ? `n_cr ${s.criticalSpeedRPM.toFixed(0)} RPM` : '',
  'Bearing Life': (s) => s?.life?.L10_hours ? `L10 ${s.life.L10_hours.toFixed(0)} h` : '',
  'Gear Mesh': (s) => s?.sigma_bending_MPa ? `σ_b ${s.sigma_bending_MPa.toFixed(1)} MPa` : '',
  'Shaft Sizing': (s) => s?.diameter_mm ? `Ø ${s.diameter_mm.toFixed(1)} mm` : '',
  'Bolted Joint': (s) => s?.safetyFactor ? `SF ${s.safetyFactor.toFixed(2)}` : '',
  'Spring Design': (s) => s?.K_W ? `K_W ${s.K_W.toFixed(2)}` : '',
  'Pressure Vessel': (s) => s?.wallThickness_mm ? `t ${s.wallThickness_mm.toFixed(2)} mm` : '',
  'Stress Concentration': (s) => s?.Kf_shoulder_bend ? `K_f ${s.Kf_shoulder_bend.toFixed(2)}` : '',
  'Forced Vibration': (s) => s?.peak_magnification
    ? `D ${s.peak_magnification.toFixed(2)} @ ${s.fn_Hz?.toFixed(1)} Hz`
    : '',
  'Linear Static FEA': (s) => s?.safetyFactor
    ? `σ_max ${s.maxStress_MPa?.toFixed(2) ?? '?'} MPa, SF ${s.safetyFactor.toFixed(2)}`
    : '',
  'Fatigue Analysis': (s) => s?.goodmanSF ? `Goodman SF ${s.goodmanSF.toFixed(2)}` : '',
  'Modal Analysis': (s) => s?.fundamentalHz ? `f₁ ${s.fundamentalHz.toFixed(1)} Hz` : '',
  'Mass Properties': (s) => s?.mass_kg ? `m ${s.mass_kg.toFixed(2)} kg` : '',
};

/**
 * Format a one-line headline for a tool result. Falls back to the
 * first two scalar fields if no specific formatter is registered.
 */
export function formatHeadline(tool, state) {
  const fn = FORMATTERS[tool];
  if (fn) {
    try {
      const out = fn(state);
      if (out) return out;
    } catch { /* swallow */ }
  }
  if (!state || typeof state !== 'object') return '';
  const scalars = Object.entries(state)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .slice(0, 2);
  return scalars.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', ');
}
