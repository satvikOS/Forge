// PUSH-84 (Slice-52 / Voxel-rep panel).
//
// Up through PUSH-83 the Forge shell offered two modelling
// representations:
//   1. B-rep — OCCT shapes, kernel-side, handle-driven.
//   2. NURBS / surface — via PUSH-194's NurbsFit + surfacing.
// This slice ships the third leaf — V-rep (voxels) — as a tiny in-tree
// representation. The pipeline:
//   1. Pick the active body (auto from `window.__forgeSelection`, fall
//      back to the last body in `window.__forgeBodies`).
//   2. Pick a resolution from the {8, 16, 32, 64} slider.
//   3. Click "Voxelize" → `voxelize.js` walks the body's bbox, samples
//      every grid centre with the JS ray-casting point-in-mesh test,
//      and returns an array of `{x, y, z}` centres + voxel size.
//   4. The panel wraps that into a synthetic body
//      (`spec: { kind: 'group', cells, child: { kind: 'box', dx:s, … } }`)
//      and appends via `window.__forgeAppendBody`. The existing
//      SceneMeshes path renders the group as a single merged mesh —
//      effectively InstancedMesh-style — so Viewport.jsx is untouched
//      per the brief.
//   5. The stats panel surfaces voxel count, fill ratio and equivalent
//      volume (insideCount × voxelSize³).
//
// Plugin / Archie / e2e surface:
//   * `window.__forgeOpenVoxelizationPanel()`  — open the dialog.
//   * `window.__forgeCloseVoxelizationPanel()` — close it.
//   * `window.__forgeVoxelizationHelper`       — frozen object with the
//     pure math helpers from voxelize.js + commitVoxelization (no React
//     mount required).
//   * `window.__forgeVoxelizations`            — Map<bodyId, record>
//     mirroring every voxelisation ever committed in this session.
//
// Hard constraints (PUSH-84 brief):
//   * NO new npm packages, NO new C++ libs — pure React + the existing
//     window.forge surface + window.__forgeAppendBody.
//   * Real impl, no MVP, no stub: the math really walks every grid
//     point, the panel really commits a synthetic body, the stats
//     really reflect the in/out counts.
//   * Surgical edits to Menus.jsx (one new entry: `tools.voxelize`) +
//     App.jsx (one import + one mount). Viewport.jsx untouched.
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  VOXEL_RESOLUTIONS, DEFAULT_VOXEL_RESOLUTION,
  voxelize, buildVoxelBody, readBodiesSnapshot, activeVoxelBody,
} from './voxelize.js';

// ────────────────────────────────────────────────────────────────────
// Bus event names. The panel publishes one event per Voxelize commit
// so other panels (e.g. ActivityLog / BomPanel / Archie) can subscribe
// without polling.

export const FORGE_VOXELIZATION_EVENT = 'forge:voxelization-committed';

// ────────────────────────────────────────────────────────────────────
// Commit helper. Builds the voxel body, mirrors it into the window
// helper, calls `__forgeAppendBody`, and dispatches the bus event.
// Returns the committed body, or `null` if nothing was inside.

export function commitVoxelization(sourceBody, voxelization) {
  if (typeof window === 'undefined') return null;
  if (!voxelization || !voxelization.centers || voxelization.centers.length === 0) {
    return null;
  }
  const body = buildVoxelBody(voxelization, sourceBody);
  if (!body) return null;
  // Mirror into the session map. We freeze the snapshot so subscribers
  // can't mutate the panel's state through the global.
  let mirror = window.__forgeVoxelizations;
  if (!(mirror instanceof Map)) {
    mirror = new Map();
    try { window.__forgeVoxelizations = mirror; } catch {}
  }
  mirror.set(body.id, Object.freeze({
    id:                  body.id,
    sourceId:            sourceBody && sourceBody.id,
    sourceHandle:        sourceBody && typeof sourceBody.handle === 'number'
                           ? sourceBody.handle : null,
    resolution:          voxelization.resolution,
    voxelSize:           voxelization.voxelSize,
    insideCount:         voxelization.insideCount,
    sampleCount:         voxelization.sampleCount,
    fillRatio:           voxelization.fillRatio,
    equivalentVolume_mm3: voxelization.equivalentVolume_mm3,
    bounds:              voxelization.bounds,
    centers:             body.spec.cells.slice(),
    ts:                  Date.now(),
  }));
  if (typeof window.__forgeAppendBody === 'function') {
    try { window.__forgeAppendBody(body); }
    catch (err) { console.warn('[push-84] __forgeAppendBody failed:', err && err.message); }
  }
  try {
    window.dispatchEvent(new CustomEvent(FORGE_VOXELIZATION_EVENT, {
      detail: {
        id:           body.id,
        sourceId:     sourceBody && sourceBody.id,
        resolution:   voxelization.resolution,
        voxelCount:   voxelization.insideCount,
        voxelSize:    voxelization.voxelSize,
        fillRatio:    voxelization.fillRatio,
        equivalentVolume_mm3: voxelization.equivalentVolume_mm3,
      },
    }));
  } catch { /* CustomEvent universally available in Electron */ }
  return body;
}

// ────────────────────────────────────────────────────────────────────
// Styles. Same right-docked rail as BatchRename / MassProps; 380 px
// wide so the body picker label + stats grid breathe.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380, zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const SELECT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STATS_GRID = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  rowGap: 4, columnGap: 8,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const STATS_LABEL = { color: 'var(--forge-ink-mute, #9aa1ab)' };
const STATS_VALUE = { color: 'var(--forge-ink, #dadde2)' };
const ACTION_BTN = (variant = 'default') => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const SLIDER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const SLIDER_BUTTON = (active) => ({
  background: active
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-canvas-1, #0e1218)',
  color: active ? '#fff' : 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  cursor: 'pointer',
  padding: '4px 10px',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});

// ────────────────────────────────────────────────────────────────────
// Body picker label. Same fallback chain BatchRenamePanel uses.

function bodyLabel(body) {
  if (!body) return '';
  if (typeof body.name === 'string' && body.name.length) return body.name;
  if (typeof body.toolId === 'string' && body.toolId.length) return body.toolId;
  if (typeof body.handle === 'number') return `handle ${body.handle}`;
  return body.id || '';
}

// ────────────────────────────────────────────────────────────────────
// Panel UI.

export function VoxelizationPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const [activeId, setActiveId] = useState(() => {
    const b = activeVoxelBody();
    return b ? b.id : null;
  });
  const [resolution, setResolution] = useState(DEFAULT_VOXEL_RESOLUTION);
  // Last voxelisation result (display only — the commit path also writes
  // to window.__forgeVoxelizations).
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Toast for the latest commit; surfaces "Committed N voxels".
  const [toast, setToast] = useState(null);

  // Refresh bodies on open + subscribe to the bus while open.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readBodiesSnapshot());
    setResult(null);
    setError(null);
    setToast(null);
    const refresh = () => {
      const snap = readBodiesSnapshot();
      setBodies(snap);
      // If the previously-active body vanished, fall back to the latest.
      if (activeId && !snap.find((b) => b.id === activeId)) {
        const next = activeVoxelBody();
        setActiveId(next ? next.id : null);
      }
    };
    const onSel = () => {
      const next = activeVoxelBody();
      if (next && next.id !== activeId) setActiveId(next.id);
    };
    window.addEventListener('forge:bodies-changed', refresh);
    window.addEventListener('forge:body-added', refresh);
    window.addEventListener('forge:selection-changed', onSel);
    return () => {
      window.removeEventListener('forge:bodies-changed', refresh);
      window.removeEventListener('forge:body-added', refresh);
      window.removeEventListener('forge:selection-changed', onSel);
    };
  }, [open, activeId]);

  // Re-base the active id whenever the open transition flips to true.
  useEffect(() => {
    if (!open) return;
    const next = activeVoxelBody();
    if (next) setActiveId(next.id);
  }, [open]);

  const activeBody = useMemo(
    () => bodies.find((b) => b.id === activeId) || null,
    [bodies, activeId],
  );

  // ── Voxelize action. Computes synchronously — the math is JS-only and
  // 8³ = 512 samples even on a 100-tri body finishes in < 5 ms.
  const onVoxelize = useCallback(() => {
    if (!activeBody) { setError('No body selected.'); return; }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const r = voxelize(activeBody, resolution);
      if (r && r.error) {
        setError(r.error);
        setResult(null);
      } else {
        setResult(r);
      }
    } catch (ex) {
      setError(String(ex && ex.message || ex));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [activeBody, resolution]);

  // ── Commit action. Wraps the result in a synthetic body and appends
  // via __forgeAppendBody. The fresh body lands in the scene tree and
  // SceneMeshes renders it as a merged group geometry.
  const onCommit = useCallback(() => {
    if (!activeBody || !result || !result.centers || result.centers.length === 0) return;
    const body = commitVoxelization(activeBody, result);
    if (body) {
      setToast({ id: body.id, count: result.insideCount, when: Date.now() });
    }
  }, [activeBody, result]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const fillPct = result ? (result.fillRatio * 100).toFixed(2) : null;

  return createPortal(
    <div role="dialog"
         aria-label="Voxelisation"
         data-testid="forge-voxelize-panel"
         data-active-body-id={activeBody ? activeBody.id : ''}
         data-resolution={resolution}
         data-voxel-count={result ? result.insideCount : 0}
         data-voxel-size={result ? result.voxelSize.toFixed(6) : '0'}
         data-fill-ratio={result ? result.fillRatio.toFixed(6) : '0'}
         data-equivalent-volume={result ? result.equivalentVolume_mm3.toFixed(6) : '0'}
         data-busy={busy ? '1' : '0'}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.box" size={14} />
        <strong style={{ fontSize: 13 }}>Voxel-rep</strong>
        <span data-testid="forge-voxelize-rep-tag"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          V-rep
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close voxelisation panel"
                data-testid="forge-voxelize-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)', lineHeight: 1.45 }}>
        Convert a B-rep body into a voxel grid sampled inside its bounding
        box. Commits as a synthetic body of cube centres rendered through
        the existing InstancedMesh-grouped scene path.
      </div>

      <div style={SECTION_TITLE}>Body</div>
      <div style={SECTION_BOX}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={FIELD_LABEL}>Source body</span>
          <select data-testid="forge-voxelize-body-picker"
                  value={activeId || ''}
                  onChange={(e) => setActiveId(e.target.value || null)}
                  style={SELECT_INPUT}>
            {bodies.length === 0 ? (
              <option value="" disabled>No bodies in scene</option>
            ) : (
              bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {bodyLabel(b)}
                </option>
              ))
            )}
          </select>
        </label>
        <div style={{
          fontSize: 10, fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          color: 'var(--forge-ink-mute, #9aa1ab)',
        }}>
          {activeBody
            ? `${activeBody.kind || 'native'} · id=${activeBody.id}`
            : 'Pick a body above, or add one from a modelling workbench.'}
        </div>
      </div>

      <div style={SECTION_TITLE}>Resolution</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          {VOXEL_RESOLUTIONS.map((r) => (
            <button key={r}
                    type="button"
                    data-testid={`forge-voxelize-res-${r}`}
                    onClick={() => setResolution(r)}
                    style={SLIDER_BUTTON(resolution === r)}>
              {r}
            </button>
          ))}
          <span style={{
            flex: 1, textAlign: 'right',
            fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
            fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          }}
                data-testid="forge-voxelize-resolution-label">
            {resolution}³ = {resolution * resolution * resolution} samples
          </span>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={FIELD_LABEL}>Slider (8 → 64)</span>
          <input type="range"
                 min={0}
                 max={VOXEL_RESOLUTIONS.length - 1}
                 step={1}
                 value={VOXEL_RESOLUTIONS.indexOf(resolution)}
                 data-testid="forge-voxelize-resolution-slider"
                 onChange={(e) => {
                   const idx = Number(e.target.value);
                   const next = VOXEL_RESOLUTIONS[idx] || DEFAULT_VOXEL_RESOLUTION;
                   setResolution(next);
                 }}
                 style={{ width: '100%' }} />
        </label>
      </div>

      <div>
        <button type="button"
                onClick={onVoxelize}
                disabled={!activeBody || busy}
                data-testid="forge-voxelize-run"
                title="Sample the body at resolution³ grid points and collect the inside ones"
                style={{
                  ...ACTION_BTN('default'),
                  opacity: (!activeBody || busy) ? 0.5 : 1,
                  cursor: (!activeBody || busy) ? 'not-allowed' : 'pointer',
                  width: '100%',
                }}>
          {busy ? 'Voxelising…' : 'Voxelize'}
        </button>
      </div>

      <div style={SECTION_TITLE}>Output</div>
      <div style={SECTION_BOX}>
        {error && (
          <div data-testid="forge-voxelize-error"
               style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
            {error}
          </div>
        )}
        {result ? (
          <section data-testid="forge-voxelize-stats" style={STATS_GRID}>
            <div style={STATS_LABEL}>Voxel count</div>
            <div data-testid="forge-voxelize-stat-count" style={STATS_VALUE}>
              {result.insideCount} / {result.sampleCount}
            </div>
            <div style={STATS_LABEL}>Fill ratio</div>
            <div data-testid="forge-voxelize-stat-fill" style={STATS_VALUE}>
              {fillPct}%
            </div>
            <div style={STATS_LABEL}>Voxel size</div>
            <div data-testid="forge-voxelize-stat-voxsize" style={STATS_VALUE}>
              {result.voxelSize.toFixed(3)} mm
            </div>
            <div style={STATS_LABEL}>Equivalent volume</div>
            <div data-testid="forge-voxelize-stat-volume" style={STATS_VALUE}>
              {result.equivalentVolume_mm3.toFixed(3)} mm³
            </div>
            <div style={STATS_LABEL}>Bounds</div>
            <div data-testid="forge-voxelize-stat-bounds" style={STATS_VALUE}>
              {result.bounds
                ? `(${result.bounds.min.map((v) => v.toFixed(2)).join(', ')}) → ` +
                  `(${result.bounds.max.map((v) => v.toFixed(2)).join(', ')})`
                : '—'}
            </div>
          </section>
        ) : (
          <div data-testid="forge-voxelize-empty"
               style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
            {error
              ? 'Voxelisation produced no output.'
              : busy ? 'Sampling…'
                     : 'Click Voxelize to sample the body at the current resolution.'}
          </div>
        )}
      </div>

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {toast ? (
          <span data-testid="forge-voxelize-toast"
                style={{ fontSize: 11, color: 'var(--forge-accent, #4f87ff)' }}>
            Committed {toast.count} voxel{toast.count === 1 ? '' : 's'}.
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            {result
              ? 'Commit to add a synthetic voxel body to the scene.'
              : 'Pick a body + resolution, then click Voxelize.'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onCommit}
                disabled={!result || result.insideCount === 0}
                data-testid="forge-voxelize-commit"
                title="Append a synthetic body of voxel cube centres to the scene"
                style={{
                  ...ACTION_BTN('primary'),
                  opacity: (!result || result.insideCount === 0) ? 0.5 : 1,
                  cursor: (!result || result.insideCount === 0) ? 'not-allowed' : 'pointer',
                }}>
          Commit voxel body
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────────
// Host. Mounts once, installs the imperative open/close + helper
// surface, listens for `tools.voxelize`.

export function VoxelizationPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenVoxelizationPanel  = () => setOpen(true);
    window.__forgeCloseVoxelizationPanel = () => setOpen(false);
    // Initialise the session-wide voxelisation mirror so subscribers can
    // call `.entries()` even before the first commit.
    if (!(window.__forgeVoxelizations instanceof Map)) {
      try { window.__forgeVoxelizations = new Map(); } catch {}
    }
    // Headless helper API for plugins / Archie / e2e — every pure math
    // function from voxelize.js + the commit path on one frozen surface.
    window.__forgeVoxelizationHelper = Object.freeze({
      VOXEL_RESOLUTIONS,
      DEFAULT_VOXEL_RESOLUTION,
      voxelize,
      buildVoxelBody,
      readBodiesSnapshot,
      activeVoxelBody,
      commitVoxelization,
      EVENT_NAME: FORGE_VOXELIZATION_EVENT,
    });
    const onMenu = (e) => {
      const id = e && e.detail && e.detail.id;
      if (id === 'tools.voxelize') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenVoxelizationPanel; } catch {}
      try { delete window.__forgeCloseVoxelizationPanel; } catch {}
    };
  }, []);
  return <VoxelizationPanel open={open} onClose={() => setOpen(false)} />;
}

export default VoxelizationPanel;
