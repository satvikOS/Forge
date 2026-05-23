/**
 * ArchDisc Topology Spine — barrel export.
 *
 * SP-1. The single import surface for the unified topology spine:
 *   Body{kind} → Lump → Shell → Face → Loop → Coedge → Edge → Vertex
 * plus the persistent-ID allocator, the OCCT→spine binder, the structural
 * validator, and the SpineBody currency.
 *
 * The pre-spine `Topo*` classes (TopoVertex/Edge/Loop/Face/Shell/Solid) and
 * the analytic-face side-car (AnalyticNurbsFace/FaceReplace) are still exported
 * from `kernel/index.js` and remain valid until S6 retires the side-car —
 * they are intentionally NOT re-exported here so the spine barrel is the
 * unambiguous "new model" surface.
 */

// ── Spine entity classes ──────────────────────────────────────────────────────
export { default as Body, BODY_KINDS } from './Body.js';
export { default as Lump } from './Lump.js';
export { default as Shell } from './Shell.js';
export { default as Face } from './Face.js';
export { default as Loop } from './Loop.js';
export { default as Coedge } from './Coedge.js';
export { default as Edge } from './Edge.js';
export { default as Vertex } from './Vertex.js';

// ── Persistent-ID allocation ──────────────────────────────────────────────────
export { default as IdAllocator, KIND_TAG } from './IdAllocator.js';

// ── Parametric edge traces ────────────────────────────────────────────────────
export { LinearPcurve, BSplinePcurve, derivePcurve } from './Pcurve.js';

// ── Structural validator (S0) + OCCT→spine binder (S1) ───────────────────────
export { default as validateSpine } from './validateSpine.js';
export { default as bindSpine, bindSpineFromShape } from './bindSpine.js';

// ── SpineBody — the SP-1 currency, BrepShape-duck-compatible (S2) ─────────────
export { default as SpineBody, isSpineBody } from './SpineBody.js';

// ── Persistent-ID carry-through across booleans (S3) ──────────────────────────
export { carryLineage } from './IdLineage.js';

// ── Spine-native analytic-face builder (S6 — G2 blend / N-sided / face-replace) ──
export { buildAnalyticSpineBody } from './AnalyticFace.js';
export { NurbsSurfaceAdapter } from './AnalyticNurbsFace.js';
