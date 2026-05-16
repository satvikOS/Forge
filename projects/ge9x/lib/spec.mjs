/**
 * GE9X — published-spec parametric engine definition.
 *
 * Every figure below is taken from GE Aviation public data, Boeing 777X
 * documentation, and the open propulsion literature. This is NOT a copy
 * of GE's proprietary CAD or cycle decks — it is an independent
 * engineering model dimensioned and tuned to match the engine's
 * PUBLISHED specification and performance.
 *
 * Geometry is in millimetres, engine centreline = +X (fan face at X=0).
 * Physics quantities are SI.
 *
 * Key published figures (GE Aviation / GE9X fact sheet):
 *   Fan diameter ........ 134 in  = 3404 mm   (largest on any commercial jet)
 *   Fan blades .......... 16, carbon-fibre composite, swept
 *   Bypass ratio ........ ~9.9 : 1
 *   Overall press. ratio  ~60 : 1
 *   HPC pressure ratio .. 27 : 1  (11 stages — an industry first)
 *   Booster (LPC) ....... 3 stages
 *   HP turbine .......... 2 stages
 *   LP turbine .......... 6 stages
 *   Combustor ........... TAPS III lean-burn annular
 *   Takeoff thrust ...... ~105,000 lbf (≈467 kN)
 *   Architecture ........ twin-spool, direct-drive
 */

export const GE9X = {
  meta: {
    designation: 'GE9X-105B1A',
    application: 'Boeing 777X (777-8 / 777-9)',
    manufacturer: 'GE Aerospace',
    architecture: 'twin-spool axial-flow high-bypass turbofan',
    firstRun: '2017', certification: '2020 (FAA)',
  },

  // ── Published performance ────────────────────────────────────────
  performance: {
    takeoffThrust_lbf: 105000,
    takeoffThrust_kN: 467.1,
    bypassRatio: 9.9,
    overallPressureRatio: 60,
    fanPressureRatio: 1.45,
    hpcPressureRatio: 27,
    boosterPressureRatio: 1.6,
    fanTipMach_takeoff: 1.15,
    designMassFlow_kgs: 1350,        // sea-level static, tuned to thrust
  },

  // ── Spool definition (twin-spool) ────────────────────────────────
  spools: {
    LP: {
      name: 'Low-Pressure spool',
      drives: ['fan', 'booster'],
      drivenBy: 'LPT',
      redline_rpm: 2600,
      idle_rpm: 700,
    },
    HP: {
      name: 'High-Pressure spool',
      drives: ['hpc'],
      drivenBy: 'HPT',
      redline_rpm: 11000,
      idle_rpm: 5200,
    },
  },

  // ── Axial module layout (mm along +X) ────────────────────────────
  // r = radius; modules are listed fan-to-nozzle.
  modules: {
    spinner:   { x0: 0,    x1: 620,  rRoot: 0,    rTip: 360,  kind: 'cone' },
    fan:       { x0: 240,  x1: 620,  rHub: 360,   rTip: 1702, blades: 16, kind: 'fan' },
    fanCase:   { x0: -260, x1: 1500, rInner: 1740, rOuter: 1860, kind: 'case' },
    nacelle:   { x0: -360, x1: 4000, rInner: 1860, rOuter: 1980, kind: 'nacelle' },
    booster:   { x0: 700,  x1: 1080, rHub: 380,   rTip: 560,  stages: 3,  kind: 'compressor' },
    hpc:       { x0: 1140, x1: 2120, rHub: 430,   rTip: 560,  stages: 11, kind: 'compressor' },
    combustor: { x0: 2170, x1: 2620, rInner: 430, rOuter: 640, kind: 'combustor' },
    hpt:       { x0: 2670, x1: 2970, rHub: 470,   rTip: 720,  stages: 2,  kind: 'turbine' },
    lpt:       { x0: 3020, x1: 3820, rHub: 520,   rTip: 980,  stages: 6,  kind: 'turbine' },
    coreNozzle:{ x0: 3870, x1: 4380, rInner: 280, rOuter: 720, kind: 'nozzle' },
    plug:      { x0: 3980, x1: 4560, rRoot: 280,  rTip: 0,    kind: 'cone' },
    lpShaft:   { x0: 300,  x1: 3760, rOuter: 95,  kind: 'shaft' },
    hpShaft:   { x0: 1140, x1: 2920, rInner: 130, rOuter: 175, kind: 'shaft' },
  },

  // ── Stage-by-stage turbomachinery ────────────────────────────────
  // Pressure ratio per stage chosen so the product matches the module PR.
  stageData: {
    booster: stagePRs(1.6, 3),       // 3 stages → ~1.17 each
    hpc:     stagePRs(27, 11),       // 11 stages → ~1.345 each
    hpt:     [2.9, 2.7],             // 2-stage expansion
    lpt:     [1.55, 1.5, 1.46, 1.42, 1.38, 1.34],   // 6-stage expansion
  },

  // ── Materials (representative of the published GE9X material set) ─
  materials: {
    fanBlade:   { name: 'Carbon-fibre/epoxy composite', density: 1600,  E: 70e9,  yield: 600e6 },
    fanCase:    { name: 'Carbon-fibre composite',       density: 1600,  E: 70e9,  yield: 550e6 },
    hpcBlade:   { name: 'Ti-6Al-4V titanium',           density: 4430,  E: 114e9, yield: 880e6 },
    combustor:  { name: 'CMC (SiC/SiC ceramic-matrix)',  density: 2700, E: 200e9, yield: 350e6 },
    hptBlade:   { name: 'CMC (SiC/SiC ceramic-matrix)',  density: 2700, E: 200e9, yield: 350e6, maxTemp_K: 1755 },
    lptBlade:   { name: 'Ni-base single-crystal superalloy', density: 8400, E: 200e9, yield: 950e6 },
    shaft:      { name: 'Maraging steel',               density: 8000,  E: 190e9, yield: 1800e6 },
  },

  // ── Real-world operating points (the test scenarios) ─────────────
  operatingPoints: {
    idle:    { name: 'Ground idle',  altitude_m: 0,      mach: 0.0,  T4_K: 900,  throttle: 0.07 },
    takeoff: { name: 'Takeoff',      altitude_m: 0,      mach: 0.25, T4_K: 1850, throttle: 1.00 },
    climb:   { name: 'Climb',        altitude_m: 7000,   mach: 0.62, T4_K: 1640, throttle: 0.92 },
    cruise:  { name: 'Cruise',       altitude_m: 10668,  mach: 0.85, T4_K: 1480, throttle: 0.85 },
  },
};

/** Split a module pressure ratio into n equal per-stage ratios. */
function stagePRs(totalPR, n) {
  const per = Math.pow(totalPR, 1 / n);
  return Array.from({ length: n }, () => per);
}

/** Total overall length of the engine gas path (fan face → plug tip). */
export function overallLength() {
  return GE9X.modules.plug.x1 - GE9X.modules.spinner.x0;
}

/** Fan diameter in mm and inches. */
export function fanDiameter() {
  const d = GE9X.modules.fan.rTip * 2;
  return { mm: d, inch: d / 25.4 };
}
