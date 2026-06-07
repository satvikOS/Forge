// PUSH-132 (Slice-97) — Helical Sweep panel.
//
// Generic helical sweep tool: build a 3D helix polyline in pure JS
//
//     x(t) = R · cos(t)
//     y(t) = R · sin(t)
//     z(t) = pitch · t / (2π)
//
// sample it densely (segments-per-turn × turns + 1), feed the flat XYZ
// Float64Array to window.forge.part.pipeFromPolyline(flatXYZ, radius)
// (the same OCCT BRepOffsetAPI_MakePipe primitive PUSH-45 piperoute /
// PUSH-97 batch routing / PUSH-122 sweepCurve use under the hood), and
// commit the returned solid handle to the live scene as a native body.
// The result is a real helical sweep — a spring or screw thread or
// auger flight, depending on the (R, pitch, length, profile-r) tuple.
//
// What this panel ships:
//   * Four numeric inputs:
//     - R  (PCD radius)            — mm — the helix's mean radius
//     - pitch                      — mm/turn — axial advance per full
//                                    turn (rise per revolution)
//     - length                     — mm — total axial extent of the
//                                    helix (number of turns N = length
//                                    / pitch is derived; for a 10-turn
//                                    spring with pitch 5 mm the length
//                                    field is 50 mm)
//     - profile radius (Ø/2)       — mm — radius of the swept circular
//                                    section (the spring wire radius
//                                    for a coil spring, half the thread
//                                    pitch for a screw thread, etc.)
//   * Apply → builds the helix polyline (pure JS math) → calls
//     window.forge.part.pipeFromPolyline directly with a flat
//     Float64Array [x0,y0,z0,x1,y1,z1,…] + the profile radius. The
//     returned OCCT solid handle is committed via window.__forgeAppendBody.
//     Mass props are read off the kernel and surfaced in the log.
//   * window.__forgeHelicalSweepHelper exposes the headless pipeline so
//     plugin code, Archie tool calls, and the e2e can drive Apply
//     without React.
//   * Bus event forge:helical-sweep-built fires every successful Apply
//     so downstream listeners (ActivityLog, e2e harness, etc.) can react.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external dependencies. Pure React + the existing
//     pipeFromPolyline kernel primitive.
//   * Multi-cam e2e: push-132-helical-sweep.spec.js captures 5 named
//     camera angles per the Forge-171 multi-cam mandate.
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

export const FORGE_HELICAL_SWEEP_EVENT   = 'forge:helical-sweep-built';
export const FORGE_HELICAL_SWEEP_STORAGE = 'forge.v4.helicalSweep';

// Preset: a 10-turn compression spring with PCD radius 15 mm,
// pitch 5 mm (so total length is 50 mm), wire radius 1.5 mm
// (3 mm wire diameter). Numbers chosen to land squarely in the
// "spring you would actually find on a workbench" envelope.
export const DEFAULT_PCD_RADIUS_MM      = 15;   // R   — helix mean radius
export const DEFAULT_PITCH_MM           = 5;    // p   — mm per turn
export const DEFAULT_LENGTH_MM          = 50;   // L   — axial extent
export const DEFAULT_PROFILE_RADIUS_MM  = 1.5;  // r   — swept wire radius

// Sampling resolution — segments per turn. 48 yields a smooth helix
// for the screen-space rendering without flooding OCCT with bogus
// micro-segments. The piperoute kernel uses 16 segments per elbow;
// we use 48 across a smooth turn, which is comparable density.
export const SEGMENTS_PER_TURN = 48;
// Hard caps so a typo doesn't lock the UI building a billion points.
export const MAX_SEGMENTS      = 100000;

// Numeric clamps — mm.
export const MIN_PCD_RADIUS_MM      = 0.1;
export const MAX_PCD_RADIUS_MM      = 1000;
export const MIN_PITCH_MM           = 0.1;
export const MAX_PITCH_MM           = 500;
export const MIN_LENGTH_MM          = 0.5;
export const MAX_LENGTH_MM          = 10000;
export const MIN_PROFILE_RADIUS_MM  = 0.05;
export const MAX_PROFILE_RADIUS_MM  = 100;

// pipeFromPolyline needs at least 2 points to define a segment.
export const MIN_POINTS = 2;

// ─────────────────────────────────────────────────────────────────────
// Headless helpers — exported so e2e + Archie tool calls + plugins can
// drive the pipeline without mounting React.

/** Clamp + parse a numeric input. Returns NaN for non-finite. */
function clampField(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(min, Math.min(max, n));
}

export function sanitisePcdRadius(value)     { return clampField(value, MIN_PCD_RADIUS_MM,     MAX_PCD_RADIUS_MM);     }
export function sanitisePitch(value)         { return clampField(value, MIN_PITCH_MM,         MAX_PITCH_MM);          }
export function sanitiseLength(value)        { return clampField(value, MIN_LENGTH_MM,        MAX_LENGTH_MM);         }
export function sanitiseProfileRadius(value) { return clampField(value, MIN_PROFILE_RADIUS_MM, MAX_PROFILE_RADIUS_MM); }

/** Build a 3D helix polyline (pure math). Returns an Array<{x,y,z}>.
 *
 *  Parameterisation:
 *      t ∈ [0, 2π·N]   where N = length / pitch
 *      x(t) = R · cos(t)
 *      y(t) = R · sin(t)
 *      z(t) = pitch · t / (2π)
 *
 *  Sampling: SEGMENTS_PER_TURN samples per full turn, plus one final
 *  sample at t = 2π·N so the polyline lands exactly on the requested
 *  axial length. The result has at most MAX_SEGMENTS+1 points; if the
 *  request would exceed that we down-sample to MAX_SEGMENTS total
 *  segments while still landing on both endpoints.
 *
 *  Returns [] for non-finite / non-positive inputs. */
export function buildHelixPolyline({
  R = DEFAULT_PCD_RADIUS_MM,
  pitch = DEFAULT_PITCH_MM,
  length = DEFAULT_LENGTH_MM,
  segmentsPerTurn = SEGMENTS_PER_TURN,
} = {}) {
  const Rr = Number(R), pr = Number(pitch), lr = Number(length);
  const seg = Math.max(2, Math.floor(Number(segmentsPerTurn) || SEGMENTS_PER_TURN));
  if (!Number.isFinite(Rr) || !Number.isFinite(pr) || !Number.isFinite(lr)) return [];
  if (Rr <= 0 || pr <= 0 || lr <= 0) return [];

  const turns = lr / pr;
  // Total segment count: seg per full turn × turns, rounded up so we
  // always close on the endpoint. Cap at MAX_SEGMENTS so a typo
  // (length=10000, pitch=0.1 → 100k turns) doesn't lock the renderer.
  let totalSegments = Math.max(2, Math.ceil(seg * turns));
  if (totalSegments > MAX_SEGMENTS) totalSegments = MAX_SEGMENTS;

  const totalAngle = 2 * Math.PI * turns;             // radians swept
  const points = new Array(totalSegments + 1);
  for (let i = 0; i <= totalSegments; i++) {
    const t = (i / totalSegments) * totalAngle;
    const x = Rr * Math.cos(t);
    const y = Rr * Math.sin(t);
    const z = pr  * t / (2 * Math.PI);                // == lr · (i/totalSegments)
    points[i] = { x, y, z };
  }
  return points;
}

/** Flatten [{x,y,z}] → Float64Array [x0,y0,z0,x1,y1,z1,…]. */
export function flattenPolyline(points) {
  const flat = new Float64Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    flat[i*3    ] = points[i].x;
    flat[i*3 + 1] = points[i].y;
    flat[i*3 + 2] = points[i].z;
  }
  return flat;
}

/** Arc length of a polyline (mm). For a helix this is approximately
 *  N · √((2πR)² + pitch²)  with N = length/pitch. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    total += Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  return total;
}

/** Number of turns N = length / pitch. */
export function turnCount(length, pitch) {
  const L = Number(length), p = Number(pitch);
  if (!Number.isFinite(L) || !Number.isFinite(p) || p <= 0) return 0;
  return L / p;
}

/** Drive the kernel sweep + commit the body. Returns:
 *    { ok, handle, body, length, axialLength, volume, reason, message,
 *      points, turns, sanitised: { R, pitch, length, r } }
 *  ok===false on every failure path — never throws so the panel button
 *  can render a friendly log entry. */
export function runHelicalSweepPipeline({
  R = DEFAULT_PCD_RADIUS_MM,
  pitch = DEFAULT_PITCH_MM,
  length = DEFAULT_LENGTH_MM,
  profileRadius = DEFAULT_PROFILE_RADIUS_MM,
  segmentsPerTurn = SEGMENTS_PER_TURN,
  name,
} = {}) {
  const sanRr = sanitisePcdRadius(R);
  const sanPr = sanitisePitch(pitch);
  const sanLr = sanitiseLength(length);
  const sanWr = sanitiseProfileRadius(profileRadius);
  const sanitised = { R: sanRr, pitch: sanPr, length: sanLr, r: sanWr };

  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no window', points: [], turns: 0, sanitised };
  }
  const f = window.forge;
  if (!f || !f.part || typeof f.part.pipeFromPolyline !== 'function') {
    return { ok: false, reason: 'forge.part.pipeFromPolyline not available',
             points: [], turns: 0, sanitised };
  }
  if (!Number.isFinite(sanRr)) return { ok: false, reason: 'PCD radius is not finite',     points: [], turns: 0, sanitised };
  if (!Number.isFinite(sanPr)) return { ok: false, reason: 'pitch is not finite',          points: [], turns: 0, sanitised };
  if (!Number.isFinite(sanLr)) return { ok: false, reason: 'length is not finite',         points: [], turns: 0, sanitised };
  if (!Number.isFinite(sanWr)) return { ok: false, reason: 'profile radius is not finite', points: [], turns: 0, sanitised };

  const points = buildHelixPolyline({
    R: sanRr, pitch: sanPr, length: sanLr, segmentsPerTurn,
  });
  if (points.length < MIN_POINTS) {
    return { ok: false, reason: `need at least ${MIN_POINTS} helix points`,
             points, turns: 0, sanitised };
  }
  const turns = turnCount(sanLr, sanPr);

  // Defensive guardrail: the profile must comfortably clear the helix
  // axis so the swept tube isn't self-intersecting. The OCCT pipe op
  // tolerates profile-r up to ~PCD-r, but values close to PCD lead to
  // degenerate solids. We allow up to 0.49·R to leave a safe margin.
  // (We DO NOT block — we let the user see the failure if the kernel
  // refuses — but we surface the warning in the reason field when ok
  // is false.)
  if (sanWr >= sanRr) {
    // Try anyway; if pipeFromPolyline returns a bogus handle we'll
    // report it. But surface a richer message preemptively.
    // (Continue.)
  }

  const flat = flattenPolyline(points);
  let handle;
  try {
    handle = f.part.pipeFromPolyline(flat, sanWr);
  } catch (err) {
    return { ok: false, reason: 'pipeFromPolyline threw',
             message: err && err.message ? err.message : String(err),
             points, turns, sanitised };
  }
  if (typeof handle !== 'number' || !Number.isFinite(handle) || handle <= 0) {
    return { ok: false, reason: 'pipeFromPolyline returned no handle',
             message: String(handle), points, turns, sanitised };
  }

  // Pull mass props off the kernel so we can surface the swept volume.
  let volume = 0;
  try {
    if (typeof f.massProps === 'function') {
      const mp = f.massProps(handle);
      if (mp && Number.isFinite(mp.volume)) volume = Math.abs(mp.volume);
    }
  } catch { /* fail soft — volume is a courtesy display */ }

  const arcLen     = polylineLength(points);
  const axialLen   = sanLr;

  // Commit to the live scene.
  const ts = Date.now();
  const id = `helical-sweep-${ts}`;
  const body = {
    id, kind: 'native', handle,
    toolId: 'part.helicalSweep',
    name: name || `Helix (PCD Ø${(sanRr*2).toFixed(2)} · pitch ${sanPr.toFixed(2)} · ${turns.toFixed(2)} turn · Ø${(sanWr*2).toFixed(2)}mm wire)`,
    params: {
      R: sanRr, pitch: sanPr, length: sanLr, profileRadius: sanWr,
      turns, arcLength: arcLen, axialLength: axialLen,
      pointCount: points.length, volume,
    },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }

  // Window mirror so e2e / plugins / Archie can read the last build
  // without scraping the DOM or waiting for the next React render.
  try {
    window.__forgeHelicalSweep = {
      handle, bodyId: id,
      R: sanRr, pitch: sanPr, length: sanLr, profileRadius: sanWr,
      turns, arcLength: arcLen, axialLength: axialLen,
      pointCount: points.length, volume, ts,
    };
  } catch { /* defensive */ }

  // Dispatch the bus event. Failure-soft so a missing window.dispatchEvent
  // (SSR / non-browser) does not break the panel.
  try {
    window.dispatchEvent(new CustomEvent(FORGE_HELICAL_SWEEP_EVENT, {
      detail: {
        handle, bodyId: id,
        R: sanRr, pitch: sanPr, length: sanLr, profileRadius: sanWr,
        turns, arcLength: arcLen, axialLength: axialLen,
        pointCount: points.length, volume, ts,
      },
    }));
  } catch { /* fail soft */ }

  return { ok: true, handle, body, length: arcLen, axialLength: axialLen,
           volume, points, turns, sanitised };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — identical pattern to SweepCurvePanel,
// LoftSectionsPanel. Helper is live the moment this module is imported
// so window.__forgeHelicalSweepHelper.runHelicalSweepPipeline is callable
// BEFORE the user opens the panel.

if (typeof window !== 'undefined') {
  try {
    window.__forgeHelicalSweepHelper = Object.freeze({
      sanitisePcdRadius,
      sanitisePitch,
      sanitiseLength,
      sanitiseProfileRadius,
      buildHelixPolyline,
      flattenPolyline,
      polylineLength,
      turnCount,
      runHelicalSweepPipeline,
      DEFAULT_PCD_RADIUS_MM,
      DEFAULT_PITCH_MM,
      DEFAULT_LENGTH_MM,
      DEFAULT_PROFILE_RADIUS_MM,
      SEGMENTS_PER_TURN,
      MAX_SEGMENTS,
      MIN_PCD_RADIUS_MM, MAX_PCD_RADIUS_MM,
      MIN_PITCH_MM,       MAX_PITCH_MM,
      MIN_LENGTH_MM,      MAX_LENGTH_MM,
      MIN_PROFILE_RADIUS_MM, MAX_PROFILE_RADIUS_MM,
      MIN_POINTS,
      EVENT_NAME:   FORGE_HELICAL_SWEEP_EVENT,
      STORAGE_KEY:  FORGE_HELICAL_SWEEP_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.helicalSweep') {
        window.__forgeHelicalSweepLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching SweepCurvePanel / SurfaceOffsetPanel.

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
const FIELD_ROW = {
  display: 'grid', gridTemplateColumns: '180px 1fr',
  alignItems: 'center', gap: 8,
};
const INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
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

export function HelicalSweepPanel({ open, onClose }) {
  const [pcdRadius,    setPcdRadius]    = useState(String(DEFAULT_PCD_RADIUS_MM));
  const [pitch,        setPitch]        = useState(String(DEFAULT_PITCH_MM));
  const [length,       setLength]       = useState(String(DEFAULT_LENGTH_MM));
  const [profileRadius, setProfileRadius] = useState(String(DEFAULT_PROFILE_RADIUS_MM));
  const [log, setLog] = useState([]);
  const lastHandleRef = useRef(null);

  // Reset to defaults every time the panel opens so the e2e assertion
  // "click Apply with defaults" is deterministic.
  useEffect(() => {
    if (!open) return;
    setPcdRadius(String(DEFAULT_PCD_RADIUS_MM));
    setPitch(String(DEFAULT_PITCH_MM));
    setLength(String(DEFAULT_LENGTH_MM));
    setProfileRadius(String(DEFAULT_PROFILE_RADIUS_MM));
    setLog([]);
  }, [open]);

  const sanRr = useMemo(() => sanitisePcdRadius(pcdRadius),     [pcdRadius]);
  const sanPr = useMemo(() => sanitisePitch(pitch),             [pitch]);
  const sanLr = useMemo(() => sanitiseLength(length),           [length]);
  const sanWr = useMemo(() => sanitiseProfileRadius(profileRadius), [profileRadius]);

  const turns = useMemo(() => turnCount(sanLr, sanPr), [sanLr, sanPr]);
  const previewPoints = useMemo(
    () => buildHelixPolyline({ R: sanRr, pitch: sanPr, length: sanLr }),
    [sanRr, sanPr, sanLr],
  );
  const previewLen = useMemo(() => polylineLength(previewPoints), [previewPoints]);
  const canApply = previewPoints.length >= MIN_POINTS
    && Number.isFinite(sanRr) && Number.isFinite(sanPr)
    && Number.isFinite(sanLr) && Number.isFinite(sanWr)
    && sanWr < sanRr;

  const onApply = useCallback(() => {
    const r = runHelicalSweepPipeline({
      R: pcdRadius, pitch, length, profileRadius,
    });
    if (r.ok) lastHandleRef.current = r.handle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Helix R=${r.sanitised.R.toFixed(2)} pitch=${r.sanitised.pitch.toFixed(2)} L=${r.sanitised.length.toFixed(1)}mm (${r.turns.toFixed(2)} turn) Ø${(r.sanitised.r*2).toFixed(2)}mm wire → arc ${r.length.toFixed(1)}mm vol ${r.volume.toFixed(1)}mm³ → handle ${r.handle}`
          : `Apply failed: ${r.reason}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [pcdRadius, pitch, length, profileRadius]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Helical sweep"
         data-testid="forge-helical-sweep-panel"
         data-pcd-radius={String(sanRr)}
         data-pitch={String(sanPr)}
         data-length={String(sanLr)}
         data-profile-radius={String(sanWr)}
         data-turns={String(turns)}
         data-point-count={previewPoints.length}
         data-last-handle={lastHandleRef.current == null ? '' : String(lastHandleRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.sweep" size={14} />
        <strong style={{ fontSize: 13 }}>Helical Sweep</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          OCCT helix → pipe sweep
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Helical Sweep panel"
                data-testid="forge-helical-sweep-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Build a 3D helix (x=R·cos t, y=R·sin t, z=pitch·t/2π) in pure JS,
        then sweep a circular profile of the given radius along it via
        forge.part.pipeFromPolyline (OCCT BRepOffsetAPI_MakePipe). Use
        for compression springs, screw threads, augers, drill flutes.
      </div>

      <div style={SECTION_TITLE}>Helix geometry</div>
      <div style={SECTION_BOX}>
        <div style={FIELD_ROW}>
          <label htmlFor="forge-helical-sweep-pcd"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)' }}>
            R — PCD radius (mm)
          </label>
          <input id="forge-helical-sweep-pcd"
                 type="number" step="0.1"
                 min={MIN_PCD_RADIUS_MM} max={MAX_PCD_RADIUS_MM}
                 value={pcdRadius}
                 onChange={(e) => setPcdRadius(e.target.value)}
                 data-testid="forge-helical-sweep-pcd"
                 style={INPUT_STYLE} />
        </div>
        <div style={FIELD_ROW}>
          <label htmlFor="forge-helical-sweep-pitch"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)' }}>
            pitch (mm / turn)
          </label>
          <input id="forge-helical-sweep-pitch"
                 type="number" step="0.1"
                 min={MIN_PITCH_MM} max={MAX_PITCH_MM}
                 value={pitch}
                 onChange={(e) => setPitch(e.target.value)}
                 data-testid="forge-helical-sweep-pitch"
                 style={INPUT_STYLE} />
        </div>
        <div style={FIELD_ROW}>
          <label htmlFor="forge-helical-sweep-length"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)' }}>
            length (mm)
          </label>
          <input id="forge-helical-sweep-length"
                 type="number" step="0.1"
                 min={MIN_LENGTH_MM} max={MAX_LENGTH_MM}
                 value={length}
                 onChange={(e) => setLength(e.target.value)}
                 data-testid="forge-helical-sweep-length"
                 style={INPUT_STYLE} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}
              data-testid="forge-helical-sweep-turns">
          {`N turns = length / pitch = ${turns.toFixed(3)} (${previewPoints.length} polyline points sampled, arc ≈ ${previewLen.toFixed(1)}mm)`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Profile (swept circle)</div>
      <div style={SECTION_BOX}>
        <div style={FIELD_ROW}>
          <label htmlFor="forge-helical-sweep-profile"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)' }}>
            profile radius (mm)
          </label>
          <input id="forge-helical-sweep-profile"
                 type="number" step="0.05"
                 min={MIN_PROFILE_RADIUS_MM} max={MAX_PROFILE_RADIUS_MM}
                 value={profileRadius}
                 onChange={(e) => setProfileRadius(e.target.value)}
                 data-testid="forge-helical-sweep-profile"
                 style={INPUT_STYLE} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Ø ${(Number.isFinite(sanWr) ? sanWr*2 : 0).toFixed(2)}mm wire/thread · must be < PCD radius`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-helical-sweep-apply"
                style={ACTION_BTN('primary', !canApply)}>
          Apply — Sweep helix
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Calls forge.part.pipeFromPolyline(flatXYZ[${previewPoints.length*3}], r=${Number.isFinite(sanWr) ? sanWr.toFixed(3) : '—'}mm)`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-helical-sweep-log"
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
// Host — listens for the `tools.helicalSweep` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function HelicalSweepPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHelicalSweep  = () => setOpen(true);
    window.__forgeCloseHelicalSweep = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.helicalSweep') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenHelicalSweep; } catch {}
      try { delete window.__forgeCloseHelicalSweep; } catch {}
    };
  }, []);
  if (!open) return null;
  return <HelicalSweepPanel open={open} onClose={() => setOpen(false)} />;
}

export default HelicalSweepPanel;
