/**
 * ArchDisc — Toyota 2028 SUV V6 Hybrid Engine Builder
 *
 * 3.5 L 60° V6 hybrid powertrain — internal designation T2028-V6-LEV
 * (Low-Emission Vehicle). Combines Atkinson-cycle high-efficiency
 * combustion, cooled EGR, dual-injection D-4S, gasoline particulate
 * filter (GPF), close-coupled three-way cats, and Toyota Hybrid System
 * planetary power-split with two motor-generators (MG1 + MG2).
 *
 * Engine architecture:
 *   - 60° aluminum block (open deck, semi-closed waterjacket)
 *   - DOHC 24-valve aluminum heads, dual VVT-iE, electric VVT on intake
 *   - Atkinson-cycle combustion (LIVC late-intake-valve-close)
 *   - 11.8:1 geometric / 13.0:1 effective compression ratio
 *   - D-4S dual injection (DI 200 bar + port low-pressure)
 *   - Cooled EGR (high-pressure loop) up to 25%
 *   - Engine displacement: 3,456 cc
 *   - Bore × stroke: 92.5 × 86.7 mm
 *   - Engine power:  186 kW (250 hp) @ 6,000 rpm
 *   - Engine torque: 360 Nm (266 lb-ft) @ 4,800 rpm
 *   - Combined hybrid system: ~280 kW (375 hp)
 *
 * Emissions targets (segment-leading):
 *   CO2 (combined cycle):   125 g/km   (vs 2024 segment avg ~210)
 *   NOx (Tier 4 SULEV30):   0.030 g/mi
 *   PM (particulate):       0.002 g/mi
 *   NMHC + NOx total:       0.030 g/mi  (SULEV30)
 *   Compliance:             EPA Tier 4 / CARB SULEV30 / Euro 7 / China 6c
 *
 * Hybrid spec:
 *   MG1 (generator + starter): 30 kW continuous
 *   MG2 (traction motor):      80 kW continuous (180 kW peak)
 *   Battery:                   Li-ion NCM, 1.3 kWh, 244 V (360 cells × 3.7 V)
 *   Combined system:           280 kW
 *   Drive type:                Power-split eCVT
 *
 * Output: engine-output/Toyota-V6-2028-Hybrid/
 */

import { Assembly, PrimitiveBuilder, Vec3, PartIDRegistry } from '../kernel/index.js';

const PI = Math.PI;

const SPECS = {
  displacement_cc: 3456,
  bore_mm: 92.5, stroke_mm: 86.7,
  cylinders: 6, vAngle_deg: 60,
  compRatio_geom: 11.8, compRatio_eff: 13.0,
  power_kW: 186, power_hp: 250, peak_rpm: 6000,
  torque_Nm: 360, torque_lbft: 266, torque_rpm: 4800,
  hybrid_total_kW: 280, hybrid_total_hp: 375,
  // Emissions (segment-leading)
  CO2_g_km_combined: 125,
  NOx_g_mi: 0.030, PM_g_mi: 0.002, NMHCNOx_g_mi: 0.030,
  // Hybrid
  MG1_kW: 30, MG2_kW: 80, MG2_peak_kW: 180,
  battery_kWh: 1.3, battery_V: 244, battery_cells: 360,
  // Mass
  totalMass_kg_dry: 175,  // engine + ancillaries (typical V6)
  hybrid_module_kg: 75,   // MG1+MG2+planetary+power-split case
};

export { SPECS };

export default class V6HybridEngineBuilder {

  static build(options = {}) {
    const onProgress = options.onProgress || (() => {});
    PartIDRegistry.setProject('TYV6');
    const eng = new Assembly('Toyota V35X-LEV 2028 V6 Hybrid Engine');
    eng.userData = { specs: SPECS };

    const sections = [
      ['Cylinder Block + Crankcase',     V6HybridEngineBuilder.buildBlock],
      ['Cylinder Heads (×2 banks)',      V6HybridEngineBuilder.buildHeads],
      ['Crankshaft + Main Bearings',     V6HybridEngineBuilder.buildCrankshaft],
      ['Connecting Rods (×6)',           V6HybridEngineBuilder.buildConnectingRods],
      ['Pistons + Rings (×6)',           V6HybridEngineBuilder.buildPistons],
      ['Camshafts + Cam Bearings',       V6HybridEngineBuilder.buildCamshafts],
      ['Valves + Valvetrain (24)',       V6HybridEngineBuilder.buildValvetrain],
      ['VVT-iE Cam Phasers (×4)',        V6HybridEngineBuilder.buildVVT],
      ['Timing Chain + Tensioners',      V6HybridEngineBuilder.buildTimingSystem],
      ['Oil System',                     V6HybridEngineBuilder.buildOilSystem],
      ['Cooling System',                 V6HybridEngineBuilder.buildCoolingSystem],
      ['Intake Manifold + Throttle',     V6HybridEngineBuilder.buildIntakeSystem],
      ['Exhaust Manifolds + Cats + GPF', V6HybridEngineBuilder.buildExhaustEmissions],
      ['Cooled EGR Loop',                V6HybridEngineBuilder.buildEGR],
      ['D-4S Fuel System',               V6HybridEngineBuilder.buildFuelSystem],
      ['Ignition System',                V6HybridEngineBuilder.buildIgnition],
      ['Hybrid: MG1 + MG2 + Planetary',  V6HybridEngineBuilder.buildHybridDrive],
      ['HV Battery + Power Electronics', V6HybridEngineBuilder.buildHVBattery],
      ['Engine Sensors',                 V6HybridEngineBuilder.buildSensors],
      ['Engine ECU + PCM',               V6HybridEngineBuilder.buildECU],
      ['Wiring Harness',                 V6HybridEngineBuilder.buildWiring],
      ['Engine Mounts',                  V6HybridEngineBuilder.buildMounts],
      ['Front Cover + Accessories',      V6HybridEngineBuilder.buildFrontCover],
      ['Sump + Pickup',                  V6HybridEngineBuilder.buildSump],
      ['Fasteners + Hardware',           V6HybridEngineBuilder.buildFasteners],
    ];

    for (const [name, fn] of sections) {
      const before = eng.partCount();
      fn(eng);
      onProgress(name, eng.partCount() - before, eng.partCount());
    }
    return eng;
  }

  // ---------- Cylinder Block ----------
  static buildBlock(t) {
    const bore = SPECS.bore_mm / 1000;
    const stroke = SPECS.stroke_mm / 1000;
    const cylSpacing = bore * 1.20;
    const blockLen = cylSpacing * 3 + 0.080;

    // Main block casting (aluminum, open-deck, ~60° V)
    const block = PrimitiveBuilder.box(0.55, 0.36, blockLen);
    const blockShellVol = (0.55 * 0.36 * blockLen) * 0.35;  // ~35% material (open-deck + waterjackets)
    block.volume = () => blockShellVol;
    block._isShell = true;
    t.addPart(block, 'Cylinder Block (Aluminum, Open-Deck V6 60°)', {
      color: 0xa8a8b0,
      position: new Vec3(0, 0.18, 0),
      material: 'Aluminum 6061-T6',
      category: 'BLK', subsystem: 'CST',
      metadata: { vAngle_deg: 60, deckType: 'open', material: 'A380 die-cast', semiClosed_waterjacket: true },
    });

    // 6 cylinder liners (cast-iron, press-fit; reduce friction)
    for (let i = 0; i < 6; i++) {
      const bank = i < 3 ? -1 : 1;
      const cyl = i % 3;
      const liner = PrimitiveBuilder.cylinderShell(bore / 2 + 0.003, bore / 2, 0.15, 32);
      t.addPart(liner, `Cylinder Liner ${cyl + 1}-${bank > 0 ? 'B' : 'A'}`, {
        color: 0x303030,
        position: new Vec3(bank * 0.075, 0.22, -cylSpacing + cyl * cylSpacing),
        rotation: new Vec3(0, 0, bank * (SPECS.vAngle_deg / 2) * PI / 180),
        material: 'Cast Iron',
        category: 'BLK', subsystem: 'LNR',
      });
    }

    // 4 main bearing caps (forged steel, cross-bolted)
    for (let i = 0; i < 4; i++) {
      const cap = PrimitiveBuilder.box(0.10, 0.05, 0.06);
      t.addPart(cap, `Main Bearing Cap ${i + 1} (Cross-Bolted)`, {
        color: 0x707080,
        position: new Vec3(0, 0.05, -cylSpacing * 1.5 + i * cylSpacing),
        material: 'Steel AISI 4340',
        category: 'BLK', subsystem: 'MBC',
        metadata: { boltCircle: 'cross-bolted', preload_kN: 60 },
      });
    }

    // Block heater core, cylinder-bore deck plate (top deck), oil galleries embedded — model the deck plate
    const deckPlate = PrimitiveBuilder.box(0.50, 0.012, blockLen - 0.040);
    deckPlate._isShell = true;
    deckPlate.volume = () => 0.50 * 0.012 * (blockLen - 0.040) * 0.5;
    t.addPart(deckPlate, 'Block Top Deck Plate (Bore deck)', {
      color: 0x8a8a90,
      position: new Vec3(0, 0.36, 0),
      material: 'Aluminum 6061-T6',
      category: 'BLK', subsystem: 'DCK',
    });
  }

  // ---------- Cylinder Heads ----------
  static buildHeads(t) {
    const headLen = 0.50;
    for (let bank = 0; bank < 2; bank++) {
      const sign = bank === 0 ? -1 : 1;
      // Main head casting
      const head = PrimitiveBuilder.box(0.20, 0.13, headLen);
      const v = 0.20 * 0.13 * headLen * 0.40;  // 40% material (ports + valves + cooling)
      head.volume = () => v;
      head._isShell = true;
      t.addPart(head, `Cylinder Head ${bank === 0 ? 'A' : 'B'} (DOHC 24-V Atkinson)`, {
        color: 0xb0b0b8,
        position: new Vec3(sign * 0.25, 0.42, 0),
        rotation: new Vec3(0, 0, sign * (SPECS.vAngle_deg / 2) * PI / 180),
        material: 'Aluminum 6061-T6',
        category: 'HEAD', subsystem: 'CST',
        metadata: {
          combustionChamber: 'pent-roof, 4-valve',
          spark: 'central (D-4S compatible)',
          cooling: 'cross-flow waterjacket',
        },
      });

      // Head gasket (multi-layer steel)
      const gasket = PrimitiveBuilder.box(0.20, 0.0008, headLen);
      t.addPart(gasket, `Head Gasket Bank ${bank === 0 ? 'A' : 'B'} (MLS)`, {
        color: 0x404040,
        position: new Vec3(sign * 0.25, 0.36, 0),
        material: 'Stainless Steel 316',
        category: 'HEAD', subsystem: 'GSK',
      });

      // Valve cover (cast magnesium)
      const cover = PrimitiveBuilder.box(0.18, 0.06, headLen - 0.020);
      cover._isShell = true;
      cover.volume = () => 0.18 * 0.06 * (headLen - 0.020) * 0.10;  // very thin shell
      t.addPart(cover, `Valve Cover Bank ${bank === 0 ? 'A' : 'B'}`, {
        color: 0x303030,
        position: new Vec3(sign * 0.25, 0.51, 0),
        material: 'Aluminum 6061-T6',
        category: 'HEAD', subsystem: 'COV',
      });
    }
  }

  // ---------- Crankshaft + Mains ----------
  static buildCrankshaft(t) {
    const crankLen = 0.50;
    // Main crankshaft (forged steel, fully machined)
    const crank = PrimitiveBuilder.cylinder(0.030, crankLen, 32);
    t.addPart(crank, 'Crankshaft (Forged 4140 Steel, 6-throw)', {
      color: 0x707080,
      position: new Vec3(0, 0.10, 0),
      material: 'Steel AISI 4340',
      category: 'CRNK', subsystem: 'SFT',
      metadata: {
        balanced_grade: 'G1.0', mainJournals: 4, rodJournals: 6,
        throwAngle_deg: 120, counterweights: 8,
        forging_spec: 'AMS 6414', fillet_finish: 'rolled', nitrided: true,
      },
    });

    // 8 counterweights (forged into crank but model separately for tree)
    for (let i = 0; i < 8; i++) {
      const cw = PrimitiveBuilder.cylinder(0.060, 0.025, 24);
      t.addPart(cw, `Crankshaft Counterweight ${i + 1}`, {
        color: 0x707080,
        position: new Vec3(0, 0.10, -0.20 + i * 0.05),
        material: 'Steel AISI 4340',
        category: 'CRNK', subsystem: 'CWT',
      });
    }

    // Main bearings (4 main + 1 thrust bearing)
    for (let i = 0; i < 4; i++) {
      const upper = PrimitiveBuilder.cylinderShell(0.030, 0.027, 0.022, 24);
      t.addPart(upper, `Main Bearing Upper Half ${i + 1}`, {
        color: 0xc0a060,
        material: 'Copper C11000',  // tri-metal: lead-bronze on steel back
        category: 'BRG', subsystem: 'MBU',
        metadata: { type: 'tri-metal lead-bronze', clearance_um: 25 },
      });
      const lower = PrimitiveBuilder.cylinderShell(0.030, 0.027, 0.022, 24);
      t.addPart(lower, `Main Bearing Lower Half ${i + 1}`, {
        color: 0xc0a060,
        material: 'Copper C11000',
        category: 'BRG', subsystem: 'MBL',
      });
    }

    // Thrust washers (×2 — fore + aft)
    for (let i = 0; i < 2; i++) {
      const thrust = PrimitiveBuilder.cylinderShell(0.040, 0.030, 0.003, 24);
      t.addPart(thrust, `Thrust Bearing Washer ${i + 1}`, {
        color: 0xc0a060,
        material: 'Copper C11000',
        category: 'BRG', subsystem: 'THR',
      });
    }

    // Crank pulley (front) + reluctor ring
    const pulley = PrimitiveBuilder.cylinder(0.080, 0.025, 32);
    t.addPart(pulley, 'Crankshaft Front Damper Pulley (TVD)', {
      color: 0x707070,
      position: new Vec3(0, 0.10, -crankLen / 2 - 0.020),
      material: 'Steel AISI 4340',
      category: 'CRNK', subsystem: 'PUL',
      metadata: { type: 'torsional vibration damper', rubberInsert: true },
    });
    const reluctor = PrimitiveBuilder.cylinder(0.060, 0.005, 36);
    t.addPart(reluctor, 'Crank Position Reluctor Ring (36-1 tooth)', {
      color: 0x404040,
      material: 'Steel AISI 1020',
      category: 'CRNK', subsystem: 'REL',
    });

    // Flywheel / flexplate (interface to hybrid system)
    const flexplate = PrimitiveBuilder.cylinder(0.140, 0.008, 64);
    t.addPart(flexplate, 'Flexplate (interfaces to hybrid power-split)', {
      color: 0x707080,
      position: new Vec3(0, 0.10, crankLen / 2 + 0.020),
      material: 'Steel AISI 4340',
      category: 'CRNK', subsystem: 'FLX',
    });
  }

  // ---------- Connecting Rods ----------
  static buildConnectingRods(t) {
    for (let i = 0; i < SPECS.cylinders; i++) {
      const bank = i < 3 ? 0 : 1;
      const cyl = i % 3;
      const sign = bank === 0 ? -1 : 1;
      // Forged H-beam rod
      const rod = PrimitiveBuilder.box(0.022, 0.140, 0.025);
      t.addPart(rod, `Connecting Rod ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0x808088,
        position: new Vec3(sign * 0.05, 0.18, -0.18 + cyl * 0.12),
        material: 'Steel AISI 4340',
        category: 'ROD', subsystem: 'BDY',
        metadata: {
          type: 'forged H-beam', cracked_cap: true,
          big_end_dia_mm: 50, small_end_dia_mm: 24,
        },
      });
      // Big-end cap (cracked-style)
      const cap = PrimitiveBuilder.box(0.030, 0.020, 0.025);
      t.addPart(cap, `Rod Big-End Cap ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0x707070,
        material: 'Steel AISI 4340',
        category: 'ROD', subsystem: 'CAP',
      });
      // Big-end bearing (×2 halves)
      for (let h = 0; h < 2; h++) {
        const brg = PrimitiveBuilder.cylinderShell(0.025, 0.022, 0.022, 24);
        t.addPart(brg, `Rod Bearing Half ${cyl + 1}-${bank === 0 ? 'A' : 'B'} ${h === 0 ? 'Up' : 'Lo'}`, {
          color: 0xc0a060,
          material: 'Copper C11000',
          category: 'BRG', subsystem: 'ROD',
        });
      }
      // Wrist pin (small-end pin)
      const pin = PrimitiveBuilder.cylinder(0.012, 0.060, 16);
      t.addPart(pin, `Wrist Pin ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0x808080,
        material: 'Steel AISI 4340',
        category: 'ROD', subsystem: 'PIN',
        metadata: { type: 'fully-floating, retained by circlips', dia_mm: 24 },
      });
      // Pin bushing (small-end)
      const bush = PrimitiveBuilder.cylinderShell(0.013, 0.012, 0.025, 16);
      t.addPart(bush, `Small-End Bushing ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0xb86d3a,
        material: 'Copper C11000',
        category: 'BRG', subsystem: 'BUS',
      });
    }
  }

  // ---------- Pistons + Rings ----------
  static buildPistons(t) {
    for (let i = 0; i < SPECS.cylinders; i++) {
      const bank = i < 3 ? 0 : 1;
      const cyl = i % 3;
      const sign = bank === 0 ? -1 : 1;
      // Aluminum forged piston (low-friction skirt coating)
      const piston = PrimitiveBuilder.cylinder(SPECS.bore_mm / 2 / 1000 - 0.0003, 0.060, 32);
      t.addPart(piston, `Piston ${cyl + 1}-${bank === 0 ? 'A' : 'B'} (forged AlSi)`, {
        color: 0xc8c8d0,
        position: new Vec3(sign * 0.075, 0.27, -0.18 + cyl * 0.12),
        material: 'Aluminum 6061-T6',
        category: 'PIST', subsystem: 'BDY',
        metadata: {
          type: 'forged eutectic AlSi (4032)',
          crown: 'recessed bowl for D-4S DI spray',
          coating: 'graphite-PTFE skirt',
          cooling_oil_jet: true,
        },
      });
      // Compression ring 1 (top)
      const ring1 = PrimitiveBuilder.torus(SPECS.bore_mm / 2 / 1000 - 0.0001, 0.0008, 32, 8);
      t.addPart(ring1, `Top Compression Ring ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0x404040,
        material: 'Cast Iron',
        category: 'PIST', subsystem: 'RG1',
        metadata: { coating: 'plasma chromium', height_mm: 1.2 },
      });
      // Compression ring 2 (second)
      const ring2 = PrimitiveBuilder.torus(SPECS.bore_mm / 2 / 1000 - 0.0001, 0.0008, 32, 8);
      t.addPart(ring2, `Second Compression Ring ${cyl + 1}-${bank === 0 ? 'A' : 'B'}`, {
        color: 0x505050,
        material: 'Cast Iron',
        category: 'PIST', subsystem: 'RG2',
      });
      // Oil control ring (3-piece)
      for (let p = 0; p < 3; p++) {
        const oilRing = PrimitiveBuilder.torus(SPECS.bore_mm / 2 / 1000 - 0.0001, 0.0006, 32, 8);
        t.addPart(oilRing, `Oil Control Ring ${cyl + 1}-${bank === 0 ? 'A' : 'B'} pc${p + 1}`, {
          color: 0x606060,
          material: 'Cast Iron',
          category: 'PIST', subsystem: 'RGO',
        });
      }
      // Circlip (×2, retains wrist pin)
      for (let c = 0; c < 2; c++) {
        const clip = PrimitiveBuilder.torus(0.012, 0.0005, 16, 8);
        t.addPart(clip, `Wrist-Pin Circlip ${cyl + 1}-${bank === 0 ? 'A' : 'B'} ${c + 1}`, {
          color: 0x808080,
          material: 'Steel AISI 4340',
          category: 'PIST', subsystem: 'CLP',
        });
      }
    }
  }

  // ---------- Camshafts + Cam Bearings ----------
  static buildCamshafts(t) {
    // 2 banks × 2 cams (intake + exhaust) = 4 camshafts
    for (let bank = 0; bank < 2; bank++) {
      for (let type = 0; type < 2; type++) {
        const isIntake = type === 0;
        const camName = `Camshaft ${bank === 0 ? 'A' : 'B'}-${isIntake ? 'IN' : 'EX'}`;
        const cam = PrimitiveBuilder.cylinder(0.018, 0.50, 24);
        t.addPart(cam, `${camName} (assembled, hollow)`, {
          color: 0x808088,
          material: 'Steel AISI 4340',
          category: 'CAM', subsystem: isIntake ? 'IN' : 'EX',
          metadata: {
            type: 'assembled hollow camshaft (lobes shrink-fit)',
            lobes: 6,  // 1 per cylinder per cam type
            lift_mm: isIntake ? 9.5 : 8.8,
            duration_deg: isIntake ? 248 : 232,
          },
        });
        // 6 cam lobes per camshaft (1 per cylinder)
        for (let i = 0; i < 6; i++) {
          const lobe = PrimitiveBuilder.cylinder(0.025, 0.012, 16);
          t.addPart(lobe, `${camName} Lobe ${i + 1}`, {
            color: 0x707078,
            material: 'Steel AISI 4340',
            category: 'CAM', subsystem: 'LBE',
            metadata: { hardened: 'induction', Ra_um: 0.4 },
          });
        }
        // Cam bearings (5 per shaft)
        for (let b = 0; b < 5; b++) {
          const bearing = PrimitiveBuilder.cylinderShell(0.022, 0.018, 0.018, 16);
          t.addPart(bearing, `${camName} Bearing ${b + 1}`, {
            color: 0xc0a060,
            material: 'Copper C11000',
            category: 'BRG', subsystem: 'CAM',
          });
        }
      }
    }
  }

  // ---------- Valvetrain ----------
  static buildValvetrain(t) {
    // 24 valves: 12 intake + 12 exhaust (2 per type per cylinder × 6 cyl)
    for (let i = 0; i < SPECS.cylinders; i++) {
      const bank = i < 3 ? 0 : 1;
      const cyl = i % 3;
      // 2 intake + 2 exhaust per cylinder
      for (let v = 0; v < 4; v++) {
        const isIntake = v < 2;
        const valveName = `Valve ${cyl + 1}-${bank === 0 ? 'A' : 'B'}-${isIntake ? 'IN' : 'EX'}-${(v % 2) + 1}`;
        const valve = PrimitiveBuilder.cylinder(0.018, 0.090, 16);
        t.addPart(valve, valveName, {
          color: isIntake ? 0xc0c0c8 : 0x40383a,
          material: isIntake ? 'Stainless Steel 316' : 'Inconel 718',
          category: 'VLV', subsystem: isIntake ? 'IN' : 'EX',
          metadata: {
            type: 'mono-metallic',
            head_dia_mm: isIntake ? 32 : 28,
            stem_dia_mm: 5.5,
            seat_angle: 45,
            sodium_filled: !isIntake,  // Na-filled exhaust valves
          },
        });
        // Valve spring
        const spring = PrimitiveBuilder.cylinderShell(0.012, 0.010, 0.040, 16);
        t.addPart(spring, `Valve Spring ${valveName}`, {
          color: 0x808088,
          material: 'Steel AISI 4340',
          category: 'VTR', subsystem: 'SPR',
          metadata: { type: 'beehive', preload_N: 280, max_lift_N: 580 },
        });
        // Valve retainer (collet + cap)
        const retainer = PrimitiveBuilder.cylinder(0.013, 0.008, 16);
        t.addPart(retainer, `Valve Retainer ${valveName}`, {
          color: 0x707080,
          material: 'Steel AISI 4340',
          category: 'VTR', subsystem: 'RET',
        });
        // Hydraulic lifter / lash adjuster (low-friction)
        const lifter = PrimitiveBuilder.cylinder(0.016, 0.025, 16);
        t.addPart(lifter, `Hydraulic Lifter ${valveName}`, {
          color: 0x909098,
          material: 'Steel AISI 4340',
          category: 'VTR', subsystem: 'LFT',
          metadata: { type: 'roller-finger follower (RFF) on hydraulic lash adjuster' },
        });
        // Valve seat insert
        const seat = PrimitiveBuilder.torus(0.015, 0.0015, 16, 8);
        t.addPart(seat, `Valve Seat Insert ${valveName}`, {
          color: 0x404040,
          material: 'Inconel 718',
          category: 'VTR', subsystem: 'SET',
        });
        // Valve stem seal
        const stemSeal = PrimitiveBuilder.cylinder(0.007, 0.008, 16);
        t.addPart(stemSeal, `Valve Stem Seal ${valveName}`, {
          color: 0x202020,
          material: 'Nylon 6/6',
          category: 'VTR', subsystem: 'STM',
        });
        // Valve guide
        const guide = PrimitiveBuilder.cylinderShell(0.0085, 0.0028, 0.040, 16);
        t.addPart(guide, `Valve Guide ${valveName}`, {
          color: 0x808088,
          material: 'Cast Iron',
          category: 'VTR', subsystem: 'GUD',
        });
      }
    }
  }

  // ---------- VVT-iE Cam Phasers ----------
  static buildVVT(t) {
    // 4 cam phasers (intake + exhaust per bank, intake is electric VVT-iE)
    for (let bank = 0; bank < 2; bank++) {
      for (let type = 0; type < 2; type++) {
        const isIntake = type === 0;
        const phaserName = `VVT Phaser ${bank === 0 ? 'A' : 'B'}-${isIntake ? 'IN-iE' : 'EX'}`;
        const phaser = PrimitiveBuilder.cylinder(0.040, 0.030, 32);
        t.addPart(phaser, phaserName, {
          color: 0x707080,
          material: 'Aluminum 6061-T6',
          category: 'VVT', subsystem: isIntake ? 'iE' : 'HYD',
          metadata: {
            type: isIntake ? 'electric (VVT-iE motor-driven)' : 'hydraulic (oil-controlled)',
            range_deg: isIntake ? 70 : 50,
            speed_response_deg_s: isIntake ? 200 : 80,
          },
        });
        // For electric VVT-iE: motor + reduction gear
        if (isIntake) {
          const motor = PrimitiveBuilder.cylinder(0.030, 0.040, 24);
          t.addPart(motor, `VVT-iE Motor Bank ${bank === 0 ? 'A' : 'B'}`, {
            color: 0x303040,
            material: 'Aluminum 6061-T6',
            category: 'VVT', subsystem: 'MTR',
          });
          const gear = PrimitiveBuilder.cylinder(0.038, 0.012, 32);
          t.addPart(gear, `VVT-iE Reduction Gear Bank ${bank === 0 ? 'A' : 'B'}`, {
            color: 0x808080,
            material: 'Steel AISI 4340',
            category: 'VVT', subsystem: 'GER',
          });
        }
      }
    }
  }

  // ---------- Timing System ----------
  static buildTimingSystem(t) {
    // Primary timing chain (drives intake cam from crank)
    const chain1 = PrimitiveBuilder.torus(0.080, 0.005, 64, 8);
    t.addPart(chain1, 'Primary Timing Chain (silent, 1/4-inch pitch)', {
      color: 0x404040,
      material: 'Steel AISI 4340',
      category: 'TIM', subsystem: 'CHN',
      metadata: { type: 'silent inverted-tooth', pitch_mm: 9.5, plates: 6 },
    });
    // Secondary timing chains (cam-to-cam, 2 — 1 per bank)
    for (let bank = 0; bank < 2; bank++) {
      const chain2 = PrimitiveBuilder.torus(0.040, 0.004, 48, 8);
      t.addPart(chain2, `Secondary Timing Chain Bank ${bank === 0 ? 'A' : 'B'}`, {
        color: 0x404040,
        material: 'Steel AISI 4340',
        category: 'TIM', subsystem: 'CHN',
      });
    }
    // Sprockets: crank, cam (×4), oil pump, balance shaft
    const sprocketLocations = [
      'Crank Drive Sprocket', 'Cam Sprocket A-IN', 'Cam Sprocket A-EX',
      'Cam Sprocket B-IN', 'Cam Sprocket B-EX', 'Oil Pump Drive Sprocket',
    ];
    for (const name of sprocketLocations) {
      const spr = PrimitiveBuilder.cylinder(0.030, 0.012, 32);
      t.addPart(spr, name, {
        color: 0x707080,
        material: 'Steel AISI 4340',
        category: 'TIM', subsystem: 'SPR',
      });
    }
    // Hydraulic chain tensioners (3 — 1 primary + 2 secondary)
    for (let i = 0; i < 3; i++) {
      const tens = PrimitiveBuilder.cylinder(0.018, 0.060, 16);
      t.addPart(tens, `Chain Tensioner ${i + 1} (hydraulic)`, {
        color: 0x808080,
        material: 'Steel AISI 4340',
        category: 'TIM', subsystem: 'TNS',
      });
    }
    // Chain guides (×6)
    for (let i = 0; i < 6; i++) {
      const guide = PrimitiveBuilder.box(0.012, 0.20, 0.020);
      t.addPart(guide, `Chain Guide ${i + 1}`, {
        color: 0x202020,
        material: 'Nylon 6/6',
        category: 'TIM', subsystem: 'GDE',
      });
    }
  }

  // ---------- Oil System ----------
  static buildOilSystem(t) {
    // Oil pump (gerotor, variable-flow)
    const pump = PrimitiveBuilder.cylinder(0.045, 0.060, 32);
    t.addPart(pump, 'Variable-Flow Oil Pump (Gerotor + Solenoid Control)', {
      color: 0x808088,
      material: 'Aluminum 6061-T6',
      category: 'OIL', subsystem: 'PMP',
      metadata: {
        type: 'electronically controlled vari-flow gerotor',
        max_pressure_bar: 5.5, idle_pressure_bar: 1.0,
      },
    });
    // Oil filter housing + cartridge
    const filterHousing = PrimitiveBuilder.cylinder(0.045, 0.090, 32);
    t.addPart(filterHousing, 'Oil Filter Housing (Cartridge-style)', {
      color: 0x707080,
      material: 'Aluminum 6061-T6',
      category: 'OIL', subsystem: 'FLT',
    });
    const filterElem = PrimitiveBuilder.cylinderShell(0.040, 0.020, 0.075, 24);
    t.addPart(filterElem, 'Oil Filter Element (cellulose + synthetic)', {
      color: 0xeeb060,
      material: 'Nylon 6/6',
      category: 'OIL', subsystem: 'ELM',
    });
    // Oil cooler (water-cooled stacked-plate)
    const cooler = PrimitiveBuilder.box(0.10, 0.040, 0.080);
    cooler._isShell = true;
    cooler.volume = () => 0.10 * 0.040 * 0.080 * 0.30;
    t.addPart(cooler, 'Oil Cooler (Water-Cooled Stacked-Plate)', {
      color: 0xa0a0a0,
      material: 'Aluminum 6061-T6',
      category: 'OIL', subsystem: 'COL',
    });
    // Pickup tube + screen
    const pickup = PrimitiveBuilder.cylinder(0.012, 0.150, 16);
    t.addPart(pickup, 'Oil Pickup Tube + Screen', {
      color: 0x808080,
      material: 'Stainless Steel 316',
      category: 'OIL', subsystem: 'PKP',
    });
    // Oil cooling jets / piston squirters (×6)
    for (let i = 0; i < 6; i++) {
      const jet = PrimitiveBuilder.cylinder(0.005, 0.025, 12);
      t.addPart(jet, `Piston Cooling Jet ${i + 1}`, {
        color: 0x707080,
        material: 'Stainless Steel 316',
        category: 'OIL', subsystem: 'JET',
      });
    }
    // Oil pressure sensor
    const oilP = PrimitiveBuilder.cylinder(0.012, 0.030, 16);
    t.addPart(oilP, 'Oil Pressure Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'OIP',
    });
    // Oil temperature sensor
    const oilT = PrimitiveBuilder.cylinder(0.008, 0.025, 12);
    t.addPart(oilT, 'Oil Temperature Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'OIT',
    });
  }

  // ---------- Cooling System ----------
  static buildCoolingSystem(t) {
    // Water pump (electric, 24V — for hybrid efficiency)
    const wp = PrimitiveBuilder.cylinder(0.060, 0.080, 32);
    t.addPart(wp, 'Water Pump (Electric, 250 W BLDC)', {
      color: 0x303040,
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'PMP',
      metadata: { type: 'electric BLDC', flow_Lmin: 130, head_kPa: 200 },
    });
    // Thermostat (electronic — variable temp control for hybrid efficiency)
    const therm = PrimitiveBuilder.cylinder(0.030, 0.040, 16);
    t.addPart(therm, 'Electronic Thermostat (Variable Open Temp)', {
      color: 0x707080,
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'THR',
      metadata: { open_temp_C: 'variable 85-105', solenoid_control: true },
    });
    // Coolant manifold/crossover
    const xover = PrimitiveBuilder.cylinderShell(0.025, 0.022, 0.20, 16);
    t.addPart(xover, 'Coolant Crossover Manifold', {
      color: 0x808080,
      material: 'Aluminum 6061-T6',
      category: 'COOL', subsystem: 'XOV',
    });
    // Coolant temperature sensor (×2 — block + head)
    for (let i = 0; i < 2; i++) {
      const ect = PrimitiveBuilder.cylinder(0.008, 0.025, 12);
      t.addPart(ect, `Engine Coolant Temp Sensor ${i + 1}`, {
        color: 0x404040, material: 'Stainless Steel 316',
        category: 'SNS', subsystem: 'ECT',
      });
    }
    // Hoses (×8 — main, EGR, heater, oil cooler, etc.)
    for (let i = 0; i < 8; i++) {
      const hose = PrimitiveBuilder.cylinderShell(0.018, 0.014, 0.20, 16);
      t.addPart(hose, `Coolant Hose ${i + 1}`, {
        color: 0x202020, material: 'Nylon 6/6',
        category: 'COOL', subsystem: 'HOS',
      });
    }
    // Drain plugs
    for (let i = 0; i < 2; i++) {
      const plug = PrimitiveBuilder.cylinder(0.008, 0.012, 12);
      t.addPart(plug, `Coolant Drain Plug ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'COOL', subsystem: 'DRN',
      });
    }
  }

  // ---------- Intake System ----------
  static buildIntakeSystem(t) {
    // Intake manifold (composite, with variable-length runners)
    const manifold = PrimitiveBuilder.box(0.30, 0.10, 0.40);
    manifold._isShell = true;
    manifold.volume = () => 0.30 * 0.10 * 0.40 * 0.15;  // hollow plenum + runners
    t.addPart(manifold, 'Intake Manifold (Composite, Variable-Length Runners)', {
      color: 0x303030,
      material: 'Nylon 6/6',
      category: 'INT', subsystem: 'MAN',
      metadata: { type: 'long-runner Atkinson tuning', plenum_L: 4.5, runner_length_mm: 380 },
    });
    // Throttle body (electronic, 70mm)
    const throttle = PrimitiveBuilder.cylinder(0.040, 0.060, 32);
    t.addPart(throttle, 'Electronic Throttle Body (70 mm)', {
      color: 0x707080,
      material: 'Aluminum 6061-T6',
      category: 'INT', subsystem: 'THR',
      metadata: { type: 'drive-by-wire, dual-axis position sensor' },
    });
    // 6 intake runners (variable length)
    for (let i = 0; i < 6; i++) {
      const runner = PrimitiveBuilder.cylinderShell(0.020, 0.018, 0.150, 16);
      t.addPart(runner, `Intake Runner ${i + 1}`, {
        color: 0x404040,
        material: 'Nylon 6/6',
        category: 'INT', subsystem: 'RUN',
      });
    }
    // Variable-runner control valve + actuator
    const acrv = PrimitiveBuilder.box(0.060, 0.030, 0.030);
    t.addPart(acrv, 'Variable Runner Control Actuator', {
      color: 0x303030, material: 'Aluminum 6061-T6',
      category: 'INT', subsystem: 'ACR',
    });
    // Air filter housing + element
    const airbox = PrimitiveBuilder.box(0.30, 0.15, 0.25);
    airbox._isShell = true;
    airbox.volume = () => 0.30 * 0.15 * 0.25 * 0.10;
    t.addPart(airbox, 'Air Cleaner Housing', {
      color: 0x202020, material: 'Nylon 6/6',
      category: 'INT', subsystem: 'BOX',
    });
    const airElem = PrimitiveBuilder.box(0.20, 0.08, 0.18);
    airElem._isShell = true;
    airElem.volume = () => 0.20 * 0.08 * 0.18 * 0.20;
    t.addPart(airElem, 'Air Filter Element (Pleated)', {
      color: 0xeeb060, material: 'Nylon 6/6',
      category: 'INT', subsystem: 'FLT',
    });
    // Mass air flow + intake air temp sensors
    const maf = PrimitiveBuilder.cylinder(0.025, 0.040, 16);
    t.addPart(maf, 'Mass Air Flow Sensor (Hot-Wire)', {
      color: 0x404040, material: 'Aluminum 6061-T6',
      category: 'SNS', subsystem: 'MAF',
    });
    const iat = PrimitiveBuilder.cylinder(0.005, 0.020, 12);
    t.addPart(iat, 'Intake Air Temp Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'IAT',
    });
    const map = PrimitiveBuilder.cylinder(0.012, 0.025, 16);
    t.addPart(map, 'Manifold Absolute Pressure (MAP) Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'MAP',
    });
  }

  // ---------- Exhaust + Emissions ----------
  static buildExhaustEmissions(t) {
    // 2 exhaust manifolds (cast stainless, integrated turbo flange even though NA)
    for (let bank = 0; bank < 2; bank++) {
      const manifold = PrimitiveBuilder.box(0.080, 0.080, 0.40);
      manifold._isShell = true;
      manifold.volume = () => 0.080 * 0.080 * 0.40 * 0.20;
      t.addPart(manifold, `Exhaust Manifold Bank ${bank === 0 ? 'A' : 'B'}`, {
        color: 0x707080,
        material: 'Stainless Steel 316',
        category: 'EXH', subsystem: 'MAN',
        metadata: {
          type: 'cast 1.4848 stainless, log-style for close-coupled cat',
          temp_max_C: 950,
        },
      });

      // Close-coupled three-way catalyst (one per bank)
      const ccCat = PrimitiveBuilder.cylinder(0.060, 0.180, 32);
      ccCat._isShell = true;
      ccCat.volume = () => Math.PI * 0.060 * 0.060 * 0.180 * 0.55;  // honeycomb fill ~55%
      t.addPart(ccCat, `Close-Coupled 3-Way Catalyst Bank ${bank === 0 ? 'A' : 'B'}`, {
        color: 0xc09040,
        material: 'CMC SiC/SiC',  // approximation for cordierite/Pt-Pd-Rh substrate
        category: 'EMIS', subsystem: 'TWC',
        metadata: {
          type: 'Pt-Pd-Rh 3-way catalyst',
          substrate: 'cordierite 600 cpsi',
          loading_g_ft3: 80,
          light_off_C: 180,
          conversion_eff_pct: 99.5,
        },
      });
    }

    // 4 wide-band (UEGO) and 2 narrow-band O2 sensors
    for (let i = 0; i < 4; i++) {
      const o2 = PrimitiveBuilder.cylinder(0.010, 0.040, 16);
      t.addPart(o2, `Wide-Band O2 Sensor ${i + 1} (UEGO, ${i < 2 ? 'pre-cat' : 'post-cat'})`, {
        color: 0x808088,
        material: 'Inconel 718',
        category: 'SNS', subsystem: 'O2W',
      });
    }

    // Underfloor catalyst (combined NOx-trap + 3-way)
    const ufCat = PrimitiveBuilder.cylinder(0.080, 0.250, 32);
    ufCat._isShell = true;
    ufCat.volume = () => Math.PI * 0.080 * 0.080 * 0.250 * 0.55;
    t.addPart(ufCat, 'Underfloor Combined NOx-Trap + 3-Way Catalyst', {
      color: 0xb09030,
      material: 'CMC SiC/SiC',
      category: 'EMIS', subsystem: 'UFC',
      metadata: {
        type: 'NOx-storage cat (NSC) + Rh-rich 3-way',
        function: 'lean-burn NOx adsorption + rich-spike regeneration',
      },
    });

    // Gasoline particulate filter (GPF) — required for direct injection compliance
    const gpf = PrimitiveBuilder.cylinder(0.080, 0.220, 32);
    gpf._isShell = true;
    gpf.volume = () => Math.PI * 0.080 * 0.080 * 0.220 * 0.55;
    t.addPart(gpf, 'Gasoline Particulate Filter (GPF, Coated Wall-Flow)', {
      color: 0xe0d0a0,
      material: 'CMC SiC/SiC',
      category: 'EMIS', subsystem: 'GPF',
      metadata: {
        type: 'cordierite wall-flow with 3-way coating',
        cell_density_cpsi: 300,
        filtration_eff_pct: 95,
      },
    });

    // Differential pressure sensor (GPF soot loading)
    const dp = PrimitiveBuilder.cylinder(0.012, 0.030, 16);
    t.addPart(dp, 'GPF Differential Pressure Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'DPF',
    });

    // Exhaust gas temp sensors (×3 — pre-CC cat, post-CC cat, post-GPF)
    for (let i = 0; i < 3; i++) {
      const egt = PrimitiveBuilder.cylinder(0.008, 0.040, 12);
      t.addPart(egt, `EGT Sensor ${i + 1} (${i === 0 ? 'pre-CC' : i === 1 ? 'post-CC' : 'post-GPF'})`, {
        color: 0x808080, material: 'Inconel 718',
        category: 'SNS', subsystem: 'EGT',
      });
    }

    // Exhaust pipes (×4 segments)
    for (let i = 0; i < 4; i++) {
      const pipe = PrimitiveBuilder.cylinderShell(0.030, 0.028, 0.40, 24);
      t.addPart(pipe, `Exhaust Pipe Segment ${i + 1}`, {
        color: 0x606060,
        material: 'Stainless Steel 316',
        category: 'EXH', subsystem: 'PIP',
      });
    }

    // Muffler (2-stage active)
    const muffler = PrimitiveBuilder.cylinderShell(0.090, 0.085, 0.45, 32);
    t.addPart(muffler, 'Muffler (2-Stage with Active Valve)', {
      color: 0x606060,
      material: 'Stainless Steel 316',
      category: 'EXH', subsystem: 'MUF',
    });

    // Tailpipe finishers (×2, dual exhaust)
    for (let i = 0; i < 2; i++) {
      const tip = PrimitiveBuilder.cylinderShell(0.045, 0.042, 0.10, 24);
      t.addPart(tip, `Tailpipe Tip ${i + 1} (Polished Stainless)`, {
        color: 0xc0c0c8,
        material: 'Stainless Steel 316',
        category: 'EXH', subsystem: 'TIP',
      });
    }

    // Exhaust hangers (×6)
    for (let i = 0; i < 6; i++) {
      const hanger = PrimitiveBuilder.box(0.020, 0.010, 0.040);
      t.addPart(hanger, `Exhaust Hanger ${i + 1} (Rubber Isolated)`, {
        color: 0x202020,
        material: 'Nylon 6/6',
        category: 'EXH', subsystem: 'HNG',
      });
    }
  }

  // ---------- Cooled EGR ----------
  static buildEGR(t) {
    // EGR cooler (water-cooled, stainless)
    const cooler = PrimitiveBuilder.box(0.10, 0.040, 0.060);
    cooler._isShell = true;
    cooler.volume = () => 0.10 * 0.040 * 0.060 * 0.40;
    t.addPart(cooler, 'EGR Cooler (Water-Cooled Stacked-Plate)', {
      color: 0xa0a0a8,
      material: 'Stainless Steel 316',
      category: 'EMIS', subsystem: 'EGC',
      metadata: { effectiveness: 0.92, max_flow_kgmin: 8 },
    });
    // EGR control valve (electronic)
    const valve = PrimitiveBuilder.cylinder(0.030, 0.060, 24);
    t.addPart(valve, 'EGR Control Valve (Electronic)', {
      color: 0x707080,
      material: 'Stainless Steel 316',
      category: 'EMIS', subsystem: 'EGV',
      metadata: { type: 'pintle, stepper-motor actuated' },
    });
    // EGR routing pipes
    for (let i = 0; i < 3; i++) {
      const pipe = PrimitiveBuilder.cylinderShell(0.022, 0.020, 0.20, 16);
      t.addPart(pipe, `EGR Pipe ${i + 1}`, {
        color: 0x808080, material: 'Stainless Steel 316',
        category: 'EMIS', subsystem: 'EPI',
      });
    }
    // EGR temperature sensor + delta-pressure sensor
    const egrT = PrimitiveBuilder.cylinder(0.008, 0.025, 12);
    t.addPart(egrT, 'EGR Gas Temperature Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'EGT2',
    });
  }

  // ---------- D-4S Fuel System ----------
  static buildFuelSystem(t) {
    // 6 direct-injection injectors (high-pressure, side-mounted)
    for (let i = 0; i < 6; i++) {
      const di = PrimitiveBuilder.cylinder(0.012, 0.090, 24);
      t.addPart(di, `D-4S DI Injector ${i + 1}`, {
        color: 0xc0a040,
        material: 'Stainless Steel 316',
        category: 'FUEL', subsystem: 'DI',
        metadata: {
          type: 'side-mounted multi-hole DI',
          pressure_bar: 200, holes: 6, spray_angle_deg: 75,
        },
      });
    }
    // 6 port injectors (low-pressure, secondary)
    for (let i = 0; i < 6; i++) {
      const pi = PrimitiveBuilder.cylinder(0.010, 0.060, 24);
      t.addPart(pi, `D-4S Port Injector ${i + 1}`, {
        color: 0x808088,
        material: 'Stainless Steel 316',
        category: 'FUEL', subsystem: 'PI',
        metadata: { type: 'electromagnetic port', pressure_bar: 4 },
      });
    }
    // 2 fuel rails (DI high-pressure + PI low-pressure)
    for (let i = 0; i < 2; i++) {
      const rail = PrimitiveBuilder.cylinderShell(0.018, 0.014, 0.45, 16);
      t.addPart(rail, `Fuel Rail ${i === 0 ? 'DI (200 bar)' : 'PI (4 bar)'}`, {
        color: 0x808080,
        material: 'Stainless Steel 316',
        category: 'FUEL', subsystem: i === 0 ? 'RDI' : 'RPI',
      });
    }
    // High-pressure fuel pump (cam-driven)
    const hpfp = PrimitiveBuilder.cylinder(0.040, 0.080, 24);
    t.addPart(hpfp, 'High-Pressure Fuel Pump (Cam-Driven, 250 bar Capable)', {
      color: 0x808088,
      material: 'Stainless Steel 316',
      category: 'FUEL', subsystem: 'HPP',
    });
    // Low-pressure pump (in-tank, 4 bar)
    const lpfp = PrimitiveBuilder.cylinder(0.030, 0.080, 24);
    t.addPart(lpfp, 'Low-Pressure Fuel Pump (In-Tank, BLDC)', {
      color: 0x303040,
      material: 'Aluminum 6061-T6',
      category: 'FUEL', subsystem: 'LPP',
    });
    // Fuel pressure sensors (×2)
    for (let i = 0; i < 2; i++) {
      const fps = PrimitiveBuilder.cylinder(0.010, 0.025, 16);
      t.addPart(fps, `Fuel Pressure Sensor ${i === 0 ? 'DI (200 bar)' : 'PI'}`, {
        color: 0x404040, material: 'Stainless Steel 316',
        category: 'SNS', subsystem: 'FPS',
      });
    }
    // Fuel temp sensor
    const fts = PrimitiveBuilder.cylinder(0.008, 0.020, 12);
    t.addPart(fts, 'Fuel Temperature Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'FTS',
    });
  }

  // ---------- Ignition ----------
  static buildIgnition(t) {
    // 6 spark plugs (iridium, long-life)
    for (let i = 0; i < 6; i++) {
      const plug = PrimitiveBuilder.cylinder(0.008, 0.060, 16);
      t.addPart(plug, `Spark Plug ${i + 1} (Iridium-Pt 14 mm thread)`, {
        color: 0xc0c0c8,
        material: 'Stainless Steel 316',
        category: 'IGN', subsystem: 'PLG',
        metadata: { type: 'iridium-platinum, 0.6 mm tip', heat_range: 6, life_km: 160000 },
      });
      // 6 ignition coils (coil-on-plug, smart)
      const coil = PrimitiveBuilder.box(0.025, 0.080, 0.040);
      t.addPart(coil, `Ignition Coil ${i + 1} (Smart COP)`, {
        color: 0x202020,
        material: 'ABS Plastic',
        category: 'IGN', subsystem: 'COL',
        metadata: { peak_kV: 35, energy_mJ: 80 },
      });
    }
    // 2 knock sensors (broadband)
    for (let i = 0; i < 2; i++) {
      const knock = PrimitiveBuilder.cylinder(0.012, 0.020, 16);
      t.addPart(knock, `Knock Sensor Bank ${i === 0 ? 'A' : 'B'}`, {
        color: 0x404040, material: 'Stainless Steel 316',
        category: 'SNS', subsystem: 'KNK',
      });
    }
    // Crank position sensor (Hall, 36-1)
    const ckp = PrimitiveBuilder.cylinder(0.010, 0.025, 16);
    t.addPart(ckp, 'Crank Position Sensor (Hall, 36-1)', {
      color: 0x202020, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'CKP',
    });
    // Cam position sensors (×4)
    for (let i = 0; i < 4; i++) {
      const cmp = PrimitiveBuilder.cylinder(0.010, 0.025, 16);
      t.addPart(cmp, `Cam Position Sensor ${i + 1}`, {
        color: 0x202020, material: 'Stainless Steel 316',
        category: 'SNS', subsystem: 'CMP',
      });
    }
  }

  // ---------- Hybrid Drive ----------
  static buildHybridDrive(t) {
    // Power-split planetary gearset (input: ICE crank → carrier; ring → MG2 + driveline; sun → MG1)
    const carrier = PrimitiveBuilder.cylinder(0.080, 0.040, 32);
    t.addPart(carrier, 'Planetary Carrier (Power-Split Input from ICE)', {
      color: 0x707080, material: 'Steel AISI 4340',
      category: 'HYB', subsystem: 'CAR',
      metadata: { type: 'compound power-split THS-V transmission', planets: 4 },
    });
    // 4 planet gears
    for (let i = 0; i < 4; i++) {
      const planet = PrimitiveBuilder.cylinder(0.025, 0.030, 24);
      t.addPart(planet, `Planet Gear ${i + 1}`, {
        color: 0x808080, material: 'Steel AISI 4340',
        category: 'HYB', subsystem: 'PLT',
      });
    }
    // Sun gear (drives MG1)
    const sun = PrimitiveBuilder.cylinder(0.030, 0.030, 24);
    t.addPart(sun, 'Sun Gear (drives MG1)', {
      color: 0x808088, material: 'Steel AISI 4340',
      category: 'HYB', subsystem: 'SUN',
    });
    // Ring gear (drives MG2 + final drive)
    const ring = PrimitiveBuilder.cylinderShell(0.085, 0.078, 0.030, 64);
    t.addPart(ring, 'Ring Gear (drives MG2 + Final Drive)', {
      color: 0x808088, material: 'Steel AISI 4340',
      category: 'HYB', subsystem: 'RNG',
    });

    // MG1 — Generator + starter (smaller, high-speed)
    const mg1Stator = PrimitiveBuilder.cylinderShell(0.110, 0.085, 0.080, 48);
    t.addPart(mg1Stator, 'MG1 Stator (Distributed-Winding, ' + SPECS.MG1_kW + ' kW)', {
      color: 0xc0a040,
      material: 'Copper C11000',
      category: 'HYB', subsystem: 'M1S',
      metadata: { type: 'distributed winding, hairpin Cu', poles: 8 },
    });
    const mg1Rotor = PrimitiveBuilder.cylinder(0.080, 0.080, 32);
    t.addPart(mg1Rotor, 'MG1 Rotor (IPM Permanent Magnet, NdFeB)', {
      color: 0x303040,
      material: 'Steel AISI 1020',
      category: 'HYB', subsystem: 'M1R',
      metadata: { magnet: 'NdFeB N52H, V-shape buried' },
    });

    // MG2 — Traction motor (larger, high torque)
    const mg2Stator = PrimitiveBuilder.cylinderShell(0.150, 0.115, 0.120, 48);
    t.addPart(mg2Stator, 'MG2 Stator (' + SPECS.MG2_kW + ' kW cont, ' + SPECS.MG2_peak_kW + ' kW peak)', {
      color: 0xc0a040,
      material: 'Copper C11000',
      category: 'HYB', subsystem: 'M2S',
    });
    const mg2Rotor = PrimitiveBuilder.cylinder(0.110, 0.120, 32);
    t.addPart(mg2Rotor, 'MG2 Rotor (IPM Permanent Magnet)', {
      color: 0x303040,
      material: 'Steel AISI 1020',
      category: 'HYB', subsystem: 'M2R',
    });

    // Power-split case (oil-filled aluminum)
    const psCase = PrimitiveBuilder.cylinderShell(0.180, 0.170, 0.30, 64);
    t.addPart(psCase, 'Power-Split Transmission Case (Aluminum)', {
      color: 0xa0a0a8, material: 'Aluminum 6061-T6',
      category: 'HYB', subsystem: 'CSE',
    });

    // Resolver sensors (×2 — MG1 + MG2 position feedback)
    for (let i = 0; i < 2; i++) {
      const res = PrimitiveBuilder.cylinder(0.020, 0.012, 16);
      t.addPart(res, `Resolver MG${i + 1} (Position Feedback)`, {
        color: 0x404040, material: 'Aluminum 6061-T6',
        category: 'HYB', subsystem: 'RES',
      });
    }

    // Inverter (PCU — Power Control Unit)
    const inverter = PrimitiveBuilder.box(0.30, 0.10, 0.20);
    t.addPart(inverter, 'PCU Inverter (SiC MOSFET, dual-channel for MG1 + MG2)', {
      color: 0x303040,
      material: 'Aluminum 6061-T6',
      category: 'HYB', subsystem: 'INV',
      metadata: {
        switching: 'SiC MOSFET 1200 V',
        max_phase_current_A: 600,
        switching_freq_kHz: 20,
      },
    });

    // DC-DC converter (HV ↔ 12V)
    const dcdc = PrimitiveBuilder.box(0.20, 0.08, 0.15);
    t.addPart(dcdc, 'DC-DC Converter (HV → 12V, 2.5 kW)', {
      color: 0x404050,
      material: 'Aluminum 6061-T6',
      category: 'HYB', subsystem: 'DCC',
    });

    // 12V auxiliary battery
    const aux12 = PrimitiveBuilder.box(0.20, 0.16, 0.12);
    t.addPart(aux12, '12V Auxiliary Battery (AGM)', {
      color: 0x202020,
      material: 'ABS Plastic',
      category: 'HYB', subsystem: 'A12',
    });
  }

  // ---------- HV Battery ----------
  static buildHVBattery(t) {
    // Battery enclosure
    const enc = PrimitiveBuilder.box(0.45, 0.20, 0.30);
    enc._isShell = true;
    enc.volume = () => 0.45 * 0.20 * 0.30 * 0.10;
    t.addPart(enc, 'HV Battery Pack Enclosure (Aluminum, IP67)', {
      color: 0xa0a0a8,
      material: 'Aluminum 6061-T6',
      category: 'HVB', subsystem: 'ENC',
      metadata: { capacity_kWh: SPECS.battery_kWh, cells: SPECS.battery_cells, voltage_V: SPECS.battery_V },
    });
    // 360 cells (6 modules × 60 cells, 21700 prismatic)
    for (let i = 0; i < SPECS.battery_cells; i++) {
      const cell = PrimitiveBuilder.cylinder(0.0105, 0.070, 24);
      t.addPart(cell, `HV Battery Cell ${i + 1}`, {
        color: 0x404040,
        material: 'Steel AISI 1020',
        category: 'HVB', subsystem: 'CEL',
      });
    }
    // 6 module housings
    for (let m = 0; m < 6; m++) {
      const mod = PrimitiveBuilder.box(0.40, 0.080, 0.080);
      t.addPart(mod, `Battery Module ${m + 1}`, {
        color: 0x404050,
        material: 'Aluminum 6061-T6',
        category: 'HVB', subsystem: 'MOD',
      });
    }
    // BMS
    const bms = PrimitiveBuilder.box(0.20, 0.012, 0.10);
    t.addPart(bms, 'Battery Management System (BMS) PCB', {
      color: 0x004000,
      material: 'ABS Plastic',
      category: 'HVB', subsystem: 'BMS',
    });
    // Pack contactors (precharge + main + negative)
    for (let i = 0; i < 3; i++) {
      const cont = PrimitiveBuilder.box(0.060, 0.040, 0.040);
      t.addPart(cont, `HV Pack Contactor ${i + 1}`, {
        color: 0x303030, material: 'Aluminum 6061-T6',
        category: 'HVB', subsystem: 'CON',
      });
    }
    // HV cables (orange jacketed)
    for (let i = 0; i < 6; i++) {
      const cable = PrimitiveBuilder.cylinder(0.012, 0.40, 16);
      t.addPart(cable, `HV Power Cable ${i + 1} (Orange Jacket)`, {
        color: 0xff6020,
        material: 'Copper C11000',
        category: 'HVB', subsystem: 'CBL',
      });
    }
    // Cell-monitoring chips (×6, 1 per module)
    for (let i = 0; i < 6; i++) {
      const cmu = PrimitiveBuilder.box(0.020, 0.005, 0.020);
      t.addPart(cmu, `Cell Monitoring Unit ${i + 1}`, {
        color: 0x202020, material: 'ABS Plastic',
        category: 'HVB', subsystem: 'CMU',
      });
    }
  }

  // ---------- Sensors (already mostly added inline) ----------
  static buildSensors(t) {
    // Hall-effect speed sensors (×2 — wheel speed for hybrid coordination)
    for (let i = 0; i < 2; i++) {
      const wss = PrimitiveBuilder.cylinder(0.012, 0.030, 16);
      t.addPart(wss, `Driveline Speed Sensor ${i + 1}`, {
        color: 0x202020, material: 'Stainless Steel 316',
        category: 'SNS', subsystem: 'WSS',
      });
    }
    // Camshaft VVT sensors (already in Ignition)
    // Brake pedal position sensor (regenerative braking coordination)
    const bps = PrimitiveBuilder.cylinder(0.020, 0.025, 16);
    t.addPart(bps, 'Brake Pedal Position Sensor (Regen-Brake Blending)', {
      color: 0x404040, material: 'Aluminum 6061-T6',
      category: 'SNS', subsystem: 'BPS',
    });
    // Accelerator pedal position (×2 for redundancy)
    for (let i = 0; i < 2; i++) {
      const aps = PrimitiveBuilder.cylinder(0.018, 0.022, 16);
      t.addPart(aps, `Accelerator Pedal Position Sensor ${i + 1}`, {
        color: 0x404040, material: 'Aluminum 6061-T6',
        category: 'SNS', subsystem: 'APS',
      });
    }
    // Ambient temp + humidity (for emissions correction)
    const amb = PrimitiveBuilder.cylinder(0.012, 0.020, 16);
    t.addPart(amb, 'Ambient Temperature & Humidity Sensor', {
      color: 0x404040, material: 'Stainless Steel 316',
      category: 'SNS', subsystem: 'AMB',
    });
    // OBD-II port + diagnostic interface
    const obd = PrimitiveBuilder.box(0.040, 0.025, 0.030);
    t.addPart(obd, 'OBD-II Diagnostic Port', {
      color: 0x303030, material: 'ABS Plastic',
      category: 'SNS', subsystem: 'OBD',
    });
  }

  // ---------- ECU ----------
  static buildECU(t) {
    // Engine ECU (PCM)
    const pcm = PrimitiveBuilder.box(0.18, 0.04, 0.14);
    t.addPart(pcm, 'Powertrain Control Module (PCM, AURIX TC399 dual-core)', {
      color: 0x202030,
      material: 'Aluminum 6061-T6',
      category: 'ECU', subsystem: 'PCM',
      metadata: {
        cpu: 'Infineon AURIX TC399 dual TriCore 300 MHz',
        flash: '8 MB ECC',
        functions: ['fuel injection', 'ignition timing', 'VVT', 'EGR', 'cat heat-up', 'OBD-II'],
        software: 'AUTOSAR Classic 4.4',
      },
    });
    // Hybrid Control Unit (HCU)
    const hcu = PrimitiveBuilder.box(0.18, 0.04, 0.14);
    t.addPart(hcu, 'Hybrid Control Unit (HCU)', {
      color: 0x202030,
      material: 'Aluminum 6061-T6',
      category: 'ECU', subsystem: 'HCU',
      metadata: {
        functions: ['power-split control', 'MG1/MG2 torque coordination', 'regenerative braking', 'state-of-charge'],
      },
    });
    // Battery Management Controller (BMC)
    const bmc = PrimitiveBuilder.box(0.14, 0.030, 0.10);
    t.addPart(bmc, 'Battery Management Controller (BMC)', {
      color: 0x202030,
      material: 'Aluminum 6061-T6',
      category: 'ECU', subsystem: 'BMC',
    });
    // Transmission Control (eCVT)
    const tcm = PrimitiveBuilder.box(0.14, 0.030, 0.10);
    t.addPart(tcm, 'Transmission Control Module (eCVT logic)', {
      color: 0x202030, material: 'Aluminum 6061-T6',
      category: 'ECU', subsystem: 'TCM',
    });
    // CAN gateway / vehicle network controller
    const gw = PrimitiveBuilder.box(0.10, 0.025, 0.080);
    t.addPart(gw, 'Vehicle CAN Gateway / Diagnostic Master', {
      color: 0x202030, material: 'Aluminum 6061-T6',
      category: 'ECU', subsystem: 'GW',
    });
  }

  // ---------- Wiring Harness ----------
  static buildWiring(t) {
    // Engine harness segments (×16 — sensors, injectors, coils, etc.)
    for (let i = 0; i < 16; i++) {
      const harness = PrimitiveBuilder.cylinderShell(0.018, 0.014, 0.40, 12);
      t.addPart(harness, `Engine Harness Segment ${i + 1}`, {
        color: 0x303030,
        material: 'Copper C11000',
        category: 'ELEC', subsystem: 'HRN',
      });
    }
    // High-current wires (3 phase per MG × 2 MGs = 6, each shielded)
    for (let i = 0; i < 6; i++) {
      const phase = PrimitiveBuilder.cylinderShell(0.012, 0.008, 0.50, 16);
      t.addPart(phase, `MG Phase Cable ${i + 1} (Orange HV Shielded)`, {
        color: 0xff6020,
        material: 'Copper C11000',
        category: 'ELEC', subsystem: 'PHS',
      });
    }
    // Connectors (×120 — varied)
    for (let i = 0; i < 120; i++) {
      const conn = PrimitiveBuilder.cylinder(0.012, 0.020, 12);
      t.addPart(conn, `Electrical Connector ${i + 1}`, {
        color: 0x303030, material: 'ABS Plastic',
        category: 'ELEC', subsystem: 'CNN',
      });
    }
    // Relays + fuses
    for (let i = 0; i < 20; i++) {
      const relay = PrimitiveBuilder.box(0.020, 0.020, 0.025);
      t.addPart(relay, `${i < 8 ? 'Relay' : 'Fuse'} ${(i % 8) + 1}`, {
        color: i < 8 ? 0x202020 : 0x808040,
        material: 'ABS Plastic',
        category: 'ELEC', subsystem: i < 8 ? 'RLY' : 'FUS',
      });
    }
    // Ground straps
    for (let i = 0; i < 8; i++) {
      const gnd = PrimitiveBuilder.cylinder(0.005, 0.150, 8);
      t.addPart(gnd, `Engine Ground Strap ${i + 1}`, {
        color: 0xb86d3a, material: 'Copper C11000',
        category: 'ELEC', subsystem: 'GND',
      });
    }
  }

  // ---------- Engine Mounts ----------
  static buildMounts(t) {
    // 3 engine mounts (front-right, front-left, rear-torque-strut)
    const mountLocations = [
      { name: 'Front-Right Engine Mount (Hydraulic)', x: 0.30, y: 0.30, z: 0 },
      { name: 'Front-Left Engine Mount (Hydraulic)', x: -0.30, y: 0.30, z: 0 },
      { name: 'Rear Engine Torque Strut Mount', x: 0, y: 0.20, z: 0.30 },
    ];
    for (const m of mountLocations) {
      const mount = PrimitiveBuilder.cylinder(0.040, 0.060, 24);
      t.addPart(mount, m.name, {
        color: 0x202020,
        position: new Vec3(m.x, m.y, m.z),
        material: 'Nylon 6/6',  // rubber-isolated
        category: 'MNT', subsystem: 'ENG',
        metadata: { type: 'hydraulic active mount with viscous damping' },
      });
    }
    // Subframe-to-body bushings (×4)
    for (let i = 0; i < 4; i++) {
      const bushing = PrimitiveBuilder.torus(0.025, 0.005, 16, 8);
      t.addPart(bushing, `Subframe Bushing ${i + 1}`, {
        color: 0x202020, material: 'Nylon 6/6',
        category: 'MNT', subsystem: 'SBF',
      });
    }
  }

  // ---------- Front Cover + Accessories ----------
  static buildFrontCover(t) {
    // Front timing cover (cast aluminum)
    const cover = PrimitiveBuilder.box(0.50, 0.36, 0.060);
    cover._isShell = true;
    cover.volume = () => 0.50 * 0.36 * 0.060 * 0.20;
    t.addPart(cover, 'Front Timing Cover (Cast Aluminum)', {
      color: 0xa0a0a8, material: 'Aluminum 6061-T6',
      category: 'BLK', subsystem: 'FCV',
    });
    // Crank seal (front)
    const crankSeal = PrimitiveBuilder.torus(0.030, 0.003, 24, 8);
    t.addPart(crankSeal, 'Crankshaft Front Oil Seal (PTFE)', {
      color: 0xfafafa,
      material: 'Nylon 6/6',
      category: 'BLK', subsystem: 'SEL',
    });
    // Rear main seal
    const rearSeal = PrimitiveBuilder.torus(0.040, 0.003, 24, 8);
    t.addPart(rearSeal, 'Crankshaft Rear Main Oil Seal', {
      color: 0xfafafa,
      material: 'Nylon 6/6',
      category: 'BLK', subsystem: 'SEL',
    });
  }

  // ---------- Sump ----------
  static buildSump(t) {
    // Oil pan (deep-sump aluminum)
    const sump = PrimitiveBuilder.box(0.45, 0.10, 0.45);
    sump._isShell = true;
    sump.volume = () => 0.45 * 0.10 * 0.45 * 0.10;
    t.addPart(sump, 'Oil Pan / Sump (Cast Aluminum, 7 L capacity)', {
      color: 0xa0a0a8,
      position: new Vec3(0, -0.05, 0),
      material: 'Aluminum 6061-T6',
      category: 'OIL', subsystem: 'SMP',
    });
    // Drain plug
    const drain = PrimitiveBuilder.cylinder(0.012, 0.025, 16);
    t.addPart(drain, 'Oil Pan Drain Plug (Magnetic)', {
      color: 0x404040, material: 'Steel AISI 4340',
      category: 'OIL', subsystem: 'DRN',
    });
    // Dipstick + tube
    const dip = PrimitiveBuilder.cylinder(0.005, 0.40, 8);
    t.addPart(dip, 'Oil Dipstick + Tube', {
      color: 0xc0a040, material: 'Steel AISI 4340',
      category: 'OIL', subsystem: 'DIP',
    });
    // Oil level sensor (electronic)
    const ols = PrimitiveBuilder.cylinder(0.012, 0.080, 16);
    t.addPart(ols, 'Oil Level Sensor (Capacitive)', {
      color: 0x404040, material: 'Aluminum 6061-T6',
      category: 'SNS', subsystem: 'OLS',
    });
    // Windage tray
    const windage = PrimitiveBuilder.box(0.40, 0.005, 0.40);
    t.addPart(windage, 'Windage Tray (Stamped Steel)', {
      color: 0x808080, material: 'Steel AISI 1020',
      category: 'OIL', subsystem: 'WIN',
    });
    // Crankcase ventilation (PCV) valve + hose
    const pcv = PrimitiveBuilder.cylinder(0.012, 0.040, 16);
    t.addPart(pcv, 'PCV Valve (Crankcase Ventilation)', {
      color: 0x404040, material: 'Aluminum 6061-T6',
      category: 'OIL', subsystem: 'PCV',
    });
  }

  // ---------- Fasteners ----------
  static buildFasteners(t) {
    // Head bolts (12 per head × 2 heads = 24)
    for (let i = 0; i < 24; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.005, 0.130, 16);
      t.addPart(bolt, `Head Bolt ${i + 1} (M11 TTY, Torque-to-Yield)`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'HBT',
        metadata: { type: 'TTY one-time-use', torque_step1: 60, torque_step2: 'plus 90°' },
      });
    }
    // Main bearing cap bolts (4 caps × 4 bolts = 16, cross-bolted = 24)
    for (let i = 0; i < 24; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.005, 0.080, 16);
      t.addPart(bolt, `Main Bearing Cap Bolt ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'MBB',
      });
    }
    // Rod cap bolts (×12 — 2 per rod)
    for (let i = 0; i < 12; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.004, 0.060, 16);
      t.addPart(bolt, `Connecting Rod Cap Bolt ${i + 1} (Hi-Strength)`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'RDB',
      });
    }
    // Camshaft bearing cap bolts (5 caps × 4 = 20 per head × 2 = 40, ×2 cams per head = 80)
    for (let i = 0; i < 80; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.0035, 0.040, 12);
      t.addPart(bolt, `Cam Bearing Cap Bolt ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'CBB',
      });
    }
    // Valve cover bolts (×16 per head × 2 = 32)
    for (let i = 0; i < 32; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.003, 0.030, 12);
      t.addPart(bolt, `Valve Cover Bolt ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'VCB',
      });
    }
    // Oil pan bolts (×24)
    for (let i = 0; i < 24; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.003, 0.025, 12);
      t.addPart(bolt, `Oil Pan Bolt ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'OPB',
      });
    }
    // Intake manifold bolts (×12)
    for (let i = 0; i < 12; i++) {
      const bolt = PrimitiveBuilder.cylinder(0.003, 0.040, 12);
      t.addPart(bolt, `Intake Manifold Bolt ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'IMB',
      });
    }
    // Exhaust manifold studs (×6 per bank × 2 = 12)
    for (let i = 0; i < 12; i++) {
      const stud = PrimitiveBuilder.cylinder(0.004, 0.045, 12);
      t.addPart(stud, `Exhaust Manifold Stud ${i + 1} (Inconel)`, {
        color: 0xa89a86, material: 'Inconel 718',
        category: 'FAS', subsystem: 'EMS',
      });
    }
    // Various M6 hardware (×60)
    for (let i = 0; i < 60; i++) {
      const screw = PrimitiveBuilder.cylinder(0.003, 0.020, 12);
      t.addPart(screw, `M6 Cap Screw ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'M6',
      });
    }
    // Various washers (×60)
    for (let i = 0; i < 60; i++) {
      const washer = PrimitiveBuilder.torus(0.005, 0.0008, 12, 8);
      t.addPart(washer, `M6 Washer ${i + 1}`, {
        color: 0x808080, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'WSH',
      });
    }
    // Lock nuts + dowel pins
    for (let i = 0; i < 24; i++) {
      const nut = PrimitiveBuilder.cylinder(0.005, 0.005, 6);
      t.addPart(nut, `Lock Nut ${i + 1}`, {
        color: 0x404040, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'LCK',
      });
    }
    for (let i = 0; i < 16; i++) {
      const pin = PrimitiveBuilder.cylinder(0.004, 0.012, 8);
      t.addPart(pin, `Dowel Pin ${i + 1}`, {
        color: 0x707080, material: 'Steel AISI 4340',
        category: 'FAS', subsystem: 'DWL',
      });
    }
  }
}
