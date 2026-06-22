// Task #21 (Enterprise CAD UI/UX) — measure-on-selection logic.
//
// CATIA "Measure Between" / NX quick-measure: the instant you pick one
// or two entities, the app shows distance / angle / length / radius
// WITHOUT opening a dialog. The recon found a modal MeasureToolPanel but
// no always-on readout. This module is the pure, DOM-free, node-testable
// brain behind a corner HUD (MeasureHudHost).
//
// Inputs are the canonical live read-surfaces the shell already
// publishes:
//   selection : window.__forgeSelection
//               { kind, ids:[handle…], bodyHandle?, items?:[descriptors] }
//   bodies    : window.__forgeBodies  (registry of { handle/id, name, … })
//   pointsOf  : optional fn(selectionItem) → [x,y,z] for vertex picks
//               (the viewport supplies real coords; tests pass a stub).
//
// Returns a readout object or null:
//   { metric: 'distance'|'angle'|'length'|'radius'|'point'|'count',
//     value: number|null, unit: 'mm'|'deg'|'',
//     label: string, detail: string }
//
// Every body name that reaches the label is SANITIZED (the same
// injection class selectionContext.js guards against — a body named
// "</x>" must never reach a prompt-bound HUD verbatim).

function _san(s, max = 40) {
  return String(s == null ? '' : s)
    .replace(/[<>]/g, '')
    .replace(/["'`]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function _isVec3(p) {
  return Array.isArray(p) && p.length >= 3
    && p.slice(0, 3).every((v) => Number.isFinite(v));
}

function _dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Angle (degrees) between two direction vectors. null on degenerate.
export function angleBetween(u, v) {
  if (!_isVec3(u) || !_isVec3(v)) return null;
  const du = Math.hypot(u[0], u[1], u[2]);
  const dv = Math.hypot(v[0], v[1], v[2]);
  if (du < 1e-12 || dv < 1e-12) return null;
  let c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (du * dv);
  c = Math.max(-1, Math.min(1, c));
  return Math.acos(c) * 180 / Math.PI;
}

// Resolve a selection into a normalized list of pick items, each with
// its owning body + sub descriptor. Tolerant of the several shapes the
// shell publishes (ids[] of handles, or items[] of rich descriptors).
function _resolveItems(selection, bodies) {
  if (!selection || selection.kind === 'none') return [];
  const reg = Array.isArray(bodies) ? bodies : [];
  const findBody = (h) => reg.find((b) => b.handle === h || b.id === h) || null;

  // Rich items take priority (face/edge/vertex with explicit normals/coords).
  if (Array.isArray(selection.items) && selection.items.length) {
    return selection.items.map((it) => ({
      kind: it.kind || selection.kind || 'body',
      handle: it.handle ?? it.bodyHandle ?? null,
      body: findBody(it.handle ?? it.bodyHandle),
      point: _isVec3(it.point) ? it.point.slice(0, 3) : null,
      normal: _isVec3(it.normal) ? it.normal.slice(0, 3) : null,
      direction: _isVec3(it.direction) ? it.direction.slice(0, 3) : null,
      radius: Number.isFinite(it.radius) ? it.radius : null,
      length: Number.isFinite(it.length) ? it.length : null,
      raw: it,
    }));
  }

  const ids = Array.isArray(selection.ids) ? selection.ids
    : (selection.bodyHandle != null ? [selection.bodyHandle] : []);
  return ids.map((h) => ({
    kind: selection.kind || 'body',
    handle: h,
    body: findBody(h),
    point: null, normal: null, direction: null, radius: null, length: null,
    raw: { handle: h },
  }));
}

function _name(item, fallback) {
  const n = item && item.body && item.body.name;
  return _san(n || fallback || (item && item.handle != null ? `Body ${item.handle}` : 'entity'));
}

// Core: compute the live measure readout from a selection. Pure.
export function measureOnSelection(selection, bodies) {
  const items = _resolveItems(selection, bodies);
  if (items.length === 0) return null;

  // ── single pick ──────────────────────────────────────────────────
  if (items.length === 1) {
    const it = items[0];
    if (it.kind === 'edge') {
      if (Number.isFinite(it.length)) {
        return { metric: 'length', value: it.length, unit: 'mm',
          label: `Length ${it.length.toFixed(2)} mm`,
          detail: `edge of ${_name(it)}` };
      }
      if (Number.isFinite(it.radius)) {
        return { metric: 'radius', value: it.radius, unit: 'mm',
          label: `Radius ${it.radius.toFixed(2)} mm`,
          detail: `edge of ${_name(it)}` };
      }
    }
    if (it.kind === 'vertex' && _isVec3(it.point)) {
      const p = it.point;
      return { metric: 'point', value: null, unit: '',
        label: `(${p.map((v) => v.toFixed(1)).join(', ')})`,
        detail: `vertex of ${_name(it)}` };
    }
    // body / face single pick — nothing to measure between, report the kind.
    return { metric: 'count', value: 1, unit: '',
      label: `1 ${it.kind} selected`,
      detail: `pick a second entity to measure between` };
  }

  // ── two picks → distance or angle ────────────────────────────────
  if (items.length === 2) {
    const [a, b] = items;
    // Two faces / two edges with directions → ANGLE.
    const ua = a.normal || a.direction;
    const ub = b.normal || b.direction;
    if (ua && ub) {
      const ang = angleBetween(ua, ub);
      if (ang != null) {
        return { metric: 'angle', value: ang, unit: 'deg',
          label: `Angle ${ang.toFixed(2)}°`,
          detail: `${_name(a)} ↔ ${_name(b)}` };
      }
    }
    // Two points (vertices) → DISTANCE.
    if (_isVec3(a.point) && _isVec3(b.point)) {
      const d = _dist(a.point, b.point);
      return { metric: 'distance', value: d, unit: 'mm',
        label: `Distance ${d.toFixed(2)} mm`,
        detail: `${_name(a)} ↔ ${_name(b)}` };
    }
    // Fallback: two bodies/entities without coords → report the pair.
    return { metric: 'count', value: 2, unit: '',
      label: `2 ${a.kind === b.kind ? a.kind : 'entities'} selected`,
      detail: `${_name(a)} · ${_name(b)}` };
  }

  // ── 3+ picks → count only ────────────────────────────────────────
  return { metric: 'count', value: items.length, unit: '',
    label: `${items.length} entities selected`,
    detail: 'measure works on 1–2 picks' };
}

export const _internals = { _resolveItems, _san, _dist };
