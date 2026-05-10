/**
 * ArchDisc — Bachelor's-Level Project: Automated Stair-Climbing Hand Truck
 *
 * Tri-star wheel hand truck capable of carrying 50 kg+ loads up stairs
 * while keeping the cargo platform level via a planetary cam mechanism.
 *
 * Demonstrates the same FAA-Part-21-style production-article pipeline
 * applied to a non-aerospace project — validates platform genericity.
 *
 * Components (~120 unique, ~250 instances):
 *   - 2 tri-star wheel assemblies (left + right)
 *     - 3 wheels per side, 6 total
 *     - 2 hub spider arms per side
 *   - Frame (rectangular tube weldment)
 *   - Cargo platform (with level-keeping linkage)
 *   - Handle assembly
 *   - Bearings, fasteners, axles
 *   - Optional electric motor + Li-ion battery
 *
 * Specs (typical):
 *   Total mass:        18 kg empty
 *   Payload:           50 kg
 *   Stair pitch:       up to 200mm × 250mm tread
 *   Wheel diameter:    150mm
 *   Tri-star radius:   210mm
 */

import {
  Assembly, PrimitiveBuilder, Vec3, PartIDRegistry,
} from '../kernel/index.js';

const PI = Math.PI;

const SPECS = {
  totalMass_kg_empty: 18,
  payload_kg: 50,
  wheelDia_m: 0.15,
  triStarRadius_m: 0.21,
  frameWidth_m: 0.40,
  frameHeight_m: 1.20,
  frameDepth_m: 0.60,
  cargoPlatformLength_m: 0.50,
  handleLength_m: 0.45,
};

export { SPECS };

export default class StairClimberBuilder {

  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    PartIDRegistry.setProject('STCL');

    const truck = new Assembly('Stair-Climbing Hand Truck');

    const sections = [
      ['Frame Weldment',          StairClimberBuilder.buildFrame],
      ['Tri-Star Wheel Assemblies', StairClimberBuilder.buildTriStarWheels],
      ['Cargo Platform',          StairClimberBuilder.buildCargoPlatform],
      ['Level-Keeping Linkage',   StairClimberBuilder.buildLevelLinkage],
      ['Handle Assembly',         StairClimberBuilder.buildHandle],
      ['Drive System (electric)', StairClimberBuilder.buildDriveSystem],
      ['Battery & Electronics',   StairClimberBuilder.buildBatteryElectronics],
      ['Fasteners & Hardware',    StairClimberBuilder.buildFasteners],
    ];

    for (const [name, fn] of sections) {
      const before = truck.partCount();
      fn(truck);
      onProgress(name, truck.partCount() - before, truck.partCount());
    }

    return truck;
  }

  // ----------------------------------------------------------------
  // Frame
  // ----------------------------------------------------------------
  static buildFrame(t) {
    // 4 vertical tubes (40×40×3mm steel)
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 === 0 ? -1 : 1) * SPECS.frameWidth_m / 2;
      const z = (i < 2 ? -1 : 1) * SPECS.frameDepth_m / 2;
      // Hollow tube (40x40 outer, 34x34 inner = 3mm wall)
      const tube = PrimitiveBuilder.box(0.040, SPECS.frameHeight_m, 0.040);
      const wallVol = (0.040 * 0.040 - 0.034 * 0.034) * SPECS.frameHeight_m;
      tube.volume = () => wallVol;
      tube._isShell = true;
      t.addPart(tube, `Frame Vertical Tube ${i + 1}`, {
        color: 0x606870,
        position: new Vec3(x, SPECS.frameHeight_m / 2, z),
        material: 'Steel AISI 1020',
        category: 'STR', subsystem: 'TUB',
      });
    }

    // Cross members at top, middle, bottom
    for (let level = 0; level < 3; level++) {
      const y = level === 0 ? 0.05 : level === 1 ? SPECS.frameHeight_m / 2 : SPECS.frameHeight_m - 0.05;
      // Front + rear cross
      for (let side = 0; side < 2; side++) {
        const z = (side === 0 ? -1 : 1) * SPECS.frameDepth_m / 2;
        const cross = PrimitiveBuilder.box(SPECS.frameWidth_m, 0.040, 0.040);
        const wallVol = (0.040 * 0.040 - 0.034 * 0.034) * SPECS.frameWidth_m;
        cross.volume = () => wallVol;
        cross._isShell = true;
        t.addPart(cross, `Frame Cross-Tube L${level + 1} ${side === 0 ? 'Front' : 'Rear'}`, {
          color: 0x606870,
          position: new Vec3(0, y, z),
          material: 'Steel AISI 1020',
          category: 'STR', subsystem: 'TUB',
        });
      }
    }

    // Diagonal braces (4 — for stability)
    for (let i = 0; i < 4; i++) {
      const brace = PrimitiveBuilder.box(0.030, 0.030, 0.85);
      const wallVol = (0.030 * 0.030 - 0.024 * 0.024) * 0.85;
      brace.volume = () => wallVol;
      brace._isShell = true;
      t.addPart(brace, `Frame Diagonal Brace ${i + 1}`, {
        color: 0x606870,
        material: 'Steel AISI 1020',
        category: 'STR', subsystem: 'BRC',
      });
    }
  }

  // ----------------------------------------------------------------
  // Tri-Star Wheel Assemblies (left + right)
  // ----------------------------------------------------------------
  static buildTriStarWheels(t) {
    const triStarPositions = [
      { side: 'left',  x: -SPECS.frameWidth_m / 2 - 0.05, label: 'L' },
      { side: 'right', x:  SPECS.frameWidth_m / 2 + 0.05, label: 'R' },
    ];

    for (const ts of triStarPositions) {
      // Spider arm hub (planet carrier)
      const hub = PrimitiveBuilder.cylinder(0.040, 0.040, 32);
      t.addPart(hub, `Tri-Star Hub ${ts.label}`, {
        color: 0x4a4a5a,
        position: new Vec3(ts.x, 0.10, 0),
        material: 'Steel AISI 4340',
        category: 'WHL', subsystem: 'HUB',
      });

      // 3 spider arms at 120° spacing
      for (let arm = 0; arm < 3; arm++) {
        const angle = arm * (2 * PI / 3);
        const armBar = PrimitiveBuilder.box(0.025, 0.025, SPECS.triStarRadius_m);
        t.addPart(armBar, `Tri-Star Spider Arm ${ts.label}-${arm + 1}`, {
          color: 0x707070,
          position: new Vec3(
            ts.x + Math.cos(angle) * SPECS.triStarRadius_m / 2,
            0.10 + Math.sin(angle) * SPECS.triStarRadius_m / 2,
            0
          ),
          rotation: new Vec3(0, 0, angle),
          material: 'Steel AISI 4340',
          category: 'WHL', subsystem: 'ARM',
        });

        // Wheel at end of arm (rotates on its own axle)
        const wheelHub = PrimitiveBuilder.cylinder(0.020, 0.040, 24);
        t.addPart(wheelHub, `Wheel Hub ${ts.label}-${arm + 1}`, {
          color: 0x808080,
          position: new Vec3(
            ts.x + Math.cos(angle) * SPECS.triStarRadius_m,
            0.10 + Math.sin(angle) * SPECS.triStarRadius_m,
            0
          ),
          material: 'Aluminum 6061-T6',
          category: 'WHL', subsystem: 'WHB',
        });

        // Wheel rim (aluminum)
        const wheelRim = PrimitiveBuilder.cylinderShell(SPECS.wheelDia_m / 2, SPECS.wheelDia_m / 2 - 0.008, 0.040, 32);
        t.addPart(wheelRim, `Wheel Rim ${ts.label}-${arm + 1}`, {
          color: 0xc0c0c0,
          position: new Vec3(
            ts.x + Math.cos(angle) * SPECS.triStarRadius_m,
            0.10 + Math.sin(angle) * SPECS.triStarRadius_m,
            0
          ),
          material: 'Aluminum 6061-T6',
          category: 'WHL', subsystem: 'RIM',
        });

        // Tire (rubber)
        const tire = PrimitiveBuilder.cylinderShell(SPECS.wheelDia_m / 2 + 0.015, SPECS.wheelDia_m / 2, 0.045, 32);
        t.addPart(tire, `Tire ${ts.label}-${arm + 1}`, {
          color: 0x303030,
          position: new Vec3(
            ts.x + Math.cos(angle) * SPECS.triStarRadius_m,
            0.10 + Math.sin(angle) * SPECS.triStarRadius_m,
            0
          ),
          material: 'Nylon 6/6',  // approximation for rubber
          category: 'WHL', subsystem: 'TIR',
        });

        // Wheel bearing (cup-and-cone, 2 per wheel)
        for (let b = 0; b < 2; b++) {
          const bearing = PrimitiveBuilder.cylinder(0.012, 0.008, 16);
          t.addPart(bearing, `Wheel Bearing ${ts.label}-${arm + 1}-${b + 1}`, {
            color: 0x999999,
            material: 'Steel AISI 4340',
            category: 'BRG', subsystem: 'WHB',
          });
        }
      }

      // Tri-star main axle (passes through hub, attaches to frame via bearing)
      const axle = PrimitiveBuilder.cylinder(0.012, 0.10, 16);
      t.addPart(axle, `Tri-Star Main Axle ${ts.label}`, {
        color: 0x505060,
        position: new Vec3(ts.x - 0.05, 0.10, 0),
        rotation: new Vec3(0, PI / 2, 0),
        material: 'Steel AISI 4340',
        category: 'AXL', subsystem: 'MAIN',
      });

      // Frame-to-axle bearing
      const frameBrg = PrimitiveBuilder.cylinder(0.018, 0.020, 16);
      t.addPart(frameBrg, `Frame-Axle Bearing ${ts.label}`, {
        color: 0x808080,
        position: new Vec3(ts.x, 0.10, 0),
        material: 'Steel AISI 4340',
        category: 'BRG', subsystem: 'FRM',
      });
    }
  }

  // ----------------------------------------------------------------
  // Cargo Platform
  // ----------------------------------------------------------------
  static buildCargoPlatform(t) {
    // Platform plate (aluminum tread plate)
    const platform = PrimitiveBuilder.box(SPECS.cargoPlatformLength_m, 0.005, SPECS.frameDepth_m);
    t.addPart(platform, 'Cargo Platform', {
      color: 0xb0b0c0,
      position: new Vec3(0, 0.20, 0),
      material: 'Aluminum 6061-T6',
      category: 'CRGO', subsystem: 'PLT',
    });

    // Edge railings (front + rear + sides)
    for (let side = 0; side < 4; side++) {
      const isLong = side < 2;
      const len = isLong ? SPECS.cargoPlatformLength_m : SPECS.frameDepth_m;
      const rail = PrimitiveBuilder.box(isLong ? len : 0.020, 0.040, isLong ? 0.020 : len);
      const x = isLong ? 0 : (side === 2 ? -1 : 1) * SPECS.cargoPlatformLength_m / 2;
      const z = isLong ? (side === 0 ? -1 : 1) * SPECS.frameDepth_m / 2 : 0;
      t.addPart(rail, `Cargo Edge Railing ${side + 1}`, {
        color: 0xa0a0b0,
        position: new Vec3(x, 0.225, z),
        material: 'Aluminum 6061-T6',
        category: 'CRGO', subsystem: 'RAIL',
      });
    }
  }

  // ----------------------------------------------------------------
  // Level-Keeping Linkage (4-bar mechanism)
  // ----------------------------------------------------------------
  static buildLevelLinkage(t) {
    // 2 link arms per side (front + rear), pin-jointed
    for (let side = 0; side < 2; side++) {
      const z = (side === 0 ? -1 : 1) * SPECS.frameDepth_m / 2;
      const linkArmFwd = PrimitiveBuilder.box(0.020, 0.005, 0.30);
      t.addPart(linkArmFwd, `Level Link Forward ${side + 1}`, {
        color: 0x707080,
        position: new Vec3(0, 0.18, z),
        material: 'Steel AISI 1020',
        category: 'LNK', subsystem: 'ARM',
      });
      const linkArmRev = PrimitiveBuilder.box(0.020, 0.005, 0.30);
      t.addPart(linkArmRev, `Level Link Reverse ${side + 1}`, {
        color: 0x707080,
        position: new Vec3(0, 0.16, z),
        material: 'Steel AISI 1020',
        category: 'LNK', subsystem: 'ARM',
      });
      // Pivot pins (4 per side)
      for (let p = 0; p < 4; p++) {
        const pin = PrimitiveBuilder.cylinder(0.005, 0.030, 12);
        t.addPart(pin, `Linkage Pivot Pin ${side + 1}-${p + 1}`, {
          color: 0x404040,
          material: 'Steel AISI 4340',
          category: 'LNK', subsystem: 'PIN',
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // Handle
  // ----------------------------------------------------------------
  static buildHandle(t) {
    // U-shaped handle: 2 vertical extensions + 1 horizontal grip
    for (let i = 0; i < 2; i++) {
      const x = (i === 0 ? -1 : 1) * 0.18;
      const ext = PrimitiveBuilder.cylinderShell(0.015, 0.012, SPECS.handleLength_m, 16);
      t.addPart(ext, `Handle Vertical ${i + 1}`, {
        color: 0x505060,
        position: new Vec3(x, SPECS.frameHeight_m + SPECS.handleLength_m / 2, -SPECS.frameDepth_m / 2),
        material: 'Steel AISI 1020',
        category: 'HDL', subsystem: 'EXT',
      });
    }
    const grip = PrimitiveBuilder.cylinderShell(0.018, 0.015, 0.36, 16);
    t.addPart(grip, 'Handle Grip', {
      color: 0x202020,
      position: new Vec3(0, SPECS.frameHeight_m + SPECS.handleLength_m, -SPECS.frameDepth_m / 2),
      rotation: new Vec3(0, 0, PI / 2),
      material: 'Nylon 6/6',
      category: 'HDL', subsystem: 'GRP',
    });
    // Grip cushions (rubber sleeves, 2)
    for (let i = 0; i < 2; i++) {
      const cushion = PrimitiveBuilder.cylinderShell(0.022, 0.018, 0.10, 16);
      t.addPart(cushion, `Handle Cushion ${i + 1}`, {
        color: 0x202020,
        material: 'Nylon 6/6',
        category: 'HDL', subsystem: 'CSH',
      });
    }
  }

  // ----------------------------------------------------------------
  // Drive System
  // ----------------------------------------------------------------
  static buildDriveSystem(t) {
    // Two BLDC hub motors (one per tri-star side)
    for (const side of ['L', 'R']) {
      const motor = PrimitiveBuilder.cylinder(0.080, 0.060, 32);
      t.addPart(motor, `BLDC Hub Motor ${side}`, {
        color: 0x303040,
        material: 'Aluminum 6061-T6',
        category: 'DRV', subsystem: 'MTR',
      });
      // Encoder
      const encoder = PrimitiveBuilder.box(0.040, 0.020, 0.040);
      t.addPart(encoder, `Motor Encoder ${side}`, {
        color: 0x202020,
        material: 'Aluminum 6061-T6',
        category: 'DRV', subsystem: 'ENC',
      });
    }

    // Drive belt + pulleys (between motor and tri-star hub)
    for (let i = 0; i < 4; i++) {
      const pulley = PrimitiveBuilder.cylinder(0.030, 0.012, 24);
      t.addPart(pulley, `Drive Pulley ${i + 1}`, {
        color: 0x707080,
        material: 'Aluminum 6061-T6',
        category: 'DRV', subsystem: 'PLY',
      });
    }
  }

  static buildBatteryElectronics(t) {
    // Li-ion battery pack (24V 10Ah)
    const battery = PrimitiveBuilder.box(0.20, 0.10, 0.15);
    t.addPart(battery, 'Li-Ion Battery Pack 24V 10Ah', {
      color: 0x202020,
      position: new Vec3(0, 0.40, SPECS.frameDepth_m / 4),
      material: 'ABS Plastic',
      category: 'BAT', subsystem: 'PCK',
    });
    // Motor controller
    const controller = PrimitiveBuilder.box(0.12, 0.040, 0.08);
    t.addPart(controller, 'Motor Controller (BLDC dual-channel)', {
      color: 0x404050,
      position: new Vec3(0, 0.50, SPECS.frameDepth_m / 4),
      material: 'Aluminum 6061-T6',
      category: 'BAT', subsystem: 'CTL',
    });
    // Microcontroller (Arduino-class)
    const mcu = PrimitiveBuilder.box(0.07, 0.012, 0.05);
    t.addPart(mcu, 'Microcontroller (control + safety logic)', {
      color: 0x004000,
      material: 'ABS Plastic',
      category: 'BAT', subsystem: 'MCU',
    });
    // IMU sensor
    const imu = PrimitiveBuilder.box(0.020, 0.008, 0.020);
    t.addPart(imu, 'IMU Sensor (level-keeping feedback)', {
      color: 0x404040,
      material: 'ABS Plastic',
      category: 'BAT', subsystem: 'IMU',
    });
    // Wiring (8 segments)
    for (let i = 0; i < 8; i++) {
      const wire = PrimitiveBuilder.cylinder(0.005, 0.30, 8);
      t.addPart(wire, `Power/Signal Cable ${i + 1}`, {
        color: 0x303030,
        material: 'Copper C11000',
        category: 'BAT', subsystem: 'WIR',
      });
    }
  }

  // ----------------------------------------------------------------
  // Fasteners
  // ----------------------------------------------------------------
  static buildFasteners(t) {
    // 80 M6 bolts (frame joints + cargo platform attach + handle attach)
    for (let i = 0; i < 80; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.003, 0.025, 12);
      t.addPart(bolt, `M6 Bolt ${i + 1}`, {
        color: 0x666666,
        material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'BLT',
      });
      const washer = PrimitiveBuilder.torus(0.005, 0.0008, 12, 8);
      t.addPart(washer, `M6 Washer ${i + 1}`, {
        color: 0x888888,
        material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'WSH',
      });
      const nut = PrimitiveBuilder.cylinder(0.005, 0.005, 6);
      t.addPart(nut, `M6 Nut ${i + 1}`, {
        color: 0x555555,
        material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'NUT',
      });
    }

    // 24 M4 small fasteners (electronics mounting)
    for (let i = 0; i < 24; i++) {
      const screw = PrimitiveBuilder.cylinder(0.002, 0.012, 12);
      t.addPart(screw, `M4 Self-Tap Screw ${i + 1}`, {
        color: 0x707070,
        material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'SCR',
      });
    }
  }
}
