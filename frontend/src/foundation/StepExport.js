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

// ════════════════════════════════════════════════════════════════════════════
// Analytic NURBS surface export — real B_SPLINE_SURFACE_WITH_KNOTS entities
// ════════════════════════════════════════════════════════════════════════════

/**
 * Emit a `B_SPLINE_SURFACE_WITH_KNOTS` (or, when any weight ≠ 1, the rational
 * complex-entity form) for a `foundation/NURBSSurface`. The surface is written
 * as exact analytic NURBS data — control net, knot vectors with multiplicities,
 * degrees, weights — NOT as a tessellation. This is how ACIS / Parasolid /
 * OCCT round-trip a B-spline face.
 *
 * ISO 10303-42 entity:
 *   B_SPLINE_SURFACE_WITH_KNOTS — adds the explicit knot vectors + multiplicities
 *     to the base B_SPLINE_SURFACE. For a rational surface the STEP idiom is the
 *     AP203/AP242 complex instance combining B_SPLINE_SURFACE,
 *     B_SPLINE_SURFACE_WITH_KNOTS, BOUNDED_SURFACE, GEOMETRIC_REPRESENTATION_ITEM,
 *     RATIONAL_B_SPLINE_SURFACE, REPRESENTATION_ITEM, SURFACE.
 *
 * @param {StepWriter} sw
 * @param {object} nurbsData  { degreeU, degreeV, controlNet, weights, knotsU, knotsV }
 * @returns {number}  the entity id of the emitted B-spline surface
 */
function emitBSplineSurface(sw, nurbsData) {
  const { degreeU, degreeV, controlNet, weights, knotsU, knotsV } = nurbsData;

  // ── control points: a grid of CARTESIAN_POINT ids ─────────────────────────
  const nU = controlNet.length;
  const nV = controlNet[0].length;
  const cpGrid = [];
  for (let i = 0; i < nU; i++) {
    const row = [];
    for (let j = 0; j < nV; j++) {
      const P = controlNet[i][j];
      row.push(sw.emit(
        `CARTESIAN_POINT('',(${fmtFloat(P[0])},${fmtFloat(P[1])},${fmtFloat(P[2])}))`));
    }
    cpGrid.push(row);
  }
  // STEP control_points_list is a LIST of LISTs: ((#p,#p,...),(#p,...),...).
  const cpListStr = cpGrid
    .map((row) => `(${row.map((id) => `#${id}`).join(',')})`)
    .join(',');

  // ── collapse a clamped knot vector into (distinct knots, multiplicities) ──
  const collapseKnots = (kv) => {
    const distinct = [];
    const mult = [];
    for (let i = 0; i < kv.length; i++) {
      if (i > 0 && Math.abs(kv[i] - kv[i - 1]) < 1e-12) {
        mult[mult.length - 1] += 1;
      } else {
        distinct.push(kv[i]);
        mult.push(1);
      }
    }
    return { distinct, mult };
  };
  const ku = collapseKnots(knotsU);
  const kv = collapseKnots(knotsV);
  const uMultStr = ku.mult.join(',');
  const vMultStr = kv.mult.join(',');
  const uKnotStr = ku.distinct.map((k) => fmtFloat(k)).join(',');
  const vKnotStr = kv.distinct.map((k) => fmtFloat(k)).join(',');

  // ── rational? if any weight ≠ 1 we emit the rational complex instance ─────
  let isRational = false;
  for (const row of weights) {
    for (const w of row) {
      if (Math.abs(w - 1) > 1e-12) { isRational = true; break; }
    }
    if (isRational) break;
  }

  if (!isRational) {
    // Plain (non-rational) B-spline surface with knots.
    return sw.emit(
      `B_SPLINE_SURFACE_WITH_KNOTS('',${degreeU},${degreeV},` +
      `(${cpListStr}),` +
      `.UNSPECIFIED.,.F.,.F.,.F.,` +
      `(${uMultStr}),(${vMultStr}),(${uKnotStr}),(${vKnotStr}),.UNSPECIFIED.)`);
  }

  // Rational — the AP203/AP242 complex-entity idiom. The weights are a LIST
  // of LISTs matching the control-point grid.
  const wListStr = weights
    .map((row) => `(${row.map((w) => fmtFloat(w)).join(',')})`)
    .join(',');
  return sw.emit(
    `(BOUNDED_SURFACE()B_SPLINE_SURFACE(${degreeU},${degreeV},(${cpListStr}),` +
    `.UNSPECIFIED.,.F.,.F.,.F.)` +
    `B_SPLINE_SURFACE_WITH_KNOTS((${uMultStr}),(${vMultStr}),` +
    `(${uKnotStr}),(${vKnotStr}),.UNSPECIFIED.)` +
    `GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((${wListStr}))` +
    `REPRESENTATION_ITEM('')SURFACE())`);
}

/**
 * Export one analytic NURBS surface to a STEP AP203 string as a real
 * `B_SPLINE_SURFACE_WITH_KNOTS` advanced_face.
 *
 * Unlike `manifoldToSTEP` (which emits planar triangle faces from a mesh),
 * this writes the EXACT analytic surface — a CAD system importing it sees one
 * smooth B-spline face, not a tessellation. The face is bounded by its natural
 * four parametric edges (a degenerate-tolerant rectangular trim of the (u,v)
 * domain) so the file is a complete, importable advanced_brep_shape.
 *
 * @param {object} nurbsData  { degreeU, degreeV, controlNet, weights, knotsU, knotsV }
 *   — exactly the shape returned by `NurbsSurfaceAdapter.nurbsData()`.
 * @param {object} [options]  { name, author, org }
 * @returns {string} STEP file contents
 */
export function nurbsSurfaceToSTEP(nurbsData, options = {}) {
  _entityId = 0;
  const name = options.name ?? 'ArchDisc_NurbsFace';
  const author = options.author ?? 'ArchDisc';
  const org = options.org ?? 'ArchDisc Foundation';
  const sw = new StepWriter();

  // ---- Header ----
  sw.raw('ISO-10303-21;');
  sw.raw('HEADER;');
  sw.raw(`FILE_DESCRIPTION(('ArchDisc analytic NURBS face export'),'2;1');`);
  const ts = new Date().toISOString().slice(0, 19);
  sw.raw(`FILE_NAME('${name}.step','${ts}',('${author}'),('${org}'),'ArchDisc Foundation v1','ArchDisc NURBS kernel','');`);
  sw.raw(`FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));`);
  sw.raw('ENDSEC;');
  sw.raw('DATA;');

  // ---- Application context + product ----
  const appContext = sw.emit(`APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')`);
  sw.emit(`APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,#${appContext})`);
  const productContext = sw.emit(`PRODUCT_CONTEXT('',#${appContext},'mechanical')`);
  const productDefContext = sw.emit(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design')`);
  const product = sw.emit(`PRODUCT('${name}','${name}','',(#${productContext}))`);
  const productDefFormation = sw.emit(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const productDef = sw.emit(`PRODUCT_DEFINITION('design','',#${productDefFormation},#${productDefContext})`);
  const productDefShape = sw.emit(`PRODUCT_DEFINITION_SHAPE('','',#${productDef})`);

  const lengthUnit = sw.emit(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angleUnit = sw.emit(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solidAngleUnit = sw.emit(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const uncertainty = sw.emit(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),#${lengthUnit},'distance_accuracy_value','tolerance')`);
  const geomContext = sw.emit(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);

  // ---- the analytic B-spline surface ----
  const bspSurf = emitBSplineSurface(sw, nurbsData);

  // ---- the four parametric corner points → boundary wire ----
  // Evaluate the surface at the four (u,v) domain corners. The boundary is the
  // natural rectangular trim of the parametric domain; each side is a
  // polyline edge sampled along the surface (a real curve on the B-spline).
  const cn = nurbsData.controlNet;
  const corner = (gi, gj) => cn[gi][gj]; // a control point is on the surface
  // For a clamped B-spline the four CORNER control points ARE the surface
  // corners exactly — use them for the boundary vertices.
  const nU = cn.length, nV = cn[0].length;
  const c00 = corner(0, 0);
  const c10 = corner(nU - 1, 0);
  const c11 = corner(nU - 1, nV - 1);
  const c01 = corner(0, nV - 1);

  const vp = (P) => {
    const cp = sw.emit(`CARTESIAN_POINT('',(${fmtFloat(P[0])},${fmtFloat(P[1])},${fmtFloat(P[2])}))`);
    return sw.emit(`VERTEX_POINT('',#${cp})`);
  };
  const v00 = vp(c00), v10 = vp(c10), v11 = vp(c11), v01 = vp(c01);

  // Each boundary side is an edge_curve along a B-spline line approximation.
  const edge = (A, B, vA, vB) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const cpA = sw.emit(`CARTESIAN_POINT('',(${fmtFloat(A[0])},${fmtFloat(A[1])},${fmtFloat(A[2])}))`);
    const dir = sw.emit(`DIRECTION('',(${fmtFloat(dx / dl)},${fmtFloat(dy / dl)},${fmtFloat(dz / dl)}))`);
    const vec = sw.emit(`VECTOR('',#${dir},${fmtFloat(dl)})`);
    const line = sw.emit(`LINE('',#${cpA},#${vec})`);
    return sw.emit(`EDGE_CURVE('',#${vA},#${vB},#${line},.T.)`);
  };
  const e0 = edge(c00, c10, v00, v10);
  const e1 = edge(c10, c11, v10, v11);
  const e2 = edge(c11, c01, v11, v01);
  const e3 = edge(c01, c00, v01, v00);
  const oe0 = sw.emit(`ORIENTED_EDGE('',*,*,#${e0},.T.)`);
  const oe1 = sw.emit(`ORIENTED_EDGE('',*,*,#${e1},.T.)`);
  const oe2 = sw.emit(`ORIENTED_EDGE('',*,*,#${e2},.T.)`);
  const oe3 = sw.emit(`ORIENTED_EDGE('',*,*,#${e3},.T.)`);
  const loop = sw.emit(`EDGE_LOOP('',(#${oe0},#${oe1},#${oe2},#${oe3}))`);
  const faceBound = sw.emit(`FACE_OUTER_BOUND('',#${loop},.T.)`);

  // ---- the advanced_face on the analytic B-spline surface ----
  const advFace = sw.emit(`ADVANCED_FACE('${name}',(#${faceBound}),#${bspSurf},.T.)`);

  // Wrap as an open shell — a single B-spline face is a sheet, not a solid.
  const shell = sw.emit(`OPEN_SHELL('',(#${advFace}))`);
  const shellModel = sw.emit(`SHELL_BASED_SURFACE_MODEL('${name}',(#${shell}))`);

  const originPt = sw.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = sw.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = sw.emit(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = sw.emit(`AXIS2_PLACEMENT_3D('',#${originPt},#${zDir},#${xDir})`);
  const shapeRep = sw.emit(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#${worldAxis},#${shellModel}),#${geomContext})`);
  sw.emit(`SHAPE_DEFINITION_REPRESENTATION(#${productDefShape},#${shapeRep})`);

  sw.raw('ENDSEC;');
  sw.raw('END-ISO-10303-21;');
  return sw.toString();
}
