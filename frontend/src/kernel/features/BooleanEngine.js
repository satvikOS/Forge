/**
 * ArchDisc Geometry Kernel — Boolean Engine
 * CSG (Constructive Solid Geometry) operations on B-Rep solids.
 * Implements union, subtract, and intersect using BSP tree approach.
 *
 * Algorithm: Convert solid faces to BSP polygons, perform CSG,
 * rebuild B-Rep topology from result.
 */

import Vec3, { EPSILON } from '../math/Vec3.js';
import { LineCurve } from '../math/Curve.js';
import { PlanarSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

// --- BSP Polygon ---
class CSGPolygon {
  constructor(vertices, normal, shared = {}) {
    this.vertices = vertices; // Array of { pos: Vec3, normal: Vec3 }
    this.normal = normal;
    this.shared = shared; // face metadata
  }

  clone() {
    return new CSGPolygon(
      this.vertices.map(v => ({ pos: v.pos.clone(), normal: v.normal.clone() })),
      this.normal.clone(),
      { ...this.shared }
    );
  }

  flip() {
    this.vertices.reverse();
    for (const v of this.vertices) v.normal = v.normal.negate();
    this.normal = this.normal.negate();
  }

  plane() {
    return new CSGPlane(this.normal.clone(), this.normal.dot(this.vertices[0].pos));
  }
}

// --- BSP Plane ---
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

class CSGPlane {
  constructor(normal, w) {
    this.normal = normal;
    this.w = w;
  }

  clone() { return new CSGPlane(this.normal.clone(), this.w); }

  flip() {
    this.normal = this.normal.negate();
    this.w = -this.w;
  }

  classifyVertex(v) {
    const t = this.normal.dot(v) - this.w;
    if (t < -EPSILON) return BACK;
    if (t > EPSILON) return FRONT;
    return COPLANAR;
  }

  classifyPolygon(polygon) {
    let type = 0;
    for (const v of polygon.vertices) {
      type |= this.classifyVertex(v.pos);
    }
    return type;
  }

  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const polyType = this.classifyPolygon(polygon);

    switch (polyType) {
      case COPLANAR:
        if (this.normal.dot(polygon.normal) > 0) {
          coplanarFront.push(polygon);
        } else {
          coplanarBack.push(polygon);
        }
        break;

      case FRONT:
        front.push(polygon);
        break;

      case BACK:
        back.push(polygon);
        break;

      case SPANNING: {
        const f = [], b = [];
        const verts = polygon.vertices;

        for (let i = 0; i < verts.length; i++) {
          const j = (i + 1) % verts.length;
          const ti = this.classifyVertex(verts[i].pos);
          const tj = this.classifyVertex(verts[j].pos);
          const vi = verts[i];
          const vj = verts[j];

          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);

          if ((ti | tj) === SPANNING) {
            // Compute intersection point
            const t = (this.w - this.normal.dot(vi.pos)) /
                      this.normal.dot(vj.pos.sub(vi.pos));
            const v = {
              pos: vi.pos.lerp(vj.pos, t),
              normal: vi.normal.lerp(vj.normal, t).normalize(),
            };
            f.push(v);
            b.push({ pos: v.pos.clone(), normal: v.normal.clone() });
          }
        }

        if (f.length >= 3) front.push(new CSGPolygon(f, polygon.normal.clone(), polygon.shared));
        if (b.length >= 3) back.push(new CSGPolygon(b, polygon.normal.clone(), polygon.shared));
        break;
      }
    }
  }
}

// --- BSP Node ---
class CSGNode {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];

    if (polygons && polygons.length > 0) {
      this.build(polygons);
    }
  }

  clone() {
    const node = new CSGNode();
    node.plane = this.plane ? this.plane.clone() : null;
    node.front = this.front ? this.front.clone() : null;
    node.back = this.back ? this.back.clone() : null;
    node.polygons = this.polygons.map(p => p.clone());
    return node;
  }

  invert() {
    for (const p of this.polygons) p.flip();
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    // Swap front and back
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }

  clipPolygons(polygons) {
    if (!this.plane) return [...polygons];

    let front = [], back = [];
    for (const p of polygons) {
      this.plane.splitPolygon(p, front, back, front, back);
    }

    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];

    return [...front, ...back];
  }

  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  allPolygons() {
    let polygons = [...this.polygons];
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }

  build(polygons) {
    if (polygons.length === 0) return;

    if (!this.plane) {
      this.plane = polygons[0].plane();
    }

    const front = [], back = [];

    for (const p of polygons) {
      this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
    }

    if (front.length > 0) {
      if (!this.front) this.front = new CSGNode();
      this.front.build(front);
    }

    if (back.length > 0) {
      if (!this.back) this.back = new CSGNode();
      this.back.build(back);
    }
  }
}

// --- Boolean Engine ---
export default class BooleanEngine {

  /**
   * Union: A + B — combine two solids.
   * @param {TopoSolid} solidA
   * @param {TopoSolid} solidB
   * @returns {TopoSolid}
   */
  static union(solidA, solidB) {
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB));

    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Union');
  }

  /**
   * Subtract: A - B — cut B from A.
   * @param {TopoSolid} solidA
   * @param {TopoSolid} solidB
   * @returns {TopoSolid}
   */
  static subtract(solidA, solidB) {
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB));

    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Subtract');
  }

  /**
   * Intersect: A ∩ B — keep only overlapping region.
   * @param {TopoSolid} solidA
   * @param {TopoSolid} solidB
   * @returns {TopoSolid}
   */
  static intersect(solidA, solidB) {
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB));

    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Intersect');
  }

  // --- Conversion: TopoSolid → CSGPolygons ---
  static _solidToPolygons(solid) {
    const polygons = [];

    for (const face of solid.faces()) {
      const outerPts = face.outerLoop ? face.outerLoop.orderedPoints() : [];
      if (outerPts.length < 3) continue;

      const normal = face.outerLoop.computeNormal();
      const faceNormal = face.reversed
        ? new Vec3(-normal.x, -normal.y, -normal.z)
        : new Vec3(normal.x, normal.y, normal.z);

      // Fan triangulation for robust BSP
      for (let i = 1; i < outerPts.length - 1; i++) {
        const verts = [
          { pos: outerPts[0].clone(), normal: faceNormal.clone() },
          { pos: outerPts[i].clone(), normal: faceNormal.clone() },
          { pos: outerPts[i + 1].clone(), normal: faceNormal.clone() },
        ];
        polygons.push(new CSGPolygon(verts, faceNormal.clone(), { faceId: face.id }));
      }
    }

    return polygons;
  }

  // --- Conversion: CSGPolygons → TopoSolid ---
  static _polygonsToSolid(polygons, name) {
    const faces = [];
    const vertexCache = new Map(); // "x,y,z" → TopoVertex

    const getOrCreateVertex = (pos) => {
      const key = `${pos.x.toFixed(8)},${pos.y.toFixed(8)},${pos.z.toFixed(8)}`;
      if (vertexCache.has(key)) return vertexCache.get(key);
      const v = new TopoVertex(pos);
      vertexCache.set(key, v);
      return v;
    };

    for (const poly of polygons) {
      if (poly.vertices.length < 3) continue;

      const verts = poly.vertices.map(v => getOrCreateVertex(v.pos));

      // Create edges
      const halfEdges = [];
      for (let i = 0; i < verts.length; i++) {
        const next = (i + 1) % verts.length;
        const edge = new TopoEdge(
          verts[i], verts[next],
          new LineCurve(verts[i].point, verts[next].point)
        );
        halfEdges.push({ edge, reversed: false });
      }

      const loop = new TopoLoop(halfEdges);
      const faceNormal = poly.normal;
      const surface = PlanarSurface.fromPlane(
        Plane.fromNormalAndPoint(faceNormal, verts[0].point)
      );

      faces.push(new TopoFace(surface, loop));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = name;
    solid.userData.featureType = 'boolean';
    return solid;
  }
}
