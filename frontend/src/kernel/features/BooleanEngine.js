/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel. Production booleans route through
 * kernel/brep/BrepBoolean.js (the OCCT BRepAlgoAPI_Fuse/Cut/Common path) and
 * produce SpineBodies via the unified topology spine in kernel/topology/.
 * This BSP-CSG implementation is NOT used by any ribbon op.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. See PrimitiveBuilder.js header for the
 * full quarantine context and the canonical replacement paths.
 *
 * ──────────────────────────────────────────────────────────────────────────
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
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA, 'A'));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB, 'B'));

    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Union', { solidA, solidB });
  }

  /**
   * Subtract: A - B — cut B from A.
   * @param {TopoSolid} solidA
   * @param {TopoSolid} solidB
   * @returns {TopoSolid}
   */
  static subtract(solidA, solidB) {
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA, 'A'));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB, 'B'));

    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Subtract', { solidA, solidB });
  }

  /**
   * Intersect: A ∩ B — keep only overlapping region.
   * @param {TopoSolid} solidA
   * @param {TopoSolid} solidB
   * @returns {TopoSolid}
   */
  static intersect(solidA, solidB) {
    const a = new CSGNode(BooleanEngine._solidToPolygons(solidA, 'A'));
    const b = new CSGNode(BooleanEngine._solidToPolygons(solidB, 'B'));

    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();

    return BooleanEngine._polygonsToSolid(a.allPolygons(), 'Intersect', { solidA, solidB });
  }

  // --- Conversion: TopoSolid → CSGPolygons ---
  static _solidToPolygons(solid, sourceTag = 'A') {
    const polygons = [];

    for (const face of solid.faces()) {
      const outerPts = face.outerLoop ? face.outerLoop.orderedPoints() : [];
      if (outerPts.length < 3) continue;

      const normal = face.outerLoop.computeNormal();
      const faceNormal = face.reversed
        ? new Vec3(-normal.x, -normal.y, -normal.z)
        : new Vec3(normal.x, normal.y, normal.z);

      // Fan triangulation for robust BSP — preserve source identity
      const shared = {
        sourceFaceId: face.id,
        sourceSolidId: solid.id,
        sourceTag, // 'A' or 'B'
        sourceFeatureType: solid.userData?.featureType,
      };

      for (let i = 1; i < outerPts.length - 1; i++) {
        const verts = [
          { pos: outerPts[0].clone(), normal: faceNormal.clone() },
          { pos: outerPts[i].clone(), normal: faceNormal.clone() },
          { pos: outerPts[i + 1].clone(), normal: faceNormal.clone() },
        ];
        polygons.push(new CSGPolygon(verts, faceNormal.clone(), { ...shared }));
      }
    }

    return polygons;
  }

  // --- Conversion: CSGPolygons → TopoSolid ---
  static _polygonsToSolid(polygons, name, sources = {}) {
    const faces = [];
    const vertexCache = new Map();

    // Track origin info for the resulting solid
    const sourceFaceMap = new Map(); // sourceFaceId → [new TopoFaces created from it]
    const sourceTagCounts = { A: 0, B: 0 };

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

      const newFace = new TopoFace(surface, loop);

      // Tag with source information from CSG metadata
      if (poly.shared) {
        if (!newFace.userData) newFace.userData = {};
        newFace.userData.sourceFaceId = poly.shared.sourceFaceId;
        newFace.userData.sourceSolidId = poly.shared.sourceSolidId;
        newFace.userData.sourceTag = poly.shared.sourceTag;
        newFace.userData.sourceFeatureType = poly.shared.sourceFeatureType;

        // Build sourceFaceMap
        const key = `${poly.shared.sourceTag}:${poly.shared.sourceFaceId}`;
        if (!sourceFaceMap.has(key)) sourceFaceMap.set(key, []);
        sourceFaceMap.get(key).push(newFace);

        if (poly.shared.sourceTag) sourceTagCounts[poly.shared.sourceTag]++;
      }

      faces.push(newFace);
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = name;
    solid.userData.featureType = 'boolean';

    // Track ID lineage on the resulting solid
    solid.userData.booleanInfo = {
      operation: name.toLowerCase(),
      sourceA: sources.solidA?.id,
      sourceB: sources.solidB?.id,
      faceCountFromA: sourceTagCounts.A,
      faceCountFromB: sourceTagCounts.B,
      sourceFaceMap, // for downstream queries
    };

    return solid;
  }

  /**
   * Query: which faces in a boolean result came from a specific source face?
   * @param {TopoSolid} resultSolid - Solid produced by union/subtract/intersect
   * @param {string} sourceTag - 'A' or 'B'
   * @param {number} sourceFaceId - Original face ID
   * @returns {TopoFace[]}
   */
  static getFacesFromSource(resultSolid, sourceTag, sourceFaceId) {
    const info = resultSolid.userData?.booleanInfo;
    if (!info) return [];
    return info.sourceFaceMap.get(`${sourceTag}:${sourceFaceId}`) || [];
  }

  /**
   * Query: list all faces in a boolean result with their source info.
   */
  static getFaceLineage(resultSolid) {
    const info = resultSolid.userData?.booleanInfo;
    if (!info) return null;
    return {
      operation: info.operation,
      sourceA: info.sourceA,
      sourceB: info.sourceB,
      faceCountFromA: info.faceCountFromA,
      faceCountFromB: info.faceCountFromB,
      faces: resultSolid.faces().map(f => ({
        faceId: f.id,
        sourceTag: f.userData?.sourceTag,
        sourceFaceId: f.userData?.sourceFaceId,
        sourceSolidId: f.userData?.sourceSolidId,
      })),
    };
  }
}
