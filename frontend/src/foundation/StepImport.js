/**
 * ArchDisc Foundation — tolerant STEP (ISO 10303-21) reader.
 *
 * Reconstructs a triangle mesh from a faceted-B-rep STEP file by
 * walking the entity graph:
 *
 *   ADVANCED_FACE → FACE_OUTER_BOUND → EDGE_LOOP →
 *   ORIENTED_EDGE → EDGE_CURVE → VERTEX_POINT → CARTESIAN_POINT
 *
 * Each face's outer-bound loop is recovered as an ordered vertex
 * polygon and fan-triangulated. Round-trips ArchDisc's own
 * StepExport output and reads any AP203/AP214 faceted B-rep from
 * SolidWorks / NX / Fusion / FreeCAD / OpenCascade.
 *
 * "Tolerant" means: malformed individual faces are skipped (not
 * fatal); curved surfaces are read as their bounding polygon
 * (the geometry comes back tessellated, same limitation as the
 * exporter). parseStep throws only if NO face could be recovered.
 *
 * NURBS / B-spline surface re-fitting is out of scope — this is a
 * mesh-level interop reader, matching the mesh-level exporter.
 */

/**
 * Parse a STEP file string into an entity table.
 * @returns {Map<number, {type: string, args: string}>}
 */
export function parseEntities(text) {
  const entities = new Map();
  // Keep only the DATA section if present.
  const dataStart = text.indexOf('DATA;');
  const dataEnd = text.indexOf('ENDSEC;', dataStart >= 0 ? dataStart : 0);
  const body = dataStart >= 0
    ? text.slice(dataStart + 5, dataEnd >= 0 ? dataEnd : text.length)
    : text;

  // Entities are `#id = TYPE(args) ;` — but args can contain ';'
  // inside strings, so split carefully on top-level ';'.
  let i = 0, depth = 0, inStr = false, stmt = '';
  const flush = () => {
    const s = stmt.trim();
    stmt = '';
    if (!s || !s.startsWith('#')) return;
    const eq = s.indexOf('=');
    if (eq < 0) return;
    const id = parseInt(s.slice(1, eq).trim(), 10);
    if (!Number.isFinite(id)) return;
    const rhs = s.slice(eq + 1).trim();
    // TYPE(args)  — or a complex `(A()B()...)` aggregate.
    const m = /^([A-Z0-9_]+)\s*\(([\s\S]*)\)$/.exec(rhs);
    if (m) {
      entities.set(id, { type: m[1], args: m[2] });
    } else if (rhs.startsWith('(')) {
      entities.set(id, { type: '_COMPLEX_', args: rhs });
    }
  };
  for (i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      stmt += c;
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; stmt += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) { flush(); continue; }
    stmt += c;
  }
  flush();
  return entities;
}

/** Extract every `#id` reference from an argument string. */
function refsIn(args) {
  const out = [];
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(args)) !== null) out.push(parseInt(m[1], 10));
  return out;
}

/** Parse the first `( x, y, z )` numeric tuple in an argument string. */
function tupleIn(args) {
  const m = /\(\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*\)/.exec(args);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

/**
 * Reconstruct a triangle mesh from a STEP file.
 *
 * @param {string} text
 * @returns {{
 *   vertices: number[][],    // deduplicated [x,y,z]
 *   triangles: number[][],   // index triples
 *   faceCount: number,       // ADVANCED_FACE entities processed
 *   skippedFaces: number,
 * }}
 */
export function parseStep(text) {
  const ent = parseEntities(text);

  // CARTESIAN_POINT id → [x,y,z]
  const pointCoord = (id) => {
    const e = ent.get(id);
    if (!e) return null;
    if (e.type === 'CARTESIAN_POINT') return tupleIn(e.args);
    return null;
  };
  // VERTEX_POINT id → CARTESIAN_POINT coords
  const vertexCoord = (id) => {
    const e = ent.get(id);
    if (!e || e.type !== 'VERTEX_POINT') return null;
    const r = refsIn(e.args);
    return r.length ? pointCoord(r[0]) : null;
  };

  // Global deduplicated vertex pool.
  const vertices = [];
  const vmap = new Map();
  const vIndex = (xyz) => {
    if (!xyz) return -1;
    const key = `${round(xyz[0])},${round(xyz[1])},${round(xyz[2])}`;
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push(xyz);
      vmap.set(key, idx);
    }
    return idx;
  };

  // Recover the ordered vertex loop of one EDGE_LOOP.
  const loopVertices = (edgeLoopId) => {
    const e = ent.get(edgeLoopId);
    if (!e || e.type !== 'EDGE_LOOP') return [];
    const orientedEdges = refsIn(e.args);
    const loop = [];
    for (const oeId of orientedEdges) {
      const oe = ent.get(oeId);
      if (!oe || oe.type !== 'ORIENTED_EDGE') continue;
      // ORIENTED_EDGE('',*,*,#edgeCurve, .T./.F.)
      const refs = refsIn(oe.args);
      const ecId = refs[refs.length - 1];
      const ec = ent.get(ecId);
      if (!ec || ec.type !== 'EDGE_CURVE') continue;
      const ecRefs = refsIn(ec.args);   // [vStart, vEnd, curve]
      const forward = /\.T\.\s*\)?\s*$/.test(oe.args.trim());
      const startV = forward ? ecRefs[0] : ecRefs[1];
      const c = vertexCoord(startV);
      if (c) loop.push(c);
    }
    return loop;
  };

  // Walk every ADVANCED_FACE.
  const triangles = [];
  let faceCount = 0, skippedFaces = 0;
  for (const [, e] of ent) {
    if (e.type !== 'ADVANCED_FACE' && e.type !== 'FACE_SURFACE') continue;
    faceCount++;
    try {
      const refs = refsIn(e.args);
      // Find a FACE_OUTER_BOUND / FACE_BOUND among the refs.
      let loopVerts = [];
      for (const rid of refs) {
        const b = ent.get(rid);
        if (b && (b.type === 'FACE_OUTER_BOUND' || b.type === 'FACE_BOUND')) {
          const elId = refsIn(b.args)[0];
          loopVerts = loopVertices(elId);
          if (loopVerts.length >= 3) break;
        }
      }
      if (loopVerts.length < 3) { skippedFaces++; continue; }
      // Fan-triangulate the loop.
      const idx = loopVerts.map(vIndex);
      for (let k = 1; k < idx.length - 1; k++) {
        const a = idx[0], b = idx[k], c = idx[k + 1];
        if (a !== b && b !== c && a !== c) triangles.push([a, b, c]);
      }
    } catch {
      skippedFaces++;
    }
  }

  if (triangles.length === 0) {
    throw new Error('STEP import: no faces could be reconstructed (unsupported representation?)');
  }
  return { vertices, triangles, faceCount, skippedFaces };
}

function round(x) { return Math.round(x * 1e6) / 1e6; }

/**
 * Build a manifold-3d Manifold from a parsed STEP mesh.
 * @param {{vertices, triangles}} mesh
 * @param {Function} getManifoldFn  the foundation getManifold()
 */
export async function stepMeshToManifold(mesh, getManifoldFn) {
  const Mod = await getManifoldFn();
  const vertProperties = new Float32Array(mesh.vertices.length * 3);
  for (let i = 0; i < mesh.vertices.length; i++) {
    vertProperties[i * 3]     = mesh.vertices[i][0];
    vertProperties[i * 3 + 1] = mesh.vertices[i][1];
    vertProperties[i * 3 + 2] = mesh.vertices[i][2];
  }
  const triVerts = new Uint32Array(mesh.triangles.length * 3);
  for (let i = 0; i < mesh.triangles.length; i++) {
    triVerts[i * 3]     = mesh.triangles[i][0];
    triVerts[i * 3 + 1] = mesh.triangles[i][1];
    triVerts[i * 3 + 2] = mesh.triangles[i][2];
  }
  const meshGL = new Mod.Mesh({ numProp: 3, vertProperties, triVerts });
  return Mod.Manifold.ofMesh(meshGL);
}
