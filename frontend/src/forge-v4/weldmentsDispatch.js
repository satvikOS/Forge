// Forge-128 — Weldments dispatch (real-kernel-aware wrapper).
//
// Wraps every entry point on `window.forge.weldments.*` that the
// WeldmentsWorkbench drives. Each call falls back to a synthetic
// result so the workbench can run in the dev shell (no native
// addon) without ever throwing. Synthetic results are intentionally
// "shaped right": same field names the kernel returns, same units,
// so the panel renders identically whether the kernel is wired or
// not.
//
// Trim modes: 'butt' | 'miter' | 'coped'.
// Gusset:    additional `angleDeg` for non-90° joints.
// EndCap:    additional `chamfer` (degrees, mm-on-edge) for bevelled
//            end-caps. The native kernel returns a separate handle
//            for the cap solid so it can be coloured / counted in
//            the cut list.
// WeldBead:  beads are *real solid geometry* (the kernel tessellates
//            a swept fillet / V-groove / bevel and returns a body
//            handle). The synthetic path mirrors that shape so the
//            viewport mounts a real mesh, not a polyline.

import {
  STRUCTURAL_PROFILES, DEFAULT_PROFILE, getProfile, memberWeight,
} from './structuralProfileLibrary.js';

/* --------------------------------------------------------------- */
/*  kernel access                                                  */
/* --------------------------------------------------------------- */

function kernelWeldments() {
  if (typeof window === 'undefined') return null;
  const w = window?.forge?.weldments;
  if (!w) return null;
  // Require at least makePathEdge + structuralMember — without those
  // there is no real kernel to drive.
  if (typeof w.makePathEdge !== 'function') return null;
  if (typeof w.structuralMember !== 'function') return null;
  return w;
}

export function kernelReady() {
  return kernelWeldments() !== null;
}

/* --------------------------------------------------------------- */
/*  handle bookkeeping                                             */
/* --------------------------------------------------------------- */
//
// Synthetic handles are simple monotonic integers. The kernel uses
// integer handles too, but we keep a dedicated counter so the
// fallback never collides with a real kernel handle.

let _synthHandle = 1_000_000;
function nextHandle() { return _synthHandle++; }

// Records keyed by handle. The fallback cutList walks this map.
const _memberRecords = new Map();        // handle -> { ...record }
const _beadRecords   = new Map();        // handle -> { kind, edges, size }
const _gussetRecords = new Map();        // handle -> { size, thk, angleDeg, parent }
const _capRecords    = new Map();        // handle -> { thk, chamfer, parent }
const _trimRecords   = new Map();        // handle -> { mode, parent, target }

/** Wipe synthetic state — used by tests. */
export function _resetSyntheticState() {
  _synthHandle = 1_000_000;
  _memberRecords.clear();
  _beadRecords.clear();
  _gussetRecords.clear();
  _capRecords.clear();
  _trimRecords.clear();
}

/* --------------------------------------------------------------- */
/*  geometry helpers                                               */
/* --------------------------------------------------------------- */

function vec(a, b) { return [b[0]-a[0], b[1]-a[1], b[2]-a[2]]; }
function len3(v)   { return Math.hypot(v[0], v[1], v[2]); }

function lengthOfEdge(p0, p1) { return len3(vec(p0, p1)); }

/* --------------------------------------------------------------- */
/*  makePathEdge                                                   */
/* --------------------------------------------------------------- */

/**
 * Build a path-edge handle from two world-space points. Used as
 * the seed for `structuralMember`.
 */
export function makePathEdgeSafe(p0, p1) {
  const k = kernelWeldments();
  if (k) {
    try {
      const h = k.makePathEdge(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      if (typeof h === 'number') return { handle: h, source: 'kernel', p0, p1 };
    } catch (err) {
      console.warn('[forge.v4.weldments] makePathEdge threw:', err.message);
    }
  }
  return { handle: nextHandle(), source: 'js-only', p0, p1 };
}

/* --------------------------------------------------------------- */
/*  structuralMember                                               */
/* --------------------------------------------------------------- */

/**
 * Sweep `profile` along the path seeded by `pathEdge`.
 * Returns a member descriptor: { handle, profile, length, mass,
 * source, p0, p1, alignment }.
 */
export function makeStructuralMemberSafe(pathEdge, profileName, alignment = 'centroid') {
  const profile = (typeof profileName === 'string'
                   ? getProfile(profileName)
                   : profileName) || DEFAULT_PROFILE;
  const k = kernelWeldments();
  const length = lengthOfEdge(pathEdge.p0, pathEdge.p1);
  const mass   = memberWeight(profile, length);
  if (k && pathEdge.source === 'kernel') {
    try {
      const h = k.structuralMember(pathEdge.handle, {
        kind: profile.kind, name: profile.name, dims: profile.dims,
      }, alignment);
      if (typeof h === 'number') {
        const rec = { handle: h, profile, length, mass, alignment,
                      p0: pathEdge.p0, p1: pathEdge.p1, source: 'kernel' };
        _memberRecords.set(h, rec);
        return rec;
      }
    } catch (err) {
      console.warn('[forge.v4.weldments] structuralMember threw:', err.message);
    }
  }
  const handle = nextHandle();
  const rec = { handle, profile, length, mass, alignment,
                p0: pathEdge.p0, p1: pathEdge.p1, source: 'js-only' };
  _memberRecords.set(handle, rec);
  return rec;
}

/* --------------------------------------------------------------- */
/*  trim modes — miter / coped / butt                              */
/* --------------------------------------------------------------- */

export const TRIM_MODES = Object.freeze(['butt', 'miter', 'coped']);

export function isTrimMode(m) { return TRIM_MODES.includes(m); }

/**
 * Trim member A against member B with the given mode.
 * The kernel mutates the A solid in place and returns the new
 * handle; the fallback path records the trim so the cut list can
 * report the miter angle.
 */
export function trimMemberSafe(memberA, memberB, mode = 'butt') {
  if (!isTrimMode(mode)) mode = 'butt';
  const k = kernelWeldments();
  if (k && typeof k.trimMember === 'function'
      && memberA?.source === 'kernel' && memberB?.source === 'kernel') {
    try {
      const h = k.trimMember(memberA.handle, memberB.handle, mode);
      if (typeof h === 'number') {
        // copy A's record under the new handle (kernel may issue a
        // fresh handle for the trimmed body).
        const a = _memberRecords.get(memberA.handle);
        if (a) _memberRecords.set(h, { ...a, handle: h, trim: mode });
        _trimRecords.set(h, { mode, parent: memberA.handle, target: memberB.handle });
        return { handle: h, mode, source: 'kernel' };
      }
    } catch (err) {
      console.warn('[forge.v4.weldments] trimMember threw:', err.message);
    }
  }
  // Synthetic fallback — mutate the member record so cutList reports
  // the trim. The miter angle is the angle between the two members'
  // direction vectors.
  const a = _memberRecords.get(memberA?.handle);
  const b = _memberRecords.get(memberB?.handle);
  if (a && b) {
    const da = vec(a.p0, a.p1), db = vec(b.p0, b.p1);
    const la = len3(da) || 1, lb = len3(db) || 1;
    const cos = (da[0]*db[0]+da[1]*db[1]+da[2]*db[2]) / (la*lb);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180/Math.PI;
    a.trim     = mode;
    a.miterDeg = mode === 'miter' ? ang/2 : (mode === 'coped' ? ang : 0);
  }
  const h = nextHandle();
  _trimRecords.set(h, { mode, parent: memberA?.handle, target: memberB?.handle });
  return { handle: h, mode, source: 'js-only' };
}

/* convenience aliases for the named-mode dispatch */
export function trimMiterSafe(a, b)  { return trimMemberSafe(a, b, 'miter');  }
export function trimCopedSafe(a, b)  { return trimMemberSafe(a, b, 'coped');  }
export function trimButtSafe(a, b)   { return trimMemberSafe(a, b, 'butt');   }

/* --------------------------------------------------------------- */
/*  gusset (with optional joint angle)                             */
/* --------------------------------------------------------------- */

/**
 * Add a triangular gusset plate at the vertex of two members.
 * `angleDeg` lets the caller specify a non-90° joint; the kernel
 * uses it to cut the plate so it sits flush against both members.
 */
export function makeGussetSafe(member, vertexId, gussetSize, thickness, angleDeg = 90) {
  const k = kernelWeldments();
  if (k && typeof k.gusset === 'function' && member?.source === 'kernel') {
    try {
      const h = k.gusset(member.handle, vertexId, gussetSize, thickness, angleDeg);
      if (typeof h === 'number') {
        _gussetRecords.set(h, { size: gussetSize, thk: thickness, angleDeg,
                                parent: member.handle });
        return { handle: h, size: gussetSize, thk: thickness, angleDeg, source: 'kernel' };
      }
    } catch (err) {
      console.warn('[forge.v4.weldments] gusset threw:', err.message);
    }
  }
  const handle = nextHandle();
  _gussetRecords.set(handle, { size: gussetSize, thk: thickness, angleDeg,
                               parent: member?.handle });
  return { handle, size: gussetSize, thk: thickness, angleDeg, source: 'js-only' };
}

export function gussetWithAngleSafe(member, vertexId, size, thk, angleDeg) {
  return makeGussetSafe(member, vertexId, size, thk, angleDeg);
}

/* --------------------------------------------------------------- */
/*  end cap (optionally chamfered)                                 */
/* --------------------------------------------------------------- */

export function makeEndCapSafe(member, openingEdgeId, capThickness, chamferDeg = 0, offsetMm = 0) {
  const k = kernelWeldments();
  if (k && typeof k.endCap === 'function' && member?.source === 'kernel') {
    try {
      const h = k.endCap(member.handle, openingEdgeId, capThickness, offsetMm, chamferDeg);
      if (typeof h === 'number') {
        _capRecords.set(h, { thk: capThickness, chamfer: chamferDeg, parent: member.handle });
        return { handle: h, thk: capThickness, chamfer: chamferDeg, source: 'kernel' };
      }
    } catch (err) {
      console.warn('[forge.v4.weldments] endCap threw:', err.message);
    }
  }
  const handle = nextHandle();
  _capRecords.set(handle, { thk: capThickness, chamfer: chamferDeg, parent: member?.handle });
  return { handle, thk: capThickness, chamfer: chamferDeg, source: 'js-only' };
}

export function endCapWithChamferSafe(member, edgeId, thk, chamferDeg) {
  return makeEndCapSafe(member, edgeId, thk, chamferDeg);
}

/* --------------------------------------------------------------- */
/*  weld beads — REAL solid geometry from the kernel               */
/* --------------------------------------------------------------- */
//
// The native kernel returns a body handle for each bead so it
// renders as a solid (highlighted with bead-material in the
// viewport) and gets counted in the BOM. The fallback emits a
// synthetic { kind:'bead' } spec whose dims match what the kernel
// would tessellate, so the viewport mounts the same mesh shape.

export const BEAD_KINDS = Object.freeze(['fillet', 'V-groove', 'bevel', 'square-groove']);

export function isBeadKind(k) { return BEAD_KINDS.includes(k); }

/**
 * Place a weld bead along the given edges of `parent`.
 * @param {object} parent  member descriptor returned by makeStructuralMember
 * @param {number[]} edgeIds  kernel edge ids; fallback ignores
 * @param {number} sizeMm  fillet leg length or groove width
 * @param {string} kind    fillet | V-groove | bevel | square-groove
 * @returns {{ handle, kind, size, length, spec, source }}
 */
export function makeWeldBeadSafe(parent, edgeIds, sizeMm, kind = 'fillet') {
  if (!isBeadKind(kind)) kind = 'fillet';
  const k = kernelWeldments();
  // Estimated bead length — for fallback synthesis we approximate
  // by the parent member's length; the kernel uses real edge sums.
  const parentRec = _memberRecords.get(parent?.handle);
  const lengthMm  = parentRec ? parentRec.length : 100;

  if (k && typeof k.weldBead === 'function' && parent?.source === 'kernel') {
    try {
      const h = k.weldBead(parent.handle, Array.isArray(edgeIds) ? edgeIds : [0],
                           sizeMm, kind);
      if (typeof h === 'number') {
        const spec = beadSpec(kind, sizeMm, lengthMm);
        _beadRecords.set(h, { kind, size: sizeMm, length: lengthMm,
                              edges: edgeIds, parent: parent.handle });
        return { handle: h, kind, size: sizeMm, length: lengthMm,
                 spec, source: 'kernel' };
      }
    } catch (err) {
      console.warn('[forge.v4.weldments] weldBead threw:', err.message);
    }
  }
  const handle = nextHandle();
  const spec = beadSpec(kind, sizeMm, lengthMm);
  _beadRecords.set(handle, { kind, size: sizeMm, length: lengthMm,
                             edges: edgeIds, parent: parent?.handle });
  return { handle, kind, size: sizeMm, length: lengthMm,
           spec, source: 'js-only' };
}

/* convenience named wrappers */
export function weldBeadFilletSafe(parent, edgeIds, size) {
  return makeWeldBeadSafe(parent, edgeIds, size, 'fillet');
}
export function weldBeadVGrooveSafe(parent, edgeIds, size) {
  return makeWeldBeadSafe(parent, edgeIds, size, 'V-groove');
}
export function weldBeadBevelSafe(parent, edgeIds, size) {
  return makeWeldBeadSafe(parent, edgeIds, size, 'bevel');
}
export function weldBeadSquareGrooveSafe(parent, edgeIds, size) {
  return makeWeldBeadSafe(parent, edgeIds, size, 'square-groove');
}

/**
 * Returns a viewport mesh spec (`kind`: 'beadFillet' | 'beadVGroove'
 * | 'beadBevel' | 'beadSquare') describing the bead solid. The
 * viewport's geometry factory uses these the same way it consumes
 * synthetic body specs for primitives.
 */
function beadSpec(kind, sizeMm, lengthMm) {
  switch (kind) {
    case 'V-groove':
      // Triangular V cross-section — half-angle 30° per AWS A5.
      return { kind: 'beadVGroove', size: sizeMm, length: lengthMm,
               openingDeg: 60, throat: sizeMm * 0.7 };
    case 'bevel':
      // Bevel groove — single bevel angle 45° per AWS A5.
      return { kind: 'beadBevel', size: sizeMm, length: lengthMm,
               bevelDeg: 45, throat: sizeMm * 0.7 };
    case 'square-groove':
      return { kind: 'beadSquare', size: sizeMm, length: lengthMm,
               gap: sizeMm * 0.1, throat: sizeMm };
    case 'fillet':
    default:
      // Right-isosceles triangle cross-section.
      return { kind: 'beadFillet', size: sizeMm, length: lengthMm,
               legA: sizeMm, legB: sizeMm, throat: sizeMm * Math.SQRT1_2 };
  }
}

/* --------------------------------------------------------------- */
/*  cut list                                                       */
/* --------------------------------------------------------------- */

/**
 * Read the BOM-ready cut list for one or many member root handles.
 * Returns `{ rows, source }` where rows is the kernel's natural
 * array of records (memberId, profileName, length, qty, weight,
 * trim, miterDeg, material). Falls back to the synthetic record
 * map (which carries the same field shape).
 */
export function readCutListSafe(roots) {
  const k = kernelWeldments();
  const handles = Array.isArray(roots) ? roots : [roots];
  if (k && typeof k.cutList === 'function') {
    // Only ask the kernel for handles that originated from it.
    const kernelHandles = handles
      .filter((m) => m && m.source === 'kernel')
      .map((m) => m.handle);
    if (kernelHandles.length) {
      try {
        const rows = k.cutList(kernelHandles.length === 1
                               ? kernelHandles[0] : kernelHandles);
        if (Array.isArray(rows)) return { rows, source: 'kernel' };
      } catch (err) {
        console.warn('[forge.v4.weldments] cutList threw:', err.message);
        return { rows: [], source: 'kernel-error', error: err.message };
      }
    }
  }
  // Synthetic — group by profile name + length so identical members
  // collapse into a single row with qty > 1.
  const buckets = new Map();
  for (const m of handles) {
    if (!m) continue;
    const rec = _memberRecords.get(m.handle);
    if (!rec) continue;
    const lengthMm = Math.round(rec.length * 100) / 100;
    const key = `${rec.profile.name}::${lengthMm}::${rec.trim || 'none'}`;
    const prev = buckets.get(key);
    if (prev) {
      prev.qty += 1;
      prev.weight = +(prev.weight + rec.mass).toFixed(3);
    } else {
      buckets.set(key, {
        memberId:    `M-${buckets.size + 1}`,
        profileName: rec.profile.name,
        length:      lengthMm,
        qty:         1,
        weight:      +rec.mass.toFixed(3),
        trim:        rec.trim || null,
        miterDeg:    rec.miterDeg || 0,
        material:    rec.profile.standard === 'ANSI' ? 'A36 Steel' : 'S275JR Steel',
      });
    }
  }
  return { rows: Array.from(buckets.values()), source: 'js-only' };
}

/* --------------------------------------------------------------- */
/*  CSV export of the cut list                                     */
/* --------------------------------------------------------------- */

export function cutListToCsv(rows) {
  const header = ['Member ID', 'Profile', 'Length (mm)', 'Qty',
                  'Weight (kg)', 'Trim', 'Miter (deg)', 'Material'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => [
    r.memberId, r.profileName, r.length, r.qty,
    r.weight, r.trim || '', r.miterDeg || 0, r.material || '',
  ].map(esc).join(','));
  return [header.join(','), ...body].join('\n') + '\n';
}

/* --------------------------------------------------------------- */
/*  Aggregate: top-level "dispatch" surface used by the workbench  */
/* --------------------------------------------------------------- */

export const WeldmentsDispatch = Object.freeze({
  kernelReady,
  makePathEdge:           makePathEdgeSafe,
  makeStructuralMember:   makeStructuralMemberSafe,
  trim:                   trimMemberSafe,
  trimMiter:              trimMiterSafe,
  trimCoped:              trimCopedSafe,
  trimButt:               trimButtSafe,
  gussetWithAngle:        gussetWithAngleSafe,
  endCapWithChamfer:      endCapWithChamferSafe,
  weldBeadFillet:         weldBeadFilletSafe,
  weldBeadVGroove:        weldBeadVGrooveSafe,
  weldBeadBevel:          weldBeadBevelSafe,
  weldBeadSquareGroove:   weldBeadSquareGrooveSafe,
  cutList:                readCutListSafe,
  cutListToCsv,
  TRIM_MODES,
  BEAD_KINDS,
  PROFILES: STRUCTURAL_PROFILES,
});

export default WeldmentsDispatch;
