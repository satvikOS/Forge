/**
 * ArchDisc Foundation — STEP AP203 (ISO 10303-21) exporter.
 *
 * Emits a topology-correct STEP file from a manifold-3d Manifold:
 *   • Vertices deduplicated via coordinate map
 *   • Edges shared between adjacent triangles (oriented_edge with
 *     proper orientation flag)
 *   • Each triangle becomes a planar advanced_face
 *   • All faces aggregated into closed_shell → manifold_solid_brep
 *   • Wrapped in the standard product / context / shape chain
 *
 * Output is valid AP203 readable by Siemens NX, SolidWorks, Fusion 360,
 * Onshape, FreeCAD, OpenCascade, anything that can import AP203 / AP214.
 *
 * Limitations:
 *   • Faces are planar triangles — no NURBS / curved surfaces. To CAD
 *     systems the imported body looks tessellated, not smooth-faced.
 *     A future NURBS pass would re-fit smooth surfaces from the
 *     triangulation.
 *   • No GD&T / PMI metadata — geometry only.
 *
 * The header carries ISO 10303-21:2002 protocol with AP203 schema.
 */

let _entityId = 0;
function nextId() { return ++_entityId; }

class StepWriter {
  constructor() {
    this.lines = [];
  }
  emit(typeAndArgs) {
    const id = nextId();
    this.lines.push(`#${id}=${typeAndArgs};`);
    return id;
  }
  raw(line) { this.lines.push(line); }
  toString() { return this.lines.join('\n'); }
}

function fmtFloat(x) {
  if (!Number.isFinite(x)) throw new Error('non-finite coordinate');
  return x.toFixed(8).replace(/\.?0+$/, '') || '0';
}

/**
 * Compute outward normal for a triangle (assumes CCW vertex winding).
 */
function triNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Pick a "ref direction" (in-plane vector) that's not parallel to the
 * face normal. Used to form the local axis system for the face plane.
 */
function pickRefDir(normal) {
  const [nx, ny, nz] = normal;
  // Use the world axis least aligned with the normal.
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax <= ay && ax <= az) return [1, 0, 0];
  if (ay <= az) return [0, 1, 0];
  return [0, 0, 1];
}

/**
 * Project a vector onto the plane defined by `normal`, then normalize.
 */
function projectOntoPlane(vec, normal) {
  const dot = vec[0] * normal[0] + vec[1] * normal[1] + vec[2] * normal[2];
  const x = vec[0] - dot * normal[0];
  const y = vec[1] - dot * normal[1];
  const z = vec[2] - dot * normal[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Export a Manifold to a STEP AP203 string.
 *
 * @param {Manifold} manifold
 * @param {object} options
 * @param {string} options.name   - product name; default 'ArchDisc_Part'
 * @param {string} options.author - default 'ArchDisc'
 * @param {string} options.org    - organization name
 * @returns {string} STEP file contents
 */
export function manifoldToSTEP(manifold, options = {}) {
  _entityId = 0;
  const name = options.name ?? 'ArchDisc_Part';
  const author = options.author ?? 'ArchDisc';
  const org = options.org ?? 'ArchDisc Foundation';
  const sw = new StepWriter();

  // ---- Header ----
  sw.raw('ISO-10303-21;');
  sw.raw('HEADER;');
  sw.raw(`FILE_DESCRIPTION(('ArchDisc Foundation export'),'2;1');`);
  const ts = new Date().toISOString().slice(0, 19);
  sw.raw(`FILE_NAME('${name}.step','${ts}',('${author}'),('${org}'),'ArchDisc Foundation v1','manifold-3d ${'3.x'}','');`);
  sw.raw(`FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));`);
  sw.raw('ENDSEC;');
  sw.raw('DATA;');

  // ---- Get mesh data ----
  const mesh = manifold.getMesh();
  const numTri = mesh.triVerts.length / 3;
  const numProp = mesh.numProp;
  const verts = mesh.vertProperties;

  // ---- Application context + product ----
  const appContext = sw.emit(`APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')`);
  sw.emit(`APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,#${appContext})`);
  const productContext = sw.emit(`PRODUCT_CONTEXT('',#${appContext},'mechanical')`);
  const productDefContext = sw.emit(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design')`);
  const product = sw.emit(`PRODUCT('${name}','${name}','',(#${productContext}))`);
  const productDefFormation = sw.emit(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const productDef = sw.emit(`PRODUCT_DEFINITION('design','',#${productDefFormation},#${productDefContext})`);
  const productDefShape = sw.emit(`PRODUCT_DEFINITION_SHAPE('','',#${productDef})`);

  // Geometric context for the shape
  const lengthUnit = sw.emit(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angleUnit = sw.emit(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solidAngleUnit = sw.emit(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const uncertainty = sw.emit(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),#${lengthUnit},'distance_accuracy_value','tolerance')`);
  const geomContext = sw.emit(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);

  // ---- Build vertex pool with deduplication ----
  // Map "x,y,z" → vertex_point id
  const vertMap = new Map();
  const getVertex = (vIdx) => {
    const off = vIdx * numProp;
    const x = verts[off], y = verts[off + 1], z = verts[off + 2];
    const key = `${fmtFloat(x)},${fmtFloat(y)},${fmtFloat(z)}`;
    let entry = vertMap.get(key);
    if (entry) return entry;
    const cp = sw.emit(`CARTESIAN_POINT('',(${fmtFloat(x)},${fmtFloat(y)},${fmtFloat(z)}))`);
    const vp = sw.emit(`VERTEX_POINT('',#${cp})`);
    entry = { vp, cp, x, y, z };
    vertMap.set(key, entry);
    return entry;
  };

  // Map sorted-vertex-pair-key → { edgeCurve, vp1, vp2 (canonical orientation) }
  const edgeMap = new Map();
  const getEdge = (vpEntry1, vpEntry2) => {
    const k1 = `${vpEntry1.x},${vpEntry1.y},${vpEntry1.z}`;
    const k2 = `${vpEntry2.x},${vpEntry2.y},${vpEntry2.z}`;
    const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    let entry = edgeMap.get(key);
    if (entry) return entry;
    // Direction from canonical first → canonical second
    const [a, b] = k1 < k2 ? [vpEntry1, vpEntry2] : [vpEntry2, vpEntry1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dir = sw.emit(`DIRECTION('',(${fmtFloat(dx / dl)},${fmtFloat(dy / dl)},${fmtFloat(dz / dl)}))`);
    const vec = sw.emit(`VECTOR('',#${dir},${fmtFloat(dl)})`);
    const line = sw.emit(`LINE('',#${a.cp},#${vec})`);
    const ec = sw.emit(`EDGE_CURVE('',#${a.vp},#${b.vp},#${line},.T.)`);
    entry = { ec, canonicalA: a, canonicalB: b };
    edgeMap.set(key, entry);
    return entry;
  };

  // Build all faces
  const faceIds = [];
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const v0 = getVertex(i0);
    const v1 = getVertex(i1);
    const v2 = getVertex(i2);
    const p0 = [v0.x, v0.y, v0.z];
    const p1 = [v1.x, v1.y, v1.z];
    const p2 = [v2.x, v2.y, v2.z];
    const n = triNormal(p0, p1, p2);
    if (!Number.isFinite(n[0])) continue;  // degenerate

    // Local axis system at v0
    const ref = projectOntoPlane(pickRefDir(n), n);
    const cp = sw.emit(`CARTESIAN_POINT('',(${fmtFloat(p0[0])},${fmtFloat(p0[1])},${fmtFloat(p0[2])}))`);
    const axisDir = sw.emit(`DIRECTION('',(${fmtFloat(n[0])},${fmtFloat(n[1])},${fmtFloat(n[2])}))`);
    const refDir = sw.emit(`DIRECTION('',(${fmtFloat(ref[0])},${fmtFloat(ref[1])},${fmtFloat(ref[2])}))`);
    const axis = sw.emit(`AXIS2_PLACEMENT_3D('',#${cp},#${axisDir},#${refDir})`);
    const plane = sw.emit(`PLANE('',#${axis})`);

    // Three edges (with shared edge_curves) and oriented_edges
    const e01 = getEdge(v0, v1);
    const e12 = getEdge(v1, v2);
    const e20 = getEdge(v2, v0);
    // For oriented_edge, .T. = same direction as edge_curve, .F. = reversed.
    const ori01 = sw.emit(`ORIENTED_EDGE('',*,*,#${e01.ec},${e01.canonicalA === v0 ? '.T.' : '.F.'})`);
    const ori12 = sw.emit(`ORIENTED_EDGE('',*,*,#${e12.ec},${e12.canonicalA === v1 ? '.T.' : '.F.'})`);
    const ori20 = sw.emit(`ORIENTED_EDGE('',*,*,#${e20.ec},${e20.canonicalA === v2 ? '.T.' : '.F.'})`);
    const loop = sw.emit(`EDGE_LOOP('',(#${ori01},#${ori12},#${ori20}))`);
    const faceBound = sw.emit(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    const face = sw.emit(`ADVANCED_FACE('',(#${faceBound}),#${plane},.T.)`);
    faceIds.push(face);
  }

  // Closed shell + manifold_solid_brep
  const shellFaces = faceIds.map(f => `#${f}`).join(',');
  const closedShell = sw.emit(`CLOSED_SHELL('',(${shellFaces}))`);
  const solid = sw.emit(`MANIFOLD_SOLID_BREP('${name}',#${closedShell})`);

  // Shape representation
  const originPt = sw.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = sw.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = sw.emit(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = sw.emit(`AXIS2_PLACEMENT_3D('',#${originPt},#${zDir},#${xDir})`);
  const shapeRep = sw.emit(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${worldAxis},#${solid}),#${geomContext})`);
  sw.emit(`SHAPE_DEFINITION_REPRESENTATION(#${productDefShape},#${shapeRep})`);

  sw.raw('ENDSEC;');
  sw.raw('END-ISO-10303-21;');
  return sw.toString();
}
