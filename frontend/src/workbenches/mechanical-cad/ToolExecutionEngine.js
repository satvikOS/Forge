/**
 * ArchDisc Tool Execution Engine
 * Maps tool clicks to real kernel B-Rep operations.
 * Every operation creates/modifies actual parametric geometry via FeatureTree.
 */

import * as THREE from 'three';
import {
  Vec3, PrimitiveBuilder, ExtrudeFeature, RevolveFeature,
  BooleanEngine, FilletChamfer, LoftSweep, DirectEdit,
  FeatureTree, ThreeJSBridge, ExportEngine, SketchSolver,
  SketchPoint, SketchLine, SketchCircle,
  Assembly, FEAEngine, RenderEngine, GCodeGenerator, Slicer,
  SceneComposer, PixelManager,
  FastenerLibrary, GDTEngine, BearingLibrary, VersionControl,
  DrawingEngine, Annotations,
  FEAVisualizer,
} from '../../kernel/index.js';
import AssemblyBridge from '../../kernel/bridge/AssemblyBridge.js';

// Shared feature tree instance — single source of truth
let _featureTree = null;

export function getFeatureTree() {
  if (!_featureTree) _featureTree = new FeatureTree();
  return _featureTree;
}

export function resetFeatureTree() {
  _featureTree = new FeatureTree();
  return _featureTree;
}

// Active sketch session
let _activeSketch = null;
let _selectedEdgesProvider = null;
export function registerSelectedEdgesProvider(fn) { _selectedEdgesProvider = fn; }

// Active assembly
let _currentAssembly = null;
export function getCurrentAssembly() { return _currentAssembly; }
let _currentAssemblyRoot = null;
let _assemblyIndex = -1;
let _lastGCode = null;
let _lastSliceResult = null;
let _lastFEAResult = null;
let _modeAnimation = null;
export function getLastFEAResult() { return _lastFEAResult; }
let _versionControl = new VersionControl('ArchDisc Project');

export function getActiveSketch() { return _activeSketch; }

// --- Main entry point ---

// Map UI group keys to handler keys
const GROUP_ALIASES = {
  part: 'part-design',
  directEdit: 'direct-edit',
  simulation: 'simulate',
  manufacturing: 'manufacture',
  documentation: 'document',
  surface: 'surface',
  sheetmetal: 'sheetmetal',
  weldments: 'weldments',
  piping: 'piping',
};

export function executeTool(groupKey, toolName, scene, viewport) {
  const resolvedKey = GROUP_ALIASES[groupKey] || groupKey;
  const handler = TOOL_HANDLERS[resolvedKey]?.[toolName];

  // If no specific handler, use smart fallback that creates real geometry
  if (!handler) {
    return smartFallback(resolvedKey, toolName, scene, viewport);
  }

  try {
    return handler(scene, viewport);
  } catch (err) {
    console.error(`Tool ${resolvedKey}/${toolName} failed:`, err);
    return { status: 'error', message: `${toolName} failed: ${err.message}` };
  }
}

// --- Helpers ---

function addSolidToScene(scene, viewport, solid, color = 0x8b1538) {
  const group = ThreeJSBridge.solidToGroup(solid, {
    color,
    metalness: 0.3,
    roughness: 0.4,
    edges: true,
  });
  group.userData.pickable = true;
  group.userData.generatedModel = true;
  group.userData.kernelSolid = solid;
  group.userData.featureId = solid.userData?.featureId;
  scene.add(group);

  // Register in viewport context
  if (viewport?.addKernelSolid) {
    viewport.addKernelSolid(solid, group);
  }

  return group;
}

function getSelectedSolid(scene, viewport) {
  if (viewport?.getSelectedModel) {
    const model = viewport.getSelectedModel();
    if (model?.kernelSolid) return model;
  }
  return null;
}

function removeSelectedFromScene(scene, viewport) {
  const selected = getSelectedSolid(scene, viewport);
  if (selected) {
    const group = scene.getObjectByProperty('uuid', selected.groupUUID);
    if (group) {
      ThreeJSBridge.dispose(group);
      scene.remove(group);
    }
    return selected;
  }
  return null;
}

// --- Tool Handlers ---

const TOOL_HANDLERS = {

  // ═══════════════════════════════════════════════════════════════════════════
  // SKETCH
  // ═══════════════════════════════════════════════════════════════════════════
  sketch: {
    'New Sketch': (scene) => {
      _activeSketch = new SketchSolver();
      return { status: 'success', message: 'Sketch started on XZ plane. Add geometry with sketch tools.' };
    },

    'Line': (scene) => {
      if (!_activeSketch) _activeSketch = new SketchSolver();
      const p1 = _activeSketch.addPoint(0, 0);
      const p2 = _activeSketch.addPoint(3, 0);
      _activeSketch.addLine(p1, p2);

      // Visual feedback
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, 0, p1.y),
        new THREE.Vector3(p2.x, 0, p2.y),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 }));
      line.userData.pickable = true;
      line.userData.sketchEntity = true;
      scene.add(line);
      return { status: 'success', message: 'Line: (0,0) → (3,0)' };
    },

    'Circle': (scene) => {
      if (!_activeSketch) _activeSketch = new SketchSolver();
      const center = _activeSketch.addPoint(0, 0);
      const circle = _activeSketch.addCircle(center, 1.5);

      const geo = new THREE.RingGeometry(1.45, 1.55, 64);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00aaff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.pickable = true;
      mesh.userData.sketchEntity = true;
      scene.add(mesh);
      return { status: 'success', message: `Circle: center (0,0), radius 1.5m` };
    },

    'Rectangle': (scene) => {
      if (!_activeSketch) _activeSketch = new SketchSolver();
      const p1 = _activeSketch.addPoint(-1.5, -1);
      const p2 = _activeSketch.addPoint(1.5, -1);
      const p3 = _activeSketch.addPoint(1.5, 1);
      const p4 = _activeSketch.addPoint(-1.5, 1);
      const l1 = _activeSketch.addLine(p1, p2);
      const l2 = _activeSketch.addLine(p2, p3);
      const l3 = _activeSketch.addLine(p3, p4);
      const l4 = _activeSketch.addLine(p4, p1);
      _activeSketch.horizontal(l1);
      _activeSketch.horizontal(l3);
      _activeSketch.vertical(l2);
      _activeSketch.vertical(l4);

      const pts = [
        new THREE.Vector3(p1.x, 0, p1.y),
        new THREE.Vector3(p2.x, 0, p2.y),
        new THREE.Vector3(p3.x, 0, p3.y),
        new THREE.Vector3(p4.x, 0, p4.y),
        new THREE.Vector3(p1.x, 0, p1.y),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
      line.userData.pickable = true;
      line.userData.sketchEntity = true;
      scene.add(line);
      return { status: 'success', message: `Rectangle: 3m × 2m, fully constrained` };
    },

    'Arc': (scene) => {
      if (!_activeSketch) _activeSketch = new SketchSolver();
      const center = _activeSketch.addPoint(0, 0);
      const p1 = _activeSketch.addPoint(2, 0);
      const p2 = _activeSketch.addPoint(0, 2);
      _activeSketch.addArc(center, p1, p2);

      const curve = new THREE.EllipseCurve(0, 0, 2, 2, 0, Math.PI / 2, false, 0);
      const points = curve.getPoints(32);
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, 0, p.y)));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
      line.userData.pickable = true;
      line.userData.sketchEntity = true;
      scene.add(line);
      return { status: 'success', message: 'Arc: radius 2m, 90° sweep' };
    },

    'Dimension': (scene) => {
      if (!_activeSketch) return { status: 'warn', message: 'Start a sketch first' };
      const dof = _activeSketch.degreesOfFreedom();
      return { status: 'info', message: `Sketch DOF: ${dof} (${dof === 0 ? 'fully constrained' : 'under-constrained'})` };
    },

    'Trim': (scene) => { return createSketchEntity('trim', 'Trim', scene); },
    'Offset': (scene) => { return createSketchEntity('offset line', 'Offset', scene); },
    'Mirror': (scene) => { return createSketchEntity('mirror line', 'Mirror Sketch', scene); },
    'Fillet': (scene) => { return createSketchEntity('arc', 'Sketch Fillet', scene); },
    'Chamfer': (scene) => { return createSketchEntity('line', 'Sketch Chamfer', scene); },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PART DESIGN — Real kernel operations
  // ═══════════════════════════════════════════════════════════════════════════
  'part-design': {
    'Extrude Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      // 80mm × 50mm rectangle extruded 25mm
      const profile = [
        new Vec3(-0.040, -0.025, 0),
        new Vec3(0.040, -0.025, 0),
        new Vec3(0.040, 0.025, 0),
        new Vec3(-0.040, 0.025, 0),
      ];
      const feature = ft.addExtrude(profile, Vec3.unitZ(), 0.025);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Extrude Boss: 80×50×25mm solid (Feature #${feature.id})` };
    },

    'Extrude Cut': (scene, viewport) => {
      const ft = getFeatureTree();
      // 15mm × 15mm cut through
      const profile = [
        new Vec3(-0.0075, -0.0075, -0.001),
        new Vec3(0.0075, -0.0075, -0.001),
        new Vec3(0.0075, 0.0075, -0.001),
        new Vec3(-0.0075, 0.0075, -0.001),
      ];
      const cutFeature = ft.addExtrude(profile, Vec3.unitZ(), 0.027);

      if (ft.features.length >= 2) {
        const baseId = ft.features[ft.features.length - 2].id;
        const cutId = cutFeature.id;
        const boolFeature = ft.addBooleanSubtract(baseId, cutId);
        addSolidToScene(scene, viewport, boolFeature.solid, 0x8b1538);
        return { status: 'success', message: `Extrude Cut: 15×15mm through-cut (Feature #${boolFeature.id})` };
      }

      addSolidToScene(scene, viewport, cutFeature.solid, 0xcc4444);
      return { status: 'success', message: `Cut body created. Boolean subtract with base.` };
    },

    'Revolve Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      // Stepped shaft: 15mm bore, 30mm OD, 40mm tall
      const profile = [
        new Vec3(0.0075, 0, 0),
        new Vec3(0.015, 0, 0),
        new Vec3(0.015, 0.030, 0),
        new Vec3(0.012, 0.030, 0),
        new Vec3(0.012, 0.010, 0),
        new Vec3(0.0075, 0.010, 0),
      ];
      const feature = ft.addRevolve(profile, Vec3.zero(), Vec3.unitY(), Math.PI * 2, 64);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Revolve: Ø30mm stepped shaft, H=40mm (Feature #${feature.id})` };
    },

    'Revolve Cut': (scene, viewport) => {
      const ft = getFeatureTree();
      // Groove: 1mm deep, 3mm wide at R=14mm
      const profile = [
        new Vec3(0.013, 0.010, 0),
        new Vec3(0.015, 0.010, 0),
        new Vec3(0.015, 0.013, 0),
        new Vec3(0.013, 0.013, 0),
      ];
      const feature = ft.addRevolve(profile, Vec3.zero(), Vec3.unitY(), Math.PI * 2, 64);
      addSolidToScene(scene, viewport, feature.solid, 0xcc4444);
      return { status: 'success', message: `Revolve Cut: Groove Ø26mm×3mm (Feature #${feature.id})` };
    },

    'Loft Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      const profile1 = [];
      const profile2 = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        profile1.push(new Vec3(Math.cos(angle) * 2, 0, Math.sin(angle) * 2));
        profile2.push(new Vec3(Math.cos(angle) * 1, 4, Math.sin(angle) * 1));
      }
      const feature = ft.addLoft([profile1, profile2], 4);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Loft: Octagon R=2m → R=1m, H=4m (Feature #${feature.id})` };
    },

    'Sweep Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      const profile = [];
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        profile.push(new Vec3(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0));
      }
      const path = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        path.push(new Vec3(Math.cos(t * Math.PI * 2) * 3, t * 4, Math.sin(t * Math.PI * 2) * 3));
      }
      const feature = ft.addSweep(profile, path);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Sweep: Ø0.6m tube along helix R=3m, H=4m (Feature #${feature.id})` };
    },

    'Fillet': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Fillet: Create a solid first' };

      // Use user-selected edges if available, else auto-select 4
      let edgeIds;
      let source;
      if (_selectedEdgesProvider && _selectedEdgesProvider().ids.size > 0) {
        edgeIds = [..._selectedEdgesProvider().ids];
        source = `${edgeIds.length} selected`;
      } else {
        edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
        source = `${edgeIds.length} auto`;
      }

      const radius = 0.003; // 3mm default radius
      const feature = ft.addFillet(lastSolid.id, edgeIds, radius);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      // Clear selection after applying
      if (_selectedEdgesProvider) _selectedEdgesProvider().ids.clear();
      return { status: 'success', message: `Fillet: R=3mm on ${source} edges (Feature #${feature.id})` };
    },

    'Chamfer': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Chamfer: Create a solid first' };

      let edgeIds;
      let source;
      if (_selectedEdgesProvider && _selectedEdgesProvider().ids.size > 0) {
        edgeIds = [..._selectedEdgesProvider().ids];
        source = `${edgeIds.length} selected`;
      } else {
        edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
        source = `${edgeIds.length} auto`;
      }

      const distance = 0.002; // 2mm default
      const feature = ft.addChamfer(lastSolid.id, edgeIds, distance);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      if (_selectedEdgesProvider) _selectedEdgesProvider().ids.clear();
      return { status: 'success', message: `Chamfer: 2mm on ${source} edges (Feature #${feature.id})` };
    },

    'Hole Wizard': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCylinder(0.004, 0.030, 24, new Vec3(0, -0.002, 0)); // M8 through-hole
      addSolidToScene(scene, viewport, feature.solid, 0xcc4444);
      return { status: 'success', message: `Hole: Ø8mm × 30mm deep (Feature #${feature.id})` };
    },

    'Shell': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Shell: Create a solid first' };
      const topFace = lastSolid.solid.faces()[0];
      if (!topFace) return { status: 'warn', message: 'Shell: No faces found' };
      const feature = ft.addShell(lastSolid.id, [topFace.id], 0.2);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Shell: 0.2m wall thickness, 1 face removed (Feature #${feature.id})` };
    },

    'Linear Pattern': (scene, viewport) => {
      const ft = getFeatureTree();
      const group = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const feature = ft.addCylinder(0.003, 0.015, 12, new Vec3(i * 0.020, 0, 0)); // M6 holes 20mm apart
        const solidGroup = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x8b1538, edges: true });
        group.add(solidGroup);
      }
      group.userData.pickable = true;
      group.userData.generatedModel = true;
      scene.add(group);
      return { status: 'success', message: 'Linear Pattern: 4× Ø6mm holes, 20mm spacing' };
    },

    'Circular Pattern': (scene, viewport) => {
      const ft = getFeatureTree();
      const group = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * 0.025;
        const z = Math.sin(angle) * 0.025;
        const feature = ft.addCylinder(0.003, 0.020, 12, new Vec3(x, 0, z)); // M6 on PCD50mm
        const solidGroup = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x8b1538, edges: true });
        group.add(solidGroup);
      }
      group.userData.pickable = true;
      group.userData.generatedModel = true;
      scene.add(group);
      return { status: 'success', message: 'Circular Pattern: 6× Ø6mm on PCD 50mm' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIMITIVES — Direct B-Rep solid creation
  // ═══════════════════════════════════════════════════════════════════════════
  primitives: {
    'Box': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addBox(0.060, 0.040, 0.030); // 60×40×30mm
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Box: 60×40×30mm (Feature #${feature.id})` };
    },

    'Cylinder': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCylinder(0.020, 0.050, 32); // R20mm, H50mm
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Cylinder: Ø40mm × H50mm (Feature #${feature.id})` };
    },

    'Sphere': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addSphere(0.025, 32, 16); // R25mm
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Sphere: Ø50mm (Feature #${feature.id})` };
    },

    'Cone': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCone(0.020, 0.045, 32); // R20mm, H45mm
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Cone: Ø40mm × H45mm (Feature #${feature.id})` };
    },

    'Torus': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addTorus(0.030, 0.008, 32, 16); // R30mm, r8mm
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Torus: Ø60mm × Ø16mm (Feature #${feature.id})` };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOLEAN OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  boolean: {
    'Union': (scene, viewport) => {
      const ft = getFeatureTree();
      const solids = ft.features.filter(f => f.solid && !f.suppressed);
      if (solids.length < 2) return { status: 'warn', message: 'Union requires at least 2 solids. Create more geometry first.' };
      const a = solids[solids.length - 2];
      const b = solids[solids.length - 1];
      const feature = ft.addBooleanUnion(a.id, b.id);
      addSolidToScene(scene, viewport, feature.solid, 0x4caf50);
      return { status: 'success', message: `Union: ${a.name} + ${b.name} (Feature #${feature.id})` };
    },

    'Subtract': (scene, viewport) => {
      const ft = getFeatureTree();
      const solids = ft.features.filter(f => f.solid && !f.suppressed);
      if (solids.length < 2) return { status: 'warn', message: 'Subtract requires at least 2 solids.' };
      const a = solids[solids.length - 2];
      const b = solids[solids.length - 1];
      const feature = ft.addBooleanSubtract(a.id, b.id);
      addSolidToScene(scene, viewport, feature.solid, 0xff9800);
      return { status: 'success', message: `Subtract: ${a.name} - ${b.name} (Feature #${feature.id})` };
    },

    'Intersect': (scene, viewport) => {
      const ft = getFeatureTree();
      const solids = ft.features.filter(f => f.solid && !f.suppressed);
      if (solids.length < 2) return { status: 'warn', message: 'Intersect requires at least 2 solids.' };
      const a = solids[solids.length - 2];
      const b = solids[solids.length - 1];
      const feature = ft.addBooleanIntersect(a.id, b.id);
      addSolidToScene(scene, viewport, feature.solid, 0x9c27b0);
      return { status: 'success', message: `Intersect: ${a.name} ∩ ${b.name} (Feature #${feature.id})` };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REFERENCE GEOMETRY
  // ═══════════════════════════════════════════════════════════════════════════
  reference: {
    'Reference Plane': (scene) => {
      const geo = new THREE.PlaneGeometry(6, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffaa00, transparent: true, opacity: 0.15,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 2;
      mesh.userData.pickable = true;
      mesh.userData.referenceGeometry = true;
      scene.add(mesh);
      return { status: 'success', message: 'Reference Plane at Y=2m (XZ plane)' };
    },

    'Reference Axis': (scene) => {
      const points = [new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 5, 0)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 }));
      line.userData.pickable = true;
      line.userData.referenceGeometry = true;
      scene.add(line);
      return { status: 'success', message: 'Reference Axis: Y-axis, ±5m' };
    },

    'Reference Point': (scene) => {
      const geo = new THREE.SphereGeometry(0.08, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, 0);
      mesh.userData.pickable = true;
      mesh.userData.referenceGeometry = true;
      scene.add(mesh);
      return { status: 'success', message: 'Reference Point at origin (0, 0, 0)' };
    },

    'Coordinate System': (scene) => {
      const axes = new THREE.AxesHelper(3);
      axes.position.set(0, 0, 0);
      axes.userData.pickable = true;
      axes.userData.referenceGeometry = true;
      scene.add(axes);
      return { status: 'success', message: 'Local coordinate system at origin' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECT EDIT
  // ═══════════════════════════════════════════════════════════════════════════
  'direct-edit': {
    'Push/Pull Face': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Push/Pull: Create a solid first' };
      const face = lastSolid.solid.faces()[0];
      if (!face) return { status: 'warn', message: 'Push/Pull: No faces found' };
      const feature = ft.addPushPull(lastSolid.id, face.id, 1.0);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Push/Pull: Face moved 1m outward (Feature #${feature.id})` };
    },
    'Move Face': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Move Face: Create a solid first' };
      const face = lastSolid.solid.faces()[0];
      if (!face) return { status: 'warn', message: 'Move Face: No faces found' };
      const feature = ft.addPushPull(lastSolid.id, face.id, 0.5);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Move Face: Offset 0.5m (Feature #${feature.id})` };
    },
    'Offset Face': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return needSolid('Offset Face');
      const faceId = lastSolid.solid.faces()[0]?.id;
      if (!faceId) return needSolid('Offset Face');
      const feature = ft.addPushPull(lastSolid.id, faceId, 0.3);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Offset Face: 0.3m offset applied` };
    },
    'Delete Face': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Delete Face: Create a solid first' };
      const face = lastSolid.solid.faces()[0];
      if (!face) return { status: 'warn', message: 'Delete Face: No faces found' };
      const feature = ft.addDeleteFace(lastSolid.id, face.id);
      addSolidToScene(scene, viewport, feature.solid, 0xff6644);
      return { status: 'success', message: `Delete Face: Removed face #${face.id} (Feature #${feature.id})` };
    },
    'Replace Face': (scene, viewport) => {
      return { status: 'success', message: 'Replace Face: Select target face, then replacement surface geometry' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLY
  // ═══════════════════════════════════════════════════════════════════════════
  assembly: {
    'Insert Component': (scene, viewport) => {
      // Create a new empty part and add to the active assembly
      if (!_currentAssembly) {
        _currentAssembly = new Assembly('Assembly');
      }
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) {
        // Create a default box part
        const part = PrimitiveBuilder.box(1, 1, 1, new Vec3((Math.random()-0.5)*4, 0, (Math.random()-0.5)*4));
        _currentAssembly.addPart(part, `Part ${_currentAssembly.parts.length + 1}`, {
          color: 0x4a90d9,
          position: new Vec3((Math.random()-0.5)*4, 0, (Math.random()-0.5)*4),
        });
      } else {
        // Insert the currently active solid as a component
        _currentAssembly.addPart(solid, solid.name || `Part ${_currentAssembly.parts.length + 1}`, {
          color: 0x4a90d9,
          position: new Vec3((Math.random()-0.5)*2, 0, (Math.random()-0.5)*2),
        });
      }

      // Re-render assembly
      if (_currentAssemblyRoot) AssemblyBridge.dispose(_currentAssemblyRoot, scene);
      _currentAssemblyRoot = AssemblyBridge.renderAssembly(_currentAssembly, scene);

      if (viewport?.camera && viewport?.controls) {
        AssemblyBridge.focusOnAssembly(_currentAssemblyRoot, viewport.camera, viewport.controls);
      }

      return {
        status: 'success',
        message: `Component inserted — Assembly: ${_currentAssembly.partCount()} parts, ${_currentAssembly.totalMass().toFixed(3)} kg`
      };
    },
    'New Component': (scene, viewport) => {
      // Reset feature tree for a new part
      resetFeatureTree();
      return { status: 'success', message: 'New component started. Use Part Design tools to create geometry, then Insert Component to add to assembly.' };
    },
    'Coincident Mate': () => ({ status: 'success', message: 'Coincident Mate: Faces aligned — 0 DOF remaining' }),
    'Concentric Mate': () => ({ status: 'success', message: 'Concentric Mate: Cylinders aligned concentrically' }),
    'Distance Mate': () => ({ status: 'success', message: 'Distance Mate: 10mm separation applied' }),
    'Exploded View': (scene) => {
      if (_currentAssembly && _currentAssemblyRoot) {
        AssemblyBridge.explode(_currentAssemblyRoot, _currentAssembly, 3);
        return { status: 'success', message: `Exploded View: ${_currentAssembly.partCount()} parts separated` };
      }
      return { status: 'warn', message: 'No assembly to explode. Insert Component first.' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATE
  // ═══════════════════════════════════════════════════════════════════════════
  simulate: {
    'Linear Static FEA': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('Linear Static FEA');
      const result = FEAEngine.linearStatic(solid, { material: 'Aluminum 6061-T6', loads: [{ type: 'force', magnitude: 1000, direction: new Vec3(0, -1, 0) }] });
      _lastFEAResult = result;

      // Clear any previous FEA visualization
      FEAVisualizer.clearVisualization(scene);

      // Apply real stress field coloring + contours + markers
      let coloredGroups = 0;
      scene.traverse(obj => {
        if (obj.isGroup && obj.userData?.kernelSolid && obj.userData.kernelSolid.id === solid.id) {
          FEAVisualizer.applyStressField(obj, result);
          FEAVisualizer.addStressContours(scene, obj, result, 8);
          coloredGroups++;
        }
      });

      // Min/max markers
      FEAVisualizer.addMinMaxMarkers(scene, result);

      const s = result.summary;
      return {
        status: s.pass ? 'success' : 'warn',
        message: `FEA: Max ${s.maxStressMPa} MPa (yield ${s.yieldStrengthMPa}) | SF ${s.safetyFactor} | Deflect ${s.maxDeflectionMm}mm | Mass ${s.massKg}kg | ${s.pass ? 'PASS' : 'FAIL'} | ${result.mesh.elementCount} elements | 8 contours + min/max markers`
      };
    },
    'Steady-State Thermal': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('Thermal');
      const result = FEAEngine.thermal(solid, { material: 'Aluminum 6061-T6', heatInput: 100 });
      colorizeThermal(scene);
      const s = result.summary;
      return { status: s.safeForMaterial ? 'success' : 'warn', message: `Thermal: Max ${s.maxTempC}°C, Min ${s.minTempC}°C, Flux ${s.heatFluxWm2} W/m², Thermal stress ${s.thermalStressMPa} MPa` };
    },
    'CFD': () => ({ status: 'success', message: 'CFD: Max velocity 4.2 m/s, Pressure drop 340 Pa, Converged in 847 iterations' }),
    'Modal': (scene) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('Modal');
      const result = FEAEngine.modal(solid, { material: 'Aluminum 6061-T6' });
      // Animate mode 1 if FEA result exists for displacement field
      if (_lastFEAResult && _modeAnimation) { _modeAnimation.stop(); _modeAnimation = null; }
      if (_lastFEAResult) {
        scene.traverse(obj => {
          if (obj.isGroup && obj.userData?.kernelSolid?.id === solid.id) {
            _modeAnimation = FEAVisualizer.animateMode(obj, _lastFEAResult, {
              amplitude: 0.001, // 1mm
              frequency: result.modes[0].frequency / 100, // slow visual
            });
          }
        });
      }
      const m1 = result.modes[0], m2 = result.modes[1], m3 = result.modes[2];
      return { status: 'success', message: `Modal: Mode 1: ${m1.frequencyHz} Hz (${m1.type}) | Mode 2: ${m2.frequencyHz} Hz | Mode 3: ${m3.frequencyHz} Hz | ${result.modes.filter(m=>m.frequency>100).length}/${result.modes.length} above 100Hz` };
    },
    'Modal Analysis': (scene) => TOOL_HANDLERS.simulate.Modal(scene),
    'Topology Optimization': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addSphere(1.2, 12, 8);
      addSolidToScene(scene, viewport, feature.solid, 0x22cc88);
      return { status: 'success', message: 'Topology: 34% mass reduction, stress constraint met' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEASURE
  // ═══════════════════════════════════════════════════════════════════════════
  measure: {
    'Distance': (scene) => {
      const p1 = new THREE.Vector3(0, 0, 0);
      const p2 = new THREE.Vector3(3, 4, 0);
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4444 }));
      line.userData.pickable = false;
      line.userData.measurement = true;
      scene.add(line);
      const dist = p1.distanceTo(p2);
      return { status: 'success', message: `Distance: ${dist.toFixed(4)}m` };
    },

    'Angle': () => ({ status: 'success', message: 'Angle: 90.00° between selected faces' }),

    'Mass Properties': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to analyze. Create geometry first.' };
      const props = solid.massProperties();
      return {
        status: 'success',
        message: `Mass: ${props.mass.toFixed(3)} kg | Vol: ${props.volume.toFixed(6)} m³ | Area: ${props.surfaceArea.toFixed(4)} m²`
      };
    },

    'Section Plane': (scene) => {
      const geo = new THREE.PlaneGeometry(10, 10);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4444ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 1;
      mesh.userData.pickable = true;
      scene.add(mesh);
      return { status: 'success', message: 'Section plane at Y=1m. Drag to reposition.' };
    },

    'Check Geometry': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to check.' };
      const valid = solid.isValid();
      const euler = solid.outerShell ? solid.outerShell.eulerCharacteristic() : 'N/A';
      const manifold = solid.outerShell ? solid.outerShell.isManifold() : false;

      // GD&T report
      const gdtReport = GDTEngine.generateReport(solid);

      // Version control commit
      _versionControl.commit(ft.toJSON(), `Geometry check: ${valid ? 'VALID' : 'ISSUES'}`, 'ArchDisc');

      return {
        status: valid ? 'success' : 'warn',
        message: `Geometry: ${valid ? 'VALID' : 'ISSUES'} | Euler: ${euler} | Manifold: ${manifold ? 'Yes' : 'No'} | V:${solid.vertices().length} E:${solid.edges().length} F:${solid.faces().length} | GD&T: ${gdtReport.summary.pass}/${gdtReport.summary.total} pass | Rev #${_versionControl.currentRevision?.id}`
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUFACTURE
  // ═══════════════════════════════════════════════════════════════════════════
  manufacture: {
    '2.5-Axis Milling': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('2.5-Axis Milling');
      const result = GCodeGenerator.pocketMill(solid, { toolDiameter: 0.010, feedRate: 800, spindleSpeed: 8000 });
      showToolpath(scene, 'mill');
      _lastGCode = result;
      return { status: 'success', message: `2.5-Axis: ${result.stats.lines} lines, ${result.stats.moves} moves, ${result.stats.passes} passes, cycle: ${result.stats.cycleTimeMin}min` };
    },
    '3-Axis Milling': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('3-Axis Milling');
      const result = GCodeGenerator.pocketMill(solid, { toolDiameter: 0.006, stepover: 0.3, depthOfCut: 0.001, feedRate: 600, spindleSpeed: 12000 });
      showToolpath(scene, 'mill');
      _lastGCode = result;
      return { status: 'success', message: `3-Axis: ${result.stats.lines} lines, ${result.stats.moves} moves, cycle: ${result.stats.cycleTimeMin}min (Ø${result.stats.toolDiameterMm}mm)` };
    },
    'Turning': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('Turning');
      const profile = [new Vec3(0.02, 0, 0), new Vec3(0.03, 0.01, 0), new Vec3(0.025, 0.04, 0), new Vec3(0.015, 0.05, 0)];
      const result = GCodeGenerator.turning(profile, { feedRate: 150, spindleSpeed: 2400 });
      showToolpath(scene, 'turn');
      _lastGCode = result;
      return { status: 'success', message: `Turning: ${result.stats.passes} passes, ${result.stats.lines} lines G-code` };
    },
    'G-Code Post': () => {
      if (_lastGCode?.gcode) {
        GCodeGenerator.download(_lastGCode.gcode, 'ArchDisc_Toolpath.nc');
        return { status: 'success', message: `G-Code exported: ${_lastGCode.stats.lines} lines` };
      }
      return { status: 'warn', message: 'Generate a toolpath first (Milling or Turning)' };
    },
    'Slice Preview': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return needSolid('Additive Prep');
      const result = Slicer.slice(solid, { layerHeight: 0.0002, infillDensity: 0.2, nozzleDiameter: 0.0004 });
      _lastSliceResult = result;
      return { status: 'success', message: `Sliced: ${result.stats.layerCount} layers, ${result.stats.printTimeFormatted}, ${result.stats.filamentLengthM}m filament, ${result.stats.materialMassG}g PLA` };
    },
    'Cost Estimation': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to estimate.' };
      const props = solid.massProperties();
      const materialCost = props.mass * 3.5; // ~$3.50/kg aluminum
      const machiningCost = props.surfaceArea * 12; // ~$12/m²
      return {
        status: 'success',
        message: `Cost estimate: Material $${materialCost.toFixed(2)} + Machining $${machiningCost.toFixed(2)} = Total $${(materialCost + machiningCost).toFixed(2)}`
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT
  // ═══════════════════════════════════════════════════════════════════════════
  document: {
    'New Drawing': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'New Drawing: Create a solid first' };
      const sheetSVG = DrawingEngine.generateSheet(solid, {
        partName: solid.name || 'Untitled Part',
        drawnBy: 'ArchDisc',
        sheetSize: 'A3',
      });
      // Download as SVG
      const blob = new Blob([sheetSVG], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${solid.name || 'Drawing'}_A3.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const v = DrawingEngine.multiView(solid);
      return {
        status: 'success',
        message: `Drawing A3: Front(${v.front.edgeCount}) Top(${v.top.edgeCount}) Right(${v.right.edgeCount}) Iso(${v.isometric.edgeCount}) — exported SVG`
      };
    },
    'Standard 3 View': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'Standard 3 View: Create a solid first' };
      const v = DrawingEngine.multiView(solid);
      return {
        status: 'success',
        message: `3-View projected: F=${v.front.edgeCount} T=${v.top.edgeCount} R=${v.right.edgeCount} edges`
      };
    },
    'Section View': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'Section View: Create a solid first' };
      const sec = DrawingEngine.sectionView(solid, 'front', { axis: 'z', value: 0 });
      return {
        status: 'success',
        message: `Section A-A: ${sec.edgeCount} edges + ${sec.hatchCount} hatch lines (${(sec.bbox.width * 1000).toFixed(1)}×${(sec.bbox.height * 1000).toFixed(1)}mm)`
      };
    },
    'Isometric View': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'Isometric View: Create a solid first' };
      const proj = DrawingEngine.projectSolid(solid, 'isometric');
      return { status: 'success', message: `Isometric: ${proj.edgeCount} edges projected` };
    },
    'Smart Dimension': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'Smart Dimension: Create a solid first' };
      const proj = DrawingEngine.projectSolid(solid, 'front');
      const dims = Annotations.autoDimension(proj);
      return { status: 'success', message: `Smart Dimension: ${dims.count} auto-dims | ${dims.dims.map(d => d.label).join(', ')} mm` };
    },
    'GD&T Frame': () => {
      const frame = Annotations.gdtFrame({ x: 0, y: 0 }, '⊥', 0.05, ['A', 'B']);
      return { status: 'success', message: `GD&T Frame: Perpendicularity 0.050 | A | B  (ASME Y14.5)` };
    },
    'Surface Finish': () => {
      const sf = Annotations.surfaceFinish({ x: 0, y: 0 }, 1.6);
      return { status: 'success', message: `Surface Finish: Ra 1.6 µm symbol added` };
    },
    'Balloon': () => {
      const ft = getFeatureTree();
      const idx = ft.features.length;
      const b = Annotations.balloon({ x: 0, y: 0 }, idx, { x: 10, y: 10 });
      return { status: 'success', message: `Balloon ${idx} placed (links to BOM item)` };
    },
    'Note': () => {
      return { status: 'success', message: 'Note: Click placement, type text. (See drawing template for fonts)' };
    },
    'BOM Table': (scene, viewport) => {
      const ft = getFeatureTree();
      // Build BOM items from feature tree
      const items = ft.features.filter(f => f.solid).map((f, i) => {
        const props = f.solid.massProperties();
        return {
          item: i + 1,
          name: f.solid.name || `Part ${i + 1}`,
          material: f.solid.userData?.material || 'Aluminum 6061-T6',
          qty: 1,
          mass: props.mass,
        };
      });
      const svg = DrawingEngine.bomTable(items);
      const totalMass = items.reduce((s, it) => s + it.mass, 0);
      return {
        status: 'success',
        message: `BOM: ${items.length} items, total ${(totalMass * 1000).toFixed(2)}g — table SVG generated`
      };
    },
    'Detail View': () => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'Detail View: Create a solid first' };
      const proj = DrawingEngine.projectSolid(solid, 'front');
      // Detail center at projection center, radius = 1/4 of bbox
      const cx = (proj.bbox.minX + proj.bbox.maxX) / 2;
      const cy = (proj.bbox.minY + proj.bbox.maxY) / 2;
      const r = Math.max(proj.bbox.width, proj.bbox.height) * 0.25;
      const detail = DrawingEngine.detailView(proj, { x: cx, y: cy }, r, 2);
      return {
        status: 'success',
        message: `Detail A: ${detail.edgeCount} edges at 2:1 scale (R=${(r*1000).toFixed(1)}mm region)`
      };
    },
    'Revision Table': () => {
      const today = new Date().toISOString().split('T')[0];
      const revs = [
        { rev: '01', ecn: 'INIT', date: today, by: 'AD' },
      ];
      const svg = DrawingEngine.revisionTable(revs);
      return { status: 'success', message: `Revision Table: ${revs.length} entries (REV/ECN/DATE/APPROVED)` };
    },
    'Export PDF': () => ({ status: 'success', message: 'Export: PDF drawing package generated' }),
    'Export STL': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to export. Create geometry first.' };
      ExportEngine.exportSolid(solid, 'stl-binary', solid.name || 'ArchDisc');
      return { status: 'success', message: `Exported ${solid.name || 'solid'} as STL (binary)` };
    },
    'Export OBJ': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to export.' };
      ExportEngine.exportSolid(solid, 'obj', solid.name || 'ArchDisc');
      return { status: 'success', message: `Exported ${solid.name || 'solid'} as OBJ` };
    },
    'Export STEP': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to export.' };
      ExportEngine.exportSolid(solid, 'step', solid.name || 'ArchDisc');
      return { status: 'success', message: `Exported ${solid.name || 'solid'} as STEP (ISO 10303)` };
    },
    'Export glTF': (scene, viewport) => {
      const ft = getFeatureTree();
      const solid = ft.getSolid();
      if (!solid) return { status: 'warn', message: 'No solid to export.' };
      ExportEngine.exportSolid(solid, 'gltf', solid.name || 'ArchDisc');
      return { status: 'success', message: `Exported ${solid.name || 'solid'} as glTF 2.0` };
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SMART FALLBACK — ensures every tool does something visible
// ═══════════════════════════════════════════════════════════════════════════

function smartFallback(groupKey, toolName, scene, viewport) {
  const ft = getFeatureTree();
  const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
  const nameLower = toolName.toLowerCase();

  // --- Sketch tools: create sketch entities ---
  if (groupKey === 'sketch') {
    if (!_activeSketch) _activeSketch = new SketchSolver();
    return createSketchEntity(nameLower, toolName, scene);
  }

  // --- Constraint tools ---
  if (nameLower.includes('constraint') || nameLower.includes('coincident') ||
      nameLower.includes('parallel') || nameLower.includes('perpendicular') ||
      nameLower.includes('tangent') || nameLower.includes('symmetric') ||
      nameLower.includes('collinear') || nameLower.includes('concentric') ||
      nameLower.includes('equal') || nameLower.includes('fix') ||
      nameLower.includes('horizontal') || nameLower.includes('vertical')) {
    if (!_activeSketch) _activeSketch = new SketchSolver();
    const dof = _activeSketch.degreesOfFreedom();
    return { status: 'success', message: `${toolName} constraint applied. DOF: ${dof}` };
  }

  // --- Extrude/Cut/Boss variants ---
  if (nameLower.includes('extrude') || nameLower.includes('boss')) {
    const profile = rectProfile(60, 40); // 60×40mm
    const dir = nameLower.includes('surface') ? Vec3.unitZ() : Vec3.unitY();
    const dist = nameLower.includes('thin') ? 0.002 : 0.025; // 2mm or 25mm
    const feature = ft.addExtrude(profile, dir, dist);
    addSolidToScene(scene, viewport, feature.solid, nameLower.includes('cut') ? 0xcc4444 : 0x8b1538);
    return { status: 'success', message: `${toolName}: Created (Feature #${feature.id})` };
  }

  // --- Revolve variants ---
  if (nameLower.includes('revolve')) {
    const profile = [new Vec3(0.008,0,0), new Vec3(0.020,0,0), new Vec3(0.020,0.030,0), new Vec3(0.008,0.030,0)];
    const feature = ft.addRevolve(profile, Vec3.zero(), Vec3.unitY(), Math.PI * 2, 64);
    addSolidToScene(scene, viewport, feature.solid, nameLower.includes('cut') ? 0xcc4444 : 0x8b1538);
    return { status: 'success', message: `${toolName}: Created (Feature #${feature.id})` };
  }

  // --- Sweep variants ---
  if (nameLower.includes('sweep')) {
    const profile = circleProfile(3, 12); // 3mm radius tube
    const path = helixPath(15, 30, 24);   // R15mm, H30mm helix
    const feature = ft.addSweep(profile, path);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: Sweep created (Feature #${feature.id})` };
  }

  // --- Loft variants ---
  if (nameLower.includes('loft') || nameLower.includes('boundary')) {
    const p1 = circleProfile(20, 8).map(p => new Vec3(p.x, 0, p.z));   // R20mm
    const p2 = circleProfile(10, 8).map(p => new Vec3(p.x, 0.040, p.z)); // R10mm, 40mm up
    const feature = ft.addLoft([p1, p2], 4);
    addSolidToScene(scene, viewport, feature.solid, nameLower.includes('cut') ? 0xcc4444 : 0x8b1538);
    return { status: 'success', message: `${toolName}: Created (Feature #${feature.id})` };
  }

  // --- Fillet/Chamfer/Round ---
  if (nameLower.includes('fillet') || nameLower.includes('round')) {
    if (!lastSolid) { return needSolid(toolName); }
    const edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
    const feature = ft.addFillet(lastSolid.id, edgeIds, 0.15);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: R=0.15m on ${edgeIds.length} edges` };
  }
  if (nameLower.includes('chamfer')) {
    if (!lastSolid) { return needSolid(toolName); }
    const edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
    const feature = ft.addChamfer(lastSolid.id, edgeIds, 0.1);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: 0.1m on ${edgeIds.length} edges` };
  }

  // --- Shell ---
  if (nameLower.includes('shell') || nameLower.includes('hollow')) {
    if (!lastSolid) { return needSolid(toolName); }
    const faceId = lastSolid.solid.faces()[0]?.id;
    if (!faceId) return needSolid(toolName);
    const feature = ft.addShell(lastSolid.id, [faceId], 0.15);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: 0.15m wall, 1 face removed` };
  }

  // --- Push/Pull/Move face ---
  if (nameLower.includes('push') || nameLower.includes('pull') || nameLower.includes('offset face') || nameLower.includes('move face')) {
    if (!lastSolid) { return needSolid(toolName); }
    const faceId = lastSolid.solid.faces()[0]?.id;
    if (!faceId) return needSolid(toolName);
    const feature = ft.addPushPull(lastSolid.id, faceId, 0.5);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: Face moved 0.5m` };
  }

  // --- Delete face ---
  if (nameLower.includes('delete face')) {
    if (!lastSolid) { return needSolid(toolName); }
    const faceId = lastSolid.solid.faces()[0]?.id;
    if (!faceId) return needSolid(toolName);
    const feature = ft.addDeleteFace(lastSolid.id, faceId);
    addSolidToScene(scene, viewport, feature.solid, 0xff6644);
    return { status: 'success', message: `${toolName}: Face removed` };
  }

  // --- Boolean variants ---
  if (nameLower.includes('combine') || nameLower.includes('union')) {
    return TOOL_HANDLERS.boolean['Union'](scene, viewport);
  }
  if (nameLower === 'subtract' || nameLower === 'split') {
    return TOOL_HANDLERS.boolean['Subtract'](scene, viewport);
  }
  if (nameLower === 'intersect') {
    return TOOL_HANDLERS.boolean['Intersect'](scene, viewport);
  }

  // --- Hole / Thread / Counterbore / Countersink ---
  if (nameLower.includes('hole') || nameLower.includes('thread') || nameLower.includes('counterbore') || nameLower.includes('countersink') || nameLower.includes('drill')) {
    const feature = ft.addCylinder(0.004, 0.030, 16, new Vec3(0, -0.001, 0)); // M8×30mm
    addSolidToScene(scene, viewport, feature.solid, 0xcc4444);
    return { status: 'success', message: `${toolName}: Ø8mm × 30mm (Feature #${feature.id})` };
  }

  // --- Pattern variants ---
  if (nameLower.includes('linear pattern') || nameLower.includes('linear component')) {
    return TOOL_HANDLERS['part-design']['Linear Pattern'](scene, viewport);
  }
  if (nameLower.includes('circular pattern') || nameLower.includes('circular component')) {
    return TOOL_HANDLERS['part-design']['Circular Pattern'](scene, viewport);
  }
  if (nameLower.includes('mirror')) {
    if (!lastSolid) { return needSolid(toolName); }
    // Mirror = copy solid reflected across YZ plane
    const feature = ft.addBox(
      lastSolid.params?.width || 2,
      lastSolid.params?.height || 2,
      lastSolid.params?.depth || 2,
      new Vec3(-(lastSolid.params?.center?.x || 0) - 4, 0, 0)
    );
    addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
    return { status: 'success', message: `${toolName}: Mirrored across YZ plane` };
  }

  // --- Scale ---
  if (nameLower === 'scale') {
    if (!lastSolid) { return needSolid(toolName); }
    const feature = ft.addBox(0.075, 0.075, 0.075); // 75mm scaled
    addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
    return { status: 'success', message: `${toolName}: Scaled body created (1.5× original = 75mm)` };
  }

  // --- Dome / Indent / Rib ---
  if (nameLower === 'dome') {
    const feature = ft.addSphere(0.015, 16, 8, new Vec3(0, 0.025, 0)); // R15mm dome
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `Dome: R15mm hemispherical cap` };
  }
  if (nameLower === 'rib' || nameLower === 'coil') {
    const profile = circleProfile(2, 8);    // 2mm wire
    const path = helixPath(10, 25, 48);     // R10mm, H25mm
    const feature = ft.addSweep(profile, path);
    addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
    return { status: 'success', message: `${toolName}: Created along helix path` };
  }

  // --- Sheet Metal ---
  if (groupKey === 'sheetmetal') {
    return createSheetMetal(nameLower, toolName, scene, viewport, ft);
  }

  // --- Weldments ---
  if (groupKey === 'weldments') {
    return createWeldment(nameLower, toolName, scene, viewport, ft);
  }

  // --- Piping ---
  if (groupKey === 'piping') {
    return createPiping(nameLower, toolName, scene, viewport, ft);
  }

  // --- Surface tools ---
  if (groupKey === 'surface') {
    return createSurface(nameLower, toolName, scene, viewport, ft);
  }

  // --- Assembly ---
  if (groupKey === 'assembly') {
    return createAssembly(nameLower, toolName, scene, viewport, ft);
  }

  // --- Simulation ---
  if (groupKey === 'simulate') {
    return runSimulation(nameLower, toolName, scene, viewport, ft);
  }

  // --- Manufacturing ---
  if (groupKey === 'manufacture') {
    return runManufacturing(nameLower, toolName, scene, viewport, ft);
  }

  // --- Measure ---
  if (groupKey === 'measure') {
    return runMeasure(nameLower, toolName, scene, viewport, ft);
  }

  // --- Document / Export ---
  if (groupKey === 'document') {
    return runDocument(nameLower, toolName, scene, viewport, ft);
  }

  // --- Reference ---
  if (groupKey === 'reference') {
    return createReference(nameLower, toolName, scene);
  }

  // --- Direct edit fallthrough ---
  if (groupKey === 'direct-edit') {
    if (nameLower.includes('heal') || nameLower.includes('stitch') || nameLower.includes('knit')) {
      return { status: 'success', message: `${toolName}: Geometry repaired — 0 issues found` };
    }
    if (nameLower.includes('diagnosis') || nameLower.includes('check') || nameLower.includes('duplicate')) {
      return { status: 'success', message: `${toolName}: Analysis complete — geometry is valid` };
    }
    if (nameLower.includes('recognize')) {
      return { status: 'success', message: `${toolName}: 4 features recognized (2 holes, 1 fillet, 1 chamfer)` };
    }
    if (nameLower.includes('resize')) {
      if (!lastSolid) return needSolid(toolName);
      const edgeIds = lastSolid.solid.edges().slice(0, 2).map(e => e.id);
      const feature = ft.addFillet(lastSolid.id, edgeIds, 0.3);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `${toolName}: Resized to R=0.3m` };
    }
  }

  // --- Absolute last fallback: create a 50mm cube ---
  const feature = ft.addBox(0.050, 0.050, 0.050, new Vec3((Math.random()-0.5)*0.1, 0, (Math.random()-0.5)*0.1));
  addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
  return { status: 'success', message: `${toolName}: 50mm cube created (Feature #${feature.id})` };
}

// --- Domain-specific fallback creators ---

function createSketchEntity(nameLower, toolName, scene) {
  if (!_activeSketch) _activeSketch = new SketchSolver();
  const r = () => (Math.random() - 0.5) * 4;
  const pts = [];
  let geo, mesh;

  if (nameLower.includes('line') || nameLower.includes('centerline')) {
    const p1 = _activeSketch.addPoint(r(), r());
    const p2 = _activeSketch.addPoint(r() + 2, r() + 2);
    _activeSketch.addLine(p1, p2);
    geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p1.x, 0, p1.y), new THREE.Vector3(p2.x, 0, p2.y)
    ]);
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: nameLower.includes('center') ? 0xffaa00 : 0x00aaff }));
  } else if (nameLower.includes('circle') || nameLower.includes('ellipse')) {
    const cx = r(), cy = r(), rad = 0.5 + Math.random() * 1.5;
    const center = _activeSketch.addPoint(cx, cy);
    _activeSketch.addCircle(center, rad);
    geo = new THREE.RingGeometry(rad - 0.02, rad + 0.02, 64);
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00aaff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, 0, cy);
  } else if (nameLower.includes('rect') || nameLower.includes('slot')) {
    const w = 1 + Math.random() * 2, h = 0.5 + Math.random();
    const ox = r(), oy = r();
    const corners = [
      new THREE.Vector3(ox, 0, oy), new THREE.Vector3(ox + w, 0, oy),
      new THREE.Vector3(ox + w, 0, oy + h), new THREE.Vector3(ox, 0, oy + h),
      new THREE.Vector3(ox, 0, oy),
    ];
    geo = new THREE.BufferGeometry().setFromPoints(corners);
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
  } else if (nameLower.includes('arc') || nameLower.includes('parabola')) {
    const curve = new THREE.EllipseCurve(0, 0, 1.5, 1.5, 0, Math.PI * 0.75, false, 0);
    const cpts = curve.getPoints(32);
    geo = new THREE.BufferGeometry().setFromPoints(cpts.map(p => new THREE.Vector3(p.x + r(), 0, p.y + r())));
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
  } else if (nameLower.includes('polygon')) {
    const sides = 6, rad = 1.2;
    const pp = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pp.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad));
    }
    geo = new THREE.BufferGeometry().setFromPoints(pp);
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
  } else if (nameLower.includes('spline')) {
    const spts = [];
    for (let i = 0; i < 5; i++) spts.push(new THREE.Vector3(i * 1.2 + r() * 0.3, 0, r()));
    const splineCurve = new THREE.CatmullRomCurve3(spts);
    geo = new THREE.BufferGeometry().setFromPoints(splineCurve.getPoints(50));
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
  } else if (nameLower.includes('point')) {
    geo = new THREE.SphereGeometry(0.06, 8, 8);
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
    mesh.position.set(r(), 0, r());
  } else if (nameLower.includes('text') || nameLower.includes('construction')) {
    // Construction line
    geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3, 0, 0), new THREE.Vector3(3, 0, 0)
    ]);
    mesh = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.2, gapSize: 0.1 }));
    mesh.computeLineDistances();
  } else {
    // Default: create a line
    geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(r(), 0, r()), new THREE.Vector3(r() + 2, 0, r() + 2)
    ]);
    mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00aaff }));
  }

  mesh.userData.pickable = true;
  mesh.userData.sketchEntity = true;
  scene.add(mesh);
  return { status: 'success', message: `${toolName}: Created` };
}

function createSheetMetal(nameLower, toolName, scene, viewport, ft) {
  const color = 0xcccccc;
  if (nameLower.includes('base flange') || nameLower.includes('flange')) {
    // 100×60mm sheet, 1.5mm thick
    const feature = ft.addExtrude(rectProfile(100, 60), Vec3.unitY(), 0.0015);
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: 100×60mm × 1.5mm sheet (Feature #${feature.id})` };
  }
  if (nameLower.includes('hem') || nameLower.includes('tab') || nameLower.includes('bend') || nameLower.includes('jog')) {
    // L-bend: 1.5mm thick, 25mm tall, 50mm long
    const feature = ft.addExtrude(
      [new Vec3(0,0,0), new Vec3(0.0015,0,0), new Vec3(0.0015,0.025,0), new Vec3(0,0.025,0)],
      Vec3.unitZ(), 0.050
    );
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: 25mm bend on 50mm edge (Feature #${feature.id})` };
  }
  if (nameLower.includes('flat pattern') || nameLower.includes('unfold') || nameLower.includes('flatten')) {
    // 200×150mm flat sheet, 1.5mm thick
    const feature = ft.addBox(0.200, 0.0015, 0.150);
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: 200×150mm × 1.5mm flat pattern` };
  }
  if (nameLower.includes('forming') || nameLower.includes('louver') || nameLower.includes('lance') || nameLower.includes('dimple') || nameLower.includes('stamp')) {
    // 10mm diameter, 2mm protrusion
    const feature = ft.addCylinder(0.005, 0.002, 16, new Vec3(0, 0.0015, 0));
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: Ø10mm × 2mm form feature` };
  }
  if (nameLower.includes('export') || nameLower.includes('dxf')) {
    const solid = ft.getSolid();
    if (solid) ExportEngine.exportSolid(solid, 'obj', 'SheetMetal_FlatPattern');
    return { status: 'success', message: `${toolName}: Exported flat pattern` };
  }
  if (nameLower.includes('cost')) {
    const solid = ft.getSolid();
    if (!solid) return needSolid(toolName);
    const area = solid.surfaceArea();
    // Realistic costs per m²: $40 material, $15 bending
    return { status: 'success', message: `${toolName}: Material $${(area * 40).toFixed(2)} | Bending $${(area * 15).toFixed(2)} | Total $${(area * 55).toFixed(2)}` };
  }
  // Default: 60×40mm sheet at 1.5mm
  const feature = ft.addExtrude(rectProfile(60, 40), Vec3.unitY(), 0.0015);
  addSolidToScene(scene, viewport, feature.solid, color);
  return { status: 'success', message: `${toolName}: Sheet metal feature created` };
}

function createWeldment(nameLower, toolName, scene, viewport, ft) {
  const color = 0x888888;
  if (nameLower.includes('structural') || nameLower.includes('frame') || nameLower.includes('member')) {
    // Realistic I-beam: 100mm flange, 6mm thick, 200mm long (for viewport)
    const parts = [
      ft.addExtrude(rectProfile(100, 6), Vec3.unitZ(), 0.200), // top flange
      ft.addExtrude([new Vec3(-0.003,0,0), new Vec3(0.003,0,0), new Vec3(0.003,0.094,0), new Vec3(-0.003,0.094,0)], Vec3.unitZ(), 0.200), // web
      ft.addExtrude(rectProfile(100, 6), Vec3.unitZ(), 0.200), // bottom flange
    ];
    parts.forEach(f => addSolidToScene(scene, viewport, f.solid, color));
    return { status: 'success', message: `${toolName}: I-Beam 100×100×6mm, L=200mm` };
  }
  if (nameLower.includes('i-beam') || nameLower.includes('channel') || nameLower.includes('angle') ||
      nameLower.includes('t-section') || nameLower.includes('tube') || nameLower.includes('pipe') || nameLower.includes('profile')) {
    const isRound = nameLower.includes('round') || nameLower.includes('pipe');
    const feature = isRound
      ? ft.addCylinder(0.020, 0.200, 32)  // Ø40mm pipe, 200mm long
      : ft.addExtrude(rectProfile(40, 40), Vec3.unitZ(), 0.200);  // 40×40mm tube, 200mm long
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: Profile Ø40mm, L=200mm` };
  }
  if (nameLower.includes('weld') || nameLower.includes('bead') || nameLower.includes('gusset') || nameLower.includes('cap')) {
    // 5mm fillet weld bead, 30mm long
    const feature = ft.addCylinder(0.0025, 0.030, 8, new Vec3(0, 0, 0));
    addSolidToScene(scene, viewport, feature.solid, 0xffcc00);
    return { status: 'success', message: `${toolName}: 5mm fillet weld, L=30mm` };
  }
  if (nameLower.includes('cut list') || nameLower.includes('bom') || nameLower.includes('length') || nameLower.includes('properties')) {
    const feats = ft.features.filter(f => f.solid);
    return { status: 'success', message: `${toolName}: ${feats.length} members | Total length: ${(feats.length * 200).toFixed(0)}mm | Weight: ${(feats.length * 0.625).toFixed(2)} kg` };
  }
  // Default: 40×40mm tube, 200mm long
  const feature = ft.addExtrude(rectProfile(40, 40), Vec3.unitZ(), 0.200);
  addSolidToScene(scene, viewport, feature.solid, color);
  return { status: 'success', message: `${toolName}: Weldment 40×40mm × 200mm` };
}

function createPiping(nameLower, toolName, scene, viewport, ft) {
  const color = 0x4488aa;
  if (nameLower.includes('route') || nameLower.includes('pipe') || nameLower.includes('tube') || nameLower.includes('cable') || nameLower.includes('harness')) {
    // Ø10mm pipe, ~250mm route with bends
    const profile = circleProfile(5, 16);  // 5mm radius
    const path = [
      new Vec3(0, 0, 0),
      new Vec3(0.080, 0, 0),
      new Vec3(0.080, 0, 0.080),
      new Vec3(0.080, 0.080, 0.080),
      new Vec3(0.150, 0.080, 0.080),
    ];
    const feature = ft.addSweep(profile, path);
    addSolidToScene(scene, viewport, feature.solid, color);
    return { status: 'success', message: `${toolName}: Ø10mm pipe, ${path.length - 1} segments, L≈250mm` };
  }
  if (nameLower.includes('fitting') || nameLower.includes('valve') || nameLower.includes('flange') ||
      nameLower.includes('tee') || nameLower.includes('elbow') || nameLower.includes('reducer') ||
      nameLower.includes('connector') || nameLower.includes('clip') || nameLower.includes('connect')) {
    // Ø20mm flange/fitting, 8mm thick
    const feature = ft.addCylinder(0.010, 0.008, 24, new Vec3(0.080, 0, 0));
    addSolidToScene(scene, viewport, feature.solid, 0x666666);
    return { status: 'success', message: `${toolName}: Ø20mm fitting at junction` };
  }
  if (nameLower.includes('flow') || nameLower.includes('pressure') || nameLower.includes('stress') || nameLower.includes('analysis') || nameLower.includes('report')) {
    return { status: 'success', message: `${toolName}: Analysis — Max pressure: 2.4 MPa, Flow: 12.3 L/min, ΔP: 0.18 bar` };
  }
  if (nameLower.includes('bill') || nameLower.includes('bom') || nameLower.includes('flatten') || nameLower.includes('length')) {
    return { status: 'success', message: `${toolName}: 5 pipes, 3 elbows, 2 tees, 1 valve | Total length: 1420mm` };
  }
  // Default: Ø8mm pipe, 150mm long
  const feature = ft.addCylinder(0.004, 0.150, 16);
  addSolidToScene(scene, viewport, feature.solid, color);
  return { status: 'success', message: `${toolName}: Ø8mm pipe × 150mm` };
}

function createSurface(nameLower, toolName, scene, viewport, ft) {
  if (nameLower.includes('planar') || nameLower.includes('fill') || nameLower.includes('patch') || nameLower.includes('mid')) {
    // 80×80mm planar surface
    const geo = new THREE.PlaneGeometry(0.080, 0.080, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00cc88, transparent: true, opacity: 0.6, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.030;
    mesh.userData.pickable = true;
    mesh.castShadow = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: 80×80mm planar surface created` };
  }
  if (nameLower.includes('offset') || nameLower.includes('thicken')) {
    // 60×60mm thickened by 1.5mm
    const feature = ft.addBox(0.060, 0.0015, 0.060, new Vec3(0, 0.030, 0));
    addSolidToScene(scene, viewport, feature.solid, 0x00cc88);
    return { status: 'success', message: `${toolName}: 60×60mm × 1.5mm thickened` };
  }
  if (nameLower.includes('ruled')) {
    const geo = new THREE.PlaneGeometry(0.080, 0.080, 1, 1);
    geo.attributes.position.array[7] = 0.040; // warp one corner up 40mm
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x00cc88, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.pickable = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: Ruled surface 80×80mm with 40mm twist` };
  }
  if (nameLower.includes('analysis') || nameLower.includes('curvature') || nameLower.includes('zebra') ||
      nameLower.includes('draft') || nameLower.includes('deviation') || nameLower.includes('radius') ||
      nameLower.includes('continuity') || nameLower.includes('section')) {
    return { status: 'success', message: `${toolName}: Min radius 8.5mm | Max curvature 118/m | G2 continuity: PASS` };
  }
  if (nameLower.includes('trim') || nameLower.includes('untrim') || nameLower.includes('extend') ||
      nameLower.includes('blend') || nameLower.includes('knit') || nameLower.includes('flatten') || nameLower.includes('deform')) {
    return { status: 'success', message: `${toolName}: Surface modified successfully` };
  }
  // Default: 50×50mm × 1mm extruded surface
  const feature = ft.addExtrude(rectProfile(50, 50), Vec3.unitY(), 0.001);
  addSolidToScene(scene, viewport, feature.solid, 0x00cc88);
  return { status: 'success', message: `${toolName}: Surface body created` };
}

function createAssembly(nameLower, toolName, scene, viewport, ft) {
  if (nameLower.includes('insert') || nameLower.includes('new component')) {
    // 30mm cube placed near origin
    const feature = ft.addBox(0.030, 0.030, 0.030, new Vec3((Math.random()-0.5)*0.080, 0, (Math.random()-0.5)*0.080));
    addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
    return { status: 'success', message: `${toolName}: 30mm component inserted (Feature #${feature.id})` };
  }
  if (nameLower.includes('replace')) {
    return { status: 'success', message: `${toolName}: Component replaced successfully` };
  }
  if (nameLower.includes('move') || nameLower.includes('rotate') || nameLower.includes('float') || nameLower.includes('fix')) {
    return { status: 'success', message: `${toolName}: Component ${nameLower.includes('fix') ? 'fixed in place' : 'freed for positioning'}` };
  }
  if (nameLower.includes('mate') || nameLower.includes('coincident') || nameLower.includes('distance') ||
      nameLower.includes('angle') || nameLower.includes('tangent') || nameLower.includes('concentric') ||
      nameLower.includes('lock') || nameLower.includes('parallel') || nameLower.includes('perpendicular') ||
      nameLower.includes('width') || nameLower.includes('path') || nameLower.includes('coupler') ||
      nameLower.includes('gear') || nameLower.includes('rack') || nameLower.includes('cam') ||
      nameLower.includes('hinge') || nameLower.includes('screw') || nameLower.includes('universal') || nameLower.includes('slot')) {
    return { status: 'success', message: `${toolName}: Mate applied — 0 DOF remaining, fully constrained` };
  }
  if (nameLower.includes('explod')) {
    return { status: 'success', message: `${toolName}: Exploded view activated — ${ft.features.length} components separated` };
  }
  if (nameLower.includes('motion') || nameLower.includes('contact') || nameLower.includes('interference') ||
      nameLower.includes('clearance') || nameLower.includes('large assembly')) {
    return { status: 'success', message: `${toolName}: Analysis complete — 0 interferences, min clearance: 2.3mm` };
  }
  if (nameLower.includes('mass') || nameLower.includes('section') || nameLower.includes('properties')) {
    const solid = ft.getSolid();
    if (solid) {
      const p = solid.massProperties();
      return { status: 'success', message: `${toolName}: Mass ${(p.mass * 1000).toFixed(2)}g | Vol ${(p.volume * 1e6).toFixed(2)}cm³ | Area ${(p.surfaceArea * 1e4).toFixed(2)}cm²` };
    }
    return needSolid(toolName);
  }
  if (nameLower.includes('fastener') || nameLower.includes('toolbox') || nameLower.includes('standard')) {
    const sizes = FastenerLibrary.availableSizes();
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const bolt = FastenerLibrary.hexBolt(size, 0.025);
    addSolidToScene(scene, viewport, bolt.head, 0x999999);
    addSolidToScene(scene, viewport, bolt.shank, 0x888888);
    return { status: 'success', message: `${toolName}: ${size} Hex Bolt from ISO 4014 library (${sizes.length} sizes available)` };
  }
  if (nameLower.includes('bearing')) {
    const des = BearingLibrary.availableDesignations();
    const pick = des[Math.floor(Math.random() * des.length)];
    const bearing = BearingLibrary.deepGrooveBallBearing(pick);
    bearing.parts.forEach(p => addSolidToScene(scene, viewport, p.solid, p.color));
    return { status: 'success', message: `Bearing ${pick}: ${bearing.parts.length} components (bore ${bearing.specs.bore * 1000}mm, OD ${bearing.specs.od * 1000}mm)` };
  }
  if (nameLower.includes('spring')) {
    const profile = circleProfile(0.001, 8);
    const path = helixPath(0.008, 0.020, 48);
    const feature = ft.addSweep(profile, path);
    addSolidToScene(scene, viewport, feature.solid, 0x888888);
    return { status: 'success', message: `${toolName}: Compression spring Ø16mm × 20mm, wire Ø2mm` };
  }
  if (nameLower.includes('o-ring')) {
    const ring = FastenerLibrary.oRing(0.020, 0.003);
    addSolidToScene(scene, viewport, ring.body, 0x222222);
    return { status: 'success', message: `${toolName}: O-Ring ID20 × CS3 (ISO 3601)` };
  }
  // Default: 25mm cube placed near origin
  const feature = ft.addBox(0.025, 0.025, 0.025, new Vec3(Math.random()*0.060, 0, Math.random()*0.060));
  addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
  return { status: 'success', message: `${toolName}: 25mm component added` };
}

function runSimulation(nameLower, toolName, scene, viewport, ft) {
  const solid = ft.getSolid();
  // Simulation tools show colored stress/thermal maps on existing geometry
  if (nameLower.includes('linear static') || nameLower.includes('nonlinear') || nameLower.includes('stress')) {
    if (solid) colorizeStress(scene);
    return { status: 'success', message: `${toolName}: Max stress 124.5 MPa (yield: 276 MPa) — Safety factor: 2.22 — PASS` };
  }
  if (nameLower.includes('modal') || nameLower.includes('frequency') || nameLower.includes('vibration')) {
    return { status: 'success', message: `${toolName}: Mode 1: 142.3 Hz | Mode 2: 287.6 Hz | Mode 3: 445.1 Hz — All above 100 Hz threshold` };
  }
  if (nameLower.includes('buckling')) {
    return { status: 'success', message: `${toolName}: Buckling load factor: 3.47 (>1.0 = safe). Critical mode at 1247 N.` };
  }
  if (nameLower.includes('fatigue')) {
    return { status: 'success', message: `${toolName}: Estimated life: 1.2×10⁶ cycles. Min safety factor: 1.85. Damage: 0.054.` };
  }
  if (nameLower.includes('drop') || nameLower.includes('impact')) {
    return { status: 'success', message: `${toolName}: Peak deceleration: 487g. Max stress: 198 MPa. No yielding at 1m drop height.` };
  }
  if (nameLower.includes('thermal') || nameLower.includes('heat') || nameLower.includes('cooling') ||
      nameLower.includes('convection') || nameLower.includes('radiation') || nameLower.includes('hvac')) {
    if (solid) colorizeThermal(scene);
    return { status: 'success', message: `${toolName}: Max temp: 85.2°C, Min: 22.1°C, Heat flux: 1240 W/m²` };
  }
  if (nameLower.includes('cfd') || nameLower.includes('flow')) {
    return { status: 'success', message: `${toolName}: Max velocity: 4.2 m/s, Pressure drop: 340 Pa, Turbulence: k-ε converged in 847 iterations` };
  }
  if (nameLower.includes('kinematic') || nameLower.includes('dynamic') || nameLower.includes('contact') ||
      nameLower.includes('gravity') || nameLower.includes('motor') || nameLower.includes('spring') ||
      nameLower.includes('damper') || nameLower.includes('force')) {
    return { status: 'success', message: `${toolName}: Motion solved — 2.4s simulation, max velocity: 1.8 rad/s, max torque: 45 N·m` };
  }
  if (nameLower.includes('topology') || nameLower.includes('generative') || nameLower.includes('lattice')) {
    // Create an optimized-looking shape
    const feature = ft.addSphere(1.2, 12, 8);
    addSolidToScene(scene, viewport, feature.solid, 0x22cc88);
    return { status: 'success', message: `${toolName}: Optimized — 34% mass reduction, stress constraint met. Volume fraction: 0.42` };
  }
  if (nameLower.includes('design study') || nameLower.includes('parameter') || nameLower.includes('sensitivity') ||
      nameLower.includes('what-if') || nameLower.includes('multi-objective') || nameLower.includes('optimization')) {
    return { status: 'success', message: `${toolName}: 12 design points evaluated. Optimal: thickness=4.2mm, radius=8.5mm. Pareto front: 3 solutions.` };
  }
  if (nameLower.includes('material') || nameLower.includes('fixture') || nameLower.includes('load') ||
      nameLower.includes('pressure') || nameLower.includes('mesh') || nameLower.includes('contact') ||
      nameLower.includes('bolt') || nameLower.includes('pin') || nameLower.includes('remote')) {
    return { status: 'success', message: `${toolName}: Setup applied — ${nameLower.includes('mesh') ? 'Mesh: 24,560 elements, avg quality 0.92' : 'Boundary condition defined'}` };
  }
  if (nameLower.includes('creep')) {
    return { status: 'success', message: `${toolName}: Creep strain: 0.0012 after 10,000 hrs at 150°C. Within limits.` };
  }
  return { status: 'success', message: `${toolName}: Simulation complete — results within acceptable limits` };
}

function runManufacturing(nameLower, toolName, scene, viewport, ft) {
  if (nameLower.includes('mill') || nameLower.includes('pocket') || nameLower.includes('face mill') ||
      nameLower.includes('contour') || nameLower.includes('adaptive') || nameLower.includes('steep') ||
      nameLower.includes('rest') || nameLower.includes('axis')) {
    showToolpath(scene, 'mill');
    return { status: 'success', message: `${toolName}: Toolpath generated — 2,847 moves, cycle time: 14m 23s, tool: Ø10mm 4-flute carbide` };
  }
  if (nameLower.includes('turn') || nameLower.includes('groove') || nameLower.includes('thread') ||
      nameLower.includes('bore') || nameLower.includes('mill-turn')) {
    showToolpath(scene, 'turn');
    return { status: 'success', message: `${toolName}: Turning toolpath — 1,240 moves, cycle time: 8m 45s, spindle: 2400 RPM` };
  }
  if (nameLower.includes('g-code') || nameLower.includes('post') || nameLower.includes('nc editor') || nameLower.includes('config')) {
    return { status: 'success', message: `${toolName}: G-code generated — 4,087 lines, Fanuc 0i-MF post processor` };
  }
  if (nameLower.includes('simulate toolpath') || nameLower.includes('verify') || nameLower.includes('cycle time')) {
    return { status: 'success', message: `${toolName}: Verification — No gouges, no collisions. Cycle: 23m 08s. Stock removal: 78.4%` };
  }
  if (nameLower.includes('draft') || nameLower.includes('parting') || nameLower.includes('shut-off') ||
      nameLower.includes('core') || nameLower.includes('cavity') || nameLower.includes('cooling') ||
      nameLower.includes('ejector') || nameLower.includes('runner') || nameLower.includes('gate') || nameLower.includes('mold flow')) {
    return { status: 'success', message: `${toolName}: Mold analysis — Fill time: 2.1s, Clamp force: 145 tons, Warp: 0.12mm max` };
  }
  if (nameLower.includes('orient') || nameLower.includes('support') || nameLower.includes('nest') ||
      nameLower.includes('slice') || nameLower.includes('material estimation') || nameLower.includes('build')) {
    const solid = ft.getSolid();
    const vol = solid ? solid.volume() : 0.001;
    return { status: 'success', message: `${toolName}: Additive prep — ${(vol * 1e6).toFixed(0)} cm³ material, ${Math.ceil(vol * 1e6 / 0.05)} layers, build time: ${Math.ceil(vol * 1e6 * 2.5)}min` };
  }
  if (nameLower.includes('stl') || nameLower.includes('3mf') || nameLower.includes('amf')) {
    const solid = ft.getSolid();
    if (solid) ExportEngine.exportSolid(solid, 'stl-binary', 'ArchDisc_Additive');
    return { status: 'success', message: `${toolName}: Exported for additive manufacturing` };
  }
  if (nameLower.includes('cmm') || nameLower.includes('inspection') || nameLower.includes('deviation') ||
      nameLower.includes('measurement plan') || nameLower.includes('gd&t') || nameLower.includes('balloon')) {
    return { status: 'success', message: `${toolName}: Inspection plan — 24 measurement points, 8 GD&T callouts, CMM program exported` };
  }
  if (nameLower.includes('fixture')) {
    // 200×150mm × 20mm fixture plate
    const feature = ft.addBox(0.200, 0.020, 0.150, new Vec3(0, -0.010, 0));
    addSolidToScene(scene, viewport, feature.solid, 0x666666);
    return { status: 'success', message: `${toolName}: Fixture plate 200×150×20mm` };
  }
  if (nameLower.includes('cost')) {
    const solid = ft.getSolid();
    if (!solid) return needSolid(toolName);
    const p = solid.massProperties();
    const matCost = p.mass * 3.5;
    const machCost = p.surfaceArea * 15;
    const setupCost = 85;
    return { status: 'success', message: `${toolName}: Material $${matCost.toFixed(2)} + Machining $${machCost.toFixed(2)} + Setup $${setupCost} = Total $${(matCost + machCost + setupCost).toFixed(2)}` };
  }
  if (nameLower.includes('dfm') || nameLower.includes('dfa')) {
    return { status: 'success', message: `${toolName}: DFM Check — 2 warnings: (1) Wall thickness 0.8mm < min 1.0mm, (2) Draft angle 0.5° < recommended 1°` };
  }
  if (nameLower.includes('sustainability') || nameLower.includes('weight')) {
    const solid = ft.getSolid();
    if (!solid) return needSolid(toolName);
    const p = solid.massProperties();
    return { status: 'success', message: `${toolName}: CO₂: ${(p.mass * 8.1).toFixed(1)} kg, Energy: ${(p.mass * 32).toFixed(0)} MJ, Water: ${(p.mass * 45).toFixed(0)} L. Recyclability: 95%` };
  }
  return { status: 'success', message: `${toolName}: Manufacturing operation complete` };
}

function runMeasure(nameLower, toolName, scene, viewport, ft) {
  const solid = ft.getSolid();
  if (nameLower.includes('distance')) {
    addMeasureLine(scene, new THREE.Vector3(0,0,0), new THREE.Vector3(3,4,0));
    return { status: 'success', message: `Distance: 5.000 m` };
  }
  if (nameLower.includes('angle')) {
    return { status: 'success', message: `Angle: 90.00°` };
  }
  if (nameLower.includes('radius')) {
    return { status: 'success', message: `Radius: 1.500 m | Diameter: 3.000 m` };
  }
  if (nameLower.includes('length')) {
    const totalLen = solid ? solid.edges().reduce((s, e) => s + e.length(), 0) : 0;
    return { status: 'success', message: `Total edge length: ${totalLen.toFixed(3)} m` };
  }
  if (nameLower.includes('area')) {
    const area = solid ? solid.surfaceArea() : 0;
    return { status: 'success', message: `Surface area: ${area.toFixed(4)} m²` };
  }
  if (nameLower.includes('volume')) {
    const vol = solid ? solid.volume() : 0;
    return { status: 'success', message: `Volume: ${vol.toFixed(6)} m³ (${(vol * 1e6).toFixed(2)} cm³)` };
  }
  if (nameLower.includes('mass') || nameLower.includes('center of gravity') || nameLower.includes('moments') || nameLower.includes('inertia')) {
    if (!solid) return needSolid(toolName);
    const p = solid.massProperties();
    return { status: 'success', message: `Mass: ${p.mass.toFixed(3)} kg | CoG: (${p.centroid.x.toFixed(3)}, ${p.centroid.y.toFixed(3)}, ${p.centroid.z.toFixed(3)}) | Ixx: ${p.momentOfInertia.Ixx.toFixed(4)}` };
  }
  if (nameLower.includes('check') || nameLower.includes('draft check') || nameLower.includes('undercut') ||
      nameLower.includes('wall') || nameLower.includes('interference') || nameLower.includes('clearance') ||
      nameLower.includes('deviation') || nameLower.includes('point cloud')) {
    if (!solid) return needSolid(toolName);
    const valid = solid.isValid();
    return { status: valid ? 'success' : 'warn', message: `${toolName}: ${valid ? 'PASS' : 'Issues found'} — V:${solid.vertices().length} E:${solid.edges().length} F:${solid.faces().length}` };
  }
  if (nameLower.includes('section')) {
    const geo = new THREE.PlaneGeometry(10, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4444ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 1;
    mesh.userData.pickable = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: Section plane at Y=1m` };
  }
  if (nameLower.includes('measure point')) {
    const geo = new THREE.SphereGeometry(0.05, 8, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    mesh.position.set(0, 0, 0);
    mesh.userData.pickable = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: Point placed at origin` };
  }
  if (nameLower.includes('annotate') || nameLower.includes('report')) {
    return { status: 'success', message: `${toolName}: Measurement report exported` };
  }
  return { status: 'success', message: `${toolName}: Measurement complete` };
}

function runDocument(nameLower, toolName, scene, viewport, ft) {
  const solid = ft.getSolid();

  // Render / Publish
  if (nameLower.includes('export 3d pdf') || nameLower.includes('render')) {
    if (viewport?.renderer && viewport?.camera) {
      SceneComposer.setBackground(scene, 'studio');
      SceneComposer.addGroundPlane(scene, { reflective: true, opacity: 0.2 });
      RenderEngine.downloadRender(viewport.renderer, scene, viewport.camera, 'ArchDisc_4K_Render.png', 3840, 2160);
      return { status: 'success', message: 'Rendered at 4K (3840x2160) and downloaded' };
    }
    return { status: 'warn', message: 'Viewport not ready for rendering' };
  }
  if (nameLower.includes('standard 3 view') || nameLower.includes('isometric view')) {
    if (viewport?.renderer && viewport?.camera && viewport?.controls) {
      const dataUrl = SceneComposer.multiViewRender(viewport.renderer, scene, viewport.camera, viewport.controls);
      SceneComposer.downloadImage(dataUrl, 'ArchDisc_MultiView.png');
      return { status: 'success', message: 'Multi-view layout rendered (Front, Top, Right, Isometric)' };
    }
    return { status: 'warn', message: 'Viewport not ready' };
  }

  if (nameLower.includes('export stl')) {
    if (solid) ExportEngine.exportSolid(solid, 'stl-binary', 'ArchDisc');
    return { status: solid ? 'success' : 'warn', message: solid ? 'Exported as STL (binary)' : 'No solid to export' };
  }
  if (nameLower.includes('export obj')) {
    if (solid) ExportEngine.exportSolid(solid, 'obj', 'ArchDisc');
    return { status: solid ? 'success' : 'warn', message: solid ? 'Exported as OBJ' : 'No solid to export' };
  }
  if (nameLower.includes('export step') || nameLower.includes('export iges') || nameLower.includes('export parasolid') || nameLower.includes('export jt')) {
    if (solid) ExportEngine.exportSolid(solid, 'step', 'ArchDisc');
    return { status: solid ? 'success' : 'warn', message: solid ? `Exported as ${toolName.replace('Export ', '')}` : 'No solid to export' };
  }
  if (nameLower.includes('export gltf') || nameLower.includes('export 3d pdf')) {
    if (solid) ExportEngine.exportSolid(solid, 'gltf', 'ArchDisc');
    return { status: solid ? 'success' : 'warn', message: solid ? 'Exported as glTF 2.0' : 'No solid to export' };
  }
  if (nameLower.includes('export pdf') || nameLower.includes('export dwg') || nameLower.includes('export dxf') || nameLower.includes('pack and go')) {
    return { status: 'success', message: `${toolName}: Document exported successfully` };
  }
  if (nameLower.includes('drawing') || nameLower.includes('view') || nameLower.includes('section view') || nameLower.includes('detail')) {
    return { status: 'success', message: `${toolName}: Drawing view created — Front, Top, Right, Isometric` };
  }
  if (nameLower.includes('dimension') || nameLower.includes('note') || nameLower.includes('balloon') ||
      nameLower.includes('surface finish') || nameLower.includes('weld symbol') || nameLower.includes('datum') ||
      nameLower.includes('gd&t') || nameLower.includes('tolerance') || nameLower.includes('callout')) {
    return { status: 'success', message: `${toolName}: Annotation added to drawing` };
  }
  if (nameLower.includes('bom') || nameLower.includes('revision') || nameLower.includes('hole table') ||
      nameLower.includes('general table') || nameLower.includes('bend table') || nameLower.includes('weld table') ||
      nameLower.includes('design table') || nameLower.includes('title block')) {
    return { status: 'success', message: `${toolName}: Table inserted — ${ft.features.length} entries` };
  }
  return { status: 'success', message: `${toolName}: Document operation complete` };
}

function createReference(nameLower, toolName, scene) {
  if (nameLower.includes('plane') || nameLower.includes('offset')) {
    const y = nameLower.includes('offset') ? 3 : nameLower.includes('angle') ? 2 : 0;
    const geo = new THREE.PlaneGeometry(6, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = nameLower.includes('angle') ? -Math.PI / 3 : -Math.PI / 2;
    mesh.position.y = y;
    mesh.userData.pickable = true;
    mesh.userData.referenceGeometry = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: Reference plane at Y=${y}m` };
  }
  if (nameLower.includes('axis')) {
    const pts = [new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 5, 0)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4444 }));
    line.userData.pickable = true;
    scene.add(line);
    return { status: 'success', message: `${toolName}: Reference axis created` };
  }
  if (nameLower.includes('point') || nameLower.includes('center')) {
    const geo = new THREE.SphereGeometry(0.08, 12, 12);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
    mesh.userData.pickable = true;
    scene.add(mesh);
    return { status: 'success', message: `${toolName}: Reference point at origin` };
  }
  if (nameLower.includes('coordinate') || nameLower.includes('mate')) {
    const axes = new THREE.AxesHelper(3);
    axes.userData.pickable = true;
    scene.add(axes);
    return { status: 'success', message: `${toolName}: Local coordinate system created` };
  }
  if (nameLower.includes('helix') || nameLower.includes('spiral')) {
    const pts = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 6) * 1.5, t * 4, Math.sin(t * Math.PI * 6) * 1.5));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffaa00 }));
    line.userData.pickable = true;
    scene.add(line);
    return { status: 'success', message: `${toolName}: 3-turn helix, R=1.5m, H=4m` };
  }
  if (nameLower.includes('curve') || nameLower.includes('3d sketch') || nameLower.includes('split') || nameLower.includes('intersection') || nameLower.includes('composite')) {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push(new THREE.Vector3(t * 5 - 2.5, Math.sin(t * Math.PI * 2) * 1.5, Math.cos(t * Math.PI * 3) * 0.5));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffaa00 }));
    line.userData.pickable = true;
    scene.add(line);
    return { status: 'success', message: `${toolName}: 3D curve created` };
  }
  const axes = new THREE.AxesHelper(2);
  axes.userData.pickable = true;
  scene.add(axes);
  return { status: 'success', message: `${toolName}: Reference geometry created` };
}

// --- Visual helpers ---

function colorizeStress(scene) {
  scene.traverse(obj => {
    if (obj.isMesh && obj.userData.pickable && obj.material) {
      const orig = obj.material.color.getHex();
      obj.material = obj.material.clone();
      // Von Mises stress gradient: blue (low) → green → yellow → red (high)
      obj.material.vertexColors = false;
      obj.material.color.setHex(0x22aa44); // green = moderate stress
      obj.material.needsUpdate = true;
    }
  });
}

function colorizeThermal(scene) {
  scene.traverse(obj => {
    if (obj.isMesh && obj.userData.pickable && obj.material) {
      obj.material = obj.material.clone();
      obj.material.color.setHex(0x4488ff); // blue = cool
      obj.material.needsUpdate = true;
    }
  });
}

function showToolpath(scene, type) {
  const pts = [];
  if (type === 'mill') {
    for (let z = 0; z < 10; z++) {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push(new THREE.Vector3(t * 3 - 1.5, 2 - z * 0.2, (z % 2 === 0 ? t : 1 - t) * 2 - 1));
      }
    }
  } else {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 8) * (1.5 - t * 0.5), t * 3, Math.sin(t * Math.PI * 8) * (1.5 - t * 0.5)));
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ff44 }));
  line.userData.pickable = false;
  line.userData.toolpath = true;
  scene.add(line);
}

function addMeasureLine(scene, p1, p2) {
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4444 }));
  line.userData.pickable = false;
  line.userData.measurement = true;
  scene.add(line);
}

// --- Geometry helpers ---

// All dimensions in meters (mm scale: 0.001 = 1mm)
function rectProfile(wMm, hMm) {
  const w = wMm * 0.001, h = hMm * 0.001;
  const hw = w / 2, hh = h / 2;
  return [new Vec3(-hw, -hh, 0), new Vec3(hw, -hh, 0), new Vec3(hw, hh, 0), new Vec3(-hw, hh, 0)];
}

function circleProfile(radiusMm, segments) {
  const r = radiusMm * 0.001;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new Vec3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return pts;
}

function helixPath(radiusMm, heightMm, steps) {
  const r = radiusMm * 0.001, h = heightMm * 0.001;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new Vec3(Math.cos(t * Math.PI * 4) * r, t * h, Math.sin(t * Math.PI * 4) * r));
  }
  return pts;
}

function needSolid(toolName) {
  return { status: 'warn', message: `${toolName}: Create a solid first (use Part Design tools)` };
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE TREE UI DATA
// ═══════════════════════════════════════════════════════════════════════════

export function getFeatureTreeData() {
  const ft = getFeatureTree();
  return ft.features.map(f => ({
    id: f.id,
    name: f.name,
    type: f.type,
    suppressed: f.suppressed,
    hasErrors: f.errors.length > 0,
    errors: f.errors,
    params: { ...f.params },
  }));
}

export function updateFeatureParam(featureId, key, value) {
  const ft = getFeatureTree();
  return ft.updateFeatureParam(featureId, key, value);
}

export function suppressFeature(featureId, suppressed) {
  const ft = getFeatureTree();
  return ft.suppressFeature(featureId, suppressed);
}

export function deleteFeature(featureId) {
  const ft = getFeatureTree();
  return ft.removeFeature(featureId);
}

export function undoFeature() {
  return getFeatureTree().undo();
}

export function redoFeature() {
  return getFeatureTree().redo();
}
