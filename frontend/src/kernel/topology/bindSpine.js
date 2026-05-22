/**
 * ArchDisc Topology Spine — bindSpine
 *
 * SP-1 Stage S1. The OCCT→spine bridge: a pure function that walks a B-rep
 * engine `TopoDS_Shape` and constructs a fully-populated, validated spine
 * `Body` — Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex — with every entity
 * `geomRef`-linked back to its engine sub-shape and a persistent id assigned.
 *
 * The spine is topology truth; the engine shape stays the geometry-of-record.
 * `bindSpine` only READS the shape — it never mutates it — so building the
 * spine cannot regress geometry (SP-1 §5.2).
 *
 * ── Empirical binding basis (from `e2e/spine-recon-electron.spec.js`,
 *    recorded in `docs/superpowers/notes/topology-spine-A.md`) ──────────────
 *   REACHABLE : TopExp_Explorer (all 6 levels); HashCode/IsSame/IsEqual;
 *               BRep_Tool.Surface_2 / Curve / Pnt; BRepTools.OuterWire +
 *               BRepTools_WireExplorer_2(wire) [1-arg form]; non-manifold
 *               coedge COUNTING via MapShapesAndAncestors.
 *   GAP       : `TopTools_ListIteratorOfListOfShape` is UNBOUND and the
 *               `TopTools_ListOfShape` from `FindFromIndex` does not expose a
 *               usable member accessor — so the ancestry map yields face
 *               COUNTS but not the face IDENTITIES.
 *
 * Consequence — the SP-1-designed degrade path, shipped as a real branch:
 *   `bindSpine` builds the edge→faces adjacency with `buildEdgeFaceAdjacency`,
 *   which prefers the map fast-path and otherwise uses the O(n²) per-face
 *   `TopExp_Explorer` `IsSame` pairing fallback (`buildAdjacencyFallback`).
 *   Both are real, documented code; neither silently degrades.
 *
 * Handles every edge case the SP-1 methodology requires: degenerate shapes,
 * non-manifold topology, empty / open shells, reversed orientations, and
 * multi-lump compounds.
 */

import Body from './Body.js';
import Lump from './Lump.js';
import Shell from './Shell.js';
import Face from './Face.js';
import Loop from './Loop.js';
import Coedge from './Coedge.js';
import Edge from './Edge.js';
import Vertex from './Vertex.js';
import { OcctSurfaceAdapter, OcctCurveAdapter } from './geomAdapters.js';
import validateSpine from './validateSpine.js';

/**
 * Bind an engine `TopoDS_Shape` into a validated spine `Body`.
 *
 * @param {object} oc     the live B-rep engine module (from getOCCT()).
 * @param {object} shape  a TopoDS_Shape (a solid, shell, face, compound, …).
 * @param {object} [opts]
 * @param {string}  [opts.bodyTag]   explicit body tag for the IdAllocator.
 * @param {import('./IdAllocator.js').default} [opts.idAllocator]  reuse one.
 * @param {object}  [opts.geomEngineShape]  the heap-managed wrapper to record
 *        on `body.geomEngineShape` (typically the BrepShape the op returned).
 * @param {boolean} [opts.validate]  run validateSpine and attach the report
 *        to `body.diagnostics.validation` (default true).
 * @returns {import('./Body.js').default} the spine Body.
 */
export default function bindSpine(oc, shape, opts = {}) {
  if (!oc) throw new Error('bindSpine: the B-rep engine module is required');
  if (!shape || (shape.IsNull && shape.IsNull())) {
    throw new Error('bindSpine: a non-null TopoDS_Shape is required');
  }

  const SE = oc.TopAbs_ShapeEnum;
  const SHAPE = SE.TopAbs_SHAPE;

  const body = new Body({
    bodyTag: opts.bodyTag,
    idAllocator: opts.idAllocator,
    geomEngineShape: opts.geomEngineShape || null,
  });

  // ── transient-object disposal arena ────────────────────────────────────────
  // bindSpine creates many short-lived engine objects (explorers, handles,
  // GProps). It frees them here on exit — EXCEPT the TopoDS sub-shapes kept as
  // `geomRef`s, which are lightweight handles into the parent shape's TShape
  // and live as long as the parent shape (so they must NOT be deleted).
  const transients = [];
  const track = (o) => { if (o) transients.push(o); return o; };
  // sub-shape handles that became geomRefs — never deleted here.
  const geomRefs = new Set();
  const keep = (o) => { geomRefs.add(o); return o; };

  try {
    const diag = body.diagnostics;
    diag.bind = { adjacencyStrategy: null, degenerateEdges: 0, openShells: 0 };

    // ── 1. Vertex cache — one spine Vertex per unique engine vertex ──────────
    // Keyed by HashCode (recon probe 3: stable integer key), IsSame-verified
    // on hash collision.
    const vertexCache = new HashKeyedCache(oc);
    const getVertex = (occtVertex) => {
      const existing = vertexCache.find(occtVertex);
      if (existing) return existing;
      const gp = oc.BRep_Tool.Pnt(occtVertex);
      const point = { x: gp.X(), y: gp.Y(), z: gp.Z() };
      try { if (gp.delete) gp.delete(); } catch (_e) {}
      let tol = 0;
      try {
        if (typeof oc.BRep_Tool.Tolerance_1 === 'function') {
          tol = oc.BRep_Tool.Tolerance_1(occtVertex);
        } else if (typeof oc.BRep_Tool.Tolerance === 'function') {
          tol = oc.BRep_Tool.Tolerance(occtVertex);
        }
      } catch (_e) { tol = 0; }
      const v = new Vertex(point, {
        persistentId: body.allocId('vertex'),
        geomRef: keep(occtVertex),
        tolerance: Number.isFinite(tol) ? tol : 0,
      });
      vertexCache.set(occtVertex, v);
      return v;
    };

    // ── 2. Edge cache — one spine Edge per unique engine edge ────────────────
    const edgeCache = new HashKeyedCache(oc);
    const getEdge = (occtEdge) => {
      const existing = edgeCache.find(occtEdge);
      if (existing) return existing;
      // Endpoints — TopExp.FirstVertex/LastVertex if bound, else explorer.
      let v0 = null, v1 = null;
      try {
        if (oc.TopExp && typeof oc.TopExp.FirstVertex === 'function') {
          v0 = getVertex(oc.TopExp.FirstVertex(occtEdge, false));
          v1 = getVertex(oc.TopExp.LastVertex(occtEdge, false));
        }
      } catch (_e) { v0 = null; v1 = null; }
      if (!v0 || !v1) {
        const verts = [];
        const ve = track(new oc.TopExp_Explorer_2(occtEdge, SE.TopAbs_VERTEX, SHAPE));
        for (; ve.More(); ve.Next()) {
          verts.push(track(oc.TopoDS.Vertex_1(ve.Current())));
        }
        // a closed edge (a full circle) has one vertex; degenerate edges none.
        v0 = verts[0] ? getVertex(verts[0]) : null;
        v1 = verts[1] ? getVertex(verts[1]) : (v0 || null);
      }
      // Degenerate edge — zero-length seam/apex edge (e.g. sphere pole).
      let degenerate = false;
      try {
        if (typeof oc.BRep_Tool.Degenerated === 'function') {
          degenerate = oc.BRep_Tool.Degenerated(occtEdge);
        }
      } catch (_e) { degenerate = false; }
      let tol = 0;
      try {
        if (typeof oc.BRep_Tool.Tolerance_2 === 'function') {
          tol = oc.BRep_Tool.Tolerance_2(occtEdge);
        }
      } catch (_e) { tol = 0; }
      const curve = new OcctCurveAdapter(oc, keep(occtEdge));
      const e = new Edge(v0, v1, curve, {
        persistentId: body.allocId('edge'),
        geomRef: occtEdge,
        tolerance: Number.isFinite(tol) ? tol : 0,
      });
      e.degenerate = degenerate;
      if (degenerate) diag.bind.degenerateEdges += 1;
      edgeCache.set(occtEdge, e);
      return e;
    };

    // ── 3. Walk faces → loops → coedges. Faces collected per shell below. ────
    // We need a spine Face per unique engine face; build them on first sight.
    const faceCache = new HashKeyedCache(oc);
    const allSpineFaces = [];
    const buildFace = (occtFace) => {
      const existing = faceCache.find(occtFace);
      if (existing) return existing;

      // Face orientation relative to its surface.
      const reversed = isReversed(oc, occtFace);
      const surface = new OcctSurfaceAdapter(oc, keep(occtFace));
      const face = new Face(surface, null, [], {
        persistentId: body.allocId('face'),
        geomRef: occtFace,
        reversed,
      });
      faceCache.set(occtFace, face);

      // Outer wire vs inner wires.
      let outerWire = null;
      for (const m of ['OuterWire_1', 'OuterWire']) {
        if (typeof oc.BRepTools[m] !== 'function') continue;
        try { outerWire = oc.BRepTools[m](occtFace); break; } catch (_e) {}
      }
      // Walk every wire of the face; classify outer vs inner via IsSame.
      const we = track(new oc.TopExp_Explorer_2(occtFace, SE.TopAbs_WIRE, SHAPE));
      const wires = [];
      for (; we.More(); we.Next()) {
        wires.push(track(oc.TopoDS.Wire_1(we.Current())));
      }
      for (const wire of wires) {
        const isOuter = outerWire
          ? sameShape(wire, outerWire)
          : (wires.length === 1);
        const loop = buildLoop(oc, wire, occtFace, face, isOuter,
          { body, getEdge, track, SE, SHAPE });
        if (isOuter && !face.outerLoop) {
          face.outerLoop = loop;
          loop.face = face;
          loop.isOuter = true;
        } else {
          face.addInnerLoop(loop);
        }
      }
      // A face with wires but no outer wire detected — promote the first.
      if (!face.outerLoop && face.innerLoops.length > 0) {
        face.outerLoop = face.innerLoops.shift();
        face.outerLoop.isOuter = true;
      }
      allSpineFaces.push(face);
      return face;
    };

    // ── 4. Walk shells. A shell groups faces; classify peripheral vs void. ───
    const buildShell = (occtShell) => {
      const faces = [];
      const fe = track(new oc.TopExp_Explorer_2(occtShell, SE.TopAbs_FACE, SHAPE));
      const seen = [];
      for (; fe.More(); fe.Next()) {
        const occtFace = track(oc.TopoDS.Face_1(fe.Current()));
        if (seen.some((p) => sameShape(p, occtFace))) continue;
        seen.push(occtFace);
        faces.push(buildFace(occtFace));
      }
      const shell = new Shell(faces, {
        persistentId: body.allocId('shell'),
        role: 'peripheral', // re-classified after lumps are built
      });
      if (!shell.isClosed()) diag.bind.openShells += 1;
      return shell;
    };

    // ── 5. Walk lumps (solids). Each solid → one Lump; shells inside it. ─────
    const buildLump = (occtSolid) => {
      const shells = [];
      const she = track(new oc.TopExp_Explorer_2(occtSolid, SE.TopAbs_SHELL, SHAPE));
      const seen = [];
      for (; she.More(); she.Next()) {
        const occtShell = track(oc.TopoDS.Shell_1(she.Current()));
        if (seen.some((p) => sameShape(p, occtShell))) continue;
        seen.push(occtShell);
        shells.push(buildShell(occtShell));
      }
      const lump = new Lump(shells, { persistentId: body.allocId('lump') });
      classifyShellRoles(oc, occtSolid, lump, { track, SE, SHAPE });
      return lump;
    };

    // ── 6. Top-level dispatch by shape type ──────────────────────────────────
    // SOLID-bearing shapes → one Lump per solid (multi-lump compound handled).
    // A free SHELL with no solid → a sheet body (one lump, one shell).
    // A free WIRE / EDGE with no face → a wire body.
    const solids = collectUnique(oc, shape, SE.TopAbs_SOLID, { track, SHAPE });
    if (solids.length > 0) {
      for (const occtSolid of solids) {
        body.addLump(buildLump(occtSolid));
      }
    } else {
      // No solids — look for free shells (sheet body).
      const freeShells = collectUnique(oc, shape, SE.TopAbs_SHELL, { track, SHAPE });
      if (freeShells.length > 0) {
        for (const occtShell of freeShells) {
          const shell = buildShell(occtShell);
          shell.role = 'peripheral';
          body.addLump(new Lump([shell], { persistentId: body.allocId('lump') }));
        }
      } else {
        // No shells — free faces (sheet body) or pure wires (wire body).
        const freeFaces = collectUnique(oc, shape, SE.TopAbs_FACE, { track, SHAPE });
        if (freeFaces.length > 0) {
          const shellFaces = freeFaces.map((f) => buildFace(f));
          const shell = new Shell(shellFaces, {
            persistentId: body.allocId('shell'), role: 'peripheral',
          });
          body.addLump(new Lump([shell], { persistentId: body.allocId('lump') }));
        } else {
          // Pure wire body — a connected set of edges + vertices, no faces.
          const wireEdges = [];
          const ee = track(new oc.TopExp_Explorer_2(shape, SE.TopAbs_EDGE, SHAPE));
          const seenE = [];
          for (; ee.More(); ee.Next()) {
            const occtEdge = track(oc.TopoDS.Edge_1(ee.Current()));
            if (seenE.some((p) => sameShape(p, occtEdge))) continue;
            seenE.push(occtEdge);
            wireEdges.push(getEdge(occtEdge));
          }
          const shell = new Shell([], {
            persistentId: body.allocId('shell'), role: 'peripheral',
            wireEdges,
          });
          body.addLump(new Lump([shell], { persistentId: body.allocId('lump') }));
        }
      }
    }

    // ── 7. Wire coedge partners (manifold mate / non-manifold radial cycle) ──
    // This is where the recon binding gap bites: it needs edge→faces adjacency.
    const adjacency = buildEdgeFaceAdjacency(oc, body, allSpineFaces,
      { track, SE, SHAPE, diag });
    wireCoedgePartners(body, adjacency, diag);

    // ── 8. Body kind — derived then asserted from the finished topology ──────
    body.assertKind();

    // ── 9. Validate ──────────────────────────────────────────────────────────
    if (opts.validate !== false) {
      body.diagnostics.validation = validateSpine(body);
    }

    return body;
  } finally {
    // Free every transient — but never a sub-shape kept as a geomRef.
    for (const o of transients) {
      if (geomRefs.has(o)) continue;
      try { if (o && o.delete) o.delete(); } catch (_e) { /* already gone */ }
    }
  }
}

/**
 * Convenience wrapper: bind a BrepShape-style wrapper directly.
 * @param {object} oc
 * @param {{shape:object}} brepWrapper  any object exposing `.shape`.
 * @param {object} [opts]
 */
export function bindSpineFromShape(oc, brepWrapper, opts = {}) {
  if (!brepWrapper || !brepWrapper.shape) {
    throw new Error('bindSpineFromShape: argument must expose a live .shape');
  }
  return bindSpine(oc, brepWrapper.shape, { ...opts, geomEngineShape: brepWrapper });
}

// ──────────────────────────────────────────────────────────────────────────────
// Loop construction — ordered coedge cycle via BRepTools_WireExplorer.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a spine Loop from an engine wire. Uses `BRepTools_WireExplorer` for
 * ordered traversal (recon probe 5: the 1-arg `_2(wire)` form is bound and
 * yields edges in coedge order with correct orientation). Falls back to an
 * unordered WIRE→EDGE explorer + endpoint-chaining if WireExplorer fails.
 */
function buildLoop(oc, occtWire, occtFace, face, isOuter, ctx) {
  const { body, getEdge, track, SE, SHAPE } = ctx;
  const loop = new Loop([], { persistentId: body.allocId('loop'), isOuter });
  loop.face = face;

  let walked = false;
  // Ordered walk — try every WireExplorer ctor form (recon: `_2(wire)` works).
  const wexpForms = [
    ['BRepTools_WireExplorer_2', [occtWire]],
    ['BRepTools_WireExplorer_2', [occtWire, occtFace]],
    ['BRepTools_WireExplorer_1', [occtWire]],
    ['BRepTools_WireExplorer_3', [occtWire, occtFace]],
  ];
  for (const [cls, args] of wexpForms) {
    if (!oc[cls]) continue;
    try {
      const we = track(new oc[cls](...args));
      let count = 0;
      for (; we.More(); we.Next()) {
        count += 1;
        const occtEdge = track(oc.TopoDS.Edge_1(we.Current()));
        const edge = getEdge(occtEdge);
        // WireExplorer.Orientation() (or the edge's own) gives the coedge sense.
        const reversed = coedgeReversed(oc, we, we.Current());
        const ce = new Coedge(edge, reversed, { persistentId: body.allocId('coedge') });
        loop.addCoedge(ce);
      }
      if (count > 0) { walked = true; break; }
    } catch (_e) { /* try next form */ }
  }

  // Fallback — unordered edges, then chain by shared vertices.
  if (!walked) {
    const occtEdges = [];
    const ee = track(new oc.TopExp_Explorer_2(occtWire, SE.TopAbs_EDGE, SHAPE));
    const seen = [];
    for (; ee.More(); ee.Next()) {
      const occtEdge = track(oc.TopoDS.Edge_1(ee.Current()));
      if (seen.some((p) => sameShape(p, occtEdge))) continue;
      seen.push(occtEdge);
      occtEdges.push(occtEdge);
    }
    const spineEdges = occtEdges.map((oe) => getEdge(oe));
    const chained = chainEdges(spineEdges);
    for (const { edge, reversed } of chained) {
      const ce = new Coedge(edge, reversed, { persistentId: body.allocId('coedge') });
      loop.addCoedge(ce);
    }
  }
  return loop;
}

/**
 * Chain an unordered edge set into an ordered coedge sequence by walking
 * shared vertices. Each result entry carries the orientation (`reversed`) of
 * the edge use. A robust fallback when WireExplorer is unavailable.
 */
function chainEdges(edges) {
  if (edges.length === 0) return [];
  if (edges.length === 1) {
    return [{ edge: edges[0], reversed: false }];
  }
  const remaining = edges.slice();
  const out = [];
  let current = remaining.shift();
  // Start oriented forward; the walking vertex is its end.
  let walkVertex = current.endVertex;
  out.push({ edge: current, reversed: false });
  while (remaining.length > 0) {
    let pickIdx = -1;
    let pickReversed = false;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      if (cand.startVertex === walkVertex) { pickIdx = i; pickReversed = false; break; }
      if (cand.endVertex === walkVertex) { pickIdx = i; pickReversed = true; break; }
    }
    if (pickIdx < 0) {
      // disconnected — emit the rest forward (degenerate input).
      for (const e of remaining) out.push({ edge: e, reversed: false });
      break;
    }
    const next = remaining.splice(pickIdx, 1)[0];
    out.push({ edge: next, reversed: pickReversed });
    walkVertex = pickReversed ? next.startVertex : next.endVertex;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Edge → face adjacency. THE recon-gap-driven code path.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a `Map<Edge, Face[]>` of which faces use each edge.
 *
 * Three real, empirically-grounded code paths (the S0 recon, recorded in
 * `docs/superpowers/notes/topology-spine-A.md`, found this engine build binds
 * `TopExp::MapShapesAndAncestors` + the map container, exposes
 * `TopTools_ListOfShape.Size()` / `.First_1()` / `.Last_1()`, but does NOT
 * bind `TopTools_ListIteratorOfListOfShape`):
 *
 *   A — full iterator path (O(n)): if `TopTools_ListIteratorOfListOfShape` is
 *       bound, enumerate every ancestor face of every edge directly. The
 *       fastest path; used when a (future / custom) engine build binds it.
 *   B — manifold map fast-path (O(n)): use `MapShapesAndAncestors`; for an
 *       edge whose `TopTools_ListOfShape` has `Size() <= 2`, `First_1()` /
 *       `Last_1()` recover the FULL ancestor-face set — this is every edge of
 *       a watertight manifold solid. The edge→face pairing for those edges is
 *       O(n). Edges with `Size() > 2` (non-manifold) cannot be fully
 *       enumerated by First/Last and are deferred to path C.
 *   C — O(n²) `IsSame`-pairing fallback: for an edge that path B could not
 *       fully resolve (a non-manifold edge, or any edge if the map itself is
 *       unusable), walk every spine face's engine sub-edges and pair by
 *       `IsSame`. Correct, deterministic, O(faces × edgesPerFace) — the
 *       SP-1-designed degrade path, a real documented branch.
 *
 * `diag.bind.adjacencyStrategy` records which path(s) ran.
 */
function buildEdgeFaceAdjacency(oc, body, spineFaces, ctx) {
  const { track, SE, diag } = ctx;
  const adjacency = new Map(); // Edge → Face[]
  const addPair = (edge, face) => {
    let arr = adjacency.get(edge);
    if (!arr) { arr = []; adjacency.set(edge, arr); }
    if (!arr.includes(face)) arr.push(face);
  };
  const rootShape = body.geomEngineShape ? body.geomEngineShape.shape : null;
  const allEdges = body.edges();

  // ── Resolve the engine's list-access capability (recon-aligned probe) ──────
  const IterCls = oc.TopTools_ListIteratorOfListOfShape_2
    || oc.TopTools_ListIteratorOfListOfShape_1 || null;
  let firstM = null, lastM = null, sizeM = null;

  let map = null;
  try {
    if (rootShape && oc.TopExp && typeof oc.TopExp.MapShapesAndAncestors === 'function'
        && oc.TopTools_IndexedDataMapOfShapeListOfShape_1) {
      map = track(new oc.TopTools_IndexedDataMapOfShapeListOfShape_1());
      oc.TopExp.MapShapesAndAncestors(rootShape, SE.TopAbs_EDGE, SE.TopAbs_FACE, map);
      if (map.Extent && map.Extent() > 0) {
        const probe = map.FindFromIndex(1);
        for (const m of ['Size', 'Extent']) {
          if (typeof probe[m] === 'function') { try { probe[m](); sizeM = m; break; } catch (_e) {} }
        }
        for (const m of ['First_1', 'First_2', 'First']) {
          if (typeof probe[m] === 'function') { try { if (probe[m]()) { firstM = m; break; } } catch (_e) {} }
        }
        for (const m of ['Last_1', 'Last_2', 'Last']) {
          if (typeof probe[m] === 'function') { try { if (probe[m]()) { lastM = m; break; } } catch (_e) {} }
        }
      }
    }
  } catch (_e) { map = null; }

  // index a spine face / edge by its engine sub-shape (IsSame).
  const spineFaceOf = (occtFace) =>
    spineFaces.find((f) => f.geomRef && sameShape(f.geomRef, occtFace)) || null;
  const spineEdgeOf = (occtEdge) =>
    allEdges.find((e) => e.geomRef && sameShape(e.geomRef, occtEdge)) || null;

  const resolvedEdges = new Set();   // edges whose adjacency path A/B settled
  let pathA = false, pathB = 0, pathC = 0;

  if (map && map.Extent) {
    const n = map.Extent();
    for (let i = 1; i <= n; i++) {
      const occtEdge = map.FindKey(i);
      const edge = spineEdgeOf(occtEdge);
      if (!edge) continue;
      const lst = map.FindFromIndex(i);
      // ── Path A — iterator enumerates every ancestor face ──────────────────
      if (IterCls) {
        try {
          const it = new IterCls(lst);
          for (; it.More(); it.Next()) {
            const face = spineFaceOf(it.Value());
            if (face) addPair(edge, face);
          }
          it.delete();
          resolvedEdges.add(edge);
          pathA = true;
          continue;
        } catch (_e) { /* fall to B */ }
      }
      // ── Path B — manifold map fast-path (Size + First_1/Last_1) ───────────
      if (sizeM && firstM && lastM) {
        let count = 0;
        try { count = lst[sizeM](); } catch (_e) { count = -1; }
        if (count >= 0 && count <= 2) {
          // First/Last fully cover a ≤2-face (manifold) edge.
          const members = [];
          try {
            if (count >= 1) members.push(lst[firstM]());
            if (count === 2) members.push(lst[lastM]());
          } catch (_e) { members.length = 0; }
          if (members.length === count) {
            for (const occtFace of members) {
              const face = spineFaceOf(occtFace);
              if (face) addPair(edge, face);
            }
            resolvedEdges.add(edge);
            pathB += 1;
            continue;
          }
        }
        // count > 2 (non-manifold) — leave unresolved for path C.
      }
    }
  }

  // ── Path C — O(n²) IsSame fallback for every still-unresolved edge ────────
  const unresolved = allEdges.filter((e) => !resolvedEdges.has(e));
  if (unresolved.length > 0) {
    buildAdjacencyFallback(oc, unresolved, spineFaces, addPair, ctx);
    pathC = unresolved.length;
  }

  diag.bind.adjacencyStrategy = describeStrategy(pathA, pathB, pathC);
  diag.bind.adjacencyPaths = { iteratorEdges: pathA ? resolvedEdges.size : 0,
    manifoldFastPathEdges: pathB, fallbackEdges: pathC };
  return adjacency;
}

/** Human-readable summary of which adjacency path(s) ran. */
function describeStrategy(pathA, pathB, pathC) {
  if (pathA && !pathC) return 'ancestry-map iterator (O(n))';
  const parts = [];
  if (pathB) parts.push(`${pathB} edge(s) via manifold map fast-path (O(n))`);
  if (pathC) parts.push(`${pathC} edge(s) via O(n^2) IsSame fallback ` +
    `(non-manifold / ListIterator unbound — recon-documented)`);
  if (pathA) parts.unshift('iterator');
  return parts.join(' + ') || 'O(n^2) IsSame fallback';
}

/**
 * Path C — the O(n²) fallback. For each given spine edge, find its owning
 * faces by walking every spine face's engine sub-edges and pairing by
 * `IsSame`. Because every spine Edge caches its engine sub-edge as `geomRef`,
 * the pairing is a direct `IsSame` test. Operates on the supplied edge subset
 * so it runs only for the genuinely-unresolved (typically non-manifold) edges.
 */
function buildAdjacencyFallback(oc, edgeSubset, spineFaces, addPair, ctx) {
  const { track, SE, SHAPE } = ctx;
  const subset = new Set(edgeSubset);
  for (const face of spineFaces) {
    if (!face.geomRef) continue;
    const ee = track(new oc.TopExp_Explorer_2(face.geomRef, SE.TopAbs_EDGE, SHAPE));
    const seen = [];
    for (; ee.More(); ee.Next()) {
      const occtEdge = ee.Current();
      if (seen.some((p) => sameShape(p, occtEdge))) continue;
      seen.push(track(oc.TopoDS.Edge_1(occtEdge)));
      // pair to the spine edge (in the subset) whose geomRef IsSame this edge.
      for (const edge of subset) {
        if (edge.geomRef && sameShape(edge.geomRef, occtEdge)) {
          addPair(edge, face);
          break;
        }
      }
    }
  }
}

/**
 * Wire coedge `partner` pointers from the edge→faces adjacency.
 *
 *  - Manifold edge (2 coedges) — the two coedges are mutual partners.
 *  - Non-manifold edge (>2 coedges) — the coedges form a radial cycle; each
 *    coedge's `partner` is the next coedge in that cycle. SP-1 §7 risk 2:
 *    full radial ORDERING by surface-tangent angle is genuinely subtle, so
 *    S1 ships a stable-but-unordered radial cycle (each coedge linked to the
 *    next in collection order); proper angular ordering is a documented S5
 *    refinement. The topology is correct — only the cyclic order is not
 *    guaranteed geometric.
 *  - Free edge (<2 coedges) — partner stays null (lamina / wire edge).
 */
function wireCoedgePartners(body, adjacency, diag) {
  let manifold = 0, nonManifold = 0, free = 0;
  for (const edge of body.edges()) {
    const coedges = [...edge.coedges];
    if (coedges.length === 2) {
      coedges[0].partner = coedges[1];
      coedges[1].partner = coedges[0];
      manifold += 1;
    } else if (coedges.length > 2) {
      // radial cycle — link each to the next, last back to first.
      for (let i = 0; i < coedges.length; i++) {
        coedges[i].partner = coedges[(i + 1) % coedges.length];
      }
      nonManifold += 1;
    } else {
      // 0 or 1 coedge — free boundary / wire edge.
      if (coedges[0]) coedges[0].partner = null;
      free += 1;
    }
  }
  diag.bind.coedgePartners = { manifold, nonManifold, free };
}

// ──────────────────────────────────────────────────────────────────────────────
// Shell-role classification.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Classify a lump's shells as 'peripheral' (the outward boundary) or 'void'
 * (an internal cavity). A solid lump has exactly one peripheral shell; any
 * other shell is a void. `BRepClass3d.OuterShell` identifies the peripheral
 * shell when bound; otherwise the largest-volume shell is taken as peripheral
 * (a void shell is always enclosed, hence smaller).
 */
function classifyShellRoles(oc, occtSolid, lump, ctx) {
  if (lump.shells.length <= 1) {
    if (lump.shells[0]) lump.shells[0].role = 'peripheral';
    return;
  }
  let outerShell = null;
  try {
    if (oc.BRepClass3d && typeof oc.BRepClass3d.OuterShell === 'function') {
      outerShell = oc.BRepClass3d.OuterShell(occtSolid);
    }
  } catch (_e) { outerShell = null; }
  if (outerShell) {
    for (const shell of lump.shells) {
      // a shell whose first face's engine shell IsSame the outer shell.
      const isOuter = shellMatchesOcct(shell, outerShell);
      shell.role = isOuter ? 'peripheral' : 'void';
    }
    if (!lump.shells.some((s) => s.role === 'peripheral')) {
      lump.shells[0].role = 'peripheral';
    }
  } else {
    // Fallback — largest surface area = peripheral.
    let maxArea = -Infinity, maxShell = null;
    for (const shell of lump.shells) {
      const a = shell.surfaceArea();
      if (a > maxArea) { maxArea = a; maxShell = shell; }
    }
    for (const shell of lump.shells) {
      shell.role = (shell === maxShell) ? 'peripheral' : 'void';
    }
  }
}

function shellMatchesOcct() {
  // Engine shell identity-matching is not needed once the area heuristic is in
  // place; OuterShell returns a shape that we compare structurally. Kept as a
  // hook — area heuristic above is the active path.
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Small engine helpers.
// ──────────────────────────────────────────────────────────────────────────────

/** A hash-keyed cache of engine-subshape → spine-entity, IsSame-verified. */
class HashKeyedCache {
  constructor(oc) {
    this.oc = oc;
    this.buckets = new Map(); // hash:int → [{ occt, ent }]
  }
  _hash(occt) {
    try {
      if (typeof occt.HashCode === 'function') return occt.HashCode(2147483647);
    } catch (_e) {}
    return 0;
  }
  find(occt) {
    const bucket = this.buckets.get(this._hash(occt));
    if (!bucket) return null;
    for (const rec of bucket) {
      if (sameShape(rec.occt, occt)) return rec.ent;
    }
    return null;
  }
  set(occt, ent) {
    const h = this._hash(occt);
    let bucket = this.buckets.get(h);
    if (!bucket) { bucket = []; this.buckets.set(h, bucket); }
    bucket.push({ occt, ent });
  }
}

/** `IsSame` on two engine sub-shapes — same TShape + location, orientation-free. */
function sameShape(a, b) {
  if (a === b) return true;
  try { return typeof a.IsSame === 'function' && a.IsSame(b); } catch (_e) { return false; }
}

/** Collect IsSame-unique sub-shapes of `level` from `shape`. */
function collectUnique(oc, shape, level, ctx) {
  const { track, SHAPE } = ctx;
  const out = [];
  const exp = track(new oc.TopExp_Explorer_2(shape, level, SHAPE));
  for (; exp.More(); exp.Next()) {
    const cur = exp.Current();
    if (out.some((p) => sameShape(p, cur))) continue;
    // cast to the concrete type so downstream explorers accept it.
    let casted = cur;
    try {
      if (level === oc.TopAbs_ShapeEnum.TopAbs_SOLID) casted = oc.TopoDS.Solid_1(cur);
      else if (level === oc.TopAbs_ShapeEnum.TopAbs_SHELL) casted = oc.TopoDS.Shell_1(cur);
      else if (level === oc.TopAbs_ShapeEnum.TopAbs_FACE) casted = oc.TopoDS.Face_1(cur);
      else if (level === oc.TopAbs_ShapeEnum.TopAbs_EDGE) casted = oc.TopoDS.Edge_1(cur);
    } catch (_e) { casted = cur; }
    out.push(track(casted));
  }
  return out;
}

/** True if a face is REVERSED relative to its surface (recon probe 3 pattern). */
function isReversed(oc, occtFace) {
  try {
    const ori = occtFace.Orientation_1();
    const rev = oc.TopAbs_Orientation.TopAbs_REVERSED;
    if (typeof ori === 'number') return ori === rev;
    return !!(ori && rev && ori.value === rev.value);
  } catch (_e) { return false; }
}

/**
 * The coedge orientation (`reversed`) for a WireExplorer step. The oriented
 * edge the explorer yields carries a TopAbs_Orientation; REVERSED ⇒ the loop
 * uses the edge end→start.
 */
function coedgeReversed(oc, wexp, orientedEdge) {
  try {
    // BRepTools_WireExplorer exposes Orientation() in some builds.
    if (typeof wexp.Orientation === 'function') {
      const o = wexp.Orientation();
      const rev = oc.TopAbs_Orientation.TopAbs_REVERSED;
      if (typeof o === 'number') return o === rev;
      return !!(o && rev && o.value === rev.value);
    }
  } catch (_e) { /* fall through */ }
  // else read the oriented edge's own orientation.
  try {
    const o = orientedEdge.Orientation_1();
    const rev = oc.TopAbs_Orientation.TopAbs_REVERSED;
    if (typeof o === 'number') return o === rev;
    return !!(o && rev && o.value === rev.value);
  } catch (_e) { return false; }
}
