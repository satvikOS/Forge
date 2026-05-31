/**
 * VectorPicker — Universal "Specify Vector" widget (NX takeaway #117).
 *
 * Why this exists (Tier-12a synthesis pp. 117 / 783):
 *   NX dialogs that need a direction (Revolve, Pattern, Move, Offset,
 *   Mirror, Draft, Extrude direction, Linear Pattern axis, ...) all share
 *   a single "Specify Vector" widget. The user picks ONE of:
 *     - a CSYS axis  (±X / ±Y / ±Z world axes)   ← default
 *     - a custom 3-component vector              ← numeric dx/dy/dz
 *     - a sketch line   (vector = end − start)   ← pick from sketch
 *     - a face normal   (vector = ∇F at p)       ← pick face in viewport
 *
 *   Pre-NX-style ArchDisc spread `dirX / dirY / dirZ` (and `tx / ty / tz`)
 *   across every tool's dialog as three separate numeric fields, with no
 *   way to lift the value from a sketch line or a face. This component
 *   replaces the three-field convention with one cohesive picker so the
 *   user picks the SAME widget shape across every direction-needing tool.
 *
 * Component contract:
 *   <VectorPicker
 *     value={{ mode, x, y, z }}        // controlled, see SHAPE below
 *     onChange={(value) => …}          // fires whenever the user edits
 *     defaultMode="csys"               // 'csys' | 'custom' | 'sketchLine' | 'faceNormal'
 *     defaultAxis="+Z"                 // initial CSYS axis if mode=csys
 *     fieldName="dir"                  // used for data-attr, e2e hooks
 *     compact={false}                  // compact vertical layout for dock
 *   />
 *
 * Output value SHAPE (always normalised when emitted):
 *   {
 *     mode:      'csys' | 'custom' | 'sketchLine' | 'faceNormal',
 *     x: number, y: number, z: number,      // unit vector
 *     magnitude: number,                    // pre-normalisation length
 *     // mode-specific provenance (debug + design-history persistence)
 *     csysAxis?: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z',
 *     pickedAt?: { kind: 'sketchLine'|'face', meta: {...} },
 *   }
 *
 * Backward compat with the existing dirX/dirY/dirZ / tx/ty/tz handlers:
 *   The ToolExecutionEngine wrapping layer (see PropertyManagerDock /
 *   ToolParamDialog commit paths) keeps writing the x/y/z components as
 *   `<fieldName>X`, `<fieldName>Y`, `<fieldName>Z` AND `<fieldName>` as
 *   the object {x,y,z}. Handlers can read either.
 *
 * Sketch-line + face-normal pickers:
 *   These modes arm a one-shot pick listener via the global selection
 *   bus (`window.__archdiscVectorPickerArmed = { fieldName, kind }`) and
 *   the Viewport3D / InteractiveSketch publish the picked sketch-line
 *   end/start tuple or face-normal triple on:
 *     - window.__archdiscLastPickedSketchLine = { start: [x,y,z], end: [x,y,z] }
 *     - window.__archdiscLastPickedFaceNormal = { point: [x,y,z], normal: [x,y,z] }
 *   The picker polls `__archdisc*` on a short interval after arming and
 *   commits the resulting vector. If the global isn't ever populated
 *   (e.g. running headless in a spec without those hooks), the picker
 *   exposes a `__archdiscVectorPickerForce(value)` window helper so the
 *   e2e harness can inject the final vector directly.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import './VectorPicker.css';

const CSYS_AXES = {
  '+X': [1, 0, 0],  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],  '-Y': [0, -1, 0],
  '+Z': [0, 0, 1],  '-Z': [0, 0, -1],
};

function normalise(x, y, z) {
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(mag) || mag < 1e-12) {
    return { x: 0, y: 0, z: 1, magnitude: 0 };
  }
  return { x: x / mag, y: y / mag, z: z / mag, magnitude: mag };
}

export function buildVectorValue(mode, x, y, z, extras = {}) {
  const n = normalise(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  return { mode, ...n, ...extras };
}

export default function VectorPicker({
  value,
  onChange,
  defaultMode = 'csys',
  defaultAxis = '+Z',
  fieldName = 'direction',
  compact = false,
}) {
  // Initial state is derived from `value` if provided, else defaults.
  const initial = value || (() => {
    const axisVec = CSYS_AXES[defaultAxis] || CSYS_AXES['+Z'];
    return {
      mode: defaultMode,
      x: axisVec[0], y: axisVec[1], z: axisVec[2],
      magnitude: 1,
      csysAxis: defaultAxis,
    };
  })();

  const [internal, setInternal] = useState(initial);
  // raw text inputs for the Custom mode so the user can mid-type "-0."
  // without the controlled <input type=number> rejecting it.
  const [rawX, setRawX] = useState(String(initial.x ?? 0));
  const [rawY, setRawY] = useState(String(initial.y ?? 0));
  const [rawZ, setRawZ] = useState(String(initial.z ?? 1));
  // status for the live pick modes
  const [pickStatus, setPickStatus] = useState(null);  // null | 'armed' | 'done' | 'error'
  const [pickHint, setPickHint] = useState('');
  const pollRef = useRef(null);

  // Pre-armed pickers — clean up on unmount.
  useEffect(() => () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (typeof window !== 'undefined') {
      try { delete window.__archdiscVectorPickerArmed; } catch {}
    }
  }, []);

  const emit = useCallback((next) => {
    setInternal(next);
    if (typeof window !== 'undefined') {
      window.__archdiscLastVectorPickerValue = { fieldName, value: next, at: Date.now() };
    }
    if (typeof onChange === 'function') onChange(next);
  }, [fieldName, onChange]);

  // Force-injection helper for the e2e harness (Electron specs that can't
  // simulate real sketch / face picks). The harness calls
  //    window.__archdiscVectorPickerForce({fieldName, mode, x, y, z, ...})
  // to drive the picker without touching the DOM. Multiple pickers may be
  // alive at once — only the one whose fieldName matches reacts.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const detail = ev?.detail || {};
      if (detail.fieldName !== fieldName) return;
      const next = buildVectorValue(
        detail.mode || internal.mode || 'custom',
        detail.x, detail.y, detail.z,
        {
          csysAxis: detail.csysAxis,
          pickedAt: detail.pickedAt,
        },
      );
      if (next.mode === 'custom') {
        setRawX(String(detail.x ?? 0));
        setRawY(String(detail.y ?? 0));
        setRawZ(String(detail.z ?? 0));
      }
      setPickStatus('done');
      setPickHint('Vector applied');
      emit(next);
    };
    window.addEventListener('archdisc:vector-picker:force', handler);
    // Imperative bridge so spec code that can't fire CustomEvents (rare)
    // can still do `window.__archdiscVectorPickerForce({...})`.
    window.__archdiscVectorPickerForce = (detail) => {
      window.dispatchEvent(new CustomEvent('archdisc:vector-picker:force', { detail }));
    };
    return () => {
      window.removeEventListener('archdisc:vector-picker:force', handler);
    };
  }, [fieldName, emit, internal.mode]);

  // ── CSYS-axis pick ────────────────────────────────────────────────────
  const pickAxis = useCallback((axis) => {
    const vec = CSYS_AXES[axis] || CSYS_AXES['+Z'];
    const next = buildVectorValue('csys', vec[0], vec[1], vec[2], { csysAxis: axis });
    setRawX(String(vec[0])); setRawY(String(vec[1])); setRawZ(String(vec[2]));
    setPickStatus(null); setPickHint('');
    emit(next);
  }, [emit]);

  // ── Custom-numeric edit ───────────────────────────────────────────────
  const onCustomChange = useCallback((axis, raw) => {
    if (axis === 'x') setRawX(raw);
    if (axis === 'y') setRawY(raw);
    if (axis === 'z') setRawZ(raw);
    const x = axis === 'x' ? parseFloat(raw) : parseFloat(rawX);
    const y = axis === 'y' ? parseFloat(raw) : parseFloat(rawY);
    const z = axis === 'z' ? parseFloat(raw) : parseFloat(rawZ);
    const next = buildVectorValue('custom',
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0);
    emit(next);
  }, [rawX, rawY, rawZ, emit]);

  // ── Sketch-line pick ──────────────────────────────────────────────────
  const armSketchLinePick = useCallback(() => {
    if (typeof window === 'undefined') return;
    setPickStatus('armed');
    setPickHint('Click a sketch line — vector = end − start (normalised).');
    window.__archdiscVectorPickerArmed = { fieldName, kind: 'sketchLine' };
    try { delete window.__archdiscLastPickedSketchLine; } catch {}
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const picked = window.__archdiscLastPickedSketchLine;
      if (!picked || !Array.isArray(picked.start) || !Array.isArray(picked.end)) return;
      clearInterval(pollRef.current); pollRef.current = null;
      const dx = picked.end[0] - picked.start[0];
      const dy = picked.end[1] - picked.start[1];
      const dz = (picked.end[2] || 0) - (picked.start[2] || 0);
      const next = buildVectorValue('sketchLine', dx, dy, dz, {
        pickedAt: { kind: 'sketchLine', meta: { start: picked.start, end: picked.end } },
      });
      setPickStatus('done');
      setPickHint(`Sketch line picked — Δ=(${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)})`);
      emit(next);
      try { delete window.__archdiscVectorPickerArmed; } catch {}
    }, 80);
  }, [fieldName, emit]);

  // ── Face-normal pick ─────────────────────────────────────────────────
  const armFaceNormalPick = useCallback(() => {
    if (typeof window === 'undefined') return;
    setPickStatus('armed');
    setPickHint('Click a face — vector = face normal at the picked point.');
    window.__archdiscVectorPickerArmed = { fieldName, kind: 'faceNormal' };
    try { delete window.__archdiscLastPickedFaceNormal; } catch {}
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const picked = window.__archdiscLastPickedFaceNormal;
      if (!picked || !Array.isArray(picked.normal)) return;
      clearInterval(pollRef.current); pollRef.current = null;
      const [nx, ny, nz] = picked.normal;
      const next = buildVectorValue('faceNormal', nx, ny, nz, {
        pickedAt: { kind: 'faceNormal', meta: { point: picked.point || null } },
      });
      setPickStatus('done');
      setPickHint(`Face normal — n=(${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)})`);
      emit(next);
      try { delete window.__archdiscVectorPickerArmed; } catch {}
    }, 80);
  }, [fieldName, emit]);

  const cancelPick = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (typeof window !== 'undefined') {
      try { delete window.__archdiscVectorPickerArmed; } catch {}
    }
    setPickStatus(null); setPickHint('');
  }, []);

  return (
    <div
      className={'vp-root' + (compact ? ' vp-compact' : '')}
      data-archdisc-vector-picker={fieldName}
      data-vp-mode={internal.mode}
    >
      <div className="vp-mode-row">
        <button
          type="button"
          className={'vp-mode-btn' + (internal.mode === 'csys' ? ' vp-mode-active' : '')}
          onClick={() => {
            const axis = internal.csysAxis || defaultAxis;
            pickAxis(axis);
          }}
          data-vp-mode-btn="csys"
          title="World axis: ±X / ±Y / ±Z"
        >CSYS</button>
        <button
          type="button"
          className={'vp-mode-btn' + (internal.mode === 'custom' ? ' vp-mode-active' : '')}
          onClick={() => {
            // Switching to Custom — preserve the current vector as the
            // initial dx/dy/dz so the user sees continuity.
            const next = buildVectorValue('custom', internal.x, internal.y, internal.z);
            setRawX(String(internal.x ?? 0));
            setRawY(String(internal.y ?? 0));
            setRawZ(String(internal.z ?? 1));
            emit(next);
          }}
          data-vp-mode-btn="custom"
          title="Custom 3-component vector"
        >Custom</button>
        <button
          type="button"
          className={'vp-mode-btn' + (internal.mode === 'sketchLine' ? ' vp-mode-active' : '')}
          onClick={armSketchLinePick}
          data-vp-mode-btn="sketchLine"
          title="Pick a sketch line; vector = end − start"
        >Sketch line</button>
        <button
          type="button"
          className={'vp-mode-btn' + (internal.mode === 'faceNormal' ? ' vp-mode-active' : '')}
          onClick={armFaceNormalPick}
          data-vp-mode-btn="faceNormal"
          title="Pick a face; vector = face normal at the pick point"
        >Face normal</button>
      </div>

      {internal.mode === 'csys' && (
        <div className="vp-axis-row" data-archdisc-vp-csys-row>
          {Object.keys(CSYS_AXES).map((axis) => (
            <button
              key={axis}
              type="button"
              className={'vp-axis-btn' + (internal.csysAxis === axis ? ' vp-axis-active' : '')}
              onClick={() => pickAxis(axis)}
              data-vp-axis={axis}
            >{axis}</button>
          ))}
        </div>
      )}

      {internal.mode === 'custom' && (
        <div className="vp-custom-row" data-archdisc-vp-custom-row>
          <label className="vp-custom-cell">
            <span className="vp-custom-label">dx</span>
            <input
              className="vp-custom-input"
              type="text"
              inputMode="decimal"
              value={rawX}
              onChange={(e) => onCustomChange('x', e.target.value)}
              data-vp-custom-field="x"
            />
          </label>
          <label className="vp-custom-cell">
            <span className="vp-custom-label">dy</span>
            <input
              className="vp-custom-input"
              type="text"
              inputMode="decimal"
              value={rawY}
              onChange={(e) => onCustomChange('y', e.target.value)}
              data-vp-custom-field="y"
            />
          </label>
          <label className="vp-custom-cell">
            <span className="vp-custom-label">dz</span>
            <input
              className="vp-custom-input"
              type="text"
              inputMode="decimal"
              value={rawZ}
              onChange={(e) => onCustomChange('z', e.target.value)}
              data-vp-custom-field="z"
            />
          </label>
        </div>
      )}

      {(internal.mode === 'sketchLine' || internal.mode === 'faceNormal') && (
        <div className="vp-pick-row" data-archdisc-vp-pick-row>
          <button
            type="button"
            className="vp-pick-arm"
            onClick={internal.mode === 'sketchLine' ? armSketchLinePick : armFaceNormalPick}
            data-vp-pick-arm={internal.mode}
            disabled={pickStatus === 'armed'}
          >
            {internal.mode === 'sketchLine' ? 'Pick from sketch' : 'Pick face normal'}
          </button>
          {pickStatus === 'armed' && (
            <button type="button" className="vp-pick-cancel" onClick={cancelPick} data-vp-pick-cancel>
              Cancel pick
            </button>
          )}
        </div>
      )}

      <div className="vp-readout" data-archdisc-vp-readout={fieldName}>
        <span className="vp-readout-label">v =</span>
        <span className="vp-readout-value">
          ({internal.x.toFixed(3)}, {internal.y.toFixed(3)}, {internal.z.toFixed(3)})
        </span>
        {internal.csysAxis && internal.mode === 'csys' && (
          <span className="vp-readout-tag" data-vp-readout-axis={internal.csysAxis}>
            {internal.csysAxis}
          </span>
        )}
        {pickHint && (
          <span
            className={'vp-readout-hint ' + (pickStatus === 'armed' ? 'vp-readout-hint-armed' : 'vp-readout-hint-done')}
            data-vp-pick-status={pickStatus || ''}
          >
            {pickHint}
          </span>
        )}
      </div>
    </div>
  );
}
