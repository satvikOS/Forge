/**
 * ArchDisc — Toyota V35A-FTS Engine Ancillaries Builder
 *
 * Compact multi-subsystem builder for the remaining V35A components:
 *   timing system (chain + 6 sprockets + 3 tensioners + 6 guides + 4 phasers)
 *   oil + water pumps (gerotor variable-flow + electric BLDC water pump)
 *   intake manifold + throttle body + airbox
 *   exhaust manifolds + close-coupled cats + underfloor cat + GPF
 *   D-4S fuel system (12 injectors + 2 rails + HPFP + LPFP)
 *   ignition (6 plugs + 6 coils + 2 knock sensors)
 *   sensors + ECU + wiring
 *   hybrid drive (MG1 + MG2 + planetary + inverter + DC-DC)
 *   HV battery pack
 *   front cover + accessories
 *   engine mounts
 *
 * Each section uses parametric position from BLOCK_SPECS so it mates
 * to the upstream short-block geometry.
 */

import { PrimitiveBuilder, Vec3 } from '../../kernel/index.js';
import { BLOCK_SPECS } from './EngineBlockBuilder.js';

const mm = (x) => x / 1000;
const PI = Math.PI;

export default class AncillariesBuilder {

  static buildTimingSystem() {
    const parts = [], features = [];
    const blockLen_mm = BLOCK_SPECS.boreSpacing_mm * BLOCK_SPECS.cylindersPerBank + 80;
    const frontZ_m = -mm(blockLen_mm / 2 + 40);  // front of engine

    // Primary chain (silent inverted-tooth)
    const primary = PrimitiveBuilder.torus(mm(60), mm(2.5), 64, 8);
    parts.push({ name: 'Primary Timing Chain (Silent Inverted-Tooth)', solid: primary,
      position: new Vec3(0, mm(110), frontZ_m), rotation: new Vec3(PI/2,0,0),
      color: 0x404040, material: 'Steel AISI 4340', subsystem: 'CHN',
      metadata: { pitch_mm: 9.5, plates: 6, rated_power_kW: 220 }});
    features.push({ id: 'timing-chain-primary', type: 'timing-chain' });

    // 4 cam phasers (intake + exhaust per bank)
    for (let bank = 0; bank < 2; bank++) {
      const sign = bank === 0 ? -1 : 1;
      for (let type = 0; type < 2; type++) {
        const isIntake = type === 0;
        const phaser = PrimitiveBuilder.cylinder(mm(38), mm(28), 32);
        parts.push({
          name: `VVT ${isIntake ? 'iE Electric' : 'i Hydraulic'} Phaser ${bank === 0 ? 'A' : 'B'}-${isIntake ? 'IN' : 'EX'}`,
          solid: phaser,
          position: new Vec3(sign * mm(60), mm(310), frontZ_m + mm(20)),
          rotation: new Vec3(PI/2, 0, 0),
          color: 0x707080, material: 'Aluminum 6061-T6', subsystem: isIntake ? 'iE' : 'HYD',
          metadata: { type: isIntake ? 'electric VVT-iE motor-driven' : 'hydraulic VVT-i', range_deg: isIntake ? 70 : 50 },
        });
        features.push({ id: `vvt-phaser-${bank === 0 ? 'A' : 'B'}-${isIntake ? 'IN' : 'EX'}`, type: 'vvt-phaser' });
      }
    }

    // Crank sprocket
    const crankSpr = PrimitiveBuilder.cylinder(mm(35), mm(15), 32);
    parts.push({ name: 'Crank Sprocket', solid: crankSpr,
      position: new Vec3(0, 0, frontZ_m + mm(15)), rotation: new Vec3(PI/2,0,0),
      color: 0x707080, material: 'Steel AISI 4340', subsystem: 'SPR' });

    // 3 tensioners + 6 guides
    for (let i = 0; i < 3; i++) {
      const tens = PrimitiveBuilder.cylinder(mm(15), mm(50), 16);
      parts.push({ name: `Chain Tensioner ${i + 1} (Hydraulic)`, solid: tens,
        position: new Vec3((i - 1) * mm(40), mm(150), frontZ_m), rotation: new Vec3(PI/2,0,0),
        color: 0x808080, material: 'Steel AISI 4340', subsystem: 'TNS' });
    }
    for (let i = 0; i < 6; i++) {
      const guide = PrimitiveBuilder.box(mm(10), mm(120), mm(15));
      parts.push({ name: `Chain Guide ${i + 1}`, solid: guide,
        position: new Vec3((i - 2.5) * mm(30), mm(180), frontZ_m + mm(5)),
        color: 0x202020, material: 'Nylon 6/6', subsystem: 'GDE' });
    }

    return { partsList: parts, features, mass_kg: 4.5, subsystemName: 'TIM' };
  }

  static buildPumps() {
    const parts = [], features = [];
    // Variable-flow oil pump (gerotor, cam-driven)
    const oilPump = PrimitiveBuilder.cylinder(mm(45), mm(60), 24);
    parts.push({ name: 'Variable-Flow Oil Pump (Gerotor + Solenoid)', solid: oilPump,
      position: new Vec3(0, mm(-50), 0),
      color: 0x808088, material: 'Aluminum 6061-T6', subsystem: 'PMP-OIL',
      metadata: { type: 'electronically-controlled vari-flow gerotor', max_pressure_bar: 5.5 }});
    features.push({ id: 'oil-pump', type: 'pump' });

    // Electric water pump (BLDC, 24V, 250W)
    const waterPump = PrimitiveBuilder.cylinder(mm(60), mm(80), 32);
    parts.push({ name: 'Electric Water Pump (BLDC 250W)', solid: waterPump,
      position: new Vec3(mm(180), mm(200), 0),
      color: 0x303040, material: 'Aluminum 6061-T6', subsystem: 'PMP-H2O',
      metadata: { type: 'electric BLDC', flow_Lmin: 130, head_kPa: 200 }});
    features.push({ id: 'water-pump', type: 'pump' });

    // Oil filter housing + element
    const filter = PrimitiveBuilder.cylinder(mm(45), mm(90), 24);
    parts.push({ name: 'Oil Filter Housing (Cartridge)', solid: filter,
      position: new Vec3(mm(150), mm(50), 0),
      color: 0x707080, material: 'Aluminum 6061-T6', subsystem: 'FLT' });

    // Electronic thermostat
    const therm = PrimitiveBuilder.cylinder(mm(30), mm(40), 16);
    parts.push({ name: 'Electronic Thermostat (Variable Open Temp)', solid: therm,
      position: new Vec3(mm(160), mm(180), mm(-50)),
      color: 0x707080, material: 'Aluminum 6061-T6', subsystem: 'THR',
      metadata: { open_temp_C: 'variable 85-105', solenoid_control: true }});

    // Coolant crossover
    const xover = PrimitiveBuilder.cylinderShell(mm(25), mm(22), mm(180), 16);
    parts.push({ name: 'Coolant Crossover Manifold', solid: xover,
      position: new Vec3(mm(150), mm(220), 0), rotation: new Vec3(0, 0, PI/2),
      color: 0x808080, material: 'Aluminum 6061-T6', subsystem: 'XOV' });

    return { partsList: parts, features, mass_kg: 8.0, subsystemName: 'PMP' };
  }

  static buildIntakeExhaust() {
    const parts = [], features = [];
    const blockLen_mm = BLOCK_SPECS.boreSpacing_mm * BLOCK_SPECS.cylindersPerBank + 80;

    // Intake manifold (composite, central, between V banks)
    const manifold = PrimitiveBuilder.box(mm(280), mm(100), mm(380));
    manifold._isShell = true; manifold.volume = () => 280 * 100 * 380 * 0.15 / 1e9;
    parts.push({ name: 'Intake Manifold (Composite, Variable-Length Runners)', solid: manifold,
      position: new Vec3(0, mm(380), 0),
      color: 0x303030, material: 'Nylon 6/6', subsystem: 'MAN-IN',
      metadata: { plenum_L: 4.5, runner_length_mm: 380, valve: 'variable-runner servo' }});
    features.push({ id: 'intake-manifold', type: 'manifold' });

    // 6 intake runners
    for (let i = 0; i < 6; i++) {
      const bank = i < 3 ? 'A' : 'B';
      const sign = i < 3 ? -1 : 1;
      const z_mm = -BLOCK_SPECS.boreSpacing_mm + (i % 3) * BLOCK_SPECS.boreSpacing_mm;
      const runner = PrimitiveBuilder.cylinderShell(mm(20), mm(18), mm(150), 16);
      parts.push({ name: `Intake Runner ${bank}${(i % 3) + 1}`, solid: runner,
        position: new Vec3(sign * mm(60), mm(330), mm(z_mm)),
        rotation: new Vec3(0, 0, sign * PI / 4),
        color: 0x404040, material: 'Nylon 6/6', subsystem: 'RUN-IN',
        metadata: { mates_to: `head${bank}.intakePort_${(i%3)+1}` }});
    }

    // Throttle body (electronic, 70mm)
    const throttle = PrimitiveBuilder.cylinder(mm(40), mm(60), 24);
    parts.push({ name: 'Electronic Throttle Body (70 mm DBW)', solid: throttle,
      position: new Vec3(0, mm(450), mm(-200)),
      color: 0x707080, material: 'Aluminum 6061-T6', subsystem: 'THR-IN' });

    // 2 exhaust manifolds (close-coupled cat integrated)
    for (let bank = 0; bank < 2; bank++) {
      const sign = bank === 0 ? -1 : 1;
      const exh = PrimitiveBuilder.box(mm(80), mm(80), mm(300));
      exh._isShell = true; exh.volume = () => 80 * 80 * 300 * 0.20 / 1e9;
      parts.push({
        name: `Exhaust Manifold Bank ${bank === 0 ? 'A' : 'B'} (Cast Stainless)`,
        solid: exh,
        position: new Vec3(sign * mm(180), mm(250), 0),
        rotation: new Vec3(0, 0, sign * PI / 6),
        color: 0x707080, material: 'Stainless Steel 316', subsystem: 'MAN-EX',
        metadata: { type: 'log-style cast 1.4848 stainless', temp_max_C: 950 }});
      features.push({ id: `exhaust-manifold-${bank === 0 ? 'A' : 'B'}`, type: 'manifold' });

      // Close-coupled 3-way cat per bank
      const ccCat = PrimitiveBuilder.cylinder(mm(60), mm(180), 32);
      parts.push({
        name: `Close-Coupled 3-Way Cat ${bank === 0 ? 'A' : 'B'} (Pt-Pd-Rh)`,
        solid: ccCat,
        position: new Vec3(sign * mm(220), mm(180), mm(120)),
        rotation: new Vec3(PI/2, 0, sign * PI/6),
        color: 0xc09040, material: 'Stainless Steel 316', subsystem: 'TWC',
        metadata: { type: 'cordierite 600 cpsi Pt-Pd-Rh', loading_g_ft3: 80, conversion_eff_pct: 99.5 }});
      features.push({ id: `cc-cat-${bank === 0 ? 'A' : 'B'}`, type: 'catalyst' });
    }

    // 4 wide-band O2 sensors + 2 narrow-band
    for (let i = 0; i < 4; i++) {
      const o2 = PrimitiveBuilder.cylinder(mm(10), mm(40), 16);
      const sign = i % 2 === 0 ? -1 : 1;
      parts.push({ name: `Wide-Band O2 Sensor ${i + 1} (UEGO ${i < 2 ? 'pre-cat' : 'post-cat'})`,
        solid: o2,
        position: new Vec3(sign * mm(220), mm(160), i < 2 ? mm(80) : mm(220)),
        color: 0x808088, material: 'Inconel 718', subsystem: 'O2-WB' });
    }

    // Underfloor combined cat + GPF
    const ufCat = PrimitiveBuilder.cylinder(mm(80), mm(250), 32);
    parts.push({ name: 'Underfloor 3-Way + NOx-Trap Cat', solid: ufCat,
      position: new Vec3(0, mm(80), mm(280)),
      rotation: new Vec3(PI/2, 0, 0),
      color: 0xb09030, material: 'Stainless Steel 316', subsystem: 'UFC',
      metadata: { type: 'NSC + Rh-rich 3-way' }});
    const gpf = PrimitiveBuilder.cylinder(mm(80), mm(220), 32);
    parts.push({ name: 'Gasoline Particulate Filter (GPF, Coated Wall-Flow)', solid: gpf,
      position: new Vec3(0, mm(80), mm(540)),
      rotation: new Vec3(PI/2, 0, 0),
      color: 0xe0d0a0, material: 'Stainless Steel 316', subsystem: 'GPF',
      metadata: { type: 'cordierite wall-flow with 3-way coating', filtration_eff_pct: 95 }});
    features.push({ id: 'gpf', type: 'particulate-filter' });

    // EGR cooler + valve
    const egrCooler = PrimitiveBuilder.box(mm(100), mm(40), mm(60));
    parts.push({ name: 'EGR Cooler (Water-Cooled Stacked-Plate)', solid: egrCooler,
      position: new Vec3(0, mm(280), mm(-50)),
      color: 0xa0a0a8, material: 'Stainless Steel 316', subsystem: 'EGR-CLR',
      metadata: { effectiveness: 0.92, max_flow_kgmin: 8 }});
    const egrValve = PrimitiveBuilder.cylinder(mm(30), mm(60), 24);
    parts.push({ name: 'EGR Control Valve (Electronic)', solid: egrValve,
      position: new Vec3(mm(80), mm(280), mm(-50)),
      color: 0x707080, material: 'Stainless Steel 316', subsystem: 'EGR-VLV' });

    return { partsList: parts, features, mass_kg: 28.0, subsystemName: 'EXHIN' };
  }

  static buildFuelIgnition() {
    const parts = [], features = [];

    // 6 D-4S DI injectors (high-pressure, side-mounted)
    for (let i = 0; i < 6; i++) {
      const bank = i < 3 ? 'A' : 'B';
      const cyl = (i % 3) + 1;
      const sign = bank === 'A' ? -1 : 1;
      const z_mm = -BLOCK_SPECS.boreSpacing_mm + (i % 3) * BLOCK_SPECS.boreSpacing_mm;
      const di = PrimitiveBuilder.cylinder(mm(12), mm(90), 24);
      parts.push({ name: `D-4S DI Injector ${bank}${cyl}`, solid: di,
        position: new Vec3(sign * mm(80), mm(290), mm(z_mm)),
        rotation: new Vec3(0, 0, sign * PI / 8),
        color: 0xc0a040, material: 'Stainless Steel 316', subsystem: 'DI',
        metadata: { type: 'side-mounted multi-hole DI', pressure_bar: 200, holes: 6, spray_angle_deg: 75 }});
      features.push({ id: `di-injector-${bank}${cyl}`, type: 'injector' });
    }

    // 6 port injectors
    for (let i = 0; i < 6; i++) {
      const bank = i < 3 ? 'A' : 'B';
      const cyl = (i % 3) + 1;
      const sign = bank === 'A' ? -1 : 1;
      const z_mm = -BLOCK_SPECS.boreSpacing_mm + (i % 3) * BLOCK_SPECS.boreSpacing_mm;
      const pi_inj = PrimitiveBuilder.cylinder(mm(10), mm(60), 24);
      parts.push({ name: `D-4S Port Injector ${bank}${cyl}`, solid: pi_inj,
        position: new Vec3(sign * mm(40), mm(370), mm(z_mm)),
        color: 0x808088, material: 'Stainless Steel 316', subsystem: 'PI',
        metadata: { type: 'electromagnetic port', pressure_bar: 4 }});
    }

    // 2 fuel rails
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const rail = PrimitiveBuilder.cylinderShell(mm(18), mm(14), mm(450), 16);
      parts.push({ name: `Fuel Rail ${i === 0 ? 'DI (200 bar)' : 'PI (4 bar)'}`, solid: rail,
        position: new Vec3(sign * mm(50), mm(310 + i * 60), 0),
        rotation: new Vec3(PI/2, 0, 0),
        color: 0x808080, material: 'Stainless Steel 316', subsystem: i === 0 ? 'RDI' : 'RPI' });
    }

    // HPFP (cam-driven) + LPFP (in-tank)
    const hpfp = PrimitiveBuilder.cylinder(mm(40), mm(80), 24);
    parts.push({ name: 'HPFP Cam-Driven (200 bar)', solid: hpfp,
      position: new Vec3(0, mm(330), mm(-180)),
      color: 0x808088, material: 'Stainless Steel 316', subsystem: 'HPP' });
    const lpfp = PrimitiveBuilder.cylinder(mm(30), mm(80), 24);
    parts.push({ name: 'LPFP In-Tank BLDC (4 bar)', solid: lpfp,
      position: new Vec3(mm(220), mm(50), mm(-150)),
      color: 0x303040, material: 'Aluminum 6061-T6', subsystem: 'LPP' });

    // 6 spark plugs + 6 coils
    for (let i = 0; i < 6; i++) {
      const bank = i < 3 ? 'A' : 'B';
      const cyl = (i % 3) + 1;
      const sign = bank === 'A' ? -1 : 1;
      const z_mm = -BLOCK_SPECS.boreSpacing_mm + (i % 3) * BLOCK_SPECS.boreSpacing_mm;
      const plug = PrimitiveBuilder.cylinder(mm(8), mm(60), 16);
      parts.push({ name: `Spark Plug ${bank}${cyl} (Iridium-Pt M14)`, solid: plug,
        position: new Vec3(sign * mm(40), mm(290), mm(z_mm)),
        color: 0xc0c0c8, material: 'Stainless Steel 316', subsystem: 'PLG',
        metadata: { type: 'iridium-platinum 0.6 mm tip', heat_range: 6, life_km: 160000 }});
      const coil = PrimitiveBuilder.box(mm(25), mm(80), mm(40));
      parts.push({ name: `Ignition Coil ${bank}${cyl} (Smart COP)`, solid: coil,
        position: new Vec3(sign * mm(40), mm(370), mm(z_mm)),
        color: 0x202020, material: 'ABS Plastic', subsystem: 'COL',
        metadata: { peak_kV: 35, energy_mJ: 80 }});
      features.push({ id: `spark-plug-${bank}${cyl}`, type: 'spark-plug' });
    }

    // 2 knock sensors
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const knock = PrimitiveBuilder.cylinder(mm(12), mm(20), 16);
      parts.push({ name: `Knock Sensor Bank ${i === 0 ? 'A' : 'B'}`, solid: knock,
        position: new Vec3(sign * mm(120), mm(120), 0),
        color: 0x404040, material: 'Stainless Steel 316', subsystem: 'KNK' });
    }

    return { partsList: parts, features, mass_kg: 7.5, subsystemName: 'FUE-IGN' };
  }

  static buildSensorsECU() {
    const parts = [], features = [];

    // PCM (engine ECU)
    const pcm = PrimitiveBuilder.box(mm(180), mm(40), mm(140));
    parts.push({ name: 'Powertrain Control Module (PCM, AURIX TC399)', solid: pcm,
      position: new Vec3(mm(250), mm(420), mm(50)),
      color: 0x202030, material: 'Aluminum 6061-T6', subsystem: 'PCM',
      metadata: { cpu: 'Infineon AURIX TC399 dual TriCore 300 MHz', flash: '8 MB ECC',
        functions: ['injection', 'ignition', 'VVT', 'EGR', 'cat heat-up', 'OBD-II'] }});
    features.push({ id: 'pcm', type: 'ecu' });

    // HCU (Hybrid Control Unit)
    const hcu = PrimitiveBuilder.box(mm(180), mm(40), mm(140));
    parts.push({ name: 'Hybrid Control Unit (HCU)', solid: hcu,
      position: new Vec3(mm(250), mm(420), mm(220)),
      color: 0x202030, material: 'Aluminum 6061-T6', subsystem: 'HCU' });

    // BMC + TCM
    const bmc = PrimitiveBuilder.box(mm(140), mm(30), mm(100));
    parts.push({ name: 'Battery Management Controller', solid: bmc,
      position: new Vec3(mm(280), mm(120), mm(0)),
      color: 0x202030, material: 'Aluminum 6061-T6', subsystem: 'BMC' });
    const tcm = PrimitiveBuilder.box(mm(140), mm(30), mm(100));
    parts.push({ name: 'Transmission Control (eCVT)', solid: tcm,
      position: new Vec3(mm(280), mm(80), mm(180)),
      color: 0x202030, material: 'Aluminum 6061-T6', subsystem: 'TCM' });

    // Engine sensors batch
    const sensorList = [
      { name: 'MAF Sensor (Hot-Wire)', pos: [0, 460, -200], dia: 25, len: 40 },
      { name: 'IAT Sensor', pos: [0, 460, -150], dia: 5, len: 20 },
      { name: 'MAP Sensor', pos: [0, 380, 0], dia: 12, len: 25 },
      { name: 'CKP Sensor (Hall)', pos: [0, 0, -300], dia: 10, len: 25 },
      { name: 'CMP Sensor 1', pos: [-60, 310, -200], dia: 10, len: 25 },
      { name: 'CMP Sensor 2', pos: [60, 310, -200], dia: 10, len: 25 },
      { name: 'CMP Sensor 3', pos: [-60, 310, 200], dia: 10, len: 25 },
      { name: 'CMP Sensor 4', pos: [60, 310, 200], dia: 10, len: 25 },
      { name: 'OBD-II Port', pos: [200, 300, 250], dia: 30, len: 25 },
    ];
    for (const s of sensorList) {
      const sensor = PrimitiveBuilder.cylinder(mm(s.dia / 2), mm(s.len), 16);
      parts.push({ name: s.name, solid: sensor,
        position: new Vec3(mm(s.pos[0]), mm(s.pos[1]), mm(s.pos[2])),
        color: 0x404040, material: 'Stainless Steel 316', subsystem: 'SNS' });
    }

    // 36 wiring harness segments + connectors
    for (let i = 0; i < 16; i++) {
      const harness = PrimitiveBuilder.cylinderShell(mm(18), mm(14), mm(400), 12);
      parts.push({ name: `Engine Harness Segment ${i + 1}`, solid: harness,
        position: new Vec3(mm(-200 + i * 25), mm(240 + (i % 3) * 50), 0),
        rotation: new Vec3(PI/2, 0, 0),
        color: 0x303030, material: 'Copper C11000', subsystem: 'HRN' });
    }

    return { partsList: parts, features, mass_kg: 6.0, subsystemName: 'ECU-SNS' };
  }

  static buildHybridDrive() {
    const parts = [], features = [];
    const blockLen_mm = BLOCK_SPECS.boreSpacing_mm * BLOCK_SPECS.cylindersPerBank + 80;
    const rearZ_m = mm(blockLen_mm / 2 + 80);  // behind engine

    // Power-split case
    const psCase = PrimitiveBuilder.cylinderShell(mm(180), mm(170), mm(300), 64);
    parts.push({ name: 'Power-Split Transmission Case (THS-V Aluminum)', solid: psCase,
      position: new Vec3(0, 0, rearZ_m), rotation: new Vec3(PI/2, 0, 0),
      color: 0xa0a0a8, material: 'Aluminum 6061-T6', subsystem: 'CSE' });

    // Planetary set
    const carrier = PrimitiveBuilder.cylinder(mm(80), mm(40), 32);
    parts.push({ name: 'Planetary Carrier (Power-Split Input from ICE)', solid: carrier,
      position: new Vec3(0, 0, rearZ_m), rotation: new Vec3(PI/2, 0, 0),
      color: 0x707080, material: 'Steel AISI 4340', subsystem: 'CAR' });
    for (let i = 0; i < 4; i++) {
      const ang = i * Math.PI / 2;
      const planet = PrimitiveBuilder.cylinder(mm(25), mm(30), 24);
      parts.push({ name: `Planet Gear ${i + 1}`, solid: planet,
        position: new Vec3(Math.cos(ang) * mm(50), Math.sin(ang) * mm(50), rearZ_m),
        rotation: new Vec3(PI/2, 0, 0),
        color: 0x808080, material: 'Steel AISI 4340', subsystem: 'PLT' });
    }
    const sun = PrimitiveBuilder.cylinder(mm(30), mm(30), 24);
    parts.push({ name: 'Sun Gear (drives MG1)', solid: sun,
      position: new Vec3(0, 0, rearZ_m), rotation: new Vec3(PI/2, 0, 0),
      color: 0x808088, material: 'Steel AISI 4340', subsystem: 'SUN' });
    const ring = PrimitiveBuilder.cylinderShell(mm(85), mm(78), mm(30), 64);
    parts.push({ name: 'Ring Gear (drives MG2 + Final Drive)', solid: ring,
      position: new Vec3(0, 0, rearZ_m), rotation: new Vec3(PI/2, 0, 0),
      color: 0x808088, material: 'Steel AISI 4340', subsystem: 'RNG' });

    // MG1 (generator + starter, 30 kW)
    const mg1Stator = PrimitiveBuilder.cylinderShell(mm(110), mm(85), mm(80), 48);
    parts.push({ name: 'MG1 Stator (30 kW, Distributed-Winding Hairpin Cu)', solid: mg1Stator,
      position: new Vec3(0, 0, rearZ_m + mm(120)), rotation: new Vec3(PI/2, 0, 0),
      color: 0xc0a040, material: 'Copper C11000', subsystem: 'M1S',
      metadata: { type: 'distributed winding hairpin Cu', poles: 8 }});
    const mg1Rotor = PrimitiveBuilder.cylinder(mm(80), mm(80), 32);
    parts.push({ name: 'MG1 Rotor (NdFeB N52H IPM)', solid: mg1Rotor,
      position: new Vec3(0, 0, rearZ_m + mm(120)), rotation: new Vec3(PI/2, 0, 0),
      color: 0x303040, material: 'Steel AISI 1020', subsystem: 'M1R' });

    // MG2 (traction, 80 kW cont / 180 kW peak)
    const mg2Stator = PrimitiveBuilder.cylinderShell(mm(150), mm(115), mm(120), 48);
    parts.push({ name: 'MG2 Stator (80 kW cont / 180 kW peak)', solid: mg2Stator,
      position: new Vec3(0, 0, rearZ_m + mm(220)), rotation: new Vec3(PI/2, 0, 0),
      color: 0xc0a040, material: 'Copper C11000', subsystem: 'M2S' });
    const mg2Rotor = PrimitiveBuilder.cylinder(mm(110), mm(120), 32);
    parts.push({ name: 'MG2 Rotor (NdFeB IPM)', solid: mg2Rotor,
      position: new Vec3(0, 0, rearZ_m + mm(220)), rotation: new Vec3(PI/2, 0, 0),
      color: 0x303040, material: 'Steel AISI 1020', subsystem: 'M2R' });

    // Inverter + DC-DC
    const inv = PrimitiveBuilder.box(mm(300), mm(100), mm(200));
    parts.push({ name: 'PCU Inverter (SiC MOSFET dual-channel)', solid: inv,
      position: new Vec3(0, mm(420), mm(120)),
      color: 0x303040, material: 'Aluminum 6061-T6', subsystem: 'INV',
      metadata: { switching: 'SiC MOSFET 1200V', max_phase_current_A: 600, switching_freq_kHz: 20 }});
    features.push({ id: 'pcu-inverter', type: 'power-electronics' });
    const dcdc = PrimitiveBuilder.box(mm(200), mm(80), mm(150));
    parts.push({ name: 'DC-DC Converter (HV → 12V, 2.5 kW)', solid: dcdc,
      position: new Vec3(mm(280), mm(420), mm(-200)),
      color: 0x404050, material: 'Aluminum 6061-T6', subsystem: 'DCC' });

    // 2 resolvers
    for (let i = 0; i < 2; i++) {
      const res = PrimitiveBuilder.cylinder(mm(20), mm(12), 16);
      parts.push({ name: `Resolver MG${i + 1}`, solid: res,
        position: new Vec3(0, mm(70), rearZ_m + mm(120 + i * 100)),
        rotation: new Vec3(PI/2, 0, 0),
        color: 0x404040, material: 'Aluminum 6061-T6', subsystem: 'RES' });
    }

    return { partsList: parts, features, mass_kg: 75.0, subsystemName: 'HYB' };
  }

  static buildHVBattery() {
    const parts = [], features = [];

    // Battery enclosure
    const enc = PrimitiveBuilder.box(mm(450), mm(200), mm(300));
    enc._isShell = true; enc.volume = () => 450 * 200 * 300 * 0.10 / 1e9;
    parts.push({ name: 'HV Battery Pack Enclosure (Aluminum IP67)', solid: enc,
      position: new Vec3(0, mm(-150), mm(400)),
      color: 0xa0a0a8, material: 'Aluminum 6061-T6', subsystem: 'ENC',
      metadata: { capacity_kWh: 1.3, cells: 360, voltage_V: 244 }});

    // 6 modules, 360 cells
    for (let m = 0; m < 6; m++) {
      const mod = PrimitiveBuilder.box(mm(400), mm(80), mm(80));
      parts.push({ name: `Battery Module ${m + 1}`, solid: mod,
        position: new Vec3(0, mm(-150), mm(360 + m * 12)),
        color: 0x404050, material: 'Aluminum 6061-T6', subsystem: 'MOD' });
    }
    // 60 cells per module shown as one mass to avoid clutter
    for (let i = 0; i < 60; i++) {
      const cell = PrimitiveBuilder.cylinder(mm(10.5), mm(70), 16);
      parts.push({ name: `21700 Cell Sample ${i + 1}`, solid: cell,
        position: new Vec3(mm(-150 + (i % 12) * 25), mm(-150), mm(360 + Math.floor(i / 12) * 12)),
        color: 0x404040, material: 'Steel AISI 1020', subsystem: 'CEL' });
    }
    features.push({ id: 'hv-battery', type: 'battery-pack' });

    // BMS + contactors
    const bms = PrimitiveBuilder.box(mm(200), mm(12), mm(100));
    parts.push({ name: 'BMS PCB', solid: bms,
      position: new Vec3(0, mm(-50), mm(400)),
      color: 0x004000, material: 'ABS Plastic', subsystem: 'BMS' });
    for (let i = 0; i < 3; i++) {
      const cont = PrimitiveBuilder.box(mm(60), mm(40), mm(40));
      parts.push({ name: `HV Contactor ${i + 1}`, solid: cont,
        position: new Vec3(mm(-150 + i * 80), mm(-50), mm(420)),
        color: 0x303030, material: 'Aluminum 6061-T6', subsystem: 'CON' });
    }

    return { partsList: parts, features, mass_kg: 14.0, subsystemName: 'HVB' };
  }

  static buildAccessoriesAndMounts() {
    const parts = [], features = [];

    // Front timing cover
    const cover = PrimitiveBuilder.box(mm(440), mm(380), mm(40));
    cover._isShell = true; cover.volume = () => 440 * 380 * 40 * 0.20 / 1e9;
    parts.push({ name: 'Front Timing Cover (Cast Aluminum)', solid: cover,
      position: new Vec3(0, mm(150), mm(-260)),
      color: 0xa0a0a8, material: 'Aluminum 6061-T6', subsystem: 'FCV' });

    // Oil pan / sump
    const sump = PrimitiveBuilder.box(mm(380), mm(80), mm(440));
    sump._isShell = true; sump.volume = () => 380 * 80 * 440 * 0.10 / 1e9;
    parts.push({ name: 'Oil Pan / Sump (Cast Aluminum, 7L capacity)', solid: sump,
      position: new Vec3(0, mm(-80), 0),
      color: 0xa0a0a8, material: 'Aluminum 6061-T6', subsystem: 'SMP' });

    // 3 engine mounts (FR + FL + rear torque strut)
    const mountPositions = [
      { name: 'Front-Right Engine Mount (Hydraulic Active)', x: 200, y: 230, z: -100 },
      { name: 'Front-Left Engine Mount (Hydraulic Active)',  x: -200, y: 230, z: -100 },
      { name: 'Rear Engine Torque Strut Mount',              x: 0, y: 100, z: 320 },
    ];
    for (const m of mountPositions) {
      const mount = PrimitiveBuilder.cylinder(mm(40), mm(60), 24);
      parts.push({ name: m.name, solid: mount,
        position: new Vec3(mm(m.x), mm(m.y), mm(m.z)),
        color: 0x202020, material: 'Nylon 6/6', subsystem: 'MNT',
        metadata: { type: 'hydraulic active mount with viscous damping' }});
      features.push({ id: `engine-mount-${m.name}`, type: 'engine-mount' });
    }

    // Air cleaner housing
    const airbox = PrimitiveBuilder.box(mm(300), mm(150), mm(250));
    airbox._isShell = true; airbox.volume = () => 300 * 150 * 250 * 0.10 / 1e9;
    parts.push({ name: 'Air Cleaner Housing', solid: airbox,
      position: new Vec3(0, mm(550), mm(-300)),
      color: 0x202020, material: 'Nylon 6/6', subsystem: 'AIR-BOX' });

    return { partsList: parts, features, mass_kg: 16.0, subsystemName: 'ACC' };
  }
}
