/**
 * ArchDisc Geometry Kernel — Topological Edge
 * An edge is a 1D topological entity bounded by two vertices.
 * It carries a geometric curve and connects to faces.
 */

let _edgeId = 0;

export default class TopoEdge {
  constructor(startVertex, endVertex, curve) {
    this.id = ++_edgeId;
    this.type = 'edge';
    this.startVertex = startVertex;
    this.endVertex = endVertex;
    this.curve = curve;     // LineCurve, ArcCurve, NurbsCurve, or null
    this.faces = new Set(); // faces that reference this edge
    this.tag = 0;
    this.userData = {};

    // Register with vertices
    startVertex.addEdge(this);
    endVertex.addEdge(this);
  }

  midpoint() {
    if (this.curve) return this.curve.pointAt(0.5);
    return this.startVertex.point.lerp(this.endVertex.point, 0.5);
  }

  length() {
    if (this.curve) return this.curve.length();
    return this.startVertex.point.distanceTo(this.endVertex.point);
  }

  tangentAtStart() {
    if (this.curve) return this.curve.tangentAt(0);
    return this.endVertex.point.sub(this.startVertex.point).normalize();
  }

  tangentAtEnd() {
    if (this.curve) return this.curve.tangentAt(1);
    return this.endVertex.point.sub(this.startVertex.point).normalize();
  }

  otherVertex(v) {
    if (v === this.startVertex) return this.endVertex;
    if (v === this.endVertex) return this.startVertex;
    return null;
  }

  hasVertex(v) {
    return v === this.startVertex || v === this.endVertex;
  }

  isBoundary() {
    return this.faces.size < 2;
  }

  isManifold() {
    return this.faces.size === 2;
  }

  addFace(face) { this.faces.add(face); }
  removeFace(face) { this.faces.delete(face); }

  reverse() {
    const tmp = this.startVertex;
    this.startVertex = this.endVertex;
    this.endVertex = tmp;
    if (this.curve) this.curve = this.curve.reverse();
    return this;
  }

  tessellate(segments) {
    if (this.curve) return this.curve.tessellate(segments);
    return [this.startVertex.point.clone(), this.endVertex.point.clone()];
  }

  detach() {
    this.startVertex.removeEdge(this);
    this.endVertex.removeEdge(this);
    for (const face of this.faces) {
      face.removeEdge(this);
    }
    this.faces.clear();
  }

  toString() { return `Edge#${this.id}(V${this.startVertex.id}→V${this.endVertex.id})`; }
}

export function resetEdgeIds() { _edgeId = 0; }
