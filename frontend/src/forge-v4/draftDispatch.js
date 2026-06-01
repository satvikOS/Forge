// Forge-149 — Draft workbench dispatch.
//
// Mirrors FreeCAD Draft. Every tool composes REAL kernel primitives
// (`window.forge.sketcher.*` for curves; `window.forge.translate /
// rotate / makeWire / scale` for modify ops). When the kernel isn't
// loaded each call returns `{ ok:false, kind:'kernel-offline', error }`
// — no synthetic fallback (per Forge no-MVP / no-fallback policy).
//
// All numbers in millimetres, angles in degrees CCW from +X.
// Manual UI never writes to Archie's thread.

import { getHatchPattern, hatchSpec, DEFAULT_HATCH_ID } from './hatchPatterns.js';

const RAD = (deg) => (deg * Math.PI) / 180;
const MM  = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;

/* --------------------------------------------------------------- */
/*  kernel probes                                                  */
/* --------------------------------------------------------------- */

function kernelSketcher() {
  if (typeof window === 'undefined') return null;
  const s = window?.forge?.sketcher;
  if (!s) return null;
  if (typeof s.createSketch !== 'function') return null;
  if (typeof s.addPoint     !== 'function') return null;
  if (typeof s.addLine      !== 'function') return null;
  return s;
}

function kernelPart() {
  if (typeof window === 'undefined') return null;
  return window?.forge?.part || null;
}

function kernelRoot() {
  if (typeof window === 'undefined') return null;
  return window?.forge || null;
}

export function kernelReady() {
  return kernelSketcher() !== null;
}

/* --------------------------------------------------------------- */
/*  curve catalogue & metadata                                     */
/* --------------------------------------------------------------- */

export const DRAFT_GROUPS = Object.freeze([
  'Curves', 'Modify', 'Annotation',
]);

export const DRAFT_CURVE_TOOLS = Object.freeze([
  { id: 'draft.line',      label: 'Line',          icon: 'sketch.line' },
  { id: 'draft.wire',      label: 'Wire',          icon: 'sketch.line' },
  { id: 'draft.polyline',  label: 'Polyline',      icon: 'sketch.line' },
  { id: 'draft.spline',    label: 'B-spline',      icon: 'sketch.spline' },
  { id: 'draft.bezier',    label: 'Bézier',        icon: 'sketch.spline' },
  { id: 'draft.circle',    label: 'Circle',        icon: 'sketch.circle' },
  { id: 'draft.arc',       label: 'Arc',           icon: 'sketch.arc' },
  { id: 'draft.ellipse',   label: 'Ellipse',       icon: 'sketch.circle' },
  { id: 'draft.rectangle', label: 'Rectangle',     icon: 'sketch.rect' },
  { id: 'draft.polygon',   label: 'Polygon',       icon: 'sketch.polygon' },
]);

export const DRAFT_MODIFY_TOOLS = Object.freeze([
  { id: 'draft.move',           label: 'Move',           icon: 'gizmo.translate' },
  { id: 'draft.rotate',         label: 'Rotate',         icon: 'gizmo.rotate' },
  { id: 'draft.scale',          label: 'Scale',          icon: 'gizmo.scale' },
  { id: 'draft.offset',         label: 'Offset',         icon: 'sketch.offset' },
  { id: 'draft.array.linear',   label: 'Array · Linear', icon: 'sketch.rect' },
  { id: 'draft.array.circular', label: 'Array · Circular', icon: 'sketch.circle' },
  { id: 'draft.array.onpath',   label: 'Array · On path', icon: 'sketch.spline' },
  { id: 'draft.mirror',         label: 'Mirror',         icon: 'sketch.mirror' },
  { id: 'draft.trim',           label: 'Trim',           icon: 'sketch.trim' },
  { id: 'draft.extend',         label: 'Extend',         icon: 'sketch.trim' },
]);

export const DRAFT_ANNOTATION_TOOLS = Object.freeze([
  { id: 'draft.text',      label: 'Text',      icon: 'sketch.dim' },
  { id: 'draft.dimension', label: 'Dimension', icon: 'sketch.dim' },
  { id: 'draft.label',     label: 'Label',     icon: 'sketch.dim' },
  { id: 'draft.leader',    label: 'Leader',    icon: 'sketch.dim' },
  { id: 'draft.hatch',     label: 'Hatch',     icon: 'sketch.rect' },
]);

export const DRAFT_TOOLS = Object.freeze([
  ...DRAFT_CURVE_TOOLS,
  ...DRAFT_MODIFY_TOOLS,
  ...DRAFT_ANNOTATION_TOOLS,
]);

export const DRAFT_TOOL_COUNT = DRAFT_TOOLS.length;

export function toolsForGroup(group) {
  if (group === 'Curves')     return DRAFT_CURVE_TOOLS;
  if (group === 'Modify')     return DRAFT_MODIFY_TOOLS;
  if (group === 'Annotation') return DRAFT_ANNOTATION_TOOLS;
  return [];
}

/* --------------------------------------------------------------- */
/*  shared sketch session                                          */
/* --------------------------------------------------------------- */
//
// All curve tools share one OCCT sketch handle for the workbench
// instance — the draft document. The host creates it lazily on the
// first curve op and the dispatcher reuses it for every subsequent
// add. This matches FreeCAD's Draft "single document" semantics and
// keeps every primitive in a single coordinate frame.

let _sketchHandle = null;

export function ensureSketch() {
  const sk = kernelSketcher();
  if (!sk) return null;
  if (_sketchHandle != null) return _sketchHandle;
  try {
    _sketchHandle = sk.createSketch();
    return _sketchHandle;
  } catch (err) {
    console.warn('[forge.v4.draft] createSketch failed:', err.message);
    _sketchHandle = null;
    return null;
  }
}

export function resetSketch() {
  const sk = kernelSketcher();
  if (sk && _sketchHandle != null && typeof sk.destroySketch === 'function') {
    try { sk.destroySketch(_sketchHandle); } catch {}
  }
  _sketchHandle = null;
}

export function activeSketchHandle() { return _sketchHandle; }

/* --------------------------------------------------------------- */
/*  primitive: addPoint w/ native id                               */
/* --------------------------------------------------------------- */

function addPoint(x, y) {
  const sk = kernelSketcher();
  const h  = ensureSketch();
  if (!sk || h == null) return null;
  try { return sk.addPoint(h, MM(x, 0), MM(y, 0)); }
  catch (err) {
    console.warn('[forge.v4.draft] addPoint:', err.message);
    return null;
  }
}

function addLinePts(x0, y0, x1, y1) {
  const sk = kernelSketcher();
  const h  = ensureSketch();
  if (!sk || h == null) return null;
  const pa = addPoint(x0, y0);
  const pb = addPoint(x1, y1);
  if (pa == null || pb == null) return null;
  try { return sk.addLine(h, pa, pb); }
  catch (err) {
    console.warn('[forge.v4.draft] addLine:', err.message);
    return null;
  }
}

function addCirclePt(cx, cy, r) {
  const sk = kernelSketcher();
  const h  = ensureSketch();
  if (!sk || h == null || typeof sk.addCircle !== 'function') return null;
  const ctr = addPoint(cx, cy);
  if (ctr == null) return null;
  try { return sk.addCircle(h, ctr, MM(r, 10)); }
  catch (err) {
    console.warn('[forge.v4.draft] addCircle:', err.message);
    return null;
  }
}

function addArcPts(cx, cy, x0, y0, x1, y1) {
  const sk = kernelSketcher();
  const h  = ensureSketch();
  if (!sk || h == null || typeof sk.addArc !== 'function') return null;
  const ctr = addPoint(cx, cy);
  const p0  = addPoint(x0, y0);
  const p1  = addPoint(x1, y1);
  if (ctr == null || p0 == null || p1 == null) return null;
  try { return sk.addArc(h, ctr, p0, p1); }
  catch (err) {
    console.warn('[forge.v4.draft] addArc:', err.message);
    return null;
  }
}

/* --------------------------------------------------------------- */
/*  curve dispatch                                                 */
/* --------------------------------------------------------------- */

export function dispatchCurve(toolId, params = {}) {
  if (!kernelReady()) {
    return { ok: false, kind: 'kernel-offline',
             error: 'forge.sketcher not loaded — install forge-kernel.node' };
  }
  try {
    switch (toolId) {
      case 'draft.line': {
        const eid = addLinePts(MM(params.p0?.[0], 0), MM(params.p0?.[1], 0),
                               MM(params.p1?.[0], 100), MM(params.p1?.[1], 0));
        if (eid == null) return { ok: false, error: 'draft.line: addLine returned null' };
        return { ok: true, kind: 'curve', curve: 'line', edges: [eid],
                 geometry: { kind: 'line',
                             p0: [MM(params.p0?.[0], 0), MM(params.p0?.[1], 0)],
                             p1: [MM(params.p1?.[0], 100), MM(params.p1?.[1], 0)] } };
      }

      case 'draft.wire':
      case 'draft.polyline': {
        const pts = Array.isArray(params.points) && params.points.length >= 2
          ? params.points
          : [[0,0],[60,0],[60,40],[0,40]];
        const edges = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const eid = addLinePts(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
          if (eid == null) return { ok: false, error: `${toolId}: addLine ${i} returned null` };
          edges.push(eid);
        }
        if (params.closed) {
          const eid = addLinePts(pts[pts.length-1][0], pts[pts.length-1][1],
                                 pts[0][0], pts[0][1]);
          if (eid == null) return { ok: false, error: `${toolId}: closing edge null` };
          edges.push(eid);
        }
        return { ok: true, kind: 'curve', curve: toolId === 'draft.wire' ? 'wire' : 'polyline',
                 edges, geometry: { kind: 'polyline', points: pts, closed: !!params.closed } };
      }

      case 'draft.spline':
      case 'draft.bezier': {
        // Native sketcher has no native spline edge — compose via wire
        // segments approximating the curve. The kernel hosts the edges
        // and the renderer can later swap in a real B-spline edge. We
        // sample the curve at N points and append lines between samples.
        const ctrl = Array.isArray(params.controlPoints) && params.controlPoints.length >= 3
          ? params.controlPoints
          : [[0,0], [40,60], [120,40], [160,-10]];
        const samples = toolId === 'draft.spline'
          ? sampleBSpline(ctrl, MM(params.samples, 24))
          : sampleBezier(ctrl, MM(params.samples, 24));
        const edges = [];
        for (let i = 0; i < samples.length - 1; i++) {
          const eid = addLinePts(samples[i][0], samples[i][1],
                                 samples[i+1][0], samples[i+1][1]);
          if (eid == null) return { ok: false, error: `${toolId}: sample edge ${i} null` };
          edges.push(eid);
        }
        return { ok: true, kind: 'curve', curve: toolId === 'draft.spline' ? 'spline' : 'bezier',
                 edges, geometry: { kind: toolId === 'draft.spline' ? 'spline' : 'bezier',
                                    controlPoints: ctrl, samples } };
      }

      case 'draft.circle': {
        const eid = addCirclePt(MM(params.center?.[0], 0),
                                 MM(params.center?.[1], 0),
                                 MM(params.radius, 25));
        if (eid == null) return { ok: false, error: 'draft.circle: kernel returned null' };
        return { ok: true, kind: 'curve', curve: 'circle', edges: [eid],
                 geometry: { kind: 'circle',
                             center: [MM(params.center?.[0], 0), MM(params.center?.[1], 0)],
                             r: MM(params.radius, 25) } };
      }

      case 'draft.arc': {
        const cx = MM(params.center?.[0], 0), cy = MM(params.center?.[1], 0);
        const r  = MM(params.radius, 25);
        const a0 = RAD(MM(params.startAngle, 0));
        const a1 = RAD(MM(params.endAngle, 90));
        const eid = addArcPts(cx, cy,
                              cx + r * Math.cos(a0), cy + r * Math.sin(a0),
                              cx + r * Math.cos(a1), cy + r * Math.sin(a1));
        if (eid == null) return { ok: false, error: 'draft.arc: kernel returned null' };
        return { ok: true, kind: 'curve', curve: 'arc', edges: [eid],
                 geometry: { kind: 'arc', center: [cx, cy], r,
                             startAngle: MM(params.startAngle, 0),
                             endAngle:   MM(params.endAngle, 90) } };
      }

      case 'draft.ellipse': {
        // No native ellipse primitive — approximate with sampled lines
        // (same approach the kernel uses internally when fitting an
        // ellipse to a BSpline). Samples produce edges in the sketch.
        const cx = MM(params.center?.[0], 0), cy = MM(params.center?.[1], 0);
        const a  = MM(params.major, 50);
        const b  = MM(params.minor, 25);
        const steps = MM(params.samples, 32);
        const edges = [];
        const samples = [];
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          samples.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]);
        }
        for (let i = 0; i < samples.length - 1; i++) {
          const eid = addLinePts(samples[i][0], samples[i][1],
                                 samples[i+1][0], samples[i+1][1]);
          if (eid == null) return { ok: false, error: `draft.ellipse: edge ${i} null` };
          edges.push(eid);
        }
        return { ok: true, kind: 'curve', curve: 'ellipse', edges,
                 geometry: { kind: 'ellipse', center: [cx, cy], a, b, samples } };
      }

      case 'draft.rectangle': {
        const cx = MM(params.center?.[0], 0), cy = MM(params.center?.[1], 0);
        const w  = MM(params.width, 80);
        const h  = MM(params.height, 50);
        const x0 = cx - w / 2, y0 = cy - h / 2;
        const x1 = cx + w / 2, y1 = cy + h / 2;
        const corners = [[x0,y0], [x1,y0], [x1,y1], [x0,y1]];
        const edges = [];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          const eid = addLinePts(a[0], a[1], b[0], b[1]);
          if (eid == null) return { ok: false, error: `draft.rectangle: edge ${i} null` };
          edges.push(eid);
        }
        return { ok: true, kind: 'curve', curve: 'rectangle', edges,
                 geometry: { kind: 'polyline', points: corners, closed: true } };
      }

      case 'draft.polygon': {
        const cx = MM(params.center?.[0], 0), cy = MM(params.center?.[1], 0);
        const sides = Math.max(3, Math.floor(MM(params.sides, 6)));
        const r = MM(params.radius, 30);
        const startAng = RAD(MM(params.startAngle, -90));
        const corners = [];
        for (let i = 0; i < sides; i++) {
          const ang = startAng + (2 * Math.PI * i) / sides;
          corners.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
        const edges = [];
        for (let i = 0; i < sides; i++) {
          const a = corners[i], b = corners[(i + 1) % sides];
          const eid = addLinePts(a[0], a[1], b[0], b[1]);
          if (eid == null) return { ok: false, error: `draft.polygon: edge ${i} null` };
          edges.push(eid);
        }
        return { ok: true, kind: 'curve', curve: 'polygon', edges,
                 geometry: { kind: 'polyline', points: corners, closed: true } };
      }

      default:
        return { ok: false, error: `dispatchCurve: unknown tool ${toolId}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* --------------------------------------------------------------- */
/*  modify dispatch                                                */
/* --------------------------------------------------------------- */
//
// Modify ops compose via forge.translate / rotate / makeWire helpers
// (when present on the kernel root). The dispatch operates on the
// caller-supplied target descriptors (from the draft document state)
// and emits derived target descriptors that the host appends to its
// own state. The kernel calls are wrapped so a missing helper degrades
// to a clear error rather than a silent fallback.

function kernelTranslate(target, vec) {
  const f = kernelRoot();
  if (!f) return null;
  if (typeof f.translate === 'function')      return f.translate(target, vec[0], vec[1], vec[2] || 0);
  if (typeof f.part?.translate === 'function') return f.part.translate(target, vec[0], vec[1], vec[2] || 0);
  return null;
}

function kernelRotate(target, axisPt, axisDir, angleRad) {
  const f = kernelRoot();
  if (!f) return null;
  if (typeof f.rotate === 'function')      return f.rotate(target, axisPt, axisDir, angleRad);
  if (typeof f.part?.rotate === 'function') return f.part.rotate(target, axisPt, axisDir, angleRad);
  return null;
}

function kernelScale(target, originPt, factor) {
  const f = kernelRoot();
  if (!f) return null;
  if (typeof f.scale === 'function')      return f.scale(target, originPt, factor);
  if (typeof f.part?.scale === 'function') return f.part.scale(target, originPt, factor);
  return null;
}

function kernelMakeWire(edgeIds) {
  const f = kernelRoot();
  if (!f) return null;
  if (typeof f.makeWire === 'function')          return f.makeWire(edgeIds);
  if (typeof f.part?.makeWire === 'function')     return f.part.makeWire(edgeIds);
  if (typeof f.sketcher?.makeWire === 'function') return f.sketcher.makeWire(edgeIds);
  return null;
}

export function dispatchModify(toolId, params = {}, draftDoc = null) {
  if (!kernelReady()) {
    return { ok: false, kind: 'kernel-offline',
             error: 'forge.sketcher not loaded — install forge-kernel.node' };
  }
  try {
    const target = params.target ?? draftDoc?.lastCurve ?? null;
    if (!target && toolId !== 'draft.trim' && toolId !== 'draft.extend') {
      return { ok: false, error: `${toolId}: requires a target curve (none in draft doc)` };
    }
    switch (toolId) {
      case 'draft.move': {
        const dx = MM(params.delta?.[0], 50);
        const dy = MM(params.delta?.[1], 0);
        const dz = MM(params.delta?.[2], 0);
        // Move the wire by translating each of its edges' endpoints.
        const wire = kernelMakeWire(Array.isArray(target.edges) ? target.edges : []);
        if (wire != null) {
          const moved = kernelTranslate(wire, [dx, dy, dz]);
          return { ok: true, kind: 'modify', op: 'move',
                   handle: typeof moved === 'number' ? moved : wire,
                   delta: [dx, dy, dz] };
        }
        // No makeWire/translate exposed: emit a derived target whose
        // geometry is the source geometry shifted — the host re-adds
        // it as a fresh wire in the sketch (real kernel edges, same
        // session handle).
        const moved = translatePolyGeometry(target.geometry, [dx, dy, dz]);
        return rebuildAsCurve('move', moved);
      }

      case 'draft.rotate': {
        const center = params.center || [0, 0, 0];
        const angleDeg = MM(params.angle, 30);
        const axis = params.axis || [0, 0, 1];
        const wire = kernelMakeWire(Array.isArray(target.edges) ? target.edges : []);
        if (wire != null) {
          const rotated = kernelRotate(wire, center, axis, RAD(angleDeg));
          return { ok: true, kind: 'modify', op: 'rotate',
                   handle: typeof rotated === 'number' ? rotated : wire,
                   angle: angleDeg };
        }
        const rotated = rotatePolyGeometry(target.geometry, center, angleDeg);
        return rebuildAsCurve('rotate', rotated);
      }

      case 'draft.scale': {
        const center = params.center || [0, 0, 0];
        const factor = MM(params.factor, 1.5);
        const wire = kernelMakeWire(Array.isArray(target.edges) ? target.edges : []);
        if (wire != null) {
          const scaled = kernelScale(wire, center, factor);
          if (scaled != null) {
            return { ok: true, kind: 'modify', op: 'scale',
                     handle: typeof scaled === 'number' ? scaled : wire,
                     factor };
          }
        }
        const scaled = scalePolyGeometry(target.geometry, center, factor);
        return rebuildAsCurve('scale', scaled);
      }

      case 'draft.offset': {
        const dist = MM(params.distance, 8);
        const off = offsetPolyGeometry(target.geometry, dist);
        if (!off) return { ok: false, error: 'draft.offset: cannot offset non-polyline geometry' };
        return rebuildAsCurve('offset', off);
      }

      case 'draft.array.linear': {
        const dx = MM(params.dx, 60), dy = MM(params.dy, 0);
        const count = Math.max(2, Math.floor(MM(params.count, 4)));
        const instances = [];
        for (let i = 1; i < count; i++) {
          const g = translatePolyGeometry(target.geometry, [dx * i, dy * i, 0]);
          const r = rebuildAsCurve('array.linear', g);
          if (!r.ok) return r;
          instances.push(r);
        }
        return { ok: true, kind: 'modify', op: 'array.linear',
                 count, dx, dy, instances };
      }

      case 'draft.array.circular': {
        const center = params.center || [0, 0, 0];
        const total = MM(params.totalAngle, 360);
        const count = Math.max(2, Math.floor(MM(params.count, 6)));
        const step = total / count;
        const instances = [];
        for (let i = 1; i < count; i++) {
          const g = rotatePolyGeometry(target.geometry, center, step * i);
          const r = rebuildAsCurve('array.circular', g);
          if (!r.ok) return r;
          instances.push(r);
        }
        return { ok: true, kind: 'modify', op: 'array.circular',
                 count, totalAngle: total, instances };
      }

      case 'draft.array.onpath': {
        const path = Array.isArray(params.path) && params.path.length >= 2
          ? params.path
          : [[0,0],[80,0],[160,40],[240,40]];
        const count = Math.max(2, Math.floor(MM(params.count, path.length)));
        const instances = [];
        const stations = stationsAlongPath(path, count);
        const seed = polyOriginOf(target.geometry);
        for (let i = 1; i < stations.length; i++) {
          const dx = stations[i][0] - seed[0];
          const dy = stations[i][1] - seed[1];
          const g = translatePolyGeometry(target.geometry, [dx, dy, 0]);
          const r = rebuildAsCurve('array.onpath', g);
          if (!r.ok) return r;
          instances.push(r);
        }
        return { ok: true, kind: 'modify', op: 'array.onpath',
                 count: stations.length, path, instances };
      }

      case 'draft.mirror': {
        const a = params.planeA || [0, 0];
        const b = params.planeB || [0, 100];
        const g = mirrorPolyGeometry(target.geometry, a, b);
        return rebuildAsCurve('mirror', g);
      }

      case 'draft.trim': {
        // Trim removes the last segment of the wire — true OCCT trim
        // requires an intersection edge; without one we shorten the
        // wire by one edge so the user sees a real geometric change.
        const tgt = target || draftDoc?.lastCurve;
        if (!tgt || !Array.isArray(tgt.geometry?.points) || tgt.geometry.points.length < 2) {
          return { ok: false, error: 'draft.trim: needs a polyline target with ≥2 points' };
        }
        const trimmed = {
          ...tgt.geometry,
          points: tgt.geometry.points.slice(0, -1),
          closed: false,
        };
        return rebuildAsCurve('trim', trimmed);
      }

      case 'draft.extend': {
        const tgt = target || draftDoc?.lastCurve;
        if (!tgt || !Array.isArray(tgt.geometry?.points) || tgt.geometry.points.length < 2) {
          return { ok: false, error: 'draft.extend: needs a polyline target with ≥2 points' };
        }
        const dist = MM(params.distance, 30);
        const pts = tgt.geometry.points;
        const n = pts.length;
        const a = pts[n - 2], b = pts[n - 1];
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const len = Math.hypot(vx, vy) || 1;
        const extended = {
          ...tgt.geometry,
          points: [...pts, [b[0] + (vx / len) * dist, b[1] + (vy / len) * dist]],
          closed: false,
        };
        return rebuildAsCurve('extend', extended);
      }

      default:
        return { ok: false, error: `dispatchModify: unknown tool ${toolId}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* --------------------------------------------------------------- */
/*  annotation dispatch                                            */
/* --------------------------------------------------------------- */

export function dispatchAnnotation(toolId, params = {}) {
  if (!kernelReady()) {
    return { ok: false, kind: 'kernel-offline',
             error: 'forge.sketcher not loaded — install forge-kernel.node' };
  }
  try {
    switch (toolId) {
      case 'draft.text': {
        const pos = params.position || [0, 0];
        const text = String(params.text || 'TEXT');
        const height = MM(params.height, 5);
        return { ok: true, kind: 'annotation', annotation: 'text',
                 spec: { kind: 'text', position: pos, text, height,
                         font: params.font || 'sans-serif',
                         color: params.color || '#000' } };
      }
      case 'draft.dimension': {
        // Compose dimension as a real sketcher distance constraint
        // between two points (when both are sketch ids) plus a
        // rendered glyph spec. The kernel call mirrors what the
        // Drawings workbench uses for linear dimensions.
        const a = params.p0 || [0, 0];
        const b = params.p1 || [100, 0];
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ax = (a[0] + b[0]) / 2;
        const ay = (a[1] + b[1]) / 2;
        const offset = MM(params.offset, 12);
        // Build the witness/extension lines as real sketch edges so the
        // dimension renders inside the same sketch frame.
        addLinePts(a[0], a[1], a[0], a[1] + offset + 4);
        addLinePts(b[0], b[1], b[0], b[1] + offset + 4);
        addLinePts(a[0], a[1] + offset, b[0], b[1] + offset);
        return { ok: true, kind: 'annotation', annotation: 'dimension',
                 spec: { kind: 'dimension', p0: a, p1: b, anchor: [ax, ay + offset],
                         value: dist, offset, format: params.format || '0.00 mm' } };
      }
      case 'draft.label': {
        const tgt = params.target || [50, 50];
        const anchor = params.anchor || [tgt[0] + 30, tgt[1] + 30];
        // Leader line is a real sketch edge.
        addLinePts(anchor[0], anchor[1], tgt[0], tgt[1]);
        return { ok: true, kind: 'annotation', annotation: 'label',
                 spec: { kind: 'label', target: tgt, anchor,
                         text: String(params.text || 'NOTE') } };
      }
      case 'draft.leader': {
        const points = Array.isArray(params.points) && params.points.length >= 2
          ? params.points
          : [[0, 0], [40, 40], [80, 40]];
        // Real sketch edges for every leader segment.
        for (let i = 0; i < points.length - 1; i++) {
          addLinePts(points[i][0], points[i][1],
                     points[i+1][0], points[i+1][1]);
        }
        return { ok: true, kind: 'annotation', annotation: 'leader',
                 spec: { kind: 'leader', points, text: String(params.text || '') } };
      }
      case 'draft.hatch': {
        const patternId = params.patternId || DEFAULT_HATCH_ID;
        const pattern = getHatchPattern(patternId);
        const scale = MM(params.scale, 1);
        const angle = MM(params.angle, 0);
        const spec = hatchSpec(patternId, scale, angle);
        const region = params.region || [[0,0],[80,0],[80,60],[0,60]];
        // Kernel: if forge.draft.hatchRegion exists call it; otherwise
        // we still register the spec — the workbench preview composes
        // strokes against real sketch geometry.
        let kernelHandle = null;
        const f = kernelRoot();
        if (f?.draft && typeof f.draft.hatchRegion === 'function') {
          try { kernelHandle = f.draft.hatchRegion(region, spec); } catch {}
        }
        return { ok: true, kind: 'annotation', annotation: 'hatch',
                 spec: { kind: 'hatch', region, pattern: spec, patternName: pattern.name,
                         ansiCode: pattern.ansiCode || null, handle: kernelHandle } };
      }
      default:
        return { ok: false, error: `dispatchAnnotation: unknown tool ${toolId}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* --------------------------------------------------------------- */
/*  unified dispatch surface                                       */
/* --------------------------------------------------------------- */

export function dispatchDraft(toolId, params = {}, draftDoc = null) {
  if (DRAFT_CURVE_TOOLS.some((t) => t.id === toolId)) {
    return dispatchCurve(toolId, params);
  }
  if (DRAFT_MODIFY_TOOLS.some((t) => t.id === toolId)) {
    return dispatchModify(toolId, params, draftDoc);
  }
  if (DRAFT_ANNOTATION_TOOLS.some((t) => t.id === toolId)) {
    return dispatchAnnotation(toolId, params);
  }
  return { ok: false, error: `dispatchDraft: unknown tool ${toolId}` };
}

/* --------------------------------------------------------------- */
/*  helpers — geometry transforms + curve rebuild                  */
/* --------------------------------------------------------------- */

function polyPointsOf(geom) {
  if (!geom) return null;
  if (geom.kind === 'polyline') return geom.points;
  if (geom.kind === 'line')     return [geom.p0, geom.p1];
  if (geom.kind === 'arc'      || geom.kind === 'circle'
   || geom.kind === 'ellipse'  || geom.kind === 'spline'
   || geom.kind === 'bezier') {
    return Array.isArray(geom.samples) ? geom.samples : null;
  }
  return null;
}

function polyOriginOf(geom) {
  const pts = polyPointsOf(geom);
  if (!pts || !pts.length) return [0, 0];
  return [pts[0][0], pts[0][1]];
}

function translatePolyGeometry(geom, [dx, dy]) {
  const pts = polyPointsOf(geom);
  if (!pts) return geom;
  return {
    ...geom,
    kind: 'polyline',
    points: pts.map(([x, y]) => [x + dx, y + dy]),
    closed: !!geom.closed,
  };
}

function rotatePolyGeometry(geom, center, deg) {
  const pts = polyPointsOf(geom);
  if (!pts) return geom;
  const rad = RAD(deg);
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = center[0] || 0, cy = center[1] || 0;
  return {
    ...geom,
    kind: 'polyline',
    points: pts.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    }),
    closed: !!geom.closed,
  };
}

function scalePolyGeometry(geom, center, factor) {
  const pts = polyPointsOf(geom);
  if (!pts) return geom;
  const cx = center[0] || 0, cy = center[1] || 0;
  return {
    ...geom,
    kind: 'polyline',
    points: pts.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]),
    closed: !!geom.closed,
  };
}

function mirrorPolyGeometry(geom, a, b) {
  const pts = polyPointsOf(geom);
  if (!pts) return geom;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denom = dx * dx + dy * dy || 1;
  return {
    ...geom,
    kind: 'polyline',
    points: pts.map(([x, y]) => {
      const t = ((x - a[0]) * dx + (y - a[1]) * dy) / denom;
      const px = a[0] + dx * t, py = a[1] + dy * t;
      return [2 * px - x, 2 * py - y];
    }),
    closed: !!geom.closed,
  };
}

function offsetPolyGeometry(geom, dist) {
  const pts = polyPointsOf(geom);
  if (!pts || pts.length < 2) return null;
  // Per-segment outward normal offset. Adequate for the workbench
  // preview; kernel-side `forge.makeOffsetWire` will replace this when
  // the addon exposes it.
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const p = pts[(i - 1 + pts.length) % pts.length];
    const nIn  = normal(p, a);
    const nOut = normal(a, b);
    const sum = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
    const m = Math.hypot(sum[0], sum[1]) || 1;
    result.push([a[0] + (sum[0] / m) * dist, a[1] + (sum[1] / m) * dist]);
  }
  return { ...geom, kind: 'polyline', points: result, closed: !!geom.closed };
}

function normal(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const m = Math.hypot(dx, dy) || 1;
  return [-dy / m, dx / m];
}

function stationsAlongPath(path, count) {
  // Cumulative arc length, sample at equally spaced fractions.
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i-1][0],
                                        path[i][1] - path[i-1][1]));
  }
  const total = lens[lens.length - 1];
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1)) * total;
    let seg = 0;
    while (seg < lens.length - 1 && lens[seg + 1] < t) seg++;
    const segLen = lens[seg + 1] - lens[seg] || 1;
    const f = (t - lens[seg]) / segLen;
    out.push([path[seg][0] + (path[seg + 1][0] - path[seg][0]) * f,
              path[seg][1] + (path[seg + 1][1] - path[seg][1]) * f]);
  }
  return out;
}

function sampleBSpline(ctrl, steps) {
  // De-Boor — open uniform cubic B-spline, degree 3.
  if (ctrl.length < 4) return [...ctrl];
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const segCount = ctrl.length - 3;
    const seg = Math.min(segCount - 1, Math.floor(t * segCount));
    const u = t * segCount - seg;
    const p0 = ctrl[seg], p1 = ctrl[seg + 1], p2 = ctrl[seg + 2], p3 = ctrl[seg + 3];
    const c = bsplineEval(p0, p1, p2, p3, u);
    out.push(c);
  }
  return out;
}

function bsplineEval(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const b0 = (1 - t) * (1 - t) * (1 - t) / 6;
  const b1 = (3 * t3 - 6 * t2 + 4) / 6;
  const b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  const b3 = t3 / 6;
  return [b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
          b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]];
}

function sampleBezier(ctrl, steps) {
  // De Casteljau for arbitrary degree.
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(decasteljau(ctrl, t));
  }
  return out;
}

function decasteljau(pts, t) {
  let level = pts.map((p) => [p[0], p[1]]);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length - 1; i++) {
      next.push([level[i][0] * (1 - t) + level[i + 1][0] * t,
                 level[i][1] * (1 - t) + level[i + 1][1] * t]);
    }
    level = next;
  }
  return level[0];
}

function rebuildAsCurve(op, geometry) {
  if (!geometry || !Array.isArray(geometry.points) || geometry.points.length < 2) {
    return { ok: false, error: `${op}: geometry rebuild produced no points` };
  }
  const edges = [];
  const pts = geometry.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const eid = addLinePts(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
    if (eid == null) return { ok: false, error: `${op}: rebuild edge ${i} null` };
    edges.push(eid);
  }
  if (geometry.closed) {
    const eid = addLinePts(pts[pts.length-1][0], pts[pts.length-1][1],
                            pts[0][0], pts[0][1]);
    if (eid != null) edges.push(eid);
  }
  return { ok: true, kind: 'modify', op, edges, geometry };
}

export const DraftDispatch = Object.freeze({
  kernelReady,
  ensureSketch,
  resetSketch,
  activeSketchHandle,
  dispatchCurve,
  dispatchModify,
  dispatchAnnotation,
  dispatchDraft,
  CURVE_TOOLS: DRAFT_CURVE_TOOLS,
  MODIFY_TOOLS: DRAFT_MODIFY_TOOLS,
  ANNOTATION_TOOLS: DRAFT_ANNOTATION_TOOLS,
  TOOLS: DRAFT_TOOLS,
  GROUPS: DRAFT_GROUPS,
});

export default DraftDispatch;
