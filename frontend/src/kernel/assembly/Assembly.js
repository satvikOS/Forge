/**
 * ArchDisc Geometry Kernel — Assembly System
 * Multi-body management with constraints (mates) between parts.
 * Each assembly tracks parts, their transforms, and constraint relationships.
 */

import Vec3 from '../math/Vec3.js';
import Mat4 from '../math/Mat4.js';
import BBox3 from '../math/BBox3.js';
import PartIDRegistry from '../registry/PartIDRegistry.js';

let _assemblyId = 0;
let _partInstanceId = 0;

export class PartInstance {
  constructor(solid, name, transform) {
    this.id = ++_partInstanceId;
    this.solid = solid;
    this.name = name || solid.name || `Part_${this.id}`;
    this.position = transform?.position || Vec3.zero();
    this.rotation = transform?.rotation || Vec3.zero(); // euler XYZ in radians
    this.scale = transform?.scale || new Vec3(1, 1, 1);
    this.color = transform?.color || 0x8b1538;
    this.visible = true;
    this.fixed = false; // if true, cannot be moved by solver
    this.material = transform?.material || 'Aluminum 6061-T6';
    this.threeGroup = null; // set by viewport
    this.mates = []; // constraints referencing this part
    this.metadata = {};
  }

  getTransformMatrix() {
    const t = Mat4.translation(this.position.x, this.position.y, this.position.z);
    const rx = Mat4.rotationX(this.rotation.x);
    const ry = Mat4.rotationY(this.rotation.y);
    const rz = Mat4.rotationZ(this.rotation.z);
    const s = Mat4.scaling(this.scale.x, this.scale.y, this.scale.z);
    return t.multiply(rz).multiply(ry).multiply(rx).multiply(s);
  }

  boundingBox() {
    if (!this.solid) return BBox3.empty();
    return this.solid.boundingBox().transform(this.getTransformMatrix());
  }

  massProperties() {
    if (!this.solid) return { mass: 0, volume: 0 };
    return this.solid.massProperties();
  }

  clone() {
    const inst = new PartInstance(this.solid, this.name + '_copy', {
      position: this.position.clone(),
      rotation: this.rotation.clone(),
      scale: this.scale.clone(),
      color: this.color,
      material: this.material,
    });
    return inst;
  }
}

export class Mate {
  constructor(type, partA, partB, params = {}) {
    this.id = ++_assemblyId;
    this.type = type; // 'coincident', 'concentric', 'distance', 'angle', 'tangent', 'fixed'
    this.partA = partA;
    this.partB = partB;
    this.params = params; // { distance, angle, faceIdA, faceIdB, axisA, axisB }
    this.satisfied = false;
    this.error = 0;
  }
}

export default class Assembly {
  constructor(name = 'Assembly') {
    this.id = ++_assemblyId;
    this.name = name;
    this.parts = []; // PartInstance[]
    this.mates = []; // Mate[]
    this.subAssemblies = []; // nested Assembly[]
    this.listeners = new Set();
  }

  // --- Part Management ---

  addPart(solid, name, transform) {
    const part = new PartInstance(solid, name, transform);
    this.parts.push(part);
    if (transform?.registerID !== false) {
      PartIDRegistry.register({
        category: transform?.category || 'GEN',
        subsystem: transform?.subsystem || 'PRT',
        name: part.name,
        material: part.material,
        parentID: transform?.parentID || null,
        metadata: transform?.metadata || {},
        partInstance: part,
      });
    }
    this._notify('partAdded', part);
    return part;
  }

  removePart(partId) {
    const idx = this.parts.findIndex(p => p.id === partId);
    if (idx === -1) return false;
    const part = this.parts[idx];
    // Remove related mates
    this.mates = this.mates.filter(m => m.partA.id !== partId && m.partB.id !== partId);
    this.parts.splice(idx, 1);
    this._notify('partRemoved', part);
    return true;
  }

  getPart(partId) {
    return this.parts.find(p => p.id === partId);
  }

  movePart(partId, position) {
    const part = this.getPart(partId);
    if (!part) return;
    part.position = position;
    this._notify('partMoved', part);
  }

  rotatePart(partId, rotation) {
    const part = this.getPart(partId);
    if (!part) return;
    part.rotation = rotation;
    this._notify('partRotated', part);
  }

  // --- Mates ---

  addMate(type, partIdA, partIdB, params = {}) {
    const partA = this.getPart(partIdA);
    const partB = this.getPart(partIdB);
    if (!partA || !partB) throw new Error('Both parts must exist in assembly');
    const mate = new Mate(type, partA, partB, params);
    this.mates.push(mate);
    partA.mates.push(mate);
    partB.mates.push(mate);
    this._notify('mateAdded', mate);
    return mate;
  }

  removeMate(mateId) {
    const idx = this.mates.findIndex(m => m.id === mateId);
    if (idx === -1) return false;
    this.mates.splice(idx, 1);
    this._notify('mateRemoved', mateId);
    return true;
  }

  // --- Solver ---
  // Note: solve() and dof() defined externally to avoid circular import.
  // Use MateSolver.solve(assembly) and MateSolver.computeDOF(assembly).

  // --- Analysis ---

  totalMass() {
    return this.parts.reduce((sum, p) => sum + (p.massProperties().mass || 0), 0);
  }

  totalVolume() {
    return this.parts.reduce((sum, p) => sum + (p.massProperties().volume || 0), 0);
  }

  partCount() {
    return this.parts.length + this.subAssemblies.reduce((s, a) => s + a.partCount(), 0);
  }

  boundingBox() {
    const box = BBox3.empty();
    for (const p of this.parts) box.expandByBox(p.boundingBox());
    return box;
  }

  // Check for interferences between all parts
  interferenceCheck() {
    const results = [];
    for (let i = 0; i < this.parts.length; i++) {
      for (let j = i + 1; j < this.parts.length; j++) {
        const boxA = this.parts[i].boundingBox();
        const boxB = this.parts[j].boundingBox();
        if (boxA.intersectsBox(boxB)) {
          const overlap = boxA.intersection(boxB);
          if (!overlap.isEmpty() && overlap.volume() > 1e-6) {
            results.push({
              partA: this.parts[i],
              partB: this.parts[j],
              overlapVolume: overlap.volume(),
            });
          }
        }
      }
    }
    return results;
  }

  // Generate BOM
  generateBOM() {
    const bom = [];
    const countMap = new Map();
    for (const part of this.parts) {
      const key = part.solid?.name || part.name;
      if (countMap.has(key)) {
        countMap.get(key).qty++;
      } else {
        const entry = {
          item: bom.length + 1,
          name: key,
          material: part.material,
          qty: 1,
          mass: part.massProperties().mass,
          volume: part.massProperties().volume,
        };
        countMap.set(key, entry);
        bom.push(entry);
      }
    }
    return bom;
  }

  // Explode: offset all parts radially from center
  explode(factor = 2) {
    const center = this.boundingBox().center();
    const offsets = [];
    for (const part of this.parts) {
      const partCenter = part.boundingBox().center();
      const dir = partCenter.sub(center);
      const offset = dir.mul(factor);
      offsets.push({ partId: part.id, offset });
    }
    return offsets;
  }

  // --- Serialization ---

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      parts: this.parts.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position.toArray(),
        rotation: p.rotation.toArray(),
        color: p.color,
        material: p.material,
        solidName: p.solid?.name,
      })),
      mates: this.mates.map(m => ({
        id: m.id,
        type: m.type,
        partAId: m.partA.id,
        partBId: m.partB.id,
        params: m.params,
      })),
      totalMass: this.totalMass(),
      partCount: this.partCount(),
    };
  }

  // --- Events ---
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notify(event, data) {
    for (const cb of this.listeners) cb(event, data);
  }
}
