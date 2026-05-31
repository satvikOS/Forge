/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel.
 *
 * NOTE: this file is the ONE Model C class whose public shape is still
 * referenced by production wiring — `getFeatureTree()` in
 * ToolExecutionEngine.js exposes a FeatureTree instance that
 * FeatureTreePanel.jsx + Viewport3D.jsx read for tree row data. The data
 * shape (id / name / type / params) is the live consumer; the actual
 * parametric-replay path (rebuild / update / undo) is no longer the
 * authoritative model — every body in the scene is sourced from a kernel
 * brep facade op + spine.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. The data shape may persist for the
 * tree-panel UI; the geometry-producing methods are dead.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ArchDisc Geometry Kernel — Feature Tree
 * Parametric history-based modeling. Each feature records its operation and parameters.
 * Editing a parameter regenerates all downstream features.
 */

import Vec3 from '../math/Vec3.js';
import PrimitiveBuilder from './PrimitiveBuilder.js';
import ExtrudeFeature from './ExtrudeFeature.js';
import RevolveFeature from './RevolveFeature.js';
import BooleanEngine from './BooleanEngine.js';
import FilletChamfer from './FilletChamfer.js';
import LoftSweep from './LoftSweep.js';
import DirectEdit from './DirectEdit.js';

let _featureId = 0;

class Feature {
  constructor(type, params, operation) {
    this.id = ++_featureId;
    this.type = type;
    this.params = { ...params };
    this.operation = operation; // function(params) => TopoSolid
    this.solid = null;         // computed result
    this.suppressed = false;   // if true, skip during regeneration
    this.name = `${type}_${this.id}`;
    this.parent = null;        // previous feature in chain
    this.children = [];        // features that depend on this
    this.errors = [];
  }

  updateParam(key, value) {
    if (!(key in this.params)) {
      throw new Error(`Unknown parameter: ${key}`);
    }
    this.params[key] = value;
  }
}

export default class FeatureTree {
  constructor() {
    this.features = [];
    this.currentSolid = null;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
  }

  // --- Feature Creation ---

  addBox(width, height, depth, center) {
    return this._addFeature('box', { width, height, depth, center: center || Vec3.zero() },
      (p) => PrimitiveBuilder.box(p.width, p.height, p.depth, p.center)
    );
  }

  addCylinder(radius, height, segments = 32, center) {
    return this._addFeature('cylinder', { radius, height, segments, center: center || Vec3.zero() },
      (p) => PrimitiveBuilder.cylinder(p.radius, p.height, p.segments, p.center)
    );
  }

  addSphere(radius, widthSegments = 32, heightSegments = 16, center) {
    return this._addFeature('sphere', { radius, widthSegments, heightSegments, center: center || Vec3.zero() },
      (p) => PrimitiveBuilder.sphere(p.radius, p.widthSegments, p.heightSegments, p.center)
    );
  }

  addCone(radius, height, segments = 32, center) {
    return this._addFeature('cone', { radius, height, segments, center: center || Vec3.zero() },
      (p) => PrimitiveBuilder.cone(p.radius, p.height, p.segments, p.center)
    );
  }

  addTorus(majorRadius, minorRadius, majorSegments = 32, minorSegments = 16, center) {
    return this._addFeature('torus', { majorRadius, minorRadius, majorSegments, minorSegments, center: center || Vec3.zero() },
      (p) => PrimitiveBuilder.torus(p.majorRadius, p.minorRadius, p.majorSegments, p.minorSegments, p.center)
    );
  }

  addExtrude(profilePoints, direction, distance, options = {}) {
    return this._addFeature('extrude', { profilePoints, direction, distance, ...options },
      (p) => ExtrudeFeature.extrude(p.profilePoints, p.direction, p.distance, p)
    );
  }

  addRevolve(profilePoints, axisOrigin, axisDirection, sweepAngle = Math.PI * 2, segments = 32) {
    return this._addFeature('revolve', { profilePoints, axisOrigin, axisDirection, sweepAngle, segments },
      (p) => RevolveFeature.revolve(p.profilePoints, p.axisOrigin, p.axisDirection, p.sweepAngle, p.segments)
    );
  }

  addBooleanUnion(solidAFeatureId, solidBFeatureId) {
    return this._addBooleanFeature('boolean_union', solidAFeatureId, solidBFeatureId, BooleanEngine.union);
  }

  addBooleanSubtract(solidAFeatureId, solidBFeatureId) {
    return this._addBooleanFeature('boolean_subtract', solidAFeatureId, solidBFeatureId, BooleanEngine.subtract);
  }

  addBooleanIntersect(solidAFeatureId, solidBFeatureId) {
    return this._addBooleanFeature('boolean_intersect', solidAFeatureId, solidBFeatureId, BooleanEngine.intersect);
  }

  addLoft(profiles, steps = 1, closed = false) {
    return this._addFeature('loft', { profiles, steps, closed },
      (p) => LoftSweep.loft(p.profiles, p.steps, p.closed)
    );
  }

  addSweep(profile, pathPoints, closedPath = false) {
    return this._addFeature('sweep', { profile, pathPoints, closedPath },
      (p) => LoftSweep.sweep(p.profile, p.pathPoints, p.closedPath)
    );
  }

  addFillet(targetFeatureId, edgeIds, radius, segments = 8) {
    return this._addFeature('fillet', { targetFeatureId, edgeIds, radius, segments }, (p) => {
      const target = this.getFeature(p.targetFeatureId);
      if (!target?.solid) throw new Error('Fillet target has no solid');
      return FilletChamfer.fillet(target.solid, p.edgeIds, p.radius, p.segments);
    });
  }

  addChamfer(targetFeatureId, edgeIds, distance) {
    return this._addFeature('chamfer', { targetFeatureId, edgeIds, distance }, (p) => {
      const target = this.getFeature(p.targetFeatureId);
      if (!target?.solid) throw new Error('Chamfer target has no solid');
      return FilletChamfer.chamfer(target.solid, p.edgeIds, p.distance);
    });
  }

  addPushPull(targetFeatureId, faceId, distance) {
    return this._addFeature('pushpull', { targetFeatureId, faceId, distance }, (p) => {
      const target = this.getFeature(p.targetFeatureId);
      if (!target?.solid) throw new Error('Push/Pull target has no solid');
      return DirectEdit.pushPull(target.solid, p.faceId, p.distance);
    });
  }

  addShell(targetFeatureId, removeFaceIds, thickness) {
    return this._addFeature('shell', { targetFeatureId, removeFaceIds, thickness }, (p) => {
      const target = this.getFeature(p.targetFeatureId);
      if (!target?.solid) throw new Error('Shell target has no solid');
      return DirectEdit.shell(target.solid, p.removeFaceIds, p.thickness);
    });
  }

  addDeleteFace(targetFeatureId, faceId) {
    return this._addFeature('delete_face', { targetFeatureId, faceId }, (p) => {
      const target = this.getFeature(p.targetFeatureId);
      if (!target?.solid) throw new Error('Delete face target has no solid');
      return DirectEdit.deleteFace(target.solid, p.faceId);
    });
  }

  _addBooleanFeature(type, featureIdA, featureIdB, boolOp) {
    const featureA = this.getFeature(featureIdA);
    const featureB = this.getFeature(featureIdB);
    if (!featureA || !featureB) throw new Error('Boolean requires two valid features');
    if (!featureA.solid || !featureB.solid) throw new Error('Boolean requires features with computed solids');

    return this._addFeature(type, { featureIdA, featureIdB }, () => {
      const a = this.getFeature(featureIdA);
      const b = this.getFeature(featureIdB);
      return boolOp(a.solid, b.solid);
    });
  }

  // --- Feature Management ---

  _addFeature(type, params, operation) {
    this._saveUndo();
    const feature = new Feature(type, params, operation);

    // Link to previous feature
    if (this.features.length > 0) {
      const last = this.features[this.features.length - 1];
      feature.parent = last;
      last.children.push(feature);
    }

    this.features.push(feature);

    // Evaluate
    try {
      feature.solid = feature.operation(feature.params);
      feature.errors = [];
      this.currentSolid = feature.solid;
    } catch (err) {
      feature.errors.push(err.message);
      console.error(`Feature ${feature.name} failed:`, err);
    }

    this._notify('featureAdded', feature);
    return feature;
  }

  removeFeature(featureId) {
    this._saveUndo();
    const idx = this.features.findIndex(f => f.id === featureId);
    if (idx === -1) return false;

    const feature = this.features[idx];

    // Unlink
    if (feature.parent) {
      feature.parent.children = feature.parent.children.filter(c => c !== feature);
    }

    // Reparent children
    for (const child of feature.children) {
      child.parent = feature.parent;
      if (feature.parent) feature.parent.children.push(child);
    }

    this.features.splice(idx, 1);
    this.regenerate();
    this._notify('featureRemoved', feature);
    return true;
  }

  suppressFeature(featureId, suppressed = true) {
    const feature = this.features.find(f => f.id === featureId);
    if (!feature) return false;
    this._saveUndo();
    feature.suppressed = suppressed;
    this.regenerate();
    this._notify('featureSuppressed', feature);
    return true;
  }

  updateFeatureParam(featureId, key, value) {
    const feature = this.features.find(f => f.id === featureId);
    if (!feature) return false;
    this._saveUndo();
    feature.updateParam(key, value);
    this.regenerateFrom(feature);
    this._notify('featureUpdated', feature);
    return true;
  }

  reorderFeature(featureId, newIndex) {
    this._saveUndo();
    const idx = this.features.findIndex(f => f.id === featureId);
    if (idx === -1 || newIndex < 0 || newIndex >= this.features.length) return false;
    const [feature] = this.features.splice(idx, 1);
    this.features.splice(newIndex, 0, feature);
    this._relinkAll();
    this.regenerate();
    this._notify('featureReordered', feature);
    return true;
  }

  // --- Regeneration ---

  regenerate() {
    this.currentSolid = null;
    for (const feature of this.features) {
      if (feature.suppressed) continue;
      try {
        feature.solid = feature.operation(feature.params);
        feature.errors = [];
        this.currentSolid = feature.solid;
      } catch (err) {
        feature.errors.push(err.message);
      }
    }
    this._notify('regenerated', null);
  }

  regenerateFrom(startFeature) {
    const idx = this.features.indexOf(startFeature);
    if (idx === -1) return;

    for (let i = idx; i < this.features.length; i++) {
      const feature = this.features[i];
      if (feature.suppressed) continue;
      try {
        feature.solid = feature.operation(feature.params);
        feature.errors = [];
        this.currentSolid = feature.solid;
      } catch (err) {
        feature.errors.push(err.message);
      }
    }
    this._notify('regenerated', startFeature);
  }

  _relinkAll() {
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i];
      f.parent = i > 0 ? this.features[i - 1] : null;
      f.children = i < this.features.length - 1 ? [this.features[i + 1]] : [];
    }
  }

  // --- Undo / Redo ---

  _saveUndo() {
    this.undoStack.push(this._snapshot());
    this.redoStack = [];
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
    this.regenerate();
    this._notify('undo', null);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
    this.regenerate();
    this._notify('redo', null);
    return true;
  }

  _snapshot() {
    return this.features.map(f => ({
      id: f.id,
      type: f.type,
      params: JSON.parse(JSON.stringify(f.params, (key, val) => {
        if (val instanceof Vec3) return { _vec3: true, x: val.x, y: val.y, z: val.z };
        return val;
      })),
      suppressed: f.suppressed,
      name: f.name,
    }));
  }

  _restore(snapshot) {
    // Rebuild features from snapshot — operations are recreated from type
    this.features = snapshot.map(s => {
      const params = JSON.parse(JSON.stringify(s.params), (key, val) => {
        if (val && val._vec3) return new Vec3(val.x, val.y, val.z);
        return val;
      });
      const operation = this._operationForType(s.type);
      const f = new Feature(s.type, params, operation);
      f.id = s.id;
      f.suppressed = s.suppressed;
      f.name = s.name;
      return f;
    });
    this._relinkAll();
  }

  _operationForType(type) {
    const ops = {
      box: (p) => PrimitiveBuilder.box(p.width, p.height, p.depth, p.center),
      cylinder: (p) => PrimitiveBuilder.cylinder(p.radius, p.height, p.segments, p.center),
      sphere: (p) => PrimitiveBuilder.sphere(p.radius, p.widthSegments, p.heightSegments, p.center),
      cone: (p) => PrimitiveBuilder.cone(p.radius, p.height, p.segments, p.center),
      torus: (p) => PrimitiveBuilder.torus(p.majorRadius, p.minorRadius, p.majorSegments, p.minorSegments, p.center),
      extrude: (p) => ExtrudeFeature.extrude(p.profilePoints, p.direction, p.distance, p),
      revolve: (p) => RevolveFeature.revolve(p.profilePoints, p.axisOrigin, p.axisDirection, p.sweepAngle, p.segments),
      boolean_union: (p) => BooleanEngine.union(this.getFeature(p.featureIdA).solid, this.getFeature(p.featureIdB).solid),
      boolean_subtract: (p) => BooleanEngine.subtract(this.getFeature(p.featureIdA).solid, this.getFeature(p.featureIdB).solid),
      boolean_intersect: (p) => BooleanEngine.intersect(this.getFeature(p.featureIdA).solid, this.getFeature(p.featureIdB).solid),
      loft: (p) => LoftSweep.loft(p.profiles, p.steps, p.closed),
      sweep: (p) => LoftSweep.sweep(p.profile, p.pathPoints, p.closedPath),
      fillet: (p) => FilletChamfer.fillet(this.getFeature(p.targetFeatureId).solid, p.edgeIds, p.radius, p.segments),
      chamfer: (p) => FilletChamfer.chamfer(this.getFeature(p.targetFeatureId).solid, p.edgeIds, p.distance),
      pushpull: (p) => DirectEdit.pushPull(this.getFeature(p.targetFeatureId).solid, p.faceId, p.distance),
      shell: (p) => DirectEdit.shell(this.getFeature(p.targetFeatureId).solid, p.removeFaceIds, p.thickness),
      delete_face: (p) => DirectEdit.deleteFace(this.getFeature(p.targetFeatureId).solid, p.faceId),
    };
    return ops[type] || (() => { throw new Error(`Unknown feature type: ${type}`); });
  }

  // --- Query ---

  getFeature(id) { return this.features.find(f => f.id === id); }
  getFeatureByName(name) { return this.features.find(f => f.name === name); }
  getSolid() { return this.currentSolid; }

  toJSON() {
    return {
      features: this.features.map(f => ({
        id: f.id,
        type: f.type,
        name: f.name,
        params: f.params,
        suppressed: f.suppressed,
        errors: f.errors,
      }))
    };
  }

  // --- Event Listeners ---

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify(event, data) {
    for (const listener of this.listeners) {
      listener(event, data);
    }
  }
}
