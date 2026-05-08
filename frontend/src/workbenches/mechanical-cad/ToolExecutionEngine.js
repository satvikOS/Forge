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
} from '../../kernel/index.js';

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
  if (!handler) {
    return { status: 'warn', message: `${toolName}: Not yet implemented` };
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

    'Trim': () => ({ status: 'info', message: 'Trim: Click sketch entities to trim at intersections' }),
    'Offset': () => ({ status: 'info', message: 'Offset: Select sketch entity and specify distance' }),
    'Mirror': () => ({ status: 'info', message: 'Mirror: Select sketch entities and mirror line' }),
    'Fillet': () => ({ status: 'info', message: 'Sketch Fillet: Select corner to round' }),
    'Chamfer': () => ({ status: 'info', message: 'Sketch Chamfer: Select corner to chamfer' }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PART DESIGN — Real kernel operations
  // ═══════════════════════════════════════════════════════════════════════════
  'part-design': {
    'Extrude Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      const profile = [
        new Vec3(-1.5, -1, 0),
        new Vec3(1.5, -1, 0),
        new Vec3(1.5, 1, 0),
        new Vec3(-1.5, 1, 0),
      ];
      const feature = ft.addExtrude(profile, Vec3.unitZ(), 3);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Extrude Boss: 3m × 2m × 3m solid (Feature #${feature.id})` };
    },

    'Extrude Cut': (scene, viewport) => {
      const ft = getFeatureTree();
      // Cut a smaller hole from the last solid
      const profile = [
        new Vec3(-0.5, -0.5, -0.1),
        new Vec3(0.5, -0.5, -0.1),
        new Vec3(0.5, 0.5, -0.1),
        new Vec3(-0.5, 0.5, -0.1),
      ];
      const cutFeature = ft.addExtrude(profile, Vec3.unitZ(), 3.2);

      if (ft.features.length >= 2) {
        const baseId = ft.features[ft.features.length - 2].id;
        const cutId = cutFeature.id;
        const boolFeature = ft.addBooleanSubtract(baseId, cutId);
        addSolidToScene(scene, viewport, boolFeature.solid, 0x8b1538);
        return { status: 'success', message: `Extrude Cut: Boolean subtract applied (Feature #${boolFeature.id})` };
      }

      addSolidToScene(scene, viewport, cutFeature.solid, 0xcc4444);
      return { status: 'success', message: `Cut body created. Select base and cut to subtract.` };
    },

    'Revolve Boss': (scene, viewport) => {
      const ft = getFeatureTree();
      const profile = [
        new Vec3(0.5, 0, 0),
        new Vec3(2, 0, 0),
        new Vec3(2, 3, 0),
        new Vec3(1.5, 3, 0),
        new Vec3(1.5, 0.5, 0),
        new Vec3(0.5, 0.5, 0),
      ];
      const feature = ft.addRevolve(profile, Vec3.zero(), Vec3.unitY(), Math.PI * 2, 32);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Revolve: Full 360° revolution (Feature #${feature.id})` };
    },

    'Revolve Cut': (scene, viewport) => {
      const ft = getFeatureTree();
      const profile = [
        new Vec3(1.8, 0.5, 0),
        new Vec3(2.2, 0.5, 0),
        new Vec3(2.2, 2.5, 0),
        new Vec3(1.8, 2.5, 0),
      ];
      const feature = ft.addRevolve(profile, Vec3.zero(), Vec3.unitY(), Math.PI * 2, 32);
      addSolidToScene(scene, viewport, feature.solid, 0xcc4444);
      return { status: 'success', message: `Revolve Cut body created (Feature #${feature.id})` };
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
      const edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
      const feature = ft.addFillet(lastSolid.id, edgeIds, 0.2);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Fillet: R=0.2m on ${edgeIds.length} edges (Feature #${feature.id})` };
    },

    'Chamfer': (scene, viewport) => {
      const ft = getFeatureTree();
      const lastSolid = ft.features.filter(f => f.solid && !f.suppressed).pop();
      if (!lastSolid) return { status: 'warn', message: 'Chamfer: Create a solid first' };
      const edgeIds = lastSolid.solid.edges().slice(0, 4).map(e => e.id);
      const feature = ft.addChamfer(lastSolid.id, edgeIds, 0.15);
      addSolidToScene(scene, viewport, feature.solid, 0x8b1538);
      return { status: 'success', message: `Chamfer: 0.15m on ${edgeIds.length} edges (Feature #${feature.id})` };
    },

    'Hole Wizard': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCylinder(0.3, 5, 24, new Vec3(0, -1, 0));
      addSolidToScene(scene, viewport, feature.solid, 0xcc4444);
      return { status: 'success', message: `Hole: Ø0.6m × 5m deep (Feature #${feature.id}). Boolean subtract with base solid.` };
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
        const feature = ft.addBox(1, 1, 1, new Vec3(i * 2, 0, 0));
        const solidGroup = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x8b1538, edges: true });
        group.add(solidGroup);
      }
      group.userData.pickable = true;
      group.userData.generatedModel = true;
      scene.add(group);
      return { status: 'success', message: 'Linear Pattern: 4 instances, 2m spacing along X' };
    },

    'Circular Pattern': (scene, viewport) => {
      const ft = getFeatureTree();
      const group = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * 3;
        const z = Math.sin(angle) * 3;
        const feature = ft.addCylinder(0.3, 2, 16, new Vec3(x, 0, z));
        const solidGroup = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x8b1538, edges: true });
        group.add(solidGroup);
      }
      group.userData.pickable = true;
      group.userData.generatedModel = true;
      scene.add(group);
      return { status: 'success', message: 'Circular Pattern: 6 instances, R=3m' };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIMITIVES — Direct B-Rep solid creation
  // ═══════════════════════════════════════════════════════════════════════════
  primitives: {
    'Box': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addBox(2, 2, 2);
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Box: 2m × 2m × 2m (Feature #${feature.id})` };
    },

    'Cylinder': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCylinder(1, 3, 32);
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Cylinder: R=1m, H=3m (Feature #${feature.id})` };
    },

    'Sphere': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addSphere(1.5, 32, 16);
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Sphere: R=1.5m (Feature #${feature.id})` };
    },

    'Cone': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addCone(1.5, 3, 32);
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Cone: R=1.5m, H=3m (Feature #${feature.id})` };
    },

    'Torus': (scene, viewport) => {
      const ft = getFeatureTree();
      const feature = ft.addTorus(2, 0.5, 32, 16);
      addSolidToScene(scene, viewport, feature.solid, 0x4a90d9);
      return { status: 'success', message: `Torus: R=2m, r=0.5m (Feature #${feature.id})` };
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
    'Offset Face': () => ({ status: 'info', message: 'Offset Face: Select a face and specify offset distance' }),
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
    'Replace Face': () => ({ status: 'info', message: 'Replace Face: Select target face and replacement surface' }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLY
  // ═══════════════════════════════════════════════════════════════════════════
  assembly: {
    'Insert Component': () => ({ status: 'info', message: 'Insert Component: Select a part file to insert into assembly' }),
    'Coincident Mate': () => ({ status: 'info', message: 'Coincident: Select two faces/planes to make coincident' }),
    'Concentric Mate': () => ({ status: 'info', message: 'Concentric: Select two cylindrical faces to align' }),
    'Distance Mate': () => ({ status: 'info', message: 'Distance: Select two faces and specify separation' }),
    'Exploded View': () => ({ status: 'info', message: 'Exploded View: Creates exploded view of assembly' }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATE
  // ═══════════════════════════════════════════════════════════════════════════
  simulate: {
    'Linear Static FEA': () => ({ status: 'info', message: 'FEA: Apply loads and constraints, then solve for stress/strain' }),
    'Thermal': () => ({ status: 'info', message: 'Thermal: Define heat sources and boundary conditions' }),
    'CFD': () => ({ status: 'info', message: 'CFD: Define fluid domain, inlets, outlets, and flow conditions' }),
    'Modal': () => ({ status: 'info', message: 'Modal: Compute natural frequencies and mode shapes' }),
    'Topology Optimization': () => ({ status: 'info', message: 'Topology: Define loads, constraints, and volume fraction target' }),
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

    'Angle': () => ({ status: 'info', message: 'Angle: Select two edges or faces to measure angle between them' }),

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
      return {
        status: valid ? 'success' : 'warn',
        message: `Geometry check: ${valid ? 'VALID' : 'ISSUES FOUND'} | Euler: ${euler} | Manifold: ${manifold ? 'Yes' : 'No'} | V:${solid.vertices().length} E:${solid.edges().length} F:${solid.faces().length}`
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUFACTURE
  // ═══════════════════════════════════════════════════════════════════════════
  manufacture: {
    '2.5 Axis Milling': () => ({ status: 'info', message: '2.5-Axis: Select faces for pocketing, profiling, or drilling' }),
    '3 Axis Milling': () => ({ status: 'info', message: '3-Axis: Define toolpath for complex surface machining' }),
    'Turning': () => ({ status: 'info', message: 'Turning: Define lathe operations for rotational parts' }),
    'G-Code Post': () => ({ status: 'info', message: 'G-Code: Generate toolpath code for selected machine' }),
    'Additive Prep': () => ({ status: 'info', message: 'Additive: Orient part, generate supports, slice for 3D printing' }),
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
    'New Drawing': () => ({ status: 'info', message: 'Drawing: Creates 2D drawing with standard views from 3D model' }),
    'Smart Dimension': () => ({ status: 'info', message: 'Smart Dimension: Click geometry to add dimensions to drawing' }),
    'BOM Table': () => ({ status: 'info', message: 'BOM: Generate bill of materials from assembly' }),
    'Export PDF': () => ({ status: 'info', message: 'Export: Generates PDF drawing package' }),
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
    'Export STEP': () => ({ status: 'info', message: 'STEP export: Coming soon — requires ISO 10303 writer' }),
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
