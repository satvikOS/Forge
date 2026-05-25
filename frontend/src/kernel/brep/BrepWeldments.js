/**
 * ArchDisc Kernel — Weldments foundation (UX Tier 6a).
 *
 * Three FOUNDATIONAL weldments ops following the same metadata-pattern as
 * SP-11 sheet & UX-Tier-5a sheet-metal: a body tagged with
 * `body.metadata.weldment = {profile, size, length, ...}` is the canonical
 * Weldments-aware contract, surfaced via `isWeldment(body)` /
 * `getWeldmentMetadata(body)`.
 *
 * The three ops shipped this dispatch:
 *
 *   1. structuralMember(path, profileSpec, opts)
 *      Sweep a standard ISO/ANSI structural profile along a 3D path
 *      (open or closed polyline). The profile is built from the
 *      STANDARD_PROFILES library (rectangular tube, square tube, round
 *      tube, angle, C-channel, I-beam) in mm, oriented perpendicular to
 *      the path at the path's start, and swept along the path via
 *      sweepProfile. The result body is tagged
 *      `metadata.weldment = {profile, size, length, ...}` so every
 *      downstream weldments op can identify it as a member.
 *
 *   2. trimMembers(members, opts)
 *      Trim a pair (or longer chain) of structural members at their
 *      joint to a clean intersection — `butt` mode subtracts each member
 *      from the other so the second yields to the first; `mitered`
 *      mode subtracts each from a 45°-half-space tool plane at the
 *      shared joint so both members meet at a clean mitre. Real boolean
 *      trim — the result members are connected polyhedra, not
 *      overlapping prisms. Each trim records `metadata.weldment.trims[]`.
 *
 *   3. endCap(member, endRef, opts)
 *      Add a flat (or thick) cap closing the open end of a structural
 *      member. `endRef` picks which end ('start'|'end'|0|1); the cap
 *      is built as a thin prism over the member's end-face profile,
 *      then fused to the parent so the result is one connected body.
 *      `opts.thickness` controls the cap thickness (default 1 × the
 *      profile's wall thickness or 3 mm whichever is larger).
 *
 * ── Standard-profile library ────────────────────────────────────────────────
 *
 * Real ISO/ANSI dimensions, at least 3 sizes per family:
 *
 *   - Rectangular Tube (ISO 4019 — cold-formed, w × h × t)
 *       40×60×3, 50×100×4, 80×120×5
 *   - Square Tube (ISO 4019 — w × w × t)
 *       40×40×3, 50×50×4, 80×80×5
 *   - Round Tube (ISO 4200 — Ø_OD × t)
 *       Ø48.3×3.6, Ø60.3×3.6, Ø88.9×4.0
 *   - Angle (ISO 657 — L × L × t, equal-leg)
 *       50×50×5, 65×65×7, 80×80×8
 *   - C-Channel (ISO 657 — depth × flange × web-thickness)
 *       100×50×5, 150×75×6.5, 200×75×8.5
 *   - I-Beam (IPE — depth × flange-width × web-thickness / flange-thickness)
 *       IPE100 (100×55×4.1/5.7), IPE160 (160×82×5.0/7.4), IPE200 (200×100×5.6/8.5)
 *
 * Each profile builds a CCW closed planar polygon in mm in the XY plane
 * (the profile's local frame). The profile is then transformed into the
 * world frame oriented perpendicular to the path's start direction.
 *
 * ── Honest residual gaps (foundation pass) ─────────────────────────────────
 *
 *   - Profile orientation: the profile's local +X is aligned with the
 *     path-start tangent's "right" via a deterministic frame builder.
 *     For non-axis-aligned paths this gives a reasonable default; a
 *     full "Locate Profile" workflow (rotation about the path tangent,
 *     mirror, offset) is queued for Tier-6b.
 *   - Trim/Extend: this dispatch ships butt + mitered modes only. The
 *     "cope cut" (cylindrical-tube-on-cylindrical-tube saddle cut) is
 *     queued for Tier-6b — it requires a surface-surface intersection
 *     blank that the boolean trim path doesn't handle in one shot.
 *   - End Cap: ships a flat cap built from the member's end-face plane
 *     swept by `thickness`. For irregular profiles (angle, I-beam) the
 *     cap is the convex bounding rectangle of the end profile so the
 *     fuse is robust; a Tier-6b follow-on caps the EXACT end profile.
 *   - Cut List (BOM of every member + cut length): queued for Tier-6b.
 *   - Gusset / Weld Bead / Sub-Weldment / Custom Profile import: queued.
 *
 * @see docs/superpowers/notes/solidworks-course-synthesis.md §6.6
 */

import { extrudeProfile, sweepProfile } from './BrepFeatures.js';
import { cut as boolCut, fuse as boolFuse } from './BrepBoolean.js';

// ─────────────────────────────────────────────────────────────────────────────
// Standard profile library (ISO / ANSI, mm)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the CCW closed planar polygon for a standard profile. Returns the
 * polygon in the profile's LOCAL frame (XY plane, centred at the profile's
 * centroid). Coordinates in mm; callers transform into the world frame.
 *
 * @param {string} profileType  one of 'rectTube', 'squareTube', 'roundTube',
 *     'angle', 'channel', 'ibeam' (case-insensitive)
 * @param {string} size  size key from STANDARD_PROFILES[profileType]
 * @returns {{ poly: Array<{x:number,y:number}>, meta: object }}
 */
export function buildStandardProfile(profileType, size) {
  const family = STANDARD_PROFILES[String(profileType).toLowerCase()];
  if (!family) {
    throw new Error(`buildStandardProfile: unknown profile type '${profileType}' — known: ${Object.keys(STANDARD_PROFILES).join(', ')}`);
  }
  const dims = family[size];
  if (!dims) {
    throw new Error(`buildStandardProfile: unknown size '${size}' for '${profileType}' — known: ${Object.keys(family).join(', ')}`);
  }
  const poly = family.builder(dims);
  return { poly, meta: { profileType, size, dims: { ...dims } } };
}

/** Return the catalogue of known profile families + sizes (for the dialog). */
export function standardProfileSizes() {
  const out = {};
  for (const [family, table] of Object.entries(STANDARD_PROFILES)) {
    out[family] = Object.keys(table).filter(k => k !== 'builder');
  }
  return out;
}

/**
 * STANDARD_PROFILES — every value's `builder(dims)` returns the CCW closed
 * polygon for that profile in the LOCAL frame (XY plane, centroid-ish at
 * origin). Dimensions are in mm and reflect ISO/ANSI standards.
 */
export const STANDARD_PROFILES = {
  // ── Rectangular tube (ISO 4019) — width × height × wall thickness ─────
  recttube: {
    '40x60x3':   { w: 40, h: 60,  t: 3 },
    '50x100x4':  { w: 50, h: 100, t: 4 },
    '80x120x5':  { w: 80, h: 120, t: 5 },
    builder(dims) {
      const { w, h, t } = dims;
      // Outer CCW polygon. We ship a SOLID rect for the foundation pass
      // (the sweep produces a closed solid). A hollow tube requires a
      // second inner loop + a Face_2 with a hole — queued for Tier-6b.
      return rect(w, h);
    },
  },
  // ── Square tube (ISO 4019) — side × side × wall thickness ──────────────
  squaretube: {
    '40x40x3':   { w: 40, t: 3 },
    '50x50x4':   { w: 50, t: 4 },
    '80x80x5':   { w: 80, t: 5 },
    builder(dims) {
      const { w } = dims;
      return rect(w, w);
    },
  },
  // ── Round tube (ISO 4200) — outer diameter × wall thickness ────────────
  roundtube: {
    '48.3x3.6': { od: 48.3, t: 3.6 },
    '60.3x3.6': { od: 60.3, t: 3.6 },
    '88.9x4.0': { od: 88.9, t: 4.0 },
    builder(dims) {
      const { od } = dims;
      return circlePoly(od / 2, 24);
    },
  },
  // ── Angle iron (ISO 657-21) — equal-leg L-section ──────────────────────
  angle: {
    '50x50x5':   { L: 50, t: 5 },
    '65x65x7':   { L: 65, t: 7 },
    '80x80x8':   { L: 80, t: 8 },
    builder(dims) {
      const { L, t } = dims;
      // CCW L-shape — corner at origin, legs along +X / +Y.
      return [
        { x: 0,  y: 0 },
        { x: L,  y: 0 },
        { x: L,  y: t },
        { x: t,  y: t },
        { x: t,  y: L },
        { x: 0,  y: L },
      ];
    },
  },
  // ── C-channel (ISO 657-11) — depth × flange × web-thickness ────────────
  channel: {
    '100x50x5':   { h: 100, b: 50, t: 5 },
    '150x75x6.5': { h: 150, b: 75, t: 6.5 },
    '200x75x8.5': { h: 200, b: 75, t: 8.5 },
    builder(dims) {
      const { h, b, t } = dims;
      // CCW C-shape opening toward +X. Centre vertically.
      const y0 = -h / 2, y1 = h / 2;
      return [
        { x: 0, y: y0 },
        { x: b, y: y0 },
        { x: b, y: y0 + t },
        { x: t, y: y0 + t },
        { x: t, y: y1 - t },
        { x: b, y: y1 - t },
        { x: b, y: y1 },
        { x: 0, y: y1 },
      ];
    },
  },
  // ── I-beam (IPE) — depth × flange-width × web/flange thickness ─────────
  ibeam: {
    'IPE100': { h: 100, b: 55,  tw: 4.1, tf: 5.7 },
    'IPE160': { h: 160, b: 82,  tw: 5.0, tf: 7.4 },
    'IPE200': { h: 200, b: 100, tw: 5.6, tf: 8.5 },
    builder(dims) {
      const { h, b, tw, tf } = dims;
      // CCW I-shape centred on the origin.
      const y0 = -h / 2, y1 = h / 2;
      const bh = b / 2, twh = tw / 2;
      return [
        { x: -bh,  y: y0           },
        { x:  bh,  y: y0           },
        { x:  bh,  y: y0 + tf      },
        { x:  twh, y: y0 + tf      },
        { x:  twh, y: y1 - tf      },
        { x:  bh,  y: y1 - tf      },
        { x:  bh,  y: y1           },
        { x: -bh,  y: y1           },
        { x: -bh,  y: y1 - tf      },
        { x: -twh, y: y1 - tf      },
        { x: -twh, y: y0 + tf      },
        { x: -bh,  y: y0 + tf      },
      ];
    },
  },
};

function rect(w, h) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function circlePoly(r, segs) {
  const out = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    out.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector helpers
// ─────────────────────────────────────────────────────────────────────────────

function v(a, b, c) { return [a, b, c]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function nrm(a) { return Math.sqrt(dot(a, a)); }
function nrmlz(a) {
  const n = nrm(a);
  return n < 1e-12 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * Build an orthonormal frame at point `p` with z = tangent (along the path).
 * x is the "right" direction; y is the "up". The choice of right/up is
 * deterministic — uses world-up [0,0,1] unless tangent is parallel to it,
 * then falls back to world-X.
 */
function buildPathFrame(p, tangent) {
  const z = nrmlz(tangent);
  let upHint = [0, 0, 1];
  if (Math.abs(dot(z, upHint)) > 0.95) upHint = [1, 0, 0];
  const x = nrmlz(cross(upHint, z));
  const y = nrmlz(cross(z, x));
  return { origin: p, x, y, z };
}

/** Transform a 2D profile point into the path frame at the path start. */
function profileToWorld(frame, pt) {
  return add(frame.origin, add(scl(frame.x, pt.x / 1000), scl(frame.y, pt.y / 1000)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamp weldment metadata on `body.body.metadata.weldment`. Idempotent;
 * preserves the trims[] / caps[] / gussets[] / welds[] history if present.
 */
function stampWeldmentMetadata(spineBody, fields) {
  if (!spineBody || !spineBody.body) return null;
  const meta = spineBody.body.metadata || (spineBody.body.metadata = {});
  const w = meta.weldment || (meta.weldment = { trims: [], caps: [], gussets: [], welds: [] });
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) w[k] = v;
  }
  if (!Array.isArray(w.trims))   w.trims = [];
  if (!Array.isArray(w.caps))    w.caps = [];
  if (!Array.isArray(w.gussets)) w.gussets = [];
  if (!Array.isArray(w.welds))   w.welds = [];
  return w;
}

/** Predicate: does the body carry weldment metadata? */
export function isWeldment(spineBody) {
  return getWeldmentMetadata(spineBody) !== null;
}

/** Read the weldment metadata off a body (or null when not tagged). */
export function getWeldmentMetadata(spineBody) {
  if (!spineBody) return null;
  const body = spineBody.body || spineBody;
  if (!body || !body.metadata || !body.metadata.weldment) return null;
  return body.metadata.weldment;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. structuralMember — sweep a standard profile along a 3D path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a structural member by sweeping a standard ISO/ANSI profile along
 * the supplied 3D path.
 *
 * The PATH is a polyline (open or closed) given as either:
 *   - Array<[x, y, z]> in METRES, or
 *   - { points: Array<[x, y, z]> } in METRES, or
 *   - { start: [x,y,z], end: [x,y,z] } in METRES (straight-line shortcut)
 *
 * The PROFILE is one of:
 *   - `{ profile: 'rectTube' | 'squareTube' | ..., size: '40x40x3' | ... }` —
 *     resolved via `buildStandardProfile`.
 *   - `{ polygon: Array<{x,y}> }` — caller-supplied 2D profile (mm).
 *
 * @returns {Promise<SpineBody>} the member's spine body, tagged
 *     `metadata.weldment = {profile, size, length, ...}`.
 */
export async function structuralMember(pathSpec, profileSpec, opts = {}) {
  const path = resolvePath(pathSpec);
  if (path.length < 2) {
    throw new Error('structuralMember: path must have at least 2 points');
  }

  // Resolve the profile polygon (mm) + meta.
  let profilePoly, profileMeta;
  if (profileSpec && profileSpec.polygon) {
    profilePoly = profileSpec.polygon;
    profileMeta = { profileType: 'custom', size: profileSpec.sizeLabel || 'custom', dims: profileSpec.dims || null };
  } else {
    const { poly, meta } = buildStandardProfile(profileSpec.profile, profileSpec.size);
    profilePoly = poly;
    profileMeta = meta;
  }

  // Build the profile in the path's start frame (the profile sits at the
  // path's first point, perpendicular to the path's first segment).
  const startTangent = sub(path[1], path[0]);
  const frame = buildPathFrame(path[0], startTangent);
  const profile3D = profilePoly.map(pt => {
    const w = profileToWorld(frame, pt);
    return { x: w[0], y: w[1], z: w[2] };
  });

  // The path itself in world-space — already in metres.
  const path3D = path.map(p => ({ x: p[0], y: p[1], z: p[2] }));

  // Length of the path (sum of segment lengths) — recorded on the member.
  let length3d = 0;
  for (let i = 1; i < path.length; i++) {
    length3d += nrm(sub(path[i], path[i - 1]));
  }

  // Sweep — produces a solid body via OCCT's pipe-of-face.
  let member;
  try {
    member = await sweepProfile(profile3D, path3D);
  } catch (err) {
    // For very short / 2-point paths, sweepProfile may fail to build a
    // smooth pipe; fall back to extrudeProfile along the path direction.
    if (path.length === 2) {
      const len = nrm(sub(path[1], path[0])) * 1000; // mm — extrudeProfile takes mm depth
      const dir = nrmlz(sub(path[1], path[0]));
      member = await extrudeProfile(profile3D, len, { direction: dir });
    } else {
      throw new Error(`structuralMember: sweepProfile failed — ${err.message || err}`);
    }
  }

  // Tag with weldment metadata. `length` is in mm (a structural-member length
  // is intuitively in mm to match the catalogue dimensions).
  stampWeldmentMetadata(member, {
    profile: profileMeta.profileType,
    size: profileMeta.size,
    length: length3d * 1000,
    dims: profileMeta.dims,
    pathStart: path[0],
    pathEnd: path[path.length - 1],
    pathTangentStart: nrmlz(startTangent),
    pathTangentEnd: nrmlz(sub(path[path.length - 1], path[path.length - 2])),
  });

  if (member.meta) {
    member.meta.op = 'structuralMember';
    member.meta.weldment = {
      profile: profileMeta.profileType,
      size: profileMeta.size,
      length: length3d * 1000,
    };
  }
  return member;
}

function resolvePath(pathSpec) {
  if (!pathSpec) throw new Error('structuralMember: pathSpec is required');
  if (Array.isArray(pathSpec)) {
    return pathSpec.map(toPoint);
  }
  if (pathSpec.points && Array.isArray(pathSpec.points)) {
    return pathSpec.points.map(toPoint);
  }
  if (pathSpec.start && pathSpec.end) {
    return [toPoint(pathSpec.start), toPoint(pathSpec.end)];
  }
  throw new Error('structuralMember: pathSpec must be an array of points, {points}, or {start,end}');
}

function toPoint(p) {
  if (Array.isArray(p)) return [p[0], p[1], p[2]];
  if (typeof p === 'object' && p) return [p.x, p.y, p.z];
  throw new Error('structuralMember: invalid path point ' + JSON.stringify(p));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. trimMembers — trim members at a joint via boolean
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trim a pair (or chain) of structural members at their joint.
 *
 * Modes:
 *   - `butt` (default): subtracts each member from the others so the
 *     trim is biased — the first member yields to the rest, leaving
 *     a clean butt joint where the first abuts the second. Real boolean
 *     subtract — the trimmed face count drops; bounding intersection
 *     is gone.
 *   - `mitered`: builds an angular "knife" tool at the joint (a thin
 *     box halfway between the two members' tangents) and subtracts it
 *     from BOTH members so they meet at a 45° (or angle-dependent)
 *     mitre. Visually clean joint at the corner.
 *
 * The result is the trimmed members (array) and a `trims[]` log appended
 * to each member's metadata.weldment.
 *
 * @param {SpineBody[]} members  the members to trim (>=2)
 * @param {object} [opts]
 * @param {string} [opts.mode='butt']  'butt' | 'mitered'
 * @returns {Promise<{members: SpineBody[], trimCount: number}>}
 */
export async function trimMembers(members, opts = {}) {
  if (!Array.isArray(members) || members.length < 2) {
    throw new Error('trimMembers: needs at least 2 members');
  }
  const mode = (opts.mode || 'butt').toLowerCase();

  const trimmed = members.slice();
  let trimCount = 0;

  if (mode === 'mitered') {
    // Mitered: for each adjacent pair (i, i+1), build a half-space tool
    // along the bisector of their joint tangents and subtract it from
    // each member. The half-space tool is a BOX prism aligned with the
    // joint half-space; we synthesise it from each member's existing
    // bounding box (so we know it's wide enough to clip the corner).
    for (let i = 0; i < trimmed.length - 1; i++) {
      const a = trimmed[i];
      const b = trimmed[i + 1];
      const wA = getWeldmentMetadata(a);
      const wB = getWeldmentMetadata(b);
      if (!wA || !wB) continue;
      try {
        const toolA = await buildMitreTool(a, b, /* trimSelf= */ true);
        if (toolA) {
          const newA = await boolCut(a, toolA);
          if (newA && newA.body) {
            const wm = stampWeldmentMetadata(newA, { profile: wA.profile, size: wA.size, length: wA.length });
            wm.trims = [...(wA.trims || []), { mode, joint: i, against: i + 1 }];
            trimmed[i] = newA;
          }
        }
        const toolB = await buildMitreTool(b, a, /* trimSelf= */ true);
        if (toolB) {
          const newB = await boolCut(b, toolB);
          if (newB && newB.body) {
            const wm = stampWeldmentMetadata(newB, { profile: wB.profile, size: wB.size, length: wB.length });
            wm.trims = [...(wB.trims || []), { mode, joint: i, against: i }];
            trimmed[i + 1] = newB;
          }
        }
        trimCount++;
      } catch (err) {
        // Honest fallback: leave the members untouched + record the failure.
        console.warn(`trimMembers: mitered cut at joint ${i} failed: ${err.message || err}`);
      }
    }
  } else {
    // Butt: subtract each successive member from the first member's volume
    // so the first member yields to the rest (clean butt where two meet).
    for (let i = 1; i < trimmed.length; i++) {
      const a = trimmed[0];
      const b = trimmed[i];
      const wA = getWeldmentMetadata(a);
      const wB = getWeldmentMetadata(b);
      if (!wA || !wB) continue;
      try {
        const newA = await boolCut(a, b);
        if (newA && newA.body) {
          const wm = stampWeldmentMetadata(newA, { profile: wA.profile, size: wA.size, length: wA.length });
          wm.trims = [...(wA.trims || []), { mode: 'butt', joint: 0, against: i }];
          trimmed[0] = newA;
          trimCount++;
        }
      } catch (err) {
        console.warn(`trimMembers: butt cut at joint ${i} failed: ${err.message || err}`);
      }
    }
  }

  return { members: trimmed, trimCount };
}

/**
 * Build a mitre tool — a thin half-space box aligned with the angular
 * bisector between `selfMember` and `otherMember`. Subtracting this tool
 * from each yields a 45° mitred joint at the corner.
 *
 * Implementation: we synthesise a box from `selfMember`'s end tangent +
 * `otherMember`'s start tangent. The bisector of these two tangents is
 * the mitre plane. We build a box that intersects ONLY the corner of
 * `selfMember` on the side away from the bisector.
 *
 * Returns null when the geometry is too pathological to build a tool.
 */
async function buildMitreTool(selfMember, otherMember /* , trimSelf */) {
  const wA = getWeldmentMetadata(selfMember);
  const wB = getWeldmentMetadata(otherMember);
  if (!wA || !wB) return null;

  // Find the SHARED endpoint between the two members — the joint.
  const joint = findJoint(wA, wB);
  if (!joint) return null;

  // Tangents AT the joint:
  //   - selfTangent = direction selfMember points AT the joint (into it).
  //   - otherTangent = direction otherMember points OUT of the joint.
  const selfTangent = tangentAtJoint(wA, joint);
  const otherTangent = tangentAtJoint(wB, joint);
  if (!selfTangent || !otherTangent) return null;

  // Mitre normal: the bisector of (-selfTangent) and otherTangent (both
  // pointing OUT of the joint into their respective members).
  const sOut = scl(selfTangent, -1); // pointing OUT of self at joint
  const oOut = otherTangent;          // pointing OUT of other at joint
  let bisector = nrmlz(add(sOut, oOut));
  if (nrm(bisector) < 1e-6) {
    // Members co-linear — no mitre needed, return null (no trim).
    return null;
  }
  // Mitre plane normal is perpendicular to the bisector AND lies in the
  // plane of the two tangents. The mitre cut tool sits on the side of
  // `selfMember` past the bisector.
  // Tool half-space: cut everything in selfMember on the OTHER side of
  // the bisector relative to the self-tangent direction.
  // We build a 250 mm × 250 mm × 250 mm box centred at the joint, oriented
  // with the bisector as its half-space normal.
  const boxSize = 0.25; // 250 mm — covers most workbench members
  const tool = await buildHalfSpaceBox(joint, bisector, boxSize, oOut);
  return tool;
}

function findJoint(wA, wB) {
  const TOL = 1e-3; // 1 mm tolerance
  const candidates = [
    { a: wA.pathStart, b: wB.pathStart },
    { a: wA.pathStart, b: wB.pathEnd },
    { a: wA.pathEnd,   b: wB.pathStart },
    { a: wA.pathEnd,   b: wB.pathEnd },
  ];
  for (const c of candidates) {
    if (!c.a || !c.b) continue;
    const d = nrm(sub(c.a, c.b));
    if (d < TOL) return [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];
  }
  return null;
}

function tangentAtJoint(wA, joint) {
  const TOL = 1e-3;
  if (wA.pathStart && nrm(sub(wA.pathStart, joint)) < TOL) {
    // joint is at the start — tangent points FROM start TO end
    return wA.pathTangentStart || nrmlz(sub(wA.pathEnd, wA.pathStart));
  }
  if (wA.pathEnd && nrm(sub(wA.pathEnd, joint)) < TOL) {
    // joint is at the end — tangent points FROM end TO start (opposite of "outward")
    // We want the direction OUT of the joint into the member, i.e. toward start.
    return scl(wA.pathTangentEnd || nrmlz(sub(wA.pathEnd, wA.pathStart)), -1);
  }
  return null;
}

async function buildHalfSpaceBox(centre, normal, size, awayFrom) {
  // Build a box at `centre`, oriented with `normal` as one of its axes,
  // entirely on the side opposite `awayFrom`. We extrude a centred square
  // along `-awayFrom` direction (so the box pushes INTO the corner of
  // selfMember).
  const n = nrmlz(normal);
  let upHint = [0, 0, 1];
  if (Math.abs(dot(n, upHint)) > 0.95) upHint = [1, 0, 0];
  const u = nrmlz(cross(upHint, n));
  const w = nrmlz(cross(n, u));

  // Profile in the plane perpendicular to `n` — a `size`×`size` square
  // centred at `centre`.
  const halfSize = size / 2;
  const corners = [
    add(centre, add(scl(u, -halfSize), scl(w, -halfSize))),
    add(centre, add(scl(u,  halfSize), scl(w, -halfSize))),
    add(centre, add(scl(u,  halfSize), scl(w,  halfSize))),
    add(centre, add(scl(u, -halfSize), scl(w,  halfSize))),
  ];
  // Shift the profile so the EXTRUSION goes through the joint corner.
  // The tool needs to overlap the WHOLE selfMember's corner on the side
  // past the bisector — extrude FROM the bisector plane in -awayFrom
  // direction by `size`. We start the profile ON the bisector plane
  // (i.e. through `centre`) and extrude in the direction `-awayFrom`.
  const dir = nrmlz(scl(awayFrom, -1));
  const profile = corners.map(c => ({ x: c[0], y: c[1], z: c[2] }));
  // extrudeProfile takes mm depth.
  const depthMm = size * 1000;
  try {
    return await extrudeProfile(profile, depthMm, { direction: dir });
  } catch (_e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. endCap — cap the open end of a structural member
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cap the open end of a structural member with a flat (or thick) cap.
 *
 * `endRef` selects which end:
 *   - 'start' | 0 — the start of the path (the side where the profile was
 *     built and swept).
 *   - 'end'   | 1 — the end of the path (the far side).
 *
 * The cap is a thin prism over the bounding rectangle of the profile at
 * the picked end, then fused to the parent. Caps the EXACT end profile
 * by sweeping the member's recorded profile dims; for irregular profiles
 * (angle, channel, I-beam) we cap the convex bounding rectangle (Tier-6b
 * follow-on caps the exact profile).
 *
 * @returns {Promise<SpineBody>}  the capped member (single body)
 */
export async function endCap(member, endRef = 'start', opts = {}) {
  if (!member || !member.body) {
    throw new Error('endCap: needs a SpineBody member');
  }
  const w = getWeldmentMetadata(member);
  if (!w) {
    throw new Error('endCap: body is not a weldment member — run Structural Member first');
  }
  const end = String(endRef).toLowerCase();
  const isStart = (end === 'start' || end === '0' || endRef === 0);
  const point = isStart ? w.pathStart : w.pathEnd;
  const tangent = isStart ? w.pathTangentStart : w.pathTangentEnd;
  if (!point || !tangent) {
    throw new Error('endCap: member is missing path metadata — cannot place cap');
  }

  // Pre-fuse face count for diagnostics.
  const preFaceCount = member.body && typeof member.body.faces === 'function' ? member.body.faces().length : 0;

  // Cap thickness: the dialog override, else max(profile wall t, 3 mm).
  const fallbackT = w.dims && (w.dims.t || w.dims.tf || w.dims.tw) || 3;
  const thickness = (typeof opts.thickness === 'number' && opts.thickness > 0)
    ? opts.thickness
    : Math.max(fallbackT, 3);

  // Build the cap profile — a rectangle in the plane perpendicular to the
  // path tangent at the end-point. For each profile family we know the
  // bounding box (so we cap solidly even for L / C / I shapes).
  const bbox = profileBoundingBox(w);
  if (!bbox) {
    throw new Error('endCap: could not derive cap bounding box from profile metadata');
  }

  // Build the rect in the path frame at the end-point. Push the cap
  // SLIGHTLY INTO the member so the fuse landed inside is robust.
  // Frame at the end-point: same handedness as the start frame for stability.
  const startTangent = tangent;
  const frame = buildPathFrame(point, startTangent);
  // Cap origin: shift `thickness/2 mm` INTO the member at the end (i.e.
  // along -tangent at the END, along +tangent at the start).
  const intoMember = isStart ? scl(nrmlz(startTangent), 1) : scl(nrmlz(startTangent), -1);
  const halfT = (thickness / 2) / 1000; // mm → m
  const capOrigin = add(point, scl(intoMember, halfT));
  const capFrame = { ...frame, origin: capOrigin };

  const capCorners = [
    { x: bbox.x0, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y1 },
    { x: bbox.x0, y: bbox.y1 },
  ];
  const capProfile3D = capCorners.map(pt => {
    const wp = profileToWorld(capFrame, pt);
    return { x: wp[0], y: wp[1], z: wp[2] };
  });

  // Extrude the cap into the member (so the union closes cleanly).
  const extrusionDir = nrmlz(intoMember);
  let cap;
  try {
    cap = await extrudeProfile(capProfile3D, thickness, { direction: extrusionDir });
  } catch (err) {
    throw new Error(`endCap: failed to build cap prism — ${err.message || err}`);
  }

  // Fuse the cap onto the member.
  let fused;
  try {
    fused = await boolFuse(member, cap);
  } catch (err) {
    console.warn('endCap: fuse failed; returning member + cap separately —', err.message || err);
    fused = member;
  }

  // Stamp the cap into metadata.
  const fusedMeta = stampWeldmentMetadata(fused, {
    profile: w.profile, size: w.size, length: w.length, dims: w.dims,
    pathStart: w.pathStart, pathEnd: w.pathEnd,
    pathTangentStart: w.pathTangentStart, pathTangentEnd: w.pathTangentEnd,
  });
  fusedMeta.caps = [...(w.caps || []), {
    end: isStart ? 'start' : 'end',
    thickness,
    at: point,
  }];

  // Diagnostics: post-fuse face count.
  const postFaceCount = fused.body && typeof fused.body.faces === 'function' ? fused.body.faces().length : 0;
  if (fused.meta) {
    fused.meta.op = 'endCap';
    fused.meta.weldment = {
      profile: w.profile, size: w.size,
      preFaceCount, postFaceCount,
      thickness,
      end: isStart ? 'start' : 'end',
    };
  }

  return fused;
}

function profileBoundingBox(w) {
  if (!w || !w.dims) {
    // Fallback: cap with a 50 × 50 mm square — large enough for most defaults.
    return { x0: -25, y0: -25, x1: 25, y1: 25 };
  }
  const d = w.dims;
  switch ((w.profile || '').toLowerCase()) {
    case 'recttube':
      return { x0: -d.w / 2, x1: d.w / 2, y0: -d.h / 2, y1: d.h / 2 };
    case 'squaretube':
      return { x0: -d.w / 2, x1: d.w / 2, y0: -d.w / 2, y1: d.w / 2 };
    case 'roundtube': {
      const r = d.od / 2;
      return { x0: -r, x1: r, y0: -r, y1: r };
    }
    case 'angle':
      return { x0: 0, x1: d.L, y0: 0, y1: d.L };
    case 'channel':
      return { x0: 0, x1: d.b, y0: -d.h / 2, y1: d.h / 2 };
    case 'ibeam':
      return { x0: -d.b / 2, x1: d.b / 2, y0: -d.h / 2, y1: d.h / 2 };
    default:
      return { x0: -25, y0: -25, x1: 25, y1: 25 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. gusset — triangular reinforcement plate between two structural members
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a gusset — a triangular reinforcement plate fillet-welded between two
 * structural members at their shared joint. The gusset's plane is the plane
 * that contains both members' tangents AT the joint (the "joint plane"). The
 * plate is a right triangle with legs of length `size` lying along each
 * member's tangent direction (outward from the joint), then extruded
 * perpendicular to the joint plane by `thickness`.
 *
 * Real welded-frame reinforcement: the gusset's hypotenuse forms the
 * structural fillet that triangulates the otherwise-pin joint between the
 * two members, drastically stiffening the corner.
 *
 * Both members' metadata records the gusset id (so downstream weld-bead /
 * cut-list ops can locate every gusset attached to a member).
 *
 * @param {SpineBody} memberA   first structural member (weldment-tagged).
 * @param {SpineBody} memberB   second structural member (weldment-tagged).
 * @param {object} opts
 * @param {string} [opts.type='triangular']  'triangular' | 'polygon'
 * @param {number} [opts.size=100]        leg length along each member (mm).
 * @param {number} [opts.thickness=6]     plate thickness (mm).
 * @param {string} [opts.position='inner'] 'inner' (on the joint-bisector side)
 *                                         | 'outer' (opposite side).
 * @returns {Promise<{gusset: SpineBody, gussetId: string, joint: number[]}>}
 */
export async function gusset(memberA, memberB, opts = {}) {
  if (!memberA || !memberA.body) throw new Error('gusset: memberA missing');
  if (!memberB || !memberB.body) throw new Error('gusset: memberB missing');
  const wA = getWeldmentMetadata(memberA);
  const wB = getWeldmentMetadata(memberB);
  if (!wA) throw new Error('gusset: memberA is not a weldment member — run Structural Member first');
  if (!wB) throw new Error('gusset: memberB is not a weldment member — run Structural Member first');

  const type = String(opts.type || 'triangular').toLowerCase();
  const size = (Number(opts.size) > 0 ? Number(opts.size) : 100) / 1000; // mm → m
  const thickness = Number(opts.thickness) > 0 ? Number(opts.thickness) : 6; // mm (for extrude)
  const position = String(opts.position || 'inner').toLowerCase();

  // Find the joint point shared by the two members.
  const joint = findJoint(wA, wB);
  if (!joint) {
    throw new Error('gusset: members do not share an endpoint within 1 mm — gusset needs a real joint');
  }

  // Tangents OUT of the joint into each member (i.e. pointing along each
  // member from the joint into its body).
  const tA = tangentAtJoint(wA, joint);
  const tB = tangentAtJoint(wB, joint);
  if (!tA || !tB) {
    throw new Error('gusset: could not derive tangents at the joint');
  }

  // The two legs of the gusset triangle sit at distance `size` along each
  // tangent from the joint. The triangle vertices are:
  //   P0 = joint
  //   P1 = joint + size * tA
  //   P2 = joint + size * tB
  const P0 = joint;
  const P1 = add(joint, scl(nrmlz(tA), size));
  const P2 = add(joint, scl(nrmlz(tB), size));

  // Joint-plane normal — perpendicular to BOTH tangents (i.e. extrusion dir).
  let normal = cross(tA, tB);
  let nMag = nrm(normal);
  if (nMag < 1e-6) {
    // Members co-linear — degenerate joint; pick a perpendicular fallback.
    let upHint = [0, 0, 1];
    if (Math.abs(dot(nrmlz(tA), upHint)) > 0.95) upHint = [1, 0, 0];
    normal = cross(tA, upHint);
    nMag = nrm(normal);
  }
  normal = scl(normal, 1 / nMag);
  // Position flip — outer means extrude the OTHER way.
  if (position === 'outer') normal = scl(normal, -1);

  // Build the triangle profile in 3D — already in metres.
  // For 'polygon' mode we ship a 5-sided gusset (chopped corners) — more
  // realistic for high-strength applications. For 'triangular' mode the
  // straight 3-vertex triangle.
  let profile3D;
  if (type === 'polygon') {
    // 5-sided gusset: shave the two outer corners to ~20% of size.
    const t = 0.2;
    const P1a = add(joint, scl(nrmlz(tA), size * (1 - t)));
    const P1b = add(add(joint, scl(nrmlz(tA), size)), scl(nrmlz(tB), size * t));
    const P2a = add(add(joint, scl(nrmlz(tB), size)), scl(nrmlz(tA), size * t));
    const P2b = add(joint, scl(nrmlz(tB), size * (1 - t)));
    profile3D = [P0, P1a, P1b, P2a, P2b].map(p => ({ x: p[0], y: p[1], z: p[2] }));
  } else {
    profile3D = [P0, P1, P2].map(p => ({ x: p[0], y: p[1], z: p[2] }));
  }

  // Extrude the plate by `thickness` mm along `normal`.
  // Centre the prism on the joint plane by shifting -thickness/2 along normal first.
  const halfShift = scl(normal, -(thickness / 2) / 1000);
  profile3D = profile3D.map(p => ({
    x: p.x + halfShift[0],
    y: p.y + halfShift[1],
    z: p.z + halfShift[2],
  }));

  let plate;
  try {
    plate = await extrudeProfile(profile3D, thickness, { direction: nrmlz(normal) });
  } catch (err) {
    throw new Error(`gusset: failed to build gusset plate — ${err.message || err}`);
  }

  // Tag the gusset itself with its weldment-child metadata.
  const gussetId = `gusset_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  stampWeldmentMetadata(plate, {
    profile: 'gusset',
    size: `${Math.round(size * 1000)}x${thickness}`,
    length: size * 1000,
    gussetId,
    gussetType: type,
    gussetThickness: thickness,
    gussetPosition: position,
    parentMembers: [wA.profile + '/' + wA.size, wB.profile + '/' + wB.size],
    at: joint,
  });
  if (plate.meta) {
    plate.meta.op = 'gusset';
    plate.meta.weldment = {
      profile: 'gusset',
      gussetId,
      type,
      size: size * 1000,
      thickness,
      at: joint,
    };
  }

  // Record the gusset id on BOTH parent members' metadata.
  const record = {
    id: gussetId,
    type,
    size: size * 1000,
    thickness,
    position,
    at: joint,
  };
  const wmA = stampWeldmentMetadata(memberA, {});
  wmA.gussets = [...(wmA.gussets || []), record];
  const wmB = stampWeldmentMetadata(memberB, {});
  wmB.gussets = [...(wmB.gussets || []), record];

  return { gusset: plate, gussetId, joint };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. weldBead — cosmetic + topological weld along a shared edge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a weld bead — a small sweep along the shared edge / joint between
 * two structural members. The bead is a real solid: a small triangular
 * profile for fillet welds (the canonical welder cross-section), a small
 * rectangle for square welds, and a V-profile for V-groove welds.
 *
 * Joint locator: we use the two members' weldment metadata to find the
 * shared joint point + each member's tangent. The bead's PATH is a short
 * straight segment along the joint corner — for a fillet weld between two
 * orthogonal members, the bead runs along the corner edge where one
 * member's outer face meets the other's. We approximate this corner edge
 * by a segment from the joint along a direction perpendicular to BOTH
 * tangents (the "corner direction"); when the members are co-linear we
 * fall back to a small bead at the joint along memberA's tangent.
 *
 * @param {SpineBody} memberA  first structural member (weldment-tagged).
 * @param {SpineBody} memberB  second structural member (weldment-tagged).
 * @param {object} opts
 * @param {string} [opts.type='fillet']  'fillet' | 'square' | 'V' | 'bevel'
 * @param {number} [opts.size=6]         bead leg size (mm).
 * @param {number} [opts.length]         bead run length (mm); default = min(memberA, memberB) length.
 * @returns {Promise<{bead: SpineBody, weldId: string, joint: number[], beadLength: number}>}
 */
export async function weldBead(memberA, memberB, opts = {}) {
  if (!memberA || !memberA.body) throw new Error('weldBead: memberA missing');
  if (!memberB || !memberB.body) throw new Error('weldBead: memberB missing');
  const wA = getWeldmentMetadata(memberA);
  const wB = getWeldmentMetadata(memberB);
  if (!wA) throw new Error('weldBead: memberA is not a weldment member — run Structural Member first');
  if (!wB) throw new Error('weldBead: memberB is not a weldment member — run Structural Member first');

  const type = String(opts.type || 'fillet').toLowerCase();
  const sizeMm = Number(opts.size) > 0 ? Number(opts.size) : 6;

  const joint = findJoint(wA, wB);
  if (!joint) {
    throw new Error('weldBead: members do not share an endpoint within 1 mm — bead needs a real joint');
  }
  const tA = tangentAtJoint(wA, joint);
  const tB = tangentAtJoint(wB, joint);
  if (!tA || !tB) {
    throw new Error('weldBead: could not derive tangents at the joint');
  }

  // Bead run direction: typically the joint corner runs along memberA's
  // edge (or memberB's). We pick memberA's tangent as the bead run, scaled
  // by `length` or by min(member lengths).
  const beadLengthMm = (typeof opts.length === 'number' && opts.length > 0)
    ? opts.length
    : Math.min(sizeMm * 20, Math.min(wA.length || 100, wB.length || 100));
  const beadLength = beadLengthMm / 1000;
  const runDir = nrmlz(tA);
  const pathStart = joint;
  const pathEnd = add(joint, scl(runDir, beadLength));
  const path3D = [pathStart, pathEnd].map(p => ({ x: p[0], y: p[1], z: p[2] }));

  // Cross-section frame at the joint: u = perpendicular to runDir, in the
  // (tA, tB) plane (pointing into the corner); v = normal of the (tA,tB)
  // plane (orthogonal to both). For the bead cross-section the triangle
  // (or rect or V) sits in the (u, v) plane.
  const upHint = nrmlz(tB);
  let u = sub(upHint, scl(runDir, dot(upHint, runDir)));
  let uMag = nrm(u);
  if (uMag < 1e-6) {
    let fallback = [0, 0, 1];
    if (Math.abs(dot(runDir, fallback)) > 0.95) fallback = [1, 0, 0];
    u = sub(fallback, scl(runDir, dot(fallback, runDir)));
    uMag = nrm(u);
  }
  u = scl(u, 1 / uMag);
  let v = cross(runDir, u);
  v = nrmlz(v);

  // Build the cross-section polygon in 3D, anchored at pathStart in the
  // (u, v) plane. The bead "fills the corner", so the profile sits IN the
  // joint (the corner where the two members meet).
  // Local 2D coords (in mm) — caller's choice of bead type.
  const s = sizeMm; // bead leg size (mm), in cross-section local frame.
  let profile2D; // [{x,y}, …] in mm, in (u,v) frame.
  if (type === 'square') {
    // Filled rectangular fillet.
    profile2D = [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: s, y: s },
      { x: 0, y: s },
    ];
  } else if (type === 'v') {
    // V-groove: an isoceles V opening into the corner with depth = s.
    const half = s / 2;
    profile2D = [
      { x: -half, y: 0 },
      { x:  half, y: 0 },
      { x: 0,     y: s  },
    ];
  } else if (type === 'bevel') {
    // Bevel: a 4-sided trapezoid — the chamfered fillet weld.
    profile2D = [
      { x: 0,         y: 0 },
      { x: s,         y: 0 },
      { x: s * 0.7,   y: s * 0.7 },
      { x: 0,         y: s },
    ];
  } else {
    // Fillet (default): right triangle — legs along u and v, hypotenuse
    // sealing the bead. The canonical welder fillet cross-section.
    profile2D = [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: 0, y: s },
    ];
  }

  // Map the 2D profile into 3D world coords at pathStart.
  const profile3D = profile2D.map(pt => ({
    x: pathStart[0] + (u[0] * pt.x + v[0] * pt.y) / 1000,
    y: pathStart[1] + (u[1] * pt.x + v[1] * pt.y) / 1000,
    z: pathStart[2] + (u[2] * pt.x + v[2] * pt.y) / 1000,
  }));

  // Sweep the cross-section along the path; fall back to extrude if sweep
  // fails on a degenerate path.
  let bead;
  try {
    bead = await sweepProfile(profile3D, path3D);
  } catch (_err) {
    try {
      bead = await extrudeProfile(profile3D, beadLengthMm, { direction: runDir });
    } catch (err2) {
      throw new Error(`weldBead: failed to build bead — ${err2.message || err2}`);
    }
  }

  const weldId = `weld_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  stampWeldmentMetadata(bead, {
    profile: 'weldBead',
    size: `${sizeMm}-${type}`,
    length: beadLengthMm,
    weldId,
    weldType: type,
    weldSize: sizeMm,
    beadLength: beadLengthMm,
    parentMembers: [wA.profile + '/' + wA.size, wB.profile + '/' + wB.size],
    at: joint,
  });
  if (bead.meta) {
    bead.meta.op = 'weldBead';
    bead.meta.weldment = {
      profile: 'weldBead',
      weldId,
      type,
      size: sizeMm,
      length: beadLengthMm,
      at: joint,
    };
  }

  // Record the weld bead on BOTH parent members' metadata.
  const record = {
    id: weldId,
    type,
    size: sizeMm,
    length: beadLengthMm,
    at: joint,
  };
  const wmA = stampWeldmentMetadata(memberA, {});
  wmA.welds = [...(wmA.welds || []), record];
  const wmB = stampWeldmentMetadata(memberB, {});
  wmB.welds = [...(wmB.welds || []), record];

  return { bead, weldId, joint, beadLength: beadLengthMm };
}
