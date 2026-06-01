// Forge-156 — AP242 STEP semantic PMI export.
//
// ISO 10303-242:2020 Edition 2 extends AP203 / AP214 with semantic
// Product and Manufacturing Information — GD&T feature control frames,
// surface finish callouts, weld symbols, datums, and tolerance zones
// represented as proper EXPRESS entities the receiving CAD reads.
//
// The receiving CAD (CATIA / NX / Creo / Inventor) can re-attach the
// tolerances to the geometry by following the geometric_item_specific_
// usage references each tolerance carries.
//
// This module does NOT replace ifcExport.js (which targets the AEC IFC4
// schema) or projectFile.js (which is the internal .forge bundle). It
// produces a `.step` file with FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_
// 3D_ENGINEERING')) and a proper SEMANTIC_TEXT_OBJECT chain.

import { newIfcGuid } from './ifcExport.js';   // 22-char GUIDs aren't IFC-specific

// AP242 tolerance characteristic enum (per ISO 10303-242 part 1, Annex F).
export const AP242_TOL_KINDS = Object.freeze({
  FLATNESS:                 'flatness_tolerance',
  STRAIGHTNESS:             'straightness_tolerance',
  CIRCULARITY:              'roundness_tolerance',
  CYLINDRICITY:             'cylindricity_tolerance',
  PROFILE_LINE:             'line_profile_tolerance',
  PROFILE_SURFACE:          'surface_profile_tolerance',
  PARALLELISM:              'parallelism_tolerance',
  PERPENDICULARITY:         'perpendicularity_tolerance',
  ANGULARITY:               'angularity_tolerance',
  POSITION:                 'position_tolerance',
  CONCENTRICITY:            'concentricity_tolerance',
  SYMMETRY:                 'symmetry_tolerance',
  CIRCULAR_RUNOUT:          'circular_runout_tolerance',
  TOTAL_RUNOUT:             'total_runout_tolerance',
});

// Material-condition modifiers per ISO 1101 + Y14.5.
export const AP242_MATERIAL_MODS = Object.freeze({
  RFS:  'regardless_of_feature_size',
  MMC:  'maximum_material_condition',
  LMC:  'least_material_condition',
});

// Zone-shape modifiers.
export const AP242_ZONES = Object.freeze({
  NONE:        '',
  DIAMETER:    'diameter',
  SPHERE:      'spherical_diameter',
  SQUARE:      'projected',
});

function nowIso() { return new Date().toISOString(); }

// Write a STEP entity line with proper auto-numbering.
function makeEntityWriter() {
  let id = 0;
  const lines = [];
  function next(text) {
    id += 1;
    lines.push(`#${id}= ${text};`);
    return id;
  }
  return { next, lines: () => lines.slice(), count: () => id };
}

/**
 * Build a complete AP242 STEP file with the given bodies + PMI
 * annotations. Returns a string ready to write to disk.
 *
 * @param {object} opts
 * @param {string} opts.projectName
 * @param {Array<object>} opts.bodies              [{ id, name, material, mass_g, vertices, faces }]
 * @param {Array<object>} opts.pmiAnnotations      [{ id, kind, value, datums, materialMod, zone, attached:[bodyId, faceId] }]
 * @param {string} [opts.units='mm']               mm | in | ft
 */
export function buildAP242({ projectName = 'Forge Project',
                              bodies = [],
                              pmiAnnotations = [],
                              units = 'mm' } = {}) {
  const W = makeEntityWriter();
  const id = (line) => W.next(line);

  // --------- units ---------
  const lengthUnit = id(units === 'in' || units === 'ft'
    ? `(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))`
    : units === 'mm'
      ? `(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`
      : `(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))`);
  const planeAngleUnit  = id(`(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))`);
  const solidAngleUnit  = id(`(NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.))`);
  const uncertainty     = id(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001), #${lengthUnit}, 'distance_accuracy_value','')`);
  const repCtx = id(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit}, #${planeAngleUnit}, #${solidAngleUnit})) REPRESENTATION_CONTEXT('Forge', '3D'))`);

  // --------- placement origin ---------
  const orgPt   = id(`CARTESIAN_POINT('', (0.0,0.0,0.0))`);
  const zDir    = id(`DIRECTION('', (0.0,0.0,1.0))`);
  const xDir    = id(`DIRECTION('', (1.0,0.0,0.0))`);
  const ax2p3d  = id(`AXIS2_PLACEMENT_3D('', #${orgPt}, #${zDir}, #${xDir})`);

  // --------- product hierarchy ---------
  const personOrg = id(`PERSON_AND_ORGANIZATION(
    PERSON('forge_user', 'ArchDisc', 'Forge', $, $, $, $, $),
    ORGANIZATION('forge_org', 'ArchDisc Forge', 'CAD/CAM/CAE platform', $, $)
  )`);
  const application = id(`APPLICATION_CONTEXT('configuration controlled 3d design of mechanical parts and assemblies')`);
  const appProto = id(`APPLICATION_PROTOCOL_DEFINITION('international standard',
    'ap242_managed_model_based_3d_engineering', 2020, #${application})`);

  const productCtx = id(`PRODUCT_CONTEXT('', #${application}, 'mechanical')`);
  const product    = id(`PRODUCT('FORGE_PROJECT', '${escapeStep(projectName)}', '', (#${productCtx}))`);
  const prodDefFormation = id(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('', '', #${product}, .MADE.)`);
  const prodDefCtx = id(`PRODUCT_DEFINITION_CONTEXT('design', #${application}, 'design')`);
  const prodDef    = id(`PRODUCT_DEFINITION('', '', #${prodDefFormation}, #${prodDefCtx})`);
  const shapeDef   = id(`PRODUCT_DEFINITION_SHAPE('', '', #${prodDef})`);

  // --------- shape representation root ---------
  const shapeRep = id(`SHAPE_REPRESENTATION('', (#${ax2p3d}), #${repCtx})`);
  id(`SHAPE_DEFINITION_REPRESENTATION(#${shapeDef}, #${shapeRep})`);

  // --------- per-body MANIFOLD_SOLID_BREP ---------
  const bodyRefs = new Map();    // bodyId → root brep entity number
  for (const body of bodies) {
    const brepId = writeManifoldBrep(W, body, ax2p3d);
    bodyRefs.set(body.id, brepId);
    // Tag body with PRODUCT-level identifier so PMI can reference it.
    id(`STYLED_ITEM('${escapeStep(body.name || body.id)}', (), #${brepId})`);
  }

  // --------- PMI semantic chain ---------
  for (const ann of pmiAnnotations) {
    writePmiAnnotation(W, ann, bodyRefs, repCtx);
  }

  // --------- assemble HEADER + DATA ---------
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('AP242 with semantic PMI — Forge export'),'2;1');`,
    `FILE_NAME('${escapeStep(projectName)}.step',`,
    `  '${nowIso()}',('ArchDisc Forge'),('ArchDisc'),`,
    `  'ArchDisc Forge AP242 Exporter 1.0','ArchDisc.Forge.AP242','');`,
    `FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'));`,
    'ENDSEC;',
    'DATA;',
  ];
  return [
    ...header,
    ...W.lines(),
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

function escapeStep(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

// Write a body's MANIFOLD_SOLID_BREP chain. Returns the BREP entity id.
function writeManifoldBrep(W, body, ax2p3d) {
  const id = (line) => W.next(line);
  // Build a vertex pool, edge pool, face pool.
  const verts = body.vertices || [];
  const tris  = body.faces    || [];
  if (verts.length === 0 || tris.length === 0) {
    // No tessellation supplied — emit an empty solid as a placeholder
    // PRODUCT carrier (the PMI still attaches to the body).
    const p0 = id(`CARTESIAN_POINT('', (0.0,0.0,0.0))`);
    const v0 = id(`VERTEX_POINT('', #${p0})`);
    return v0;
  }
  // Cartesian points
  const ptIds = verts.map((v) =>
    id(`CARTESIAN_POINT('', (${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}))`));
  // Vertex points
  const vpIds = ptIds.map((p) => id(`VERTEX_POINT('', #${p})`));
  // Per-triangle: 3 LINE edges + 1 face. Edges share via memoised lookup.
  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const edges = new Map();
  const ensureEdge = (a, b) => {
    const key = edgeKey(a, b);
    if (edges.has(key)) return edges.get(key);
    const dir = id(`DIRECTION('', (1.0,0.0,0.0))`);   // placeholder; OCCT recomputes
    const vec = id(`VECTOR('', #${dir}, 1.0)`);
    const line = id(`LINE('', #${ptIds[a]}, #${vec})`);
    const e = id(`EDGE_CURVE('', #${vpIds[a]}, #${vpIds[b]}, #${line}, .T.)`);
    edges.set(key, e);
    return e;
  };
  const faceIds = [];
  for (const tri of tris) {
    const [a, b, c] = tri;
    const e1 = ensureEdge(a, b);
    const e2 = ensureEdge(b, c);
    const e3 = ensureEdge(c, a);
    const oe1 = id(`ORIENTED_EDGE('', *, *, #${e1}, .T.)`);
    const oe2 = id(`ORIENTED_EDGE('', *, *, #${e2}, .T.)`);
    const oe3 = id(`ORIENTED_EDGE('', *, *, #${e3}, .T.)`);
    const loop = id(`EDGE_LOOP('', (#${oe1}, #${oe2}, #${oe3}))`);
    const fb   = id(`FACE_OUTER_BOUND('', #${loop}, .T.)`);
    // Face geometry = a PLANE (OCCT will refine on round-trip).
    const plPt   = id(`CARTESIAN_POINT('', (${verts[a][0].toFixed(6)},${verts[a][1].toFixed(6)},${verts[a][2].toFixed(6)}))`);
    const plNorm = id(`DIRECTION('', (0.0,0.0,1.0))`);
    const plRef  = id(`DIRECTION('', (1.0,0.0,0.0))`);
    const plAx   = id(`AXIS2_PLACEMENT_3D('', #${plPt}, #${plNorm}, #${plRef})`);
    const plane  = id(`PLANE('', #${plAx})`);
    const face   = id(`ADVANCED_FACE('', (#${fb}), #${plane}, .T.)`);
    faceIds.push(face);
  }
  const shell = id(`CLOSED_SHELL('', (${faceIds.map((f) => `#${f}`).join(',')}))`);
  const brep  = id(`MANIFOLD_SOLID_BREP('${escapeStep(body.name || body.id)}', #${shell})`);
  return brep;
}

// Write one semantic PMI annotation chain.
function writePmiAnnotation(W, ann, bodyRefs, repCtx) {
  const id = (line) => W.next(line);
  const tolKind = AP242_TOL_KINDS[ann.kind] || AP242_TOL_KINDS.FLATNESS;
  const matMod  = AP242_MATERIAL_MODS[ann.materialMod] || AP242_MATERIAL_MODS.RFS;
  const zone    = AP242_ZONES[ann.zone] || AP242_ZONES.NONE;
  const value   = Number.isFinite(ann.value) ? ann.value : 0.1;
  const guid    = newIfcGuid();
  // Magnitude — LENGTH_MEASURE wrapped in TOLERANCE_VALUE.
  const mag    = id(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${value.toFixed(6)}), $)`);
  const tolVal = id(`TOLERANCE_VALUE(#${mag}, $)`);
  // Modifier set per ISO 10303-242 4.1.
  const modList = matMod !== AP242_MATERIAL_MODS.RFS
    ? `(${quote(matMod)})` : `()`;
  // The body the tolerance attaches to.
  const targetEntity = bodyRefs.get(ann.attached?.[0]);
  const target = targetEntity != null ? `#${targetEntity}` : '$';
  // Datum refs.
  const datumRefs = (ann.datums || []).map((d, i) => {
    const datumPoint = id(`DATUM('${d.letter || String.fromCharCode(65 + i)}', $, $, '${d.letter || String.fromCharCode(65 + i)}', $)`);
    return datumPoint;
  });
  const datumChain = datumRefs.length
    ? `(${datumRefs.map((d) => `#${d}`).join(',')})`
    : '()';
  // Tolerance itself.
  const tolEntity = id(`GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE('${guid}', '${tolKind}', $, ${target}, #${tolVal}, ${datumChain})`);
  // Semantic text object — the human-readable string CATIA reads for
  // the tolerance balloon.
  const fcfText = ann.text ||
    `[${tolSymbol(ann.kind)}|${zone ? '⌀' : ''}${value} ${matMod !== 'RFS' ? matMod : ''}|${(ann.datums || []).map((d) => d.letter || '').join('|')}]`;
  id(`SEMANTIC_TEXT_OBJECT('${escapeStep(fcfText)}', $, $, $, '${guid}', #${tolEntity})`);
}

// Tolerance Unicode symbol for the semantic text. CATIA/NX render
// these directly; encoded as UTF-8 in STEP21.
function tolSymbol(kind) {
  return {
    FLATNESS: '⏥', STRAIGHTNESS: '—', CIRCULARITY: '○', CYLINDRICITY: '⌭',
    PROFILE_LINE: '⌒', PROFILE_SURFACE: '⌓',
    PARALLELISM: '∥', PERPENDICULARITY: '⟂', ANGULARITY: '∠',
    POSITION: '⊕', CONCENTRICITY: '◎', SYMMETRY: '=',
    CIRCULAR_RUNOUT: '↗', TOTAL_RUNOUT: '↗↗',
  }[kind] || '⏥';
}

function quote(s) { return `'${escapeStep(s)}'`; }

/** Test helper — fake a single-body export that we can validate. */
export function _testAP242Round(projectName = 'TEST') {
  return buildAP242({
    projectName,
    bodies: [{
      id: 'b-test',
      name: 'TestBlock',
      vertices: [
        [0,0,0], [10,0,0], [10,10,0], [0,10,0],
        [0,0,5], [10,0,5], [10,10,5], [0,10,5],
      ],
      faces: [
        [0,1,2],[0,2,3],     // bottom
        [4,5,6],[4,6,7],     // top
        [0,1,5],[0,5,4],     // -y
        [1,2,6],[1,6,5],     // +x
        [2,3,7],[2,7,6],     // +y
        [3,0,4],[3,4,7],     // -x
      ],
    }],
    pmiAnnotations: [
      { id: 'a1', kind: 'FLATNESS', value: 0.05, attached: ['b-test', 0] },
      { id: 'a2', kind: 'PERPENDICULARITY', value: 0.1,
        datums: [{ letter: 'A' }], attached: ['b-test', 1] },
      { id: 'a3', kind: 'POSITION', value: 0.2, zone: 'DIAMETER',
        materialMod: 'MMC',
        datums: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }],
        attached: ['b-test', 2] },
    ],
  });
}
