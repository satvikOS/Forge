// Task #21 (Enterprise CAD UI/UX) — active-datum / CSYS + snap-target
// context store for the status bar.
//
// NX shows the active WCS / datum in the footer; Creo shows the active
// coordinate-system + the current snap reference. The recon found
// Forge's StatusBar had mode + selection-count + single-body mass props,
// but NO active-datum context and NO live snap-target readout — both
// standard in pro-MCAD footers.
//
// This is the canonical DOM-free store + the imperative half of the
// window-API no-setState contract. The window API mutates THIS module +
// dispatches; StatusBar subscribes via addEventListener and reads —
// never a React setter inside the window API.

const DATUM_TYPES = new Set(['plane', 'axis', 'point', 'csys', 'origin']);
const SNAP_TYPES = new Set([
  'endpoint', 'midpoint', 'center', 'intersection',
  'grid', 'vertex', 'edge', 'face', 'origin', 'tangent', 'perpendicular',
]);

let _datum = null;       // { name, type } | null
let _snap = null;        // { type, coords:[x,y,z]|null } | null
let _filterKind = null;  // active selection-filter kind mirror | null

const EVENT = 'forge:datum-context';

function _dispatch() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { datum: _datum, snap: _snap, filterKind: _filterKind },
    }));
  } catch { /* ignore */ }
}

function _san(s, max = 28) {
  return String(s == null ? '' : s)
    .replace(/[<>]/g, '')
    .replace(/["'`]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Normalize a datum descriptor → { name, type } or null. Unknown types
// fall back to 'csys' (a coordinate system is the most general datum) so
// a caller that supplies a name but a weird type still gets a readout,
// rather than silently dropping.
export function normalizeDatum(d) {
  if (!d || typeof d !== 'object') return null;
  const name = _san(d.name);
  if (!name) return null;
  let type = typeof d.type === 'string' ? d.type.toLowerCase() : '';
  if (!DATUM_TYPES.has(type)) type = 'csys';
  return { name, type };
}

export function normalizeSnap(s) {
  if (!s || typeof s !== 'object') return null;
  let type = typeof s.type === 'string' ? s.type.toLowerCase() : '';
  if (!SNAP_TYPES.has(type)) return null;
  let coords = null;
  if (Array.isArray(s.coords) && s.coords.length >= 3
      && s.coords.slice(0, 3).every((v) => Number.isFinite(v))) {
    coords = s.coords.slice(0, 3);
  }
  return { type, coords };
}

export function setActiveDatum(d) {
  _datum = normalizeDatum(d);   // null clears
  _dispatch();
  return _datum;
}

export function setSnapTarget(s) {
  _snap = normalizeSnap(s);     // null clears
  _dispatch();
  return _snap;
}

export function setFilterKind(kind) {
  const k = typeof kind === 'string' ? kind.toLowerCase() : null;
  _filterKind = (k && ['body', 'face', 'edge', 'vertex'].includes(k)) ? k : null;
  _dispatch();
  return _filterKind;
}

export function clearDatumContext() {
  _datum = null; _snap = null;
  _dispatch();
}

export function getActiveDatum() { return _datum; }
export function getSnapTarget() { return _snap; }
export function getFilterKind() { return _filterKind; }

// Footer-friendly labels. Empty string when absent.
export function datumLabel(d = _datum) {
  if (!d) return '';
  const T = { plane: 'Plane', axis: 'Axis', point: 'Point',
    csys: 'CSYS', origin: 'Origin' };
  return `${T[d.type] || 'CSYS'} ${d.name}`;
}

export function snapLabel(s = _snap) {
  if (!s) return '';
  const t = s.type.charAt(0).toUpperCase() + s.type.slice(1);
  if (s.coords) {
    return `${t} (${s.coords.map((v) => v.toFixed(1)).join(', ')})`;
  }
  return t;
}

export const DATUM_CONTEXT_EVENT = EVENT;
