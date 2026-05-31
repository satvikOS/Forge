/**
 * ArchDisc Geometry Kernel — Topological Shell
 * A shell is a connected set of faces forming a closed or open surface.
 * A closed shell defines a solid volume.
 */

import Vec3 from '../math/Vec3.js';
import BBox3 from '../math/BBox3.js';

let _shellId = 0;

export default class TopoShell {
  constructor(faces = []) {
    this.id = ++_shellId;
    this.type = 'shell';
    this.faces = new Set(faces);
    this.solid = null; // parent solid
    this.tag = 0;
    this.userData = {};

    for (const face of faces) {
      face.shell = this;
    }
  }

  addFace(face) {
    this.faces.add(face);
    face.shell = this;
  }

  removeFace(face) {
    this.faces.delete(face);
    face.shell = null;
  }

  vertices() {
    const verts = new Set();
    for (const face of this.faces) {
      for (const v of face.vertices()) verts.add(v);
    }
    return [...verts];
  }

  edges() {
    const edges = new Set();
    for (const face of this.faces) {
      for (const e of face.edges()) edges.add(e);
    }
    return [...edges];
  }

  isClosed() {
    for (const edge of this.edges()) {
      if (edge.isBoundary()) return false;
    }
    return true;
  }

  isManifold() {
    for (const edge of this.edges()) {
      if (!edge.isManifold()) return false;
    }
    return true;
  }

  eulerCharacteristic() {
    const V = this.vertices().length;
    const E = this.edges().length;
    const F = this.faces.size;
    return V - E + F; // Should be 2 for a closed manifold (sphere topology)
  }

  boundingBox() {
    const box = BBox3.empty();
    for (const v of this.vertices()) {
      box.expandByPoint(v.point);
    }
    return box;
  }

  surfaceArea() {
    let area = 0;
    for (const face of this.faces) {
      area += face.area();
    }
    return area;
  }

  // Approximate volume using divergence theorem (only valid for closed shells)
  volume() {
    if (!this.isClosed()) return 0;
    let vol = 0;
    for (const face of this.faces) {
      const verts = face.outerLoop ? face.outerLoop.orderedPoints() : [];
      if (verts.length < 3) continue;
      // Fan triangulation from first vertex
      const v0 = verts[0];
      for (let i = 1; i < verts.length - 1; i++) {
        const v1 = verts[i];
        const v2 = verts[i + 1];
        // Signed volume of tetrahedron with origin
        vol += v0.dot(v1.cross(v2)) / 6.0;
      }
    }
    return Math.abs(vol);
  }

  centroid() {
    const verts = this.vertices();
    if (verts.length === 0) return Vec3.zero();
    let sum = Vec3.zero();
    for (const v of verts) sum = sum.add(v.point);
    return sum.div(verts.length);
  }

  toString() {
    return `Shell#${this.id}(${this.faces.size} faces, ${this.isClosed() ? 'closed' : 'open'})`;
  }
}

export function resetShellIds() { _shellId = 0; }
