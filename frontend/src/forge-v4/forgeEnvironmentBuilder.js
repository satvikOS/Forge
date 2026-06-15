// Forge Industrial Environment Builder (forgeEnvironmentBuilder.js)
// Procedural factory floor generator — 12 distinct machine models, ~100k components via instancing.

import * as THREE from 'three';

/**
 * Deterministic RNG for reproducible seeded placement
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * ============================================================================
 * MACHINE MODEL FACTORIES — each returns a Group with detailed geometry
 * ============================================================================
 */

function createV8Engine() {
  const group = new THREE.Group();
  group.userData.machineType = 'V8_ENGINE';
  group.userData.scale = 1.0;
  
  // Block (cast iron)
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.8, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.75, roughness: 0.5 })
  );
  group.add(block);
  
  // 2 Cylinder heads (aluminum)
  const headGeo = new THREE.BoxGeometry(1.0, 0.4, 0.35);
  for (let i = 0; i < 2; i++) {
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xc6c2bb, metalness: 0.88, roughness: 0.35 }));
    head.position.y = 0.6;
    head.position.z = (i - 0.5) * 0.7;
    group.add(head);
  }
  
  // 8 bolts (instanced separately, marked for batching)
  group.userData.boltCount = 8;
  group.userData.boltRadius = 0.04;
  
  // Manifold
  const manifold = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.5, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.7, roughness: 0.45 })
  );
  manifold.position.x = -0.7;
  group.add(manifold);
  
  // Pulley
  const pulley = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.8, roughness: 0.4 })
  );
  pulley.rotation.z = Math.PI / 2;
  pulley.position.set(-0.5, -0.6, -0.8);
  group.add(pulley);
  
  return group;
}

function createGearbox() {
  const group = new THREE.Group();
  group.userData.machineType = 'GEARBOX';
  group.userData.scale = 0.8;
  
  // Housing (cast iron)
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.7, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.75, roughness: 0.5 })
  );
  group.add(housing);
  
  // Shaft stubs (steel)
  for (let i = 0; i < 2; i++) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
    );
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = (i - 0.5) * 0.8;
    group.add(shaft);
  }
  
  // Bolt flanges
  group.userData.boltCount = 6;
  group.userData.boltRadius = 0.035;
  
  return group;
}

function createCentrifugalPump() {
  const group = new THREE.Group();
  group.userData.machineType = 'PUMP';
  group.userData.scale = 0.7;
  
  // Volute (spiral pump housing) — approximated as offset sphere
  const volute = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.72, roughness: 0.48 })
  );
  group.add(volute);
  
  // Motor mount (cylinder)
  const motor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.65, roughness: 0.5 })
  );
  motor.position.z = 0.5;
  group.add(motor);
  
  // Base feet
  group.userData.boltCount = 4;
  group.userData.boltRadius = 0.03;
  
  return group;
}

function createPressureTank() {
  const group = new THREE.Group();
  group.userData.machineType = 'TANK';
  group.userData.scale = 1.2;
  
  // Main cylinder (steel)
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 1.8, 16),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  cylinder.position.y = 0;
  group.add(cylinder);
  
  // Top cap (hemisphere)
  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 16, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  topCap.position.y = 0.9;
  topCap.scale.y = 0.5;
  group.add(topCap);
  
  // Legs
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.7, roughness: 0.45 })
    );
    leg.position.set(Math.cos((i * Math.PI * 2) / 4) * 0.35, -1.0, Math.sin((i * Math.PI * 2) / 4) * 0.35);
    group.add(leg);
  }
  
  // Nozzles (small cylinders)
  const nozzle1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.25, 6),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.88, roughness: 0.35 })
  );
  nozzle1.position.set(0.45, 0.3, 0);
  nozzle1.rotation.z = Math.PI / 2;
  group.add(nozzle1);
  
  return group;
}

function createCNCMill() {
  const group = new THREE.Group();
  group.userData.machineType = 'CNC_MILL';
  group.userData.scale = 1.1;
  
  // Column (vertical post, cast iron)
  const column = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 2.0, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x2d5016, metalness: 0.35, roughness: 0.65 })
  );
  group.add(column);
  
  // Table (horizontal work surface)
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.15, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.75, roughness: 0.5 })
  );
  table.position.y = 0.5;
  group.add(table);
  
  // Spindle head (mounted on column)
  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  spindle.position.y = 1.5;
  group.add(spindle);
  
  // Enclosure frame (minimal)
  group.userData.enclosureHeight = 2.2;
  
  return group;
}

function createConveyor() {
  const group = new THREE.Group();
  group.userData.machineType = 'CONVEYOR';
  group.userData.scale = 1.3;
  
  // Frame (steel I-beam profile, simplified)
  const frameX = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  group.add(frameX);
  
  const frameZ = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 1.0),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  frameZ.position.x = 1.4;
  group.add(frameZ);
  
  // 2 rollers (instanced for performance)
  group.userData.rollerCount = 2;
  group.userData.rollerRadius = 0.15;
  
  return group;
}

function createPipeRack() {
  const group = new THREE.Group();
  group.userData.machineType = 'PIPE_RACK';
  group.userData.scale = 1.5;
  
  // I-beam frame (steel, painted)
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(4.0, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x5a7a4a, metalness: 0.4, roughness: 0.6 })
  );
  group.add(beam);
  
  // Vertical supports
  const support = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 2.0, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x5a7a4a, metalness: 0.4, roughness: 0.6 })
  );
  support.position.set(-1.8, 1.0, 0);
  group.add(support.clone());
  support.position.x = 1.8;
  group.add(support.clone());
  
  // Pipe runs (cylindrical, instanced)
  group.userData.pipeCount = 3;
  group.userData.pipeRadius = 0.08;
  
  return group;
}

function createOilDrum() {
  const group = new THREE.Group();
  group.userData.machineType = 'OIL_DRUM';
  group.userData.scale = 0.5;
  
  // Main cylinder (steel, industrial orange/rust)
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12),
    new THREE.MeshStandardMaterial({ color: 0xc87533, metalness: 0.65, roughness: 0.55 })
  );
  group.add(drum);
  
  // Top ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.04, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a6f47, metalness: 0.7, roughness: 0.5 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  group.add(ring);
  
  return group;
}

function createPallet() {
  const group = new THREE.Group();
  group.userData.machineType = 'PALLET';
  group.userData.scale = 0.6;
  
  // Deck boards
  for (let i = 0; i < 3; i++) {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.05, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x5a4a3a, metalness: 0.2, roughness: 0.8 })
    );
    board.position.z = (i - 1) * 0.35;
    group.add(board);
  }
  
  // Blocks (stringers)
  for (let i = 0; i < 2; i++) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x5a4a3a, metalness: 0.2, roughness: 0.8 })
    );
    block.position.x = (i - 0.5) * 0.7;
    block.position.y = -0.1;
    group.add(block);
  }
  
  return group;
}

function createCrate() {
  const group = new THREE.Group();
  group.userData.machineType = 'CRATE';
  group.userData.scale = 0.8;
  
  // Wooden frame (simplified)
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.9, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x6a5a4a, metalness: 0.1, roughness: 0.9 })
  );
  group.add(crate);
  
  // Metal bands
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.3 })
  );
  band.position.y = 0.35;
  group.add(band.clone());
  band.position.y = -0.35;
  group.add(band.clone());
  
  return group;
}

function createIBeam() {
  const group = new THREE.Group();
  group.userData.machineType = 'I_BEAM';
  group.userData.scale = 2.0;
  
  // Vertical web
  const web = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 3.0, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  group.add(web);
  
  // Top flange
  const topFlange = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.15, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  topFlange.position.y = 1.5;
  group.add(topFlange);
  
  // Bottom flange
  const botFlange = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.15, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  botFlange.position.y = -1.5;
  group.add(botFlange);
  
  return group;
}

function createControlCabinet() {
  const group = new THREE.Group();
  group.userData.machineType = 'CONTROL_CAB';
  group.userData.scale = 0.7;
  
  // Main enclosure (painted steel)
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.5, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x2d5016, metalness: 0.35, roughness: 0.65 })
  );
  group.add(box);
  
  // Door front (slightly inset)
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.4, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1a3a0a, metalness: 0.4, roughness: 0.6 })
  );
  door.position.z = 0.15;
  group.add(door);
  
  // Panel details (small rectangles)
  for (let i = 0; i < 3; i++) {
    const detail = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.2, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.4 })
    );
    detail.position.y = (i - 1) * 0.4;
    detail.position.z = 0.2;
    group.add(detail);
  }
  
  return group;
}

function createElectricMotor() {
  const group = new THREE.Group();
  group.userData.machineType = 'MOTOR';
  group.userData.scale = 0.6;
  
  // Motor body (cylindrical)
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.65, roughness: 0.5 })
  );
  group.add(body);
  
  // Shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.92, roughness: 0.28 })
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.5;
  group.add(shaft);
  
  // Mounting feet
  group.userData.boltCount = 4;
  group.userData.boltRadius = 0.025;
  
  return group;
}

/**
 * ============================================================================
 * INSTANCED COMPONENT BATCHING
 * ============================================================================
 */

function createBoltInstances(scene, totalBolts) {
  const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.85, roughness: 0.35 });
  const instBolts = new THREE.InstancedMesh(boltGeo, boltMat, totalBolts);
  instBolts.userData.forgeBody = true;
  instBolts.userData.componentType = 'bolts';
  return instBolts;
}

function createFastenerInstances(scene, totalFasteners) {
  const fastGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
  const fastMat = new THREE.MeshStandardMaterial({ color: 0xa8a8a8, metalness: 0.8, roughness: 0.4 });
  const instFast = new THREE.InstancedMesh(fastGeo, fastMat, totalFasteners);
  instFast.userData.forgeBody = true;
  instFast.userData.componentType = 'fasteners';
  return instFast;
}

function createDrumInstances(scene, totalDrums) {
  const drumGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12);
  const drumMat = new THREE.MeshStandardMaterial({ color: 0xc87533, metalness: 0.65, roughness: 0.55 });
  const instDrums = new THREE.InstancedMesh(drumGeo, drumMat, totalDrums);
  instDrums.userData.forgeBody = true;
  instDrums.userData.componentType = 'drums';
  return instDrums;
}

function createRollerInstances(scene, totalRollers) {
  const rollerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 12);
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.75, roughness: 0.5 });
  const instRollers = new THREE.InstancedMesh(rollerGeo, rollerMat, totalRollers);
  instRollers.userData.forgeBody = true;
  instRollers.userData.componentType = 'rollers';
  return instRollers;
}

function createCrateInstances(scene, totalCrates) {
  const crateGeo = new THREE.BoxGeometry(1.0, 0.9, 0.9);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, metalness: 0.1, roughness: 0.9 });
  const instCrates = new THREE.InstancedMesh(crateGeo, crateMat, totalCrates);
  instCrates.userData.forgeBody = true;
  instCrates.userData.componentType = 'crates';
  return instCrates;
}

/**
 * ============================================================================
 * MAIN ENVIRONMENT BUILDER
 * ============================================================================
 */

function makeRngForSeed(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function forgeBuildEnvironment({ count = 100000, seed = 42 } = {}) {
  const scene = (typeof window !== 'undefined' && window.__forgeScene) || new THREE.Scene();
  const rng = makeRngForSeed(seed);
  const unit = count / 100000; // scale fill targets with requested component count

  // ── facility footprint: a rectangular plant building, zoned along X ──
  const FLOOR_X = 268, FLOOR_Z = 184;
  const zMin = -86, zMax = 86;                     // usable depth (end margins)
  const PROD = { x0: -130, x1: -8 };               // production hall (machine rows)
  const WARE = { x0: 2, x1: 96 };                  // warehouse (pallet racking)
  const FARM = { x0: 100, x1: 132 };               // drum / tank farm

  // ── shared materials (varied palette → reads as a real plant, not monochrome) ──
  const M = {
    concrete:  new THREE.MeshStandardMaterial({ color: 0x8f8d86, metalness: 0.05, roughness: 0.92 }),
    concreteB: new THREE.MeshStandardMaterial({ color: 0x9b968c, metalness: 0.05, roughness: 0.95 }),
    aisle:     new THREE.MeshStandardMaterial({ color: 0xb0a23a, metalness: 0.0,  roughness: 0.85 }),
    struct:    new THREE.MeshStandardMaterial({ color: 0x4d5a66, metalness: 0.55, roughness: 0.5 }),
    rackUp:    new THREE.MeshStandardMaterial({ color: 0xc85a26, metalness: 0.45, roughness: 0.55 }),
    rackBeam:  new THREE.MeshStandardMaterial({ color: 0x2f5fa6, metalness: 0.45, roughness: 0.5 }),
    crate:     new THREE.MeshStandardMaterial({ color: 0xb98f57, metalness: 0.04, roughness: 0.92 }),
    drum:      new THREE.MeshStandardMaterial({ color: 0x2f6fb0, metalness: 0.45, roughness: 0.5 }),
    drumLid:   new THREE.MeshStandardMaterial({ color: 0x255c93, metalness: 0.5,  roughness: 0.45 }),
    wood:      new THREE.MeshStandardMaterial({ color: 0x7a5a34, metalness: 0.04, roughness: 0.9 }),
    zinc:      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8,  roughness: 0.38 }),
    bolt:      new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.35 }),
    castIron:  new THREE.MeshStandardMaterial({ color: 0x44474b, metalness: 0.7,  roughness: 0.5 }),
    table:     new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.4,  roughness: 0.6 }),
  };

  // ── instanced-component registry: one InstancedMesh per key, built at the end ──
  const RACK_H = 6.2, LEVELS = 4, LEVEL_H = 1.42, BAY_W = 2.6, RACK_DEPTH = 1.25;
  const COL_H = 9.5;
  const REG = {
    crate:     [new THREE.BoxGeometry(0.56, 0.5, 0.56),            M.crate],
    rackUp:    [new THREE.BoxGeometry(0.13, RACK_H, 0.13),         M.rackUp],
    rackBeam:  [new THREE.BoxGeometry(0.08, 0.1, 1),               M.rackBeam], // length-1 along Z, scaled
    drum:      [new THREE.CylinderGeometry(0.29, 0.29, 0.86, 14),  M.drum],
    drumLid:   [new THREE.CylinderGeometry(0.30, 0.30, 0.06, 14),  M.drumLid],
    drumPallet:[new THREE.BoxGeometry(1.0, 0.12, 1.0),             M.wood],
    pallet:    [new THREE.BoxGeometry(1.2, 0.14, 1.0),             M.wood],
    fastener:  [new THREE.BoxGeometry(0.05, 0.04, 0.05),           M.zinc],
    stud:      [new THREE.CylinderGeometry(0.028, 0.028, 0.13, 6), M.zinc],
    bolt:      [new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6), M.bolt],
    column:    [new THREE.BoxGeometry(0.42, COL_H, 0.42),          M.struct],
    roofBeam:  [new THREE.BoxGeometry(1, 0.42, 0.22),              M.struct], // length-1 along X, scaled
    roller:    [new THREE.CylinderGeometry(0.12, 0.12, 1.05, 10),  M.castIron],
    tote:      [new THREE.BoxGeometry(0.9, 0.45, 0.6),             M.table],
  };
  const acc = {}; // key -> flat Float32-ish number[] of 4x4 matrices
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function place(k, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
    _p.set(x, y, z); _e.set(0, ry, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s); (acc[k] || (acc[k] = [])); _m.toArray(acc[k], acc[k].length);
  }

  let totalComponents = 0, drawCalls = 0;

  // ── ground: zoned concrete slabs + painted aisles ──
  function slab(x0, x1, color, y) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, FLOOR_Z), color);
    g.position.set((x0 + x1) / 2, y - 0.15, 0); g.userData.forgeBody = true; g.userData.componentType = 'floor';
    scene.add(g); drawCalls++; totalComponents++;
  }
  slab(-FLOOR_X / 2, FLOOR_X / 2, M.concrete, 0);      // base slab
  slab(PROD.x0 - 2, PROD.x1 + 2, M.concreteB, 0.01);   // production pad
  slab(FARM.x0 - 2, FARM.x1 + 2, M.concreteB, 0.01);   // farm pad
  // central aisle stripe between production and warehouse
  const aisleStripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, FLOOR_Z), M.aisle);
  aisleStripe.position.set(-3, 0.02, 0); aisleStripe.userData.forgeBody = true; scene.add(aisleStripe); drawCalls++; totalComponents++;

  // ── building shell: column grid + roof trusses (open roof so the aerial sees in) ──
  for (let cx = -FLOOR_X / 2 + 10; cx <= FLOOR_X / 2 - 10; cx += 22) {
    for (let cz = zMin; cz <= zMax; cz += 22) { place('column', cx, COL_H / 2, cz, 1, 1, 1, 0); totalComponents++; }
  }
  // roof top-chords spanning X at each column row, plus Z purlins
  for (let cz = zMin; cz <= zMax; cz += 22) place('roofBeam', 0, COL_H, cz, FLOOR_X - 16, 1, 1, 0);
  for (let cx = -FLOOR_X / 2 + 10; cx <= FLOOR_X / 2 - 10; cx += 22) place('roofBeam', cx, COL_H - 0.3, 0, FLOOR_Z - 8, 1, 1, Math.PI / 2);
  for (let cx = -FLOOR_X / 2 + 14; cx <= FLOOR_X / 2 - 14; cx += 4) place('roofBeam', cx, COL_H - 0.55, 0, FLOOR_Z - 10, 0.5, 0.5, Math.PI / 2); // purlins

  // ============================================================
  // ZONE A — PRODUCTION HALL: rows of varied machines (the heroes)
  // ============================================================
  const machineFactories = [
    createV8Engine, createGearbox, createCentrifugalPump, createPressureTank, createCNCMill,
    createConveyor, createPipeRack, createControlCabinet, createElectricMotor,
  ];
  const MACHINE_SCALE = 2.3;
  let uniqueMachines = 0, totalBolts = 0, totalRollers = 0;
  const ROW_PITCH = 9.5, SLOT_PITCH = 6.5;
  let mi = 0;
  for (let x = PROD.x0 + 4; x <= PROD.x1 - 4; x += ROW_PITCH) {
    for (let z = zMin + 4; z <= zMax - 4; z += SLOT_PITCH) {
      if (rng() < 0.32) continue; // leave gaps → walkable bays, not a solid block
      const factory = machineFactories[mi % machineFactories.length];
      const mach = factory(); mi++;
      mach.scale.setScalar(MACHINE_SCALE * (0.85 + rng() * 0.3));
      mach.position.set(x + (rng() - 0.5) * 1.2, MACHINE_SCALE * 0.6, z + (rng() - 0.5) * 1.2);
      mach.rotation.y = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.25;
      mach.userData.forgeBody = true; mach.userData.machineInstance = uniqueMachines;
      mach.traverse((c) => { if (c.isMesh) { c.userData.forgeBody = true; totalComponents++; drawCalls++; } });
      scene.add(mach); uniqueMachines++;
      // machine-anchored bolts (instanced)
      const bc = mach.userData.boltCount || 4;
      for (let b = 0; b < bc; b++) { const a = (b / bc) * Math.PI * 2; place('bolt', mach.position.x + Math.cos(a) * 1.1, 0.12, mach.position.z + Math.sin(a) * 1.1, 1, 1, 1, 0); totalBolts++; }
      // conveyor / pipe machines drop a short roller line
      const rc = (mach.userData.rollerCount || 0) + (mach.userData.pipeCount || 0);
      for (let r = 0; r < rc * 3; r++) { place('roller', mach.position.x + (r - rc * 1.5) * 0.5, 0.55, mach.position.z, 1, 1, 1, Math.PI / 2); totalRollers++; }
    }
  }

  // ============================================================
  // ZONE B — WAREHOUSE: tall pallet racking loaded with crates
  // (structure built for every bay; crates fill until target → realistic partial load)
  // ============================================================
  const crateTarget = Math.round(count * 0.34);
  const fastTarget = Math.round(count * 0.15);
  const studTarget = Math.round(count * 0.06);
  let crates = 0, fasteners = 0, studs = 0, rackUprights = 0, rackBeams = 0, totes = 0;
  const ROWP = RACK_DEPTH + 3.3; // rack depth + aisle
  const bays = Math.floor((zMax - zMin - 4) / BAY_W);
  let rowIdx = 0;
  for (let x = WARE.x0 + 1; x <= WARE.x1 - RACK_DEPTH; x += ROWP, rowIdx++) {
    const smallParts = rowIdx < 2; // first two rows = small-parts (totes of fasteners/studs)
    // uprights at every bay boundary, front + back
    for (let b = 0; b <= bays; b++) {
      const z = zMin + 4 + b * BAY_W;
      place('rackUp', x, RACK_H / 2, z, 1, 1, 1, 0); rackUprights++;
      place('rackUp', x + RACK_DEPTH, RACK_H / 2, z, 1, 1, 1, 0); rackUprights++;
    }
    for (let b = 0; b < bays; b++) {
      const zc = zMin + 4 + (b + 0.5) * BAY_W;
      for (let l = 0; l < LEVELS; l++) {
        const yL = 0.25 + l * LEVEL_H;
        // shelf beams front + back (length-1 geo scaled to bay width along Z)
        place('rackBeam', x, yL, zc, 1, 1, BAY_W * 0.96, 0); rackBeams++;
        place('rackBeam', x + RACK_DEPTH, yL, zc, 1, 1, BAY_W * 0.96, 0); rackBeams++;
        if (smallParts) {
          // a couple of parts totes per shelf, each a tight grid of fasteners/studs
          for (let t = 0; t < 2; t++) {
            const tx = x + (0.3 + t * 0.6) * RACK_DEPTH, tz = zc + (t - 0.5) * 0.9;
            place('tote', tx, yL + 0.28, tz, 1, 1, 1, 0); totes++; totalComponents++;
            for (let fz = 0; fz < 6; fz++) for (let fx = 0; fx < 5; fx++) {
              if (l % 2 === 0 && fasteners < fastTarget) { place('fastener', tx - 0.3 + fx * 0.16, yL + 0.5, tz - 0.22 + fz * 0.1, 1, 1, 1, rng() * 6.28); fasteners++; }
              else if (studs < studTarget) { place('stud', tx - 0.3 + fx * 0.16, yL + 0.5, tz - 0.22 + fz * 0.1, 1, 1, 1, 0); studs++; }
            }
          }
        } else if (crates < crateTarget) {
          // crate grid on the shelf (2 across X, 4 along Z)
          for (let cxI = 0; cxI < 2; cxI++) for (let czI = 0; czI < 4 && crates < crateTarget; czI++) {
            if (rng() < 0.12) continue; // occasional empty slot
            const sc = 0.85 + rng() * 0.35;
            place('crate', x + 0.32 + cxI * 0.62, yL + 0.3, zc - 0.95 + czI * 0.62, sc, sc, sc, (rng() - 0.5) * 0.15);
            crates++;
          }
        }
      }
    }
  }

  // ============================================================
  // ZONE C — DRUM / TANK FARM: gridded drums (2-high) on pallets + big tanks
  // ============================================================
  const drumTarget = Math.round(count * 0.24);
  let drums = 0, drumPallets = 0;
  const DP = 0.66; // drum pitch
  outer:
  for (let x = FARM.x0 + 1; x <= FARM.x1 - 1; x += DP) {
    for (let z = zMin + 4; z <= zMax - 4; z += DP) {
      // cross-aisles every block of 16 drums (in Z) and 20 (in X)
      if ((Math.round((z - zMin) / DP) % 18) > 15) continue;
      if ((Math.round((x - FARM.x0) / DP) % 22) > 19) continue;
      const stack = rng() < 0.72 ? 2 : 1;
      for (let h = 0; h < stack && drums < drumTarget; h++) {
        place('drum', x, 0.45 + h * 0.9, z, 1, 1, 1, rng() * 6.28); drums++;
        place('drumLid', x, 0.88 + h * 0.9, z, 1, 1, 1, 0);
      }
      if (((Math.round((x - FARM.x0) / DP) % 4) === 0) && ((Math.round((z - zMin) / DP) % 4) === 0)) { place('drumPallet', x + DP, 0.06, z + DP, 2, 1, 2, 0); drumPallets++; }
      if (drums >= drumTarget) break outer;
    }
  }
  // a row of large pressure tanks at the farm edge (variety / scale landmark)
  let tanks = 0;
  for (let z = zMin + 8; z <= zMax - 8; z += 11) {
    const tank = createPressureTank(); tank.scale.setScalar(3.4);
    tank.position.set(FARM.x1 + 2, 3.4, z); tank.userData.forgeBody = true;
    tank.traverse((c) => { if (c.isMesh) { c.userData.forgeBody = true; totalComponents++; drawCalls++; } });
    scene.add(tank); tanks++; uniqueMachines++;
  }

  // ── staging: loose pallets near the central aisle ──
  const palletTarget = Math.round(count * 0.03);
  let pallets = 0;
  for (let blk = 0; pallets < palletTarget && blk < 400; blk++) {
    const bx = -6 + (rng() - 0.0) * 6 - 3, bz = zMin + 6 + rng() * (zMax - zMin - 12);
    for (let s = 0; s < 5 && pallets < palletTarget; s++) { place('pallet', bx, 0.07 + s * 0.16, bz, 1, 1, 1, (rng() - 0.5) * 0.1); pallets++; }
  }

  // ── finalize: build one InstancedMesh per accumulated key ──
  const scratch = new THREE.Matrix4();
  const counts = {};
  for (const k of Object.keys(acc)) {
    const arr = acc[k]; const n = arr.length / 16; if (!n) continue;
    const [geo, mat] = REG[k];
    const inst = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) { scratch.fromArray(arr, i * 16); inst.setMatrixAt(i, scratch); }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.userData.forgeBody = true; inst.userData.componentType = k;
    scene.add(inst); drawCalls++; totalComponents += n; counts[k] = n;
  }

  const stats = {
    machines: uniqueMachines, tanks, components: totalComponents, drawCalls,
    bolts: totalBolts, fasteners, studs, drums, crates, rollers: totalRollers,
    rackUprights, rackBeams, pallets, drumPallets, totes,
    instanced: counts, footprint: [FLOOR_X, FLOOR_Z], seed,
  };

  if (typeof window !== 'undefined') {
    window.__forgeScene = scene;
    window.__forgeBuildEnvironment = forgeBuildEnvironment;
    window.__forgeEnvironmentStats = stats;
  }
  return { scene, meshes: scene.children, stats };
}

// Public API
export function installForgeEnvironmentBuilder() {
  if (typeof window === 'undefined') return;
  window.__forgeBuildEnvironment = forgeBuildEnvironment;
}

export const FORGE_MACHINE_TYPES = [
  'V8_ENGINE',
  'GEARBOX',
  'PUMP',
  'TANK',
  'CNC_MILL',
  'CONVEYOR',
  'PIPE_RACK',
  'OIL_DRUM',
  'PALLET',
  'CRATE',
  'I_BEAM',
  'CONTROL_CAB',
  'MOTOR',
];
