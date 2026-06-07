// PUSH-122 (Slice-90) — Sweep along Curve panel.
//
// Take a 2D circular profile (radius input) and sweep it along a 3D path
// curve defined as a list of (x,y,z) points. The kernel op is
// forge.part.pipeFromPolyline(flatXYZ, radius) — the same primitive PUSH-45
// piperoute and PUSH-97 batch routing use under the hood, exposed here as
// a first-class generic Sweep tool.
//
// What this panel ships:
//   * Profile section: a single "radius (mm)" input. The panel auto-builds
//     the circular profile inside pipeFromPolyline — the user only needs
//     to pick the radius.
//   * Path section: a table of (x, y, z) rows defining the spine of the
//     sweep. Add / Remove per row, Reset to preset. Default preset is a
//     four-point bent path (0,0,0) → (30,0,0) → (30,20,0) → (30,20,15)
//     that demonstrates two elbows so the sweep visually rounds two
//     corners.
//   * Apply → calls window.forge.part.pipeFromPolyline directly with a
//     flat Float64Array [x0,y0,z0,x1,y1,z1,…] + the radius. The returned
//     OCCT solid handle is committed to the live scene as a native body
//     via window.__forgeAppendBody. Mass props are read off the kernel
//     and surfaced in the log.
//   * window.__forgeSweepCurveHelper exposes the headless pipeline so
//     plugin code, Archie, and the e2e can drive Apply without React.
//   * Bus event forge:sweep-curve-built fires every successful Apply so
//     downstream listeners (ActivityLog, e2e harness, etc.) can react.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external dependencies. Pure React + the kernel
//     primitive that already ships.
//   * Multi-cam e2e: push-122-sweep-curve.spec.js captures 5 named camera
//     angles per the Forge-171 mandate.
//   * Surgical edits: ONE new menu entry (Menus.jsx) + ONE new mount
//     (App.jsx). The kernel binding is untouched.
//   * Manual UI clicks NEVER post to Archie's thread or auto-open the
//     dock (Forge feedback rule).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus + persistence + defaults.

export const FORGE_SWEEP_CURVE_EVENT   = 'forge:sweep-curve-built';
export const FORGE_SWEEP_CURVE_STORAGE = 'forge.v4.sweepCurve';

export const DEFAULT_RADIUS_MM = 2.5;
export const MIN_RADIUS_MM     = 0.1;
export const MAX_RADIUS_MM     = 100;
export const MIN_PATH_POINTS   = 2;

// A four-point bent path with two elbows — the sweep wraps two corners
// so the resulting tube is unambiguously a real 3D sweep (not a straight
// cylinder). Coordinates in millimetres.
export const DEFAULT_PATH = Object.freeze([
  Object.freeze({ x:  0, y:  0, z:  0 }),
  Object.freeze({ x: 30, y:  0, z:  0 }),
  Object.freeze({ x: 30, y: 20, z:  0 }),
  Object.freeze({ x: 30, y: 20, z: 15 }),
]);

// ─────────────────────────────────────────────────────────────────────
// Headless helpers — exported so e2e + Archie tool calls + plugins can
// drive the pipeline without mounting React.

/** Coerce an arbitrary input into a finite mm number, clamped to the
 *  panel's allowable radius range. Returns NaN for non-finite input so
 *  the caller can refuse Apply. */
export function sanitiseRadius(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(MIN_RADIUS_MM, Math.min(MAX_RADIUS_MM, n));
}

/** Normalise the path array: drop non-finite rows, coerce to numbers,
 *  and drop adjacent duplicates (pipeFromPolyline divides by segment
 *  length and barfs on zero-length segments). */
export function normalisePath(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const x = Number(r.x), y = Number(r.y), z = Number(r.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (out.length > 0) {
      const p = out[out.length - 1];
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      if ((dx*dx + dy*dy + dz*dz) < 1e-12) continue;
    }
    out.push({ x, y, z });
  }
  return out;
}

/** Flatten {x,y,z}[] → Float64Array [x0,y0,z0,x1,y1,z1,…] in mm. */
export function flattenPath(rows) {
  const flat = new Float64Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    flat[i*3    ] = rows[i].x;
    flat[i*3 + 1] = rows[i].y;
    flat[i*3 + 2] = rows[i].z;
  }
  return flat;
}

/** Approx total length of the polyline, mm. */
export function pathLength(rows) {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i-1], b = rows[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    total += Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  return total;
}

/** Drive the kernel sweep + commit the body. Returns:
 *    { ok, handle, body, length, volume, reason, message, sane, radius }
 *  ok===false on every failure path — never throws so the panel button
 *  can render a friendly log entry. */
export function runSweepCurvePipeline({
  radius = DEFAULT_RADIUS_MM,
  path   = DEFAULT_PATH,
  name,
} = {}) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no window', sane: [], radius };
  }
  const f = window.forge;
  if (!f || !f.part || typeof f.part.pipeFromPolyline !== 'function') {
    return { ok: false, reason: 'forge.part.pipeFromPolyline not available',
             sane: [], radius };
  }
  const r = sanitiseRadius(radius);
  if (!Number.isFinite(r)) {
    return { ok: false, reason: 'radius is not a finite number',
             sane: [], radius };
  }
  const sane = normalisePath(path);
  if (sane.length < MIN_PATH_POINTS) {
    return { ok: false, reason: `need at least ${MIN_PATH_POINTS} unique path points`,
             sane, radius: r };
  }
  const flat = flattenPath(sane);
  let handle;
  try {
    handle = f.part.pipeFromPolyline(flat, r);
  } catch (err) {
    return { ok: false, reason: 'pipeFromPolyline threw',
             message: err && err.message ? err.message : String(err),
             sane, radius: r };
  }
  if (typeof handle !== 'number' || !Number.isFinite(handle) || handle <= 0) {
    return { ok: false, reason: 'pipeFromPolyline returned no handle',
             message: String(handle), sane, radius: r };
  }

  // Pull mass props off the kernel so we can surface the swept volume.
  let volume = 0;
  try {
    if (typeof f.massProps === 'function') {
      const mp = f.massProps(handle);
      if (mp && Number.isFinite(mp.volume)) volume = Math.abs(mp.volume);
    }
  } catch { /* fail soft — volume is a courtesy display */ }

  const length = pathLength(sane);

  // Commit to the live scene.
  const ts = Date.now();
  const id = `sweep-curve-${ts}`;
  const body = {
    id, kind: 'native', handle,
    toolId: 'part.sweepCurve',
    name: name || `Sweep (Ø${(r*2).toFixed(2)}mm · ${sane.length} pts)`,
    params: {
      radius: r,
      pathPoints: sane.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      length, volume,
    },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }

  // Window mirror so e2e / plugins / Archie can read the last build
  // without scraping the DOM or waiting for the next React render.
  try {
    window.__forgeSweepCurve = {
      handle, bodyId: id, radius: r,
      pathPoints: sane.slice(), length, volume, ts,
    };
  } catch { /* defensive */ }

  // Dispatch the bus event. Failure-soft so a missing window.dispatchEvent
  // (SSR / non-browser) does not break the panel.
  try {
    window.dispatchEvent(new CustomEvent(FORGE_SWEEP_CURVE_EVENT, {
      detail: {
        handle, bodyId: id, radius: r,
        pointCount: sane.length, length, volume, ts,
      },
    }));
  } catch { /* fail soft */ }

  return { ok: true, handle, body, length, volume, sane, radius: r };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — identical pattern to LoftSectionsPanel,
// SurfaceOffsetPanel, ClassABlendPanel. Helper is live the moment this
// module is imported so window.__forgeSweepCurveHelper.runSweepCurvePipeline
// is callable BEFORE the user opens the panel.

if (typeof window !== 'undefined') {
  try {
    window.__forgeSweepCurveHelper = Object.freeze({
      sanitiseRadius,
      normalisePath,
      flattenPath,
      pathLength,
      runSweepCurvePipeline,
      DEFAULT_RADIUS_MM,
      MIN_RADIUS_MM,
      MAX_RADIUS_MM,
      MIN_PATH_POINTS,
      DEFAULT_PATH: DEFAULT_PATH.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      EVENT_NAME:   FORGE_SWEEP_CURVE_EVENT,
      STORAGE_KEY:  FORGE_SWEEP_CURVE_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.sweepCurve') {
        window.__forgeSweepCurveLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching LoftSectionsPanel / SurfaceOffsetPanel.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1333,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const PROFILE_ROW = {
  display: 'grid', gridTemplateColumns: '140px 1fr',
  alignItems: 'center', gap: 8,
};
const TABLE_HEADER_ROW = {
  display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 32px',
  alignItems: 'center', gap: 6,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TABLE_ROW = {
  display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 32px',
  alignItems: 'center', gap: 6,
  padding: '4px 2px', borderRadius: 3,
};
const INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 3, fontSize: 11,
};
const TABLE_ROW_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ACTION_ROW = { display: 'flex', gap: 6, alignItems: 'center' };
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

function clonePresetPath() {
  return DEFAULT_PATH.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

export function SweepCurvePanel({ open, onClose }) {
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_MM));
  const [pathRows, setPathRows] = useState(clonePresetPath);
  const [log, setLog] = useState([]);
  const lastHandleRef = useRef(null);

  // Reset to the preset every time the panel opens so the e2e assertion
  // "click Apply with defaults" is deterministic.
  useEffect(() => {
    if (!open) return;
    setRadius(String(DEFAULT_RADIUS_MM));
    setPathRows(clonePresetPath());
    setLog([]);
  }, [open]);

  const onRadiusChange = useCallback((value) => {
    setRadius(value);
  }, []);

  const onPathFieldChange = useCallback((idx, field, value) => {
    setPathRows((prev) => prev.map((row, i) =>
      i === idx ? { ...row, [field]: Number(value) } : row));
  }, []);

  const onAddPathRow = useCallback(() => {
    setPathRows((prev) => {
      // New row inherits the last row's coords + a 10 mm bump along z
      // so it lands somewhere visible and the new segment is non-zero.
      const last = prev[prev.length - 1] || { x: 0, y: 0, z: 0 };
      const next = [...prev, { x: last.x, y: last.y, z: last.z + 10 }];
      return next;
    });
  }, []);

  const onRemovePathRow = useCallback((idx) => {
    setPathRows((prev) => {
      if (prev.length <= MIN_PATH_POINTS) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onResetToPreset = useCallback(() => {
    setRadius(String(DEFAULT_RADIUS_MM));
    setPathRows(clonePresetPath());
  }, []);

  const sane = useMemo(() => normalisePath(pathRows), [pathRows]);
  const sanitisedRadius = useMemo(() => sanitiseRadius(radius), [radius]);
  const canApply = sane.length >= MIN_PATH_POINTS
    && Number.isFinite(sanitisedRadius);
  const previewLen = useMemo(() => pathLength(sane), [sane]);

  const onApply = useCallback(() => {
    const r = runSweepCurvePipeline({ radius, path: pathRows });
    if (r.ok) lastHandleRef.current = r.handle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Swept Ø${(r.radius*2).toFixed(2)}mm along ${r.sane.length} pts (length ${r.length.toFixed(1)}mm, volume ${r.volume.toFixed(1)}mm³) → handle ${r.handle}`
          : `Apply failed: ${r.reason}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [radius, pathRows]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Sweep along curve"
         data-testid="forge-sweep-curve-panel"
         data-radius={String(sanitisedRadius)}
         data-point-count={sane.length}
         data-last-handle={lastHandleRef.current == null ? '' : String(lastHandleRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.sweep" size={14} />
        <strong style={{ fontSize: 13 }}>Sweep along Curve</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          OCCT pipe sweep
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Sweep along Curve panel"
                data-testid="forge-sweep-curve-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Sweep a circular profile of the given radius along a 3D polyline
        path. Uses forge.part.pipeFromPolyline (OCCT BRepOffsetAPI_MakePipe
        on a circle profile + polyline spine). Commits a watertight solid
        body to the active scene.
      </div>

      <div style={SECTION_TITLE}>Profile (auto-generated circle)</div>
      <div style={SECTION_BOX}>
        <div style={PROFILE_ROW}>
          <label htmlFor="forge-sweep-curve-radius"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)' }}>
            Radius (mm)
          </label>
          <input id="forge-sweep-curve-radius"
                 type="number"
                 step="0.1"
                 min={MIN_RADIUS_MM}
                 max={MAX_RADIUS_MM}
                 value={radius}
                 onChange={(e) => onRadiusChange(e.target.value)}
                 data-testid="forge-sweep-curve-radius"
                 style={INPUT_STYLE} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Ø ${(sanitisedRadius || 0).toFixed(3) * 2}mm circle · clamped to ${MIN_RADIUS_MM}..${MAX_RADIUS_MM}mm`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Path (x, y, z) points</div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>x (mm)</span>
          <span>y (mm)</span>
          <span>z (mm)</span>
          <span></span>
        </div>
        <div data-testid="forge-sweep-curve-table"
             data-row-count={pathRows.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 200, overflowY: 'auto' }}>
          {pathRows.map((row, idx) => (
            <div key={idx}
                 data-testid={`forge-sweep-curve-row-${idx}`}
                 style={TABLE_ROW}>
              <span style={TABLE_ROW_LABEL}>{idx + 1}</span>
              <input type="number" step="0.1"
                     value={row.x}
                     onChange={(e) => onPathFieldChange(idx, 'x', e.target.value)}
                     data-testid={`forge-sweep-curve-x-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.1"
                     value={row.y}
                     onChange={(e) => onPathFieldChange(idx, 'y', e.target.value)}
                     data-testid={`forge-sweep-curve-y-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.1"
                     value={row.z}
                     onChange={(e) => onPathFieldChange(idx, 'z', e.target.value)}
                     data-testid={`forge-sweep-curve-z-${idx}`}
                     style={INPUT_STYLE} />
              <button type="button"
                      onClick={() => onRemovePathRow(idx)}
                      data-testid={`forge-sweep-curve-remove-${idx}`}
                      aria-label={`Remove point ${idx + 1}`}
                      disabled={pathRows.length <= MIN_PATH_POINTS}
                      style={{
                        ...SMALL_BTN,
                        opacity: pathRows.length <= MIN_PATH_POINTS ? 0.4 : 1,
                        cursor: pathRows.length <= MIN_PATH_POINTS
                                ? 'not-allowed' : 'pointer',
                      }}>−</button>
            </div>
          ))}
        </div>
        <div style={ACTION_ROW}>
          <button type="button"
                  onClick={onAddPathRow}
                  data-testid="forge-sweep-curve-add"
                  style={SMALL_BTN}>+ Add point</button>
          <button type="button"
                  onClick={onResetToPreset}
                  data-testid="forge-sweep-curve-reset"
                  style={SMALL_BTN}>Reset to preset</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}
                data-testid="forge-sweep-curve-summary">
            {sane.length} unique · length {previewLen.toFixed(1)}mm
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-sweep-curve-apply"
                style={ACTION_BTN('primary', !canApply)}>
          Apply — Sweep profile along path
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Calls forge.part.pipeFromPolyline(flatXYZ, ${Number.isFinite(sanitisedRadius) ? sanitisedRadius.toFixed(3) : '—'} mm)`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-sweep-curve-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no sweeps yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.sweepCurve` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function SweepCurvePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSweepCurve  = () => setOpen(true);
    window.__forgeCloseSweepCurve = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sweepCurve') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSweepCurve; } catch {}
      try { delete window.__forgeCloseSweepCurve; } catch {}
    };
  }, []);
  if (!open) return null;
  return <SweepCurvePanel open={open} onClose={() => setOpen(false)} />;
}

export default SweepCurvePanel;
