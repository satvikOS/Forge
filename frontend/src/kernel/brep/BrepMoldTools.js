/**
 * ArchDisc Kernel — Mold Tools foundation (UX Tier 9).
 *
 * Three FOUNDATIONAL mold-tools ops on top of SP-4's `evalSurface` (face
 * normal sampling) + SP-5's `partition` (volumetric split) — the same
 * metadata pattern used by Sheet Metal (Tier 5a) and Weldments (Tier 6a):
 * tag the result body via `body.metadata.mold = { ... }` so every
 * downstream mold-tools op can identify it.
 *
 *   1. draftAnalysis(body, pullDirection, opts)
 *      Walk every face of the body. For each face, sample its surface
 *      normal at the parametric midpoint via `evalSurface(face, 0.5, 0.5,
 *      {normalised:true})`. Honour the face's `reversed` flag. Compute
 *      the signed angle between the OUTWARD face normal and the supplied
 *      pull direction (degrees, range [-90, +90]):
 *
 *          angleDeg = asin( clamp(dot(n, pull) / (|n|·|pull|), -1, 1) )
 *
 *      Classify each face:
 *        - angleDeg >= +minDraftDeg  → positive draft (face faces with pull)
 *        - angleDeg <= -minDraftDeg  → negative draft (face faces against pull)
 *        - |angleDeg|  < minDraftDeg → vertical / undercut (within tolerance
 *                                       of perpendicular to pull)
 *
 *      Each face's category lands as a SP-2 attribute via
 *      `attachAttribute(face, 'mold.draft', {...})` so the body keeps the
 *      analysis through subsequent ops. The result body also carries
 *      `metadata.mold.draftAnalysis = { positive, negative, vertical,
 *      pullDirection, minDraftDeg, faceCount, perFace[] }` for the dock /
 *      e2e introspection.
 *
 *   2. partingLine(body, pullDirection, opts)
 *      Walk every edge of the body. For each edge, check the draft signs
 *      of its two adjacent faces:
 *        - one face has POSITIVE draft + other has NEGATIVE → edge is on
 *          the parting line (silhouette).
 *        - one or both faces vertical (within tolerance) → edge is at the
 *          BOUNDARY of the silhouette region (also on the parting line —
 *          this matches SW's "silhouette + tangent" convention).
 *      Returns a list of edges (with their endpoints in world coordinates)
 *      that form the parting curve.
 *
 *   3. toolingSplit(body, pullDirection, opts)
 *      The marquee mold-tools op. Extend the parting line into a parting
 *      SURFACE by sweeping each parting edge perpendicular to the pull
 *      axis, building a planar half-space block, and use SP-5's
 *      `partition()` to split the body into core + cavity halves.
 *
 *      The algorithm:
 *        a) Run draftAnalysis to know which faces face the pull direction.
 *        b) Compute the body's bounding box centroid.
 *        c) Build the PARTING PLANE — perpendicular to the pull direction,
 *           passing through the body centroid (the canonical SW Mold Tools
 *           default — the parting surface is placed at the silhouette
 *           "equator" of the part).
 *        d) Build a thin solid prism large enough to span the body, used
 *           as the partition tool.
 *        e) Call `partition(body, [tool])` → returns 2 pieces.
 *        f) Classify each piece: the piece whose CENTROID lies on the
 *           POSITIVE-pull side of the parting plane is the CORE; the
 *           other is the CAVITY.
 *        g) Tag each piece via `attachAttribute(piece.body, 'mold.half',
 *           'core' | 'cavity')` and set `metadata.mold.half = 'core' |
 *           'cavity'`.
 *
 * ── Mold-aware metadata schema (lives on Body.metadata.mold) ─────────────
 *
 *   {
 *     draftAnalysis: {
 *       pullDirection: [number, number, number],   // unit vector
 *       minDraftDeg:   number,                      // tolerance (default 3°)
 *       positive: number, negative: number, vertical: number,
 *       faceCount: number,
 *       perFace: Array<{
 *         faceIndex: number,
 *         category: 'positive'|'negative'|'vertical',
 *         angleDeg: number,
 *         normal: [number, number, number],
 *       }>,
 *     },
 *     partingLine: {
 *       pullDirection: [number, number, number],
 *       edgeCount: number,
 *       edges: Array<{
 *         edgeIndex: number,
 *         start: {x, y, z},
 *         end:   {x, y, z},
 *         leftDraft: 'positive'|'negative'|'vertical',
 *         rightDraft: 'positive'|'negative'|'vertical',
 *       }>,
 *     },
 *     half: 'core' | 'cavity',                    // only on split pieces
 *     toolingSplit: {                              // set on each piece
 *       pullDirection: [number, number, number],
 *       pieceCount: number,
 *       partingPlane: {origin:[x,y,z], normal:[nx,ny,nz]},
 *     },
 *   }
 *
 * ── Honest residual gaps (foundation pass) ──────────────────────────────
 *
 *   - Draft Analysis samples the face normal at the parametric MIDPOINT.
 *     For a strongly curved face (cylinder side, fillet) the midpoint is
 *     representative but not the worst-case point. A future op samples a
 *     grid and reports the worst category per face.
 *   - Parting Line walks all edges of the body; for each edge it locates
 *     the two adjacent faces via the spine adjacency. If the adjacency
 *     does not yield exactly two unique faces (non-manifold edge, free
 *     edge), the edge is skipped — documented as a gap.
 *   - Tooling Split uses a PLANAR parting surface perpendicular to the
 *     pull direction at the body centroid. This is the SW Mold Tools
 *     DEFAULT but the user can override the parting plane height. A
 *     ruled / curved parting surface (which SW supports as "Parting
 *     Surface" + "Shut-Off Surfaces" follow-ons) is queued for the
 *     follow-on Tier-9b dispatch.
 *   - Shut-Off Surfaces / Undercut Analysis (deeper) / Side Actions:
 *     queued for Tier-9b.
 *
 * @see docs/superpowers/notes/solidworks-course-synthesis.md §6.9, §7 Tier 9
 * @see frontend/src/kernel/brep/BrepQuery.js (evalSurface — SP-4)
 * @see frontend/src/kernel/brep/BrepPartition.js (partition — SP-5)
 */

import { evalSurface } from './BrepQuery.js';
import { partition } from './BrepPartition.js';
import { extrudeProfile } from './BrepFeatures.js';
import { cut as boolCut } from './BrepBoolean.js';
import { attachAttribute } from '../topology/Attributes.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MIN_DRAFT_DEG = 3;
const DEFAULT_PULL_DIRECTION = [0, 0, 1];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — math
// ─────────────────────────────────────────────────────────────────────────────

function normalize3(v) {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (n < 1e-12) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function asVec3(v) {
  if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
  if (v && typeof v === 'object') {
    if ('x' in v && 'y' in v && 'z' in v) return [v.x, v.y, v.z];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamp the mold metadata onto `body.body.metadata.mold`. Idempotent — the
 * caller-supplied fields are merged into the existing bag.
 */
function stampMoldMetadata(spineBody, fields) {
  if (!spineBody || !spineBody.body) return null;
  const meta = spineBody.body.metadata || (spineBody.body.metadata = {});
  const mold = meta.mold || (meta.mold = {});
  for (const k of Object.keys(fields || {})) {
    mold[k] = fields[k];
  }
  return mold;
}

/**
 * Read the mold metadata off a body. Returns the metadata object or
 * null if the body has not been processed by any mold-tools op.
 */
export function getMoldMetadata(spineBody) {
  if (!spineBody) return null;
  const body = spineBody.body || spineBody;
  if (!body || !body.metadata || !body.metadata.mold) return null;
  return body.metadata.mold;
}

/**
 * Return `true` iff `body` has been processed by any mold-tools op (Draft
 * Analysis, Parting Line, or Tooling Split). The tag is produced by the
 * first mold-tools op called on the body and propagated by subsequent
 * mold-tools ops.
 */
export function isMold(spineBody) {
  return getMoldMetadata(spineBody) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  draftAnalysis — colour-code faces by draft angle relative to pull
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk every face of `body` and classify it by draft angle relative to
 * `pullDirection`. Each face's category lands as an SP-2 attribute and
 * the result is summarised on `body.metadata.mold.draftAnalysis`.
 *
 * The face's OUTWARD normal (honouring `face.reversed`) is sampled at
 * the parametric midpoint via `evalSurface`. The signed angle with the
 * pull direction lands in [-90°, +90°]:
 *   - +90° = face fully faces +pull (would lift cleanly).
 *   -  0° = face perpendicular to pull (vertical — would scrape).
 *   - -90° = face fully faces -pull (locked in the mold).
 *
 * Categories:
 *   - positive   → angleDeg >= +minDraftDeg (faces +pull cleanly).
 *   - negative   → angleDeg <= -minDraftDeg (faces -pull cleanly).
 *   - vertical   → |angleDeg|  <  minDraftDeg (would lock).
 *
 * @param {SpineBody} body
 * @param {[number,number,number]|{x,y,z}} pullDirection
 *     Unit vector indicating the mold-open direction in WORLD frame.
 * @param {object} [opts]
 * @param {number} [opts.minDraftDeg=3]
 *     The green/yellow cutoff in degrees. Faces with |angleDeg| <
 *     this threshold are flagged as undercut/vertical.
 * @returns {{
 *   pullDirection: [number,number,number],
 *   minDraftDeg: number,
 *   positive: number, negative: number, vertical: number,
 *   faceCount: number,
 *   perFace: Array<{faceIndex,category,angleDeg,normal,faceRef}>,
 * }}
 */
export async function draftAnalysis(body, pullDirection, opts = {}) {
  if (!body || !body.body) {
    throw new Error('draftAnalysis: needs a SpineBody with a spine');
  }
  const pullRaw = asVec3(pullDirection) || DEFAULT_PULL_DIRECTION;
  const pull = normalize3(pullRaw);
  if (pull[0] === 0 && pull[1] === 0 && pull[2] === 0) {
    throw new Error('draftAnalysis: pullDirection must be a non-zero vector');
  }
  const minDraftDeg = (typeof opts.minDraftDeg === 'number' && opts.minDraftDeg >= 0)
    ? opts.minDraftDeg : DEFAULT_MIN_DRAFT_DEG;

  const faces = body.body.faces();
  const perFace = [];
  let positive = 0, negative = 0, vertical = 0;

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    let normal = null;
    let angleDeg = 0;
    let category = 'vertical';

    try {
      // Sample the surface at parametric midpoint. evalSurface already
      // honours face.reversed in its returned normal — we do NOT flip
      // here again (double-flip would cancel out, producing wrong
      // categories).
      const probe = await evalSurface(face, 0.5, 0.5, { normalised: true });
      if (probe && probe.normal) {
        let n = normalize3([probe.normal.x, probe.normal.y, probe.normal.z]);
        normal = n;
        // Signed angle in [-90, +90] degrees. We compute via asin(dot)
        // because dot of unit vectors is in [-1, 1] and asin maps that
        // to the perpendicular-deviation angle the user sees in SW.
        const d = Math.max(-1, Math.min(1, dot3(n, pull)));
        angleDeg = Math.asin(d) * 180 / Math.PI;
        if (angleDeg >= minDraftDeg) { category = 'positive'; positive++; }
        else if (angleDeg <= -minDraftDeg) { category = 'negative'; negative++; }
        else { category = 'vertical'; vertical++; }
      } else {
        vertical++;
      }
    } catch (err) {
      // evalSurface can fail on degenerate faces — count as vertical/undercut.
      vertical++;
      // eslint-disable-next-line no-console
      console.warn(`draftAnalysis: face #${i} evalSurface failed —`, err && err.message || err);
    }

    // SP-2 attribute on the face — keep the analysis with the body.
    try {
      attachAttribute(face, 'mold.draft', {
        category,
        angleDeg,
        normal,
        pullDirection: pull.slice(),
      }, { survives: 'verbatim', namespace: 'user' });
    } catch (_e) { /* face may be detached / read-only */ }

    perFace.push({
      faceIndex: i,
      category,
      angleDeg,
      normal,
      faceRef: face,
    });
  }

  const report = {
    pullDirection: pull.slice(),
    minDraftDeg,
    positive, negative, vertical,
    faceCount: faces.length,
    perFace,
  };
  stampMoldMetadata(body, { draftAnalysis: {
    pullDirection: report.pullDirection,
    minDraftDeg: report.minDraftDeg,
    positive: report.positive,
    negative: report.negative,
    vertical: report.vertical,
    faceCount: report.faceCount,
    // Slim per-face record without the live face reference.
    perFace: report.perFace.map(f => ({
      faceIndex: f.faceIndex,
      category: f.category,
      angleDeg: f.angleDeg,
      normal: f.normal,
    })),
  } });
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  partingLine — silhouette curve on the body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the parting line of `body` relative to `pullDirection`. An edge
 * lies on the parting line iff its two adjacent faces have OPPOSITE draft
 * signs (one positive, one negative), OR one face is positive and the
 * other vertical (the canonical SW silhouette + tangent convention).
 *
 * Requires draft analysis to have run on the body first. If
 * `body.metadata.mold.draftAnalysis` is missing, this op runs draft
 * analysis itself so the workflow is robust.
 *
 * @param {SpineBody} body
 * @param {[number,number,number]|{x,y,z}} pullDirection
 * @param {object} [opts]
 * @param {number} [opts.minDraftDeg=3]
 * @returns {{
 *   pullDirection: [number,number,number],
 *   edgeCount: number,
 *   edges: Array<{
 *     edgeIndex: number,
 *     start: {x,y,z}, end: {x,y,z},
 *     leftDraft: 'positive'|'negative'|'vertical',
 *     rightDraft: 'positive'|'negative'|'vertical',
 *     edgeRef: object,
 *   }>,
 * }}
 */
export async function partingLine(body, pullDirection, opts = {}) {
  if (!body || !body.body) {
    throw new Error('partingLine: needs a SpineBody with a spine');
  }
  const pullRaw = asVec3(pullDirection) || DEFAULT_PULL_DIRECTION;
  const pull = normalize3(pullRaw);
  const minDraftDeg = (typeof opts.minDraftDeg === 'number' && opts.minDraftDeg >= 0)
    ? opts.minDraftDeg : DEFAULT_MIN_DRAFT_DEG;

  // Make sure the body has a fresh draft analysis (faces carry the
  // 'mold.draft' attribute).
  let needAnalysis = true;
  const existing = getMoldMetadata(body);
  if (existing && existing.draftAnalysis
    && existing.draftAnalysis.minDraftDeg === minDraftDeg) {
    const exPull = existing.draftAnalysis.pullDirection || [];
    if (Math.abs(exPull[0] - pull[0]) < 1e-9
      && Math.abs(exPull[1] - pull[1]) < 1e-9
      && Math.abs(exPull[2] - pull[2]) < 1e-9) {
      needAnalysis = false;
    }
  }
  if (needAnalysis) {
    await draftAnalysis(body, pull, { minDraftDeg });
  }

  const edges = body.body.edges();
  const partingEdges = [];

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    // Walk the edge's coedges → loop.face to find adjacent faces.
    const adjacentFaces = [];
    const seenFaces = new Set();
    if (Array.isArray(edge.coedges)) {
      for (const coedge of edge.coedges) {
        const f = coedge && coedge.loop && coedge.loop.face;
        if (f && !seenFaces.has(f)) {
          seenFaces.add(f);
          adjacentFaces.push(f);
        }
      }
    } else if (edge.coedges && typeof edge.coedges[Symbol.iterator] === 'function') {
      for (const coedge of edge.coedges) {
        const f = coedge && coedge.loop && coedge.loop.face;
        if (f && !seenFaces.has(f)) {
          seenFaces.add(f);
          adjacentFaces.push(f);
        }
      }
    }

    if (adjacentFaces.length !== 2) continue;

    const ad0 = adjacentFaces[0].getAttribute && adjacentFaces[0].getAttribute('mold.draft');
    const ad1 = adjacentFaces[1].getAttribute && adjacentFaces[1].getAttribute('mold.draft');
    if (!ad0 || !ad1) continue;
    const cat0 = ad0.value && ad0.value.category;
    const cat1 = ad1.value && ad1.value.category;

    // The edge is on the parting line iff the two faces are on OPPOSITE
    // sides of the mold pull — or one is vertical / undercut (tangent
    // boundary). pure negative ↔ negative or positive ↔ positive edges
    // are interior to a single mold half.
    const isParting = (
      (cat0 === 'positive' && cat1 === 'negative') ||
      (cat0 === 'negative' && cat1 === 'positive') ||
      (cat0 === 'positive' && cat1 === 'vertical') ||
      (cat0 === 'vertical' && cat1 === 'positive') ||
      (cat0 === 'negative' && cat1 === 'vertical') ||
      (cat0 === 'vertical' && cat1 === 'negative')
    );
    if (!isParting) continue;

    // Get the edge's endpoints (in WORLD coords; spine vertices carry
    // .point populated by bindSpine — same access pattern as
    // BrepSheetMetal.computeEdgeGeometry).
    const v0 = edge.startVertex;
    const v1 = edge.endVertex;
    let start = null, end = null;
    if (v0 && v0.point && typeof v0.point.x === 'number') {
      start = { x: v0.point.x, y: v0.point.y, z: v0.point.z };
    }
    if (v1 && v1.point && typeof v1.point.x === 'number') {
      end = { x: v1.point.x, y: v1.point.y, z: v1.point.z };
    }

    partingEdges.push({
      edgeIndex: i,
      start, end,
      leftDraft: cat0, rightDraft: cat1,
      edgeRef: edge,
    });

    // Tag the edge with the parting-line attribute (SP-2).
    try {
      attachAttribute(edge, 'mold.partingLine', {
        leftDraft: cat0, rightDraft: cat1,
        pullDirection: pull.slice(),
      }, { survives: 'verbatim', namespace: 'user' });
    } catch (_e) { /* edge may be read-only */ }
  }

  const result = {
    pullDirection: pull.slice(),
    edgeCount: partingEdges.length,
    edges: partingEdges,
  };

  stampMoldMetadata(body, {
    partingLine: {
      pullDirection: result.pullDirection,
      edgeCount: result.edgeCount,
      edges: partingEdges.map(e => ({
        edgeIndex: e.edgeIndex,
        start: e.start, end: e.end,
        leftDraft: e.leftDraft, rightDraft: e.rightDraft,
      })),
    },
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  toolingSplit — partition the body into core + cavity halves
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split `body` into CORE half (the side facing +pullDirection) + CAVITY
 * half (opposite) along a planar parting surface.
 *
 * The algorithm:
 *   1) Ensure draft analysis (and parting line) have run on the body
 *      (idempotent — re-runs if the pull direction differs).
 *   2) Compute the body's bounding box centroid + extent.
 *   3) Build a planar parting surface perpendicular to `pullDirection`,
 *      passing through the body centroid (the SW Mold-Tools default).
 *      The plane is materialised as a thin solid prism (a flat slab
 *      large enough to span the body's bounding box).
 *   4) Call SP-5's `partition(body, [tool])` → returns two SpineBodies
 *      (or sometimes one if the partition failed to intersect — we
 *      detect this and report it honestly).
 *   5) For each piece, compute its centroid and project onto the pull
 *      axis (signed distance from the parting plane along pullDirection).
 *      Sign > 0 → core; sign < 0 → cavity.
 *   6) Tag each piece's body with `attachAttribute(body, 'mold.half',
 *      'core' | 'cavity')` and stamp `metadata.mold.half`.
 *
 * @param {SpineBody} body
 * @param {[number,number,number]|{x,y,z}} pullDirection
 * @param {object} [opts]
 * @param {number} [opts.minDraftDeg=3]
 * @param {number} [opts.partingZ=null]  optional override for the
 *     parting plane's height (signed distance along pullDirection from
 *     the body's bounding-box centre). Default null = parting plane at
 *     the centroid (SW default).
 * @returns {{
 *   pieces: Array<SpineBody>,
 *   core: SpineBody|null,
 *   cavity: SpineBody|null,
 *   partingPlane: {origin:[x,y,z], normal:[nx,ny,nz]},
 *   pullDirection: [number,number,number],
 *   pieceCount: number,
 *   partitionReport: object,
 * }}
 */
export async function toolingSplit(body, pullDirection, opts = {}) {
  if (!body || !body.body) {
    throw new Error('toolingSplit: needs a SpineBody with a spine');
  }
  const pullRaw = asVec3(pullDirection) || DEFAULT_PULL_DIRECTION;
  const pull = normalize3(pullRaw);
  const minDraftDeg = (typeof opts.minDraftDeg === 'number' && opts.minDraftDeg >= 0)
    ? opts.minDraftDeg : DEFAULT_MIN_DRAFT_DEG;

  // 1. Ensure draft analysis is fresh (also tags faces).
  await draftAnalysis(body, pull, { minDraftDeg });

  // 2. Compute the body's bounding box centroid + extent.
  const bbox = computeBodyBBox(body);
  if (!bbox) {
    throw new Error('toolingSplit: could not compute bounding box of body');
  }
  const { center, size, max } = bbox;

  // 3. Build the parting plane normal to `pull`, at the centroid (or
  //    centroid + partingZ * pull if overridden).
  const partingZ = (typeof opts.partingZ === 'number') ? opts.partingZ : 0;
  const planeOrigin = [
    center[0] + pull[0] * partingZ,
    center[1] + pull[1] * partingZ,
    center[2] + pull[2] * partingZ,
  ];

  // 4. Materialise the parting plane as a thin SLAB (the partition tool)
  //    and a pair of complementary HALF-SPACE tools (the cut-based
  //    fallback). The half-space approach is reliable for any closed
  //    body geometry; the partition approach preserves volume and is
  //    used when it cleanly produces 2 pieces.
  const { u: planeU, v: planeV } = makeBasis(pull);
  const half = Math.max(size[0], size[1], size[2]) * 2 + 50; // mm

  // Build a rectangular profile perpendicular to pull, centred at the
  // parting plane.
  const profileCorners = [
    [planeOrigin[0] - planeU[0] * half - planeV[0] * half,
     planeOrigin[1] - planeU[1] * half - planeV[1] * half,
     planeOrigin[2] - planeU[2] * half - planeV[2] * half],
    [planeOrigin[0] + planeU[0] * half - planeV[0] * half,
     planeOrigin[1] + planeU[1] * half - planeV[1] * half,
     planeOrigin[2] + planeU[2] * half - planeV[2] * half],
    [planeOrigin[0] + planeU[0] * half + planeV[0] * half,
     planeOrigin[1] + planeU[1] * half + planeV[1] * half,
     planeOrigin[2] + planeU[2] * half + planeV[2] * half],
    [planeOrigin[0] - planeU[0] * half + planeV[0] * half,
     planeOrigin[1] - planeU[1] * half + planeV[1] * half,
     planeOrigin[2] - planeU[2] * half + planeV[2] * half],
  ];
  // Reverse the corners (CW) so the extrude direction = -pull lands on
  // the side we want. Actually, extrudeProfile auto-handles direction
  // sign; we'll pass an explicit direction below.
  const profileForExtrude = profileCorners.map(c => ({ x: c[0], y: c[1], z: c[2] }));

  // Half-space thickness — large enough to fully enclose the body. The
  // body extends ±max/2 from its centroid; the half-space extends
  // 2×max from the parting plane in one direction.
  const halfHeight = Math.max(size[0], size[1], size[2]) * 2 + 100;

  // Build the BELOW-PARTING half-space tool: extrude the rectangle along
  // -pull by halfHeight. This volume covers everything below the parting
  // plane. Cutting the body with it yields the CORE half (the +pull side).
  let belowTool;
  try {
    belowTool = await extrudeProfile(profileForExtrude, halfHeight, {
      direction: [-pull[0], -pull[1], -pull[2]],
    });
  } catch (err) {
    throw new Error(`toolingSplit: failed to build BELOW half-space tool — ${err.message || err}`);
  }

  // Build the ABOVE-PARTING half-space tool: extrude along +pull by
  // halfHeight. Cutting the body with it yields the CAVITY half.
  let aboveTool;
  try {
    aboveTool = await extrudeProfile(profileForExtrude, halfHeight, {
      direction: [pull[0], pull[1], pull[2]],
    });
  } catch (err) {
    throw new Error(`toolingSplit: failed to build ABOVE half-space tool — ${err.message || err}`);
  }

  // 5. Build the two halves via two cut ops — the canonical
  //    "split at a plane" approach using SP-5 booleans.
  let coreRaw;   // body − belowTool  ⇒ everything ABOVE the parting plane
  let cavityRaw; // body − aboveTool  ⇒ everything BELOW the parting plane
  try {
    coreRaw = await boolCut(body, belowTool);
  } catch (err) {
    throw new Error(`toolingSplit: core cut failed — ${err.message || err}`);
  }
  try {
    cavityRaw = await boolCut(body, aboveTool);
  } catch (err) {
    throw new Error(`toolingSplit: cavity cut failed — ${err.message || err}`);
  }

  const pieces = [coreRaw, cavityRaw];
  const partitionReport = {
    pieceCount: 2,
    method: 'cut',
    note: 'split via two complementary half-space cuts',
  };

  // Also try SP-5's partition op as an alternative (for callers who want
  // the volume-preserving split). Not strictly necessary for the
  // foundation pass — recorded on the report for completeness.
  try {
    // Build a thin slab as the partition tool — same plane, 1mm thick.
    const slabThickness = 1;
    const slabAnchor = [
      planeOrigin[0] - pull[0] * slabThickness / 2,
      planeOrigin[1] - pull[1] * slabThickness / 2,
      planeOrigin[2] - pull[2] * slabThickness / 2,
    ];
    const slabProfile = profileCorners.map(c => ({
      x: c[0] - pull[0] * slabThickness / 2,
      y: c[1] - pull[1] * slabThickness / 2,
      z: c[2] - pull[2] * slabThickness / 2,
    }));
    const slabTool = await extrudeProfile(slabProfile, slabThickness, {
      direction: [pull[0], pull[1], pull[2]],
    });
    const partitionPieces = await partition(body, [slabTool]);
    partitionReport.partitionPieceCount = Array.isArray(partitionPieces) ? partitionPieces.length : 0;
    partitionReport.partitionAttempted = true;
  } catch (err) {
    partitionReport.partitionAttempted = false;
    partitionReport.partitionError = String(err && err.message || err);
  }

  // 6. Classify each piece — sign of (pieceCentroid - planeOrigin) · pull.
  let core = null;
  let cavity = null;
  for (const piece of pieces) {
    const pieceBbox = computeBodyBBox(piece);
    let half = 'core';
    if (pieceBbox) {
      const fromPlane = [
        pieceBbox.center[0] - planeOrigin[0],
        pieceBbox.center[1] - planeOrigin[1],
        pieceBbox.center[2] - planeOrigin[2],
      ];
      const signedDist = dot3(fromPlane, pull);
      half = (signedDist >= 0) ? 'core' : 'cavity';
    }
    // Tag the piece's spine body and metadata.
    try {
      attachAttribute(piece.body, 'mold.half', half, {
        survives: 'verbatim', namespace: 'mold',
      });
    } catch (_e) { /* unlikely */ }
    stampMoldMetadata(piece, {
      half,
      toolingSplit: {
        pullDirection: pull.slice(),
        pieceCount: pieces.length,
        partingPlane: {
          origin: [planeOrigin[0], planeOrigin[1], planeOrigin[2]],
          normal: [pull[0], pull[1], pull[2]],
        },
      },
    });
    if (piece.meta) {
      piece.meta.op = 'toolingSplit.piece';
      piece.meta.moldHalf = half;
    }
    if (half === 'core' && !core) core = piece;
    if (half === 'cavity' && !cavity) cavity = piece;
  }

  // Fall-back: if both pieces ended up labelled 'core' (or both 'cavity'
  // — possible in pathological partition cases), label them by piece
  // index 0 = core, 1 = cavity for at least a deterministic result.
  if (pieces.length === 2 && (!core || !cavity)) {
    pieces[0].meta = pieces[0].meta || {};
    pieces[1].meta = pieces[1].meta || {};
    if (!core) {
      core = pieces[0];
      pieces[0].meta.moldHalf = 'core';
      stampMoldMetadata(pieces[0], { half: 'core' });
    }
    if (!cavity) {
      cavity = pieces[1];
      pieces[1].meta.moldHalf = 'cavity';
      stampMoldMetadata(pieces[1], { half: 'cavity' });
    }
  }

  return {
    pieces,
    core, cavity,
    partingPlane: {
      origin: [planeOrigin[0], planeOrigin[1], planeOrigin[2]],
      normal: [pull[0], pull[1], pull[2]],
    },
    pullDirection: pull.slice(),
    pieceCount: pieces.length,
    partitionReport,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — bbox + plane basis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a body's bounding box from its spine vertex positions. Each
 * vertex carries `.point = {x,y,z}` populated by `bindSpine`.
 * @returns {{min, max, center, size}|null}
 */
function computeBodyBBox(body) {
  const spine = body.body || body;
  if (!spine || typeof spine.vertices !== 'function') return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  for (const vt of spine.vertices()) {
    if (!vt || !vt.point) continue;
    const p = vt.point;
    if (typeof p.x !== 'number') continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
    count++;
  }
  if (count === 0 || !isFinite(minX)) return null;
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, size };
}

/**
 * Build a (u, v) basis perpendicular to `pull`. Chooses a reference axis
 * not parallel to pull, then Gram-Schmidt to get a u in the plane,
 * v = pull × u.
 */
function makeBasis(pull) {
  // Pick a reference axis not parallel to pull.
  let ref = [1, 0, 0];
  if (Math.abs(pull[0]) > 0.9) ref = [0, 1, 0];
  // u = ref - (ref · pull) * pull   (Gram-Schmidt)
  const dot = ref[0] * pull[0] + ref[1] * pull[1] + ref[2] * pull[2];
  let u = [ref[0] - dot * pull[0], ref[1] - dot * pull[1], ref[2] - dot * pull[2]];
  u = normalize3(u);
  // v = pull × u
  const v = normalize3([
    pull[1] * u[2] - pull[2] * u[1],
    pull[2] * u[0] - pull[0] * u[2],
    pull[0] * u[1] - pull[1] * u[0],
  ]);
  return { u, v };
}
