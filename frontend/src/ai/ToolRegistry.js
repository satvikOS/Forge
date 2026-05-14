/**
 * ArchDisc AI Tool Registry — machine-readable schema of every
 * ribbon-tool integration. ANY AI provider (OpenAI, Anthropic,
 * local Llama, etc.) can read this catalogue and emit valid plans
 * that ArchDisc's executor will run.
 *
 * Each entry describes:
 *   - tool name (matches ribbon-tool label exactly)
 *   - tab (Sketch / Part / Assembly / Simulate / Manufacture / Drawing)
 *   - category (Pattern / Boolean / Propulsion / Structural / …)
 *   - what it produces (sets one of the window.__last* slots)
 *   - cost band (cheap / medium / heavy) so the planner can budget
 *   - typical metrics produced (so the verifier knows what to check)
 *
 * The registry is intentionally STATIC (not auto-extracted from
 * TOOL_HANDLERS) so AI plans are stable across UI refactors —
 * adding a new ribbon button requires a new registry entry.
 */

export const TOOL_REGISTRY = [
  // ─── PART tab ───────────────────────────────────────────────
  { name: 'Linear Pattern',     tab: 'Part', category: 'Pattern',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume', 'bbox'],
    description: 'N copies of a seed body along an axis. Default: 4× Ø6×15 mm cylinders spaced 20 mm along +X.' },
  { name: 'Circular Pattern',   tab: 'Part', category: 'Pattern',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume', 'bbox'],
    description: 'N copies around an axis. Default: 6 fins around +Z.' },
  { name: 'Mirror Feature',     tab: 'Part', category: 'Pattern',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Reflect a body across a plane and union with original.' },
  { name: 'Sweep Boss',         tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume', 'bbox'],
    description: 'Sweep a 2D profile along a 3D path. Default: Ø2 mm circle along NURBS quarter-arc R=10.' },
  { name: 'Loft Boss',          tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume', 'bbox'],
    description: 'Loft N cross-sections into a smooth solid. Default: 4 circles, R=5→4→2→1, H=30 mm.' },
  { name: 'Hole Wizard',        tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Subtract a Ø8 mm through-hole from a 50×30×20 mm block.' },
  { name: 'Combine',            tab: 'Part', category: 'Boolean',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Boolean union of two overlapping 30³ mm cubes.' },
  { name: 'Subtract',           tab: 'Part', category: 'Boolean',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Cube minus sphere at face center.' },
  { name: 'Intersect',          tab: 'Part', category: 'Boolean',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume', 'bbox'],
    description: 'Cube ∩ sphere → rounded cube.' },
  { name: 'Revolve Boss',       tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Revolve a stepped-shaft profile 360°.' },
  { name: 'Shell',              tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Hollow a 30³ mm cube to 2 mm wall thickness.' },
  { name: 'Extrude Boss',       tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Extrude an 80×50 mm rectangle 25 mm along +Z.' },
  { name: 'Extrude Cut',        tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Extrude-subtract a 15×15 mm through pocket.' },
  { name: 'Fillet',             tab: 'Part', category: 'Feature',
    produces: '__lastFoundationManifold', cost: 'cheap',
    metrics: ['volume'],
    description: 'Rounded box (50×30×20, r=5 mm on all edges).' },

  // ─── ASSEMBLY tab ───────────────────────────────────────────
  { name: 'Mass Properties',    tab: 'Assembly', category: 'Inspect',
    produces: '__lastMassProps', cost: 'cheap',
    metrics: ['volume_mm3', 'mass_kg', 'centroid_mm', 'inertiaCOM'],
    description: 'Full Mirtich inertia tensor + COM + bounding box of current foundation body.' },

  // ─── SIMULATE tab — Structural ──────────────────────────────
  { name: 'Linear Static FEA',  tab: 'Simulate', category: 'Structural',
    produces: '__lastFEAResult', cost: 'medium',
    metrics: ['cantileverDeltaMm', 'errorPct', 'maxStressMPa', 'safetyFactor'],
    description: 'Quad-tet cantilever validation: −1.4% vs Euler-Bernoulli.' },
  { name: 'Modal Analysis',     tab: 'Simulate', category: 'Structural',
    produces: '__lastModalResult', cost: 'medium',
    metrics: ['fundamentalHz', 'analyticalHz'],
    description: 'First lateral natural frequency via inverse iteration on K x = ω² M x.' },
  { name: 'Buckling Analysis',  tab: 'Simulate', category: 'Structural',
    produces: '__lastBucklingResult', cost: 'medium',
    metrics: ['criticalLoadN', 'analyticalPcrN'],
    description: 'Euler column critical load via geometric stiffness eigenproblem.' },
  { name: 'Frame FEA',          tab: 'Simulate', category: 'Structural',
    produces: '__lastFrameFEAResult', cost: 'medium',
    metrics: ['topLeftDriftMm', 'topRightDriftMm'],
    description: '12-DOF beam FEA of a 4 m × 3 m steel portal with 5 kN lateral load.' },
  { name: 'Rotordynamics',      tab: 'Simulate', category: 'Structural',
    produces: '__lastRotordynResult', cost: 'medium',
    metrics: ['firstNaturalHz', 'criticalSpeedRPM'],
    description: '1D shaft + disk + bearing → first natural Hz, critical RPM.' },
  { name: 'Fatigue Analysis',   tab: 'Simulate', category: 'Structural',
    produces: '__lastFatigueResult', cost: 'cheap',
    metrics: ['goodmanSF', 'lifeCycles'],
    description: '4340 reversed ±400 MPa → Goodman, Soderberg, Gerber, Basquin life.' },
  { name: 'Forced Vibration',   tab: 'Simulate', category: 'Structural',
    produces: '__lastVibrationResult', cost: 'cheap',
    metrics: ['fn_Hz', 'peak_magnification', 'transmissibility_r_sqrt2'],
    description: 'SDOF FRF + transmissibility + half-power damping ID.' },
  { name: 'Stress Concentration', tab: 'Simulate', category: 'Structural',
    produces: '__lastSCFResult', cost: 'cheap',
    metrics: ['shoulderFillet', 'plateHole_d_W_0_3'],
    description: 'Peterson SCF library — shoulder/hole/keyway/notch.' },

  // ─── SIMULATE — Thermal ─────────────────────────────────────
  { name: 'Steady-State Thermal', tab: 'Simulate', category: 'Thermal',
    produces: '__lastThermalResult', cost: 'medium',
    metrics: ['midTempC', 'errorPct'],
    description: '1D thermal FEM with Dirichlet BCs — T(50 mm) = 50 °C exact for the canonical rod.' },
  { name: 'CFD Flow Simulation', tab: 'Simulate', category: 'Thermal',
    produces: '__lastCFDResult', cost: 'heavy',
    metrics: ['timeSteps', 'rmsErrorVsGhia'],
    description: 'Lid-driven cavity Re=100 — vorticity-streamfunction NS, validates against Ghia 1982.' },

  // ─── SIMULATE — Optimize ────────────────────────────────────
  { name: 'Topology Optimization', tab: 'Simulate', category: 'Optimize',
    produces: '__lastTopOptResult', cost: 'heavy',
    metrics: ['finalCompliance', 'outerIterations'],
    description: 'SIMP with sensitivity filter on a 60×20×10 mm cantilever, target V_f=0.35.' },

  // ─── SIMULATE — Machine Elements ────────────────────────────
  { name: 'Bearing Life',       tab: 'Simulate', category: 'MachineElement',
    produces: '__lastBearingResult', cost: 'cheap',
    metrics: ['life.L10_hours'],
    description: 'SKF 6210-class L10 + Hertz contact stress.' },
  { name: 'Gear Mesh',          tab: 'Simulate', category: 'MachineElement',
    produces: '__lastGearResult', cost: 'cheap',
    metrics: ['bending.sigma_bending_MPa', 'safetyFactors'],
    description: 'AGMA Lewis bending + pitting contact on a 17-tooth m=6 mm pinion @ 1.5 kW.' },
  { name: 'Shaft Sizing',       tab: 'Simulate', category: 'MachineElement',
    produces: '__lastShaftResult', cost: 'cheap',
    metrics: ['goodman.diameter_mm', 'asme.diameter_mm'],
    description: 'DE-Goodman + ASME elliptic shaft diameter for M=70 N·m reversed + T=45 N·m steady.' },
  { name: 'Bolted Joint',       tab: 'Simulate', category: 'MachineElement',
    produces: '__lastBoltResult', cost: 'cheap',
    metrics: ['safetyFactors'],
    description: 'M10×1.5 grade 8.8, 75% preload, 6 kN external — separation/yield/fatigue SFs.' },
  { name: 'Spring Design',      tab: 'Simulate', category: 'MachineElement',
    produces: '__lastSpringResult', cost: 'cheap',
    metrics: ['rate.k_N_per_mm', 'safetyFactors'],
    description: 'Music-wire compression spring d=2, D=20, N=14, F=20 N.' },
  { name: 'Pressure Vessel',    tab: 'Simulate', category: 'MachineElement',
    produces: '__lastVesselResult', cost: 'cheap',
    metrics: ['thin.sigma_hoop_Pa', 'asme.t_with_CA_m'],
    description: 'Thin/thick Lamé + ASME BPVC UG-27 minimum thickness.' },

  // ─── SIMULATE — Propulsion ──────────────────────────────────
  { name: 'Brayton Cycle',      tab: 'Simulate', category: 'Propulsion',
    produces: '__lastBraytonResult', cost: 'cheap',
    metrics: ['thrust_N', 'SFC_lb_per_lbf_hr', 'OPR'],
    description: 'Turbofan cycle — Trent XWB-class @ FL350 cruise.' },
  { name: 'Compressor Stage',   tab: 'Simulate', category: 'Propulsion',
    produces: '__lastCompressorResult', cost: 'cheap',
    metrics: ['work.stagePR', 'deHaller_check.passes'],
    description: 'Free-vortex velocity triangles + De Haller check.' },
  { name: 'Turbine Stage',      tab: 'Simulate', category: 'Propulsion',
    produces: '__lastTurbineResult', cost: 'cheap',
    metrics: ['work.stagePR_drop', 'work.total_power_kW'],
    description: 'HPT mean-line at engine cruise.' },
  { name: 'Combustor',          tab: 'Simulate', category: 'Propulsion',
    produces: '__lastCombustorResult', cost: 'cheap',
    metrics: ['emissions.EI_NOx_g_per_kgFuel', 'geometry.liner_length_m'],
    description: 'Annular combustor sizing + NOx via Lefebvre.' },
  { name: 'Nozzle',             tab: 'Simulate', category: 'Propulsion',
    produces: '__lastNozzleResult', cost: 'cheap',
    metrics: ['conv.choked', 'cd.A_exit_over_throat'],
    description: 'Convergent + CD nozzle analysis.' },
  { name: 'Blade Cooling',      tab: 'Simulate', category: 'Propulsion',
    produces: '__lastBladeCoolingResult', cost: 'cheap',
    metrics: ['T_metal_max_K', 'survives_long_life'],
    description: 'HPT blade thermal-resistance model (TBC + film + internal).' },
  { name: 'Heat Exchanger',     tab: 'Simulate', category: 'Propulsion',
    produces: '__lastHXResult', cost: 'cheap',
    metrics: ['effectiveness', 'q_W'],
    description: 'Effectiveness-NTU cross-flow recuperator.' },
  { name: 'Mission',            tab: 'Simulate', category: 'Propulsion',
    produces: '__lastMissionResult', cost: 'cheap',
    metrics: ['range.range_km', 'cruise.thrust_required_per_engine_N'],
    description: 'Breguet range + endurance for a 200-t transport @ FL350.' },

  // ─── MANUFACTURE tab ────────────────────────────────────────
  { name: 'Slice Preview',      tab: 'Manufacture', category: 'Additive',
    produces: '__lastSliceResult', cost: 'cheap',
    metrics: ['layerCount', 'totalPerimeterMm'],
    description: 'Slice the foundation body at 0.2 mm layers.' },
  { name: '2.5-Axis Milling',   tab: 'Manufacture', category: 'CNC',
    produces: '__lastPocketGCodeResult', cost: 'cheap',
    metrics: ['totalLines', 'cuttingMoves'],
    description: 'Spiral pocket-clear G-code for a 50×30×5 mm pocket.' },
  { name: '3-Axis Milling',     tab: 'Manufacture', category: 'CNC',
    produces: '__lastGCodeResult', cost: 'cheap',
    metrics: ['totalLines'],
    description: 'Contour mill a 60×40 mm rectangle 5 mm deep.' },
  { name: 'G-Code Post',        tab: 'Manufacture', category: 'CNC',
    produces: '__lastGCodePostResult', cost: 'cheap',
    metrics: ['totalLines', 'cuttingMoves'],
    description: 'Post-process the last G-code to a .nc file download.' },
  { name: 'Cost Estimation',    tab: 'Manufacture', category: 'Cost',
    produces: '__lastCostEstimate', cost: 'cheap',
    metrics: ['totalCost', 'sellPrice'],
    description: 'Cost roll-up from foundation manifold mass + surface area.' },
  { name: 'Export STL',         tab: 'Manufacture', category: 'Export',
    produces: '__lastSTLBytes', cost: 'cheap',
    metrics: ['__lastSTLTriCount'],
    description: 'Binary STL export of the foundation manifold.' },

  // ─── DRAWING tab ────────────────────────────────────────────
  { name: 'Export STEP',        tab: 'Drawing', category: 'Export',
    produces: '__lastSTEPText', cost: 'cheap',
    metrics: ['__lastSTEPSizeBytes'],
    description: 'ISO 10303-21 AP203 STEP file.' },
  { name: 'Export glTF',        tab: 'Drawing', category: 'Export',
    produces: '__lastGLBBytes', cost: 'cheap',
    metrics: ['__lastGLBBytes'],
    description: 'Binary glTF 2.0 (GLB) for web/AR/VR.' },
  { name: 'Standard 3 View',    tab: 'Drawing', category: 'Drawing',
    produces: '__last3ViewResult', cost: 'cheap',
    metrics: ['sizeBytes', 'numLines'],
    description: 'ASME Y14.5-style 3-view drawing on A3.' },
  { name: 'Section View',       tab: 'Drawing', category: 'Drawing',
    produces: '__lastSectionView', cost: 'cheap',
    metrics: ['polygonCount', 'perimeter'],
    description: 'Cross-section of foundation body at midplane.' },
];

/** Build a tool lookup map for fast O(1) plan dispatching. */
export const TOOL_BY_NAME = Object.fromEntries(
  TOOL_REGISTRY.map(t => [t.name, t])
);

/** Look up a tool by name. Returns null if unknown. */
export function findTool(name) {
  return TOOL_BY_NAME[name] || null;
}

/** Filter tools by tab. */
export function toolsForTab(tab) {
  return TOOL_REGISTRY.filter(t => t.tab === tab);
}

/** Filter tools by category. */
export function toolsByCategory(category) {
  return TOOL_REGISTRY.filter(t => t.category === category);
}

/**
 * JSON Schema that an AI can use to validate proposed plans.
 * Plans are arrays of `{tool, dependsOn?, comment?, params?}` items.
 * `params` is an object whose keys match the tool's param schema
 * (see ToolParamSchemas.js). Unknown keys are dropped at validation.
 */
export const PLAN_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['tool'],
    properties: {
      tool: {
        type: 'string',
        enum: TOOL_REGISTRY.map(t => t.name),
        description: 'Exact ribbon-tool name from the registry',
      },
      dependsOn: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Indexes of prior plan steps this step needs',
      },
      comment: {
        type: 'string',
        description: 'Human-readable reason for this step',
      },
      params: {
        type: 'object',
        additionalProperties: true,
        description: 'Overrides for the tool\'s parameters. Keys must match the tool\'s param schema; unknown keys are dropped.',
      },
    },
  },
};

/** Total tool count + tab/category breakdown for diagnostics. */
export function registrySummary() {
  const byTab = {};
  const byCategory = {};
  for (const t of TOOL_REGISTRY) {
    byTab[t.tab] = (byTab[t.tab] || 0) + 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  }
  return { total: TOOL_REGISTRY.length, byTab, byCategory };
}
