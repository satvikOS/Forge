/**
 * ArchDisc Geometry Kernel — Topological Vertex
 * A vertex is a 0D topological entity with a 3D point.
 * It connects to edges via half-edges.
 */

let _vertexId = 0;

export default class TopoVertex {
  constructor(point) {
    this.id = ++_vertexId;
    this.type = 'vertex';
    this.point = point.clone();
    this.edges = new Set(); // edges that reference this vertex
    this.tag = 0;           // for algorithms (boolean ops, traversal)
    this.userData = {};
  }

  addEdge(edge) { this.edges.add(edge); }
  removeEdge(edge) { this.edges.delete(edge); }

  valence() { return this.edges.size; }

  connectedVertices() {
    const verts = new Set();
    for (const edge of this.edges) {
      if (edge.startVertex !== this) verts.add(edge.startVertex);
      if (edge.endVertex !== this) verts.add(edge.endVertex);
    }
    return [...verts];
  }

  connectedFaces() {
    const faces = new Set();
    for (const edge of this.edges) {
      for (const face of edge.faces) {
        faces.add(face);
      }
    }
    return [...faces];
  }

  clone(pointOverride) {
    return new TopoVertex(pointOverride || this.point);
  }

  toString() { return `Vertex#${this.id}(${this.point.x.toFixed(4)}, ${this.point.y.toFixed(4)}, ${this.point.z.toFixed(4)})`; }
}

export function resetVertexIds() { _vertexId = 0; }
