/**
 * ArchDisc — Professional-Level Project: Cryogenic Turbopump Dynamic Seal
 *
 * Non-contact dynamic seal for a cryogenic LOX/RP-1 turbopump shaft
 * spinning at 30,000 RPM. Prevents oxygen-fuel mixing under extreme
 * pressure differential at cryogenic temperatures.
 *
 * Demonstrates: extreme-environment design, scalability, reliability,
 * regulatory compliance (ASME BPVC, AS9100), advanced sealing tech.
 *
 * Components: shaft, labyrinth seal stack, carbon-face seal, secondary
 * seal, thrust bearing, instrumentation, cryogenic insulation.
 *
 * Specs:
 *   Shaft speed:       30,000 RPM
 *   Shaft diameter:    50 mm at seal
 *   Working fluid 1:   LOX (-183 °C, 200 bar)
 *   Working fluid 2:   RP-1 (kerosene, ambient → cryo)
 *   Pressure differential: 250 bar across seal stack
 *   Allowable leakage: < 0.1 g/s (helium-equivalent)
 *   Service interval:  full-mission single-use, 5 min duration
 *   Material constraints: LOX-compatible (no copper-rich alloys)
 */

import { Assembly, PrimitiveBuilder, Vec3, PartIDRegistry } from '../kernel/index.js';

const SPECS = {
  rpm_max: 30000, shaftDia_m: 0.050,
  pressureDiff_bar: 250, fluidT_K: 90,
  leakage_max_gs: 0.1,
};
export { SPECS };

export default class TurbopumpSealBuilder {

  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    PartIDRegistry.setProject('TPSL');
    const seal = new Assembly('Cryogenic Turbopump Dynamic Seal Assembly');

    const sections = [
      ['Shaft Section',                  TurbopumpSealBuilder.buildShaft],
      ['Labyrinth Seal Stack',           TurbopumpSealBuilder.buildLabyrinth],
      ['Primary Carbon-Face Seal',       TurbopumpSealBuilder.buildCarbonSeal],
      ['Secondary Backup Seal',          TurbopumpSealBuilder.buildSecondarySeal],
      ['Thrust Bearing',                 TurbopumpSealBuilder.buildThrustBearing],
      ['Cryogenic Insulation',           TurbopumpSealBuilder.buildInsulation],
      ['Pressurization Buffer System',   TurbopumpSealBuilder.buildBufferSystem],
      ['Instrumentation',                TurbopumpSealBuilder.buildInstrumentation],
      ['Housing & Flanges',              TurbopumpSealBuilder.buildHousing],
      ['Fasteners (Inconel)',            TurbopumpSealBuilder.buildFasteners],
    ];
    for (const [name, fn] of sections) {
      const before = seal.partCount();
      fn(seal);
      onProgress(name, seal.partCount() - before, seal.partCount());
    }
    return seal;
  }

  static buildShaft(t) {
    // High-strength corrosion-resistant shaft (Inconel 718)
    const shaft = PrimitiveBuilder.cylinder(SPECS.shaftDia_m / 2, 0.300, 32);
    t.addPart(shaft, 'Turbopump Main Shaft (Inconel 718)', {
      color: 0xa89a86,
      material: 'Inconel 718',
      category: 'SHFT', subsystem: 'MAIN',
      metadata: { speed_rpm_max: 30000, temp_K: 90, balanced_grade: 'G0.4' },
    });
    // Shaft sleeve (replaceable wear surface)
    const sleeve = PrimitiveBuilder.cylinderShell(SPECS.shaftDia_m / 2 + 0.003, SPECS.shaftDia_m / 2, 0.080, 32);
    t.addPart(sleeve, 'Shaft Sleeve (Stellite hardfaced)', {
      color: 0xc0c0c8,
      material: 'Stainless Steel 316',
      category: 'SHFT', subsystem: 'SLV',
    });
  }

  static buildLabyrinth(t) {
    // 12-tooth labyrinth seal (knife-edge teeth on stator, smooth land on shaft)
    for (let tooth = 0; tooth < 12; tooth++) {
      const lab = PrimitiveBuilder.torus(SPECS.shaftDia_m / 2 + 0.0015, 0.0008, 32, 8);
      t.addPart(lab, `Labyrinth Tooth ${tooth + 1}`, {
        color: 0x808890,
        position: new Vec3(0, 0, -0.040 + tooth * 0.005),
        material: 'Inconel 718',
        category: 'SEAL', subsystem: 'LAB',
        metadata: { gap_um: 100, tooth_height_mm: 1.5 },
      });
    }
    // Labyrinth stator ring (carries the teeth)
    const labStator = PrimitiveBuilder.cylinderShell(0.040, 0.027, 0.060, 48);
    t.addPart(labStator, 'Labyrinth Stator Ring', {
      color: 0x6a7280,
      material: 'Inconel 718',
      category: 'SEAL', subsystem: 'LSR',
    });
  }

  static buildCarbonSeal(t) {
    // Primary mechanical face seal: carbon-graphite stator vs Stellite-coated rotor
    const carbonRing = PrimitiveBuilder.cylinderShell(0.038, 0.028, 0.012, 48);
    t.addPart(carbonRing, 'Primary Carbon-Graphite Seal Ring', {
      color: 0x101010,
      material: 'Carbon Fiber Composite',
      category: 'SEAL', subsystem: 'CFS',
      metadata: { grade: 'P5N (Pure Carbon)', flatness_um: 0.5, lapping_lambda: 3 },
    });
    // Hard-faced mating ring (rotates with shaft)
    const matingRing = PrimitiveBuilder.cylinderShell(0.038, 0.028, 0.008, 48);
    t.addPart(matingRing, 'Mating Ring (Stellite-coated Inconel)', {
      color: 0xb0b0b8,
      material: 'Inconel 718',
      category: 'SEAL', subsystem: 'MTR',
      metadata: { coating: 'Stellite 6 plasma spray, 0.5mm', flatness_um: 0.3 },
    });
    // Spring loading (8 wave springs for face load)
    for (let i = 0; i < 8; i++) {
      const spring = PrimitiveBuilder.torus(0.034, 0.0008, 16, 8);
      t.addPart(spring, `Face-Load Wave Spring ${i + 1}`, {
        color: 0x707080,
        material: 'Inconel 718',
        category: 'SEAL', subsystem: 'SPR',
      });
    }
    // Secondary o-ring (energizes the carbon ring)
    const oring = PrimitiveBuilder.torus(0.033, 0.0015, 32, 8);
    t.addPart(oring, 'Energizer O-Ring (Spring-Loaded PTFE)', {
      color: 0xfafafa,
      material: 'Nylon 6/6',
      category: 'SEAL', subsystem: 'EOR',
    });
  }

  static buildSecondarySeal(t) {
    // Backup labyrinth (second barrier in case primary fails)
    for (let i = 0; i < 6; i++) {
      const lab = PrimitiveBuilder.torus(SPECS.shaftDia_m / 2 + 0.0012, 0.0006, 32, 8);
      t.addPart(lab, `Secondary Labyrinth Tooth ${i + 1}`, {
        color: 0x808890,
        material: 'Inconel 718',
        category: 'SEAL', subsystem: 'SLB',
      });
    }
  }

  static buildThrustBearing(t) {
    // Cryogenic angular-contact thrust bearing (silicon nitride balls)
    const inner = PrimitiveBuilder.cylinderShell(0.030, 0.025, 0.012, 32);
    t.addPart(inner, 'Thrust Bearing Inner Race', {
      color: 0x909098,
      material: 'Inconel 718',
      category: 'BRG', subsystem: 'IRC',
    });
    const outer = PrimitiveBuilder.cylinderShell(0.040, 0.035, 0.012, 32);
    t.addPart(outer, 'Thrust Bearing Outer Race', {
      color: 0x909098,
      material: 'Inconel 718',
      category: 'BRG', subsystem: 'ORC',
    });
    // 16 silicon nitride balls
    for (let i = 0; i < 16; i++) {
      const ball = PrimitiveBuilder.sphere(0.0035, 12, 8);
      t.addPart(ball, `Si3N4 Bearing Ball ${i + 1}`, {
        color: 0x303030,
        material: 'CMC SiC/SiC',  // approximation for Si3N4
        category: 'BRG', subsystem: 'BAL',
        metadata: { material: 'Si3N4 ceramic', dia_mm: 7, ABEC: 7 },
      });
    }
    // Cage (PEEK retainer)
    const cage = PrimitiveBuilder.cylinderShell(0.032, 0.030, 0.010, 24);
    t.addPart(cage, 'Bearing Cage (PEEK retainer)', {
      color: 0xc0a040,
      material: 'Nylon 6/6',
      category: 'BRG', subsystem: 'CAG',
    });
  }

  static buildInsulation(t) {
    // Multi-layer insulation (MLI) — alternating Mylar + scrim
    for (let i = 0; i < 12; i++) {
      const layer = PrimitiveBuilder.cylinderShell(0.060 + i * 0.0005, 0.060 + i * 0.0005 - 0.0002, 0.080, 32);
      t.addPart(layer, `MLI Layer ${i + 1} (Mylar / scrim)`, {
        color: 0xc0c0a0,
        material: 'ABS Plastic',
        category: 'INSL', subsystem: 'MLI',
      });
    }
    // Vacuum-insulation jacket
    const jacket = PrimitiveBuilder.cylinderShell(0.080, 0.077, 0.090, 48);
    t.addPart(jacket, 'Vacuum Insulation Jacket', {
      color: 0xb0b0b8,
      material: 'Stainless Steel 316',
      category: 'INSL', subsystem: 'JKT',
    });
  }

  static buildBufferSystem(t) {
    // Helium purge system: prevents fuel-oxidizer mixing in seal cavity
    // Manifolds + check valves + pressure regulator
    const heMan = PrimitiveBuilder.cylinderShell(0.012, 0.010, 0.060, 16);
    t.addPart(heMan, 'Helium Purge Manifold', {
      color: 0xb0b0b8,
      material: 'Stainless Steel 316',
      category: 'BUF', subsystem: 'MAN',
    });
    for (let i = 0; i < 4; i++) {
      const cv = PrimitiveBuilder.cylinder(0.008, 0.020, 16);
      t.addPart(cv, `Helium Check Valve ${i + 1}`, {
        color: 0x707080,
        material: 'Stainless Steel 316',
        category: 'BUF', subsystem: 'CHV',
      });
    }
    const reg = PrimitiveBuilder.cylinder(0.020, 0.040, 24);
    t.addPart(reg, 'Helium Pressure Regulator', {
      color: 0x808080,
      material: 'Stainless Steel 316',
      category: 'BUF', subsystem: 'REG',
    });
  }

  static buildInstrumentation(t) {
    // Cryogenic pressure transducer
    const pt = PrimitiveBuilder.cylinder(0.012, 0.030, 16);
    t.addPart(pt, 'Cryogenic Pressure Transducer (Kulite XCS)', {
      color: 0x808088,
      material: 'Inconel 718',
      category: 'INST', subsystem: 'PT',
      metadata: { range_bar: '0-300', temp_K_min: 20 },
    });
    // PRT temperature sensor (cryogenic)
    const prt = PrimitiveBuilder.cylinder(0.002, 0.020, 8);
    t.addPart(prt, 'Cryogenic PRT Temperature Sensor (Lake Shore Cernox)', {
      color: 0xc0a060,
      material: 'Stainless Steel 316',
      category: 'INST', subsystem: 'PRT',
    });
    // Vibration sensor
    const accel = PrimitiveBuilder.box(0.012, 0.008, 0.012);
    t.addPart(accel, 'Cryogenic Accelerometer', {
      color: 0x404040,
      material: 'Stainless Steel 316',
      category: 'INST', subsystem: 'ACL',
    });
    // Speed sensor (encoder ring + Hall pickup)
    const encRing = PrimitiveBuilder.cylinderShell(0.025, 0.022, 0.005, 32);
    t.addPart(encRing, 'Speed Encoder Ring (60-tooth)', {
      color: 0x707080,
      material: 'Inconel 718',
      category: 'INST', subsystem: 'ENC',
    });
    const hall = PrimitiveBuilder.box(0.005, 0.002, 0.005);
    t.addPart(hall, 'Hall-Effect Speed Pickup', {
      color: 0x202020,
      material: 'ABS Plastic',
      category: 'INST', subsystem: 'HAL',
    });
    // Helium leak-detection mass-spec port
    const leakPort = PrimitiveBuilder.cylinder(0.008, 0.025, 16);
    t.addPart(leakPort, 'Helium Leak-Detection Port (KF-16)', {
      color: 0xb0b0b8,
      material: 'Stainless Steel 316',
      category: 'INST', subsystem: 'LDP',
    });
  }

  static buildHousing(t) {
    // Outer housing (Inconel 718, machined from forging)
    const outer = PrimitiveBuilder.cylinderShell(0.080, 0.070, 0.110, 64);
    t.addPart(outer, 'Outer Housing (Inconel 718 forging)', {
      color: 0x9a8870,
      material: 'Inconel 718',
      category: 'HOU', subsystem: 'OUT',
      metadata: { forging_spec: 'AMS 5663', proof_pressure_bar: 375 },
    });
    // Front + rear flanges (with bolt-circle for assembly to turbopump body)
    for (let i = 0; i < 2; i++) {
      const flange = PrimitiveBuilder.cylinder(0.110, 0.012, 64);
      t.addPart(flange, `Housing Flange ${i === 0 ? 'Inlet' : 'Outlet'}`, {
        color: 0x9a8870,
        position: new Vec3(0, 0, (i === 0 ? -1 : 1) * 0.055),
        material: 'Inconel 718',
        category: 'HOU', subsystem: 'FLG',
      });
    }
    // Metal C-rings (low-leak gaskets)
    for (let i = 0; i < 2; i++) {
      const cring = PrimitiveBuilder.torus(0.085, 0.0015, 48, 8);
      t.addPart(cring, `Metal C-Ring Gasket ${i + 1} (Inconel)`, {
        color: 0x808088,
        material: 'Inconel 718',
        category: 'SEAL', subsystem: 'CRG',
      });
    }
  }

  static buildFasteners(t) {
    // 24 flange bolts (Inconel 718 — non-magnetic, cryo-compatible)
    for (let i = 0; i < 24; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.005, 0.030, 12);
      t.addPart(bolt, `Inconel Flange Bolt ${i + 1} (M10)`, {
        color: 0xa89a86,
        material: 'Inconel 718',
        category: 'FAS', subsystem: 'BLT',
      });
      const washer = PrimitiveBuilder.torus(0.008, 0.001, 16, 8);
      t.addPart(washer, `Inconel Washer ${i + 1}`, {
        color: 0xa89a86,
        material: 'Inconel 718',
        category: 'FAS', subsystem: 'WSH',
      });
    }
    // 12 lock-wiring tabs
    for (let i = 0; i < 12; i++) {
      const wire = PrimitiveBuilder.cylinder(0.0005, 0.020, 8);
      t.addPart(wire, `Safety Lockwire ${i + 1} (0.032" stainless)`, {
        color: 0xb0b0b8,
        material: 'Stainless Steel 316',
        category: 'FAS', subsystem: 'LWR',
      });
    }
  }
}
