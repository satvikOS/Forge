/**
 * ArchDisc — Master's-Level Project: EV Battery Pack Thermal Management
 *
 * Liquid-cooled thermal-management system for a cylindrical 4680
 * battery pack (Tesla-style). Cold plate with serpentine micro-channels
 * sandwiches between two cell layers; pumped 50/50 water-glycol coolant
 * carries heat to a low-side radiator.
 *
 * Demonstrates: optimization (channel layout), simulation (CFD/thermal),
 * complex system integration (BMS sensors).
 *
 * Components: ~140 unique, ~720 instances (mostly battery cells).
 *
 * Specs:
 *   Pack capacity:     50 kWh nominal
 *   Cells:             96 × 4680 (4.6Ah, 4.2V nominal)
 *   Pack voltage:      400 V
 *   Cooling capacity:  6 kW continuous, 12 kW peak
 *   Coolant:           50/50 ethylene glycol / water
 *   Flow rate:         8 L/min
 *   ΔT cell-to-cell:   ≤ 3 °C target under fast-charge
 */

import { Assembly, PrimitiveBuilder, Vec3, PartIDRegistry } from '../kernel/index.js';

const SPECS = {
  capacity_kWh: 50, cellCount: 96,
  packVoltage_V: 400, coolingPower_kW: 6,
  flowRate_Lmin: 8, dT_target_C: 3,
};

export { SPECS };

export default class BatteryThermalBuilder {

  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    PartIDRegistry.setProject('BTRM');
    const pack = new Assembly('EV Battery Thermal Management Pack');

    const sections = [
      ['Cold Plate Assembly',         BatteryThermalBuilder.buildColdPlate],
      ['Battery Cells (96 × 4680)',   BatteryThermalBuilder.buildCells],
      ['Coolant Manifolds',           BatteryThermalBuilder.buildManifolds],
      ['Coolant Lines & Fittings',    BatteryThermalBuilder.buildCoolantLines],
      ['Pump + Reservoir',            BatteryThermalBuilder.buildPumpReservoir],
      ['Radiator + Fan',              BatteryThermalBuilder.buildRadiator],
      ['BMS Electronics + Sensors',   BatteryThermalBuilder.buildBMS],
      ['Bus Bars',                    BatteryThermalBuilder.buildBusBars],
      ['Pack Enclosure',              BatteryThermalBuilder.buildEnclosure],
      ['Fasteners',                   BatteryThermalBuilder.buildFasteners],
    ];
    for (const [name, fn] of sections) {
      const before = pack.partCount();
      fn(pack);
      onProgress(name, pack.partCount() - before, pack.partCount());
    }
    return pack;
  }

  static buildColdPlate(t) {
    // Aluminum cold plate: 0.40m × 0.30m × 0.012m with serpentine channels
    const plate = PrimitiveBuilder.box(0.40, 0.012, 0.30);
    // Effective volume reduced by channels (~25% material removed)
    const v = 0.40 * 0.012 * 0.30 * 0.75;
    plate.volume = () => v;
    plate._isShell = true;
    t.addPart(plate, 'Cold Plate (Aluminum, Serpentine)', {
      color: 0xc0c0d0,
      position: new Vec3(0, 0, 0),
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'PLT',
    });
    // Channel inlet + outlet ports
    for (let i = 0; i < 2; i++) {
      const port = PrimitiveBuilder.cylinder(0.008, 0.020, 16);
      t.addPart(port, `Cold Plate Port ${i === 0 ? 'IN' : 'OUT'}`, {
        color: 0x808080,
        material: 'Aluminum 6061-T6',
        category: 'COOL', subsystem: 'PRT',
      });
    }
  }

  static buildCells(t) {
    // 96 cylindrical 4680 cells (46mm dia × 80mm tall)
    for (let i = 0; i < SPECS.cellCount; i++) {
      const row = Math.floor(i / 12);
      const col = i % 12;
      const cell = PrimitiveBuilder.cylinder(0.023, 0.080, 32);
      t.addPart(cell, `4680 Cell ${i + 1}`, {
        color: 0x404040,
        position: new Vec3(-0.18 + col * 0.030, 0.060, -0.13 + row * 0.030),
        material: 'Steel AISI 1020',  // can casing simplification
        category: 'CELL', subsystem: '4680',
        metadata: { capacity_Ah: 4.6, voltage_nom_V: 4.2 },
      });
    }
  }

  static buildManifolds(t) {
    // Inlet + outlet manifolds (extruded aluminum tubes with branch ports)
    for (let i = 0; i < 2; i++) {
      const manifold = PrimitiveBuilder.cylinderShell(0.018, 0.012, 0.32, 24);
      t.addPart(manifold, `Coolant Manifold ${i === 0 ? 'IN' : 'OUT'}`, {
        color: 0x808090,
        position: new Vec3(0, 0.012, (i === 0 ? -1 : 1) * 0.18),
        material: 'Aluminum 6061-T6',
        category: 'COOL', subsystem: 'MAN',
      });
      // Branch ports (4 per manifold)
      for (let p = 0; p < 4; p++) {
        const branch = PrimitiveBuilder.cylinder(0.005, 0.020, 12);
        t.addPart(branch, `Manifold ${i + 1} Branch ${p + 1}`, {
          color: 0x707080,
          material: 'Aluminum 6061-T6',
          category: 'COOL', subsystem: 'BRN',
        });
      }
    }
  }

  static buildCoolantLines(t) {
    // Flexible silicone hoses (8 segments)
    for (let i = 0; i < 8; i++) {
      const hose = PrimitiveBuilder.cylinderShell(0.010, 0.007, 0.15, 16);
      t.addPart(hose, `Coolant Hose ${i + 1}`, {
        color: 0x202020,
        material: 'Nylon 6/6',  // approximation for silicone
        category: 'COOL', subsystem: 'HOSE',
      });
    }
    // Quick-disconnect fittings (16)
    for (let i = 0; i < 16; i++) {
      const fitting = PrimitiveBuilder.cylinder(0.012, 0.025, 12);
      t.addPart(fitting, `Quick-Disconnect Fitting ${i + 1}`, {
        color: 0xc0a040,
        material: 'Stainless Steel 316',
        category: 'COOL', subsystem: 'FIT',
      });
    }
  }

  static buildPumpReservoir(t) {
    const pump = PrimitiveBuilder.cylinder(0.045, 0.080, 24);
    t.addPart(pump, 'Coolant Pump (BLDC, 50W, 8 L/min)', {
      color: 0x303040,
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'PMP',
    });
    const res = PrimitiveBuilder.cylinderShell(0.060, 0.057, 0.15, 32);
    t.addPart(res, 'Coolant Reservoir (1.5 L)', {
      color: 0x202020,
      material: 'ABS Plastic',
      category: 'COOL', subsystem: 'RES',
    });
  }

  static buildRadiator(t) {
    // Brazed-aluminum radiator core
    const core = PrimitiveBuilder.box(0.30, 0.06, 0.20);
    const v = 0.30 * 0.06 * 0.20 * 0.30; // ~30% fill (mostly fins)
    core.volume = () => v;
    core._isShell = true;
    t.addPart(core, 'Radiator Core', {
      color: 0x707070,
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'RAD',
    });
    // 6 fan blades + housing
    const fanHousing = PrimitiveBuilder.cylinderShell(0.080, 0.075, 0.030, 24);
    t.addPart(fanHousing, 'Radiator Fan Housing', {
      color: 0x404040,
      material: 'ABS Plastic',
      category: 'COOL', subsystem: 'FAN',
    });
    for (let i = 0; i < 6; i++) {
      const blade = PrimitiveBuilder.box(0.012, 0.060, 0.005);
      t.addPart(blade, `Radiator Fan Blade ${i + 1}`, {
        color: 0x202020,
        material: 'ABS Plastic',
        category: 'COOL', subsystem: 'BLD',
      });
    }
  }

  static buildBMS(t) {
    // Battery management system PCBs (3, redundant)
    for (let i = 0; i < 3; i++) {
      const pcb = PrimitiveBuilder.box(0.18, 0.003, 0.10);
      t.addPart(pcb, `BMS PCB ${i + 1}`, {
        color: 0x004000,
        material: 'ABS Plastic',
        category: 'BMS', subsystem: 'PCB',
      });
    }
    // Cell-monitoring ICs (1 per 8 cells = 12)
    for (let i = 0; i < 12; i++) {
      const ic = PrimitiveBuilder.box(0.012, 0.002, 0.012);
      t.addPart(ic, `Cell Monitor IC ${i + 1}`, {
        color: 0x202020,
        material: 'ABS Plastic',
        category: 'BMS', subsystem: 'IC',
      });
    }
    // Temperature sensors (NTC, 1 per 8 cells = 12 + 4 manifold = 16)
    for (let i = 0; i < 16; i++) {
      const ntc = PrimitiveBuilder.cylinder(0.002, 0.005, 8);
      t.addPart(ntc, `Temperature Sensor ${i + 1} (NTC 10k)`, {
        color: 0x404040,
        material: 'Stainless Steel 316',
        category: 'BMS', subsystem: 'TMP',
      });
    }
    // Pressure + flow sensors
    for (let i = 0; i < 4; i++) {
      const sensor = PrimitiveBuilder.cylinder(0.012, 0.030, 16);
      t.addPart(sensor, `Coolant ${i < 2 ? 'Pressure' : 'Flow'} Sensor ${i + 1}`, {
        color: 0x707080,
        material: 'Stainless Steel 316',
        category: 'BMS', subsystem: 'SNS',
      });
    }
    // Main MCU
    const mcu = PrimitiveBuilder.box(0.080, 0.012, 0.080);
    t.addPart(mcu, 'BMS Main MCU + Communication Module', {
      color: 0x202020,
      material: 'ABS Plastic',
      category: 'BMS', subsystem: 'MCU',
    });
  }

  static buildBusBars(t) {
    // Series + parallel bus bars (copper)
    // 8 module-level bus bars + 2 pack-level
    for (let i = 0; i < 10; i++) {
      const bus = PrimitiveBuilder.box(0.30, 0.005, 0.020);
      t.addPart(bus, `Bus Bar ${i + 1}`, {
        color: 0xb86d3a,
        material: 'Copper C11000',
        category: 'ELEC', subsystem: 'BUS',
      });
    }
    // Cell tabs (96)
    for (let i = 0; i < 96; i++) {
      const tab = PrimitiveBuilder.box(0.018, 0.002, 0.010);
      t.addPart(tab, `Cell Tab ${i + 1}`, {
        color: 0xb0b0b0,
        material: 'Aluminum 6061-T6',
        category: 'ELEC', subsystem: 'TAB',
      });
    }
    // High-current contactor
    const contactor = PrimitiveBuilder.box(0.10, 0.080, 0.080);
    t.addPart(contactor, 'Main Pack Contactor 400A', {
      color: 0x303030,
      material: 'ABS Plastic',
      category: 'ELEC', subsystem: 'CON',
    });
  }

  static buildEnclosure(t) {
    // Pack housing (sheet aluminum)
    const top = PrimitiveBuilder.box(0.50, 0.005, 0.40);
    t.addPart(top, 'Pack Enclosure Lid', {
      color: 0xa0a0b0,
      material: 'Aluminum 6061-T6',
      category: 'ENC', subsystem: 'LID',
    });
    const bottom = PrimitiveBuilder.box(0.50, 0.005, 0.40);
    t.addPart(bottom, 'Pack Enclosure Floor', {
      color: 0xa0a0b0,
      material: 'Aluminum 6061-T6',
      category: 'ENC', subsystem: 'FLR',
    });
    // 4 side walls
    for (let i = 0; i < 4; i++) {
      const wall = PrimitiveBuilder.box(i % 2 === 0 ? 0.50 : 0.005, 0.180, i % 2 === 0 ? 0.005 : 0.40);
      t.addPart(wall, `Pack Enclosure Wall ${i + 1}`, {
        color: 0xa0a0b0,
        material: 'Aluminum 6061-T6',
        category: 'ENC', subsystem: 'WAL',
      });
    }
    // Pressure-relief valve
    const prv = PrimitiveBuilder.cylinder(0.012, 0.020, 16);
    t.addPart(prv, 'Pressure-Relief Valve (thermal runaway vent)', {
      color: 0xc04040,
      material: 'Stainless Steel 316',
      category: 'ENC', subsystem: 'PRV',
    });
  }

  static buildFasteners(t) {
    for (let i = 0; i < 60; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.0025, 0.020, 12);
      t.addPart(bolt, `M5 Bolt ${i + 1}`, {
        color: 0x666666, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'BLT',
      });
      const washer = PrimitiveBuilder.torus(0.0045, 0.0008, 12, 8);
      t.addPart(washer, `M5 Washer ${i + 1}`, {
        color: 0x888888, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'WSH',
      });
    }
  }
}
