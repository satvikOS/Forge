/**
 * ArchDisc Geometry Kernel — Topological Face
 * A face is a 2D topological entity bounded by loops (wires).
 * It references an underlying geometric surface.
 */

import Vec3 from '../math/Vec3.js';

let _faceId = 0;

export default class TopoFace {
  constructor(surface, outerLoop, innerLoops = []) {
    this.id = ++_faceId;
    this.type = 'face';
    this.surface = surface;         // PlanarSurface, CylindricalSurface, etc.
    this.outerLoop = outerLoop;     // TopoLoop
    this.innerLoops = innerLoops;   // TopoLoop[] (holes)
    this.shell = null;              // parent shell
    this.reversed = false;          // true if face normal is flipped relative to surface
    this.tag = 0;
    this.userData = {};

    // Link loops to face
    if (outerLoop) {
      outerLoop.face = this;
      outerLoop.isOuter = true;
    }
    for (const loop of innerLoops) {
      loop.face = this;
      loop.isOuter = false;
    }

    // Register with edges
    for (const loop of this.allLoops()) {
      for (const he of loop.halfEdges) {
        he.edge.addFace(this);
      }
    }
  }

  allLoops() {
    const loops = [];
    if (this.outerLoop) loops.push(this.outerLoop);
    loops.push(...this.innerLoops);
    return loops;
  }

  vertices() {
    const verts = new Set();
    for (const loop of this.allLoops()) {
      for (const v of loop.vertices()) verts.add(v);
    }
    return [...verts];
  }

  edges() {
    const edges = new Set();
    for (const loop of this.allLoops()) {
      for (const he of loop.halfEdges) edges.add(he.edge);
    }
    return [...edges];
  }

  adjacentFaces() {
    const faces = new Set();
    for (const edge of this.edges()) {
      for (const face of edge.faces) {
        if (face !== this) faces.add(face);
      }
    }
    return [...faces];
  }

  normal(u, v) {
    if (this.surface) {
      const n = this.surface.normalAt(u, v);
      return this.reversed ? n.negate() : n;
    }
    // Fallback: compute from outer loop
    if (this.outerLoop) {
      const n = this.outerLoop.computeNormal();
      return this.reversed ? n.negate() : n;
    }
    return Vec3.unitZ();
  }

  centroid() {
    const verts = this.outerLoop ? this.outerLoop.orderedPoints() : [];
    if (verts.length === 0) return Vec3.zero();
    let sum = Vec3.zero();
    for (const v of verts) sum = sum.add(v);
    return sum.div(verts.length);
  }

  area() {
    if (!this.outerLoop) return 0;
    const normal = this.outerLoop.computeNormal();
    let area = Math.abs(this.outerLoop.signedArea(normal));
    for (const inner of this.innerLoops) {
      area -= Math.abs(inner.signedArea(normal));
    }
    return area;
  }

  removeEdge(edge) {
    for (const loop of this.allLoops()) {
      const idx = loop.halfEdges.findIndex(he => he.edge === edge);
      if (idx !== -1) loop.halfEdges.splice(idx, 1);
    }
  }

  flip() {
    this.reversed = !this.reversed;
    if (this.outerLoop) this.outerLoop.reverse();
    for (const loop of this.innerLoops) loop.reverse();
    return this;
  }

  detach() {
    for (const edge of this.edges()) {
      edge.removeFace(this);
    }
    if (this.shell) {
      this.shell.removeFace(this);
    }
  }

  toString() {
    return `Face#${this.id}(${this.vertices().length} verts, ${this.edges().length} edges, ${this.innerLoops.length} holes)`;
  }
}

export function resetFaceIds() { _faceId = 0; }
