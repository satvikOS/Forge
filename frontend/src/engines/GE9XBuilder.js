/**
 * General Electric GE9X Turbofan Builder
 *
 * Constructs a high-fidelity GE9X engine using ArchDisc kernel APIs and the
 * platform foundation features (PartIDRegistry, real-world tests, exporter).
 *
 * Reference specs (GE9X-105B1A, public GE Aerospace data):
 *   Length:           5.69 m (224 in)
 *   Fan diameter:     3.40 m (134 in) — largest commercial turbofan
 *   Fan blades:       16 (4th-gen woven carbon-fiber composite, Ti leading edge)
 *   Bypass ratio:     9.9:1
 *   Pressure ratio:   60:1 (overall)
 *   Mass flow:        ~1361 kg/s
 *   Thrust:           470 kN takeoff (105,000 lbf)
 *   Mass:             10,012 kg dry
 *   Architecture:     2-spool (LP shaft + HP shaft)
 *   LPC (booster):    3 stages
 *   HPC:              11 stages, 27:1 pressure ratio
 *   Combustor:        TAPS III (Twin Annular Premixing Swirler), CMC liner
 *   HPT:              2 stages, CMC stage-1 nozzles + CMC stage-1 blades
 *   LPT:              6 stages
 *   Engines:          Boeing 777X exclusive
 *
 * Every component auto-registers via PartIDRegistry.
 * Output: engine-output/GE9X/
 */

import {
  Assembly, PrimitiveBuilder, LoftSweep,
  Vec3, FastenerLibrary, BearingLibrary,
  TurbomachineryBlade,
  PartIDRegistry,
} from '../kernel/index.js';

// Cache built blade geometries — same airfoil definition reused across instances
const _bladeCache = new Map();

function _getOrBuildBlade(key, builderFn) {
  if (_bladeCache.has(key)) return _bladeCache.get(key);
  let solid;
  try {
    const profileSpec = builderFn();
    if (!profileSpec.profiles || profileSpec.profiles.length < 2) {
      solid = PrimitiveBuilder.box(0.04, 0.4, 0.02);
    } else {
      solid = LoftSweep.loft(profileSpec.profiles, 1);
    }
  } catch (e) {
    solid = PrimitiveBuilder.box(0.04, 0.4, 0.02);
  }
  _bladeCache.set(key, solid);
  return solid;
}

const PI = Math.PI;

/** Distribute N items around the engine outside surface — perimeter mounting. */
function _perimeterPos(i, N, zMin, zMax, radius) {
  const t01 = N > 1 ? i / (N - 1) : 0;
  const z = zMin + t01 * (zMax - zMin);
  const angle = (i / Math.max(N, 1)) * 2 * PI * 1.7;  // slight spiral
  return new Vec3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}

/** Random-ish but deterministic position along engine bottom (for accessories). */
function _bottomPos(i, N, zMin, zMax, yOffset = -0.85, xRange = 0.50) {
  const t01 = N > 1 ? i / (N - 1) : 0;
  const z = zMin + t01 * (zMax - zMin);
  const x = (((i * 7919) % 100) / 100 - 0.5) * xRange;
  return new Vec3(x, yOffset, z);
}

const GE9X_SPECS = {
  length: 5.69,
  fanDia: 3.40,
  fanRadius: 1.70,
  fanHubRadius: 0.420,
  bypassRatio: 9.9,
  pressureRatio: 60,
  fanBlades: 16,
  lpcStages: 3,
  hpcStages: 11,
  hptStages: 2,
  lptStages: 6,
  fuelNozzles: 30,         // TAPS III: 30 swirler-injectors
  igniters: 2,
  mainBearings: 5,
  hpcRotorBlades: { 1: 56, 2: 60, 3: 64, 4: 70, 5: 76, 6: 80, 7: 84, 8: 88, 9: 92, 10: 96, 11: 100 },
  hpcStatorVanes: { 0: 40, 1: 50, 2: 56, 3: 64, 4: 70, 5: 76, 6: 80, 7: 84, 8: 88, 9: 92, 10: 96 },
  hptBlades: { 1: 80, 2: 70 },        // stage 1 / 2
  hptNGV: { 1: 36, 2: 50 },
  lptBlades: { 1: 110, 2: 120, 3: 130, 4: 138, 5: 144, 6: 150 },
  lptStator: { 1: 90, 2: 100, 3: 110, 4: 120, 5: 130, 6: 140 },
  totalMassKg: 10012,
};

export { GE9X_SPECS };

export default class GE9XBuilder {

  /**
   * Build the complete GE9X engine.
   * @param {object} options
   * @param {function} [options.onProgress] - (sectionName, addedCount, totalCount) => void
   * @returns {Assembly}
   */
  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});

    PartIDRegistry.setProject('GE9X');

    const ge9x = new Assembly('GE Aviation GE9X-105B1A');
    ge9x.userData = { specs: GE9X_SPECS };

    const sections = [
      ['Inlet & Spinner',          GE9XBuilder.buildInletSection],
      ['Fan Module',               GE9XBuilder.buildFanModule],
      ['LP Compressor (Booster)',  GE9XBuilder.buildLPCompressor],
      ['HP Compressor',            GE9XBuilder.buildHPCompressor],
      ['Combustor (TAPS III)',     GE9XBuilder.buildCombustor],
      ['HP Turbine (CMC)',         GE9XBuilder.buildHPTurbine],
      ['LP Turbine',               GE9XBuilder.buildLPTurbine],
      ['Bearings & Seals',         GE9XBuilder.buildBearings],
      ['Shafts & Couplings',       GE9XBuilder.buildShafts],
      ['Accessory Gearbox',        GE9XBuilder.buildAccessoryGearbox],
      ['Fuel System',              GE9XBuilder.buildFuelSystem],
      ['Oil System',               GE9XBuilder.buildOilSystem],
      ['Air Bleed System',         GE9XBuilder.buildAirSystem],
      ['Ignition',                 GE9XBuilder.buildIgnition],
      ['FADEC & Sensors',          GE9XBuilder.buildFADECSensors],
      ['Wire Harnesses',           GE9XBuilder.buildWireHarnesses],
      ['Hydraulic Lines',          GE9XBuilder.buildHydraulicLines],
      ['Casings & Cowlings',       GE9XBuilder.buildCasings],
      ['Pylon & Mounts',           GE9XBuilder.buildPylonMounts],
      ['Thrust Reverser',          GE9XBuilder.buildThrustReverser],
      ['Exhaust Section',          GE9XBuilder.buildExhaust],
      ['Fasteners',                GE9XBuilder.buildFasteners],
      ['Brackets',                 GE9XBuilder.buildBrackets],
      ['Pipe Fittings',            GE9XBuilder.buildPipeFittings],
      ['Electrical Connectors',    GE9XBuilder.buildElectricalConnectors],
      ['Drains & Vents',           GE9XBuilder.buildDrainsAndVents],
      ['Fire Detection',           GE9XBuilder.buildFireSystem],
      ['Blade Cooling Holes',      GE9XBuilder.buildBladeCoolingHoles],
      ['Maintenance Tags',         GE9XBuilder.buildMaintenanceTags],
    ];

    for (const [name, fn] of sections) {
      const before = ge9x.partCount();
      fn(ge9x);
      const added = ge9x.partCount() - before;
      onProgress(name, added, ge9x.partCount());
    }

    return ge9x;
  }

  // ---------------------------------------------------------------------------
  // Inlet & Spinner
  // ---------------------------------------------------------------------------
  static buildInletSection(t) {
    const SPINNER_LEN = 0.55;
    const spinner = PrimitiveBuilder.cone(0.42, SPINNER_LEN, 64);
    t.addPart(spinner, 'Fan Spinner Cone', {
      color: 0xeeeeee,
      position: new Vec3(0, 0, -SPINNER_LEN),
      material: 'Composite Carbon-Epoxy',
      category: 'INLET', subsystem: 'SPN',
    });

    const tipCap = PrimitiveBuilder.sphere(0.080, 32, 16);
    t.addPart(tipCap, 'Spinner Tip Cap', {
      color: 0xdddddd, position: new Vec3(0, 0, -SPINNER_LEN),
      material: 'Aluminum 6061-T6',
      category: 'INLET', subsystem: 'CAP',
    });

    const m8 = FastenerLibrary.hexBolt('M8', 0.025);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * PI;
      t.addPart(m8.head, `Spinner Aft Bolt ${i + 1}`, {
        color: 0x666666,
        position: new Vec3(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0),
        material: 'Steel AISI 4340',
        category: 'INLET', subsystem: 'BLT',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Fan Module
  // ---------------------------------------------------------------------------
  static buildFanModule(t) {
    const N = GE9X_SPECS.fanBlades;
    const rHub = GE9X_SPECS.fanHubRadius;
    const rTip = GE9X_SPECS.fanRadius;

    const fanDisk = PrimitiveBuilder.cylinder(rHub + 0.10, 0.22, 96);
    t.addPart(fanDisk, 'Fan Disk', {
      color: 0xc0c0c0, material: 'Titanium Ti-6Al-4V',
      category: 'FAN', subsystem: 'DSK',
    });

    // 16 composite fan blades (4th-gen woven carbon, titanium leading edge)
    const fanBladeSolid = _getOrBuildBlade('fan-blade',
      () => TurbomachineryBlade.fanBlade(rHub, rTip, 0.220));

    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      t.addPart(fanBladeSolid, `Fan Blade ${i + 1}`, {
        color: 0x202028,
        rotation: new Vec3(0, 0, angle),
        material: 'Composite Carbon-Epoxy',
        category: 'FAN', subsystem: 'BLD',
        metadata: { generation: '4th', leadingEdge: 'Titanium', stage: 1, position: i },
      });
    }

    // 16 dovetail roots
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      const dovetail = PrimitiveBuilder.box(0.075, 0.075, 0.220);
      t.addPart(dovetail, `Fan Blade ${i + 1} Dovetail`, {
        color: 0x888888,
        position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, 0),
        rotation: new Vec3(0, 0, angle),
        material: 'Titanium Ti-6Al-4V',
        category: 'FAN', subsystem: 'DVT',
      });
    }

    // Front + rear retention rings
    const ringF = PrimitiveBuilder.torus(rHub, 0.014, 96, 16);
    t.addPart(ringF, 'Fan Front Retention Ring', {
      color: 0x707070, position: new Vec3(0, 0, -0.115),
      material: 'Titanium Ti-6Al-4V',
      category: 'FAN', subsystem: 'RNG',
    });
    const ringR = PrimitiveBuilder.torus(rHub, 0.014, 96, 16);
    t.addPart(ringR, 'Fan Rear Retention Ring', {
      color: 0x707070, position: new Vec3(0, 0, 0.115),
      material: 'Titanium Ti-6Al-4V',
      category: 'FAN', subsystem: 'RNG',
    });

    // Fan case — composite, 25mm wall
    const fanCase = PrimitiveBuilder.cylinderShell(rTip + 0.025, rTip + 0.000, 1.20, 128);
    t.addPart(fanCase, 'Fan Case (Composite)', {
      color: 0xeaeaea, position: new Vec3(0, 0, 0.30),
      material: 'Composite Carbon-Epoxy',
      category: 'FAN', subsystem: 'CSG',
    });

    // Abradable rub strip — 3mm honeycomb metallic on inner fan case
    const abradable = PrimitiveBuilder.cylinderShell(rTip + 0.005, rTip + 0.002, 0.40, 96);
    t.addPart(abradable, 'Fan Case Abradable Strip', {
      color: 0xddccaa, material: 'ABS Plastic',
      category: 'FAN', subsystem: 'ABR',
    });

    // 60 OGV (Outlet Guide Vanes)
    const OGV = 60;
    for (let i = 0; i < OGV; i++) {
      const angle = (i / OGV) * 2 * PI;
      const ogv = PrimitiveBuilder.box(0.085, 0.85, 0.022);
      t.addPart(ogv, `OGV ${i + 1}`, {
        color: 0xc0c0c0,
        position: new Vec3(Math.cos(angle) * (rHub + 0.45), Math.sin(angle) * (rHub + 0.45), 0.55),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Composite Carbon-Epoxy',
        category: 'FAN', subsystem: 'OGV',
      });
    }

    // 12 case struts
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * PI;
      const strut = PrimitiveBuilder.box(0.045, 0.85, 0.090);
      t.addPart(strut, `Fan Case Strut ${i + 1}`, {
        color: 0x999999,
        position: new Vec3(Math.cos(angle) * (rHub + 0.62), Math.sin(angle) * (rHub + 0.62), 0.85),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Titanium Ti-6Al-4V',
        category: 'FAN', subsystem: 'STR',
      });
    }

    // Fan blade attach pins (2 per blade)
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      for (let p = 0; p < 2; p++) {
        const pin = PrimitiveBuilder.cylinder(0.008, 0.080, 16);
        t.addPart(pin, `Fan Blade ${i+1} Pin ${p+1}`, {
          color: 0x444444,
          position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, p === 0 ? -0.08 : 0.08),
          material: 'Steel AISI 4340',
          category: 'FAN', subsystem: 'PIN',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // LP Compressor (Booster) — 3 stages
  // ---------------------------------------------------------------------------
  static buildLPCompressor(t) {
    const stages = GE9X_SPECS.lpcStages;
    let zCursor = 1.10;

    for (let s = 1; s <= stages; s++) {
      const rHub = 0.27 - s * 0.012;
      const rTip = 0.55 - s * 0.020;
      const chord = 0.060 - s * 0.005;

      // Stator (IGV upstream of rotor)
      const statorVane = _getOrBuildBlade(`lpc-stator-s${s}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, chord, true));
      const NS = 50 + s * 6;
      for (let i = 0; i < NS; i++) {
        const angle = (i / NS) * 2 * PI;
        t.addPart(statorVane, `LPC Stator S${s}-${i + 1}`, {
          color: 0xb0b0b0,
          position: new Vec3(0, 0, zCursor),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
          category: 'LPC', subsystem: 'STA',
          metadata: { stage: s, position: i },
        });
      }

      // Rotor disk
      const disk = PrimitiveBuilder.cylinder(rHub - 0.02, 0.085, 64);
      t.addPart(disk, `LPC S${s} Disk`, {
        color: 0xa0a0a0, position: new Vec3(0, 0, zCursor + 0.05),
        material: 'Titanium Ti-6Al-4V',
        category: 'LPC', subsystem: 'DSK',
      });

      // Rotor blades
      const rotorBlade = _getOrBuildBlade(`lpc-rotor-s${s}`,
        () => TurbomachineryBlade.compressorBlade(rHub, rTip, chord, s, stages));
      const NR = 56 + s * 6;
      for (let i = 0; i < NR; i++) {
        const angle = (i / NR) * 2 * PI;
        t.addPart(rotorBlade, `LPC Rotor S${s}-${i + 1}`, {
          color: 0xb8b8b8,
          position: new Vec3(0, 0, zCursor + 0.06),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
          category: 'LPC', subsystem: 'BLD',
          metadata: { stage: s, position: i },
        });
      }

      zCursor += 0.18;
    }

    // LPC casing — titanium 6mm wall
    const lpcCase = PrimitiveBuilder.cylinderShell(0.60, 0.594, 0.70, 96);
    t.addPart(lpcCase, 'LPC Case', {
      color: 0x9a9a9a, position: new Vec3(0, 0, 1.45),
      material: 'Titanium Ti-6Al-4V',
      category: 'LPC', subsystem: 'CSG',
    });
  }

  // ---------------------------------------------------------------------------
  // HP Compressor — 11 stages
  // ---------------------------------------------------------------------------
  static buildHPCompressor(t) {
    const stages = GE9X_SPECS.hpcStages;
    let zCursor = 1.85;
    // Real 60:1-OPR HPC: rTip drops from ~0.45m (stage 1) to ~0.24m (stage 11)
    // and rHub climbs from ~0.20m to ~0.22m. Blade height shrinks 4×.
    const rHubBase = 0.20, rHubExit = 0.22;
    const rTipBase = 0.45, rTipExit = 0.24;

    for (let s = 1; s <= stages; s++) {
      const t01 = (s - 1) / (stages - 1);
      const rHub = rHubBase + t01 * (rHubExit - rHubBase);
      const rTip = rTipBase + t01 * (rTipExit - rTipBase);
      const chord = 0.045 - t01 * 0.025;  // chord shrinks from 45mm to 20mm

      // Variable stator vanes (IGV + first 4 stages variable)
      const statorVane = _getOrBuildBlade(`hpc-stator-s${s}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, chord, true));
      const NS = GE9X_SPECS.hpcStatorVanes[s - 1] || 80;
      for (let i = 0; i < NS; i++) {
        const angle = (i / NS) * 2 * PI;
        t.addPart(statorVane, `HPC Stator S${s}-${i + 1}`, {
          color: 0xa8a8a8,
          position: new Vec3(0, 0, zCursor),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
          category: 'HPC', subsystem: 'STA',
          metadata: { stage: s, position: i, variable: s <= 4 },
        });
      }

      // Rotor disk
      const disk = PrimitiveBuilder.cylinder(rHub, 0.050, 48);
      t.addPart(disk, `HPC S${s} Disk`, {
        color: 0xa0a0a0, position: new Vec3(0, 0, zCursor + 0.05),
        material: s > 6 ? 'Inconel 718' : 'Titanium Ti-6Al-4V',
        category: 'HPC', subsystem: 'DSK',
      });

      // Rotor blades
      const rotorBlade = _getOrBuildBlade(`hpc-rotor-s${s}`,
        () => TurbomachineryBlade.compressorBlade(rHub, rTip, chord, s, stages));
      const NR = GE9X_SPECS.hpcRotorBlades[s] || 80;
      for (let i = 0; i < NR; i++) {
        const angle = (i / NR) * 2 * PI;
        t.addPart(rotorBlade, `HPC Rotor S${s}-${i + 1}`, {
          color: 0xb8b8b8,
          position: new Vec3(0, 0, zCursor + 0.06),
          rotation: new Vec3(0, 0, angle),
          material: s > 6 ? 'Inconel 718' : 'Titanium Ti-6Al-4V',
          category: 'HPC', subsystem: 'BLD',
          metadata: { stage: s, position: i },
        });
      }

      zCursor += 0.115;
    }

    // HPC casing — Inconel, 5mm wall, split into 4 axial segments
    for (let seg = 0; seg < 4; seg++) {
      const segCase = PrimitiveBuilder.cylinderShell(0.48, 0.475, 0.32, 64);
      t.addPart(segCase, `HPC Casing Segment ${seg + 1}`, {
        color: 0x8c8c8c,
        position: new Vec3(0, 0, 1.95 + seg * 0.32),
        material: 'Inconel 718',
        category: 'HPC', subsystem: 'CSG',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Combustor — TAPS III with CMC liner
  // ---------------------------------------------------------------------------
  static buildCombustor(t) {
    const zCursor = 3.30;

    // Outer combustor case — Inconel 8mm wall
    const outerCase = PrimitiveBuilder.cylinderShell(0.42, 0.412, 0.45, 64);
    t.addPart(outerCase, 'Combustor Outer Case', {
      color: 0x707070, position: new Vec3(0, 0, zCursor),
      material: 'Inconel 718',
      category: 'COMB', subsystem: 'CSG',
    });

    // CMC inner liner — 4mm wall ceramic
    const cmcLiner = PrimitiveBuilder.cylinderShell(0.32, 0.316, 0.40, 64);
    t.addPart(cmcLiner, 'Combustor CMC Inner Liner', {
      color: 0xddccaa, position: new Vec3(0, 0, zCursor),
      material: 'CMC SiC/SiC',
      category: 'COMB', subsystem: 'LIN',
      metadata: { type: 'CMC SiC/SiC', tempMax: '1500°C' },
    });

    // CMC outer liner — 4mm wall ceramic
    const cmcOuter = PrimitiveBuilder.cylinderShell(0.38, 0.376, 0.40, 64);
    t.addPart(cmcOuter, 'Combustor CMC Outer Liner', {
      color: 0xccbb99,
      position: new Vec3(0, 0, zCursor),
      material: 'CMC SiC/SiC',
      category: 'COMB', subsystem: 'LIN',
    });

    // Dome plate
    const dome = PrimitiveBuilder.cylinder(0.36, 0.05, 48);
    t.addPart(dome, 'Combustor Dome Plate', {
      color: 0x8a8a8a, position: new Vec3(0, 0, zCursor - 0.20),
      material: 'CMC SiC/SiC',
      category: 'COMB', subsystem: 'DOM',
    });

    // 30 TAPS swirler-injectors
    for (let i = 0; i < GE9X_SPECS.fuelNozzles; i++) {
      const a = (i / GE9X_SPECS.fuelNozzles) * 2 * PI;
      const swirler = PrimitiveBuilder.cylinder(0.020, 0.045, 16);
      t.addPart(swirler, `TAPS Swirler ${i + 1}`, {
        color: 0xd0a040,
        position: new Vec3(Math.cos(a) * 0.34, Math.sin(a) * 0.34, zCursor - 0.18),
        material: 'Inconel 718',
        category: 'COMB', subsystem: 'SWR',
        metadata: { type: 'TAPS III' },
      });

      const injectorTip = PrimitiveBuilder.cone(0.012, 0.030, 16);
      t.addPart(injectorTip, `TAPS Injector Tip ${i + 1}`, {
        color: 0xb0b0c0,
        position: new Vec3(Math.cos(a) * 0.34, Math.sin(a) * 0.34, zCursor - 0.16),
        material: 'Single-Crystal Nickel CMSX-4',
        category: 'COMB', subsystem: 'INJ',
      });
    }

    // 2 igniters
    for (let i = 0; i < 2; i++) {
      const a = i === 0 ? PI * 0.25 : PI * 0.75;
      const igniter = PrimitiveBuilder.cylinder(0.010, 0.180, 16);
      t.addPart(igniter, `Igniter ${i + 1}`, {
        color: 0x222222,
        position: new Vec3(Math.cos(a) * 0.35, Math.sin(a) * 0.35, zCursor - 0.10),
        material: 'Inconel 718',
        category: 'COMB', subsystem: 'IGN',
      });
    }

    // 12,000 effusion cooling holes (CMC liner cooling)
    const holeKey = `cool-hole`;
    let hole = _bladeCache.get(holeKey);
    if (!hole) {
      hole = PrimitiveBuilder.cylinder(0.0005, 0.005, 8);
      _bladeCache.set(holeKey, hole);
    }
    for (let i = 0; i < 12000; i++) {
      const a = (i / 12000) * 2 * PI * 50;
      const z = zCursor - 0.20 + (i % 200) / 200 * 0.40;
      const r = 0.32 + (i % 7 === 0 ? 0.06 : 0);
      t.addPart(hole, `Combustor Cooling Hole ${i + 1}`, {
        color: 0x000000,
        position: new Vec3(Math.cos(a) * r, Math.sin(a) * r, z),
        material: 'Air',
        category: 'COMB', subsystem: 'CHL',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // HP Turbine — 2 stages, CMC stage-1
  // ---------------------------------------------------------------------------
  static buildHPTurbine(t) {
    let zCursor = 3.85;

    for (let s = 1; s <= GE9X_SPECS.hptStages; s++) {
      const isCMC = s === 1;  // GE9X stage-1 is CMC
      const rHub = 0.18 + (s - 1) * 0.005;
      const rTip = 0.32 + (s - 1) * 0.012;
      const chord = 0.054;

      // NGV (nozzle guide vanes)
      const ngv = _getOrBuildBlade(`hpt-ngv-s${s}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, chord * 1.2, false));
      const NN = GE9X_SPECS.hptNGV[s];
      for (let i = 0; i < NN; i++) {
        const a = (i / NN) * 2 * PI;
        t.addPart(ngv, `HPT NGV S${s}-${i + 1}`, {
          color: isCMC ? 0xdcc890 : 0x8090a0,
          position: new Vec3(0, 0, zCursor),
          rotation: new Vec3(0, 0, a),
          material: isCMC ? 'CMC SiC/SiC' : 'Single-Crystal Nickel CMSX-4',
          category: 'HPT', subsystem: 'NGV',
          metadata: { stage: s, cmc: isCMC, position: i },
        });
      }

      // Rotor disk
      const disk = PrimitiveBuilder.cylinder(rHub, 0.080, 64);
      t.addPart(disk, `HPT S${s} Disk`, {
        color: 0x707070, position: new Vec3(0, 0, zCursor + 0.06),
        material: 'Single-Crystal Nickel CMSX-4',
        category: 'HPT', subsystem: 'DSK',
      });

      // Rotor blades — CMC stage 1
      const blade = _getOrBuildBlade(`hpt-blade-s${s}`,
        () => TurbomachineryBlade.turbineBlade(rHub, rTip, chord, s, GE9X_SPECS.hptStages));
      const NB = GE9X_SPECS.hptBlades[s];
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * 2 * PI;
        t.addPart(blade, `HPT Blade S${s}-${i + 1}`, {
          color: isCMC ? 0xdcc890 : 0x9a9aaa,
          position: new Vec3(0, 0, zCursor + 0.07),
          rotation: new Vec3(0, 0, a),
          material: isCMC ? 'CMC SiC/SiC' : 'Single-Crystal Nickel CMSX-4',
          category: 'HPT', subsystem: 'BLD',
          metadata: { stage: s, cmc: isCMC, position: i, coating: 'TBC' },
        });
      }

      // Fir-tree roots
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * 2 * PI;
        const root = PrimitiveBuilder.box(0.025, 0.030, 0.054);
        t.addPart(root, `HPT Blade S${s}-${i + 1} Fir-Tree Root`, {
          color: 0x808080,
          position: new Vec3(Math.cos(a) * rHub * 0.95, Math.sin(a) * rHub * 0.95, zCursor + 0.07),
          rotation: new Vec3(0, 0, a),
          material: 'Single-Crystal Nickel CMSX-4',
          category: 'HPT', subsystem: 'FIR',
        });
      }

      zCursor += 0.18;
    }

    // HPT casing — Inconel 8mm wall
    const hptCase = PrimitiveBuilder.cylinderShell(0.42, 0.412, 0.45, 64);
    t.addPart(hptCase, 'HPT Casing', {
      color: 0x6a6a7a, position: new Vec3(0, 0, 4.00),
      material: 'Inconel 718',
      category: 'HPT', subsystem: 'CSG',
    });
  }

  // ---------------------------------------------------------------------------
  // LP Turbine — 6 stages
  // ---------------------------------------------------------------------------
  static buildLPTurbine(t) {
    let zCursor = 4.30;
    for (let s = 1; s <= GE9X_SPECS.lptStages; s++) {
      const t01 = (s - 1) / (GE9X_SPECS.lptStages - 1);
      const rHub = 0.20 + t01 * 0.10;
      const rTip = 0.42 + t01 * 0.18;
      const chord = 0.040 + t01 * 0.020;

      // Stator
      const stator = _getOrBuildBlade(`lpt-stator-s${s}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, chord * 1.1, false));
      const NS = GE9X_SPECS.lptStator[s];
      for (let i = 0; i < NS; i++) {
        const a = (i / NS) * 2 * PI;
        t.addPart(stator, `LPT Stator S${s}-${i + 1}`, {
          color: 0x9a9a9a,
          position: new Vec3(0, 0, zCursor),
          rotation: new Vec3(0, 0, a),
          material: 'Inconel 718',
          category: 'LPT', subsystem: 'STA',
          metadata: { stage: s, position: i },
        });
      }

      // Rotor disk
      const disk = PrimitiveBuilder.cylinder(rHub, 0.075, 64);
      t.addPart(disk, `LPT S${s} Disk`, {
        color: 0x808080, position: new Vec3(0, 0, zCursor + 0.05),
        material: 'Inconel 718',
        category: 'LPT', subsystem: 'DSK',
      });

      // Rotor blades
      const blade = _getOrBuildBlade(`lpt-blade-s${s}`,
        () => TurbomachineryBlade.turbineBlade(rHub, rTip, chord, s, GE9X_SPECS.lptStages));
      const NB = GE9X_SPECS.lptBlades[s];
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * 2 * PI;
        t.addPart(blade, `LPT Blade S${s}-${i + 1}`, {
          color: 0xa0a0a0,
          position: new Vec3(0, 0, zCursor + 0.06),
          rotation: new Vec3(0, 0, a),
          material: 'Inconel 718',
          category: 'LPT', subsystem: 'BLD',
          metadata: { stage: s, position: i },
        });
      }

      zCursor += 0.16;
    }

    const lptCase = PrimitiveBuilder.cylinderShell(0.65, 0.642, 0.95, 96);
    t.addPart(lptCase, 'LPT Casing', {
      color: 0x6a6a7a, position: new Vec3(0, 0, 4.80),
      material: 'Inconel 718',
      category: 'LPT', subsystem: 'CSG',
    });
  }

  // ---------------------------------------------------------------------------
  // Bearings & Seals
  // ---------------------------------------------------------------------------
  static buildBearings(t) {
    // 5 main bearings: 1=fan front, 2=fan thrust, 3=HPC front, 4=HPT, 5=LPT
    const positions = [
      { name: 'Fan Forward Roller', z: -0.10, dia: 0.30, type: 'roller' },
      { name: 'Fan Thrust Ball', z: 0.20, dia: 0.32, type: 'ball' },
      { name: 'HPC Front Ball', z: 1.85, dia: 0.18, type: 'ball' },
      { name: 'HPT Aft Roller', z: 4.00, dia: 0.26, type: 'roller' },
      { name: 'LPT Aft Roller', z: 5.30, dia: 0.40, type: 'roller' },
    ];
    for (const b of positions) {
      const housing = PrimitiveBuilder.cylinder(b.dia + 0.02, 0.060, 48);
      t.addPart(housing, `Bearing #${b.name} Housing`, {
        color: 0x707070, position: new Vec3(0, 0, b.z),
        material: 'Steel AISI 4340',
        category: 'BRG', subsystem: 'HSG',
      });
      const inner = PrimitiveBuilder.cylinder(b.dia, 0.040, 48);
      t.addPart(inner, `Bearing #${b.name} Inner Race`, {
        color: 0x808080, position: new Vec3(0, 0, b.z),
        material: 'Steel AISI 4340',
        category: 'BRG', subsystem: 'RAC',
      });
      // Rolling elements
      const numElements = b.type === 'ball' ? 16 : 24;
      for (let i = 0; i < numElements; i++) {
        const a = (i / numElements) * 2 * PI;
        const elem = b.type === 'ball'
          ? PrimitiveBuilder.sphere(0.012, 16, 8)
          : PrimitiveBuilder.cylinder(0.010, 0.030, 16);
        t.addPart(elem, `Bearing #${b.name} Element ${i + 1}`, {
          color: 0x999999,
          position: new Vec3(Math.cos(a) * (b.dia + 0.01), Math.sin(a) * (b.dia + 0.01), b.z),
          material: 'Steel AISI 4340',
          category: 'BRG', subsystem: b.type === 'ball' ? 'BAL' : 'ROL',
        });
      }
    }

    // Carbon seals (12 along engine)
    for (let i = 0; i < 12; i++) {
      const seal = PrimitiveBuilder.torus(0.18, 0.008, 64, 16);
      t.addPart(seal, `Carbon Seal ${i + 1}`, {
        color: 0x101010,
        position: new Vec3(0, 0, -0.2 + i * 0.5),
        material: 'Carbon Fiber Composite',
        category: 'BRG', subsystem: 'SEL',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Shafts
  // ---------------------------------------------------------------------------
  static buildShafts(t) {
    // LP shaft — hollow tube, 12mm wall (real shafts are tubular)
    const lp = PrimitiveBuilder.cylinderShell(0.06, 0.048, 5.4, 32);
    t.addPart(lp, 'LP Shaft', {
      color: 0x999999, position: new Vec3(0, 0, 2.5),
      material: 'Steel AISI 4340',
      category: 'SHFT', subsystem: 'LP',
    });
    // HP shaft — concentric tubular, 15mm wall
    const hp = PrimitiveBuilder.cylinderShell(0.10, 0.085, 1.6, 32);
    t.addPart(hp, 'HP Shaft', {
      color: 0x777777, position: new Vec3(0, 0, 2.8),
      material: 'Steel AISI 4340',
      category: 'SHFT', subsystem: 'HP',
    });
    // Couplings (4)
    for (let i = 0; i < 4; i++) {
      const coupling = PrimitiveBuilder.cylinder(0.12, 0.060, 32);
      t.addPart(coupling, `Shaft Coupling ${i + 1}`, {
        color: 0x666666, position: new Vec3(0, 0, 1.0 + i * 1.2),
        material: 'Steel AISI 4340',
        category: 'SHFT', subsystem: 'CPL',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Accessory Gearbox
  // ---------------------------------------------------------------------------
  static buildAccessoryGearbox(t) {
    const housing = PrimitiveBuilder.box(0.55, 0.30, 0.40);
    t.addPart(housing, 'AGB Main Housing', {
      color: 0x6a6a7a, position: new Vec3(0, -0.85, 2.0),
      material: 'Aluminum 6061-T6',
      category: 'AGB', subsystem: 'HSG',
    });
    // Driveshaft from HPC
    const drive = PrimitiveBuilder.cylinder(0.025, 0.6, 16);
    t.addPart(drive, 'AGB Tower Driveshaft', {
      color: 0x808080, material: 'Steel AISI 4340',
      position: new Vec3(0, -0.4, 2.0),
      rotation: new Vec3(PI / 2, 0, 0),
      category: 'AGB', subsystem: 'DRV',
    });
    // Internal gears (24)
    for (let i = 0; i < 24; i++) {
      const gear = PrimitiveBuilder.cylinder(0.06, 0.020, 32);
      const col = i % 6, row = Math.floor(i / 6);
      t.addPart(gear, `AGB Gear ${i + 1}`, {
        color: 0x888888,
        position: new Vec3(-0.20 + col * 0.08, -0.85, 1.85 + row * 0.08),
        material: 'Steel AISI 4340',
        category: 'AGB', subsystem: 'GER',
      });
    }
    // Accessory pads (6: starter, generator, fuel pump, oil pump, hyd pump, PMG)
    const pads = ['Starter', 'IDG', 'Fuel Pump', 'Oil Pump', 'Hydraulic Pump', 'PMG'];
    pads.forEach((p, i) => {
      const padHousing = PrimitiveBuilder.cylinder(0.07, 0.10, 16);
      t.addPart(padHousing, `AGB ${p} Pad`, {
        color: 0x999999, material: 'Aluminum 6061-T6',
        position: new Vec3(-0.25 + i * 0.10, -0.95, 2.0),
        category: 'AGB', subsystem: 'PAD',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Fuel System
  // ---------------------------------------------------------------------------
  static buildFuelSystem(t) {
    const items = [
      'HMU (Hydromechanical Unit)', 'Fuel Pump LP', 'Fuel Pump HP',
      'Fuel Filter', 'Fuel Cooler', 'Fuel-Oil Heat Exchanger',
      'Fuel Manifold Outer', 'Fuel Manifold Inner',
    ];
    items.forEach((item, i) => {
      const housing = PrimitiveBuilder.cylinder(0.08, 0.18, 16);
      t.addPart(housing, item, {
        color: 0x60a0c0,
        position: _bottomPos(i, items.length, 1.5, 3.5, -0.78, 0.40),
        material: 'Aluminum 6061-T6',
        category: 'FUEL', subsystem: 'COM',
      });
    });
    // 30 fuel transfer tubes ringing the combustor (one per nozzle)
    for (let i = 0; i < GE9X_SPECS.fuelNozzles; i++) {
      const a = (i / GE9X_SPECS.fuelNozzles) * 2 * PI;
      const tube = PrimitiveBuilder.cylinder(0.006, 0.40, 8);
      t.addPart(tube, `Fuel Transfer Tube ${i + 1}`, {
        color: 0x80a0c0,
        position: new Vec3(Math.cos(a) * 0.40, Math.sin(a) * 0.40, 3.20),
        material: 'Stainless Steel 316',
        category: 'FUEL', subsystem: 'TUB',
      });
    }
  }

  static buildOilSystem(t) {
    const items = [
      'Oil Tank', 'Oil Pump (Pressure)', 'Oil Pump (Scavenge × 5)',
      'Oil Filter', 'Oil Cooler', 'Oil-Air Cooler', 'Anti-cavitation Boost',
    ];
    items.forEach((item, i) => {
      const housing = PrimitiveBuilder.cylinder(0.10, 0.20, 16);
      t.addPart(housing, item, {
        color: 0xb09060,
        position: _bottomPos(i, items.length, 0.8, 2.4, -0.92, 0.50),
        material: 'Aluminum 6061-T6',
        category: 'OIL', subsystem: 'COM',
      });
    });
    // Scavenge tubes (5 sumps × 4 tubes)
    const sumpZ = [0, 1.5, 2.8, 4.0, 5.0];
    for (let s = 0; s < 5; s++) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 2 * PI;
        const tube = PrimitiveBuilder.cylinder(0.008, 0.35, 8);
        t.addPart(tube, `Oil Scavenge Tube Sump${s + 1}-${i + 1}`, {
          color: 0x806040,
          position: new Vec3(Math.cos(a) * 0.30, Math.sin(a) * 0.30, sumpZ[s]),
          material: 'Stainless Steel 316',
          category: 'OIL', subsystem: 'TUB',
        });
      }
    }
  }

  static buildAirSystem(t) {
    const items = ['HPC Stage 5 Bleed', 'HPC Stage 8 Bleed', 'HPC Stage 11 Bleed', 'Compressor Discharge'];
    items.forEach((item, i) => {
      const a = (i / items.length) * 2 * PI;
      const valve = PrimitiveBuilder.cylinder(0.07, 0.12, 16);
      t.addPart(valve, item, {
        color: 0xa0c0c0,
        position: new Vec3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 2.5 + i * 0.15),
        material: 'Inconel 718',
        category: 'AIR', subsystem: 'VLV',
      });
    });
    // 16 cooling air tubes around HP turbine area
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * PI;
      const tube = PrimitiveBuilder.cylinder(0.012, 0.45, 8);
      t.addPart(tube, `Cooling Air Tube ${i + 1}`, {
        color: 0xa0a0c0,
        position: new Vec3(Math.cos(a) * 0.50, Math.sin(a) * 0.50, 3.5 + (i % 4) * 0.20),
        material: 'Inconel 718',
        category: 'AIR', subsystem: 'TUB',
      });
    }
  }

  static buildIgnition(t) {
    for (let i = 0; i < 2; i++) {
      const a = i === 0 ? PI * 0.25 : PI * 0.75;
      const exciter = PrimitiveBuilder.box(0.10, 0.06, 0.15);
      t.addPart(exciter, `Ignition Exciter ${i + 1}`, {
        color: 0x303030,
        position: new Vec3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 1.8),
        material: 'Aluminum 6061-T6',
        category: 'IGN', subsystem: 'EXC',
      });
      const lead = PrimitiveBuilder.cylinder(0.012, 0.50, 8);
      t.addPart(lead, `Ignition Lead ${i + 1}`, {
        color: 0x202020,
        position: new Vec3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 2.5),
        material: 'Copper C11000',
        category: 'IGN', subsystem: 'LED',
      });
    }
  }

  static buildFADECSensors(t) {
    // FADEC channels A and B mounted on fan case
    for (let ch = 0; ch < 2; ch++) {
      const a = ch === 0 ? PI * 1.3 : PI * 1.7;
      const fadec = PrimitiveBuilder.box(0.20, 0.10, 0.25);
      t.addPart(fadec, `FADEC Channel ${String.fromCharCode(65 + ch)}`, {
        color: 0x202020,
        position: new Vec3(Math.cos(a) * 1.85, Math.sin(a) * 1.85, 0.6),
        material: 'Aluminum 6061-T6',
        category: 'FADEC', subsystem: 'CTL',
      });
    }
    const sensorTypes = [
      'T2 (inlet temp)', 'T2.5 (LPC exit)', 'T3 (HPC exit)',
      'T4.95 (HPT exit)', 'T5 (LPT exit)', 'P0 (ambient)',
      'P3 (HPC discharge)', 'PT (turbine pressure)',
      'N1 (fan speed)', 'N2 (HP speed)',
      'Vibration LP', 'Vibration HP',
      'Oil pressure', 'Oil temp', 'Oil quantity',
      'Fuel flow', 'Fuel inlet T', 'Fuel inlet P',
    ];
    // Map each sensor type to a typical engine station z-position
    const stationZ = {
      'T2': 0.0, 'T2.5': 1.4, 'T3': 3.1, 'T4.95': 4.1, 'T5': 5.1,
      'P0': 0.1, 'P3': 3.05, 'PT': 4.0, 'N1': 0.3, 'N2': 2.8,
      'Vibration': 1.5, 'Oil': -0.85, 'Fuel': 1.8,
    };
    sensorTypes.forEach((type, ti) => {
      let z = 2.0;
      for (const k of Object.keys(stationZ)) {
        if (type.includes(k)) { z = stationZ[k]; break; }
      }
      for (let n = 0; n < 6; n++) {
        const a = ((ti * 6 + n) / (sensorTypes.length * 6)) * 2 * PI;
        const r = z < 0 ? 0.0 : 0.55;
        const sensor = PrimitiveBuilder.cylinder(0.012, 0.060, 12);
        t.addPart(sensor, `Sensor ${type} #${n + 1}`, {
          color: 0x404040,
          position: z < 0
            ? new Vec3((n - 3) * 0.05, z, 2.0)
            : new Vec3(Math.cos(a) * r, Math.sin(a) * r, z + (n - 3) * 0.02),
          material: 'Stainless Steel 316',
          category: 'FADEC', subsystem: 'SNS',
        });
      }
    });
  }

  static buildWireHarnesses(t) {
    // 24 harness segments along the engine outside, two rings (lower/upper)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * PI * 0.9;
      const z = 0.5 + (i / 24) * 4.5;
      const harness = PrimitiveBuilder.cylinder(0.018, 0.50, 12);
      t.addPart(harness, `Wire Harness Segment ${i + 1}`, {
        color: 0x303030,
        position: new Vec3(Math.cos(a) * 0.62, Math.sin(a) * 0.62, z),
        rotation: new Vec3(0, 0, a),
        material: 'Copper C11000',
        category: 'ELEC', subsystem: 'HRN',
      });
    }
    // 200 wire splices/connectors distributed
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * 2 * PI * 4;
      const z = 0.4 + (i / 200) * 4.8;
      const splice = PrimitiveBuilder.cylinder(0.012, 0.025, 12);
      t.addPart(splice, `Wire Splice ${i + 1}`, {
        color: 0x404040,
        position: new Vec3(Math.cos(a) * 0.65, Math.sin(a) * 0.65, z),
        material: 'Copper C11000',
        category: 'ELEC', subsystem: 'SPL',
      });
    }
  }

  static buildHydraulicLines(t) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * 2 * PI * 1.2;
      const z = 0.5 + (i / 36) * 4.5;
      const line = PrimitiveBuilder.cylinder(0.010, 0.40, 8);
      t.addPart(line, `Hydraulic Line ${i + 1}`, {
        color: 0x404060,
        position: new Vec3(Math.cos(a) * 0.60, Math.sin(a) * 0.60, z),
        rotation: new Vec3(0, 0, a),
        material: 'Stainless Steel 316',
        category: 'HYD', subsystem: 'LIN',
      });
    }
  }

  static buildCasings(t) {
    // ---- Nacelle (bypass duct + outer cowl) ----
    // Real GE9X nacelle is a continuous tube extending the full engine
    // length, forming the bypass duct between core casing and fan cowl.
    // We model it as 12 axial segments × 1 fan-cowl ring + 12 axial
    // segments of the outer bypass tube. Inlet lip is up front.

    const NACELLE_LEN = 5.4;  // total nacelle length, m
    const NACELLE_Z_START = -0.30;  // forward of fan
    const FAN_R = GE9X_SPECS.fanRadius;
    const NUM_SEG = 12;
    const segLen = NACELLE_LEN / NUM_SEG;

    // Outer fan cowl (12 segments around bypass duct) — 25mm composite wall
    for (let s = 0; s < NUM_SEG; s++) {
      const z = NACELLE_Z_START + s * segLen + segLen / 2;
      const radius = FAN_R + 0.10 - (s / NUM_SEG) * 0.30;
      const cowl = PrimitiveBuilder.cylinderShell(radius, radius - 0.025, segLen, 96);
      t.addPart(cowl, `Fan Cowl Segment ${s + 1}`, {
        color: 0xeeeeee, position: new Vec3(0, 0, z),
        material: 'Composite Carbon-Epoxy',
        category: 'NAC', subsystem: 'FCW',
      });
    }

    // Inlet lip (rounded leading edge of nacelle)
    const inletLip = PrimitiveBuilder.torus(FAN_R + 0.05, 0.06, 96, 16);
    t.addPart(inletLip, 'Nacelle Inlet Lip', {
      color: 0xdddddd, position: new Vec3(0, 0, NACELLE_Z_START),
      material: 'Aluminum 6061-T6',
      category: 'NAC', subsystem: 'LIP',
    });

    // Acoustic liner — perforated panel inside the inlet, 8mm wall
    for (let s = 0; s < 4; s++) {
      const liner = PrimitiveBuilder.cylinderShell(FAN_R + 0.005, FAN_R - 0.003, 0.10, 64);
      t.addPart(liner, `Acoustic Liner Panel ${s + 1}`, {
        color: 0xc0a060, position: new Vec3(0, 0, NACELLE_Z_START + 0.05 + s * 0.10),
        material: 'Aluminum 6061-T6',
        category: 'NAC', subsystem: 'ACL',
      });
    }

    // Inner core cowl — 8 axial segments, 18mm composite wall
    const CORE_COWL_START = 0.80;
    const CORE_COWL_LEN = 4.20;
    for (let s = 0; s < 8; s++) {
      const z = CORE_COWL_START + (s + 0.5) * (CORE_COWL_LEN / 8);
      const radius = 0.78 - (s / 8) * 0.20;
      const cowl = PrimitiveBuilder.cylinderShell(radius, radius - 0.018, CORE_COWL_LEN / 8, 96);
      t.addPart(cowl, `Core Cowl Segment ${s + 1}`, {
        color: 0xa0a0b0, position: new Vec3(0, 0, z),
        material: 'Composite Carbon-Epoxy',
        category: 'NAC', subsystem: 'COW',
      });
    }
  }

  static buildPylonMounts(t) {
    // Forward + aft mount
    const fwdMount = PrimitiveBuilder.box(0.30, 0.20, 0.50);
    t.addPart(fwdMount, 'Forward Engine Mount', {
      color: 0x707070, position: new Vec3(0, 0.85, 1.0),
      material: 'Titanium Ti-6Al-4V',
      category: 'MNT', subsystem: 'FWD',
    });
    const aftMount = PrimitiveBuilder.box(0.40, 0.25, 0.55);
    t.addPart(aftMount, 'Aft Engine Mount', {
      color: 0x707070, position: new Vec3(0, 0.85, 4.5),
      material: 'Titanium Ti-6Al-4V',
      category: 'MNT', subsystem: 'AFT',
    });
    // Thrust struts (4) — connect mounts to engine
    for (let i = 0; i < 4; i++) {
      const strut = PrimitiveBuilder.box(0.04, 0.04, 0.80);
      t.addPart(strut, `Thrust Strut ${i + 1}`, {
        color: 0x808080,
        position: new Vec3(0.10 + i * 0.05, 0.6, 1.5 + i * 0.8),
        material: 'Titanium Ti-6Al-4V',
        category: 'MNT', subsystem: 'STR',
      });
    }
  }

  static buildThrustReverser(t) {
    // 12 cascade segments
    for (let i = 0; i < 12; i++) {
      const cascade = PrimitiveBuilder.box(0.30, 0.15, 0.30);
      const a = (i / 12) * 2 * PI;
      t.addPart(cascade, `Thrust Reverser Cascade ${i + 1}`, {
        color: 0xb0b0b0,
        position: new Vec3(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 1.5),
        material: 'Titanium Ti-6Al-4V',
        category: 'TRV', subsystem: 'CAS',
      });
    }
    // 4 actuators around fan cowl
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 2 * PI;
      const actuator = PrimitiveBuilder.cylinder(0.030, 0.40, 16);
      t.addPart(actuator, `Thrust Reverser Actuator ${i + 1}`, {
        color: 0x505050,
        position: new Vec3(Math.cos(a) * 1.65, Math.sin(a) * 1.65, 1.2),
        material: 'Steel AISI 4340',
        category: 'TRV', subsystem: 'ACT',
      });
    }
  }

  static buildExhaust(t) {
    // Exhaust nozzle — Inconel 6mm wall
    const exhaustNozzle = PrimitiveBuilder.cylinderShell(0.55, 0.544, 0.45, 64);
    t.addPart(exhaustNozzle, 'Exhaust Nozzle', {
      color: 0x404040, position: new Vec3(0, 0, 5.5),
      material: 'Inconel 718',
      category: 'EXH', subsystem: 'NOZ',
    });
    // 12 chevron cutouts (noise reduction — GE9X has chevrons)
    for (let i = 0; i < 12; i++) {
      const chevron = PrimitiveBuilder.box(0.10, 0.040, 0.20);
      const a = (i / 12) * 2 * PI;
      t.addPart(chevron, `Chevron ${i + 1}`, {
        color: 0x303030,
        position: new Vec3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 5.65),
        material: 'Inconel 718',
        category: 'EXH', subsystem: 'CHV',
      });
    }
    // Tail cone — Inconel sheet, much lighter than solid cone
    const tailCone = PrimitiveBuilder.cone(0.30, 0.55, 32);
    // Real tail cone is a 4mm-thick sheet metal — shell volume:
    // approximate cone surface area × thickness
    const coneArea = Math.PI * 0.30 * Math.sqrt(0.30 * 0.30 + 0.55 * 0.55);
    const shellVol = coneArea * 0.004;
    tailCone.volume = () => shellVol;
    tailCone._isShell = true;
    t.addPart(tailCone, 'Tail Cone', {
      color: 0x404040, position: new Vec3(0, 0, 5.6),
      material: 'Inconel 718',
      category: 'EXH', subsystem: 'TLC',
    });
  }

  // ---------------------------------------------------------------------------
  // Fasteners — bulk component for assembly tree
  // ---------------------------------------------------------------------------
  static buildFasteners(t) {
    // 18 flange rings around engine, ~24 bolt+washer+nut groups each
    for (let ring = 0; ring < 18; ring++) {
      const z = ring * 0.30;
      const radius = 0.50 + (ring < 4 ? 0.5 : 0) - (ring > 12 ? 0.05 : 0);
      const numBolts = 24;
      for (let i = 0; i < numBolts; i++) {
        const a = (i / numBolts) * 2 * PI;
        const bolt = PrimitiveBuilder.cylinder(0.005, 0.030, 12);
        t.addPart(bolt, `Flange ${ring + 1} Bolt ${i + 1}`, {
          color: 0x666666,
          position: new Vec3(Math.cos(a) * radius, Math.sin(a) * radius, z),
          material: 'Steel AISI 4340',
          category: 'FAS', subsystem: 'BLT',
        });
        const washer = PrimitiveBuilder.torus(0.008, 0.0015, 16, 8);
        t.addPart(washer, `Flange ${ring + 1} Washer ${i + 1}`, {
          color: 0x888888,
          position: new Vec3(Math.cos(a) * radius, Math.sin(a) * radius, z + 0.015),
          material: 'Steel AISI 4340',
          category: 'FAS', subsystem: 'WSH',
        });
        const nut = PrimitiveBuilder.cylinder(0.008, 0.006, 6);
        t.addPart(nut, `Flange ${ring + 1} Nut ${i + 1}`, {
          color: 0x555555,
          position: new Vec3(Math.cos(a) * radius, Math.sin(a) * radius, z + 0.025),
          material: 'Steel AISI 4340',
          category: 'FAS', subsystem: 'NUT',
        });
      }
    }
  }

  static buildBrackets(t) {
    for (let i = 0; i < 130; i++) {
      const bracket = PrimitiveBuilder.box(0.08, 0.05, 0.04);
      t.addPart(bracket, `Bracket ${i + 1}`, {
        color: 0x707070,
        position: _perimeterPos(i, 130, 0.5, 5.0, 0.62),
        material: 'Aluminum 6061-T6',
        category: 'STR', subsystem: 'BKT',
      });
    }
  }

  static buildPipeFittings(t) {
    for (let i = 0; i < 320; i++) {
      const fitting = PrimitiveBuilder.cylinder(0.012, 0.025, 12);
      t.addPart(fitting, `Pipe Fitting ${i + 1}`, {
        color: 0x808080,
        position: _perimeterPos(i, 320, 0.5, 5.0, 0.66),
        material: 'Stainless Steel 316',
        category: 'PIP', subsystem: 'FTG',
      });
    }
  }

  static buildElectricalConnectors(t) {
    for (let i = 0; i < 180; i++) {
      const conn = PrimitiveBuilder.cylinder(0.018, 0.030, 12);
      t.addPart(conn, `Electrical Connector ${i + 1}`, {
        color: 0x303030,
        position: _perimeterPos(i, 180, 0.5, 5.0, 0.68),
        material: 'Aluminum 6061-T6',
        category: 'ELEC', subsystem: 'CNN',
      });
    }
  }

  static buildDrainsAndVents(t) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * PI;
      const drain = PrimitiveBuilder.cylinder(0.008, 0.10, 8);
      t.addPart(drain, `Drain Tube ${i + 1}`, {
        color: 0x808080,
        position: new Vec3(Math.cos(a) * 0.55, Math.sin(a) * 0.55 - 0.1, 1.0 + i * 0.15),
        material: 'Stainless Steel 316',
        category: 'DRN', subsystem: 'TUB',
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * PI;
      const vent = PrimitiveBuilder.cylinder(0.012, 0.08, 8);
      t.addPart(vent, `Vent Port ${i + 1}`, {
        color: 0x707070,
        position: new Vec3(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 2.5 + i * 0.10),
        material: 'Aluminum 6061-T6',
        category: 'DRN', subsystem: 'VNT',
      });
    }
  }

  static buildFireSystem(t) {
    // 2 detector loops snake around engine (30 sensors each)
    for (let loop = 0; loop < 2; loop++) {
      for (let i = 0; i < 30; i++) {
        const t01 = i / 29;
        const a = (loop * PI) + (i / 30) * 2 * PI;
        const sensor = PrimitiveBuilder.cylinder(0.008, 0.020, 8);
        t.addPart(sensor, `Fire Detector Loop ${loop + 1} #${i + 1}`, {
          color: 0xc04040,
          position: new Vec3(Math.cos(a) * 0.70, Math.sin(a) * 0.70, 0.5 + t01 * 4.5),
          material: 'Stainless Steel 316',
          category: 'FIRE', subsystem: 'DET',
        });
      }
    }
    // 2 extinguisher bottles on the bottom
    for (let i = 0; i < 2; i++) {
      const bottle = PrimitiveBuilder.cylinder(0.10, 0.40, 32);
      t.addPart(bottle, `Fire Bottle ${i + 1}`, {
        color: 0xc04040,
        position: new Vec3(0.20 + i * 0.35, -0.95, 1.4),
        material: 'Steel AISI 4340',
        category: 'FIRE', subsystem: 'BTL',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Blade Cooling Holes — bulk count for high-fidelity tree
  // ---------------------------------------------------------------------------
  static buildBladeCoolingHoles(t) {
    // HPT stage 1+2 cooling holes — distributed on each blade surface
    let holeKey = 'cool-hole-tiny';
    let hole = _bladeCache.get(holeKey);
    if (!hole) {
      hole = PrimitiveBuilder.cylinder(0.0003, 0.0040, 6);
      _bladeCache.set(holeKey, hole);
    }
    const stageZ = { 1: 3.92, 2: 4.10 };
    for (let s = 1; s <= 2; s++) {
      const N = GE9X_SPECS.hptBlades[s];
      const perBlade = s === 1 ? 80 : 60;
      const r = 0.25;
      for (let b = 0; b < N; b++) {
        const bAng = (b / N) * 2 * PI;
        for (let h = 0; h < perBlade; h++) {
          const t01 = h / perBlade;
          t.addPart(hole, `HPT S${s} Blade ${b + 1} Cool Hole ${h + 1}`, {
            color: 0x000000,
            position: new Vec3(
              Math.cos(bAng) * r,
              Math.sin(bAng) * r,
              stageZ[s] + (t01 - 0.5) * 0.05
            ),
            material: 'Air',
            category: 'HPT', subsystem: 'CHL',
          });
        }
      }
    }
  }

  static buildMaintenanceTags(t) {
    // 200 part-history tags / serial-number etches around the casings
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * 2 * PI * 1.5;
      const z = 0.4 + (i / 200) * 4.6;
      const tag = PrimitiveBuilder.box(0.025, 0.015, 0.001);
      t.addPart(tag, `Maintenance Tag ${i + 1}`, {
        color: 0xeeeeaa,
        position: new Vec3(Math.cos(a) * 0.70, Math.sin(a) * 0.70, z),
        rotation: new Vec3(0, 0, a),
        material: 'Aluminum 6061-T6',
        category: 'MNT', subsystem: 'TAG',
      });
    }
  }
}
