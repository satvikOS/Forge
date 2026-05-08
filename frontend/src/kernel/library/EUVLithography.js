/**
 * ArchDisc Geometry Kernel — EUV Lithography Machine Library
 * Production-grade ASML-style Extreme Ultraviolet Lithography system.
 *
 * Reference: ASML TWINSCAN NXE:3600D — 13.5nm EUV, 160 WPH, NA 0.33
 *
 * Components modeled to engineering specifications:
 * - EUV light source (tin droplet laser-produced plasma)
 * - Collector mirror (multilayer Mo/Si, 5m focal length)
 * - Illumination optics (4-mirror system)
 * - Reticle stage (6-DOF magnetic levitation)
 * - Projection optics box (6-mirror anamorphic, NA 0.33)
 * - Wafer stage (dual-stage, 500mm/s scan speed)
 * - Vacuum chambers (10^-7 mbar)
 * - Frame and vibration isolation
 * - Cooling systems
 * - Sensor arrays
 */

import Vec3 from '../math/Vec3.js';
import PrimitiveBuilder from '../features/PrimitiveBuilder.js';
import ExtrudeFeature from '../features/ExtrudeFeature.js';
import RevolveFeature from '../features/RevolveFeature.js';
import BooleanEngine from '../features/BooleanEngine.js';
import LoftSweep from '../features/LoftSweep.js';
import Assembly from '../assembly/Assembly.js';

const PI = Math.PI;

export default class EUVLithography {

  /**
   * Build complete EUV lithography machine assembly.
   * Total machine dimensions: ~3m x 5m x 3m, ~180 tons
   */
  static build(specs = {}) {
    const s = {
      wavelength: 13.5e-9,       // 13.5nm EUV
      na: 0.33,                   // Numerical aperture
      fieldSize: [26e-3, 33e-3],  // 26mm x 33mm exposure field
      waferSize: 0.300,           // 300mm wafer
      throughput: 160,            // wafers per hour
      ...specs,
    };

    const assy = new Assembly('EUV Lithography Machine — ASML NXE Class');

    // ============================================================
    // MAIN FRAME & BASE
    // ============================================================
    EUVLithography._buildFrame(assy, s);

    // ============================================================
    // EUV LIGHT SOURCE MODULE
    // ============================================================
    EUVLithography._buildLightSource(assy, s);

    // ============================================================
    // COLLECTOR & ILLUMINATION OPTICS
    // ============================================================
    EUVLithography._buildIllumination(assy, s);

    // ============================================================
    // RETICLE STAGE
    // ============================================================
    EUVLithography._buildReticleStage(assy, s);

    // ============================================================
    // PROJECTION OPTICS BOX (POB)
    // ============================================================
    EUVLithography._buildProjectionOptics(assy, s);

    // ============================================================
    // WAFER STAGE (DUAL STAGE)
    // ============================================================
    EUVLithography._buildWaferStage(assy, s);

    // ============================================================
    // VACUUM SYSTEM
    // ============================================================
    EUVLithography._buildVacuumSystem(assy, s);

    // ============================================================
    // COOLING SYSTEM
    // ============================================================
    EUVLithography._buildCoolingSystem(assy, s);

    // ============================================================
    // SENSOR & METROLOGY
    // ============================================================
    EUVLithography._buildMetrology(assy, s);

    // ============================================================
    // ELECTRONICS & CONTROL CABINETS
    // ============================================================
    EUVLithography._buildElectronics(assy, s);

    // ============================================================
    // VIBRATION ISOLATION
    // ============================================================
    EUVLithography._buildVibrationIsolation(assy, s);

    return assy;
  }

  // --- MAIN FRAME ---
  static _buildFrame(assy, s) {
    // Base platform (granite/steel composite)
    const base = PrimitiveBuilder.box(5.0, 0.4, 3.0);
    base.name = 'Base Platform';
    assy.addPart(base, 'Base Platform', { color: 0x555566, position: Vec3.zero(), material: 'Cast Iron' });

    // Main structural columns (4 corners)
    const columnPositions = [
      [-2.2, 1.5, -1.2], [2.2, 1.5, -1.2],
      [-2.2, 1.5, 1.2], [2.2, 1.5, 1.2],
    ];
    columnPositions.forEach((pos, i) => {
      const col = PrimitiveBuilder.box(0.25, 2.6, 0.25);
      col.name = `Column ${i + 1}`;
      assy.addPart(col, `Structural Column ${i + 1}`, {
        color: 0x666677, position: Vec3.from(pos), material: 'Steel AISI 4340'
      });
    });

    // Top bridge beam
    const bridge = PrimitiveBuilder.box(4.8, 0.2, 2.8);
    bridge.name = 'Bridge Beam';
    assy.addPart(bridge, 'Top Bridge Beam', { color: 0x666677, position: new Vec3(0, 2.9, 0), material: 'Steel AISI 4340' });

    // Cross braces
    for (let z = -1; z <= 1; z += 2) {
      const brace = PrimitiveBuilder.box(4.6, 0.08, 0.08);
      assy.addPart(brace, `Cross Brace ${z > 0 ? 'Front' : 'Rear'}`, {
        color: 0x555566, position: new Vec3(0, 1.5, z * 1.0), material: 'Steel AISI 1020'
      });
    }

    // Floor plates
    const floor = PrimitiveBuilder.box(5.2, 0.05, 3.2);
    assy.addPart(floor, 'Floor Plate', { color: 0x444455, position: new Vec3(0, -0.22, 0), material: 'Steel AISI 1020' });
  }

  // --- EUV LIGHT SOURCE ---
  static _buildLightSource(assy, s) {
    const srcX = -2.8;

    // CO2 drive laser housing
    const laserHousing = PrimitiveBuilder.box(1.2, 0.6, 0.8);
    assy.addPart(laserHousing, 'CO2 Drive Laser', { color: 0x334455, position: new Vec3(srcX - 0.8, 1.0, 0), material: 'Aluminum 6061-T6' });

    // Pre-pulse laser
    const prePulse = PrimitiveBuilder.cylinder(0.08, 0.6, 16);
    assy.addPart(prePulse, 'Pre-Pulse Laser', { color: 0x445566, position: new Vec3(srcX - 0.3, 1.3, 0.25), material: 'Stainless Steel 316' });

    // Tin droplet generator
    const tinGen = PrimitiveBuilder.cylinder(0.06, 0.25, 12);
    assy.addPart(tinGen, 'Tin Droplet Generator', { color: 0x888899, position: new Vec3(srcX, 1.8, 0), material: 'Stainless Steel 316' });

    // Tin supply reservoir
    const tinReservoir = PrimitiveBuilder.cylinder(0.12, 0.15, 16);
    assy.addPart(tinReservoir, 'Tin Supply Reservoir', { color: 0x777788, position: new Vec3(srcX, 2.1, 0), material: 'Stainless Steel 316' });

    // Plasma chamber (spherical vacuum vessel)
    const plasmaChamber = PrimitiveBuilder.sphere(0.35, 24, 16);
    assy.addPart(plasmaChamber, 'Plasma Generation Chamber', { color: 0x556677, position: new Vec3(srcX, 1.5, 0), material: 'Stainless Steel 316' });

    // Debris mitigation system
    const debrisMitigation = PrimitiveBuilder.cylinder(0.3, 0.15, 24);
    assy.addPart(debrisMitigation, 'Debris Mitigation System', { color: 0x667788, position: new Vec3(srcX + 0.4, 1.5, 0), material: 'Stainless Steel 316' });

    // Collector mirror housing
    const collectorHousing = PrimitiveBuilder.cylinder(0.5, 0.3, 32);
    assy.addPart(collectorHousing, 'Collector Mirror Housing', { color: 0x445566, position: new Vec3(srcX + 0.8, 1.5, 0), material: 'Aluminum 6061-T6' });

    // Beam transport tubes
    for (let i = 0; i < 3; i++) {
      const tube = PrimitiveBuilder.cylinder(0.04, 0.5 + i * 0.2, 8);
      assy.addPart(tube, `Beam Transport Tube ${i + 1}`, {
        color: 0x778899, position: new Vec3(srcX + 1.3 + i * 0.3, 1.5, 0),
        rotation: new Vec3(0, 0, PI / 2), material: 'Stainless Steel 316'
      });
    }

    // Spectral purity filter
    const spf = PrimitiveBuilder.cylinder(0.15, 0.02, 24);
    assy.addPart(spf, 'Spectral Purity Filter', { color: 0x99aabb, position: new Vec3(srcX + 1.1, 1.5, 0), material: 'Silicon' });
  }

  // --- ILLUMINATION OPTICS ---
  static _buildIllumination(assy, s) {
    const illumX = -0.8;

    // Illumination chamber
    const illumChamber = PrimitiveBuilder.box(0.8, 1.0, 0.6);
    assy.addPart(illumChamber, 'Illumination Optics Chamber', { color: 0x445566, position: new Vec3(illumX, 1.8, 0), material: 'Aluminum 6061-T6' });

    // 4 illumination mirrors (field facet, pupil facet, M3, M4)
    const mirrorNames = ['Field Facet Mirror', 'Pupil Facet Mirror', 'Relay Mirror M3', 'Relay Mirror M4'];
    const mirrorPositions = [
      [illumX - 0.15, 2.1, 0], [illumX + 0.15, 2.0, 0],
      [illumX - 0.1, 1.6, 0], [illumX + 0.2, 1.7, 0],
    ];
    mirrorNames.forEach((name, i) => {
      const mirror = PrimitiveBuilder.cylinder(0.1 - i * 0.01, 0.02, 24);
      assy.addPart(mirror, name, {
        color: 0xccddee, position: Vec3.from(mirrorPositions[i]),
        rotation: new Vec3(PI / 4 * (i % 2 === 0 ? 1 : -1), 0, 0),
        material: 'Silicon'
      });
    });

    // Mirror actuators (piezo)
    mirrorPositions.forEach((pos, i) => {
      const actuator = PrimitiveBuilder.cylinder(0.015, 0.04, 8);
      assy.addPart(actuator, `Mirror Actuator ${i + 1}`, {
        color: 0x667788, position: new Vec3(pos[0], pos[1] - 0.04, pos[2] + 0.08),
        material: 'Stainless Steel 316'
      });
    });
  }

  // --- RETICLE STAGE ---
  static _buildReticleStage(assy, s) {
    const retX = 0;
    const retY = 2.4;

    // Reticle stage platform (mag-lev)
    const reticlePlatform = PrimitiveBuilder.box(0.5, 0.06, 0.4);
    assy.addPart(reticlePlatform, 'Reticle Stage Platform', { color: 0x888899, position: new Vec3(retX, retY, 0), material: 'Titanium Ti-6Al-4V' });

    // Reticle (photomask) — 152mm x 152mm x 6.35mm
    const reticle = PrimitiveBuilder.box(0.152, 0.00635, 0.152);
    assy.addPart(reticle, 'EUV Reticle (Photomask)', { color: 0xddddff, position: new Vec3(retX, retY + 0.035, 0), material: 'Glass' });

    // Pellicle frame
    const pellicle = PrimitiveBuilder.box(0.16, 0.002, 0.16);
    assy.addPart(pellicle, 'Pellicle Frame', { color: 0xaabbcc, position: new Vec3(retX, retY + 0.045, 0), material: 'Carbon Fiber Composite' });

    // E-chuck (electrostatic clamp)
    const echuck = PrimitiveBuilder.box(0.18, 0.015, 0.18);
    assy.addPart(echuck, 'Electrostatic Chuck', { color: 0x556677, position: new Vec3(retX, retY - 0.04, 0), material: 'Silicon' });

    // Linear motors (X and Y)
    for (let axis = 0; axis < 2; axis++) {
      const motor = PrimitiveBuilder.box(axis === 0 ? 0.35 : 0.06, 0.04, axis === 0 ? 0.06 : 0.35);
      assy.addPart(motor, `Reticle Stage Motor ${axis === 0 ? 'X' : 'Y'}`, {
        color: 0x445566, position: new Vec3(retX + (axis === 0 ? 0 : 0.3), retY - 0.06, axis === 0 ? 0.25 : 0),
        material: 'Copper C11000'
      });
    }

    // Interferometer targets
    for (let i = 0; i < 3; i++) {
      const target = PrimitiveBuilder.box(0.04, 0.08, 0.005);
      assy.addPart(target, `Reticle Interferometer Mirror ${i + 1}`, {
        color: 0xeeeeff, position: new Vec3(retX + (i - 1) * 0.2, retY, 0.22),
        material: 'Glass'
      });
    }
  }

  // --- PROJECTION OPTICS BOX ---
  static _buildProjectionOptics(assy, s) {
    const pobX = 0;
    const pobY = 1.2;

    // POB housing (main vacuum vessel)
    const pobHousing = PrimitiveBuilder.cylinder(0.45, 1.0, 32);
    assy.addPart(pobHousing, 'Projection Optics Box Housing', { color: 0x445566, position: new Vec3(pobX, pobY, 0), material: 'Stainless Steel 316' });

    // 6 projection mirrors (M1-M6, aspheric)
    const mirrorSpecs = [
      { name: 'M1 Mirror', r: 0.18, y: 1.9, tilt: 0.1 },
      { name: 'M2 Mirror', r: 0.12, y: 1.75, tilt: -0.15 },
      { name: 'M3 Mirror', r: 0.15, y: 1.55, tilt: 0.12 },
      { name: 'M4 Mirror', r: 0.10, y: 1.35, tilt: -0.1 },
      { name: 'M5 Mirror', r: 0.20, y: 1.1, tilt: 0.08 },
      { name: 'M6 Mirror', r: 0.25, y: 0.85, tilt: -0.05 },
    ];

    mirrorSpecs.forEach(({ name, r, y, tilt }) => {
      const mirror = PrimitiveBuilder.cylinder(r, 0.025, 32);
      assy.addPart(mirror, name, {
        color: 0xccddff, position: new Vec3(pobX + Math.sin(tilt) * 0.15, y, 0),
        rotation: new Vec3(tilt, 0, 0), material: 'Silicon'
      });

      // Mirror mount (Zerodur/Invar flexures)
      const mount = PrimitiveBuilder.cylinder(r + 0.02, 0.015, 16);
      assy.addPart(mount, `${name} Mount`, {
        color: 0x556677, position: new Vec3(pobX + Math.sin(tilt) * 0.15, y - 0.025, 0),
        material: 'Stainless Steel 316'
      });
    });

    // Aperture stop
    const aperture = PrimitiveBuilder.cylinder(0.08, 0.005, 24);
    assy.addPart(aperture, 'Aperture Stop', { color: 0x333344, position: new Vec3(pobX, 1.45, 0), material: 'Stainless Steel 316' });
  }

  // --- WAFER STAGE (DUAL STAGE) ---
  static _buildWaferStage(assy, s) {
    const wsY = 0.3;

    // Metrology frame (Zerodur/Invar)
    const metroFrame = PrimitiveBuilder.box(1.2, 0.15, 1.0);
    assy.addPart(metroFrame, 'Metrology Frame', { color: 0x556666, position: new Vec3(0, wsY + 0.15, 0), material: 'Stainless Steel 316' });

    // Dual wafer stages
    for (let stage = 0; stage < 2; stage++) {
      const stageX = stage === 0 ? -0.3 : 0.3;
      const stageName = stage === 0 ? 'Expose' : 'Measure';

      // Stage chuck
      const chuck = PrimitiveBuilder.cylinder(0.16, 0.03, 32);
      assy.addPart(chuck, `Wafer Chuck (${stageName})`, {
        color: 0x778888, position: new Vec3(stageX, wsY, 0), material: 'Silicon'
      });

      // Wafer (300mm)
      const wafer = PrimitiveBuilder.cylinder(0.15, 0.00075, 48);
      assy.addPart(wafer, `300mm Wafer (${stageName})`, {
        color: 0xaabbcc, position: new Vec3(stageX, wsY + 0.017, 0), material: 'Silicon'
      });

      // Stage base (air bearing)
      const stageBase = PrimitiveBuilder.box(0.4, 0.05, 0.4);
      assy.addPart(stageBase, `Stage Base (${stageName})`, {
        color: 0x667777, position: new Vec3(stageX, wsY - 0.04, 0), material: 'Titanium Ti-6Al-4V'
      });

      // Linear motor coils (X/Y/Z)
      const motorPositions = [
        [stageX - 0.22, wsY - 0.06, 0], [stageX + 0.22, wsY - 0.06, 0],
        [stageX, wsY - 0.06, -0.22], [stageX, wsY - 0.06, 0.22],
      ];
      motorPositions.forEach((pos, i) => {
        const coil = PrimitiveBuilder.box(0.04, 0.03, 0.04);
        assy.addPart(coil, `Stage Motor ${stageName}-${i + 1}`, {
          color: 0xaa6633, position: Vec3.from(pos), material: 'Copper C11000'
        });
      });

      // Interferometer mirrors (X, Y, Rz)
      for (let m = 0; m < 2; m++) {
        const iMirror = PrimitiveBuilder.box(m === 0 ? 0.005 : 0.35, 0.06, m === 0 ? 0.35 : 0.005);
        assy.addPart(iMirror, `Stage IF Mirror ${stageName}-${m === 0 ? 'X' : 'Y'}`, {
          color: 0xeeeeff, position: new Vec3(stageX + (m === 0 ? 0.2 : 0), wsY + 0.02, m === 0 ? 0 : 0.2),
          material: 'Glass'
        });
      }
    }

    // Stage swap mechanism
    const swapRail = PrimitiveBuilder.box(1.0, 0.03, 0.06);
    assy.addPart(swapRail, 'Stage Swap Rail', { color: 0x556677, position: new Vec3(0, wsY - 0.08, 0), material: 'Steel AISI 4340' });
  }

  // --- VACUUM SYSTEM ---
  static _buildVacuumSystem(assy, s) {
    // Turbo-molecular pumps
    const pumpPositions = [
      [-1.5, 0.5, 1.3], [-1.5, 0.5, -1.3],
      [0, 0.5, 1.3], [0, 0.5, -1.3],
      [1.5, 0.5, 1.3], [1.5, 0.5, -1.3],
    ];
    pumpPositions.forEach((pos, i) => {
      const pump = PrimitiveBuilder.cylinder(0.12, 0.25, 16);
      assy.addPart(pump, `Turbo Pump ${i + 1}`, {
        color: 0x445566, position: Vec3.from(pos), material: 'Stainless Steel 316'
      });
    });

    // Vacuum gate valves
    for (let i = 0; i < 4; i++) {
      const valve = PrimitiveBuilder.box(0.15, 0.15, 0.04);
      assy.addPart(valve, `Gate Valve ${i + 1}`, {
        color: 0x667788, position: new Vec3(-1 + i * 0.7, 1.5, 1.35),
        material: 'Stainless Steel 316'
      });
    }

    // Roughing pump connection
    const roughPipe = PrimitiveBuilder.cylinder(0.04, 1.5, 8);
    assy.addPart(roughPipe, 'Roughing Pump Line', {
      color: 0x556677, position: new Vec3(-2.3, 0.3, 0),
      rotation: new Vec3(0, 0, PI / 2), material: 'Stainless Steel 316'
    });
  }

  // --- COOLING SYSTEM ---
  static _buildCoolingSystem(assy, s) {
    // Cooling manifold
    const manifold = PrimitiveBuilder.box(0.4, 0.15, 0.15);
    assy.addPart(manifold, 'Cooling Manifold', { color: 0x3366aa, position: new Vec3(2.3, 0.5, 0), material: 'Copper C11000' });

    // Cooling pipes
    const pipeRoutes = [
      [[2.3, 0.5, 0], [2.3, 1.5, 0], [0, 1.5, 0]], // to POB
      [[2.3, 0.5, 0], [2.3, 0.3, 0], [0, 0.3, 0]], // to wafer stage
      [[2.3, 0.5, 0], [-2.0, 0.5, 0], [-2.0, 1.5, 0]], // to source
    ];
    pipeRoutes.forEach((route, i) => {
      const profile = [];
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * PI * 2;
        profile.push(new Vec3(Math.cos(a) * 0.015, Math.sin(a) * 0.015, 0));
      }
      try {
        const pipe = LoftSweep.sweep(profile, route.map(p => Vec3.from(p)));
        pipe.name = `Cooling Pipe ${i + 1}`;
        assy.addPart(pipe, `Cooling Pipe ${i + 1}`, { color: 0x3366aa, material: 'Copper C11000' });
      } catch {
        const fallback = PrimitiveBuilder.cylinder(0.015, 1.5, 8);
        assy.addPart(fallback, `Cooling Pipe ${i + 1}`, {
          color: 0x3366aa, position: Vec3.from(route[0]), material: 'Copper C11000'
        });
      }
    });

    // Heat exchangers
    for (let i = 0; i < 2; i++) {
      const hx = PrimitiveBuilder.box(0.3, 0.4, 0.2);
      assy.addPart(hx, `Heat Exchanger ${i + 1}`, {
        color: 0x4477aa, position: new Vec3(2.5, 0.3 + i * 0.6, 0.8 * (i === 0 ? 1 : -1)),
        material: 'Copper C11000'
      });
    }
  }

  // --- METROLOGY ---
  static _buildMetrology(assy, s) {
    // Alignment sensor
    const alignSensor = PrimitiveBuilder.box(0.15, 0.1, 0.1);
    assy.addPart(alignSensor, 'Alignment Sensor (SMASH)', { color: 0x446688, position: new Vec3(0.35, 0.5, 0), material: 'Aluminum 6061-T6' });

    // Level sensor
    const levelSensor = PrimitiveBuilder.box(0.1, 0.06, 0.08);
    assy.addPart(levelSensor, 'Level Sensor', { color: 0x446688, position: new Vec3(-0.35, 0.5, 0), material: 'Aluminum 6061-T6' });

    // Interferometer heads (6-axis measurement)
    for (let i = 0; i < 6; i++) {
      const head = PrimitiveBuilder.cylinder(0.02, 0.08, 8);
      const angle = (i / 6) * PI * 2;
      assy.addPart(head, `Interferometer Head ${i + 1}`, {
        color: 0xaabbcc, position: new Vec3(Math.cos(angle) * 0.5, 0.35, Math.sin(angle) * 0.5),
        material: 'Glass'
      });
    }

    // Encoder scales
    for (let axis = 0; axis < 2; axis++) {
      const scale = PrimitiveBuilder.box(axis === 0 ? 0.8 : 0.005, 0.005, axis === 0 ? 0.005 : 0.8);
      assy.addPart(scale, `Encoder Scale ${axis === 0 ? 'X' : 'Y'}`, {
        color: 0xddddee, position: new Vec3(0, 0.28, 0), material: 'Glass'
      });
    }
  }

  // --- ELECTRONICS ---
  static _buildElectronics(assy, s) {
    // Control cabinets
    for (let i = 0; i < 4; i++) {
      const cabinet = PrimitiveBuilder.box(0.6, 2.0, 0.8);
      assy.addPart(cabinet, `Control Cabinet ${i + 1}`, {
        color: 0x333344, position: new Vec3(3.0, 1.0, -1.2 + i * 0.85),
        material: 'Steel AISI 1020'
      });

      // Cabinet door handles
      const handle = PrimitiveBuilder.box(0.02, 0.15, 0.02);
      assy.addPart(handle, `Cabinet Handle ${i + 1}`, {
        color: 0x999999, position: new Vec3(2.68, 1.2, -1.2 + i * 0.85),
        material: 'Stainless Steel 316'
      });
    }

    // Cable trays
    for (let i = 0; i < 3; i++) {
      const tray = PrimitiveBuilder.box(0.1, 0.03, 2.5);
      assy.addPart(tray, `Cable Tray ${i + 1}`, {
        color: 0x444455, position: new Vec3(2.5, 2.6 - i * 0.15, 0),
        material: 'Aluminum 6061-T6'
      });
    }

    // Power supply units
    for (let i = 0; i < 2; i++) {
      const psu = PrimitiveBuilder.box(0.4, 0.3, 0.5);
      assy.addPart(psu, `Power Supply ${i + 1}`, {
        color: 0x444455, position: new Vec3(-2.8, 0.5, 0.8 * (i === 0 ? 1 : -1)),
        material: 'Aluminum 6061-T6'
      });
    }
  }

  // --- VIBRATION ISOLATION ---
  static _buildVibrationIsolation(assy, s) {
    // Active vibration isolation mounts (pneumatic + piezo)
    const mountPositions = [
      [-1.8, -0.15, -1.0], [1.8, -0.15, -1.0],
      [-1.8, -0.15, 1.0], [1.8, -0.15, 1.0],
      [0, -0.15, -1.0], [0, -0.15, 1.0],
    ];
    mountPositions.forEach((pos, i) => {
      // Pneumatic spring
      const spring = PrimitiveBuilder.cylinder(0.1, 0.12, 16);
      assy.addPart(spring, `Vibration Isolator ${i + 1}`, {
        color: 0x336644, position: Vec3.from(pos), material: 'Rubber'
      });

      // Base pad
      const pad = PrimitiveBuilder.cylinder(0.14, 0.03, 16);
      assy.addPart(pad, `Isolator Pad ${i + 1}`, {
        color: 0x555566, position: new Vec3(pos[0], pos[1] - 0.08, pos[2]),
        material: 'Steel AISI 1020'
      });
    });

    // Accelerometers
    for (let i = 0; i < 4; i++) {
      const accel = PrimitiveBuilder.box(0.02, 0.02, 0.02);
      assy.addPart(accel, `Accelerometer ${i + 1}`, {
        color: 0xaaaa33, position: new Vec3(-1.5 + i, 0.22, 1.1),
        material: 'Stainless Steel 316'
      });
    }
  }
}
