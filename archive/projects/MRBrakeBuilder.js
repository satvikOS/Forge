/**
 * ArchDisc — PhD-Level Project: Magneto-Rheological Fluid Brake
 *
 * Smart braking system where torque is controlled by altering the
 * viscosity of magneto-rheological (MR) fluid via an external
 * magnetic field. Demonstrates fluid-structure interaction modeling.
 *
 * Components: rotor disk, stator pole pieces with electromagnetic
 * coil, MR fluid chamber, dynamic seals, magnetic flux return path,
 * Hall-effect position sensors, wires.
 *
 * Specs:
 *   Outer diameter:  150 mm
 *   Disk diameter:   100 mm
 *   Coil current:    0–5 A continuous
 *   Magnetic flux:   up to 0.8 T in fluid gap
 *   Max torque:      30 Nm @ 5A
 *   Off-state torque: 0.5 Nm
 *   MR fluid:        Lord MRF-122EG carbonyl iron in oil
 *   Bandwidth:       200 Hz response
 */

import { Assembly, PrimitiveBuilder, Vec3, PartIDRegistry } from '../kernel/index.js';

const PI = Math.PI;
const SPECS = {
  outerDia_m: 0.150, diskDia_m: 0.100, gap_m: 0.0005,
  coilCurrent_A_max: 5, fluxDensity_T_max: 0.8,
  torque_Nm_max: 30, torque_off_Nm: 0.5,
  bandwidth_Hz: 200,
};
export { SPECS };

export default class MRBrakeBuilder {

  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    PartIDRegistry.setProject('MRBR');
    const brake = new Assembly('Magneto-Rheological Fluid Brake');

    const sections = [
      ['Housing & Flux Return Path', MRBrakeBuilder.buildHousing],
      ['Rotor Disk Assembly',        MRBrakeBuilder.buildRotor],
      ['Electromagnetic Coil',       MRBrakeBuilder.buildCoil],
      ['Stator Pole Pieces',         MRBrakeBuilder.buildStator],
      ['MR Fluid Chamber + Seals',   MRBrakeBuilder.buildFluidChamber],
      ['Sensors',                    MRBrakeBuilder.buildSensors],
      ['Wiring & Connectors',        MRBrakeBuilder.buildWiring],
      ['Fasteners',                  MRBrakeBuilder.buildFasteners],
    ];
    for (const [name, fn] of sections) {
      const before = brake.partCount();
      fn(brake);
      onProgress(name, brake.partCount() - before, brake.partCount());
    }
    return brake;
  }

  static buildHousing(t) {
    // Steel housing (low-carbon steel for high permeability — flux return path)
    const outer = PrimitiveBuilder.cylinderShell(SPECS.outerDia_m / 2, SPECS.outerDia_m / 2 - 0.012, 0.080, 64);
    t.addPart(outer, 'Brake Housing — Outer Cylinder (Flux Return)', {
      color: 0x606870,
      material: 'Steel AISI 1020',
      category: 'HOU', subsystem: 'OUT',
    });
    const front = PrimitiveBuilder.cylinder(SPECS.outerDia_m / 2, 0.008, 64);
    t.addPart(front, 'Housing Front Cover', {
      color: 0x707880, position: new Vec3(0, 0, -0.044),
      material: 'Steel AISI 1020', category: 'HOU', subsystem: 'FRT',
    });
    const back = PrimitiveBuilder.cylinder(SPECS.outerDia_m / 2, 0.008, 64);
    t.addPart(back, 'Housing Back Cover', {
      color: 0x707880, position: new Vec3(0, 0, 0.044),
      material: 'Steel AISI 1020', category: 'HOU', subsystem: 'BCK',
    });
  }

  static buildRotor(t) {
    // Rotor disk (low-carbon steel for high permeability through fluid gap)
    const disk = PrimitiveBuilder.cylinder(SPECS.diskDia_m / 2, 0.008, 64);
    t.addPart(disk, 'MR Brake Rotor Disk', {
      color: 0x808890, position: new Vec3(0, 0, 0),
      material: 'Steel AISI 1020',
      category: 'ROT', subsystem: 'DSK',
      metadata: { permeability_relative: 1500, finish_Ra_um: 0.4 },
    });
    // Rotor shaft (8mm diameter)
    const shaft = PrimitiveBuilder.cylinder(0.004, 0.080, 16);
    t.addPart(shaft, 'Rotor Shaft', {
      color: 0x707080, position: new Vec3(0, 0, 0),
      material: 'Steel AISI 4340',
      category: 'ROT', subsystem: 'SFT',
    });
    // Shaft bearings (2 — angular contact)
    for (let i = 0; i < 2; i++) {
      const brg = PrimitiveBuilder.cylinder(0.012, 0.008, 24);
      t.addPart(brg, `Shaft Bearing ${i + 1} (Angular Contact)`, {
        color: 0x999999, position: new Vec3(0, 0, i === 0 ? -0.030 : 0.030),
        material: 'Steel AISI 4340',
        category: 'BRG', subsystem: 'AC',
      });
    }
    // Shaft seals (2 — dynamic, prevent MR fluid leakage)
    for (let i = 0; i < 2; i++) {
      const seal = PrimitiveBuilder.torus(0.005, 0.0008, 16, 8);
      t.addPart(seal, `Shaft Dynamic Seal ${i + 1} (PTFE lip seal)`, {
        color: 0x303030,
        material: 'Nylon 6/6',
        category: 'SEAL', subsystem: 'DYN',
      });
    }
  }

  static buildCoil(t) {
    // Electromagnetic coil — multilayer copper winding
    const coil = PrimitiveBuilder.cylinderShell(0.058, 0.038, 0.040, 32);
    t.addPart(coil, 'Electromagnetic Coil (1200 turns × 0.5mm enamelled Cu)', {
      color: 0xb86d3a, position: new Vec3(0, 0, 0),
      material: 'Copper C11000',
      category: 'COIL', subsystem: 'WIN',
      metadata: { turns: 1200, wire_dia_mm: 0.5, max_current_A: 5 },
    });
    // Coil bobbin (insulator)
    const bobbin = PrimitiveBuilder.cylinderShell(0.038, 0.034, 0.045, 32);
    t.addPart(bobbin, 'Coil Bobbin (PEEK insulator)', {
      color: 0xc09040,
      material: 'Nylon 6/6',
      category: 'COIL', subsystem: 'BOB',
    });
  }

  static buildStator(t) {
    // 2 pole pieces (above + below the rotor disk gap)
    for (let i = 0; i < 2; i++) {
      const pole = PrimitiveBuilder.cylinder(0.058, 0.012, 32);
      t.addPart(pole, `Stator Pole Piece ${i === 0 ? 'Front' : 'Back'}`, {
        color: 0x808890,
        position: new Vec3(0, 0, (i === 0 ? -1 : 1) * 0.014),
        material: 'Steel AISI 1020',
        category: 'STA', subsystem: 'POL',
        metadata: { saturation_T: 2.0 },
      });
    }
  }

  static buildFluidChamber(t) {
    // MR fluid chamber — annular gap between rotor and stator
    const chamber = PrimitiveBuilder.cylinderShell(SPECS.diskDia_m / 2 + 0.002, SPECS.diskDia_m / 2 + 0.001, 0.012, 64);
    t.addPart(chamber, 'MR Fluid Chamber (annular gap, 0.5mm)', {
      color: 0x40404a,
      material: 'Stainless Steel 316',
      category: 'FLU', subsystem: 'CHM',
      metadata: { fluid: 'Lord MRF-122EG', gap_mm: 0.5, volume_mL: 12 },
    });
    // Fill + drain ports (2)
    for (let i = 0; i < 2; i++) {
      const port = PrimitiveBuilder.cylinder(0.003, 0.015, 12);
      t.addPart(port, `MR Fluid ${i === 0 ? 'Fill' : 'Drain'} Port`, {
        color: 0x808080,
        material: 'Stainless Steel 316',
        category: 'FLU', subsystem: 'PRT',
      });
    }
    // Reservoir / accumulator (compensates for thermal expansion)
    const accumulator = PrimitiveBuilder.cylinderShell(0.012, 0.010, 0.030, 16);
    t.addPart(accumulator, 'MR Fluid Accumulator', {
      color: 0x606060,
      material: 'Stainless Steel 316',
      category: 'FLU', subsystem: 'ACC',
    });
    // 4 O-ring seals (chamber-housing interface)
    for (let i = 0; i < 4; i++) {
      const oring = PrimitiveBuilder.torus(0.058, 0.0015, 32, 8);
      t.addPart(oring, `Chamber O-Ring Seal ${i + 1} (Viton)`, {
        color: 0x202020,
        material: 'Nylon 6/6',
        category: 'SEAL', subsystem: 'ORI',
      });
    }
  }

  static buildSensors(t) {
    // Hall-effect rotor position sensor (3 for redundancy)
    for (let i = 0; i < 3; i++) {
      const hall = PrimitiveBuilder.box(0.005, 0.002, 0.005);
      t.addPart(hall, `Hall-Effect Position Sensor ${i + 1}`, {
        color: 0x202020,
        material: 'ABS Plastic',
        category: 'SNS', subsystem: 'POS',
      });
    }
    // Coil current sensor (Hall-based shunt)
    const isens = PrimitiveBuilder.box(0.018, 0.005, 0.018);
    t.addPart(isens, 'Coil Current Sensor (LEM CASR-15)', {
      color: 0x404040,
      material: 'ABS Plastic',
      category: 'SNS', subsystem: 'CUR',
    });
    // RTD temperature sensor (PT100)
    const rtd = PrimitiveBuilder.cylinder(0.0015, 0.020, 8);
    t.addPart(rtd, 'PT100 RTD Temperature Sensor', {
      color: 0xc0a060,
      material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'RTD',
    });
    // Torque sensor (strain-gauge half-bridge)
    const torq = PrimitiveBuilder.box(0.040, 0.005, 0.020);
    t.addPart(torq, 'Reaction Torque Sensor (strain gauge)', {
      color: 0x808080,
      material: 'Aluminum 6061-T6',
      category: 'SNS', subsystem: 'TRQ',
    });
  }

  static buildWiring(t) {
    // Power wires (coil leads, sensor)
    for (let i = 0; i < 6; i++) {
      const wire = PrimitiveBuilder.cylinder(0.001, 0.080, 8);
      t.addPart(wire, `Wire Lead ${i + 1}`, {
        color: i < 2 ? 0xc04040 : 0x303030,
        material: 'Copper C11000',
        category: 'WIR', subsystem: 'LED',
      });
    }
    // Connector
    const conn = PrimitiveBuilder.box(0.020, 0.012, 0.012);
    t.addPart(conn, 'M12 Connector (8-pin)', {
      color: 0x303030,
      material: 'ABS Plastic',
      category: 'WIR', subsystem: 'CNN',
    });
  }

  static buildFasteners(t) {
    for (let i = 0; i < 16; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.002, 0.018, 12);
      t.addPart(bolt, `M4 Socket-Head Cap Screw ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'BLT',
      });
    }
  }
}
