/**
 * ArchDisc Topology Spine — validateSpine
 *
 * SP-1 Stage S0 / S5. The verification instrument (SP-1 §2.6): a pass that
 * checks a spine `Body` is structurally consistent and Euler-Poincaré-valid.
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
 *   7. The body kind is consistent with `deriveKind()` and any declared kind
 *      (S5: every op's `declaredKind` must agree with the topology-derived
 *      kind — `diagnostics.kindMismatch` is an error).
 *   8. Back-references are wired (face.shell, shell.lump, lump.body, etc.).
 *   9. S5: on every non-manifold edge the radial coedge cycle is angularly
 *      ordered around the edge tangent — a Parasolid invariant. The check
 *      reads the per-coedge angles populated by `orderRadialCoedgesAngularly`
 *      during `bindSpine` and asserts monotonic progression around 2π.
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

  // ── 7. Body kind consistency (S5 — declaredKind reconciliation) ────────────
  const derivedKind = body.deriveKind();
  if (kind !== derivedKind) {
    errors.push(`Body kind '${kind}' disagrees with topology-derived ` +
      `kind '${derivedKind}'.`);
  }
  // S5: an op-declared kind that disagrees with the topology-derived kind is
  // a genuine error — the op claimed something the topology contradicts. The
  // `kindMismatch` diagnostic is populated by `Body.assertKind` whenever the
  // declared kind does not match the derived kind.
  if (body.diagnostics && body.diagnostics.kindMismatch) {
    const km = body.diagnostics.kindMismatch;
    errors.push(`declared kind '${km.declared}' disagrees with topology-derived ` +
      `'${km.derived}' — op contract violation (S5 first-class taxonomy).`);
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

  // ── 9. Non-manifold radial coedge ordering (S5 first-class) ────────────────
  // For every non-manifold edge (>2 coedges) the radial cycle must be ordered
  // ANGULARLY around the edge tangent — the Parasolid invariant. bindSpine's
  // `orderRadialCoedgesAngularly` populates each coedge's `radialAngle` field;
  // here we assert (a) every coedge on a non-manifold edge HAS an angle,
  // (b) the angles are monotonically increasing around 2π in the same order
  // the partner-cycle walks them.
  const radial = {
    nmEdgesChecked: 0,
    nmEdgesOrdered: 0,
    nmEdgesUnordered: 0,
    nmCoedgesMissingAngle: 0,
  };
  for (const edge of edges) {
    if (edge.coedges.size <= 2) continue;
    radial.nmEdgesChecked += 1;
    const ces = [...edge.coedges];
    const angles = ces.map(ce => Number.isFinite(ce.radialAngle) ? ce.radialAngle : null);
    if (angles.some(a => a === null)) {
      radial.nmCoedgesMissingAngle += angles.filter(a => a === null).length;
      warnings.push(`Edge ${edgeTag(edge)} non-manifold: ${angles.filter(a => a === null).length}` +
        ` of ${ces.length} coedges have no radial angle (unordered cycle).`);
      radial.nmEdgesUnordered += 1;
      continue;
    }
    // Walk the partner cycle and verify angles are monotonically increasing
    // (mod 2π). Walk N steps from coedge 0 and check angle progression.
    const ordered = isRadialCycleMonotonic(ces, angles);
    if (!ordered) {
      errors.push(`Edge ${edgeTag(edge)} non-manifold radial coedge cycle is ` +
        `NOT angularly ordered (S5 invariant violated): angles ${angles.map(a => a.toFixed(3)).join(', ')}.`);
      radial.nmEdgesUnordered += 1;
    } else {
      radial.nmEdgesOrdered += 1;
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
    radial,
  };

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, euler, counts, body: body.toString() };
}

/**
 * Verify a radial coedge cycle is monotonically ordered by angle.
 *
 * The cycle is built by `wireCoedgePartners` so that coedge[i].partner ===
 * coedge[i+1]. After `orderRadialCoedgesAngularly` sorts the list, walking
 * partners from any starting coedge must yield strictly monotonically
 * increasing angles (mod 2π). A monotone walk has exactly ONE wrap-around
 * point (where angle decreases past 2π back to start); >1 wrap = unordered.
 *
 * @param {import('./Coedge.js').default[]} ces  coedges in partner-cycle order.
 * @param {number[]} angles  each coedge's radial angle (rad ∈ [0, 2π)).
 * @returns {boolean}
 */
function isRadialCycleMonotonic(ces, angles) {
  // ces should be in partner-cycle order; verify by walking partners.
  const n = ces.length;
  if (n < 3) return true;
  // Find the index of ces[0] inside the partner-walk starting at ces[0].
  // Easier: walk partners and read angles in walk order.
  const walked = [];
  let cur = ces[0];
  const seen = new Set();
  for (let i = 0; i < n + 1; i++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    walked.push(cur);
    if (!cur.partner) return false;
    cur = cur.partner;
  }
  if (walked.length !== n) return false;
  const walkAngles = walked.map(c => Number.isFinite(c.radialAngle) ? c.radialAngle : 0);
  // Count wrap-arounds (places where next < cur). A monotone cyclic sequence
  // has exactly 1 wrap-around going around the full cycle.
  let wraps = 0;
  for (let i = 0; i < n; i++) {
    const a = walkAngles[i];
    const b = walkAngles[(i + 1) % n];
    if (b < a - 1e-9) wraps += 1;
  }
  return wraps === 1;
}

// ── compact entity tags for messages ──────────────────────────────────────────
function loopTag(l) { return l.persistentId || `lp#${l.transientId}`; }
function ceTag(c) { return c.persistentId || `ce#${c.transientId}`; }
function edgeTag(e) { return e.persistentId || `e#${e.transientId}`; }
function faceTag(f) { return f.persistentId || `f#${f.transientId}`; }
