/**
 * ArchDisc Foundation — real-world survival scenarios.
 *
 * Three GENERAL survival tests, each built on existing validated
 * foundation solvers — no per-project code:
 *
 *   fireSurvival     transient conduction (ThermalFEM) of a wall section
 *                    exposed to a flame film → time-to-service-limit,
 *                    residual strength.
 *   quenchSurvival   transient conduction of a hot part plunged into a
 *                    cold-water film → peak through-thickness ΔT →
 *                    thermal-shock stress vs UTS.
 *   birdStrike       explicit mass-spring dynamics (ExplicitDynamics) of
 *                    a blade panel struck by a bird → energy absorbed,
 *                    spring-level damage, containment verdict.
 *
 * FLAGGED SCOPE — these are engineering-grade reduced-order models:
 *   • fire / quench use a representative through-thickness WALL SLAB,
 *     constant (temperature-averaged) thermal properties, and a
 *     convective film. They model the real conduction transient; they
 *     do NOT model flame chemistry, radiation re-emission, water boiling
 *     / two-phase heat transfer, or charring.
 *   • birdStrike is a lumped mass-spring panel (see ExplicitDynamics) —
 *     real transient deformation + damage, not continuum explicit FE.
 * The numbers are decision-grade, not certification-grade.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

import { solveThermalTransient } from './ThermalFEM.js';
import { gridPanel, simulateImpact } from './ExplicitDynamics.js';
import { MaterialDB, findMaterial } from './MaterialDB.js';

const resolveMaterial = (m) => {
  if (m && typeof m.E === 'function') return m;
  return findMaterial(m) || MaterialDB[m] || MaterialDB.INCONEL_718;
};

/**
 * Structured tetrahedral mesh of a slab Lx×Ly×Lz (metres), nx×ny×nz
 * cells, each cube split into 6 tets (Kuhn diagonal triangulation).
 * Returns the two large faces (Z=0, Z=Lz) as boundary triangle lists.
 */
export function slabTetMesh(Lx, Ly, Lz, nx, ny, nz) {
  const vertices = [];
  const id = (i, j, kk) => kk * (nx + 1) * (ny + 1) + j * (nx + 1) + i;
  for (let kk = 0; kk <= nz; kk++)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++)
        vertices.push([(i / nx) * Lx, (j / ny) * Ly, (kk / nz) * Lz]);
  const tets = [];
  const KUHN = [
    [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
    [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
  ];
  for (let kk = 0; kk < nz; kk++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = [
          id(i, j, kk), id(i + 1, j, kk), id(i, j + 1, kk), id(i + 1, j + 1, kk),
          id(i, j, kk + 1), id(i + 1, j, kk + 1), id(i, j + 1, kk + 1), id(i + 1, j + 1, kk + 1),
        ];
        for (const t of KUHN) tets.push([c[t[0]], c[t[1]], c[t[2]], c[t[3]]]);
      }
  const faceAt = (kk) => {
    const f = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = id(i, j, kk), b = id(i + 1, j, kk);
        const cc = id(i + 1, j + 1, kk), d = id(i, j + 1, kk);
        f.push([a, b, cc]); f.push([a, cc, d]);
      }
    return f;
  };
  return { vertices, tets, faceZ0: faceAt(0), faceZLz: faceAt(nz) };
}

/**
 * FIRE — a wall section exposed to a flame on one face.
 *
 * @param {object} o
 *   material        material key / Material  (the exposed part)
 *   wallThickness   m            (default 5 mm)
 *   flameTempC      °C           (default 1100 — kerosene pool/jet fire)
 *   hFlame          W/(m²·K)     flame-side film (default 120)
 *   backTempC       °C           cool-side ambient (default 40)
 *   hBack           W/(m²·K)     cool-side film (default 25)
 *   ambientC        °C           initial wall temperature (default 20)
 *   durationS       s            fire exposure required (default 300 — 5 min)
 * @returns verdict object
 */
export function fireSurvival(o = {}) {
  const mat = resolveMaterial(o.material);
  const wall = o.wallThickness ?? 0.005;
  const flameTempC = o.flameTempC ?? 1100;
  const hFlame = o.hFlame ?? 120;
  const backTempC = o.backTempC ?? 40;
  const hBack = o.hBack ?? 25;
  const ambientC = o.ambientC ?? 20;
  const durationS = o.durationS ?? 300;

  const repT = (ambientC + flameTempC) / 2;
  const mesh = slabTetMesh(0.05, 0.05, wall, 2, 2, 12);
  const steps = 120;
  const dt = durationS / steps;
  const conv = [
    ...mesh.faceZ0.map((tri) => ({ tri, h: hFlame, Tinf: flameTempC })),
    ...mesh.faceZLz.map((tri) => ({ tri, h: hBack, Tinf: backTempC })),
  ];
  const res = solveThermalTransient({
    mesh, k: mat.k(repT), rho: mat.density, cp: mat.cp(repT),
    T0: ambientC, convectionBCs: conv, dt, steps, recordEvery: 1,
  });

  const serviceLimit = mat.maxServiceTempC;
  let timeToLimitS = null;
  for (const h of res.history) {
    if (h.maxT >= serviceLimit) { timeToLimitS = h.t; break; }
  }
  const peakWallTempC = res.history[res.history.length - 1].maxT;
  const survivesDuration = timeToLimitS === null;
  const strengthRetainedPct = 100 * mat.yield(Math.min(peakWallTempC, 1100)) / mat.yield(20);

  return {
    scenario: 'fire',
    flagged: 'reduced-order: transient conduction + convective flame film; no flame chemistry / radiation / charring',
    material: mat.name, wallThickness_mm: wall * 1000,
    flameTempC, durationS,
    peakWallTempC: +peakWallTempC.toFixed(1),
    serviceLimitC: serviceLimit,
    timeToServiceLimitS: timeToLimitS === null ? null : +timeToLimitS.toFixed(1),
    strengthRetainedPct: +strengthRetainedPct.toFixed(1),
    survivesRequiredDuration: survivesDuration,
    verdict: survivesDuration
      ? `survives ${durationS}s fire — wall stays below ${serviceLimit}°C service limit`
      : `service limit reached at ${timeToLimitS.toFixed(0)}s of the ${durationS}s exposure`,
  };
}

/**
 * WATER — a hot part quenched in cold water (thermal shock).
 *
 * @param {object} o
 *   material        material key / Material
 *   wallThickness   m            (default 3 mm — turbine blade wall)
 *   initialTempC    °C           operating temperature (default 900)
 *   waterTempC      °C           (default 18)
 *   hWater          W/(m²·K)     quench film, nucleate-boiling (default 4000)
 *   durationS       s            (default 12)
 * @returns verdict object
 */
export function quenchSurvival(o = {}) {
  const mat = resolveMaterial(o.material);
  const wall = o.wallThickness ?? 0.003;
  const initialTempC = o.initialTempC ?? 900;
  const waterTempC = o.waterTempC ?? 18;
  const hWater = o.hWater ?? 4000;
  const durationS = o.durationS ?? 12;

  const repT = (initialTempC + waterTempC) / 2;
  const mesh = slabTetMesh(0.04, 0.04, wall, 2, 2, 14);
  const steps = 160;
  const dt = durationS / steps;
  const conv = [
    ...mesh.faceZ0.map((tri) => ({ tri, h: hWater, Tinf: waterTempC })),
    ...mesh.faceZLz.map((tri) => ({ tri, h: hWater, Tinf: waterTempC })),
  ];
  const res = solveThermalTransient({
    mesh, k: mat.k(repT), rho: mat.density, cp: mat.cp(repT),
    T0: initialTempC, convectionBCs: conv, dt, steps, recordEvery: 1,
  });

  // Peak surface-to-core temperature difference over the transient.
  let peakDeltaT = 0;
  for (const h of res.history) peakDeltaT = Math.max(peakDeltaT, h.maxT - h.minT);

  // Constrained thermal-shock stress  σ = E·α·ΔT / (1−ν).
  const E = mat.E(repT);                       // MPa
  const alpha = mat.CTE(repT);                 // 1/K
  const nu = mat.nu(repT);
  const shockStressMPa = (E * alpha * peakDeltaT) / (1 - nu);
  const utsMPa = mat.UTS(repT);
  const survives = shockStressMPa < utsMPa;

  return {
    scenario: 'water-immersion (quench)',
    flagged: 'reduced-order: transient conduction + convective water film; no boiling / two-phase heat transfer',
    material: mat.name, wallThickness_mm: wall * 1000,
    initialTempC, waterTempC,
    peakThroughThicknessDeltaTC: +peakDeltaT.toFixed(1),
    thermalShockStressMPa: +shockStressMPa.toFixed(1),
    utsMPa: +utsMPa.toFixed(1),
    safetyMargin: +(utsMPa / shockStressMPa).toFixed(2),
    survives,
    verdict: survives
      ? `survives quench — shock stress ${shockStressMPa.toFixed(0)} MPa stays under ${utsMPa.toFixed(0)} MPa UTS`
      : `thermal-shock failure — ${shockStressMPa.toFixed(0)} MPa exceeds ${utsMPa.toFixed(0)} MPa UTS`,
  };
}

/**
 * BIRD STRIKE — a bird impacts a blade panel (FAR 33.76-style event).
 *
 * @param {object} o
 *   material        material key / Material  (blade)
 *   birdMassKg      kg           (default 1.8 — medium bird)
 *   impactSpeed     m/s          relative closure speed (default 130)
 *   panelMassKg     kg           representative blade-section mass (default 7)
 *   spanM           m            panel size (default 0.4)
 * @returns verdict object
 */
export function birdStrikeSurvival(o = {}) {
  const mat = resolveMaterial(o.material);
  const birdMassKg = o.birdMassKg ?? 1.8;
  const impactSpeed = o.impactSpeed ?? 130;
  const panelMassKg = o.panelMassKg ?? 7;
  const spanM = o.spanM ?? 0.4;

  const nx = 9, ny = 9;
  const spacing = spanM / (nx - 1);
  const nodeMass = panelMassKg / (nx * ny);
  // Representative axial spring stiffness from the blade material:
  //   k ≈ E·A / L0  with a thin blade-section area A ≈ (spacing·t).
  const t = 0.012;                              // 12 mm representative section
  const stiffness = (mat.E(20) * 1e6) * (spacing * t) / spacing;   // N/m
  // Lumped structural failure strain — the spring "break" represents
  // local STRUCTURAL failure, so it must account for plastic/bending
  // ductility, not just the elastic limit UTS/E. A blade designed to
  // contain a medium-bird strike deforms well past first yield.
  const breakStrain = 0.08;

  const panel = gridPanel({ nx, ny, spacing, nodeMass, stiffness, breakStrain });
  const centre = ((nx - 1) * spacing) / 2;
  const birdRadius = Math.cbrt((3 * birdMassKg) / (4 * Math.PI * 950)); // ρ_bird≈950
  const model = {
    nodes: panel.nodes, springs: panel.springs,
    impactor: {
      pos: [centre, centre, birdRadius + 0.02],
      vel: [0, 0, -impactSpeed],
      mass: birdMassKg, radius: birdRadius,
    },
    contactStiffness: 2e6, damping: 40,
  };
  const sim = simulateImpact(model, { dt: 5e-6, steps: 9000 });
  const s = sim.summary;
  const brokenFrac = s.brokenSprings / s.totalSprings;
  const incidentKE = 0.5 * birdMassKg * impactSpeed ** 2;
  // Containment: localised damage tolerable, widespread failure is not.
  const survives = brokenFrac < 0.25;

  return {
    scenario: 'bird strike',
    flagged: 'reduced-order: lumped mass-spring explicit dynamics; not continuum explicit FE',
    material: mat.name,
    birdMassKg, impactSpeed_mps: impactSpeed,
    incidentKE_J: +incidentKE.toFixed(0),
    energyAbsorbed_J: +s.energyAbsorbed_J.toFixed(0),
    peakContactForce_kN: +(s.peakContactForce_N / 1000).toFixed(1),
    peakDeflection_mm: +s.peakDeflection_mm.toFixed(1),
    damagedSpringPct: +(brokenFrac * 100).toFixed(1),
    energyDriftPct: +s.energyDriftPct.toFixed(2),
    survives,
    verdict: survives
      ? `contained — ${(brokenFrac * 100).toFixed(0)}% local damage, blade absorbs ${s.energyAbsorbed_J.toFixed(0)} J`
      : `blade failure — ${(brokenFrac * 100).toFixed(0)}% of structure broken`,
  };
}

/**
 * Run all three survival scenarios for a part and roll up a verdict.
 */
export function runSurvivalSuite(scenarios = {}) {
  const fire = fireSurvival(scenarios.fire || {});
  const water = quenchSurvival(scenarios.water || {});
  const bird = birdStrikeSurvival(scenarios.bird || {});
  const all = [fire, water, bird];
  const passed = all.filter((r) => r.survives ?? r.survivesRequiredDuration).length;
  return {
    fire, water, bird,
    passed, total: all.length,
    overall: passed === all.length ? 'ALL SCENARIOS SURVIVED'
      : `${passed}/${all.length} scenarios survived`,
  };
}
