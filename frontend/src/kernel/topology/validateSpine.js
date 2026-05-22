/**
 * ArchDisc Topology Spine — validateSpine
 *
 * SP-1 Stage S0. The verification instrument (SP-1 §2.6): a pass that checks a
 * spine `Body` is structurally consistent and Euler-Poincaré-valid.
 *
 * It is NOT a runtime production gate — it would cost performance. SP-1
 * MAINTAINS the invariant by construction (`bindSpine` produces consistent
 * graphs) and CHECKS it exhaustively here, in dev/test builds and in every
 * stage's e2e. Genuine incremental Euler-operator maintenance is SP-3's job.
 *
 * Checks performed:
 *   1. Euler-Poincaré consistency (`Body.checkEulerPoincare`).
 *   2. Every loop is closed and chain-continuous.
 *   3. Every coedge belongs to a loop and uses an edge.
 *   4. Every edge's coedge count matches its manifold classification, and a
 *      free-boundary edge (<2 coedges) is only allowed on a sheet/wire body.
 *   5. Every face's loops reference only that face's coedges; exactly one
 *      outer loop.
 *   6. Persistent ids are present and unique within the body.
 *   7. The body kind is consistent with `deriveKind()`.
 *   8. Back-references are wired (face.shell, shell.lump, lump.body, etc.).
 *
 * Returns a structured report; never throws. `report.ok` is the overall pass.
 */

/**
 * @param {import('./Body.js').default} body
 * @param {object} [opts]
 * @param {boolean} [opts.strict]  if true, treat warnings as failures.
 * @returns {{ok:boolean, errors:string[], warnings:string[],
 *   euler:object, counts:object, body:string}}
 */
export default function validateSpine(body, opts = {}) {
  const errors = [];
  const warnings = [];
  const strict = !!opts.strict;

  if (!body || body.type !== 'body') {
    return {
      ok: false, errors: ['validateSpine: argument is not a spine Body'],
      warnings: [], euler: null, counts: null, body: '(none)',
    };
  }

  const kind = body.kind || body.deriveKind();
  const lumps = body.lumps || [];
  const shells = body.shells();
  const faces = body.faces();
  const loops = body.loops();
  const coedges = body.coedges();
  const edges = body.edges();
  const vertices = body.vertices();

  // ── 1. Euler-Poincaré ──────────────────────────────────────────────────────
  const euler = body.checkEulerPoincare();
  if (!euler.ok) {
    errors.push(`Euler-Poincaré: ${euler.note}`);
  }

  // ── 2. Loop closure + chain continuity ─────────────────────────────────────
  for (const loop of loops) {
    if (loop.coedges.length === 0) {
      errors.push(`Loop ${loopTag(loop)} has no coedges.`);
      continue;
    }
    if (!loop.isClosed()) {
      errors.push(`Loop ${loopTag(loop)} is not closed ` +
        `(first coedge start != last coedge end).`);
    }
    if (!loop.isChainContinuous()) {
      errors.push(`Loop ${loopTag(loop)} is not chain-continuous ` +
        `(a coedge end != next coedge start).`);
    }
  }

  // ── 3. Coedge integrity ────────────────────────────────────────────────────
  for (const ce of coedges) {
    if (!ce.loop) errors.push(`Coedge ${ceTag(ce)} has no owning loop.`);
    if (!ce.edge) errors.push(`Coedge ${ceTag(ce)} uses no edge.`);
    if (ce.edge && !ce.edge.coedges.has(ce)) {
      errors.push(`Coedge ${ceTag(ce)} is not registered on its edge.`);
    }
  }

  // ── 4. Edge manifold classification + free-boundary rule ───────────────────
  let nonManifoldEdgeCount = 0;
  let freeBoundaryEdgeCount = 0;
  let degenerateEdgeCount = 0;
  for (const edge of edges) {
    const n = edge.coedges.size;
    const degenerate = edge.isDegenerate();
    if (degenerate) degenerateEdgeCount += 1;
    if (n > 2) nonManifoldEdgeCount += 1;
    if (n < 2 && !degenerate) freeBoundaryEdgeCount += 1;
    // A free-boundary edge with exactly 1 coedge is a lamina edge — only valid
    // on a sheet body. A 0-coedge edge is a wire edge — valid on a wire body
    // (or as a mixed-shell wire edge). On a solid body neither is allowed —
    // EXCEPT a degenerate edge (a zero-length seam/apex edge, e.g. a sphere
    // pole), which is a topological artefact bounding nothing and is allowed
    // to carry <2 coedges on any body kind.
    if (n === 1 && kind === 'solid' && !degenerate) {
      errors.push(`Edge ${edgeTag(edge)} has 1 coedge (free boundary) on a ` +
        `'solid' body — a solid must have every non-degenerate edge shared ` +
        `by ≥2 coedges.`);
    }
    if (n === 0 && !degenerate) {
      // a dangling edge — only legitimate as a wire edge on some shell
      const onWireShell = shells.some(s => s.wireEdges.has(edge));
      if (!onWireShell) {
        warnings.push(`Edge ${edgeTag(edge)} has 0 coedges and is not a ` +
          `registered wire edge of any shell.`);
      }
    }
    // Manifold/non-manifold classification self-consistency (degenerate edges
    // are exempt — they are neither manifold nor a real boundary).
    if (!degenerate) {
      if (edge.isManifold() && n !== 2) {
        errors.push(`Edge ${edgeTag(edge)} isManifold() but coedge count is ${n}.`);
      }
      if (edge.isNonManifold() && n <= 2) {
        errors.push(`Edge ${edgeTag(edge)} isNonManifold() but coedge count is ${n}.`);
      }
    }
  }

  // ── 5. Face loop structure ─────────────────────────────────────────────────
  for (const face of faces) {
    if (!face.outerLoop) {
      errors.push(`Face ${faceTag(face)} has no outer loop.`);
    }
    let outerCount = 0;
    for (const loop of face.allLoops()) {
      if (loop.face !== face) {
        errors.push(`Face ${faceTag(face)}: a loop's .face back-pointer is wrong.`);
      }
      if (loop.isOuter) outerCount += 1;
      // Every coedge of this loop must reference this loop.
      for (const ce of loop.coedges) {
        if (ce.loop !== loop) {
          errors.push(`Face ${faceTag(face)}: a coedge of a loop does not ` +
            `point back to that loop.`);
        }
      }
    }
    if (face.outerLoop && outerCount !== 1) {
      errors.push(`Face ${faceTag(face)} has ${outerCount} outer loops (expected 1).`);
    }
  }

  // ── 6. Persistent-id presence + uniqueness ─────────────────────────────────
  const seenIds = new Map();
  const entitiesById = [
    ...lumps, ...shells, ...faces, ...loops, ...coedges, ...edges, ...vertices,
  ];
  let missingIdCount = 0;
  for (const ent of entitiesById) {
    const pid = ent.persistentId;
    if (!pid) {
      missingIdCount += 1;
      continue;
    }
    if (seenIds.has(pid)) {
      errors.push(`Duplicate persistent id '${pid}' ` +
        `(${ent.type} and ${seenIds.get(pid)}).`);
    } else {
      seenIds.set(pid, ent.type);
    }
  }
  if (missingIdCount > 0) {
    errors.push(`${missingIdCount} spine entit${missingIdCount === 1 ? 'y has' : 'ies have'} ` +
      `no persistent id.`);
  }

  // ── 7. Body kind consistency ───────────────────────────────────────────────
  const derivedKind = body.deriveKind();
  if (kind !== derivedKind) {
    errors.push(`Body kind '${kind}' disagrees with topology-derived ` +
      `kind '${derivedKind}'.`);
  }

  // ── 8. Back-reference wiring ────────────────────────────────────────────────
  // `.shell` and `.lump` are single-valued convenience back-pointers. A
  // non-manifold face legitimately belongs to >1 shell; its `.shell` then
  // points to ONE of them — so the check is "`.shell` is a shell that
  // contains the face", not strict identity with every owning shell.
  const shellsContainingFace = new Map(); // Face → Set<Shell>
  for (const lump of lumps) {
    if (lump.body !== body) errors.push(`Lump ${lump.persistentId}: .body back-pointer wrong.`);
    for (const shell of lump.shells) {
      if (shell.lump !== lump) errors.push(`Shell ${shell.persistentId}: .lump back-pointer wrong.`);
      for (const face of shell.faces) {
        let set = shellsContainingFace.get(face);
        if (!set) { set = new Set(); shellsContainingFace.set(face, set); }
        set.add(shell);
      }
    }
  }
  for (const [face, owningShells] of shellsContainingFace) {
    if (!face.shell || !owningShells.has(face.shell)) {
      errors.push(`Face ${faceTag(face)}: .shell back-pointer is not one of ` +
        `its ${owningShells.size} owning shell(s).`);
    }
  }

  const counts = {
    kind,
    lumps: lumps.length,
    shells: shells.length,
    faces: faces.length,
    loops: loops.length,
    coedges: coedges.length,
    edges: edges.length,
    vertices: vertices.length,
    nonManifoldEdges: nonManifoldEdgeCount,
    freeBoundaryEdges: freeBoundaryEdgeCount,
    degenerateEdges: degenerateEdgeCount,
  };

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, euler, counts, body: body.toString() };
}

// ── compact entity tags for messages ──────────────────────────────────────────
function loopTag(l) { return l.persistentId || `lp#${l.transientId}`; }
function ceTag(c) { return c.persistentId || `ce#${c.transientId}`; }
function edgeTag(e) { return e.persistentId || `e#${e.transientId}`; }
function faceTag(f) { return f.persistentId || `f#${f.transientId}`; }
