/**
 * ArchDisc AI Clarifier — asks the right questions before planning.
 *
 * Works without an LLM via a static decision-tree of clarifying
 * questions per domain. When the user wires their AI later, the
 * planner can hand the prompt to an LLM to generate sharper
 * questions, but the static fallback always works.
 *
 * Each clarification kit is a domain (engine, structure, sheet
 * metal, gearbox, electronics-housing) and produces:
 *   - The 5–15 highest-leverage questions
 *   - Suggested default if user skips
 *   - Whether that field is REQUIRED (block) or ASSUMED (proceed)
 *
 * Usage:
 *   const kit = pickClarificationKit(userPrompt);
 *   const answered = await uiAskUser(kit.questions);
 *   const augmentedPrompt = mergeAnswersIntoPrompt(userPrompt, answered);
 *
 * Reference: VDI 2221 (Systematic Approach to Engineering Design);
 * Pahl & Beitz "Engineering Design" §3-5 (Clarification of the Task).
 */

const DOMAIN_KEYWORDS = {
  engine: [
    'engine', 'turbofan', 'turbojet', 'turboshaft', 'gas turbine',
    'jet', 'rolls', 'royce', 'pratt', 'whitney', 'cfm', 'leap',
    'propulsion', 'thrust', 'compressor', 'turbine',
  ],
  structure: [
    'bracket', 'frame', 'beam', 'truss', 'pylon', 'mount',
    'chassis', 'spar', 'rib', 'fuselage panel', 'load',
  ],
  gearbox: [
    'gearbox', 'transmission', 'gear', 'drivetrain', 'reducer',
  ],
  pressure_vessel: [
    'pressure vessel', 'tank', 'pipe', 'asme', 'reactor',
    'autoclave', 'cryostat',
  ],
  sheet_metal: [
    'sheet metal', 'bend', 'fold', 'flat pattern', 'panel',
  ],
  housing: [
    'housing', 'enclosure', 'casing', 'box', 'cabinet',
  ],
};

/**
 * Score a user prompt against each domain. Returns the most likely
 * domain plus the confidence (fraction of matched keywords).
 */
export function detectDomain(prompt) {
  if (!prompt) return { domain: 'generic', confidence: 0 };
  const p = prompt.toLowerCase();
  let best = { domain: 'generic', confidence: 0 };
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let hits = 0;
    for (const k of keywords) if (p.includes(k.toLowerCase())) hits++;
    const conf = hits / keywords.length;
    if (conf > best.confidence) best = { domain, confidence: conf, hits };
  }
  return best;
}

const KITS = {
  engine: {
    name: 'Turbofan engine design',
    questions: [
      { id: 'thrust_class', q: 'Thrust class (kN) at sea-level static?', required: true,  default: 350, type: 'number' },
      { id: 'cruise_mach', q: 'Cruise Mach number?', required: true,  default: 0.85, type: 'number' },
      { id: 'cruise_alt_m', q: 'Cruise altitude (m)?', required: true,  default: 10670, type: 'number' },
      { id: 'bypass_ratio', q: 'Bypass ratio (BPR)?', required: true,  default: 10, type: 'number' },
      { id: 'opr_cruise', q: 'Overall pressure ratio at cruise?', required: true,  default: 50, type: 'number' },
      { id: 'tit_max', q: 'Maximum turbine entry temperature (K)?', required: true,  default: 1750, type: 'number' },
      { id: 'certification', q: 'Certification basis?', required: true,  default: 'EASA CS-E', type: 'enum',
        options: ['FAA Part 33', 'EASA CS-E', 'MIL-E-5007E (military)'] },
      { id: 'hot_section_material', q: 'Hot-section blade material?', required: false, default: 'CMSX-4', type: 'enum',
        options: ['CMSX-4 (single crystal)', 'Inconel 718', 'Rene N5'] },
      { id: 'noise_chapter', q: 'Acoustic chapter target?', required: false, default: 'Chapter 14', type: 'enum',
        options: ['Chapter 4', 'Chapter 14', 'CAEP/12'] },
      { id: 'mount_interface', q: 'Pylon-attachment standard?', required: false, default: 'Airbus 4-link', type: 'string' },
    ],
  },
  structure: {
    name: 'Structural component design',
    questions: [
      { id: 'material', q: 'Material?', required: true, default: 'Aluminum 6061-T6', type: 'enum',
        options: ['Aluminum 6061-T6', 'Aluminum 7075-T6', 'Steel AISI 4340', 'Titanium 6Al-4V', 'Stainless 316'] },
      { id: 'load_type', q: 'Load type?', required: true, default: 'tensile', type: 'enum',
        options: ['tensile', 'bending', 'torsion', 'combined', 'cyclic'] },
      { id: 'load_magnitude_N', q: 'Peak load magnitude (N)?', required: true, default: 1000, type: 'number' },
      { id: 'safety_factor', q: 'Design safety factor?', required: true, default: 2.0, type: 'number' },
      { id: 'fatigue_cycles', q: 'Target fatigue life (cycles)?', required: false, default: 1e7, type: 'number' },
      { id: 'temp_range_C', q: 'Service temperature range (°C)?', required: false, default: '-40 to 80', type: 'string' },
      { id: 'tolerance_class', q: 'GD&T tolerance class?', required: false, default: 'ISO 2768-m', type: 'enum',
        options: ['ISO 2768-f (fine)', 'ISO 2768-m (medium)', 'ISO 2768-c (coarse)'] },
    ],
  },
  gearbox: {
    name: 'Gearbox / transmission design',
    questions: [
      { id: 'input_torque_Nm', q: 'Input torque (N·m)?', required: true, default: 100, type: 'number' },
      { id: 'input_rpm', q: 'Input RPM?', required: true, default: 3000, type: 'number' },
      { id: 'reduction_ratio', q: 'Required reduction ratio?', required: true, default: 3.0, type: 'number' },
      { id: 'life_hours', q: 'Target service life (hours)?', required: true, default: 20000, type: 'number' },
      { id: 'duty_cycle', q: 'Duty cycle?', required: false, default: 'continuous', type: 'enum',
        options: ['continuous', 'intermittent', 'shock'] },
      { id: 'material', q: 'Gear material?', required: false, default: 'AISI 4140', type: 'string' },
    ],
  },
  pressure_vessel: {
    name: 'Pressure vessel design',
    questions: [
      { id: 'design_pressure_MPa', q: 'Design pressure (MPa)?', required: true, default: 1, type: 'number' },
      { id: 'design_temperature_C', q: 'Design temperature (°C)?', required: true, default: 100, type: 'number' },
      { id: 'material', q: 'Material?', required: true, default: 'SA-516 Gr 70', type: 'string' },
      { id: 'joint_efficiency', q: 'Joint efficiency (full / spot / no RT)?', required: false, default: 0.85, type: 'number' },
      { id: 'corrosion_allowance_mm', q: 'Corrosion allowance (mm)?', required: false, default: 1.5, type: 'number' },
      { id: 'code', q: 'Code?', required: true, default: 'ASME BPVC VIII Div 1', type: 'enum',
        options: ['ASME BPVC VIII Div 1', 'ASME BPVC VIII Div 2', 'EN 13445'] },
    ],
  },
  sheet_metal: {
    name: 'Sheet-metal part',
    questions: [
      { id: 'material', q: 'Material?', required: true, default: 'Aluminum 5052-H32', type: 'string' },
      { id: 'thickness_mm', q: 'Sheet thickness (mm)?', required: true, default: 1.5, type: 'number' },
      { id: 'k_factor', q: 'K-factor for bend allowance?', required: false, default: 0.42, type: 'number' },
      { id: 'min_bend_radius_mm', q: 'Minimum bend radius (mm)?', required: false, default: 1.5, type: 'number' },
    ],
  },
  housing: {
    name: 'Electronics / mechanical housing',
    questions: [
      { id: 'internal_volume_mm3', q: 'Required internal volume (mm³)?', required: true, default: 100000, type: 'number' },
      { id: 'ip_rating', q: 'Ingress-protection rating?', required: false, default: 'IP54', type: 'enum',
        options: ['IP20', 'IP54', 'IP65', 'IP67', 'IP68'] },
      { id: 'mounting', q: 'Mounting method?', required: false, default: 'flange-bolted', type: 'enum',
        options: ['flange-bolted', 'DIN rail', 'panel-mount', 'free-standing'] },
      { id: 'cooling', q: 'Cooling method?', required: false, default: 'passive (convection)', type: 'enum',
        options: ['passive (convection)', 'forced air', 'liquid cold-plate'] },
    ],
  },
  generic: {
    name: 'Generic engineering design',
    questions: [
      { id: 'description',     q: 'One-sentence description of what you want?', required: true,  default: '', type: 'string' },
      { id: 'units',           q: 'Units (SI / Imperial)?',                       required: true,  default: 'SI', type: 'enum',
        options: ['SI', 'Imperial'] },
      { id: 'budget',          q: 'Approximate budget per unit?',                  required: false, default: 'N/A', type: 'string' },
    ],
  },
};

/**
 * Pick the clarification kit matching the user's prompt.
 *
 * @param {string} prompt
 * @returns {{ domain, kit, questions, confidence }}
 */
export function pickClarificationKit(prompt) {
  const detected = detectDomain(prompt);
  const kit = KITS[detected.domain] || KITS.generic;
  return { domain: detected.domain, confidence: detected.confidence, kit };
}

/**
 * Apply user answers to the prompt context. Returns the merged
 * context that the planner can read.
 */
export function applyAnswers(kit, answers) {
  const merged = {};
  for (const q of kit.questions) {
    merged[q.id] = (answers && q.id in answers && answers[q.id] !== undefined && answers[q.id] !== null)
      ? answers[q.id]
      : q.default;
  }
  return merged;
}

/**
 * Return the list of REQUIRED questions still unanswered (the
 * planner should not start until these are answered or explicitly
 * skipped with a default).
 */
export function unansweredRequired(kit, answers) {
  return kit.questions.filter(q =>
    q.required && (!answers || answers[q.id] === undefined || answers[q.id] === null)
  );
}
