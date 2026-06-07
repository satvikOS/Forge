// PUSH-90 (Slice-58 / Dimension Chains panel — Ordinate + Baseline + Chain).
//
// Up through PUSH-67 the only multi-point measurement in Forge was the
// MeasureToolPanel, which is strictly a point-to-point (A→B) distance
// plus optional 3-point angle. Engineering drawings (and especially
// machining drawings) need the next class of multi-point dimensions:
//
//   • **Ordinate** dimensions — every picked point is reported as
//     coordinates `(x_i, y_i, z_i)` referenced to a single origin
//     (the first point). The classic "X dim" / "Y dim" stack on a
//     drill-plate drawing where every hole position is read off a
//     single edge datum.
//
//   • **Baseline** dimensions — every dimension is from the first
//     point to the i-th point: `(P0→P1, P0→P2, …, P0→Pn)`. All
//     extension lines share the same witness line on the baseline.
//
//   • **Chain** dimensions — incremental dimensions between
//     consecutive points: `(P0→P1, P1→P2, …, Pn-1→Pn)`. The chain
//     adds up to the total span.
//
// PUSH-90 lights all three up in a dedicated panel that piggybacks the
// PUSH-67 selection-capture UX. The user opens the panel via the
// `tools.dimChains` menu entry, presses "Add Point" to arm a capture,
// then picks a face / edge / body in the viewport. The next
// `forge:selection-changed` event resolves to a world-space point
// (face centroid via `forge.direct.inferFeature`, edge midpoint via
// `forge.direct.edgeSegments`, or body COM via `forge.massProps`) and
// gets appended to the chain. Once 3 or more points are captured the
// chain-type radio (Ordinate / Baseline / Chain) and the Generate
// button light up. The resulting table is sortable and shows
// (label, value mm, from_pt, to_pt) — for ordinate the value is the
// scalar magnitude of the (x_i, y_i, z_i) vector and from_pt = "Origin".
//
// The full chain is persisted on `window.__forgeDimChains` (a small
// frozen record with the points + chain entries) so Archie / plugins /
// the e2e spec can drive the math headlessly. A bus event
// `forge:dim-chain-generated` is fired so subscribers (e.g. drawings
// HLR overlay, Archie thread) can react.
//
// Hard constraints honoured:
//   * NO new npm packages, NO new C++ libs.
//   * Real kernel calls only — the three resolvers reuse the PUSH-67
//     `selectionToPoint` helper verbatim so face / edge / body all use
//     the same kernel surfaces and the same midpoint walk for arcs.
//   * Reachable through the `tools.dimChains` menu action (Tools menu).
//   * Multi-cam e2e mandatory (push-90-dim-chains.spec.js covers 5
//     named camera angles per the Forge-171 mandate).
//   * Panel reads window.__forgeSelection on each forge:selection-changed
//     and never mutates other panels' globals.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { selectionToPoint } from './MeasureToolPanel.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_DIM_CHAIN_EVENT   = 'forge:dim-chain-generated';
export const FORGE_DIM_CHAIN_GLOBAL  = '__forgeDimChains';
export const CHAIN_TYPES = ['ordinate', 'baseline', 'chain'];

// ─────────────────────────────────────────────────────────────────────
// Pure math helpers — exported so the e2e specs / Archie tool calls /
// plugins can drive the chain generator without mounting the panel.

/** Euclidean distance between two 3-vectors. */
export function dist3(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return NaN;
  if (a.length < 3 || b.length < 3) return NaN;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Build an **ordinate** chain — every picked point reported as a
 *  signed `(x, y, z)` triple referenced to `points[0]` (the origin),
 *  plus a scalar magnitude that the panel exposes in the value column.
 *
 *  Returns an empty array when there are fewer than 2 points (a chain
 *  with only the origin has no entries). The origin row is the first
 *  entry with `dx=dy=dz=0` so the table renders a complete sequence.
 */
export function ordinateChain(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const o = points[0];
  const entries = [];
  for (let i = 0; i < points.length; ++i) {
    const p = points[i];
    if (!Array.isArray(p) || p.length < 3) continue;
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    entries.push({
      index: i,
      label: i === 0 ? 'Origin' : `P${i}`,
      dx, dy, dz,
      x: p[0], y: p[1], z: p[2],
      value: Math.sqrt(dx * dx + dy * dy + dz * dz),
      fromPt: 'Origin',
      toPt:   `P${i}`,
    });
  }
  return entries;
}

/** Build a **baseline** chain — every dimension is `P0 → P_i` for i ≥ 1.
 *  Returns an empty array when there are fewer than 2 points. */
export function baselineChain(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const o = points[0];
  const entries = [];
  for (let i = 1; i < points.length; ++i) {
    const p = points[i];
    if (!Array.isArray(p) || p.length < 3) continue;
    const value = dist3(o, p);
    entries.push({
      index:  i,
      label:  `B${i}`,
      value,
      fromPt: 'P0',
      toPt:   `P${i}`,
      dx: p[0] - o[0], dy: p[1] - o[1], dz: p[2] - o[2],
    });
  }
  return entries;
}

/** Build a **chain** dimension — incremental `P_(i-1) → P_i`. Returns
 *  an empty array when there are fewer than 2 points. */
export function incrementalChain(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const entries = [];
  for (let i = 1; i < points.length; ++i) {
    const prev = points[i - 1], p = points[i];
    if (!Array.isArray(prev) || !Array.isArray(p)) continue;
    if (prev.length < 3 || p.length < 3) continue;
    const value = dist3(prev, p);
    entries.push({
      index:  i,
      label:  `C${i}`,
      value,
      fromPt: `P${i - 1}`,
      toPt:   `P${i}`,
      dx: p[0] - prev[0], dy: p[1] - prev[1], dz: p[2] - prev[2],
    });
  }
  return entries;
}

/** Single entry point — pick the right generator for `type`. */
export function generateChain(points, type) {
  if (type === 'ordinate') return ordinateChain(points);
  if (type === 'baseline') return baselineChain(points);
  if (type === 'chain')    return incrementalChain(points);
  return [];
}

/** Sort an entries array in-place (returns a new array) by the column key.
 *  Numeric columns sort numerically; string columns lexicographically. */
export function sortEntries(entries, column, direction) {
  if (!Array.isArray(entries)) return [];
  const dir = direction === 'desc' ? -1 : 1;
  const copy = entries.slice();
  copy.sort((a, b) => {
    const av = a?.[column], bv = b?.[column];
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    }
    const as = String(av ?? '');
    const bs = String(bv ?? '');
    if (as < bs) return -1 * dir;
    if (as > bs) return  1 * dir;
    return 0;
  });
  return copy;
}

/** Publish a snapshot of the current chain to the global window mirror +
 *  fire the bus event so Archie / drawings overlays can subscribe. */
export function publishChain(snapshot) {
  if (typeof window === 'undefined') return null;
  // Freeze the public surface so subscribers can't mutate it accidentally.
  const out = Object.freeze({
    type:    snapshot?.type    || null,
    points:  Array.isArray(snapshot?.points)  ? snapshot.points.slice()  : [],
    entries: Array.isArray(snapshot?.entries) ? snapshot.entries.slice() : [],
    at:      Date.now(),
  });
  window[FORGE_DIM_CHAIN_GLOBAL] = out;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_DIM_CHAIN_EVENT, { detail: out }));
  } catch { /* CustomEvent unavailable in test runners — non-fatal. */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Styles

const PANEL = {
  position: 'fixed',
  right:  'var(--forge-space-3, 12px)',
  top:    'calc(var(--forge-titlebar-h, 24px) + var(--forge-ribbon-h, 80px) + var(--forge-space-3, 12px))',
  width: 400,
  zIndex: 1310,
  background: 'var(--forge-canvas-2, #1a1d24)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 'var(--forge-radius, 6px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  maxHeight: '75vh', overflowY: 'auto',
};
const HEADER = {
  display: 'flex', alignItems: 'center', gap: 8,
  marginBottom: 4,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 12,
};
const CAPTURE_BTN = (armed) => ({
  width: '100%',
  padding: '8px 10px',
  background: armed ? 'var(--forge-accent, #2c75ff)' : 'var(--forge-canvas, #11141a)',
  color: armed ? '#fff' : 'var(--forge-ink, #dadde2)',
  border: '1px solid ' + (armed ? 'var(--forge-accent, #2c75ff)' : 'var(--forge-rail-edge, #2a2d34)'),
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: armed ? 600 : 400,
  textAlign: 'left',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12,
});
const SMALL_BTN = (disabled) => ({
  background: 'var(--forge-canvas, #11141a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)' : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '4px 8px',
  borderRadius: 3,
  fontSize: 11,
  opacity: disabled ? 0.55 : 1,
});
const PRIMARY_BTN = (disabled) => ({
  background: disabled ? 'var(--forge-canvas, #11141a)' : 'var(--forge-accent, #2c75ff)',
  border: '1px solid ' + (disabled ? 'var(--forge-rail-edge, #2a2d34)' : 'var(--forge-accent, #2c75ff)'),
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)' : '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 600,
  opacity: disabled ? 0.55 : 1,
});
const RADIO_ROW = {
  display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
  fontSize: 11, fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const POINTS_LIST = {
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: 4,
  maxHeight: 120,
  overflowY: 'auto',
  background: 'var(--forge-canvas, #11141a)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
};
const POINT_ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '2px 4px',
  borderBottom: '1px solid var(--forge-rail-edge-soft, #1f2229)',
};
const POINT_X = {
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
  width: 16,
};
const TABLE = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
};
const TH = (sortable) => ({
  textAlign: 'left',
  padding: '4px 6px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: sortable ? 'pointer' : 'default',
  userSelect: 'none',
  fontWeight: 500,
});
const TD = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--forge-rail-edge-soft, #1f2229)',
};
const ERROR_LINE = {
  color: 'var(--forge-bad, #ff6363)',
  fontSize: 11,
};
const MUTED_LINE = {
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontSize: 11,
  lineHeight: 1.4,
};

function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
function fmtVec(v, digits = 3) {
  if (!Array.isArray(v) || v.length < 3) return '—';
  return `(${fmt(v[0], digits)}, ${fmt(v[1], digits)}, ${fmt(v[2], digits)})`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI

export function DimensionChainsPanel({ open, onClose }) {
  // Captured points. Each entry = { point:[x,y,z], label, kind }.
  const [points, setPoints] = useState([]);
  // Chain type radio selection.
  const [chainType, setChainType] = useState('ordinate');
  // Whether "Add Point" is currently armed (next selection captures).
  const [armed, setArmed] = useState(false);
  // Generated entries (cleared whenever the points list changes).
  const [entries, setEntries] = useState([]);
  // Per-column sort state.
  const [sortColumn, setSortColumn] = useState('index');
  const [sortDirection, setSortDirection] = useState('asc');
  // Last error from a failed selection-to-point resolve.
  const [lastError, setLastError] = useState(null);

  // Reset everything (also fired when the panel is opened).
  const resetAll = useCallback(() => {
    setPoints([]);
    setEntries([]);
    setArmed(false);
    setLastError(null);
  }, []);

  // Initialise the panel state every time it opens so the user starts
  // from a known empty chain.
  useEffect(() => {
    if (!open) return undefined;
    resetAll();
    return undefined;
  }, [open, resetAll]);

  // Selection-event handler — capture the live point when armed.
  const captureArmed = useCallback(() => {
    if (!armed) return;
    if (typeof window === 'undefined') return;
    const sel = window.__forgeSelection;
    const r = selectionToPoint(sel);
    if (r.error || !Array.isArray(r.point)) {
      setLastError(r.error || 'no point');
      return;
    }
    setLastError(null);
    setPoints((prev) => prev.concat([{
      point: r.point.slice(),
      label: r.label,
      kind:  r.kind,
    }]));
    // Invalidate any previously generated table — points changed.
    setEntries([]);
    setArmed(false);
  }, [armed]);

  // Subscribe to the selection bus while the panel is open.
  useEffect(() => {
    if (!open) return undefined;
    const onPick = () => captureArmed();
    window.addEventListener('forge:selection-changed', onPick);
    return () => window.removeEventListener('forge:selection-changed', onPick);
  }, [open, captureArmed]);

  // When the panel closes, drop the arm — otherwise the next selection
  // event in a different surface would silently push a stale point.
  useEffect(() => {
    if (!open) setArmed(false);
  }, [open]);

  // Remove a point from the captured list (also invalidates entries).
  const removePoint = useCallback((idx) => {
    setPoints((prev) => prev.filter((_, i) => i !== idx));
    setEntries([]);
  }, []);

  // Generate the chain — runs the right generator for the radio
  // selection, replaces the entries state, and publishes to the
  // global mirror + bus event.
  const generate = useCallback(() => {
    const raw = points.map((p) => p.point);
    const out = generateChain(raw, chainType);
    setEntries(out);
    publishChain({ type: chainType, points: raw, entries: out });
  }, [points, chainType]);

  const canGenerate = points.length >= 3;

  // Sorted view of the entries for the table.
  const sortedEntries = useMemo(() => {
    return sortEntries(entries, sortColumn, sortDirection);
  }, [entries, sortColumn, sortDirection]);

  const clickHeader = useCallback((column) => {
    setSortColumn((prev) => {
      if (prev === column) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection('asc');
      return column;
    });
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const sortIndicator = (col) => {
    if (sortColumn !== col) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  return createPortal(
    <div role="dialog"
         aria-label="Dimension chains panel"
         data-testid="forge-dim-chains-panel"
         data-point-count={points.length}
         data-chain-type={chainType}
         data-entry-count={entries.length}
         style={PANEL}>
      <header style={HEADER}>
        <strong style={{ fontSize: 13 }}>Dimension Chains</strong>
        <span style={{
          fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          Ordinate · Baseline · Chain
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close dimension chains panel"
                data-testid="forge-dim-chains-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={MUTED_LINE}>
        Press <em>Add Point</em>, then click a face / edge / body in the viewport.
        The next selection becomes the next chain point. Pick 3 or more, choose a
        chain type, then Generate.
      </div>

      {/* ── point capture ─────────────────────────────────────── */}

      <button type="button"
              data-testid="forge-dim-chains-add-point"
              data-armed={armed ? 'true' : 'false'}
              style={CAPTURE_BTN(armed)}
              onClick={() => setArmed((a) => !a)}>
        {armed ? '→ Pick next point …' : `Add Point (${points.length} captured)`}
      </button>

      {/* ── captured points list ──────────────────────────────── */}

      <div data-testid="forge-dim-chains-points-list"
           data-count={points.length}
           style={POINTS_LIST}>
        {points.length === 0 ? (
          <div style={{ ...MUTED_LINE, padding: 4 }}>
            No points captured yet.
          </div>
        ) : points.map((p, i) => (
          <div key={i}
               data-testid={`forge-dim-chains-point-${i}`}
               data-point-x={p.point[0]}
               data-point-y={p.point[1]}
               data-point-z={p.point[2]}
               style={POINT_ROW}>
            <button type="button"
                    aria-label={`Remove point ${i}`}
                    data-testid={`forge-dim-chains-remove-${i}`}
                    onClick={() => removePoint(i)}
                    style={POINT_X}>×</button>
            <span style={{
              minWidth: 24,
              color: 'var(--forge-ink-mute, #9aa1ab)',
            }}>P{i}</span>
            <span style={{ flex: 1 }}>{fmtVec(p.point)}</span>
            <span style={{
              color: 'var(--forge-ink-mute, #9aa1ab)',
              fontSize: 9,
            }}>{p.kind || '—'}</span>
          </div>
        ))}
      </div>

      {/* ── chain type radio ──────────────────────────────────── */}

      <div style={RADIO_ROW} data-testid="forge-dim-chains-type-radio">
        {CHAIN_TYPES.map((t) => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio"
                   name="forge-dim-chains-type"
                   value={t}
                   checked={chainType === t}
                   onChange={() => { setChainType(t); setEntries([]); }}
                   data-testid={`forge-dim-chains-type-${t}`} />
            <span style={{ textTransform: 'capitalize' }}>{t}</span>
          </label>
        ))}
      </div>

      {/* ── generate / reset row ──────────────────────────────── */}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button"
                data-testid="forge-dim-chains-generate"
                disabled={!canGenerate}
                onClick={generate}
                style={PRIMARY_BTN(!canGenerate)}>
          Generate
        </button>
        <button type="button"
                data-testid="forge-dim-chains-reset"
                disabled={points.length === 0 && entries.length === 0}
                onClick={resetAll}
                style={SMALL_BTN(points.length === 0 && entries.length === 0)}>
          Reset
        </button>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {points.length} pts · {entries.length} dims
        </span>
      </div>

      {/* ── error + table ─────────────────────────────────────── */}

      {lastError && (
        <div data-testid="forge-dim-chains-error" style={ERROR_LINE}>
          {lastError}
        </div>
      )}

      {entries.length > 0 && (
        <table data-testid="forge-dim-chains-table" style={TABLE}>
          <thead>
            <tr>
              <th style={TH(true)}
                  data-testid="forge-dim-chains-th-label"
                  onClick={() => clickHeader('label')}>
                Label{sortIndicator('label')}
              </th>
              <th style={TH(true)}
                  data-testid="forge-dim-chains-th-value"
                  onClick={() => clickHeader('value')}>
                Value (mm){sortIndicator('value')}
              </th>
              <th style={TH(true)}
                  data-testid="forge-dim-chains-th-from"
                  onClick={() => clickHeader('fromPt')}>
                From{sortIndicator('fromPt')}
              </th>
              <th style={TH(true)}
                  data-testid="forge-dim-chains-th-to"
                  onClick={() => clickHeader('toPt')}>
                To{sortIndicator('toPt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((e) => (
              <tr key={e.index}
                  data-testid={`forge-dim-chains-row-${e.index}`}
                  data-label={e.label}
                  data-value-mm={Number.isFinite(e.value) ? e.value : ''}
                  data-from={e.fromPt}
                  data-to={e.toPt}>
                <td style={TD}>{e.label}</td>
                <td style={TD}>{fmt(e.value)}</td>
                <td style={TD}>{e.fromPt}</td>
                <td style={TD}>{e.toPt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.dimChains` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the headless helpers on a window debug mirror so the e2e
// can verify the math without mounting the React tree.

export function DimensionChainsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDimChainsPanel  = () => setOpen(true);
    window.__forgeCloseDimChainsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.dimChains') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Headless helper surface for plugins / Archie tool calls / e2e.
    window.__forgeDimChainsHelper = Object.freeze({
      ordinateChain,
      baselineChain,
      incrementalChain,
      generateChain,
      sortEntries,
      publishChain,
      dist3,
      CHAIN_TYPES,
      EVENT_NAME: FORGE_DIM_CHAIN_EVENT,
      GLOBAL_NAME: FORGE_DIM_CHAIN_GLOBAL,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDimChainsPanel; } catch {}
      try { delete window.__forgeCloseDimChainsPanel; } catch {}
    };
  }, []);
  return <DimensionChainsPanel open={open} onClose={() => setOpen(false)} />;
}

export default DimensionChainsPanel;
