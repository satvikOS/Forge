/**
 * ArchDisc Tool Parameter Schemas.
 *
 * Each foundation ribbon tool that needs user-tweakable inputs
 * declares a small schema here. The schema is consumed by
 * ToolParamDialog (renders the modal) and by ToolExecutionEngine
 * handlers (read values from the dialog's submit).
 *
 * Why centralise: every tool previously hardcoded its inputs at
 * the top of its handler ("Trent-XWB at FL350 cruise" for Brayton,
 * "100 kg/s, 8000 RPM" for Compressor Stage, etc.). Industry peers
 * pop a small dialog before each compute — this matches that UX
 * while keeping the math identical.
 *
 * Schema shape:
 *   {
 *     title:  string,
 *     blurb:  string,         // one-line context for the dialog header
 *     fields: [{
 *       name:    string,      // key in the returned values object
 *       label:   string,
 *       type:    'number' | 'enum',
 *       default: number | string,
 *       unit?:   string,
 *       min?:    number,
 *       max?:    number,
 *       step?:   number,
 *       options?: string[],   // for enum
 *       hint?:   string,
 *     }],
 *   }
 *
 * Handlers call `requestToolParams(toolName)` which returns a
 * promise resolving to `{values, cancelled}`. If cancelled, the
 * handler should bail with a soft message.
 */

export const TOOL_PARAM_SCHEMAS = {
  'Brayton Cycle': {
    title: 'Brayton Cycle — Turbofan Inputs',
    blurb: 'Define the engine cycle. Defaults match Rolls-Royce Trent XWB at FL350.',
    fields: [
      { name: 'altitudeM',     label: 'Cruise altitude',  type: 'number', default: 10670, unit: 'm',  min: 0,    max: 15000, step: 100 },
      { name: 'machNumber',    label: 'Cruise Mach',      type: 'number', default: 0.85,  unit: 'M',  min: 0,    max: 1.2,   step: 0.01 },
      { name: 'bypassRatio',   label: 'Bypass ratio',     type: 'number', default: 9.6,   unit: ':1', min: 0,    max: 18,    step: 0.1, hint: 'High-bypass turbofans: 8–12' },
      { name: 'fanPR',         label: 'Fan pressure ratio', type: 'number', default: 1.45, unit: '',  min: 1.1,  max: 2.0,   step: 0.05 },
      { name: 'compressorPR',  label: 'HP/IP compressor PR', type: 'number', default: 34.5, unit: '', min: 5,   max: 60,    step: 0.5, hint: 'Total OPR = fanPR × this' },
      { name: 'T4_K',          label: 'TIT (T₄)',         type: 'number', default: 1750,  unit: 'K',  min: 1200, max: 2100,  step: 10 },
      { name: 'massFlowKgS',   label: 'Core mass flow',   type: 'number', default: 1300,  unit: 'kg/s', min: 50, max: 2000,  step: 10 },
    ],
  },

  'Compressor Stage': {
    title: 'Compressor Stage — Mean-line Inputs',
    blurb: 'Single axial fan/compressor stage. Defaults: 100 kg/s, 8 000 RPM, sea-level inlet.',
    fields: [
      { name: 'massFlowKgS', label: 'Mass flow',     type: 'number', default: 100,    unit: 'kg/s', min: 1,   max: 1500, step: 1 },
      { name: 'T_t1_K',      label: 'Inlet total T', type: 'number', default: 288.15, unit: 'K',    min: 200, max: 800,  step: 1 },
      { name: 'P_t1_Pa',     label: 'Inlet total P', type: 'number', default: 101325, unit: 'Pa',   min: 1e4, max: 5e6,  step: 1000 },
      { name: 'rpm',         label: 'Shaft speed',   type: 'number', default: 8000,   unit: 'RPM',  min: 1000, max: 30000, step: 100 },
      { name: 'r_tip_m',     label: 'Tip radius',    type: 'number', default: 0.6,    unit: 'm',    min: 0.05, max: 1.5,  step: 0.01 },
      { name: 'hubToTip',    label: 'Hub-to-tip',    type: 'number', default: 0.45,   unit: '',     min: 0.2,  max: 0.95, step: 0.01 },
      { name: 'axialMach1',  label: 'Inlet axial M', type: 'number', default: 0.5,    unit: 'M',    min: 0.3,  max: 0.7,  step: 0.01 },
      { name: 'deltaTtotal_K', label: 'ΔT_t per stage', type: 'number', default: 25, unit: 'K',    min: 5,    max: 60,   step: 1 },
      { name: 'polytropicEff', label: 'η_poly',     type: 'number', default: 0.90,    unit: '',     min: 0.7,  max: 0.97, step: 0.01 },
    ],
  },

  'Combustor': {
    title: 'Annular Combustor — Sizing Inputs',
    blurb: 'Lefebvre rules. Defaults match a 25 kg/s engine cruise design point.',
    fields: [
      { name: 'massFlowKgS',     label: 'Core flow',         type: 'number', default: 25,   unit: 'kg/s', min: 5,    max: 500,  step: 1 },
      { name: 'T_t3_K',          label: 'Inlet T (post-HPC)', type: 'number', default: 850, unit: 'K',    min: 500,  max: 1200, step: 10 },
      { name: 'P_t3_Pa',         label: 'Inlet P',            type: 'number', default: 3.7e6, unit: 'Pa', min: 5e5,  max: 1e7,  step: 1e5 },
      { name: 'T_t4_K',          label: 'Target TIT',         type: 'number', default: 1750, unit: 'K',  min: 1300, max: 2100, step: 10 },
      { name: 'residenceTime_ms', label: 'Residence time',    type: 'number', default: 10,   unit: 'ms', min: 2,    max: 50,   step: 1 },
    ],
  },

  'Blade Cooling': {
    title: 'HPT Blade Cooling — Inputs',
    blurb: 'Thermal-resistance model. Defaults: CMSX-4 + 0.3 mm YSZ TBC at T_gas = 1750 K.',
    fields: [
      { name: 'T_gas_K',     label: 'Gas T',         type: 'number', default: 1750, unit: 'K', min: 1200, max: 2100, step: 10 },
      { name: 'T_coolant_K', label: 'Coolant T',     type: 'number', default: 800,  unit: 'K', min: 500,  max: 1000, step: 10 },
      { name: 't_metal_m',   label: 'Metal thickness', type: 'number', default: 0.0015, unit: 'm', min: 0.0005, max: 0.005, step: 0.0001 },
      { name: 'k_metal',     label: 'k_metal',       type: 'number', default: 24,   unit: 'W/m·K', min: 5,  max: 50, step: 1 },
      { name: 't_TBC_m',     label: 'TBC thickness', type: 'number', default: 0.0003, unit: 'm', min: 0, max: 0.001, step: 0.00005 },
      { name: 'k_TBC',       label: 'k_TBC',         type: 'number', default: 1.0,  unit: 'W/m·K', min: 0.3, max: 3, step: 0.1 },
    ],
  },
};

export function getSchemaForTool(toolName) {
  return TOOL_PARAM_SCHEMAS[toolName] ?? null;
}

/** Quick default-values object — handlers fall back to these if dialog is bypassed. */
export function defaultsForTool(toolName) {
  const schema = TOOL_PARAM_SCHEMAS[toolName];
  if (!schema) return {};
  const out = {};
  for (const f of schema.fields) out[f.name] = f.default;
  return out;
}
