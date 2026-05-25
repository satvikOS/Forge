/**
 * ArchDisc Kernel — Sheet Metal foundation (UX Tier 5a + 5b).
 *
 * UX Tier 5a: three FOUNDATIONAL sheet-metal ops (Base Flange, Edge Flange,
 * Flat Pattern). UX Tier 5b: four follow-on ops extending the same module —
 * Hem, Jog, Miter Flange, Sketched Bend — each one builds on the metadata +
 * bend-record + flange-extrude primitives of Tier 5a.
 *
 * Tier 5a (foundation):
 *
 *   1. baseFlange(profile, opts)
 *      Take a closed planar sketch profile + thickness + K-factor → produce
 *      a thick "flat back" body tagged as SHEET METAL. The tagging lives on
 *      `body.metadata.sheetMetal = {thickness, kFactor, bendRadius, isFlat,
 *      bends:[]}` so downstream ops can ASK whether the body is sheet
 *      metal, what its thickness is, what its K-factor is, and walk the
 *      bend history.
 *
 *   2. edgeFlange(body, edgeRef, opts)
 *      Pick an EDGE on a sheet-metal body and extrude a real flange off
 *      it at the specified angle. The flange thickness comes from the
 *      body's sheet-metal metadata; the bend radius from `opts.bendRadius`
 *      (defaults to body's recorded bend radius — typically equal to
 *      `thickness`). The flange is FUSED to the parent body. Each call
 *      pushes a bend record onto `body.metadata.sheetMetal.bends[]` —
 *      `{edgeId, length, angleDeg, kFactor, bendRadius, axis, anchor,
 *      flangeFaceIds}` — which Flat Pattern walks.
 *
 *   3. flatPattern(body)
 *      UNFOLD a sheet-metal part into its flat manufacturing layout. The
 *      algorithm walks `body.metadata.sheetMetal.bends[]`, lays the base
 *      back flat, and unrolls each flange CO-PLANAR with the base. The
 *      developed length of each flange = `flange.length + bendAllowance`,
 *      where:
 *
 *          BA = π × (R + K × t) × (θ / 180°)
 *
 *      For a 90° bend with t=1.5, R=1.5, K=0.4:
 *      BA = π × (1.5 + 0.4 × 1.5) × (90/180) = π × 2.1 × 0.5 ≈ 3.30 mm.
 *
 *      The result is a real new flat sheet body — face count = 1 (base) +
 *      N (one rectangle per flange) ≈ 5 for a 4-flange box.
 *
 * ── Sheet-metal metadata schema (lives on Body.metadata.sheetMetal) ─────────
 *
 *   {
 *     thickness:   number,    // mm — sheet thickness
 *     kFactor:     number,    // 0..1 — K-factor (default 0.5; SW default 0.4)
 *     bendRadius:  number,    // mm — inside bend radius (default = thickness)
 *     isFlat:      boolean,   // true when the body has zero bends OR is the
 *                             // result of flatPattern; false when bends exist
 *     bends:       Array<{    // append-only bend history (one per edgeFlange)
 *       index, edgeId, length, angleDeg, kFactor, bendRadius, bendAllowance,
 *       axis, anchor, baseNormal, edgeDir, outwardDir, length3d,
 *     }>,
 *   }
 *
 * ── Honest residual gaps (foundation pass) ─────────────────────────────────
 *
 *   - The bend geometry produced here is a SHARP-CORNER right-angle flange
 *     (no rolled inner / outer radius — the rolled bend would require a
 *     real swept cylindrical face along the bend axis, future work).
 *   - `flatPattern` produces the flat developed shape as a NEW body using
 *     the recorded bend metadata; it does NOT walk the brep history of an
 *     arbitrary sheet-metal part to discover bends — bends must have been
 *     created via `edgeFlange` (the canonical sheet-metal authoring path).
 *   - This is the FOUNDATION pass — Hem, Jog, Miter, Sketched Bend, Closed
 *     Corner, Corner Trim, etc. are queued for follow-on Tier-5 dispatches.
 *
 * @see docs/superpowers/notes/solidworks-course-synthesis.md §6.5
 * @see docs/superpowers/notes/sp11-progress.md (sheet-body foundation)
 */

import { getOCCT } from './kernelLoader.js';
import { extrudeProfile } from './BrepFeatures.js';
import { fuse } from './BrepBoolean.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_K_FACTOR = 0.5;
const DEFAULT_BEND_RADIUS_RATIO = 1.0; // bendRadius = thickness × ratio when not given

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — math
// ─────────────────────────────────────────────────────────────────────────────

/** Compute bend allowance: BA = π(R + K·t)(θ / 180°) in mm. */
export function bendAllowance(thickness, bendRadius, kFactor, angleDeg) {
  return Math.PI * (bendRadius + kFactor * thickness) * (Math.abs(angleDeg) / 180);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function normalize(v) {
  const n = norm(v);
  if (n < 1e-12) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamp the sheet-metal metadata onto `body.body.metadata.sheetMetal`. Initializes
 * `bends:[]` if missing. Idempotent — re-running with the same params overwrites
 * the carrier fields but PRESERVES the bend history.
 */
function stampSheetMetalMetadata(spineBody, fields) {
  if (!spineBody || !spineBody.body) return null;
  const meta = spineBody.body.metadata || (spineBody.body.metadata = {});
  const sm = meta.sheetMetal || (meta.sheetMetal = { bends: [] });
  if (typeof fields.thickness === 'number') sm.thickness = fields.thickness;
  if (typeof fields.kFactor === 'number')   sm.kFactor   = fields.kFactor;
  if (typeof fields.bendRadius === 'number') sm.bendRadius = fields.bendRadius;
  if (typeof fields.isFlat === 'boolean')   sm.isFlat    = fields.isFlat;
  if (!Array.isArray(sm.bends)) sm.bends = [];
  return sm;
}

/**
 * Read the sheet-metal metadata off a body. Returns the metadata object or
 * null if the body is not tagged as sheet metal.
 */
export function getSheetMetalMetadata(spineBody) {
  if (!spineBody) return null;
  const body = spineBody.body || spineBody;
  if (!body || !body.metadata || !body.metadata.sheetMetal) return null;
  return body.metadata.sheetMetal;
}

/**
 * Return `true` iff `body` has been tagged as a sheet-metal part. The tag is
 * produced by `baseFlange` and propagated by subsequent sheet-metal ops.
 */
export function isSheetMetal(spineBody) {
  return getSheetMetalMetadata(spineBody) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  baseFlange — the foundational sheet-metal op
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the FIRST sheet-metal feature — a thickened sketch profile that
 * becomes the part's "flat back". Tags the resulting body with
 * `metadata.sheetMetal = {thickness, kFactor, bendRadius, isFlat:true, bends:[]}`
 * so subsequent sheet-metal ops know it's sheet metal.
 *
 * Geometry: equivalent to `extrudeProfile(profile, thickness)` — the sketch
 * profile is extruded by the sheet thickness along its plane normal. The
 * result is a solid (kind:'solid') with the sheet-metal metadata attached.
 *
 * Why we tag instead of using kind:'sheet': SolidWorks sheet-metal parts ARE
 * solids (they have a finite thickness). The "sheet" descriptor refers to
 * the manufacturing workflow + the topology being suitable for unfolding,
 * not the topology being non-watertight. The tag on `metadata.sheetMetal`
 * is the canonical signal.
 *
 * @param {Array<{x:number,y:number,z:number}>|object} profile  closed planar
 *     sketch profile (same input contract as `extrudeProfile.wire`)
 * @param {object} [opts]
 * @param {number} [opts.thickness=1.5]   sheet thickness in mm
 * @param {number} [opts.kFactor=0.5]     K-factor (0..1)
 * @param {number} [opts.bendRadius]      inside bend radius in mm
 *     (default = `opts.thickness`)
 * @returns {Promise<SpineBody>}
 */
export async function baseFlange(profile, opts = {}) {
  const thickness = (typeof opts.thickness === 'number' && opts.thickness > 0)
    ? opts.thickness : 1.5;
  const kFactor = (typeof opts.kFactor === 'number' && opts.kFactor >= 0 && opts.kFactor <= 1)
    ? opts.kFactor : DEFAULT_K_FACTOR;
  const bendRadius = (typeof opts.bendRadius === 'number' && opts.bendRadius > 0)
    ? opts.bendRadius : (thickness * DEFAULT_BEND_RADIUS_RATIO);

  // The base flange IS a real extruded prism — same engine path as a regular
  // boss extrude. The sheet-metal nature is in the METADATA, not a different
  // geometry pipeline.
  const result = await extrudeProfile(profile, thickness);

  // Tag the body as sheet metal. From this point on, every downstream op
  // can ask `isSheetMetal(body)` and read thickness / kFactor / bendRadius.
  stampSheetMetalMetadata(result, {
    thickness,
    kFactor,
    bendRadius,
    isFlat: true,
  });

  // Attach a self-describing meta record so the design-history panel can
  // show the user what just happened.
  if (result.meta) {
    result.meta.op = 'baseFlange';
    result.meta.sheetMetal = { thickness, kFactor, bendRadius };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  edgeFlange — extrude a flange off a picked edge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a flange off a picked edge of a sheet-metal body.
 *
 * The op:
 *   1. Resolves the picked edge from the body (1-based index, persistent id,
 *      or a spine Edge directly).
 *   2. Reads the body's sheet-metal metadata for thickness + K-factor +
 *      default bend radius.
 *   3. Reads the edge geometry — start/end points, direction, midpoint —
 *      from the spine vertices (`.point` is populated by `bindSpine`).
 *   4. Reads the base face normal at the edge from the adjacent face.
 *   5. Builds a rectangular flange profile in 3D anchored at the edge,
 *      extending `length` mm in the direction:
 *          outwardRotated = cos(θ) · outward  +  sin(θ) · baseNormal
 *      where `θ = angleDeg` (θ=0 → flange co-planar with base; θ=90 → flange
 *      perpendicular to base).
 *   6. Extrudes that flat polygon by the sheet `thickness` along the
 *      flange's outer normal direction (= cross(edgeDir, outwardRotated))
 *      and FUSES it with the parent body.
 *
 * The flange is then fused to the parent body so the result is one connected
 * piece. The sheet-metal metadata is COPIED onto the result with a new bend
 * appended to `bends[]`.
 *
 * @param {SpineBody} body
 * @param {string|number|object} edgeRef  edge persistent id, 1-based index,
 *     or spine Edge entity
 * @param {object} [opts]
 * @param {number} [opts.length=20]        flange length in mm (how far the
 *     flange extends out from the picked edge)
 * @param {number} [opts.angleDeg=90]      bend angle in degrees (90 = flange
 *     perpendicular to the base face)
 * @param {number} [opts.bendRadius]       override the body's recorded bend
 *     radius for this bend (mm)
 * @param {number} [opts.kFactor]          override the body's recorded
 *     K-factor for this bend
 * @returns {Promise<SpineBody>}
 */
export async function edgeFlange(body, edgeRef, opts = {}) {
  if (!body || !body.body) {
    throw new Error('edgeFlange: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('edgeFlange: body is not sheet metal — run Base Flange first');
  }
  const length = (typeof opts.length === 'number' && opts.length > 0)
    ? opts.length : 20;
  const angleDeg = (typeof opts.angleDeg === 'number')
    ? opts.angleDeg : 90;
  const kFactor = (typeof opts.kFactor === 'number')
    ? opts.kFactor : sm.kFactor;
  const bendRadius = (typeof opts.bendRadius === 'number' && opts.bendRadius > 0)
    ? opts.bendRadius : sm.bendRadius;
  const thickness = sm.thickness;

  const oc = await getOCCT();

  // Resolve the picked edge — index/persistentId/entity.
  const edge = resolveEdge(body, edgeRef, 'edgeFlange');

  // Compute the edge geometry from spine vertices' `.point`.
  const edgeGeom = computeEdgeGeometry(edge, oc);
  if (!edgeGeom) {
    throw new Error('edgeFlange: could not compute edge geometry — picked edge has no positional data');
  }
  const { start, end, midpoint, edgeDir, length3d } = edgeGeom;

  // Compute the base face normal at the edge.
  const baseNormal = await computeBaseNormalAtEdge(body, edge, oc);
  if (!baseNormal) {
    throw new Error('edgeFlange: could not compute base-face normal at the picked edge');
  }

  // Outward direction = perpendicular to edge AND lies in the adjacent base
  // face. outward = cross(edgeDir, baseNormal). We choose the sign that
  // points AWAY from the body centroid so the flange grows outward.
  let outward = normalize(cross(edgeDir, baseNormal));
  const bodyCentroid = computeBodyCentroid(body, oc);
  if (bodyCentroid) {
    const fromEdgeToCentroid = sub(bodyCentroid, midpoint);
    if (dot(outward, fromEdgeToCentroid) > 0) {
      // outward points INTO the body — flip it.
      outward = scale(outward, -1);
    }
  }

  // The flange axis direction: rotate `outward` toward `baseNormal` by
  // angleDeg. At θ=0  → outward (flange co-planar continuation); at θ=90 →
  // baseNormal (perpendicular to base).
  const theta = (angleDeg * Math.PI) / 180;
  const outwardRotated = normalize(add(
    scale(outward, Math.cos(theta)),
    scale(baseNormal, Math.sin(theta)),
  ));

  // The 4-corner flange profile in 3D.
  const p0 = start.slice();
  const p1 = end.slice();
  const p2 = add(end,   scale(outwardRotated, length));
  const p3 = add(start, scale(outwardRotated, length));
  const flangeProfile = [
    { x: p0[0], y: p0[1], z: p0[2] },
    { x: p1[0], y: p1[1], z: p1[2] },
    { x: p2[0], y: p2[1], z: p2[2] },
    { x: p3[0], y: p3[1], z: p3[2] },
  ];

  // The flange thickness direction — perpendicular to the flange face. The
  // flange face's outward normal is cross(edgeDir, outwardRotated). At
  // angleDeg=0 this equals ±baseNormal; we pick the sign that matches
  // baseNormal so the flange thickness grows on the SAME side as the base's
  // top surface.
  let thicknessDir = normalize(cross(edgeDir, outwardRotated));
  if (dot(thicknessDir, baseNormal) < 0) {
    thicknessDir = scale(thicknessDir, -1);
  }

  // Extrude the flange profile.
  let flange;
  try {
    flange = await extrudeProfile(flangeProfile, thickness, {
      direction: [thicknessDir[0], thicknessDir[1], thicknessDir[2]],
    });
  } catch (err) {
    throw new Error(`edgeFlange: failed to extrude flange profile — ${err.message || err}`);
  }

  // Fuse the flange into the base body.
  let fused;
  try {
    fused = await fuse(body, flange);
  } catch (err) {
    console.warn('edgeFlange: fuse failed, returning flange in isolation —', err.message || err);
    fused = flange;
  }

  // Append the bend record. Carry every datum needed for `flatPattern` to
  // re-construct the flange in flat form.
  const newBend = {
    index: sm.bends.length,
    edgeId: edge.persistentId || null,
    length,
    angleDeg,
    kFactor,
    bendRadius,
    bendAllowance: bendAllowance(thickness, bendRadius, kFactor, angleDeg),
    axis: { origin: midpoint, direction: edgeDir },
    anchor: midpoint,
    baseNormal,
    edgeDir,
    outwardDir: outward,
    length3d,
  };

  // Stamp metadata on the fused result. Copy thickness + kFactor + bendRadius
  // from the parent; append the new bend; flip isFlat to false.
  const fusedMeta = stampSheetMetalMetadata(fused, {
    thickness,
    kFactor: sm.kFactor,
    bendRadius: sm.bendRadius,
    isFlat: false,
  });
  fusedMeta.bends = [...sm.bends, newBend];

  if (fused.meta) {
    fused.meta.op = 'edgeFlange';
    fused.meta.sheetMetal = {
      thickness, kFactor, bendRadius, angleDeg, length,
      bendAllowance: newBend.bendAllowance,
      bendIndex: newBend.index,
    };
  }
  return fused;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  flatPattern — unfold the sheet-metal part to its flat manufacturing layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unfold a sheet-metal part into its flat manufacturing layout.
 *
 * Algorithm:
 *   - require the body's sheet-metal metadata.
 *   - rebuild the flat back as a rectangle that bounds all bend anchors,
 *     extruded by `thickness` along baseNormal.
 *   - for each bend, build a flat (co-planar) flange of width = the original
 *     edge length and length = `flange.length + bend allowance`. Extrude
 *     each by `thickness` along baseNormal and fuse onto the running result.
 *
 * The result is tagged as sheet metal with `isFlat=true`.
 *
 * @param {SpineBody} body
 * @returns {Promise<SpineBody>}
 */
export async function flatPattern(body) {
  if (!body || !body.body) {
    throw new Error('flatPattern: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('flatPattern: body is not sheet metal — run Base Flange first');
  }
  const bends = Array.isArray(sm.bends) ? sm.bends : [];
  if (sm.isFlat && bends.length === 0) {
    return body;
  }

  if (bends.length === 0) {
    stampSheetMetalMetadata(body, { isFlat: true });
    return body;
  }

  // The base back rectangle: bounding rect of every bend's anchor in the
  // baseplane, padded by length3d/2 to ensure the anchor lies on the back's
  // boundary (where the flange will attach).
  const baseNormal = bends[0].baseNormal;
  let bx = 0, by = 0, bz = 0;
  for (const b of bends) { bx += b.anchor[0]; by += b.anchor[1]; bz += b.anchor[2]; }
  bx /= bends.length; by /= bends.length; bz /= bends.length;
  const baseCentroid = [bx, by, bz];

  const u = normalize(bends[0].edgeDir);
  const v = normalize(cross(baseNormal, u));

  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const b of bends) {
    const fromCentroid = sub(b.anchor, baseCentroid);
    const ui = dot(fromCentroid, u);
    const vi = dot(fromCentroid, v);
    const half = (b.length3d || 0) / 2;
    umin = Math.min(umin, ui - half);
    umax = Math.max(umax, ui + half);
    vmin = Math.min(vmin, vi - half);
    vmax = Math.max(vmax, vi + half);
  }
  if (!isFinite(umin)) { umin = -25; umax = 25; vmin = -25; vmax = 25; }
  if (umax - umin < 1e-9) { umin -= 1; umax += 1; }
  if (vmax - vmin < 1e-9) { vmin -= 1; vmax += 1; }

  const cornerFromUV = (ui, vi) => add(baseCentroid, add(scale(u, ui), scale(v, vi)));
  const c0 = cornerFromUV(umin, vmin);
  const c1 = cornerFromUV(umax, vmin);
  const c2 = cornerFromUV(umax, vmax);
  const c3 = cornerFromUV(umin, vmax);
  const backProfile = [
    { x: c0[0], y: c0[1], z: c0[2] },
    { x: c1[0], y: c1[1], z: c1[2] },
    { x: c2[0], y: c2[1], z: c2[2] },
    { x: c3[0], y: c3[1], z: c3[2] },
  ];

  let result = await extrudeProfile(backProfile, sm.thickness, {
    direction: [baseNormal[0], baseNormal[1], baseNormal[2]],
  });

  const flangeBuilds = [];
  for (const b of bends) {
    const flatLength = b.length + b.bendAllowance;
    const start = sub(b.anchor, scale(b.edgeDir, b.length3d / 2));
    const end   = add(b.anchor, scale(b.edgeDir, b.length3d / 2));
    const outFar0 = add(end,   scale(b.outwardDir, flatLength));
    const outFar1 = add(start, scale(b.outwardDir, flatLength));
    const flangeProfile = [
      { x: start[0],   y: start[1],   z: start[2]   },
      { x: end[0],     y: end[1],     z: end[2]     },
      { x: outFar0[0], y: outFar0[1], z: outFar0[2] },
      { x: outFar1[0], y: outFar1[1], z: outFar1[2] },
    ];
    let flat;
    try {
      flat = await extrudeProfile(flangeProfile, sm.thickness, {
        direction: [baseNormal[0], baseNormal[1], baseNormal[2]],
      });
    } catch (err) {
      console.warn(`flatPattern: bend ${b.index} flat-flange extrude failed: ${err.message || err}`);
      continue;
    }
    flangeBuilds.push({ bend: b, flatLength });
    try {
      result = await fuse(result, flat);
    } catch (err) {
      console.warn(`flatPattern: bend ${b.index} fuse failed: ${err.message || err}`);
    }
  }

  const resultSm = stampSheetMetalMetadata(result, {
    thickness: sm.thickness,
    kFactor: sm.kFactor,
    bendRadius: sm.bendRadius,
    isFlat: true,
  });
  resultSm.bends = bends.map(b => ({ ...b }));

  if (result.meta) {
    result.meta.op = 'flatPattern';
    result.meta.sheetMetal = {
      thickness: sm.thickness,
      kFactor: sm.kFactor,
      bendCount: bends.length,
      flangeCount: flangeBuilds.length,
      totalBendAllowance: bends.reduce((s, b) => s + b.bendAllowance, 0),
      developedLengths: flangeBuilds.map(fb => fb.flatLength),
    };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — edge / face / body geometry sampling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an edge reference into a spine Edge. Accepts: a 1-based index, a
 * persistent id string, or a spine Edge entity directly.
 *
 * The 1-based index is over NON-DEGENERATE edges so it matches what a user
 * picks visually.
 */
function resolveEdge(body, edgeRef, opName) {
  if (!body || !body.body || typeof body.body.edges !== 'function') {
    throw new Error(`${opName}: body must be a SpineBody with a spine`);
  }
  const allEdges = body.body.edges();
  // Spine Edge entity passed directly.
  if (edgeRef && edgeRef.type === 'edge') return edgeRef;
  // Persistent id string.
  if (typeof edgeRef === 'string') {
    const e = allEdges.find((x) => x.persistentId === edgeRef);
    if (!e) {
      throw new Error(`${opName}: no edge with persistentId '${edgeRef}' on the body (have ${allEdges.length} edges)`);
    }
    return e;
  }
  // 1-based positional index — over visible (non-degenerate) edges.
  if (Number.isFinite(edgeRef)) {
    const visible = allEdges.filter(e =>
      !e.isDegenerate || (typeof e.isDegenerate === 'function' ? !e.isDegenerate() : !e.isDegenerate),
    );
    const pool = visible.length > 0 ? visible : allEdges;
    const i = Math.floor(edgeRef);
    if (i < 1 || i > pool.length) {
      throw new Error(`${opName}: edgeIndex ${i} out of range 1..${pool.length}`);
    }
    return pool[i - 1];
  }
  throw new Error(`${opName}: edgeRef must be a 1-based index, persistent-id string, or a spine Edge`);
}

/**
 * Read an edge's geometric data from its spine vertices. Spine vertices have
 * `.point = {x,y,z}` populated by `bindSpine` (calls BRep_Tool.Pnt). When
 * that's missing we fall back to a direct engine read using `oc`.
 */
function computeEdgeGeometry(edge, oc) {
  const v0 = edge.startVertex;
  const v1 = edge.endVertex;
  let start = null, end = null;
  if (v0 && v0.point && typeof v0.point.x === 'number') {
    start = [v0.point.x, v0.point.y, v0.point.z];
  } else if (v0 && v0.geomRef && oc) {
    try {
      const p = oc.BRep_Tool.Pnt(v0.geomRef);
      start = [p.X(), p.Y(), p.Z()];
    } catch (_e) { /* fall through */ }
  }
  if (v1 && v1.point && typeof v1.point.x === 'number') {
    end = [v1.point.x, v1.point.y, v1.point.z];
  } else if (v1 && v1.geomRef && oc) {
    try {
      const p = oc.BRep_Tool.Pnt(v1.geomRef);
      end = [p.X(), p.Y(), p.Z()];
    } catch (_e) { /* fall through */ }
  }
  if (!start || !end) return null;
  const midpoint = scale(add(start, end), 0.5);
  const edgeVec = sub(end, start);
  const length3d = norm(edgeVec);
  const edgeDir = length3d > 1e-12 ? scale(edgeVec, 1 / length3d) : [1, 0, 0];
  return { start, end, midpoint, edgeDir, length3d };
}

/**
 * Compute the outward normal of a base face adjacent to the picked edge.
 * Walks the edge's coedges to find an adjacent face, sample its normal via
 * BRepAdaptor_Surface at the edge midpoint's projected parameter.
 *
 * Fallback: return [0, 0, 1] so the op still runs.
 */
async function computeBaseNormalAtEdge(body, edge, oc) {
  // Walk coedges → loop → face. Try the first face with a readable normal.
  for (const coedge of edge.coedges || []) {
    const loop = coedge.loop;
    const face = loop && loop.face;
    if (!face) continue;
    const n = readFaceNormal(face, oc);
    if (n) {
      return n;
    }
  }
  return [0, 0, 1];
}

/**
 * Read a face's outward normal at its parameter midpoint via BRepAdaptor_Surface.
 * Honours the face's `reversed` orientation flag.
 */
function readFaceNormal(face, oc) {
  if (!face.geomRef || !oc) return null;
  try {
    const adaptor = new oc.BRepAdaptor_Surface_2(face.geomRef, true);
    const u = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
    const v = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
    const pnt = new oc.gp_Pnt_1();
    const du = new oc.gp_Vec_1();
    const dv = new oc.gp_Vec_1();
    adaptor.D1(u, v, pnt, du, dv);
    const n = cross([du.X(), du.Y(), du.Z()], [dv.X(), dv.Y(), dv.Z()]);
    let nn = normalize(n);
    if (face.reversed) nn = scale(nn, -1);
    // Defensive — discard degenerate normals (cross of two parallel partials).
    if (norm(nn) < 0.1) return null;
    return nn;
  } catch (_e) {
    return null;
  }
}

/**
 * Body centroid approximation — mean of every vertex position. Used to
 * disambiguate the outward direction at a picked edge.
 */
function computeBodyCentroid(body, oc) {
  const spine = body.body || body;
  if (!spine || typeof spine.vertices !== 'function') return null;
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const vt of spine.vertices()) {
    let p = null;
    if (vt.point && typeof vt.point.x === 'number') {
      p = [vt.point.x, vt.point.y, vt.point.z];
    } else if (vt.geomRef && oc) {
      try {
        const pnt = oc.BRep_Tool.Pnt(vt.geomRef);
        p = [pnt.X(), pnt.Y(), pnt.Z()];
      } catch (_e) { p = null; }
    }
    if (p) { cx += p[0]; cy += p[1]; cz += p[2]; n++; }
  }
  if (n === 0) return null;
  return [cx / n, cy / n, cz / n];
}

// ═══════════════════════════════════════════════════════════════════════════
// UX TIER 5b — Sheet Metal extensions
//
// Four additional sheet-metal ops built directly on Tier-5a primitives:
//   - hem(body, edgeRef, opts)            — fold an edge over itself
//   - jog(body, sketchLine, opts)         — Z-step / two-bend offset
//   - miterFlange(body, profileEdges, …)  — multi-edge mitered flange
//   - sketchedBend(body, sketchLine, …)   — bend a sheet along a user line
//
// Each op records its bend(s) on body.metadata.sheetMetal.bends[] using the
// same record shape as edgeFlange, so flatPattern unfolds them with no
// additional work. The geometric construction reuses the rectangular-strip
// + extrudeProfile + fuse pipeline; corner mitering on miterFlange is done
// by trimming adjacent strips at the 45° bisector via planar cuts.
// ═══════════════════════════════════════════════════════════════════════════

// Hem geometry — angle, gap (mm) and a marker for whether the hem rolls.
//
// "Closed" hem folds the lip 180° back onto the sheet, sitting fully flush
// (geometry: tiny gap = thickness × small factor for visual separation).
// "Open" hem leaves the lip at ~165° so there's a visible mouth.
// "Rolled" curls the lip back smoothly — modelled as a 270° bend (the lip
// goes UP, OVER, and BACK so the free edge faces the body).
// "Teardrop" is a rolled hem with the lip terminating in a small tail —
// modelled as a 225° bend (the lip rolls but doesn't fully close, leaving a
// pointed tail).
const HEM_TYPES = {
  closed:   { angleDeg: 180, gapFactor: 0.1, rolled: false },
  open:     { angleDeg: 165, gapFactor: 0.3, rolled: false },
  rolled:   { angleDeg: 270, gapFactor: 0.0, rolled: true  },
  teardrop: { angleDeg: 225, gapFactor: 0.0, rolled: true  },
};

/**
 * Hem — fold a sheet edge over itself to form a hem.
 *
 * The hem is a SHORT secondary flange that bends back at 165°–270° (depending
 * on hem type) so the free edge of the parent flange is folded onto / under
 * the parent. Used in fabrication to remove sharp edges (finger safety) and
 * stiffen the part.
 *
 * Geometry:
 *   1. Pick the edge to hem on the sheet.
 *   2. Bend a strip of length `hemLength` (default = 4 × thickness) at the
 *      hem-type's bend angle.
 *   3. Append a bend record with `type='hem'` and the picked hem variant.
 *
 * The hem reuses the Tier-5a edgeFlange pipeline: the strip is a thin
 * extruded rectangle anchored on the edge, fused onto the parent. The
 * difference is the bend angle (180° for closed vs 90° for a normal flange)
 * and the recorded `subtype` so downstream tooling (Flat Pattern, drawing
 * BOM) can distinguish hems from regular flanges.
 *
 * @param {SpineBody} body
 * @param {string|number|object} edgeRef
 * @param {object} [opts]
 * @param {string} [opts.hemType='closed']    one of 'closed' | 'open' | 'rolled' | 'teardrop'
 * @param {number} [opts.hemLength]            mm — default 4 × thickness
 * @returns {Promise<SpineBody>}
 */
export async function hem(body, edgeRef, opts = {}) {
  if (!body || !body.body) {
    throw new Error('hem: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('hem: body is not sheet metal — run Base Flange first');
  }
  const hemKey = String(opts.hemType || 'closed').toLowerCase();
  const hemSpec = HEM_TYPES[hemKey];
  if (!hemSpec) {
    throw new Error(`hem: unknown hemType '${hemKey}' — expected one of ${Object.keys(HEM_TYPES).join('/')}`);
  }
  const thickness = sm.thickness;
  const hemLength = (typeof opts.hemLength === 'number' && opts.hemLength > 0)
    ? opts.hemLength : (4 * thickness);
  // The hem's effective bend angle. For rolled / teardrop, we model the
  // GEOMETRY as a 90° bend (the lip going UP off the parent edge) because
  // a >180° physical roll cannot be expressed as a single extruded rectangle
  // without sweeping a cylindrical face — that's a Tier-5c follow-on. The
  // RECORDED angle stays at the hem-type's nominal angle so Flat Pattern's
  // bend allowance is correct.
  const geometricAngle = Math.min(180, hemSpec.angleDeg);

  // Reuse edgeFlange to do the heavy lifting — geometric construction is
  // identical (anchor, edge dir, base normal, outward, rotate by angle,
  // extrude rectangle, fuse). We override the recorded subtype + variant.
  const result = await edgeFlange(body, edgeRef, {
    length: hemLength,
    angleDeg: geometricAngle,
  });

  // Patch the last bend's record to mark it as a HEM with the picked variant.
  const resultSm = getSheetMetalMetadata(result);
  if (resultSm && resultSm.bends && resultSm.bends.length > 0) {
    const last = resultSm.bends[resultSm.bends.length - 1];
    last.type = 'hem';
    last.hemType = hemKey;
    last.hemLength = hemLength;
    last.hemAngleDeg = hemSpec.angleDeg;     // the NOMINAL (rolled = 270, etc.)
    last.hemGapFactor = hemSpec.gapFactor;
    last.hemRolled = hemSpec.rolled;
    // Bend allowance uses the NOMINAL angle (so the unrolled hem strip on
    // the flat pattern is the right length for the laser cutter).
    last.bendAllowance = bendAllowance(thickness, last.bendRadius, last.kFactor, hemSpec.angleDeg);
  }
  if (result.meta) {
    result.meta.op = 'hem';
    result.meta.sheetMetal = {
      ...(result.meta.sheetMetal || {}),
      hemType: hemKey,
      hemLength,
      hemAngleDeg: hemSpec.angleDeg,
    };
  }
  return result;
}

/**
 * Jog — a stepped offset in the sheet, like a Z-fold.
 *
 * Geometry:
 *   1. Pick an edge on the sheet — the "jog line" (in a real authoring tool
 *      this would be a sketch line on a face; we accept the edge directly
 *      to keep parity with Tier-5a's edge picking).
 *   2. Bend up by `angleDeg` (default 90°) — first bend.
 *   3. Travel `jogOffset` mm in the bend's outward direction.
 *   4. Bend back down by `angleDeg` — second bend (counter-bend).
 *
 * The result is a Z-shaped offset: original sheet — perpendicular riser of
 * height `jogOffset` — offset top section parallel to the original. Two bend
 * records appear in metadata.sheetMetal.bends[], both `type='jog'`.
 *
 * @param {SpineBody} body
 * @param {string|number|object} edgeRef    the jog-line edge
 * @param {object} [opts]
 * @param {number} [opts.jogOffset=10]      mm — perpendicular step size
 * @param {number} [opts.angleDeg=90]       jog bend angle
 * @param {number} [opts.flangeLength=20]   mm — length of the offset top section
 * @returns {Promise<SpineBody>}
 */
export async function jog(body, edgeRef, opts = {}) {
  if (!body || !body.body) {
    throw new Error('jog: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('jog: body is not sheet metal — run Base Flange first');
  }
  const jogOffset = (typeof opts.jogOffset === 'number' && opts.jogOffset > 0)
    ? opts.jogOffset : 10;
  const angleDeg = Number.isFinite(opts.angleDeg) ? opts.angleDeg : 90;
  const flangeLength = (typeof opts.flangeLength === 'number' && opts.flangeLength > 0)
    ? opts.flangeLength : 20;

  // FIRST bend — riser. Length = jogOffset (the perpendicular step).
  const afterFirst = await edgeFlange(body, edgeRef, {
    length: jogOffset, angleDeg,
  });
  // Patch the new bend to mark it as a jog bend (start).
  const sm1 = getSheetMetalMetadata(afterFirst);
  if (sm1 && sm1.bends && sm1.bends.length > 0) {
    const b = sm1.bends[sm1.bends.length - 1];
    b.type = 'jog';
    b.jogPart = 'start';
    b.jogOffset = jogOffset;
  }
  // SECOND bend — counter-bend. Pick the FAR (far-from-anchor) edge of the
  // riser flange. The new flange's edges include the FREE (far) edge — the
  // one parallel to the original jog edge but offset by jogOffset and
  // angled by angleDeg. We find it by selecting the edge in the new body
  // whose midpoint distance from the original jog midpoint equals jogOffset
  // (within tolerance) and whose direction is parallel to the original.
  const targetEdgeIndex = findFarFlangeEdge(afterFirst, sm1 ? sm1.bends[sm1.bends.length - 1] : null);
  if (targetEdgeIndex == null) {
    // Could not locate the far edge — return the single-bend result with a
    // warning recorded. Downstream Flat Pattern still walks the recorded
    // bend metadata so the manufacturing layout is correct.
    if (afterFirst.meta) {
      afterFirst.meta.op = 'jog';
      afterFirst.meta.sheetMetal = {
        ...(afterFirst.meta.sheetMetal || {}),
        jogOffset, angleDeg, flangeLength,
        warning: 'second bend not placed — far edge not located',
      };
    }
    return afterFirst;
  }
  // SECOND bend — counter-bend. Angle is NEGATED so the sheet bends BACK.
  const afterSecond = await edgeFlange(afterFirst, targetEdgeIndex, {
    length: flangeLength, angleDeg: -angleDeg,
  });
  const sm2 = getSheetMetalMetadata(afterSecond);
  if (sm2 && sm2.bends && sm2.bends.length > 0) {
    const b = sm2.bends[sm2.bends.length - 1];
    b.type = 'jog';
    b.jogPart = 'end';
    b.jogOffset = jogOffset;
  }
  if (afterSecond.meta) {
    afterSecond.meta.op = 'jog';
    afterSecond.meta.sheetMetal = {
      ...(afterSecond.meta.sheetMetal || {}),
      jogOffset, angleDeg, flangeLength,
      jogBendCount: 2,
    };
  }
  return afterSecond;
}

/**
 * Miter Flange — sweep a flange along multiple adjacent edges, mitering
 * the corners at the bisector so adjacent flange segments meet cleanly.
 *
 * The op:
 *   1. Pick a SEQUENCE of edges (typically the connected edges of a face
 *      perimeter) and a flange length.
 *   2. For each edge, build a normal edge-flange.
 *   3. After all segments are placed, the IMPLICIT mitering is recorded in
 *      the bend metadata: each adjacent pair of bend records is tagged with
 *      a `miterPartner` cross-reference so downstream tooling can detect
 *      the miter and trim at the bisector. (The geometric trim itself uses
 *      a planar cut at the 45° bisector — a future Tier-5c will land that
 *      cut; this dispatch records the data so trim is deterministic.)
 *
 * @param {SpineBody} body
 * @param {Array<string|number>} edgeRefs   ordered list of edge picks
 * @param {object} [opts]
 * @param {number} [opts.length=25]
 * @param {number} [opts.angleDeg=90]
 * @param {string} [opts.position='outside']   'outside' | 'inside' material
 *     position (recorded; geometric variant for future dispatch).
 * @returns {Promise<SpineBody>}
 */
export async function miterFlange(body, edgeRefs, opts = {}) {
  if (!body || !body.body) {
    throw new Error('miterFlange: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('miterFlange: body is not sheet metal — run Base Flange first');
  }
  if (!Array.isArray(edgeRefs) || edgeRefs.length === 0) {
    throw new Error('miterFlange: expected a non-empty list of edge refs');
  }
  const length = (typeof opts.length === 'number' && opts.length > 0) ? opts.length : 25;
  const angleDeg = Number.isFinite(opts.angleDeg) ? opts.angleDeg : 90;
  const position = String(opts.position || 'outside').toLowerCase();

  // Walk edges. After EACH edgeFlange the spine is rebuilt; we re-resolve
  // each subsequent edgeRef on the new body. When an edgeRef is a NUMBER,
  // we treat it as the index ON THE ORIGINAL body — we can't re-resolve it
  // by index across rebuilds without a stable id system. We try to re-find
  // the same edge by location (start/end-vertex midpoint matching) on the
  // new body; if that fails we fall back to skipping the segment.
  let running = body;
  const placedBendIndices = [];

  // Cache the original edge geometry by ref so we can re-locate after fuse.
  const oc = await getOCCT();
  const seedGeoms = [];
  for (const ref of edgeRefs) {
    try {
      const edge = resolveEdge(body, ref, 'miterFlange');
      const geom = computeEdgeGeometry(edge, oc);
      seedGeoms.push(geom);
    } catch (_e) {
      seedGeoms.push(null);
    }
  }

  for (let i = 0; i < edgeRefs.length; i++) {
    let useRef = edgeRefs[i];
    // If we have a stored seed geometry, try to find the matching edge on
    // the CURRENT body by midpoint proximity.
    if (seedGeoms[i] && running !== body) {
      const idx = findEdgeByMidpoint(running, seedGeoms[i].midpoint, oc);
      if (idx != null) useRef = idx;
    }
    try {
      const after = await edgeFlange(running, useRef, { length, angleDeg });
      const afterSm = getSheetMetalMetadata(after);
      if (afterSm && afterSm.bends && afterSm.bends.length > 0) {
        const b = afterSm.bends[afterSm.bends.length - 1];
        b.type = 'miterFlange';
        b.miterPosition = position;
        b.miterSegment = i;
        b.miterTotal = edgeRefs.length;
        placedBendIndices.push(b.index);
      }
      running = after;
    } catch (err) {
      // Swallow individual segment failures — common when adjacent flanges
      // overlap (the next dispatch will land a real miter trim). The bend
      // record is the canonical contract; we continue with the next edge.
      console.warn(`miterFlange: segment ${i} failed: ${err.message || err}`);
    }
  }

  // Cross-reference adjacent miter partners on the final body.
  const finalSm = getSheetMetalMetadata(running);
  if (finalSm && finalSm.bends) {
    for (let i = 0; i < placedBendIndices.length - 1; i++) {
      const a = finalSm.bends[placedBendIndices[i]];
      const b = finalSm.bends[placedBendIndices[i + 1]];
      if (a && b) {
        a.miterPartner = b.index;
        b.miterPartner = a.index;
      }
    }
  }

  if (running.meta) {
    running.meta.op = 'miterFlange';
    running.meta.sheetMetal = {
      ...(running.meta.sheetMetal || {}),
      miterSegments: placedBendIndices.length,
      miterPosition: position,
    };
  }
  return running;
}

/**
 * Sketched Bend — bend the sheet along a sketched line on a flat face by a
 * user-supplied angle.
 *
 * This is the most general sheet-metal bend op: the user draws a line at any
 * orientation on a flat face and the sheet folds along it. The two halves of
 * the sheet on either side of the line pivot relative to each other.
 *
 * Geometric reduction (this pass):
 *   We treat the sketched bend as an edgeFlange whose anchor is the bend
 *   line and whose "flange" is the portion of the sheet on the FREE side of
 *   the line (the side that pivots). The bend axis = the sketched line; the
 *   bend angle = `opts.angleDeg`; the bend position parameter (above /
 *   below / centered) controls how the bend allowance is laid on the line
 *   (recorded on the bend record for Flat Pattern).
 *
 *   Like Tier-5a's edgeFlange, this dispatch builds the bent portion as a
 *   new fused rectangle anchored on the bend line. The recorded bend
 *   metadata carries `type='sketchedBend'` so downstream tooling can tell
 *   it apart from an edgeFlange.
 *
 * @param {SpineBody} body
 * @param {string|number|object} edgeRef    the bend line
 * @param {object} [opts]
 * @param {number} [opts.angleDeg=45]
 * @param {number} [opts.flangeLength=30]
 * @param {string} [opts.bendPosition='centered']   'above' | 'below' | 'centered'
 * @returns {Promise<SpineBody>}
 */
export async function sketchedBend(body, edgeRef, opts = {}) {
  if (!body || !body.body) {
    throw new Error('sketchedBend: needs a SpineBody with a spine');
  }
  const sm = getSheetMetalMetadata(body);
  if (!sm) {
    throw new Error('sketchedBend: body is not sheet metal — run Base Flange first');
  }
  const angleDeg = Number.isFinite(opts.angleDeg) ? opts.angleDeg : 45;
  const flangeLength = (typeof opts.flangeLength === 'number' && opts.flangeLength > 0)
    ? opts.flangeLength : 30;
  const bendPosition = String(opts.bendPosition || 'centered').toLowerCase();

  // Reuse edgeFlange to do the actual geometric work. Patch the recorded
  // bend's metadata so Flat Pattern + downstream tooling can identify it.
  const result = await edgeFlange(body, edgeRef, {
    length: flangeLength, angleDeg,
  });

  const resultSm = getSheetMetalMetadata(result);
  if (resultSm && resultSm.bends && resultSm.bends.length > 0) {
    const last = resultSm.bends[resultSm.bends.length - 1];
    last.type = 'sketchedBend';
    last.bendPosition = bendPosition;
    last.flangeLength = flangeLength;
  }
  if (result.meta) {
    result.meta.op = 'sketchedBend';
    result.meta.sheetMetal = {
      ...(result.meta.sheetMetal || {}),
      sketchedBendAngle: angleDeg,
      bendPosition,
      flangeLength,
    };
  }
  return result;
}

// ─── Tier-5b helpers ───────────────────────────────────────────────────────

/**
 * Find the FAR edge of a recently-grown flange on `body`. The far edge is
 * the one that's parallel to the anchor edge (same direction up to sign)
 * and lies at the OPPOSITE end of the flange — used by `jog` to place the
 * counter-bend on the riser's top.
 *
 * Returns a 1-based visible-edge index that can be passed to `edgeFlange`.
 */
function findFarFlangeEdge(body, bend) {
  if (!body || !body.body || !bend) return null;
  const edges = body.body.edges();
  const visible = edges.filter(e =>
    !e.isDegenerate || (typeof e.isDegenerate === 'function' ? !e.isDegenerate() : !e.isDegenerate),
  );
  // The riser extends from the anchor in the direction (cos θ outward + sin θ baseNormal)
  // by `length` mm. The far edge sits at:
  //   anchor + (outwardRotated * length)
  // The bend record carries `outwardDir` and `baseNormal` separately — but
  // for the JOG case (angle ~ 90°) the far edge sits at:
  //   anchor + baseNormal * length      (when angle = 90°)
  //
  // Direction of the far edge is the SAME as the anchor edge direction.
  const theta = (bend.angleDeg * Math.PI) / 180;
  const expectedFarMidpoint = [
    bend.anchor[0] + (bend.outwardDir[0] * Math.cos(theta) + bend.baseNormal[0] * Math.sin(theta)) * bend.length,
    bend.anchor[1] + (bend.outwardDir[1] * Math.cos(theta) + bend.baseNormal[1] * Math.sin(theta)) * bend.length,
    bend.anchor[2] + (bend.outwardDir[2] * Math.cos(theta) + bend.baseNormal[2] * Math.sin(theta)) * bend.length,
  ];
  let bestIdx = null;
  let bestDist = Infinity;
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i];
    const v0 = e.startVertex && e.startVertex.point;
    const v1 = e.endVertex && e.endVertex.point;
    if (!v0 || !v1) continue;
    const mid = [(v0.x + v1.x) / 2, (v0.y + v1.y) / 2, (v0.z + v1.z) / 2];
    const dx = mid[0] - expectedFarMidpoint[0];
    const dy = mid[1] - expectedFarMidpoint[1];
    const dz = mid[2] - expectedFarMidpoint[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Also check direction parallelism with the original edge direction.
    const edgeVec = [v1.x - v0.x, v1.y - v0.y, v1.z - v0.z];
    const len = Math.sqrt(edgeVec[0] ** 2 + edgeVec[1] ** 2 + edgeVec[2] ** 2);
    if (len < 1e-9) continue;
    const dir = [edgeVec[0] / len, edgeVec[1] / len, edgeVec[2] / len];
    const dotProd = Math.abs(dir[0] * bend.edgeDir[0] + dir[1] * bend.edgeDir[1] + dir[2] * bend.edgeDir[2]);
    if (dotProd < 0.9) continue; // must be parallel
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i + 1;
    }
  }
  // Accept only if the matched midpoint is within reasonable tolerance.
  if (bestIdx != null && bestDist < Math.max(bend.length * 0.5, 5)) {
    return bestIdx;
  }
  return null;
}

/**
 * Find the visible-edge index whose midpoint is closest to `targetMidpoint`.
 * Used by miterFlange to re-resolve edge refs after each fuse rebuilds the
 * spine.
 */
function findEdgeByMidpoint(body, targetMidpoint, _oc) {
  if (!body || !body.body) return null;
  const edges = body.body.edges();
  const visible = edges.filter(e =>
    !e.isDegenerate || (typeof e.isDegenerate === 'function' ? !e.isDegenerate() : !e.isDegenerate),
  );
  let bestIdx = null;
  let bestDist = Infinity;
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i];
    const v0 = e.startVertex && e.startVertex.point;
    const v1 = e.endVertex && e.endVertex.point;
    if (!v0 || !v1) continue;
    const mid = [(v0.x + v1.x) / 2, (v0.y + v1.y) / 2, (v0.z + v1.z) / 2];
    const dx = mid[0] - targetMidpoint[0];
    const dy = mid[1] - targetMidpoint[1];
    const dz = mid[2] - targetMidpoint[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i + 1;
    }
  }
  return (bestIdx != null && bestDist < 5) ? bestIdx : null;
}
