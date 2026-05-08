/**
 * ArchDisc Geometry Kernel — STEP Exporter (ISO 10303-21)
 * Exports B-Rep topology as STEP AP214 format.
 * This is a simplified but valid STEP writer for solid geometry.
 */

export default class STEPExporter {

  /**
   * Export a TopoSolid as STEP AP214.
   * @param {TopoSolid} solid
   * @param {string} name
   * @returns {string} STEP file content
   */
  static toSTEP(solid, name = 'ArchDisc_Part') {
    const writer = new STEPWriter();
    writer.writeHeader(name);
    writer.writeSolid(solid, name);
    writer.writeFooter();
    return writer.toString();
  }
}

class STEPWriter {
  constructor() {
    this.lines = [];
    this.entityId = 0;
    this.entityMap = new Map(); // object → entity ID
  }

  nextId() { return ++this.entityId; }

  addEntity(type, ...args) {
    const id = this.nextId();
    const argStr = args.join(',');
    this.lines.push(`#${id}=${type}(${argStr});`);
    return id;
  }

  writeHeader(name) {
    const now = new Date().toISOString().replace(/[:-]/g, '').split('.')[0];
    this.lines.push('ISO-10303-21;');
    this.lines.push('HEADER;');
    this.lines.push(`FILE_DESCRIPTION(('ArchDisc Geometry Kernel Export'),'2;1');`);
    this.lines.push(`FILE_NAME('${name}.step','${now}',('ArchDisc'),('ArchDisc Inc'),'ArchDisc Kernel 1.0','ArchDisc','');`);
    this.lines.push(`FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`);
    this.lines.push('ENDSEC;');
    this.lines.push('DATA;');
  }

  writeFooter() {
    this.lines.push('ENDSEC;');
    this.lines.push('END-ISO-10303-21;');
  }

  writeSolid(solid, name) {
    // Application context
    const appCtx = this.addEntity('APPLICATION_CONTEXT', `'automotive design'`);
    const appProto = this.addEntity('APPLICATION_PROTOCOL_DEFINITION', `'international standard'`, `'automotive_design'`, `2009`, `#${appCtx}`);

    // Product
    const prodCtx = this.addEntity('PRODUCT_CONTEXT', `''`, `#${appCtx}`, `'mechanical'`);
    const product = this.addEntity('PRODUCT', `'${name}'`, `'${name}'`, `''`, `(#${prodCtx})`);
    const prodDefFormation = this.addEntity('PRODUCT_DEFINITION_FORMATION', `''`, `''`, `#${product}`);
    const prodDefCtx = this.addEntity('PRODUCT_DEFINITION_CONTEXT', `'design'`, `#${appCtx}`, `'design'`);
    const prodDef = this.addEntity('PRODUCT_DEFINITION', `'design'`, `''`, `#${prodDefFormation}`, `#${prodDefCtx}`);

    // Shape
    const prodDefShape = this.addEntity('PRODUCT_DEFINITION_SHAPE', `''`, `''`, `#${prodDef}`);

    // Geometry context
    const geoCtx = this.addEntity('(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#0)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#0,#0,#0)) REPRESENTATION_CONTEXT', `'Context3D'`, `''`);

    // Write geometry
    const brepId = this.writeBRep(solid);

    // Shape representation
    const shapeRep = this.addEntity('SHAPE_REPRESENTATION', `'${name}'`, `(#${brepId})`, `#${geoCtx}`);
    this.addEntity('SHAPE_DEFINITION_REPRESENTATION', `#${prodDefShape}`, `#${shapeRep}`);
  }

  writeBRep(solid) {
    // Write all vertices
    const vertexIds = new Map();
    for (const vertex of solid.vertices()) {
      const ptId = this.addEntity('CARTESIAN_POINT', `''`, `(${vertex.point.x},${vertex.point.y},${vertex.point.z})`);
      const vpId = this.addEntity('VERTEX_POINT', `''`, `#${ptId}`);
      vertexIds.set(vertex.id, vpId);
    }

    // Write all edges
    const edgeIds = new Map();
    for (const edge of solid.edges()) {
      const startVp = vertexIds.get(edge.startVertex.id);
      const endVp = vertexIds.get(edge.endVertex.id);

      // Edge curve — line
      const startPt = this.addEntity('CARTESIAN_POINT', `''`,
        `(${edge.startVertex.point.x},${edge.startVertex.point.y},${edge.startVertex.point.z})`);
      const dir = edge.endVertex.point.sub(edge.startVertex.point);
      const len = dir.length();
      const normDir = len > 1e-10 ? dir.div(len) : { x: 0, y: 0, z: 1 };
      const dirId = this.addEntity('DIRECTION', `''`, `(${normDir.x},${normDir.y},${normDir.z})`);
      const vecId = this.addEntity('VECTOR', `''`, `#${dirId}`, `${len}`);
      const lineId = this.addEntity('LINE', `''`, `#${startPt}`, `#${vecId}`);

      const edgeCurveId = this.addEntity('EDGE_CURVE', `''`, `#${startVp}`, `#${endVp}`, `#${lineId}`, `.T.`);
      edgeIds.set(edge.id, edgeCurveId);
    }

    // Write faces
    const faceIds = [];
    for (const face of solid.faces()) {
      if (!face.outerLoop) continue;

      // Surface — plane
      const centroid = face.centroid();
      const rawNormal = face.outerLoop.computeNormal();
      const normal = { x: rawNormal.x, y: rawNormal.y, z: rawNormal.z };

      const locationPt = this.addEntity('CARTESIAN_POINT', `''`, `(${centroid.x},${centroid.y},${centroid.z})`);
      const axisDir = this.addEntity('DIRECTION', `''`, `(${normal.x},${normal.y},${normal.z})`);

      // Ref direction (perpendicular to normal)
      let refX, refY, refZ;
      if (Math.abs(normal.z) < 0.9) {
        const cross = { x: -normal.y, y: normal.x, z: 0 };
        const len = Math.sqrt(cross.x * cross.x + cross.y * cross.y);
        refX = cross.x / len; refY = cross.y / len; refZ = 0;
      } else {
        refX = 1; refY = 0; refZ = 0;
      }
      const refDir = this.addEntity('DIRECTION', `''`, `(${refX},${refY},${refZ})`);

      const axis2 = this.addEntity('AXIS2_PLACEMENT_3D', `''`, `#${locationPt}`, `#${axisDir}`, `#${refDir}`);
      const planeId = this.addEntity('PLANE', `''`, `#${axis2}`);

      // Oriented edges for the loop
      const orientedEdges = [];
      for (const he of face.outerLoop.halfEdges) {
        const ecId = edgeIds.get(he.edge.id);
        if (ecId) {
          const oeId = this.addEntity('ORIENTED_EDGE', `''`, `*`, `*`, `#${ecId}`, `${he.reversed ? '.F.' : '.T.'}`);
          orientedEdges.push(`#${oeId}`);
        }
      }

      if (orientedEdges.length === 0) continue;

      const edgeLoopId = this.addEntity('EDGE_LOOP', `''`, `(${orientedEdges.join(',')})`);
      const faceBoundId = this.addEntity('FACE_OUTER_BOUND', `''`, `#${edgeLoopId}`, `.T.`);
      const advFaceId = this.addEntity('ADVANCED_FACE', `''`, `(#${faceBoundId})`, `#${planeId}`, `${face.reversed ? '.F.' : '.T.'}`);
      faceIds.push(`#${advFaceId}`);
    }

    // Closed shell
    const shellId = this.addEntity('CLOSED_SHELL', `''`, `(${faceIds.join(',')})`);

    // Manifold solid
    const solidId = this.addEntity('MANIFOLD_SOLID_BREP', `''`, `#${shellId}`);

    return solidId;
  }

  toString() {
    return this.lines.join('\n');
  }
}
