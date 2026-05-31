/**
 * ArchDisc Foundation — STEP AP203 NURBS export (Phase 4 of Parasolid
 * parity).
 *
 * Emits AP203 entities so a NURBSCurve / NURBSSurface round-trips into
 * NX, SolidWorks, Fusion 360, Onshape, FreeCAD, OpenCascade etc. as
 * REAL ANALYTIC geometry rather than as a tessellated triangle mesh.
 *
 * Standard entities used:
 *
 *   CARTESIAN_POINT            ('', (x, y, z))
 *   B_SPLINE_CURVE             (degree, ctrl_points, form, closed, self_int)
 *   B_SPLINE_CURVE_WITH_KNOTS  (multiplicities, knots, knot_spec)
 *   RATIONAL_B_SPLINE_CURVE    (weights)
 *   B_SPLINE_SURFACE           (deg_u, deg_v, ctrl_grid, form, closed_u,
 *                                 closed_v, self_int)
 *   B_SPLINE_SURFACE_WITH_KNOTS (mult_u, mult_v, knots_u, knots_v, knot_spec)
 *   RATIONAL_B_SPLINE_SURFACE  (weight_grid)
 *
 * The combined "rational + with-knots" form is a STEP **complex
 * instance**: one ENTITY-INSTANCE_NAME = ( ... ); chains all relevant
 * supertypes (BOUNDED_CURVE, CURVE, GEOMETRIC_REPRESENTATION_ITEM,
 * REPRESENTATION_ITEM, etc.) so the parser sees one complete object.
 *
 * Unique-knot encoding: AP203 requires (knot_value, multiplicity)
 * pairs — not the redundant repeated list NURBSCurve carries. We
 * collapse via tolerance-based grouping.
 *
 * Output: a stand-alone STEP-21 file. Open it in NX (File → Open …
 * → .step) and the curve / surface comes in as a smooth analytic
 * entity, not as a polyline / mesh.
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
  if (!Number.isFinite(x)) throw new Error('non-finite');
  if (x === 0) return '0.';
  // STEP standard requires explicit dot for floats
  let s = x.toFixed(10);
  // Trim trailing zeros but keep at least one digit after the dot
  s = s.replace(/(\.\d*?)0+$/, '$1');
  if (s.endsWith('.')) s += '0';
  return s;
}

/**
 * Collapse a knot vector with repeated values into unique knots +
 * multiplicities, with tolerance for floating-point grouping.
 */
function collapseKnots(knots, eps = 1e-9) {
  const uniq = [];
  const mult = [];
  for (const k of knots) {
    if (uniq.length > 0 && Math.abs(uniq[uniq.length - 1] - k) < eps) {
      mult[mult.length - 1] += 1;
    } else {
      uniq.push(k);
      mult.push(1);
    }
  }
  return { uniqueKnots: uniq, multiplicities: mult };
}

function writeHeader(sw, name, author = 'ArchDisc Foundation', org = 'ArchDisc') {
  sw.raw('ISO-10303-21;');
  sw.raw('HEADER;');
  sw.raw(`FILE_DESCRIPTION(('ArchDisc Foundation NURBS export'),'2;1');`);
  const ts = new Date().toISOString().slice(0, 19);
  sw.raw(`FILE_NAME('${name}.step','${ts}',('${author}'),('${org}'),'ArchDisc NURBS Exporter','manifold-3d agnostic','');`);
  sw.raw(`FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));`);
  sw.raw('ENDSEC;');
  sw.raw('DATA;');
}

function writeContext(sw, name) {
  const appCtx = sw.emit(`APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')`);
  sw.emit(`APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,#${appCtx})`);
  const productCtx = sw.emit(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const productDefCtx = sw.emit(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const product = sw.emit(`PRODUCT('${name}','${name}','',(#${productCtx}))`);
  const productDefForm = sw.emit(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const productDef = sw.emit(`PRODUCT_DEFINITION('design','',#${productDefForm},#${productDefCtx})`);
  const productDefShape = sw.emit(`PRODUCT_DEFINITION_SHAPE('','',#${productDef})`);
  const lengthUnit = sw.emit(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angleUnit = sw.emit(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solidAngleUnit = sw.emit(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const uncertainty = sw.emit(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),#${lengthUnit},'distance_accuracy_value','tolerance')`);
  const geomCtx = sw.emit(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
  return { geomCtx, productDefShape };
}

/**
 * Emit a NURBSCurve as an AP203 RATIONAL_B_SPLINE_CURVE_WITH_KNOTS
 * complex entity. Returns the entity ID of the curve.
 */
function emitNURBSCurveEntity(sw, curve) {
  // Cartesian points
  const cpIds = curve.controlPoints.map(p =>
    sw.emit(`CARTESIAN_POINT('',(${fmtFloat(p[0])},${fmtFloat(p[1])},${fmtFloat(p[2])}))`),
  );
  const { uniqueKnots, multiplicities } = collapseKnots(curve.knots);
  // Always emit RATIONAL form (degenerates correctly when all weights = 1)
  const cpList = cpIds.map(id => `#${id}`).join(',');
  const multList = multiplicities.join(',');
  const knotList = uniqueKnots.map(fmtFloat).join(',');
  const weightList = curve.weights.map(fmtFloat).join(',');
  const id = nextId();
  sw.lines.push(`#${id}=(BOUNDED_CURVE()B_SPLINE_CURVE(${curve.degree},(${cpList}),.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS((${multList}),(${knotList}),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE((${weightList}))REPRESENTATION_ITEM(''));`);
  return id;
}

/**
 * Emit a NURBSSurface as an AP203 RATIONAL_B_SPLINE_SURFACE_WITH_KNOTS
 * complex entity. Returns the entity ID of the surface.
 */
function emitNURBSSurfaceEntity(sw, surface) {
  // 2-D control point grid
  const cpIdGrid = surface.controlNet.map(row =>
    row.map(p => sw.emit(`CARTESIAN_POINT('',(${fmtFloat(p[0])},${fmtFloat(p[1])},${fmtFloat(p[2])}))`)),
  );
  const { uniqueKnots: uniqU, multiplicities: multU } = collapseKnots(surface.knotsU);
  const { uniqueKnots: uniqV, multiplicities: multV } = collapseKnots(surface.knotsV);
  const cpListInner = cpIdGrid.map(row => `(${row.map(id => `#${id}`).join(',')})`).join(',');
  const weightListInner = surface.weights.map(row => `(${row.map(fmtFloat).join(',')})`).join(',');
  const id = nextId();
  sw.lines.push(`#${id}=(BOUNDED_SURFACE()B_SPLINE_SURFACE(${surface.p},${surface.q},(${cpListInner}),.UNSPECIFIED.,.F.,.F.,.F.)B_SPLINE_SURFACE_WITH_KNOTS((${multU.join(',')}),(${multV.join(',')}),(${uniqU.map(fmtFloat).join(',')}),(${uniqV.map(fmtFloat).join(',')}),.UNSPECIFIED.)GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((${weightListInner}))REPRESENTATION_ITEM('')SURFACE());`);
  return id;
}

/**
 * Export a NURBSCurve as a stand-alone AP203 STEP file with the curve
 * geometry as a free curve entity inside a GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION.
 */
export function exportNURBSCurve(curve, options = {}) {
  _entityId = 0;
  const sw = new StepWriter();
  const name = options.name ?? 'NURBSCurve';
  writeHeader(sw, name, options.author, options.org);
  const { geomCtx, productDefShape } = writeContext(sw, name);
  const curveId = emitNURBSCurveEntity(sw, curve);
  // World axis at origin
  const originPt = sw.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = sw.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = sw.emit(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = sw.emit(`AXIS2_PLACEMENT_3D('',#${originPt},#${zDir},#${xDir})`);
  // Wireframe shape representation containing the curve + the world axis
  const shapeRep = sw.emit(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('',(#${worldAxis},#${curveId}),#${geomCtx})`);
  sw.emit(`SHAPE_DEFINITION_REPRESENTATION(#${productDefShape},#${shapeRep})`);
  sw.raw('ENDSEC;');
  sw.raw('END-ISO-10303-21;');
  return sw.toString();
}

/**
 * Export a NURBSSurface as a stand-alone AP203 STEP file with the
 * surface as a free surface entity inside a
 * GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION.
 */
export function exportNURBSSurface(surface, options = {}) {
  _entityId = 0;
  const sw = new StepWriter();
  const name = options.name ?? 'NURBSSurface';
  writeHeader(sw, name, options.author, options.org);
  const { geomCtx, productDefShape } = writeContext(sw, name);
  const surfId = emitNURBSSurfaceEntity(sw, surface);
  const originPt = sw.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = sw.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = sw.emit(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = sw.emit(`AXIS2_PLACEMENT_3D('',#${originPt},#${zDir},#${xDir})`);
  const shapeRep = sw.emit(`GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION('',(#${worldAxis},#${surfId}),#${geomCtx})`);
  sw.emit(`SHAPE_DEFINITION_REPRESENTATION(#${productDefShape},#${shapeRep})`);
  sw.raw('ENDSEC;');
  sw.raw('END-ISO-10303-21;');
  return sw.toString();
}

/**
 * Combined helper: emit a STEP file with multiple NURBS curves +
 * surfaces in a single shape representation.
 */
export function exportNURBSCollection({ curves = [], surfaces = [], options = {} }) {
  _entityId = 0;
  const sw = new StepWriter();
  const name = options.name ?? 'NURBSCollection';
  writeHeader(sw, name, options.author, options.org);
  const { geomCtx, productDefShape } = writeContext(sw, name);
  const items = [];
  for (const c of curves) items.push(emitNURBSCurveEntity(sw, c));
  for (const s of surfaces) items.push(emitNURBSSurfaceEntity(sw, s));
  const originPt = sw.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = sw.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = sw.emit(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = sw.emit(`AXIS2_PLACEMENT_3D('',#${originPt},#${zDir},#${xDir})`);
  const itemsList = [worldAxis, ...items].map(id => `#${id}`).join(',');
  // Pick the appropriate representation type based on what we have
  const repType = (surfaces.length > 0 && curves.length === 0)
    ? 'GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION'
    : (curves.length > 0 && surfaces.length === 0)
      ? 'GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION'
      : 'SHAPE_REPRESENTATION';
  const shapeRep = sw.emit(`${repType}('',(${itemsList}),#${geomCtx})`);
  sw.emit(`SHAPE_DEFINITION_REPRESENTATION(#${productDefShape},#${shapeRep})`);
  sw.raw('ENDSEC;');
  sw.raw('END-ISO-10303-21;');
  return sw.toString();
}

export const _internals = { collapseKnots };
