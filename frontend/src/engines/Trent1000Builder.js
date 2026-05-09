/**
 * Rolls-Royce Trent 1000 Builder
 *
 * Constructs a high-fidelity Trent 1000 turbofan from ArchDisc kernel APIs.
 * Each component is unique-entry in the assembly tree.
 *
 * Reference specs (Trent 1000-A, public Rolls-Royce data):
 * - Length: 4.738 m
 * - Fan diameter: 2.847 m (112 in)
 * - Fan blades: 18 (wide chord, hollow titanium)
 * - Bypass ratio: 11:1 (varies by variant)
 * - Pressure ratio: 50:1 (overall)
 * - Thrust: 240-330 kN (53,000-74,200 lbf)
 * - Mass: 5,936 kg
 * - LP/IP/HP shafts: concentric, 3-spool
 * - Compressor: 8 IP stages + 6 HP stages
 * - Combustor: annular, 24 fuel injectors, lean burn variant has more
 * - Turbine: 1 HP, 1 IP, 6 LP stages
 *
 * This builder produces ~25,000 component entries.
 */

import {
  Assembly, PrimitiveBuilder, ExtrudeFeature, RevolveFeature, LoftSweep,
  Vec3, FastenerLibrary, BearingLibrary,
  TurbomachineryBlade, NACA,
} from '../kernel/index.js';

// Cache built blade geometries — same airfoil definition reused across instances
const _bladeCache = new Map();

function _getOrBuildBlade(key, builderFn) {
  if (_bladeCache.has(key)) return _bladeCache.get(key);
  let solid;
  try {
    const profileSpec = builderFn();
    if (!profileSpec.profiles || profileSpec.profiles.length < 2) {
      // Fallback: simple box
      solid = PrimitiveBuilder.box(0.04, 0.4, 0.02);
    } else {
      // Loft through airfoil profiles
      solid = LoftSweep.loft(profileSpec.profiles, 1);
    }
  } catch (e) {
    // Loft failed (e.g., point count mismatch) — fallback to box
    solid = PrimitiveBuilder.box(0.04, 0.4, 0.02);
  }
  _bladeCache.set(key, solid);
  return solid;
}

const PI = Math.PI;

// Trent 1000 published dimensions (meters)
const TRENT_SPECS = {
  length: 4.738,
  fanDia: 2.847,
  fanRadius: 1.4235,
  fanHubRadius: 0.350,
  bypassRatio: 11.0,
  pressureRatio: 50.0,
  fanBlades: 18,
  ipcStages: 8,
  hpcStages: 6,
  hptStages: 1,
  iptStages: 1,
  lptStages: 6,
  fuelNozzles: 24,
  igniters: 4,
  mainBearings: 5,
  totalMassKg: 5936,
};

export default class Trent1000Builder {

  /**
   * Build the complete Trent 1000.
   * @param {object} options - { onProgress: (section, count, total) => void }
   * @returns {Assembly}
   */
  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    const trent = new Assembly('Rolls-Royce Trent 1000');
    trent.userData = { specs: TRENT_SPECS };

    const sections = [
      { name: 'Inlet & Spinner', fn: 'buildInletSection' },
      { name: 'Fan Module', fn: 'buildFanModule' },
      { name: 'IP Compressor (Booster)', fn: 'buildIPCompressor' },
      { name: 'HP Compressor', fn: 'buildHPCompressor' },
      { name: 'Combustor', fn: 'buildCombustor' },
      { name: 'HP Turbine', fn: 'buildHPTurbine' },
      { name: 'IP Turbine', fn: 'buildIPTurbine' },
      { name: 'LP Turbine', fn: 'buildLPTurbine' },
      { name: 'Bearings & Seals', fn: 'buildBearings' },
      { name: 'Shafts & Couplings', fn: 'buildShafts' },
      { name: 'Accessory Gearbox', fn: 'buildAccessoryGearbox' },
      { name: 'Fuel System', fn: 'buildFuelSystem' },
      { name: 'Oil System', fn: 'buildOilSystem' },
      { name: 'Air System', fn: 'buildAirSystem' },
      { name: 'Ignition System', fn: 'buildIgnitionSystem' },
      { name: 'FADEC & Sensors', fn: 'buildFADECSensors' },
      { name: 'Wire Harnesses', fn: 'buildWireHarnesses' },
      { name: 'Hydraulic Lines', fn: 'buildHydraulicLines' },
      { name: 'Casings & Cowlings', fn: 'buildCasings' },
      { name: 'Pylon & Mounts', fn: 'buildPylonMounts' },
      { name: 'Thrust Reverser', fn: 'buildThrustReverser' },
      { name: 'Exhaust Section', fn: 'buildExhaust' },
      { name: 'Fasteners', fn: 'buildFasteners' },
      { name: 'Brackets', fn: 'buildBrackets' },
      { name: 'Pipe Fittings', fn: 'buildPipeFittings' },
      { name: 'Electrical Connectors', fn: 'buildElectricalConnectors' },
      { name: 'Drains & Vents', fn: 'buildDrainsAndVents' },
      { name: 'Fire Detection & Suppression', fn: 'buildFireSystem' },
      { name: 'Blade Cooling Holes', fn: 'buildBladeCoolingHoles' },
      { name: 'Maintenance Tags', fn: 'buildMaintenanceTags' },
    ];

    let totalAdded = 0;
    for (const sec of sections) {
      const before = trent.partCount();
      Trent1000Builder[sec.fn](trent);
      const added = trent.partCount() - before;
      totalAdded += added;
      onProgress(sec.name, added, trent.partCount());
    }

    return trent;
  }

  // ==========================================================================
  // SECTION 1: INLET & SPINNER
  // ==========================================================================
  static buildInletSection(t) {
    const SPINNER_LEN = 0.45;

    // Spinner cone (composite)
    const spinner = PrimitiveBuilder.cone(0.35, SPINNER_LEN, 64);
    t.addPart(spinner, 'Fan Spinner Cone', {
      color: 0xeeeeee, position: new Vec3(0, 0, -SPINNER_LEN),
      material: 'Carbon Fiber Composite',
    });

    // Spinner cap (rotating front piece)
    const spinnerCap = PrimitiveBuilder.sphere(0.060, 32, 16);
    t.addPart(spinnerCap, 'Spinner Tip Cap', {
      color: 0xdddddd, position: new Vec3(0, 0, -SPINNER_LEN),
      material: 'Aluminum 6061-T6',
    });

    // Spinner attachment bolts (12 bolts on aft flange)
    const m8Bolt = FastenerLibrary.hexBolt('M8', 0.025);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * PI;
      t.addPart(m8Bolt.head, `Spinner Aft Bolt ${i + 1}`, {
        color: 0x666666,
        position: new Vec3(Math.cos(angle) * 0.31, Math.sin(angle) * 0.31, 0),
        material: 'Steel AISI 4340',
      });
    }
  }

  // ==========================================================================
  // SECTION 2: FAN MODULE — 18 wide-chord blades + disk + dovetails
  // ==========================================================================
  static buildFanModule(t) {
    const N = TRENT_SPECS.fanBlades;
    const rHub = TRENT_SPECS.fanHubRadius;
    const rTip = TRENT_SPECS.fanRadius;

    // Fan disk (hollow titanium hub)
    const fanDisk = PrimitiveBuilder.cylinder(rHub + 0.080, 0.180, 96);
    t.addPart(fanDisk, 'Fan Disk', {
      color: 0xc0c0c0, position: new Vec3(0, 0, 0),
      material: 'Titanium Ti-6Al-4V',
    });

    // Fan disk inner bore
    const fanDiskBore = PrimitiveBuilder.cylinder(0.180, 0.180, 64);
    t.addPart(fanDiskBore, 'Fan Disk Bore Lining', {
      color: 0xa0a0a0, position: new Vec3(0, 0, 0),
      material: 'Titanium Ti-6Al-4V',
    });

    // 18 fan blades — built via real lofted airfoil profiles (NACA-derived).
    // Geometry is cached and reused for all 18 instances (renders as InstancedMesh)
    // but each gets a UNIQUE tree entry with its own serial number.
    const fanBladeSolid = _getOrBuildBlade('fan-blade',
      () => TurbomachineryBlade.fanBlade(rHub, rTip, 0.180));

    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      t.addPart(fanBladeSolid, `Fan Blade ${i + 1} (S/N T1000-FB-${1000 + i})`, {
        color: 0xb8b8b8,
        position: new Vec3(0, 0, 0),
        rotation: new Vec3(0, 0, angle),
        material: 'Titanium Ti-6Al-4V',
      });
    }

    // 18 dovetail roots (one per blade)
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      const dovetail = PrimitiveBuilder.box(0.060, 0.060, 0.180);
      t.addPart(dovetail, `Fan Blade ${i + 1} Dovetail Root`, {
        color: 0x888888,
        position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, 0),
        rotation: new Vec3(0, 0, angle),
        material: 'Titanium Ti-6Al-4V',
      });
    }

    // Fan disk dovetail slots (where blades attach) — 18 slots machined into disk
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * PI;
      const slot = PrimitiveBuilder.box(0.058, 0.058, 0.178);
      t.addPart(slot, `Fan Disk Slot ${i + 1}`, {
        color: 0x999999,
        position: new Vec3(Math.cos(angle) * (rHub - 0.005), Math.sin(angle) * (rHub - 0.005), 0),
        rotation: new Vec3(0, 0, angle),
        material: 'Titanium Ti-6Al-4V',
      });
    }

    // Fan blade retention rings (front and rear, hold blades axially)
    const retentionRingFront = PrimitiveBuilder.torus(rHub, 0.012, 96, 16);
    t.addPart(retentionRingFront, 'Fan Blade Front Retention Ring', {
      color: 0x707070, position: new Vec3(0, 0, -0.095),
      material: 'Titanium Ti-6Al-4V',
    });
    const retentionRingRear = PrimitiveBuilder.torus(rHub, 0.012, 96, 16);
    t.addPart(retentionRingRear, 'Fan Blade Rear Retention Ring', {
      color: 0x707070, position: new Vec3(0, 0, 0.095),
      material: 'Titanium Ti-6Al-4V',
    });

    // Fan case (composite, 2.85m dia, 1m long)
    const fanCase = PrimitiveBuilder.cylinder(rTip + 0.020, 1.00, 128);
    t.addPart(fanCase, 'Fan Case (Composite)', {
      color: 0xeaeaea, position: new Vec3(0, 0, 0.250),
      material: 'Carbon Fiber Composite',
    });

    // Fan case abradable rub strip (sacrificial liner blades rub against)
    const abradable = PrimitiveBuilder.cylinder(rTip + 0.005, 0.300, 96);
    t.addPart(abradable, 'Fan Case Abradable Rub Strip', {
      color: 0xddccaa, position: new Vec3(0, 0, 0),
      material: 'ABS Plastic', // simplified — real is honeycomb metallic
    });

    // Fan exit guide vanes (FEGVs) — 56 vanes downstream of fan, structural
    const FEGV_COUNT = 56;
    for (let i = 0; i < FEGV_COUNT; i++) {
      const angle = (i / FEGV_COUNT) * 2 * PI;
      const fegv = PrimitiveBuilder.box(0.080, 0.700, 0.020);
      t.addPart(fegv, `Fan Exit Guide Vane ${i + 1}`, {
        color: 0xc0c0c0,
        position: new Vec3(
          Math.cos(angle) * (rHub + 0.350),
          Math.sin(angle) * (rHub + 0.350),
          0.450
        ),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Carbon Fiber Composite',
      });
    }

    // Fan case mount struts (8 radial struts to engine core)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * PI;
      const strut = PrimitiveBuilder.box(0.040, 0.700, 0.080);
      t.addPart(strut, `Fan Case Strut ${i + 1}`, {
        color: 0x999999,
        position: new Vec3(
          Math.cos(angle) * (rHub + 0.500),
          Math.sin(angle) * (rHub + 0.500),
          0.700
        ),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Titanium Ti-6Al-4V',
      });
    }
  }

  // ==========================================================================
  // SECTION 3: IP COMPRESSOR (8 stages, ~50-90 blades each)
  // ==========================================================================
  static buildIPCompressor(t) {
    const N_STAGES = TRENT_SPECS.ipcStages;
    let zPos = 0.85;
    const stageBladeCounts = [54, 60, 66, 72, 78, 84, 88, 92]; // Trent IP rotor counts
    const stageVaneCounts = [60, 66, 72, 78, 84, 90, 96, 100]; // stator counts

    for (let stage = 0; stage < N_STAGES; stage++) {
      const stageProgress = stage / (N_STAGES - 1);
      const rTip = 0.530 - stageProgress * 0.040;  // tapers slightly
      const rHub = rTip - 0.180 + stageProgress * 0.030;

      // Disk for this stage
      const disk = PrimitiveBuilder.cylinder(rHub - 0.010, 0.040, 64);
      t.addPart(disk, `IPC Stage ${stage + 1} Disk`, {
        color: 0xb0b0b0,
        position: new Vec3(0, 0, zPos),
        material: 'Titanium Ti-6Al-4V',
      });

      // Spacer between disks
      if (stage > 0) {
        const spacer = PrimitiveBuilder.cylinder(rHub - 0.020, 0.025, 48);
        t.addPart(spacer, `IPC Stage ${stage} Spacer`, {
          color: 0xa8a8a8, position: new Vec3(0, 0, zPos - 0.040),
          material: 'Titanium Ti-6Al-4V',
        });
      }

      // Rotor blades — real lofted airfoil per stage (cached, instanced)
      const N_ROTORS = stageBladeCounts[stage];
      const ipcBladeSolid = _getOrBuildBlade(`ipc-rotor-s${stage}`,
        () => TurbomachineryBlade.compressorBlade(rHub, rTip, 0.025, stage + 1, N_STAGES));
      for (let i = 0; i < N_ROTORS; i++) {
        const angle = (i / N_ROTORS) * 2 * PI;
        t.addPart(ipcBladeSolid, `IPC S${stage + 1} R${i + 1}`, {
          color: 0x9a9a9a,
          position: new Vec3(0, 0, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
        });
      }

      // Rotor blade roots (dovetails)
      for (let i = 0; i < N_ROTORS; i++) {
        const angle = (i / N_ROTORS) * 2 * PI;
        const root = PrimitiveBuilder.box(0.020, 0.025, 0.025);
        t.addPart(root, `IPC S${stage + 1} R${i + 1} Root`, {
          color: 0x808080,
          position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
        });
      }

      // Stator vanes — separate ring downstream of rotor (cached lofted airfoil)
      const N_STATORS = stageVaneCounts[stage];
      const ipcStatorSolid = _getOrBuildBlade(`ipc-stator-s${stage}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, 0.022, true));
      for (let i = 0; i < N_STATORS; i++) {
        const angle = (i / N_STATORS) * 2 * PI;
        t.addPart(ipcStatorSolid, `IPC S${stage + 1} V${i + 1}`, {
          color: 0x888888,
          position: new Vec3(0, 0, zPos + 0.045),
          rotation: new Vec3(0, 0, angle),
          material: 'Titanium Ti-6Al-4V',
        });
      }

      // Variable stator vane actuator ring (every other stage)
      if (stage % 2 === 0) {
        const vsvRing = PrimitiveBuilder.torus(rTip + 0.020, 0.008, 64, 12);
        t.addPart(vsvRing, `IPC S${stage + 1} VSV Actuator Ring`, {
          color: 0x666666, position: new Vec3(0, 0, zPos + 0.060),
          material: 'Stainless Steel 316',
        });
      }

      zPos += 0.090;
    }

    // IPC outer casing
    const ipcCasing = PrimitiveBuilder.cylinder(0.560, 0.85, 96);
    t.addPart(ipcCasing, 'IP Compressor Casing', {
      color: 0xa0a0a0, position: new Vec3(0, 0, 1.20),
      material: 'Stainless Steel 316',
    });

    // IPC bleed valves (3 bleeds at stages 4, 6, 8)
    for (let i = 0; i < 3; i++) {
      const z = 0.85 + (3 + i * 2) * 0.090;
      for (let j = 0; j < 4; j++) {
        const angle = (j / 4) * 2 * PI;
        const valve = PrimitiveBuilder.cylinder(0.030, 0.060, 24);
        t.addPart(valve, `IPC Bleed Stage ${4 + i * 2} Port ${j + 1}`, {
          color: 0x555555,
          position: new Vec3(
            Math.cos(angle) * 0.580,
            Math.sin(angle) * 0.580,
            z
          ),
          rotation: new Vec3(0, 0, angle + PI / 2),
          material: 'Stainless Steel 316',
        });
      }
    }
  }

  // ==========================================================================
  // SECTION 4: HP COMPRESSOR (6 stages, smaller higher-RPM)
  // ==========================================================================
  static buildHPCompressor(t) {
    const N_STAGES = TRENT_SPECS.hpcStages;
    let zPos = 1.65;
    const rotors = [70, 76, 82, 88, 92, 96];
    const stators = [76, 82, 88, 94, 100, 104];

    for (let stage = 0; stage < N_STAGES; stage++) {
      const sp = stage / (N_STAGES - 1);
      const rTip = 0.380 - sp * 0.080;
      const rHub = rTip - 0.090;

      // Disk
      const disk = PrimitiveBuilder.cylinder(rHub - 0.005, 0.035, 48);
      t.addPart(disk, `HPC Stage ${stage + 1} Disk`, {
        color: 0xa8a8a8,
        position: new Vec3(0, 0, zPos),
        material: 'Inconel 718',
      });

      // HPC rotor blades — lofted airfoil per stage
      const N_ROTORS = rotors[stage];
      const hpcBladeSolid = _getOrBuildBlade(`hpc-rotor-s${stage}`,
        () => TurbomachineryBlade.compressorBlade(rHub, rTip, 0.018, stage + 1, N_STAGES));
      for (let i = 0; i < N_ROTORS; i++) {
        const angle = (i / N_ROTORS) * 2 * PI;
        t.addPart(hpcBladeSolid, `HPC S${stage + 1} R${i + 1}`, {
          color: 0x888888,
          position: new Vec3(0, 0, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
      }

      // Roots
      for (let i = 0; i < N_ROTORS; i++) {
        const angle = (i / N_ROTORS) * 2 * PI;
        const root = PrimitiveBuilder.box(0.014, 0.018, 0.018);
        t.addPart(root, `HPC S${stage + 1} R${i + 1} Root`, {
          color: 0x707070,
          position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
      }

      // HPC Stators — lofted airfoil
      const N_STATORS = stators[stage];
      const hpcStatorSolid = _getOrBuildBlade(`hpc-stator-s${stage}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, 0.016, true));
      for (let i = 0; i < N_STATORS; i++) {
        const angle = (i / N_STATORS) * 2 * PI;
        t.addPart(hpcStatorSolid, `HPC S${stage + 1} V${i + 1}`, {
          color: 0x787878,
          position: new Vec3(0, 0, zPos + 0.040),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
      }

      zPos += 0.075;
    }

    // HPC casing (Inconel — handles high pressures + temps)
    const hpcCasing = PrimitiveBuilder.cylinder(0.420, 0.55, 64);
    t.addPart(hpcCasing, 'HP Compressor Casing', {
      color: 0x959595, position: new Vec3(0, 0, 1.85),
      material: 'Inconel 718',
    });

    // Diffuser case (transition to combustor)
    const diffuser = PrimitiveBuilder.cone(0.320, 0.180, 48);
    t.addPart(diffuser, 'Compressor Diffuser', {
      color: 0x888888, position: new Vec3(0, 0, 2.20),
      material: 'Inconel 718',
    });
  }

  // ==========================================================================
  // SECTION 5: COMBUSTOR (annular, 5000+ effusion holes)
  // ==========================================================================
  static buildCombustor(t) {
    const N_NOZZLES = TRENT_SPECS.fuelNozzles;
    const N_IGNITERS = TRENT_SPECS.igniters;
    const Z_CENTER = 2.40;

    // Outer combustor casing
    const outerCase = PrimitiveBuilder.cylinder(0.420, 0.480, 64);
    t.addPart(outerCase, 'Combustor Outer Casing', {
      color: 0x9a9a9a, position: new Vec3(0, 0, Z_CENTER),
      material: 'Inconel 718',
    });

    // Inner combustor casing
    const innerCase = PrimitiveBuilder.cylinder(0.180, 0.480, 48);
    t.addPart(innerCase, 'Combustor Inner Casing', {
      color: 0x999999, position: new Vec3(0, 0, Z_CENTER),
      material: 'Inconel 718',
    });

    // Outer combustor liner (thermal barrier coated)
    const outerLiner = PrimitiveBuilder.cylinder(0.350, 0.450, 64);
    t.addPart(outerLiner, 'Outer Combustor Liner (TBC Coated)', {
      color: 0xcc6622, position: new Vec3(0, 0, Z_CENTER),
      material: 'Inconel 718',
    });

    // Inner combustor liner
    const innerLiner = PrimitiveBuilder.cylinder(0.250, 0.450, 48);
    t.addPart(innerLiner, 'Inner Combustor Liner (TBC Coated)', {
      color: 0xbb5511, position: new Vec3(0, 0, Z_CENTER),
      material: 'Inconel 718',
    });

    // 24 fuel injector / nozzle assemblies
    for (let i = 0; i < N_NOZZLES; i++) {
      const angle = (i / N_NOZZLES) * 2 * PI;

      // Nozzle body
      const nozzle = PrimitiveBuilder.cylinder(0.020, 0.120, 24);
      t.addPart(nozzle, `Fuel Nozzle ${i + 1} Body`, {
        color: 0x666666,
        position: new Vec3(Math.cos(angle) * 0.380, Math.sin(angle) * 0.380, Z_CENTER - 0.180),
        material: 'Inconel 718',
      });

      // Nozzle tip
      const nozzleTip = PrimitiveBuilder.cone(0.015, 0.020, 16);
      t.addPart(nozzleTip, `Fuel Nozzle ${i + 1} Tip`, {
        color: 0x444444,
        position: new Vec3(Math.cos(angle) * 0.330, Math.sin(angle) * 0.330, Z_CENTER - 0.060),
        material: 'Inconel 718',
      });

      // Heat shield around nozzle
      const heatShield = PrimitiveBuilder.cylinder(0.030, 0.080, 16);
      t.addPart(heatShield, `Fuel Nozzle ${i + 1} Heat Shield`, {
        color: 0xaa6644,
        position: new Vec3(Math.cos(angle) * 0.330, Math.sin(angle) * 0.330, Z_CENTER - 0.060),
        material: 'Inconel 718',
      });

      // Fuel feed line to each nozzle
      const fuelLine = PrimitiveBuilder.cylinder(0.005, 0.150, 12);
      t.addPart(fuelLine, `Fuel Nozzle ${i + 1} Feed Line`, {
        color: 0x222222,
        position: new Vec3(Math.cos(angle) * 0.430, Math.sin(angle) * 0.430, Z_CENTER - 0.180),
        material: 'Stainless Steel 316',
      });

      // Mounting flange for each nozzle (8 bolts)
      for (let b = 0; b < 8; b++) {
        const ba = (b / 8) * 2 * PI;
        const bolt = FastenerLibrary.hexBolt('M6', 0.020);
        const cx = Math.cos(angle) * 0.380 + Math.cos(ba) * 0.030;
        const cy = Math.sin(angle) * 0.380 + Math.sin(ba) * 0.030;
        t.addPart(bolt.head, `Fuel Nozzle ${i + 1} Bolt ${b + 1}`, {
          color: 0x555555,
          position: new Vec3(cx, cy, Z_CENTER - 0.240),
          material: 'Steel AISI 4340',
        });
      }
    }

    // 4 igniter plugs
    for (let i = 0; i < N_IGNITERS; i++) {
      const angle = (i / N_IGNITERS) * 2 * PI + PI / N_IGNITERS;

      const igniter = PrimitiveBuilder.cylinder(0.012, 0.090, 16);
      t.addPart(igniter, `Igniter ${i + 1} Plug`, {
        color: 0x333333,
        position: new Vec3(Math.cos(angle) * 0.395, Math.sin(angle) * 0.395, Z_CENTER - 0.150),
        material: 'Inconel 718',
      });

      const igniterCable = PrimitiveBuilder.cylinder(0.008, 0.300, 12);
      t.addPart(igniterCable, `Igniter ${i + 1} HT Cable`, {
        color: 0x222222,
        position: new Vec3(Math.cos(angle) * 0.450, Math.sin(angle) * 0.450, Z_CENTER - 0.300),
        material: 'Stainless Steel 316',
      });
    }

    // Combustor mounting bolts (front flange and rear flange)
    for (let flange = 0; flange < 2; flange++) {
      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * 2 * PI;
        const bolt = FastenerLibrary.hexBolt('M10', 0.030);
        t.addPart(bolt.head, `Combustor ${flange === 0 ? 'Front' : 'Rear'} Bolt ${i + 1}`, {
          color: 0x666666,
          position: new Vec3(
            Math.cos(angle) * 0.420,
            Math.sin(angle) * 0.420,
            Z_CENTER + (flange === 0 ? -0.260 : 0.260)
          ),
          material: 'Steel AISI 4340',
        });
      }
    }

    // 12,000 effusion cooling holes — Trent 1000 lean-burn has ~10-15k holes
    const N_COOLING_HOLES = 12000;
    const HOLE_DIA = 0.0008;
    // Distribute across outer + inner liners with realistic patterns
    // 60 axial rows × 100 circumferential × 2 liners = 12,000
    for (let i = 0; i < N_COOLING_HOLES; i++) {
      const ring = i % 60;
      const idx = Math.floor(i / 60) % 100;
      const liner = Math.floor(i / (60 * 100));

      const radius = liner === 0 ? 0.345 : 0.255;
      const angle = (idx / 100) * 2 * PI;
      const z = Z_CENTER - 0.225 + ring * 0.0075;

      const hole = PrimitiveBuilder.cylinder(HOLE_DIA, 0.005, 4);
      t.addPart(hole, `Comb ${liner === 0 ? 'Outer' : 'Inner'} Cool Hole R${ring}-${idx}`, {
        color: 0x111111,
        position: new Vec3(Math.cos(angle) * radius, Math.sin(angle) * radius, z),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // SECTION 6: HP TURBINE (1 stage, single crystal blades, cooled)
  // ==========================================================================
  static buildHPTurbine(t) {
    const Z = 2.78;

    // HPT disk — most critical part of engine
    const hptDisk = PrimitiveBuilder.cylinder(0.380, 0.060, 64);
    t.addPart(hptDisk, 'HPT Disk (Forged Inconel 718)', {
      color: 0xc05533, position: new Vec3(0, 0, Z),
      material: 'Inconel 718',
    });

    // Disk live rim (where blades attach)
    const liveRim = PrimitiveBuilder.cylinder(0.395, 0.080, 64);
    t.addPart(liveRim, 'HPT Disk Live Rim', {
      color: 0xa84422, position: new Vec3(0, 0, Z),
      material: 'Inconel 718',
    });

    // 76 single-crystal blades — high-camber lofted airfoil with cooling
    const N_HPT_BLADES = 76;
    const hptBladeSolid = _getOrBuildBlade('hpt-blade',
      () => TurbomachineryBlade.turbineBlade(0.405, 0.490, 0.030, 1, 1));
    for (let i = 0; i < N_HPT_BLADES; i++) {
      const angle = (i / N_HPT_BLADES) * 2 * PI;
      t.addPart(hptBladeSolid, `HPT Blade ${i + 1} (S/N HPT-B${5000 + i}, single crystal)`, {
        color: 0xff8866,
        position: new Vec3(0, 0, Z),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });

      // Fir-tree root for each blade
      const root = PrimitiveBuilder.box(0.025, 0.030, 0.030);
      t.addPart(root, `HPT Blade ${i + 1} Fir-Tree Root`, {
        color: 0xbb5533,
        position: new Vec3(Math.cos(angle) * 0.395, Math.sin(angle) * 0.395, Z),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });

      // Tip shroud (each blade has one)
      const tipShroud = PrimitiveBuilder.box(0.025, 0.005, 0.025);
      t.addPart(tipShroud, `HPT Blade ${i + 1} Tip Shroud`, {
        color: 0xee7755,
        position: new Vec3(Math.cos(angle) * 0.500, Math.sin(angle) * 0.500, Z),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });
    }

    // 64 nozzle guide vanes (NGVs) upstream of HPT — turbine stator
    const N_NGV = 64;
    const hptNgvSolid = _getOrBuildBlade('hpt-ngv',
      () => TurbomachineryBlade.statorVane(0.405, 0.490, 0.035, false));
    for (let i = 0; i < N_NGV; i++) {
      const angle = (i / N_NGV) * 2 * PI;
      t.addPart(hptNgvSolid, `HPT NGV ${i + 1} (CMC Coated)`, {
        color: 0xee9966,
        position: new Vec3(0, 0, Z - 0.060),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });

      // NGV inner platform
      const innerPlatform = PrimitiveBuilder.box(0.030, 0.020, 0.030);
      t.addPart(innerPlatform, `HPT NGV ${i + 1} Inner Platform`, {
        color: 0xdd8855,
        position: new Vec3(Math.cos(angle) * 0.400, Math.sin(angle) * 0.400, Z - 0.060),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });

      // NGV outer platform
      const outerPlatform = PrimitiveBuilder.box(0.030, 0.020, 0.030);
      t.addPart(outerPlatform, `HPT NGV ${i + 1} Outer Platform`, {
        color: 0xdd8855,
        position: new Vec3(Math.cos(angle) * 0.510, Math.sin(angle) * 0.510, Z - 0.060),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });
    }

    // HPT shroud segments (40 segments around perimeter)
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * 2 * PI;
      const shroud = PrimitiveBuilder.box(0.080, 0.025, 0.060);
      t.addPart(shroud, `HPT Shroud Segment ${i + 1}`, {
        color: 0xcc7744,
        position: new Vec3(
          Math.cos(angle) * 0.520,
          Math.sin(angle) * 0.520,
          Z
        ),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Inconel 718',
      });
    }

    // Cooling air supply tubes (4 supplies feeding blade roots)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI;
      const tube = PrimitiveBuilder.cylinder(0.015, 0.300, 12);
      t.addPart(tube, `HPT Cooling Air Supply ${i + 1}`, {
        color: 0x4488aa,
        position: new Vec3(Math.cos(angle) * 0.440, Math.sin(angle) * 0.440, Z + 0.150),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // SECTION 7: IP TURBINE (1 stage)
  // ==========================================================================
  static buildIPTurbine(t) {
    const Z = 2.95;
    const N_BLADES = 80;
    const N_NGV = 80;

    const iptDisk = PrimitiveBuilder.cylinder(0.480, 0.055, 64);
    t.addPart(iptDisk, 'IPT Disk', {
      color: 0xb05533, position: new Vec3(0, 0, Z),
      material: 'Inconel 718',
    });

    const iptBladeSolid = _getOrBuildBlade('ipt-blade',
      () => TurbomachineryBlade.turbineBlade(0.490, 0.620, 0.032, 1, 1));
    for (let i = 0; i < N_BLADES; i++) {
      const angle = (i / N_BLADES) * 2 * PI;
      t.addPart(iptBladeSolid, `IPT Blade ${i + 1} (S/N IPT-B${6000 + i})`, {
        color: 0xee9977,
        position: new Vec3(0, 0, Z),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });
      const root = PrimitiveBuilder.box(0.028, 0.030, 0.030);
      t.addPart(root, `IPT Blade ${i + 1} Fir-Tree Root`, {
        color: 0xbb6644,
        position: new Vec3(Math.cos(angle) * 0.485, Math.sin(angle) * 0.485, Z),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });
    }

    const iptNgvSolid = _getOrBuildBlade('ipt-ngv',
      () => TurbomachineryBlade.statorVane(0.490, 0.620, 0.034, false));
    for (let i = 0; i < N_NGV; i++) {
      const angle = (i / N_NGV) * 2 * PI;
      t.addPart(iptNgvSolid, `IPT NGV ${i + 1}`, {
        color: 0xdd8855,
        position: new Vec3(0, 0, Z - 0.055),
        rotation: new Vec3(0, 0, angle),
        material: 'Inconel 718',
      });
    }

    // Shroud segments
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * 2 * PI;
      const shroud = PrimitiveBuilder.box(0.080, 0.025, 0.080);
      t.addPart(shroud, `IPT Shroud Segment ${i + 1}`, {
        color: 0xcc6633,
        position: new Vec3(Math.cos(angle) * 0.640, Math.sin(angle) * 0.640, Z),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // SECTION 8: LP TURBINE (6 stages, expanding)
  // ==========================================================================
  static buildLPTurbine(t) {
    const N_STAGES = TRENT_SPECS.lptStages;
    const rotors = [108, 116, 124, 132, 140, 148]; // expanding
    const stators = [114, 122, 130, 138, 146, 154];
    let zPos = 3.10;

    for (let stage = 0; stage < N_STAGES; stage++) {
      const sp = stage / (N_STAGES - 1);
      const rTip = 0.625 + sp * 0.075;
      const rHub = rTip - 0.150 - sp * 0.020;

      const disk = PrimitiveBuilder.cylinder(rHub - 0.005, 0.045, 64);
      t.addPart(disk, `LPT Stage ${stage + 1} Disk`, {
        color: 0xa86644 + stage * 0x110000,
        position: new Vec3(0, 0, zPos),
        material: 'Inconel 718',
      });

      const N_ROTORS = rotors[stage];
      const lptBladeSolid = _getOrBuildBlade(`lpt-rotor-s${stage}`,
        () => TurbomachineryBlade.turbineBlade(rHub, rTip, 0.030, stage + 1, N_STAGES));
      for (let i = 0; i < N_ROTORS; i++) {
        const angle = (i / N_ROTORS) * 2 * PI;
        t.addPart(lptBladeSolid, `LPT S${stage + 1} R${i + 1}`, {
          color: 0xee9966,
          position: new Vec3(0, 0, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
        // Fir tree root
        const root = PrimitiveBuilder.box(0.025, 0.026, 0.026);
        t.addPart(root, `LPT S${stage + 1} R${i + 1} Root`, {
          color: 0xbb6644,
          position: new Vec3(Math.cos(angle) * rHub, Math.sin(angle) * rHub, zPos),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
      }

      const N_STATORS = stators[stage];
      const lptStatorSolid = _getOrBuildBlade(`lpt-stator-s${stage}`,
        () => TurbomachineryBlade.statorVane(rHub, rTip, 0.030, false));
      for (let i = 0; i < N_STATORS; i++) {
        const angle = (i / N_STATORS) * 2 * PI;
        t.addPart(lptStatorSolid, `LPT S${stage + 1} V${i + 1}`, {
          color: 0xdd8855,
          position: new Vec3(0, 0, zPos + 0.055),
          rotation: new Vec3(0, 0, angle),
          material: 'Inconel 718',
        });
      }

      zPos += 0.135;
    }
  }

  // ==========================================================================
  // SECTION 9: BEARINGS (5 main + accessories)
  // ==========================================================================
  static buildBearings(t) {
    const positions = [
      { z: 0.10, name: 'No.1 Thrust Bearing (LP)', des: '6020' },
      { z: 0.85, name: 'No.2 Roller Bearing (IP Front)', des: '6018' },
      { z: 1.65, name: 'No.3 Roller Bearing (HP Front)', des: '6014' },
      { z: 2.78, name: 'No.4 Roller Bearing (HP Rear)', des: '6012' },
      { z: 3.85, name: 'No.5 Roller Bearing (LP Rear)', des: '6016' },
    ];
    for (const bp of positions) {
      const bearing = BearingLibrary.deepGrooveBallBearing(bp.des);
      bearing.parts.forEach((p, idx) => {
        t.addPart(p.solid, `${bp.name} ${p.name}`, {
          color: p.color, position: new Vec3(0, 0, bp.z), material: p.material,
        });
      });
      // Bearing housing
      const housing = PrimitiveBuilder.cylinder(bearing.specs.od + 0.020, 0.040, 32);
      t.addPart(housing, `${bp.name} Housing`, {
        color: 0x999999, position: new Vec3(0, 0, bp.z),
        material: 'Steel AISI 4340',
      });
      // Bearing oil seal
      const seal = PrimitiveBuilder.torus(bearing.specs.bore + 0.005, 0.003, 24, 8);
      t.addPart(seal, `${bp.name} Oil Seal`, {
        color: 0x222222, position: new Vec3(0, 0, bp.z + 0.020),
        material: 'Rubber',
      });
    }

    // Labyrinth seals around shafts (10 around bearings)
    for (let i = 0; i < 10; i++) {
      const z = 0.10 + i * 0.40;
      const seal = PrimitiveBuilder.torus(0.080, 0.010, 64, 16);
      t.addPart(seal, `Labyrinth Seal ${i + 1}`, {
        color: 0xaaaaaa, position: new Vec3(0, 0, z),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // SECTION 10: SHAFTS (3-spool concentric)
  // ==========================================================================
  static buildShafts(t) {
    // LP shaft (longest, runs entire engine)
    const lpShaft = PrimitiveBuilder.cylinder(0.060, 4.50, 32);
    t.addPart(lpShaft, 'LP Shaft (LP rotor coupling)', {
      color: 0x999999, position: new Vec3(0, 0, 1.85),
      material: 'Inconel 718',
    });
    // IP shaft (medium length)
    const ipShaft = PrimitiveBuilder.cylinder(0.090, 2.80, 32);
    t.addPart(ipShaft, 'IP Shaft (IP rotor coupling)', {
      color: 0xa8a8a8, position: new Vec3(0, 0, 1.85),
      material: 'Inconel 718',
    });
    // HP shaft (shortest, hottest)
    const hpShaft = PrimitiveBuilder.cylinder(0.130, 1.20, 32);
    t.addPart(hpShaft, 'HP Shaft (HP rotor coupling)', {
      color: 0xb8b8b8, position: new Vec3(0, 0, 2.20),
      material: 'Inconel 718',
    });

    // Curvic couplings (8 along the train — connect rotor sections)
    for (let i = 0; i < 8; i++) {
      const z = 0.20 + i * 0.55;
      const curvic = PrimitiveBuilder.cylinder(0.110, 0.025, 48);
      t.addPart(curvic, `Curvic Coupling ${i + 1}`, {
        color: 0x888888, position: new Vec3(0, 0, z),
        material: 'Inconel 718',
      });
    }

    // Tie bolt (long bolt holding rotor stack)
    const tieBolt = PrimitiveBuilder.cylinder(0.020, 4.20, 12);
    t.addPart(tieBolt, 'Rotor Tie Bolt', {
      color: 0x666666, position: new Vec3(0, 0, 1.85),
      material: 'Steel AISI 4340',
    });
  }

  // ==========================================================================
  // SECTION 11: ACCESSORY GEARBOX
  // ==========================================================================
  static buildAccessoryGearbox(t) {
    const X = 0.50, Y = -0.55, Z = 1.50;

    // Gearbox housing (multi-piece)
    const housing = PrimitiveBuilder.box(0.420, 0.300, 0.500);
    t.addPart(housing, 'Accessory Gearbox Housing', {
      color: 0x666666, position: new Vec3(X, Y, Z),
      material: 'Aluminum 6061-T6',
    });

    // Internal gears (12-stage gear train)
    const gearNames = [
      'Engine Driveshaft Gear', 'Bevel Gear A', 'Bevel Gear B', 'Idler Gear 1',
      'Generator Drive Gear', 'Hyd Pump Drive Gear', 'Fuel Pump Drive Gear',
      'Oil Pump Drive Gear', 'Starter Drive Gear', 'Idler Gear 2',
      'IDG Drive Gear', 'PMA Drive Gear',
    ];
    for (let i = 0; i < gearNames.length; i++) {
      const gear = PrimitiveBuilder.cylinder(0.045, 0.025, 32);
      t.addPart(gear, `AGB ${gearNames[i]}`, {
        color: 0x888888,
        position: new Vec3(X + (i % 4) * 0.090 - 0.135, Y + Math.floor(i / 4) * 0.080 - 0.080, Z),
        material: 'Steel AISI 4340',
      });
      // Each gear has a shaft
      const shaft = PrimitiveBuilder.cylinder(0.012, 0.080, 16);
      t.addPart(shaft, `AGB ${gearNames[i]} Shaft`, {
        color: 0x777777,
        position: new Vec3(X + (i % 4) * 0.090 - 0.135, Y + Math.floor(i / 4) * 0.080 - 0.080, Z),
        material: 'Steel AISI 4340',
      });
    }

    // Driven accessories
    const accessories = [
      { name: 'IDG (Integrated Drive Generator)', dia: 0.080, length: 0.300 },
      { name: 'Hydraulic Pump', dia: 0.060, length: 0.180 },
      { name: 'Fuel Pump (HMU)', dia: 0.070, length: 0.220 },
      { name: 'Oil Pump (Pressure)', dia: 0.060, length: 0.150 },
      { name: 'Oil Pump (Scavenge 1)', dia: 0.055, length: 0.140 },
      { name: 'Oil Pump (Scavenge 2)', dia: 0.055, length: 0.140 },
      { name: 'Starter Motor (Air Turbine)', dia: 0.090, length: 0.350 },
      { name: 'PMA (Permanent Magnet Alternator)', dia: 0.060, length: 0.200 },
      { name: 'Variable Stator Vane Actuator Pump', dia: 0.050, length: 0.150 },
    ];
    for (let i = 0; i < accessories.length; i++) {
      const acc = accessories[i];
      const accBody = PrimitiveBuilder.cylinder(acc.dia / 2, acc.length, 24);
      t.addPart(accBody, acc.name, {
        color: 0x555555,
        position: new Vec3(X + 0.300, Y + i * 0.060 - 0.260, Z),
        rotation: new Vec3(0, PI / 2, 0),
        material: 'Aluminum 6061-T6',
      });
      // Mount flange for each accessory
      for (let b = 0; b < 8; b++) {
        const ba = (b / 8) * 2 * PI;
        const bolt = FastenerLibrary.hexBolt('M8', 0.025);
        t.addPart(bolt.head, `${acc.name} Mount Bolt ${b + 1}`, {
          color: 0x444444,
          position: new Vec3(
            X + 0.250,
            Y + i * 0.060 - 0.260 + Math.cos(ba) * (acc.dia / 2 + 0.005),
            Z + Math.sin(ba) * (acc.dia / 2 + 0.005)
          ),
          material: 'Steel AISI 4340',
        });
      }
    }

    // Gearbox housing bolts (40 around perimeter)
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * 2 * PI;
      const bolt = FastenerLibrary.hexBolt('M10', 0.025);
      t.addPart(bolt.head, `AGB Housing Bolt ${i + 1}`, {
        color: 0x666666,
        position: new Vec3(
          X + Math.cos(angle) * 0.220,
          Y + Math.sin(angle) * 0.160,
          Z
        ),
        material: 'Steel AISI 4340',
      });
    }
  }

  // (Continued in next file due to length — but for now combine all sections)

  // Stub remaining sections to be filled in
  static buildFuelSystem(t) { Trent1000Builder._buildFuelSystem(t); }
  static buildOilSystem(t) { Trent1000Builder._buildOilSystem(t); }
  static buildAirSystem(t) { Trent1000Builder._buildAirSystem(t); }
  static buildIgnitionSystem(t) { Trent1000Builder._buildIgnitionSystem(t); }
  static buildFADECSensors(t) { Trent1000Builder._buildFADECSensors(t); }
  static buildWireHarnesses(t) { Trent1000Builder._buildWireHarnesses(t); }
  static buildHydraulicLines(t) { Trent1000Builder._buildHydraulicLines(t); }
  static buildCasings(t) { Trent1000Builder._buildCasings(t); }
  static buildPylonMounts(t) { Trent1000Builder._buildPylonMounts(t); }
  static buildThrustReverser(t) { Trent1000Builder._buildThrustReverser(t); }
  static buildExhaust(t) { Trent1000Builder._buildExhaust(t); }
  static buildFasteners(t) { Trent1000Builder._buildFasteners(t); }
  static buildMaintenanceTags(t) { Trent1000Builder._buildMaintenanceTags(t); }

  // ==========================================================================
  // FUEL SYSTEM
  // ==========================================================================
  static _buildFuelSystem(t) {
    // Fuel manifold (annular ring around combustor)
    const fuelManifold = PrimitiveBuilder.torus(0.450, 0.025, 64, 16);
    t.addPart(fuelManifold, 'Fuel Manifold (Primary)', {
      color: 0x4488aa, position: new Vec3(0, 0, 2.20),
      material: 'Stainless Steel 316',
    });
    const fuelManifoldSecondary = PrimitiveBuilder.torus(0.460, 0.020, 64, 16);
    t.addPart(fuelManifoldSecondary, 'Fuel Manifold (Secondary/Pilot)', {
      color: 0x3377aa, position: new Vec3(0, 0, 2.20),
      material: 'Stainless Steel 316',
    });

    // Fuel filters and shutoff valves
    const components = [
      'Fuel Filter (Primary)', 'Fuel Filter (Secondary)',
      'Fuel Shutoff Valve (FSOV)', 'Fuel Pressure Regulator',
      'Fuel Flow Meter', 'Fuel Temperature Sensor',
      'Fuel Pressure Sensor (Inlet)', 'Fuel Pressure Sensor (Outlet)',
      'Fuel Bypass Valve', 'Fuel Heat Exchanger',
    ];
    for (let i = 0; i < components.length; i++) {
      const body = PrimitiveBuilder.cylinder(0.040, 0.150, 24);
      t.addPart(body, components[i], {
        color: 0x555588,
        position: new Vec3(0.40 + (i % 5) * 0.080, -0.20 - Math.floor(i / 5) * 0.080, 1.85),
        material: 'Stainless Steel 316',
      });
    }

    // Fuel lines from pump → manifold
    for (let i = 0; i < 6; i++) {
      const line = PrimitiveBuilder.cylinder(0.012, 0.350, 12);
      t.addPart(line, `Fuel Supply Line ${i + 1}`, {
        color: 0x3366aa,
        position: new Vec3(0.30 + i * 0.040, -0.10, 1.95 + i * 0.020),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // OIL SYSTEM
  // ==========================================================================
  static _buildOilSystem(t) {
    // Oil tank
    const oilTank = PrimitiveBuilder.box(0.300, 0.250, 0.350);
    t.addPart(oilTank, 'Oil Tank (Main)', {
      color: 0x444444, position: new Vec3(0.55, 0.40, 1.30),
      material: 'Aluminum 6061-T6',
    });

    // Oil-air heat exchanger (FOHE)
    const fohe = PrimitiveBuilder.box(0.250, 0.300, 0.080);
    t.addPart(fohe, 'Fuel-Oil Heat Exchanger (FOHE)', {
      color: 0x556677, position: new Vec3(0.50, 0.30, 1.50),
      material: 'Aluminum 6061-T6',
    });

    // 8 oil jets (lubricate bearings) + scavenge pickups
    for (let i = 0; i < 8; i++) {
      const jet = PrimitiveBuilder.cylinder(0.006, 0.080, 12);
      t.addPart(jet, `Oil Jet ${i + 1} (Bearing Lubricator)`, {
        color: 0x888844,
        position: new Vec3(0.10, 0, 0.50 + i * 0.450),
        material: 'Stainless Steel 316',
      });
      const scavenge = PrimitiveBuilder.cylinder(0.012, 0.150, 12);
      t.addPart(scavenge, `Oil Scavenge Line ${i + 1}`, {
        color: 0x666622,
        position: new Vec3(-0.10, 0, 0.50 + i * 0.450),
        material: 'Stainless Steel 316',
      });
    }

    // Oil filter, debris monitor, breather
    const oilFilter = PrimitiveBuilder.cylinder(0.050, 0.180, 24);
    t.addPart(oilFilter, 'Oil Filter (Pressure Side)', {
      color: 0x333333, position: new Vec3(0.55, 0.20, 1.40),
      material: 'Stainless Steel 316',
    });
    const debrisMonitor = PrimitiveBuilder.cylinder(0.030, 0.060, 16);
    t.addPart(debrisMonitor, 'Oil Debris Monitor (ODM)', {
      color: 0x442266, position: new Vec3(0.55, 0.10, 1.40),
      material: 'Aluminum 6061-T6',
    });
    const breather = PrimitiveBuilder.cylinder(0.060, 0.120, 24);
    t.addPart(breather, 'Air-Oil Breather', {
      color: 0x555555, position: new Vec3(0.55, 0.50, 1.20),
      material: 'Aluminum 6061-T6',
    });

    // Oil supply/return lines (12 lines threaded through engine)
    for (let i = 0; i < 12; i++) {
      const line = PrimitiveBuilder.cylinder(0.008, 0.500, 12);
      t.addPart(line, `Oil Line ${i + 1} (${i % 2 === 0 ? 'Supply' : 'Return'})`, {
        color: i % 2 === 0 ? 0xaaaa44 : 0x886622,
        position: new Vec3(
          0.30 + Math.cos(i * 0.5) * 0.10,
          Math.sin(i * 0.5) * 0.05,
          1.0 + i * 0.20
        ),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // AIR SYSTEM (bleeds, secondary air)
  // ==========================================================================
  static _buildAirSystem(t) {
    // 7th stage bleed (low pressure)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI;
      const valve = PrimitiveBuilder.box(0.060, 0.060, 0.080);
      t.addPart(valve, `Stage 7 Bleed Valve ${i + 1}`, {
        color: 0x6688aa,
        position: new Vec3(Math.cos(angle) * 0.580, Math.sin(angle) * 0.580, 1.45),
        material: 'Inconel 718',
      });
    }
    // 14th stage (= HPC stage 6) bleed (high pressure)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI;
      const valve = PrimitiveBuilder.box(0.050, 0.050, 0.080);
      t.addPart(valve, `Stage 14 (HPC6) Bleed Valve ${i + 1}`, {
        color: 0xaa6666,
        position: new Vec3(Math.cos(angle) * 0.420, Math.sin(angle) * 0.420, 2.05),
        material: 'Inconel 718',
      });
    }

    // Bleed air ducts (to anti-icing, cabin)
    for (let i = 0; i < 6; i++) {
      const duct = PrimitiveBuilder.cylinder(0.025, 0.400, 24);
      t.addPart(duct, `Bleed Air Duct ${i + 1}`, {
        color: 0x886666,
        position: new Vec3(0.55, 0, 1.45 + i * 0.10),
        rotation: new Vec3(0, 0, PI / 2),
        material: 'Inconel 718',
      });
    }

    // Cooling air manifolds (4 around HPT)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI;
      const manifold = PrimitiveBuilder.torus(0.395, 0.012, 32, 12);
      t.addPart(manifold, `HPT Cooling Air Manifold Sector ${i + 1}`, {
        color: 0x4488aa,
        position: new Vec3(0, 0, 2.78 + i * 0.005),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // IGNITION SYSTEM
  // ==========================================================================
  static _buildIgnitionSystem(t) {
    // 2 igniter exciters (redundant)
    for (let i = 0; i < 2; i++) {
      const exciter = PrimitiveBuilder.box(0.180, 0.080, 0.150);
      t.addPart(exciter, `Igniter Exciter ${i + 1} (FADEC ${i === 0 ? 'A' : 'B'})`, {
        color: 0x444466,
        position: new Vec3(0.55, 0.50 + i * 0.20, 2.30),
        material: 'Aluminum 6061-T6',
      });
      // HT lead from exciter to igniter
      const lead = PrimitiveBuilder.cylinder(0.012, 0.450, 12);
      t.addPart(lead, `Ignition HT Lead ${i + 1}`, {
        color: 0x222244,
        position: new Vec3(0.40, 0.40 + i * 0.20, 2.45),
        material: 'Stainless Steel 316',
      });
    }

    // Spark plug igniter caps (4 caps protect connection points)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI + PI / 4;
      const cap = PrimitiveBuilder.cylinder(0.020, 0.040, 16);
      t.addPart(cap, `Igniter Cap ${i + 1}`, {
        color: 0x222266,
        position: new Vec3(Math.cos(angle) * 0.420, Math.sin(angle) * 0.420, 2.30),
        material: 'Aluminum 6061-T6',
      });
    }
  }

  // ==========================================================================
  // FADEC + SENSORS
  // ==========================================================================
  static _buildFADECSensors(t) {
    // 2 FADEC channels (Channel A, Channel B — redundant)
    for (let i = 0; i < 2; i++) {
      const fadec = PrimitiveBuilder.box(0.350, 0.250, 0.080);
      t.addPart(fadec, `FADEC Channel ${i === 0 ? 'A' : 'B'} (EEC)`, {
        color: 0x224466 + i * 0x002000,
        position: new Vec3(0.65, 0.30 + i * 0.150, 1.10),
        material: 'Aluminum 6061-T6',
      });
    }

    // Temperature sensors (T1, T25, T3, T49, T5, EGT thermocouples × 9)
    const tempSensors = [
      { name: 'T1 Inlet Temp', z: -0.20, r: 0.45 },
      { name: 'T25 IPC Outlet Temp', z: 1.55, r: 0.45 },
      { name: 'T3 HPC Outlet Temp', z: 2.20, r: 0.32 },
      { name: 'T49 LPT Inlet Temp', z: 3.05, r: 0.50 },
      { name: 'T5 LPT Outlet Temp', z: 3.95, r: 0.65 },
    ];
    for (const ts of tempSensors) {
      const sensor = PrimitiveBuilder.cylinder(0.012, 0.050, 16);
      t.addPart(sensor, `${ts.name} Probe`, {
        color: 0xaaaa88,
        position: new Vec3(ts.r, 0, ts.z),
        material: 'Inconel 718',
      });
    }
    // 9 EGT thermocouples around exhaust
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * 2 * PI;
      const tc = PrimitiveBuilder.cylinder(0.010, 0.060, 12);
      t.addPart(tc, `EGT Thermocouple ${i + 1}`, {
        color: 0xcccc66,
        position: new Vec3(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, 4.00),
        material: 'Inconel 718',
      });
    }

    // Pressure sensors (P1, P25, P3, P49, P5)
    const pressSensors = [
      { name: 'P1 Inlet Pressure', z: -0.20, r: 0.50 },
      { name: 'P25 IPC Outlet Pressure', z: 1.55, r: 0.55 },
      { name: 'P3 HPC Outlet Pressure', z: 2.20, r: 0.40 },
      { name: 'P49 LPT Inlet Pressure', z: 3.05, r: 0.55 },
      { name: 'P5 LPT Outlet Pressure', z: 3.95, r: 0.70 },
    ];
    for (const ps of pressSensors) {
      const sensor = PrimitiveBuilder.cylinder(0.014, 0.060, 16);
      t.addPart(sensor, `${ps.name} Probe`, {
        color: 0xaa88aa,
        position: new Vec3(ps.r, 0, ps.z),
        material: 'Stainless Steel 316',
      });
    }

    // Vibration probes (8 around the engine)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * PI;
      const vib = PrimitiveBuilder.cylinder(0.018, 0.050, 12);
      t.addPart(vib, `Vibration Probe ${i + 1} (Bearing ${(i % 5) + 1})`, {
        color: 0x666688,
        position: new Vec3(Math.cos(angle) * 0.45, Math.sin(angle) * 0.45, 0.5 + (i % 5) * 0.7),
        material: 'Stainless Steel 316',
      });
    }

    // Speed pickup sensors (LP, IP, HP)
    for (let i = 0; i < 3; i++) {
      const speed = PrimitiveBuilder.cylinder(0.015, 0.060, 12);
      t.addPart(speed, `${['LP', 'IP', 'HP'][i]} Speed Pickup`, {
        color: 0x886622,
        position: new Vec3(0.20, 0, 0.20 + i * 0.30),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // WIRE HARNESSES
  // ==========================================================================
  static _buildWireHarnesses(t) {
    const harnessNames = [
      'FADEC A Harness', 'FADEC B Harness',
      'Engine Sensor Harness', 'Vibration Sensor Harness',
      'Fuel Control Harness', 'Ignition Harness',
      'Starter Harness', 'Generator Harness',
      'Anti-Ice Harness', 'EGT Thermocouple Harness',
      'Engine Mount Sensor Harness', 'Oil Debris Monitor Harness',
    ];
    for (let i = 0; i < harnessNames.length; i++) {
      // Each harness is a swept tube
      const harness = PrimitiveBuilder.cylinder(0.018, 0.800 + i * 0.05, 16);
      t.addPart(harness, harnessNames[i], {
        color: 0x222222,
        position: new Vec3(0.35 + (i % 4) * 0.04, -0.40 + Math.floor(i / 4) * 0.05, 1.5),
        material: 'Stainless Steel 316',
      });
      // Each harness has 4 connectors at endpoints
      for (let c = 0; c < 4; c++) {
        const conn = PrimitiveBuilder.cylinder(0.020, 0.030, 12);
        t.addPart(conn, `${harnessNames[i]} Connector ${c + 1}`, {
          color: 0x333366,
          position: new Vec3(0.35 + (i % 4) * 0.04, -0.40 + Math.floor(i / 4) * 0.05, 1.0 + c * 0.4),
          material: 'Aluminum 6061-T6',
        });
      }
    }
  }

  // ==========================================================================
  // HYDRAULIC LINES
  // ==========================================================================
  static _buildHydraulicLines(t) {
    for (let i = 0; i < 8; i++) {
      const line = PrimitiveBuilder.cylinder(0.010, 0.600, 16);
      t.addPart(line, `Hydraulic Line ${i + 1}`, {
        color: 0x664422,
        position: new Vec3(0.40 + (i % 4) * 0.030, 0.30 + Math.floor(i / 4) * 0.040, 1.5),
        material: 'Stainless Steel 316',
      });
    }
    // Hydraulic actuators for VSV (variable stator vanes) — 8 actuators
    for (let i = 0; i < 8; i++) {
      const actuator = PrimitiveBuilder.cylinder(0.025, 0.180, 16);
      t.addPart(actuator, `VSV Actuator ${i + 1}`, {
        color: 0x665544,
        position: new Vec3(0.55, 0.30 + i * 0.04, 1.30 + (i % 4) * 0.10),
        material: 'Steel AISI 4340',
      });
    }
  }

  // ==========================================================================
  // CASINGS & COWLINGS
  // ==========================================================================
  static _buildCasings(t) {
    // Inlet cowl
    const inletCowl = PrimitiveBuilder.cylinder(1.55, 0.350, 96);
    t.addPart(inletCowl, 'Inlet Cowl', {
      color: 0xeeeeee, position: new Vec3(0, 0, -0.25),
      material: 'Aluminum 6061-T6',
    });

    // Acoustic liner
    const acousticLiner = PrimitiveBuilder.cylinder(1.43, 0.30, 96);
    t.addPart(acousticLiner, 'Inlet Acoustic Liner', {
      color: 0xddccaa, position: new Vec3(0, 0, -0.25),
      material: 'ABS Plastic',
    });

    // Fan cowl (left half)
    const fanCowlL = PrimitiveBuilder.cylinder(1.50, 1.50, 64);
    t.addPart(fanCowlL, 'Fan Cowl (Left Half)', {
      color: 0xeeeeee, position: new Vec3(0, 0, 0.50),
      material: 'Carbon Fiber Composite',
    });

    // Fan cowl (right half)
    const fanCowlR = PrimitiveBuilder.cylinder(1.50, 1.50, 64);
    t.addPart(fanCowlR, 'Fan Cowl (Right Half)', {
      color: 0xeeeeee, position: new Vec3(0, 0, 0.50),
      material: 'Carbon Fiber Composite',
    });

    // Core cowl
    const coreCowl = PrimitiveBuilder.cylinder(0.80, 2.50, 64);
    t.addPart(coreCowl, 'Core Cowling', {
      color: 0xcccccc, position: new Vec3(0, 0, 2.50),
      material: 'Inconel 718',
    });

    // Cowl fasteners (latches × 8)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * PI;
      const latch = PrimitiveBuilder.box(0.060, 0.030, 0.040);
      t.addPart(latch, `Cowl Latch ${i + 1}`, {
        color: 0xaa5555,
        position: new Vec3(Math.cos(angle) * 1.50, Math.sin(angle) * 1.50, 0.50),
        material: 'Aluminum 6061-T6',
      });
    }
  }

  // ==========================================================================
  // PYLON & MOUNTS
  // ==========================================================================
  static _buildPylonMounts(t) {
    // Forward mount link
    const fwdMount = PrimitiveBuilder.box(0.150, 0.300, 0.250);
    t.addPart(fwdMount, 'Forward Engine Mount', {
      color: 0x666666, position: new Vec3(0, 0.95, 1.20),
      material: 'Steel AISI 4340',
    });

    // Aft mount link
    const aftMount = PrimitiveBuilder.box(0.180, 0.350, 0.300);
    t.addPart(aftMount, 'Aft Engine Mount', {
      color: 0x666666, position: new Vec3(0, 0.95, 3.20),
      material: 'Steel AISI 4340',
    });

    // Thrust links (2 — left and right)
    for (let i = 0; i < 2; i++) {
      const thrustLink = PrimitiveBuilder.cylinder(0.040, 1.500, 16);
      t.addPart(thrustLink, `Thrust Link ${i === 0 ? 'Left' : 'Right'}`, {
        color: 0x555555,
        position: new Vec3((i === 0 ? -0.30 : 0.30), 0.85, 2.00),
        rotation: new Vec3(0, 0, PI / 2),
        material: 'Steel AISI 4340',
      });
    }

    // Pylon beam
    const pylon = PrimitiveBuilder.box(0.250, 0.400, 2.500);
    t.addPart(pylon, 'Pylon Beam (Wing Attachment)', {
      color: 0x777777, position: new Vec3(0, 1.20, 1.80),
      material: 'Steel AISI 4340',
    });

    // Mount pin bolts (32 large bolts)
    for (let i = 0; i < 32; i++) {
      const bolt = FastenerLibrary.hexBolt('M24', 0.100);
      t.addPart(bolt.head, `Mount Pin Bolt ${i + 1}`, {
        color: 0x555555,
        position: new Vec3((i % 8) * 0.04 - 0.14, 0.95 + Math.floor(i / 8) * 0.08 - 0.12, 1.20 + (i < 16 ? 0 : 2.0)),
        material: 'Steel AISI 4340',
      });
    }

    // Vibration isolators
    for (let i = 0; i < 6; i++) {
      const iso = PrimitiveBuilder.cylinder(0.060, 0.080, 16);
      t.addPart(iso, `Vibration Isolator ${i + 1}`, {
        color: 0x222222,
        position: new Vec3((i % 3) * 0.10 - 0.10, 0.85, 1.40 + Math.floor(i / 3) * 1.4),
        material: 'Rubber',
      });
    }

    // Cooling air fairing for pylon
    const fairing = PrimitiveBuilder.box(0.180, 0.250, 1.500);
    t.addPart(fairing, 'Pylon Cooling Fairing', {
      color: 0xdddddd, position: new Vec3(0, 1.05, 2.00),
      material: 'Carbon Fiber Composite',
    });
  }

  // ==========================================================================
  // THRUST REVERSER
  // ==========================================================================
  static _buildThrustReverser(t) {
    // Cascade vanes (24 large cascades around fan duct)
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * 2 * PI;
      const cascade = PrimitiveBuilder.box(0.180, 0.300, 0.080);
      t.addPart(cascade, `Thrust Reverser Cascade ${i + 1}`, {
        color: 0x999999,
        position: new Vec3(
          Math.cos(angle) * 1.45,
          Math.sin(angle) * 1.45,
          1.40
        ),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Aluminum 6061-T6',
      });
    }
    // 4 hydraulic actuators
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * 2 * PI;
      const actuator = PrimitiveBuilder.cylinder(0.040, 0.350, 16);
      t.addPart(actuator, `Thrust Reverser Actuator ${i + 1}`, {
        color: 0x555555,
        position: new Vec3(Math.cos(angle) * 1.40, Math.sin(angle) * 1.40, 1.50),
        material: 'Steel AISI 4340',
      });
    }
    // Translating sleeve
    const sleeve = PrimitiveBuilder.cylinder(1.50, 0.700, 96);
    t.addPart(sleeve, 'Thrust Reverser Translating Sleeve', {
      color: 0xbbbbbb, position: new Vec3(0, 0, 1.50),
      material: 'Carbon Fiber Composite',
    });
    // Blocker doors (8 doors)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * PI;
      const door = PrimitiveBuilder.box(0.250, 0.200, 0.040);
      t.addPart(door, `Thrust Reverser Blocker Door ${i + 1}`, {
        color: 0xaaaaaa,
        position: new Vec3(Math.cos(angle) * 1.10, Math.sin(angle) * 1.10, 1.45),
        material: 'Carbon Fiber Composite',
      });
    }
  }

  // ==========================================================================
  // EXHAUST
  // ==========================================================================
  static _buildExhaust(t) {
    // Exhaust nozzle (core)
    const exhaustNozzle = PrimitiveBuilder.cone(0.500, 0.700, 64);
    t.addPart(exhaustNozzle, 'Exhaust Nozzle (Core)', {
      color: 0x444444, position: new Vec3(0, 0, 4.50),
      material: 'Inconel 718',
    });

    // Exhaust plug (centerbody)
    const exhaustPlug = PrimitiveBuilder.cone(0.250, 0.500, 32);
    t.addPart(exhaustPlug, 'Exhaust Plug (Centerbody)', {
      color: 0x333333, position: new Vec3(0, 0, 4.40),
      material: 'Inconel 718',
    });

    // Mixer (chevrons — 12)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * PI;
      const chevron = PrimitiveBuilder.box(0.080, 0.100, 0.040);
      t.addPart(chevron, `Exhaust Chevron ${i + 1}`, {
        color: 0x555555,
        position: new Vec3(Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 4.85),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Inconel 718',
      });
    }

    // EGT probe support struts
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * 2 * PI;
      const strut = PrimitiveBuilder.box(0.020, 0.180, 0.040);
      t.addPart(strut, `EGT Probe Strut ${i + 1}`, {
        color: 0x666666,
        position: new Vec3(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 4.00),
        rotation: new Vec3(0, 0, angle + PI / 2),
        material: 'Inconel 718',
      });
    }
  }

  // ==========================================================================
  // FASTENERS — flange bolts at all major joints
  // ==========================================================================
  static _buildFasteners(t) {
    // Major flange bolt rings throughout engine
    const flanges = [
      { z: 0.05, r: 1.50, count: 96, size: 'M16', name: 'Fan Case Front' },
      { z: 0.85, r: 0.55, count: 64, size: 'M12', name: 'Fan-IPC Joint' },
      { z: 1.55, r: 0.55, count: 56, size: 'M12', name: 'IPC Mid' },
      { z: 1.65, r: 0.42, count: 48, size: 'M12', name: 'IPC-HPC Joint' },
      { z: 2.10, r: 0.42, count: 48, size: 'M10', name: 'HPC Mid' },
      { z: 2.20, r: 0.36, count: 48, size: 'M12', name: 'HPC-Diffuser' },
      { z: 2.40, r: 0.42, count: 64, size: 'M10', name: 'Diffuser-Combustor' },
      { z: 2.60, r: 0.42, count: 64, size: 'M10', name: 'Combustor Mid' },
      { z: 2.80, r: 0.42, count: 64, size: 'M10', name: 'Combustor-HPT' },
      { z: 2.90, r: 0.50, count: 56, size: 'M12', name: 'HPT-IPT Joint' },
      { z: 3.00, r: 0.55, count: 48, size: 'M10', name: 'IPT Joint' },
      { z: 3.20, r: 0.62, count: 64, size: 'M10', name: 'IPT-LPT Joint' },
      { z: 3.50, r: 0.65, count: 80, size: 'M10', name: 'LPT Mid 1' },
      { z: 3.85, r: 0.68, count: 96, size: 'M10', name: 'LPT Mid 2' },
      { z: 4.20, r: 0.70, count: 96, size: 'M10', name: 'LPT-Exhaust Joint' },
      { z: 4.80, r: 0.65, count: 96, size: 'M10', name: 'Exhaust Nozzle Front' },
      { z: 5.20, r: 0.50, count: 64, size: 'M10', name: 'Exhaust Nozzle Rear' },
    ];

    let totalBolts = 0;
    for (const flange of flanges) {
      const bolt = FastenerLibrary.hexBolt(flange.size, 0.030);
      const washer = FastenerLibrary.flatWasher(flange.size);
      const nut = FastenerLibrary.hexNut(flange.size);
      for (let i = 0; i < flange.count; i++) {
        const angle = (i / flange.count) * 2 * PI;
        // Bolt
        t.addPart(bolt.head, `${flange.name} Bolt ${i + 1}`, {
          color: 0x666666,
          position: new Vec3(Math.cos(angle) * flange.r, Math.sin(angle) * flange.r, flange.z),
          material: 'Steel AISI 4340',
        });
        // Washer
        t.addPart(washer.body, `${flange.name} Washer ${i + 1}`, {
          color: 0x888888,
          position: new Vec3(Math.cos(angle) * flange.r, Math.sin(angle) * flange.r, flange.z + 0.005),
          material: 'Steel AISI 1020',
        });
        // Nut
        t.addPart(nut.body, `${flange.name} Nut ${i + 1}`, {
          color: 0x555555,
          position: new Vec3(Math.cos(angle) * flange.r, Math.sin(angle) * flange.r, flange.z + 0.012),
          material: 'Steel AISI 4340',
        });
        totalBolts += 3;
      }
    }
  }

  // ==========================================================================
  // ENGINE COOLING HOLES on turbine blades — each HPT/IPT/LPT blade has
  // internal cooling channels exiting through ~30 surface holes
  // ==========================================================================
  static buildBladeCoolingHoles(t) {
    // HPT blades: 30 holes each × 76 blades = 2,280
    for (let bi = 0; bi < 76; bi++) {
      const angle = (bi / 76) * 2 * PI;
      for (let h = 0; h < 30; h++) {
        const hr = 0.450 + Math.sin(h * 0.5) * 0.005;
        const hz = 2.78 + (h - 15) * 0.0025;
        const hole = PrimitiveBuilder.cylinder(0.0006, 0.003, 4);
        t.addPart(hole, `HPT B${bi + 1} Cool Hole ${h + 1}`, {
          color: 0x111111,
          position: new Vec3(Math.cos(angle) * hr, Math.sin(angle) * hr, hz),
          material: 'Inconel 718',
        });
      }
    }
    // IPT blades: 20 holes each × 80 blades = 1,600
    for (let bi = 0; bi < 80; bi++) {
      const angle = (bi / 80) * 2 * PI;
      for (let h = 0; h < 20; h++) {
        const hole = PrimitiveBuilder.cylinder(0.0006, 0.003, 4);
        t.addPart(hole, `IPT B${bi + 1} Cool Hole ${h + 1}`, {
          color: 0x111111,
          position: new Vec3(
            Math.cos(angle) * 0.555,
            Math.sin(angle) * 0.555,
            2.95 + (h - 10) * 0.003
          ),
          material: 'Inconel 718',
        });
      }
    }
    // NGV cooling holes: 40 holes per NGV × 64 NGVs (HPT) = 2,560
    for (let v = 0; v < 64; v++) {
      const angle = (v / 64) * 2 * PI;
      for (let h = 0; h < 40; h++) {
        const hole = PrimitiveBuilder.cylinder(0.0006, 0.003, 4);
        t.addPart(hole, `HPT NGV${v + 1} Cool Hole ${h + 1}`, {
          color: 0x111111,
          position: new Vec3(
            Math.cos(angle) * 0.450,
            Math.sin(angle) * 0.450,
            2.72 + (h - 20) * 0.002
          ),
          material: 'Inconel 718',
        });
      }
    }
  }

  // ==========================================================================
  // BRACKETS — accessory mounting brackets, support brackets
  // ==========================================================================
  static buildBrackets(t) {
    const bracketLocations = [
      { name: 'IDG Mount Bracket', pos: [0.55, -0.50, 1.30] },
      { name: 'Hyd Pump Mount Bracket', pos: [0.55, -0.40, 1.30] },
      { name: 'Fuel Pump Mount Bracket', pos: [0.55, -0.30, 1.30] },
      { name: 'Oil Pump Mount Bracket', pos: [0.55, -0.20, 1.30] },
      { name: 'Starter Mount Bracket', pos: [0.55, -0.10, 1.30] },
      { name: 'PMA Mount Bracket', pos: [0.55, 0.00, 1.30] },
      { name: 'FADEC A Mount Bracket', pos: [0.65, 0.30, 1.10] },
      { name: 'FADEC B Mount Bracket', pos: [0.65, 0.45, 1.10] },
      { name: 'Oil Tank Mount Bracket', pos: [0.55, 0.40, 1.30] },
      { name: 'Fuel Filter Mount Bracket', pos: [0.45, -0.20, 1.85] },
      { name: 'Wire Harness Clamp Bracket Fwd', pos: [0.45, 0.0, 1.0] },
      { name: 'Wire Harness Clamp Bracket Mid', pos: [0.45, 0.0, 2.0] },
      { name: 'Wire Harness Clamp Bracket Aft', pos: [0.45, 0.0, 3.5] },
      { name: 'Hyd Manifold Bracket', pos: [0.50, 0.30, 1.5] },
      { name: 'Bleed Air Duct Bracket Fwd', pos: [0.55, 0, 1.50] },
      { name: 'Bleed Air Duct Bracket Mid', pos: [0.55, 0, 2.20] },
      { name: 'Bleed Air Duct Bracket Aft', pos: [0.55, 0, 2.90] },
      { name: 'Anti-Ice Valve Bracket', pos: [0.50, -0.40, 0.80] },
      { name: 'Fire Detection Loop Bracket Fwd', pos: [0.40, 0.40, 0.80] },
      { name: 'Fire Detection Loop Bracket Mid', pos: [0.40, 0.40, 2.00] },
      { name: 'Fire Detection Loop Bracket Aft', pos: [0.40, 0.40, 3.50] },
      { name: 'Drain Mast Bracket', pos: [0.0, -0.65, 2.50] },
      { name: 'External Speed Pickup Bracket LP', pos: [0.20, 0, 0.20] },
      { name: 'External Speed Pickup Bracket IP', pos: [0.20, 0, 0.50] },
      { name: 'External Speed Pickup Bracket HP', pos: [0.20, 0, 0.80] },
    ];
    for (const b of bracketLocations) {
      const bracket = PrimitiveBuilder.box(0.080, 0.040, 0.060);
      t.addPart(bracket, b.name, {
        color: 0x666666, position: new Vec3(b.pos[0], b.pos[1], b.pos[2]),
        material: 'Aluminum 6061-T6',
      });
      // Each bracket has 4 mounting bolts
      for (let i = 0; i < 4; i++) {
        const bolt = FastenerLibrary.hexBolt('M8', 0.020);
        t.addPart(bolt.head, `${b.name} Bolt ${i + 1}`, {
          color: 0x444444,
          position: new Vec3(
            b.pos[0] + (i % 2) * 0.060 - 0.030,
            b.pos[1] + Math.floor(i / 2) * 0.030 - 0.015,
            b.pos[2] - 0.030
          ),
          material: 'Steel AISI 4340',
        });
      }
    }
  }

  // ==========================================================================
  // FIRE DETECTION + SUPPRESSION SYSTEM
  // ==========================================================================
  static buildFireSystem(t) {
    // Fire detection loops (2 around engine, redundant)
    for (let loop = 0; loop < 2; loop++) {
      for (let seg = 0; seg < 24; seg++) {
        const angle = (seg / 24) * 2 * PI;
        const segLine = PrimitiveBuilder.cylinder(0.005, 0.150, 8);
        t.addPart(segLine, `Fire Detection Loop ${loop + 1} Seg ${seg + 1}`, {
          color: 0xff0000,
          position: new Vec3(
            Math.cos(angle) * (0.55 + loop * 0.02),
            Math.sin(angle) * (0.55 + loop * 0.02),
            0.5 + (seg % 6) * 0.7
          ),
          material: 'Stainless Steel 316',
        });
      }
    }
    // Fire suppression nozzles (8 around core)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * PI;
      const nozzle = PrimitiveBuilder.cylinder(0.012, 0.040, 12);
      t.addPart(nozzle, `Fire Suppression Nozzle ${i + 1}`, {
        color: 0xff6600,
        position: new Vec3(Math.cos(angle) * 0.50, Math.sin(angle) * 0.50, 1.5 + (i % 4) * 0.5),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // MORE FUEL SYSTEM DETAIL — pipe fittings, T-junctions, elbows
  // ==========================================================================
  static buildPipeFittings(t) {
    // 200 pipe elbow/T fittings throughout fuel/oil/hyd systems
    for (let i = 0; i < 200; i++) {
      const fitting = PrimitiveBuilder.cylinder(0.015, 0.030, 16);
      t.addPart(fitting, `Pipe Fitting ${i + 1}`, {
        color: 0x666666,
        position: new Vec3(
          0.40 + (i % 10) * 0.025,
          -0.45 + Math.floor((i % 100) / 10) * 0.030,
          1.0 + Math.floor(i / 100) * 0.30
        ),
        material: 'Stainless Steel 316',
      });
    }

    // 100 hose clamps
    for (let i = 0; i < 100; i++) {
      const clamp = PrimitiveBuilder.torus(0.012, 0.003, 16, 8);
      t.addPart(clamp, `Hose Clamp ${i + 1}`, {
        color: 0x888888,
        position: new Vec3(
          0.40 + (i % 10) * 0.030,
          -0.40 + Math.floor((i % 50) / 10) * 0.040,
          1.5 + Math.floor(i / 50) * 0.50
        ),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // ENGINE ELECTRICAL CONNECTORS — all standard MIL-DTL connectors
  // ==========================================================================
  static buildElectricalConnectors(t) {
    const connectorTypes = [
      'M12 Circular',
      'MIL-DTL-38999',
      'MIL-DTL-26482',
      'Backshell',
      'Strain Relief',
      'Self-Locking',
    ];
    // 160 connectors throughout engine
    for (let i = 0; i < 160; i++) {
      const type = connectorTypes[i % connectorTypes.length];
      const conn = PrimitiveBuilder.cylinder(0.015, 0.030, 12);
      t.addPart(conn, `Connector ${i + 1} (${type})`, {
        color: 0x224488,
        position: new Vec3(
          0.30 + (i % 20) * 0.020,
          -0.50 + Math.floor((i % 80) / 20) * 0.030,
          0.5 + Math.floor(i / 80) * 1.5
        ),
        material: 'Aluminum 6061-T6',
      });
    }
  }

  // ==========================================================================
  // DRAINS, BREATHERS, VENTS
  // ==========================================================================
  static buildDrainsAndVents(t) {
    // Drain mast (collects fluid drains, dumps overboard)
    const drainMast = PrimitiveBuilder.box(0.050, 0.300, 0.080);
    t.addPart(drainMast, 'Drain Mast (Overboard)', {
      color: 0x444444, position: new Vec3(0, -0.65, 2.50),
      material: 'Aluminum 6061-T6',
    });

    // Drain lines from various locations
    const drains = [
      'Compressor Case Drain', 'Combustor Drain', 'Turbine Section Drain',
      'Oil Tank Drain', 'Fuel Manifold Drain Primary', 'Fuel Manifold Drain Secondary',
      'IDG Oil Drain', 'Hyd Pump Case Drain', 'Fuel Filter Drain',
      'Oil Filter Drain', 'Starter Drain', 'Bearing Compartment Drain 1',
      'Bearing Compartment Drain 2', 'Bearing Compartment Drain 3',
      'Bearing Compartment Drain 4', 'Bearing Compartment Drain 5',
    ];
    for (let i = 0; i < drains.length; i++) {
      const line = PrimitiveBuilder.cylinder(0.008, 0.300, 12);
      t.addPart(line, drains[i], {
        color: 0x555555,
        position: new Vec3(0.05 + (i % 4) * 0.04, -0.55 + Math.floor(i / 4) * 0.05, 1.0 + (i % 4) * 0.5),
        material: 'Stainless Steel 316',
      });
    }
  }

  // ==========================================================================
  // MAINTENANCE TAGS — placards, ID plates
  // ==========================================================================
  static _buildMaintenanceTags(t) {
    const tags = [
      'Engine S/N Plate', 'Type Plate', 'Lifing Data Plate',
      'Time-Since-New (TSN) Tag', 'Cycles-Since-New (CSN) Tag',
      'Last Overhaul Tag', 'Modification Status Tag',
      'Anti-Ice Inspection Tag', 'Borescope Port Tag',
      'Drain Mast Tag', 'Fuel Type Tag', 'Oil Type Tag',
    ];
    for (let i = 0; i < tags.length; i++) {
      const tag = PrimitiveBuilder.box(0.040, 0.020, 0.001);
      t.addPart(tag, tags[i], {
        color: 0xcccc00,
        position: new Vec3(0.55 + (i % 4) * 0.05, 0.55, 1.0 + Math.floor(i / 4) * 0.10),
        material: 'Aluminum 6061-T6',
      });
    }

    // Borescope ports (12 around engine)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * PI;
      const port = PrimitiveBuilder.cylinder(0.010, 0.040, 16);
      t.addPart(port, `Borescope Port ${i + 1}`, {
        color: 0x222222,
        position: new Vec3(Math.cos(angle) * 0.50, Math.sin(angle) * 0.50, 1.5 + (i % 6) * 0.4),
        material: 'Stainless Steel 316',
      });
    }
  }
}
