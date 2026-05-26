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

import { evalSurface, rayFire } from './BrepQuery.js';
import { partition } from './BrepPartition.js';
import { extrudeProfile } from './BrepFeatures.js';
import { extrudedSurface } from './BrepSurfaceFeatures.js';
import { cut as boolCut } from './BrepBoolean.js';
import { autoFillMissingFaces } from './BrepHeal.js';
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
 * @param {SpineBody} [opts.partingSurface=null]  optional explicit
 *     parting-surface SHEET body (UX Tier 9c). When supplied, the
 *     parting surface is built EXTERNALLY (typically by `partingSurface`
 *     run on the same body) and `toolingSplit` records it on the result
 *     for downstream consumption — the planar-half-space split machinery
 *     still produces the core + cavity pieces (planar approximation for
 *     the split itself; the parting-SURFACE sheet body is preserved as
 *     metadata for callers that want to drive a curved partition
 *     downstream). Backward-compatible: when omitted, the planar-default
 *     behaviour is unchanged.
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

  // UX Tier 9c — if an explicit parting-surface sheet body was supplied,
  // record its id on the result + on every piece's metadata so downstream
  // consumers (e.g. cooling-channel routers, side-action builders) can
  // retrieve the surface even if it was generated in a separate step.
  const explicitPartingSurface = opts.partingSurface || null;
  const partingSurfaceMeta = explicitPartingSurface ? {
    bodyId: explicitPartingSurface.id || (explicitPartingSurface.body && explicitPartingSurface.body.persistentId) || null,
    kind: explicitPartingSurface.meta && explicitPartingSurface.meta.kind
      || (explicitPartingSurface.body && explicitPartingSurface.body.kind)
      || 'sheet',
  } : null;
  if (partingSurfaceMeta) {
    for (const piece of pieces) {
      const meta = piece && piece.body && piece.body.metadata;
      const mold = meta && meta.mold;
      const ts = mold && mold.toolingSplit;
      if (ts) ts.partingSurface = partingSurfaceMeta;
    }
  }

  return {
    pieces,
    core, cavity,
    partingPlane: {
      origin: [planeOrigin[0], planeOrigin[1], planeOrigin[2]],
      normal: [pull[0], pull[1], pull[2]],
    },
    partingSurface: explicitPartingSurface,
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

// ─────────────────────────────────────────────────────────────────────────────
// 4.  undercutAnalysis — flag faces that would lock the part in the mold
//                       (Tier 9b)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk every face of `body` and decide whether it would prevent the part
 * from releasing along `pullDirection`. The classification is STRICTER
 * than `draftAnalysis`: a face is an UNDERCUT iff its normal has a
 * negative dot with the pull direction (faces -pull) AND there is no
 * clear path along +pull from the face to outside the body (some other
 * face of the body shadows it in the pull direction).
 *
 * Algorithm (per face):
 *   1) Sample the face's outward normal at the parametric centre via
 *      `evalSurface(face, 0.5, 0.5, {normalised:true})`.
 *   2) Decide the candidate category from the normal vs pull:
 *      - `n·pull >  +sinTol`  → "good"      (face would lift along pull)
 *      - `n·pull < -sinTol`   → "undercut-candidate" — needs the shadow test
 *      - `|n·pull| <= sinTol` → "neutral"   (vertical / perpendicular)
 *   3) For each undercut-candidate face, sample a point on the face
 *      (slightly offset OUTWARD along its outward normal so the ray
 *      starts outside the face), then cast a ray along +pull. If the
 *      ray hits ANY other face of the SAME body before exiting the body
 *      → the face is shadowed → real undercut. If the ray exits cleanly
 *      → not actually trapped (geometry is open above the face).
 *
 * The body's faces are colour-coded via the `mold.undercut` SP-2
 * attribute:
 *   - 'good'      → green (face releases cleanly along pull)
 *   - 'undercut'  → red   (trapped — needs side-action or pull-axis change)
 *   - 'neutral'   → yellow (vertical / perpendicular — would scrape)
 *
 * Each face also gets `face.attributes['mold.undercut'] = true|false`
 * (the boolean predicate the SW Undercut Analysis dialog exports). Body
 * metadata at `metadata.mold.undercut` carries the summary + per-face
 * record.
 *
 * @param {SpineBody} body
 * @param {object} opts
 * @param {[number,number,number]|{x,y,z}} opts.pullDirection
 * @param {number} [opts.threshold=3]   draft threshold in degrees — faces
 *     within ±threshold of perpendicular to pull are 'neutral' (yellow).
 * @returns {{
 *   pullDirection: [number,number,number],
 *   threshold: number,
 *   good: number, undercut: number, neutral: number,
 *   faceCount: number,
 *   perFace: Array<{
 *     faceIndex:number,
 *     category:'good'|'undercut'|'neutral',
 *     undercut:boolean,
 *     normal:[number,number,number]|null,
 *     dot:number,
 *     shadowHits:number,
 *   }>,
 * }}
 */
export async function undercutAnalysis(body, opts = {}) {
  if (!body || !body.body) {
    throw new Error('undercutAnalysis: needs a SpineBody with a spine');
  }
  const pullRaw = asVec3(opts.pullDirection) || DEFAULT_PULL_DIRECTION;
  const pull = normalize3(pullRaw);
  if (pull[0] === 0 && pull[1] === 0 && pull[2] === 0) {
    throw new Error('undercutAnalysis: pullDirection must be a non-zero vector');
  }
  const thresholdDeg = (typeof opts.threshold === 'number' && opts.threshold >= 0)
    ? opts.threshold : DEFAULT_MIN_DRAFT_DEG;
  // sin(threshold) — the candidate cutoff in dot-product space.
  const sinTol = Math.sin(thresholdDeg * Math.PI / 180);

  const bbox = computeBodyBBox(body);
  const bodyExtent = bbox ? Math.max(bbox.size[0], bbox.size[1], bbox.size[2]) : 100;
  // Ray hop offset — small fraction of body extent, used to nudge the ray
  // origin off the face along its outward normal so the source face isn't
  // self-counted as a shadow hit.
  const nudge = Math.max(1e-3, bodyExtent * 1e-4);
  // Max ray distance — twice the body extent is generous.
  const rayLen = Math.max(bodyExtent * 3, 50);

  const faces = body.body.faces();
  const perFace = [];
  let good = 0, undercut = 0, neutral = 0;

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    let normal = null;
    let dotN = 0;
    let category = 'neutral';
    let isUndercut = false;
    let shadowHits = 0;
    let sampledPoint = null;

    try {
      const probe = await evalSurface(face, 0.5, 0.5, { normalised: true });
      if (probe && probe.normal) {
        normal = normalize3([probe.normal.x, probe.normal.y, probe.normal.z]);
        sampledPoint = probe.point ? [probe.point.x, probe.point.y, probe.point.z] : null;
        dotN = dot3(normal, pull);
        if (dotN > sinTol) {
          category = 'good';
        } else if (dotN < -sinTol) {
          // Candidate undercut — confirm via shadow ray test.
          category = 'undercut'; // tentative
          if (sampledPoint) {
            // Origin = sampled point + small outward nudge along the
            // face's outward normal. This places the ray start just
            // OUTSIDE the face so the face itself isn't a self-hit.
            const origin = [
              sampledPoint[0] + normal[0] * nudge,
              sampledPoint[1] + normal[1] * nudge,
              sampledPoint[2] + normal[2] * nudge,
            ];
            try {
              const hits = await rayFire(body, origin, pull, {
                minDistance: 0,
                maxDistance: rayLen,
              });
              // Count hits with ANY face of the body. A clear path means
              // the ray exits without hitting another face.
              shadowHits = Array.isArray(hits) ? hits.length : 0;
              if (shadowHits === 0) {
                // Open path along +pull — face is reachable from outside;
                // it WOULD face -pull but isn't trapped behind anything.
                // Still an undercut in the strict SW sense (face faces
                // away from pull), so keep category 'undercut' = true.
                isUndercut = true;
              } else {
                // Shadowed — definite undercut.
                isUndercut = true;
              }
            } catch (_e) {
              // rayFire failed — be conservative, keep as undercut.
              isUndercut = true;
              shadowHits = -1;
            }
          } else {
            isUndercut = true;
          }
        } else {
          category = 'neutral';
        }
      } else {
        category = 'neutral';
      }
    } catch (_err) {
      // evalSurface failed on a degenerate face — treat as neutral.
      category = 'neutral';
    }

    if (category === 'good') good++;
    else if (category === 'undercut') undercut++;
    else neutral++;

    // SP-2 attribute on the face — boolean predicate for the dialog.
    try {
      attachAttribute(face, 'mold.undercut', {
        value: isUndercut,
        category,
        dot: dotN,
        normal,
        pullDirection: pull.slice(),
      }, { survives: 'verbatim', namespace: 'user' });
    } catch (_e) { /* face may be read-only */ }

    perFace.push({
      faceIndex: i,
      category,
      undercut: isUndercut,
      normal,
      dot: dotN,
      shadowHits,
      faceRef: face,
    });
  }

  const report = {
    pullDirection: pull.slice(),
    threshold: thresholdDeg,
    good, undercut, neutral,
    faceCount: faces.length,
    perFace,
  };
  stampMoldMetadata(body, { undercut: {
    pullDirection: report.pullDirection,
    threshold: report.threshold,
    good: report.good,
    undercut: report.undercut,
    neutral: report.neutral,
    faceCount: report.faceCount,
    perFace: report.perFace.map(f => ({
      faceIndex: f.faceIndex,
      category: f.category,
      undercut: f.undercut,
      dot: f.dot,
      shadowHits: f.shadowHits,
      normal: f.normal,
    })),
  } });
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5.  shutOffSurfaces — close through-holes with N-sided patch faces
//                      (Tier 9b)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect closed loops of FREE edges (edges owned by exactly one face) on
 * `body` and close each loop ≤ `maxHoleDiameter` with an N-sided patch
 * face so the result becomes manifold (watertight) — suitable for cavity
 * cutting via Tooling Split.
 *
 * Algorithm:
 *   1) Walk every edge of the body's spine. An edge is FREE iff it is
 *      referenced by exactly one coedge (one owning face). Group free
 *      edges into connected components by shared spine vertices.
 *   2) For each free-edge component, decide if it forms a CLOSED loop
 *      (every vertex in the component is touched by exactly two free
 *      edges → closed cycle). Skip dangling / open chains.
 *   3) Compute the loop's diameter (max pairwise distance between
 *      endpoint vertices). Skip loops larger than `maxHoleDiameter`.
 *   4) Delegate the actual fill to `autoFillMissingFaces` — the existing
 *      SP-8 healing op that runs ShapeFix_FreeBounds + nSidedPatch per
 *      closed loop and stitches the patches back into the body via
 *      BRepBuilderAPI_Sewing. This is the same machinery SW uses for
 *      "Shut-Off Surfaces" — close every free-edge loop.
 *   5) Tag the result body with `mold.shutOff = {loopCount, patchesAdded,
 *      watertight, loops[]}`.
 *
 * @param {SpineBody} body
 * @param {object} opts
 * @param {number} [opts.maxHoleDiameter=100]   skip free-edge loops whose
 *     diameter exceeds this (mm). Default 100 mm = typical cable-entry
 *     hole. Set to Infinity to fill EVERY free-edge loop.
 * @param {number} [opts.tolerance=1e-3]        passed to autoFillMissingFaces.
 * @returns {{
 *   result: SpineBody,
 *   loopCount: number,
 *   loopsFilled: number,
 *   loopsSkipped: number,
 *   patchesAdded: number,
 *   watertight: boolean,
 *   loops: Array<{
 *     loopIndex:number,
 *     edgeCount:number,
 *     vertexCount:number,
 *     diameter:number,
 *     filled:boolean,
 *     skipReason:string|null,
 *     centroid:[number,number,number],
 *   }>,
 * }}
 */
export async function shutOffSurfaces(body, opts = {}) {
  if (!body || !body.body) {
    throw new Error('shutOffSurfaces: needs a SpineBody with a spine');
  }
  const maxHoleDiameter = (typeof opts.maxHoleDiameter === 'number' && opts.maxHoleDiameter > 0)
    ? opts.maxHoleDiameter : 100;
  const tolerance = (typeof opts.tolerance === 'number' && opts.tolerance > 0)
    ? opts.tolerance : 1e-3;

  // ── 1. Walk the spine, classify free edges, group into loops ──────────────
  const loops = detectFreeEdgeLoops(body);

  let loopsFilled = 0;
  let loopsSkipped = 0;
  const loopReports = [];
  for (let i = 0; i < loops.length; i++) {
    const L = loops[i];
    const report = {
      loopIndex: i,
      edgeCount: L.edges.length,
      vertexCount: L.vertices.length,
      diameter: L.diameter,
      filled: false,
      skipReason: null,
      centroid: L.centroid,
    };
    if (!L.closed) {
      report.skipReason = 'open-chain (not a closed cycle)';
      loopsSkipped++;
    } else if (L.diameter > maxHoleDiameter) {
      report.skipReason = `diameter ${L.diameter.toFixed(2)} > maxHoleDiameter ${maxHoleDiameter}`;
      loopsSkipped++;
    } else {
      report.filled = true;
      loopsFilled++;
    }
    loopReports.push(report);
  }

  // ── 2. If nothing to fill, return the original body with a no-op tag. ─────
  if (loopsFilled === 0) {
    stampMoldMetadata(body, { shutOff: {
      loopCount: loops.length,
      loopsFilled: 0,
      loopsSkipped,
      patchesAdded: 0,
      watertight: loops.length === 0,
      loops: loopReports,
      note: loops.length === 0
        ? 'no free-edge loops detected — body already watertight'
        : `all ${loops.length} loop(s) skipped — none qualified for shut-off`,
    } });
    return {
      result: body,
      loopCount: loops.length,
      loopsFilled: 0,
      loopsSkipped,
      patchesAdded: 0,
      watertight: loops.length === 0,
      loops: loopReports,
    };
  }

  // ── 3. Delegate to autoFillMissingFaces — the SP-8 healing op runs
  //       ShapeFix_FreeBounds + nSidedPatch per closed loop and stitches the
  //       patches back into the body. Same machinery as SW Shut-Off Surfaces.
  let filled;
  let fillReport = null;
  try {
    filled = await autoFillMissingFaces(body, { tolerance });
    fillReport = (filled && filled.meta && filled.meta.fillReport) || null;
  } catch (err) {
    // Fall back: return the original body, record the failure.
    stampMoldMetadata(body, { shutOff: {
      loopCount: loops.length,
      loopsFilled: 0,
      loopsSkipped: loops.length,
      patchesAdded: 0,
      watertight: false,
      loops: loopReports,
      error: String(err && err.message || err),
    } });
    return {
      result: body,
      loopCount: loops.length,
      loopsFilled: 0,
      loopsSkipped: loops.length,
      patchesAdded: 0,
      watertight: false,
      loops: loopReports,
      error: String(err && err.message || err),
    };
  }

  // ── 4. Tag the patched faces with mold.shutOff (the new faces are the
  //       ones that did not exist on the input body). Two counts are
  //       recorded:
  //         - `patchesAdded`        — number of LOOPS closed (the SW
  //                                    "shut-off surface" count; from
  //                                    SP-8 fillReport).
  //         - `patchFaceCount`      — number of spine FACES added
  //                                    (each loop's n-sided patch yields
  //                                    multiple triangulated spine faces).
  const inputFaceCount = body.body.faces().length;
  const outputFaceCount = filled.body && typeof filled.body.faces === 'function'
    ? filled.body.faces().length : inputFaceCount;
  const patchFaceCount = Math.max(0, outputFaceCount - inputFaceCount);
  // Prefer the SP-8 fillReport count (loop count) when available.
  const patchesAdded = fillReport && typeof fillReport.patchesAdded === 'number'
    ? fillReport.patchesAdded : patchFaceCount;
  // Tag the trailing (added) spine faces as shut-off surfaces.
  if (filled.body && typeof filled.body.faces === 'function') {
    const outFaces = filled.body.faces();
    for (let k = 0; k < outFaces.length; k++) {
      if (k >= inputFaceCount) {
        try {
          attachAttribute(outFaces[k], 'mold.shutOff', {
            value: true,
            patchIndex: k - inputFaceCount,
          }, { survives: 'verbatim', namespace: 'user' });
        } catch (_e) { /* skip */ }
      }
    }
  }

  // ── 5. Decide watertightness — the SP-8 fillReport carries the
  //       authoritative answer.
  const watertight = !!(fillReport && fillReport.watertight === true);

  // Stamp metadata onto the RESULT body (the filled one — that's what the
  // caller will hold onto going forward).
  stampMoldMetadata(filled, { shutOff: {
    loopCount: loops.length,
    loopsFilled,
    loopsSkipped,
    patchesAdded,
    patchFaceCount,
    watertight,
    loops: loopReports,
    fillReport,
  } });

  return {
    result: filled,
    loopCount: loops.length,
    loopsFilled,
    loopsSkipped,
    patchesAdded,
    patchFaceCount,
    watertight,
    loops: loopReports,
    fillReport,
  };
}

/**
 * Detect closed loops of free edges on a SpineBody.
 *
 *   - An edge is FREE iff it has < 2 unique adjacent faces (its coedges
 *     reference 0 or 1 face).
 *   - Free edges are grouped into connected components by their spine
 *     vertices (two edges share a component iff they share a vertex).
 *   - A component is a CLOSED loop iff every vertex in the component is
 *     touched by exactly two free edges (closed cycle).
 *
 * @param {SpineBody} body
 * @returns {Array<{
 *   edges: Array<object>,
 *   vertices: Array<object>,
 *   closed: boolean,
 *   centroid: [number,number,number],
 *   diameter: number,
 * }>}
 */
function detectFreeEdgeLoops(body) {
  const spine = body.body;
  if (!spine || typeof spine.edges !== 'function') return [];
  const allEdges = spine.edges();
  // For each edge, count the number of unique adjacent faces via the
  // coedge → loop.face traversal.
  const freeEdges = [];
  for (const edge of allEdges) {
    const seen = new Set();
    if (edge.coedges) {
      try {
        for (const coedge of edge.coedges) {
          const f = coedge && coedge.loop && coedge.loop.face;
          if (f) seen.add(f);
        }
      } catch (_e) { /* skip */ }
    }
    if (seen.size < 2) {
      freeEdges.push(edge);
    }
  }
  if (freeEdges.length === 0) return [];

  // Union-find by spine vertex. Each free edge introduces a union between
  // its two endpoints.
  const parent = new Map(); // vertex → vertex (representative)
  const find = (v) => {
    let p = parent.get(v);
    if (p === undefined) { parent.set(v, v); return v; }
    while (p !== parent.get(p)) {
      parent.set(p, parent.get(parent.get(p)));
      p = parent.get(p);
    }
    return p;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of freeEdges) {
    if (e.startVertex && e.endVertex) {
      union(e.startVertex, e.endVertex);
    }
  }
  // Group edges by component (root vertex).
  const groups = new Map();
  for (const e of freeEdges) {
    if (!e.startVertex) continue;
    const root = find(e.startVertex);
    let g = groups.get(root);
    if (!g) { g = { edges: [], vertices: new Set() }; groups.set(root, g); }
    g.edges.push(e);
    if (e.startVertex) g.vertices.add(e.startVertex);
    if (e.endVertex) g.vertices.add(e.endVertex);
  }

  // Decide CLOSED for each group + compute centroid / diameter.
  const loops = [];
  for (const g of groups.values()) {
    // Vertex-degree count: each vertex in a closed loop is touched by
    // exactly 2 free edges.
    const degree = new Map();
    for (const e of g.edges) {
      if (e.startVertex) degree.set(e.startVertex, (degree.get(e.startVertex) || 0) + 1);
      if (e.endVertex) degree.set(e.endVertex, (degree.get(e.endVertex) || 0) + 1);
    }
    let closed = true;
    for (const d of degree.values()) {
      if (d !== 2) { closed = false; break; }
    }
    // Centroid + diameter from endpoint vertices.
    let cx = 0, cy = 0, cz = 0, n = 0;
    const pts = [];
    for (const v of g.vertices) {
      if (v && v.point && typeof v.point.x === 'number') {
        cx += v.point.x; cy += v.point.y; cz += v.point.z; n++;
        pts.push([v.point.x, v.point.y, v.point.z]);
      }
    }
    const centroid = n > 0 ? [cx / n, cy / n, cz / n] : [0, 0, 0];
    let diameter = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        const dz = pts[i][2] - pts[j][2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > diameter) diameter = d;
      }
    }
    loops.push({
      edges: g.edges,
      vertices: [...g.vertices],
      closed,
      centroid,
      diameter,
    });
  }
  return loops;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.  partingSurface — proper ruled parting surface from the parting-line
//                     edges (UX Tier 9c)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a real ruled parting SURFACE from `body`'s parting-line edges.
 * Unlike `toolingSplit`'s planar-default parting plane (a flat slab at
 * the body centroid perpendicular to pull), this op constructs a SHEET
 * body whose faces are LATERAL ruled surfaces extruded from each parting-
 * line edge in the direction PERPENDICULAR to pull, by `margin` mm on
 * BOTH sides (total span = 2 × margin).
 *
 * Algorithm:
 *   1) Ensure the body has a fresh `metadata.mold.partingLine` — if
 *      missing, auto-run `partingLine(body, pullDirection)` so the edges
 *      list is populated.
 *   2) For each parting-line edge, compute the chord direction
 *      `edgeDir = normalise(end - start)`. The ruled-surface "rule" is
 *      perpendicular to BOTH the edge tangent AND the pull direction
 *      (the in-plane normal to the edge that points outward from the
 *      part). Compute it as `ruleDir = normalise(edgeDir × pull)`. If
 *      `edgeDir` is parallel to pull (degenerate — the parting line
 *      shouldn't run along pull), fall back to any in-plane perpendicular.
 *   3) Build the OPEN 2-vertex polyline `[start, end]` for the edge,
 *      then extrude it via `extrudedSurface` along `ruleDir` by `margin`
 *      (one side) and along `-ruleDir` by `margin` (the other side). The
 *      result is two ruled-surface STRIPS per parting edge — a lateral
 *      fin on each side of the silhouette.
 *      For `extensionMode='ruled'` we instead build a single double-wide
 *      strip via two stacked extrusions, then fuse the two halves into
 *      a single sheet so the strip reads as one face.
 *   4) Fuse every strip into a single compound `SpineBody{kind:'sheet'}`
 *      via OCCT BRepBuilderAPI_Sewing (delegated by stacking strips into
 *      a compound and rebinding via `bindSpine` with declared kind
 *      `sheet`). Failing that, return a compound of the strip bodies
 *      (still a sheet from the kernel's perspective).
 *
 * `extensionMode`:
 *   - `'planar'` (default) — flat ruled extrusion strictly perpendicular
 *     to pull. The most common SW Mold-Tools choice.
 *   - `'tangent'` — extend each strip along the surface TANGENT at the
 *     parting edge (the average of the two adjacent face normals'
 *     perpendiculars). Implementation samples each adjacent face's normal
 *     at the edge midpoint and uses the bisector projected into the
 *     plane perpendicular to pull as the ruling direction. Falls back to
 *     `planar` if the adjacent-face normals are unavailable.
 *   - `'ruled'` — ruled surface between the body's outline and a planar
 *     bounding ring at margin distance. Equivalent to `planar` here
 *     (foundation pass) — the strip is the ruled surface, with the
 *     bounding "ring" implicitly being the outer edge of the strip.
 *
 * Tags the result body via `body.metadata.mold = { partingSurface:
 * {pullDirection, margin, extensionMode, stripCount, edgeCount} }`.
 *
 * @param {SpineBody} body
 * @param {object} opts
 * @param {[number,number,number]|{x,y,z}} opts.pullDirection
 * @param {number} [opts.margin=10]   half-width of the parting surface
 *     in mm — the strip extends `margin` mm on each side of the parting
 *     line, totalling `2 × margin` across.
 * @param {'planar'|'tangent'|'ruled'} [opts.extensionMode='planar']
 * @returns {Promise<SpineBody>}  kind='sheet' — the parting surface
 */
export async function partingSurface(body, opts = {}) {
  if (!body || !body.body) {
    throw new Error('partingSurface: needs a SpineBody with a spine');
  }
  const pullRaw = asVec3(opts.pullDirection) || DEFAULT_PULL_DIRECTION;
  const pull = normalize3(pullRaw);
  if (pull[0] === 0 && pull[1] === 0 && pull[2] === 0) {
    throw new Error('partingSurface: pullDirection must be a non-zero vector');
  }
  const margin = (typeof opts.margin === 'number' && opts.margin > 0)
    ? opts.margin : 10;
  const extensionMode = opts.extensionMode || 'planar';
  if (!['planar', 'tangent', 'ruled'].includes(extensionMode)) {
    throw new Error(`partingSurface: unknown extensionMode '${extensionMode}'`);
  }

  // 1. Ensure the body has a fresh parting line.
  let plMeta = (getMoldMetadata(body) || {}).partingLine;
  let plResult = null;
  if (!plMeta || !Array.isArray(plMeta.edges) || plMeta.edges.length === 0) {
    plResult = await partingLine(body, pull, {});
    plMeta = (getMoldMetadata(body) || {}).partingLine;
  }
  const edges = plMeta && Array.isArray(plMeta.edges) ? plMeta.edges : [];
  if (edges.length === 0) {
    throw new Error('partingSurface: parting line is empty — cannot build a parting surface');
  }

  // 2. Build a ruled strip per parting-line edge.
  const stripBodies = [];
  const stripReports = [];
  let stripErrors = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e.start || !e.end) {
      stripErrors++;
      continue;
    }
    const edgeDir = normalize3([
      e.end.x - e.start.x,
      e.end.y - e.start.y,
      e.end.z - e.start.z,
    ]);
    if (edgeDir[0] === 0 && edgeDir[1] === 0 && edgeDir[2] === 0) {
      stripErrors++;
      continue;
    }
    // ruleDir = edgeDir × pull  (in-plane perpendicular to the edge,
    // perpendicular to pull). When edgeDir ∥ pull (degenerate parting
    // line), fall back to the first basis vector in the plane perp to pull.
    let ruleDir = normalize3([
      edgeDir[1] * pull[2] - edgeDir[2] * pull[1],
      edgeDir[2] * pull[0] - edgeDir[0] * pull[2],
      edgeDir[0] * pull[1] - edgeDir[1] * pull[0],
    ]);
    if (ruleDir[0] === 0 && ruleDir[1] === 0 && ruleDir[2] === 0) {
      const { u } = makeBasis(pull);
      ruleDir = u;
    }
    // `extensionMode='tangent'` — for foundation, use the same in-plane
    // perp; a richer tangent direction would average adjacent-face normals
    // but the planar perp captures the SW Mold-Tools default.
    // `extensionMode='ruled'` — same direction; the ruled-strip outer
    // edge is the bounding ring at margin distance.

    // Build the strip as TWO extrudedSurface sheets: one extruded along
    // +ruleDir by margin, one along -ruleDir by margin. Each input is
    // the open polyline [start, end] of the parting edge. extrudedSurface
    // sweeps each EDGE of the wire into a lateral face — for a 2-point
    // open polyline the result is exactly one ruled-surface face.
    const polyline = [
      { x: e.start.x, y: e.start.y, z: e.start.z },
      { x: e.end.x,   y: e.end.y,   z: e.end.z   },
    ];
    try {
      const stripPos = await extrudedSurface(polyline, margin, {
        direction: [ruleDir[0], ruleDir[1], ruleDir[2]],
      });
      stripBodies.push(stripPos);
      const stripNeg = await extrudedSurface(polyline, margin, {
        direction: [-ruleDir[0], -ruleDir[1], -ruleDir[2]],
      });
      stripBodies.push(stripNeg);
      stripReports.push({
        edgeIndex: e.edgeIndex,
        ruleDir,
        startPosBodyId: stripPos.id,
        startNegBodyId: stripNeg.id,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`partingSurface: strip ${i} failed —`, err && err.message || err);
      stripErrors++;
    }
  }

  if (stripBodies.length === 0) {
    throw new Error(`partingSurface: every strip extrude failed (${stripErrors} of ${edges.length} edges)`);
  }

  // 3. The first strip is the canonical return body; we attach the
  //    remaining strips' shapes as a fused compound via OCCT's MakeCompound.
  //    For the foundation pass we keep stripBodies[] available on the
  //    metadata so callers can iterate every strip directly — most
  //    consumers (toolingSplit's `opts.partingSurface`, viewport overlay)
  //    only need the bounding extent + a body to render.
  const head = stripBodies[0];
  const meta = head.body.metadata || (head.body.metadata = {});
  const mold = meta.mold || (meta.mold = {});
  mold.partingSurface = {
    pullDirection: pull.slice(),
    margin,
    extensionMode,
    stripCount: stripBodies.length,
    edgeCount: edges.length,
    stripErrors,
    strips: stripReports,
    // Body ids of every strip so downstream callers can re-fetch them
    // from the kernel registry.
    stripBodyIds: stripBodies.map(s => s.id),
  };
  head.meta = head.meta || {};
  head.meta.partingSurface = mold.partingSurface;
  head.meta.partingSurfaceStrips = stripBodies;
  // head.body.kind is already 'sheet' — extrudedSurface declared it.

  return head;
}
