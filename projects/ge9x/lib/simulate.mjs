/**
 * GE9X build — simulation suite.
 *
 * Runs the engine through real-world test scenarios using the ArchDisc
 * propulsion / structural / thermal foundation modules:
 *
 *   Stage 3  thermodynamic cycle   — idle/takeoff/climb/cruise
 *   Stage 4  structural            — fan blade, modal/Campbell, rotordynamics
 *   Stage 5  certification events  — fan-blade-out, bird strike
 *   Stage 6  thermal & CFD         — HPT cooling, exhaust nozzle, viscous CFD
 *
 * Each result records what is rigorously solved versus what is an
 * engineering-grade approximation — stated honestly per result.
 */

import { solveTurbofan } from '../../../frontend/src/foundation/BraytonCycle.js';
import { solveRotordynamics } from '../../../frontend/src/foundation/Rotordynamics.js';
import { analyzeBladeCooling } from '../../../frontend/src/foundation/BladeCooling.js';
import { analyzeCDNozzle } from '../../../frontend/src/foundation/Nozzle.js';
import { solveLidDrivenCavity, sampleCenterlineU }
  from '../../../frontend/src/foundation/NavierStokes2D.js';
import { GE9X } from './spec.mjs';

const SL_RHO = 1.225;

/** ICAO standard-atmosphere density ratio at an altitude (m). */
function densityRatio(altM) {
  const T0 = 288.15, P0 = 101325, L = -0.0065, g = 9.80665, R = 287.058;
  let T, P;
  if (altM < 11000) {
    T = T0 + L * altM;
    P = P0 * Math.pow(T / T0, -g / (L * R));
  } else {
    T = 216.65;
    const P11 = P0 * Math.pow(216.65 / 288.15, -g / (L * R));
    P = P11 * Math.exp(-g * (altM - 11000) / (R * 216.65));
  }
  return (P / (R * T)) / SL_RHO;
}

// ── Stage 3: thermodynamic cycle ───────────────────────────────────

export function runCycle() {
  const p = GE9X.performance;
  const baseCompressorPR = p.boosterPressureRatio * p.hpcPressureRatio;
  // Fan pressure ratio rises along the working line with throttle.
  const fanPRof = (thr) => 1.12 + 0.40 * thr;
  const massFlowAt = (op, designFlow) => designFlow
    * Math.pow(densityRatio(op.altitude_m), 0.7) * (0.32 + 0.68 * op.throttle);
  const solvePoint = (op, designFlow) => solveTurbofan({
    altitudeM: op.altitude_m, machNumber: op.mach,
    bypassRatio: p.bypassRatio,
    fanPR: fanPRof(op.throttle),
    compressorPR: baseCompressorPR * (0.70 + 0.30 * op.throttle),
    T4_K: op.T4_K, massFlowKgS: massFlowAt(op, designFlow),
  });

  // Calibrate the design airflow so the 0-D cycle reproduces the
  // published 467 kN takeoff rating (standard cycle-deck practice).
  let designFlow = p.designMassFlow_kgs;
  for (let it = 0; it < 12; it++) {
    const r = solvePoint(GE9X.operatingPoints.takeoff, designFlow);
    const ratio = p.takeoffThrust_kN / (r.thrust_N / 1000);
    designFlow *= ratio;
    if (Math.abs(ratio - 1) < 1e-5) break;
  }

  const points = {};
  for (const [key, op] of Object.entries(GE9X.operatingPoints)) {
    const massFlow = massFlowAt(op, designFlow);
    const r = solvePoint(op, designFlow);
    points[key] = {
      name: op.name, altitude_m: op.altitude_m, mach: op.mach, throttle: op.throttle,
      massFlow_kgs: massFlow,
      thrust_kN: r.thrust_N / 1000,
      thrust_lbf: r.thrust_lbf,
      OPR: r.OPR,
      EGT_K: r.stations.s5.T_total,
      SFC_lb_per_lbf_hr: r.SFC_lb_per_lbf_hr,
      fuelAirRatio: r.fuelAirRatio,
      thermalEff: r.thermalEff, propEff: r.propEff, overallEff: r.overallEff,
      stations: r.stations,
    };
  }
  const validation = {
    takeoffThrust: {
      computed_kN: points.takeoff.thrust_kN,
      published_kN: GE9X.performance.takeoffThrust_kN,
      errorPct: 100 * (points.takeoff.thrust_kN - GE9X.performance.takeoffThrust_kN)
        / GE9X.performance.takeoffThrust_kN,
    },
    takeoffOPR: {
      computed: points.takeoff.OPR,
      published: GE9X.performance.overallPressureRatio,
    },
  };
  return {
    method: 'Brayton cycle (foundation.solveTurbofan, validated vs Hill & Peterson) — rigorous physics; '
      + 'design airflow calibrated to the published takeoff rating',
    calibratedDesignFlow_kgs: designFlow,
    note: 'A 0-D station cycle with one lumped fan pressure ratio cannot match takeoff thrust, '
      + 'OPR and airflow simultaneously to exact figures — OPR and cruise SFC carry a few-percent residual.',
    points, validation,
  };
}

// ── Stage 4: structural ────────────────────────────────────────────

export function runStructural() {
  const fan = GE9X.modules.fan;
  const mat = GE9X.materials.fanBlade;
  const omega = GE9X.spools.LP.redline_rpm * 2 * Math.PI / 60;
  const span_m = (fan.rTip - fan.rHub) / 1000;

  // Fan blade mass from aerofoil volume (chord taper + 9 % t/c, 0.65 fill).
  const meanChord_m = 0.420, meanThick_m = 0.09 * meanChord_m, fill = 0.65;
  const vol = span_m * meanChord_m * meanThick_m * fill;
  const bladeMass = vol * mat.density;
  const rCG_m = (fan.rHub + fan.rTip) / 2 / 1000;

  // Centrifugal root load and stress.
  const Fcf = bladeMass * omega * omega * rCG_m;
  const Aroot = 0.320 * (0.09 * 0.320) * fill;            // m²
  const sigmaCF = Fcf / Aroot;

  // Aerodynamic bending: a moderate steady gas load per blade.
  const fanThrustShare = (GE9X.performance.takeoffThrust_kN * 1000 * 0.55) / fan.blades;
  const Mbend = fanThrustShare * span_m * 0.40;
  const I_root = (0.320 * Math.pow(0.09 * 0.320, 3)) / 12;
  const sigmaBend = Mbend * (0.09 * 0.320 / 2) / I_root;

  // First bending natural frequency — rotating-cantilever beam.
  const A = 0.320 * (0.09 * 0.320) * fill;
  const f1_static = (1.875 ** 2 / (2 * Math.PI))
    * Math.sqrt((mat.E * I_root) / (mat.density * A * Math.pow(span_m, 4)));
  // Centrifugal stiffening (Southwell): f² = f0² + κ·(rpm/60)²; κ≈2 for blades.
  const f1_rot = Math.sqrt(f1_static ** 2 + 2.0 * Math.pow(omega / (2 * Math.PI), 2));

  // Campbell crossings: engine orders 1..8 vs the blade mode in 0..redline.
  const crossings = [];
  for (let EO = 1; EO <= 8; EO++) {
    const rpmCross = f1_rot * 60 / EO;
    if (rpmCross <= GE9X.spools.LP.redline_rpm * 1.05) {
      crossings.push({ engineOrder: EO, rpm: rpmCross, inRange: rpmCross <= GE9X.spools.LP.redline_rpm });
    }
  }

  // Rotordynamics — LP and HP spools via foundation.solveRotordynamics.
  const lpShaft = {
    length: (GE9X.modules.lpShaft.x1 - GE9X.modules.lpShaft.x0) / 1000,
    diameter: 0.19, E: GE9X.materials.shaft.E, density: GE9X.materials.shaft.density,
    elements: 20,
  };
  const lpLen = lpShaft.length;
  const lpDisks = [
    { position: 0.12 * lpLen, mass: bladeMass * fan.blades + 900, transverseInertia: 40 },  // fan
    { position: 0.30 * lpLen, mass: 180, transverseInertia: 4 },                            // booster
    { position: 0.90 * lpLen, mass: 620, transverseInertia: 18 },                           // LPT
  ];
  const lpBearings = [
    { position: 0.10 * lpLen, kxx: 5e7, kyy: 5e7 },
    { position: 0.92 * lpLen, kxx: 5e7, kyy: 5e7 },
  ];
  const lpRotor = solveRotordynamics({
    shaft: lpShaft, disks: lpDisks, bearings: lpBearings, numModes: 4,
  });
  const hpShaft = {
    length: (GE9X.modules.hpShaft.x1 - GE9X.modules.hpShaft.x0) / 1000,
    diameter: 0.30, E: GE9X.materials.shaft.E, density: GE9X.materials.shaft.density,
    elements: 16,
  };
  const hpLen = hpShaft.length;
  const hpRotor = solveRotordynamics({
    shaft: hpShaft,
    disks: [
      { position: 0.25 * hpLen, mass: 520, transverseInertia: 14 },   // HPC
      { position: 0.80 * hpLen, mass: 410, transverseInertia: 11 },   // HPT
    ],
    bearings: [
      { position: 0.08 * hpLen, kxx: 8e7, kyy: 8e7 },
      { position: 0.92 * hpLen, kxx: 8e7, kyy: 8e7 },
    ],
    numModes: 4,
  });

  return {
    method: 'analytical rotating-beam + foundation.solveRotordynamics — engineering-grade',
    fanBlade: {
      mass_kg: bladeMass, span_m, rCG_m,
      tipSpeed_ms: omega * fan.rTip / 1000,
      centrifugalForce_kN: Fcf / 1000,
      centrifugalStress_MPa: sigmaCF / 1e6,
      bendingStress_MPa: sigmaBend / 1e6,
      combinedStress_MPa: (sigmaCF + sigmaBend) / 1e6,
      material: mat.name, yield_MPa: mat.yield / 1e6,
      safetyFactor_centrifugal: mat.yield / sigmaCF,
      safetyFactor_combined: mat.yield / (sigmaCF + sigmaBend),
      firstBendingHz_static: f1_static,
      firstBendingHz_running: f1_rot,
    },
    campbell: { bladeModeHz: f1_rot, crossings },
    rotordynamics: {
      LP: {
        criticalSpeed_rpm: lpRotor.criticalSpeedRPM,
        frequenciesHz: lpRotor.frequenciesHz,
        redline_rpm: GE9X.spools.LP.redline_rpm,
        runsSupercritical: lpRotor.criticalSpeedRPM < GE9X.spools.LP.redline_rpm,
      },
      HP: {
        criticalSpeed_rpm: hpRotor.criticalSpeedRPM,
        frequenciesHz: hpRotor.frequenciesHz,
        redline_rpm: GE9X.spools.HP.redline_rpm,
        runsSupercritical: hpRotor.criticalSpeedRPM < GE9X.spools.HP.redline_rpm,
      },
    },
  };
}

// ── Stage 5: certification events ──────────────────────────────────

export function runCertification(structural) {
  const fan = GE9X.modules.fan;
  const omega = GE9X.spools.LP.redline_rpm * 2 * Math.PI / 60;
  const bladeMass = structural.fanBlade.mass_kg;
  const rCG_m = structural.fanBlade.rCG_m;

  // Fan-blade-out: a released blade's translational + rotational KE,
  // plus the rotor imbalance it leaves behind.
  const vCG = omega * rCG_m;
  const ke_translational = 0.5 * bladeMass * vCG * vCG;
  const I_blade = bladeMass * rCG_m * rCG_m;
  const ke_rotational = 0.5 * I_blade * omega * omega;
  const fbo = {
    releasedBladeMass_kg: bladeMass,
    releaseVelocity_ms: vCG,
    containmentEnergy_kJ: (ke_translational + ke_rotational) / 1000,
    residualImbalance_kgm: bladeMass * rCG_m,
    imbalanceForce_kN: bladeMass * rCG_m * omega * omega / 1000,
    note: 'Engineering approximation — energy/imbalance method, not an explicit transient containment FE solve.',
  };

  // Bird strike: large-bird cert ingestion (1.8 kg) at takeoff closing speed.
  const birdMass = 1.8;
  const Vaircraft = 0.25 * 340;                 // M0.25 at sea level
  const Vfan_tip = omega * fan.rTip / 1000;
  const closingSpeed = Vaircraft + Vfan_tip * 0.35;   // blade sees a fraction of tip speed
  const birdKE = 0.5 * birdMass * closingSpeed * closingSpeed;
  const birdStrike = {
    birdMass_kg: birdMass,
    closingSpeed_ms: closingSpeed,
    impactEnergy_kJ: birdKE / 1000,
    impactMomentum_kgms: birdMass * closingSpeed,
    note: 'Engineering approximation — impulse/energy method; composite blade soft-body impact not explicitly FE-solved.',
  };
  return { method: 'energy / impulse methods — engineering-grade approximation (flagged)', fbo, birdStrike };
}

// ── Stage 6: thermal & CFD ─────────────────────────────────────────

export function runThermalCFD(cycle) {
  const takeoff = cycle.points.takeoff;
  const T4 = GE9X.operatingPoints.takeoff.T4_K;
  const Tcoolant = takeoff.stations.s3.T_total;       // HPC bleed air

  // HPT blade cooling — foundation.analyzeBladeCooling.
  const cooling = analyzeBladeCooling({
    T_gas_K: T4,
    T_coolant_K: Tcoolant,
    t_metal_m: 0.0018, k_metal: 18,            // CMC ~18 W/m·K
    t_TBC_m: 0.00025, k_TBC: 1.0,
    stations: {
      leadingEdge: { h_ext: 3500, h_int: 2200, etaFilm: 0.35 },
      suctionSide: { h_ext: 2100, h_int: 1800, etaFilm: 0.48 },
      pressureSide: { h_ext: 2600, h_int: 1900, etaFilm: 0.42 },
      trailingEdge: { h_ext: 1800, h_int: 1500, etaFilm: 0.30 },
    },
  });
  const hptLimit = GE9X.materials.hptBlade.maxTemp_K;

  // Exhaust core nozzle — foundation.analyzeCDNozzle (rigorous 1-D).
  const s5 = takeoff.stations.s5;
  const nozzle = analyzeCDNozzle({
    P_t: s5.P_total, T_t: s5.T_total,
    M_exit_design: 1.0,
    A_throat: Math.PI * (0.50 ** 2 - 0.28 ** 2),
    P_back: 101325, gamma: 1.33,
  });

  // Viscous CFD — the platform's validated 2-D Navier-Stokes solver,
  // run on the lid-driven-cavity benchmark (Ghia et al. 1982). Honest
  // scope: true 3-D fan/exhaust CFD is out of scope for this build.
  const cavity = solveLidDrivenCavity({ Re: 100, nx: 49, ny: 49 });
  const centerline = sampleCenterlineU(cavity);
  let maxGhiaErr = 0;
  for (const c of centerline) {
    maxGhiaErr = Math.max(maxGhiaErr, Math.abs(c.u_FEM - c.u_Ghia));
  }

  return {
    method: 'foundation.analyzeBladeCooling + analyzeCDNozzle (rigorous) + Navier-Stokes CFD (validated benchmark)',
    hptCooling: {
      gasTemp_K: T4, coolantTemp_K: Tcoolant,
      stations: cooling.stations,
      materialLimit_K: hptLimit,
      hotspot: cooling.hotspot,
      hotspot_K: cooling.T_metal_max_K,
      withinLimit: cooling.T_metal_max_K <= hptLimit,
    },
    exhaustNozzle: nozzle,
    cfdBenchmark: {
      case: 'lid-driven cavity, Re=100', grid: '49×49',
      maxDeviationFromGhia: maxGhiaErr,
      note: 'Validated 2-D viscous solver vs Ghia et al. 1982; 3-D fan/exhaust CFD not in scope.',
    },
  };
}

/** Run the whole simulation suite. */
export function runAllSimulations() {
  const cycle = runCycle();
  const structural = runStructural();
  const certification = runCertification(structural);
  const thermalCFD = runThermalCFD(cycle);
  return { cycle, structural, certification, thermalCFD };
}
