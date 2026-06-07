// PUSH-112 (Slice-81) — Reverse Engineering panel (mesh → surface fit).
//
// User brief:
//   "Reverse engineering = take an STL mesh, sample points on it, fit a
//    B-rep surface. PUSH-77 added STL export. The inverse: import →
//    mesh → fit.
//
//    Goal: a Reverse Engineering panel that:
//    - Pick STL via file dialog OR generate a synthetic test mesh
//      (faceted sphere)
//    - Sample N points (slider 100-2000)
//    - Fit a NURBS patch through the points using least-squares (use
//      forge.surfacing.buildPatch with a fitted control grid)
//    - Output the fitted surface body"
//
// The panel is the thin React surface; all the math lives in
// meshToSurface.js so the e2e + Archie tool calls can hit the same code
// path without mounting the React tree.
//
// Hard constraints:
//   * NO new npm / C++ / external deps.
//   * Real OCCT NURBS face committed via window.forge.surfacing.buildPatch.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Manual clicks NEVER post to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  REVERSE_ENG_EVENT,
  REVERSE_ENG_STORAGE,
  REVERSE_ENG_DEFAULT_SAMPLES,
  REVERSE_ENG_MIN_SAMPLES,
  REVERSE_ENG_MAX_SAMPLES,
  REVERSE_ENG_DEFAULT_UV,
  REVERSE_ENG_SOURCE_SYNTH,
  REVERSE_ENG_SOURCE_STL,
  generateSyntheticSphereMesh,
  importStlMesh,
  runReverseEngineeringPipeline,
} from './meshToSurface.js';

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as ClassABlend / SurfaceOffset
// so the three Class-A / surfacing panels feel like one toolset.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1336,
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
const RADIO_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
};
const SOURCE_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  color: 'var(--forge-ink, #dadde2)',
  padding: '6px 8px',
  cursor: 'pointer',
  fontSize: 11,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
  textAlign: 'left',
});
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '3px 8px', borderRadius: 3, fontSize: 11,
};
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'center',
};
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
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
const STATUS_PILL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const STL_PATH_BOX = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '4px 6px', fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function ReverseEngineeringPanel({ open, onClose }) {
  const [source, setSource] = useState(REVERSE_ENG_SOURCE_SYNTH);
  const [samples, setSamples] = useState(() => {
    if (typeof localStorage === 'undefined') return REVERSE_ENG_DEFAULT_SAMPLES;
    try {
      const raw = localStorage.getItem(REVERSE_ENG_STORAGE);
      if (!raw) return REVERSE_ENG_DEFAULT_SAMPLES;
      const blob = JSON.parse(raw);
      const v = Number(blob.samples);
      if (Number.isFinite(v) && v >= REVERSE_ENG_MIN_SAMPLES && v <= REVERSE_ENG_MAX_SAMPLES) {
        return Math.floor(v);
      }
      return REVERSE_ENG_DEFAULT_SAMPLES;
    } catch { return REVERSE_ENG_DEFAULT_SAMPLES; }
  });
  const [stlPath, setStlPath] = useState(null);
  const [stlMeshInfo, setStlMeshInfo] = useState(null); // { triangleCount, vertexCount, path }
  const [stlLoadError, setStlLoadError] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const lastFaceRef = useRef(null);

  // Persist samples to localStorage so a re-open boots the same slider.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(REVERSE_ENG_STORAGE,
        JSON.stringify({ samples, source }));
    } catch { /* quota / private mode — fail soft */ }
  }, [samples, source]);

  // Clear log when re-opened.
  useEffect(() => {
    if (!open) return undefined;
    setLog([]);
    setStlLoadError(null);
    return undefined;
  }, [open]);

  const onSetSource = useCallback((s) => {
    setSource(s);
    if (s === REVERSE_ENG_SOURCE_SYNTH) {
      // Switching back to synth clears any stale STL path so the Fit
      // button doesn't fire a stale import.
      setStlLoadError(null);
    }
  }, []);

  const onChangeSamples = useCallback((e) => {
    let v = Math.floor(Number(e.target.value));
    if (!Number.isFinite(v)) v = REVERSE_ENG_DEFAULT_SAMPLES;
    if (v < REVERSE_ENG_MIN_SAMPLES) v = REVERSE_ENG_MIN_SAMPLES;
    if (v > REVERSE_ENG_MAX_SAMPLES) v = REVERSE_ENG_MAX_SAMPLES;
    setSamples(v);
  }, []);

  // STL file picker — calls forge.dialog.openFile, then probes the file
  // through importStlMesh so the panel can display the triangle / vertex
  // counts before the user clicks Fit.
  const onPickStl = useCallback(async () => {
    setStlLoadError(null);
    const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
    if (!dialog || typeof dialog.openFile !== 'function') {
      setStlLoadError('forge.dialog.openFile unavailable (Electron-only).');
      return;
    }
    let chosen;
    try {
      chosen = await dialog.openFile({
        title: 'Pick STL mesh',
        filters: [{ name: 'STL', extensions: ['stl'] }],
        properties: ['openFile'],
      });
    } catch (ex) {
      setStlLoadError(`openFile failed: ${ex?.message || ex}`);
      return;
    }
    const p = Array.isArray(chosen) ? chosen[0] : chosen;
    if (!p) {
      setStlLoadError('Pick cancelled.');
      return;
    }
    setStlPath(p);
    // Probe the file so we can show triangle/vertex counts before Fit.
    setBusy(true);
    try {
      const imp = await importStlMesh(p);
      if (!imp.ok) {
        setStlLoadError(`Probe failed: ${imp.reason}${imp.message ? ' · ' + imp.message : ''}`);
        setStlMeshInfo(null);
      } else {
        setStlMeshInfo({
          path: p,
          triangleCount: imp.mesh.triangleCount,
          vertexCount:   imp.mesh.vertexCount,
          sourceHandle:  imp.sourceHandle,
        });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Headline action — drive the pipeline; surface ok / err in the log row.
  const onFit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await runReverseEngineeringPipeline({
        source,
        samples,
        uCount: REVERSE_ENG_DEFAULT_UV,
        vCount: REVERSE_ENG_DEFAULT_UV,
        stlPath: source === REVERSE_ENG_SOURCE_STL ? stlPath : null,
      });
      if (r.ok) {
        lastFaceRef.current = r.faceHandle;
        setLog((l) => [
          ...l.slice(-12),
          {
            ok: true, ts: Date.now(),
            message: `Fitted ${source} · ${samples} pts → face ${r.faceHandle} · RMS ${r.fit.rmsResidual.toFixed(3)} mm · ${Math.round(r.fit.filledCellRatio * 100)}% cells filled`,
          },
        ]);
      } else {
        setLog((l) => [
          ...l.slice(-12),
          {
            ok: false, ts: Date.now(),
            message: `Fit failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, source, samples, stlPath]);

  // Seed a synthetic mesh on demand — purely for inspection; the Fit
  // button does this implicitly. Used in the e2e to confirm the synthetic
  // mesh shape before sampling.
  const onSeedSynth = useCallback(() => {
    const m = generateSyntheticSphereMesh();
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: true, ts: Date.now(),
        message: `Synth sphere · radius 50 mm · ${m.triangleCount} triangles · ${m.vertexCount} vertices`,
      },
    ]);
  }, []);

  const canFit = !busy && (
    (source === REVERSE_ENG_SOURCE_SYNTH) ||
    (source === REVERSE_ENG_SOURCE_STL && stlPath != null && !stlLoadError)
  );

  const samplesPct = useMemo(
    () => ((samples - REVERSE_ENG_MIN_SAMPLES)
         / (REVERSE_ENG_MAX_SAMPLES - REVERSE_ENG_MIN_SAMPLES)) * 100,
    [samples],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Reverse engineering"
         data-testid="forge-reverse-eng-panel"
         data-source={source}
         data-samples={String(samples)}
         data-stl-path={stlPath || ''}
         data-stl-triangles={stlMeshInfo ? String(stlMeshInfo.triangleCount) : ''}
         data-busy={busy ? 'true' : 'false'}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="io.stl" size={14} />
        <strong style={{ fontSize: 13 }}>Reverse Engineering</strong>
        <span style={STATUS_PILL}>Mesh → Surface</span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Reverse Engineering panel"
                data-testid="forge-reverse-eng-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Sample a mesh on the triangle area, then fit a NURBS surface to the
        cloud via PCA + least-squares grid binning. Equivalent to one side
        of OCCT's GeomAPI_PointsToBSplineSurface — committed through
        surfacing.buildPatch.
      </div>

      <div style={SECTION_TITLE}>Source mesh</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_GRID}>
          <button type="button"
                  onClick={() => onSetSource(REVERSE_ENG_SOURCE_SYNTH)}
                  data-testid="forge-reverse-eng-source-synth"
                  data-active={source === REVERSE_ENG_SOURCE_SYNTH ? '1' : '0'}
                  aria-pressed={source === REVERSE_ENG_SOURCE_SYNTH}
                  style={SOURCE_BTN(source === REVERSE_ENG_SOURCE_SYNTH)}>
            <strong>Synthetic sphere</strong>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              radius 50 mm · 192 triangles
            </span>
          </button>
          <button type="button"
                  onClick={() => onSetSource(REVERSE_ENG_SOURCE_STL)}
                  data-testid="forge-reverse-eng-source-stl"
                  data-active={source === REVERSE_ENG_SOURCE_STL ? '1' : '0'}
                  aria-pressed={source === REVERSE_ENG_SOURCE_STL}
                  style={SOURCE_BTN(source === REVERSE_ENG_SOURCE_STL)}>
            <strong>STL file</strong>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              import via file dialog
            </span>
          </button>
        </div>
        {source === REVERSE_ENG_SOURCE_STL && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button"
                      onClick={onPickStl}
                      data-testid="forge-reverse-eng-pick-stl"
                      disabled={busy}
                      style={SMALL_BTN}>
                Pick STL…
              </button>
              <button type="button"
                      onClick={() => { setStlPath(null); setStlMeshInfo(null); setStlLoadError(null); }}
                      data-testid="forge-reverse-eng-clear-stl"
                      disabled={!stlPath}
                      style={SMALL_BTN}>
                Clear
              </button>
            </div>
            <div data-testid="forge-reverse-eng-stl-path"
                 style={STL_PATH_BOX}
                 title={stlPath || ''}>
              {stlPath || '— no file picked —'}
            </div>
            {stlMeshInfo && (
              <div data-testid="forge-reverse-eng-stl-info"
                   data-triangles={String(stlMeshInfo.triangleCount)}
                   data-vertices={String(stlMeshInfo.vertexCount)}
                   style={{ fontSize: 10, color: 'var(--forge-ink-2, #b5bac4)' }}>
                {`${stlMeshInfo.triangleCount} triangles · ${stlMeshInfo.vertexCount} vertices · source handle ${stlMeshInfo.sourceHandle}`}
              </div>
            )}
            {stlLoadError && (
              <div data-testid="forge-reverse-eng-stl-error"
                   style={{ fontSize: 10, color: 'var(--forge-err, #ef5350)' }}>
                {stlLoadError}
              </div>
            )}
          </div>
        )}
        {source === REVERSE_ENG_SOURCE_SYNTH && (
          <button type="button"
                  onClick={onSeedSynth}
                  data-testid="forge-reverse-eng-seed-synth"
                  style={SMALL_BTN}>
            Inspect synth mesh
          </button>
        )}
      </div>

      <div style={SECTION_TITLE}>Sample count</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={REVERSE_ENG_MIN_SAMPLES}
                 max={REVERSE_ENG_MAX_SAMPLES}
                 step="50"
                 value={samples}
                 onChange={onChangeSamples}
                 data-testid="forge-reverse-eng-samples-slider"
                 aria-label="Sample count"
                 style={{ width: '100%' }} />
          <input type="number"
                 min={REVERSE_ENG_MIN_SAMPLES}
                 max={REVERSE_ENG_MAX_SAMPLES}
                 step="50"
                 value={samples}
                 onChange={onChangeSamples}
                 data-testid="forge-reverse-eng-samples-number"
                 aria-label="Sample count (numeric)"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{ fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>{REVERSE_ENG_MIN_SAMPLES}</span>
          <span data-testid="forge-reverse-eng-samples-pct">
            {`${samples} pts · slider ${samplesPct.toFixed(0)}%`}
          </span>
          <span>{REVERSE_ENG_MAX_SAMPLES}</span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Fit</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onFit}
                disabled={!canFit}
                data-testid="forge-reverse-eng-fit"
                data-state={busy ? 'busy' : 'idle'}
                style={ACTION_BTN('primary', !canFit)}>
          {busy ? 'Fitting…' : 'Fit NURBS surface'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`${REVERSE_ENG_DEFAULT_UV}×${REVERSE_ENG_DEFAULT_UV} control grid · degree 3 · open-uniform knots · PCA dominant-plane`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-reverse-eng-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no fits yet
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
// Host — listens for the `tools.reverseEng` menu action, exposes the
// imperative open/close hooks. The helper API mirror lives on
// window.__forgeReverseEngHelper (installed by meshToSurface.js at
// import time).

export function ReverseEngineeringPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenReverseEng  = () => setOpen(true);
    window.__forgeCloseReverseEng = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.reverseEng') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenReverseEng; } catch {}
      try { delete window.__forgeCloseReverseEng; } catch {}
    };
  }, []);
  // Only mount the panel subtree when open. Makes the useState
  // initializer (which reads localStorage) run fresh on each open,
  // honouring any test-fixture clears that happen after app boot.
  if (!open) return null;
  return <ReverseEngineeringPanel open={open} onClose={() => setOpen(false)} />;
}

export default ReverseEngineeringPanel;

// Re-export the event name so callers don't need a second import path.
export { REVERSE_ENG_EVENT };
