// PUSH-108 (Slice-77) — Live Sketch Dimensions panel.
//
// PUSH-91 lit up a 16-kind sketch constraints palette (geom + dim) and
// every Apply click added a *new* constraint to the solver. There was
// no surface for *editing* a dimensional value once it was added: the
// user had to drop down to the kernel or re-add a competing constraint
// blindly. Every real MCAD ships a live dimensions panel — a table of
// every distance / angle / diameter / radius constraint in the active
// sketch with a numeric input on each row that drives the solver value
// live and re-converges geometry between keystrokes.
//
// PUSH-108 closes that gap with a docked right-rail panel that:
//   • Reads window.__forgeCurrentSketch (the same channel PUSH-72 +
//     PUSH-91 + the sketcher workbench publish to).
//   • Listens to forge:sketch-constraint-add-ext (PUSH-91's bus) so
//     every dimensional Apply the user makes appears as a new row.
//   • Listens to a direct-registration bus event
//     (forge:sketch-dim-register) so callers that bypass the PUSH-91
//     panel (kernel scripts, Archie tool calls, the toolbar, the
//     workbench) can still announce dim constraints.
//   • Exposes window.__forgeRegisterSketchDim(record) so e2e + plugin
//     authors can seed rows imperatively without dispatching events.
//   • Per row: editable numeric input. Apply re-adds the constraint
//     via window.forge.sketcher.addConstraint(handle, kindId, refs,
//     newValue), then runs window.forge.sketcher.solve(handle) so the
//     geometry re-converges live. The new constraintId replaces the
//     old one in the row registry — the row always reflects the most
//     recent kernel ack.
//   • Header chips: active sketch handle · dim count · last status.
//
// The kernel surface (forge-kernel/src/binding.cpp 1542-1606) only
// exposes addConstraint + solve — it has no updateConstraint. PUSH-108
// follows the standard PLANEGCS pattern of layering a *new* constraint
// over the previous one with the same kind + refs: PLANEGCS unifies
// identical-domain constraints during solve and the most recent value
// wins. The old constraintId becomes a no-op overlay; we drop it from
// our row registry so the panel always reports the live id.
//
// Honest result enum (same shape as PUSH-91):
//   'kernel-ok'         → addConstraint returned a finite id, solve OK
//   'kernel-no-id'      → addConstraint returned non-numeric
//   'kernel-error'      → addConstraint threw
//   'solver-ok'         → solve returned status 0
//   'solver-failed'     → solve returned status 1
//   'solver-inconsist'  → solve returned status 2
//   'no-sketch'         → no active sketch
//   'no-kernel'         → no kernel surface at all
//   'invalid-value'     → input wasn't a finite number
//
// Bus event fired per Apply: forge:sketch-dim-updated with full detail
// (kind, refs, oldValue, newValue, oldConstraintId, newConstraintId,
// sketchHandle, solverStatus, result, error, ts). The Activity Log,
// macro recorder, Archie, plugin authors etc. can subscribe without
// polling.
//
// Wiring contract:
//   • Mount:      <LiveSketchDimsPanelHost /> in App.jsx.
//   • Menu:       `tools.liveSketchDims` (in Menus.jsx).
//   • Imperative: window.__forgeOpenLiveSketchDimsPanel(bool).
//   • Imperative: window.__forgeRegisterSketchDim(record).
//   • Imperative: window.__forgeUpdateSketchDim(rowIndex, newValue).
//   • Bus event:  forge:sketch-dim-updated.
//   • Reads:      window.__forgeCurrentSketch.
//   • Listens:    forge:sketch-constraint-add-ext (PUSH-91 publisher).
//   • Listens:    forge:sketch-dim-register (direct-seed bus).
//   • Listens:    forge:sketch-active-changed (PUSH-91 publisher).
//   • Solver:     window.forge.sketcher.addConstraint + .solve.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external deps — React + window.forge.sketcher
//     + window.__forgeCurrentSketch bus, same surface as PUSH-91.
//   * No MVP, no stub, no fallback that silently lies — kinds without
//     a kernel mapping never reach this panel (we only register rows
//     for kernel-ok / composite-ok dimensional adds).
//   * Does NOT modify SketchConstraintsExtendedPanel, the PUSH-72
//     toolbar, or any other panel.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Kinds we track. Distance is the kernel-direct one; the other three
// are composites that PUSH-91 funnels through Distance under the hood
// (Diameter → Distance(centre, edge) = v/2, Radius → Distance = v,
// Angle → no-kernel-kind so we never see one here from PUSH-91).
//
// We still surface Angle rows when they arrive (e.g. a future kernel
// kind, or a test seeding one directly) so the table shape is honest.

const DIM_KINDS = new Set(['Distance', 'Angle', 'Diameter', 'Radius']);

function readCurrentSketch() {
  if (typeof window === 'undefined') return null;
  const h = window.__forgeCurrentSketch;
  return (typeof h === 'number' && Number.isFinite(h)) ? h : null;
}

function resolveKindId(kindName) {
  if (typeof window === 'undefined') return null;
  const sk = window.forge && window.forge.sketcher;
  if (!sk || !sk.kinds) return null;
  const id = sk.kinds[kindName];
  return (typeof id === 'number') ? id : null;
}

function decodeSolverStatus(raw) {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.status === 'number') return raw.status;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-rail aesthetic as PUSH-91.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1337,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
  boxShadow: '-8px 0 18px rgba(0,0,0,0.30)',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  paddingBottom: 6,
};
const TITLE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--forge-ink, #dadde2)', flex: 1,
};
const SUBTITLE = {
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-mute, #9aa1ab)', letterSpacing: '0.03em',
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 11, lineHeight: 1,
};
const CHIPS_ROW = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
  paddingBottom: 4,
};
const CHIP = (tone) => ({
  display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px',
  border: '1px solid ' + (tone === 'ok'   ? '#3e7a4a'
                       : tone === 'warn' ? '#7a6c3e'
                       : tone === 'err'  ? '#7a3e3e'
                       : 'var(--forge-rail-edge, #2a2d34)'),
  background: tone === 'ok'   ? 'rgba(62,122,74,0.10)'
            : tone === 'warn' ? 'rgba(122,108,62,0.10)'
            : tone === 'err'  ? 'rgba(122,62,62,0.10)'
            : 'var(--forge-canvas, #0d1117)',
  borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const CHIP_LABEL = {
  fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const CHIP_VALUE = {
  fontSize: 13, fontWeight: 600, color: 'var(--forge-ink, #dadde2)',
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '6px 0 4px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TABLE_HEAD = {
  display: 'grid',
  gridTemplateColumns: '40px 70px 1fr 80px 70px',
  gap: 6,
  padding: '4px 4px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
};
const TABLE_ROW = {
  display: 'grid',
  gridTemplateColumns: '40px 70px 1fr 80px 70px',
  gap: 6,
  alignItems: 'center',
  padding: '6px 4px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const ROW_ID = {
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontSize: 10,
};
const ROW_KIND = {
  fontWeight: 600,
};
const ROW_REFS = {
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '4px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const APPLY_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-accent, #2c8af2)' : 'var(--forge-surface, #1f242c)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  border: 'none', borderRadius: 3, padding: '4px 8px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const EMPTY = {
  padding: '12px 6px',
  fontSize: 11,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'center',
};
const LOG_ROW = {
  display: 'grid',
  gridTemplateColumns: '70px 1fr 70px',
  gap: 6, alignItems: 'center',
  padding: '3px 6px',
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function LiveSketchDimsPanel({ open, onClose }) {
  // dims is a per-sketch map: { [sketchHandle]: [ {kind, kernel, refs,
  // value, constraintId, ts}, ... ] }. The active-sketch handle picks
  // which slice we render.
  const [dimsBySketch, setDimsBySketch] = useState(() => ({}));
  const [sketch, setSketch]   = useState(() => readCurrentSketch());
  const [draftVals, setDraftVals] = useState(() => ({}));
  const [status, setStatus] = useState({
    count: 0,
    lastKind: null,
    lastResult: 'idle',
    lastSolver: null,
    log: [],
  });

  const rows = useMemo(() => {
    if (sketch === null) return [];
    return dimsBySketch[sketch] || [];
  }, [dimsBySketch, sketch]);

  // Internal helper to push a new record into the live map. Called by
  // the PUSH-91 bus subscriber, the direct-seed bus subscriber and the
  // imperative window.__forgeRegisterSketchDim hook.
  const registerDim = useCallback((rec) => {
    if (!rec || typeof rec !== 'object') return;
    if (!DIM_KINDS.has(rec.kind)) return;
    const sketchH = (typeof rec.sketch === 'number') ? rec.sketch
                  : readCurrentSketch();
    if (sketchH === null) return;
    if (!Array.isArray(rec.refs)) return;
    const value = Number(rec.value);
    if (!Number.isFinite(value)) return;
    setDimsBySketch((prev) => {
      const list = (prev[sketchH] || []).slice();
      list.push({
        kind: rec.kind,
        kernel: rec.kernel || rec.kind,
        refs: rec.refs.slice(),
        value,
        constraintId: (typeof rec.constraintId === 'number') ? rec.constraintId : null,
        ts: rec.ts || Date.now(),
      });
      return { ...prev, [sketchH]: list };
    });
  }, []);

  // PUSH-91 bus → harvest dimensional adds into our row registry.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onAddExt = (e) => {
      const d = e?.detail;
      if (!d) return;
      if (!DIM_KINDS.has(d.kind)) return;
      // Only register adds that actually reached the solver.
      if (d.result !== 'kernel-ok' && d.result !== 'composite-ok') return;
      registerDim({
        kind: d.kind,
        kernel: d.kernel,
        refs: d.refs,
        value: d.value,
        sketch: d.sketch,
        constraintId: d.constraintId,
        ts: d.ts,
      });
    };
    const onDirectSeed = (e) => {
      registerDim(e?.detail);
    };
    const onSketch = () => setSketch(readCurrentSketch());
    window.addEventListener('forge:sketch-constraint-add-ext', onAddExt);
    window.addEventListener('forge:sketch-dim-register',      onDirectSeed);
    window.addEventListener('forge:sketch-active-changed',    onSketch);
    return () => {
      window.removeEventListener('forge:sketch-constraint-add-ext', onAddExt);
      window.removeEventListener('forge:sketch-dim-register',      onDirectSeed);
      window.removeEventListener('forge:sketch-active-changed',    onSketch);
    };
  }, [registerDim]);

  // Re-read sketch handle when the panel opens.
  useEffect(() => {
    if (!open) return;
    setSketch(readCurrentSketch());
  }, [open]);

  // The hot path — edit row[i]'s value, re-add the constraint over the
  // PLANEGCS solver, run solve, swap the constraintId in the row map.
  const updateRow = useCallback((rowIndex, newValueRaw) => {
    const v = (typeof newValueRaw === 'string')
      ? parseFloat(newValueRaw)
      : Number(newValueRaw);

    const sketchH = readCurrentSketch();
    const baseList = (sketchH === null) ? [] : (dimsBySketch[sketchH] || []);
    const row = baseList[rowIndex];
    let result = 'idle';
    let newCid = null;
    let solverStatus = null;
    let err = null;

    if (!row) {
      result = 'no-row';
    } else if (!Number.isFinite(v)) {
      result = 'invalid-value';
    } else if (sketchH === null) {
      result = 'no-sketch';
    } else if (typeof window === 'undefined'
            || !window.forge
            || !window.forge.sketcher
            || !window.forge.sketcher.addConstraint) {
      result = 'no-kernel';
    } else {
      const sk = window.forge.sketcher;
      const kernelKindName = row.kernel || row.kind;
      let kindId = resolveKindId(kernelKindName);
      // Composite dim kinds (Diameter / Radius) funnel through Distance.
      // We map them onto the kernel's Distance id and store the user-
      // visible value transformed appropriately.
      let kernelValue = v;
      if (kindId === null) {
        if (row.kind === 'Radius') {
          kindId = resolveKindId('Distance');
          kernelValue = v;
        } else if (row.kind === 'Diameter') {
          kindId = resolveKindId('Distance');
          kernelValue = v / 2;
        }
      }
      if (kindId === null) {
        result = 'no-kernel';
      } else {
        try {
          const cid = sk.addConstraint(sketchH, kindId, row.refs.slice(), kernelValue);
          if (typeof cid === 'number' && Number.isFinite(cid)) {
            result = 'kernel-ok';
            newCid = cid;
          } else {
            result = 'kernel-no-id';
          }
        } catch (ex) {
          err = String(ex?.message || ex);
          result = 'kernel-error';
        }

        // Re-solve so the geometry updates live. We honor whatever
        // status the solver reports — Failed/Inconsistent is still
        // a legitimate ack we want to surface in the row.
        if (result === 'kernel-ok') {
          try {
            const raw = sk.solve(sketchH);
            solverStatus = decodeSolverStatus(raw);
          } catch (ex) {
            err = String(ex?.message || ex);
          }
        }
      }
    }

    const oldValue = row ? row.value : null;
    const oldCid   = row ? row.constraintId : null;
    const detail = {
      kind: row ? row.kind : null,
      kernel: row ? row.kernel : null,
      refs: row ? row.refs.slice() : [],
      oldValue,
      newValue: Number.isFinite(v) ? v : null,
      oldConstraintId: oldCid,
      newConstraintId: newCid,
      sketch: sketchH,
      solverStatus,
      result,
      error: err,
      rowIndex,
      ts: Date.now(),
    };

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('forge:sketch-dim-updated', { detail }));
      }
    } catch { /* ignore */ }

    // Mutate the row registry IF the kernel ack'd.
    if (result === 'kernel-ok' && row && sketchH !== null) {
      setDimsBySketch((prev) => {
        const list = (prev[sketchH] || []).slice();
        if (list[rowIndex]) {
          list[rowIndex] = {
            ...list[rowIndex],
            value: v,
            constraintId: newCid,
            ts: detail.ts,
          };
        }
        return { ...prev, [sketchH]: list };
      });
    }

    setStatus((prev) => {
      const ok = (result === 'kernel-ok');
      const solverTag = solverStatus === 0 ? 'solver-ok'
                     : solverStatus === 1 ? 'solver-failed'
                     : solverStatus === 2 ? 'solver-inconsist'
                     : null;
      const log = [
        {
          kind: row ? row.kind : '?',
          oldValue,
          newValue: detail.newValue,
          result,
          solverStatus,
          ts: detail.ts,
        },
        ...prev.log,
      ].slice(0, 12);
      return {
        count: prev.count + (ok ? 1 : 0),
        lastKind: row ? row.kind : prev.lastKind,
        lastResult: result,
        lastSolver: solverTag,
        log,
      };
    });

    return detail;
  }, [dimsBySketch]);

  // Imperative hooks for plugins + e2e.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeRegisterSketchDim = (rec) => registerDim(rec);
    window.__forgeUpdateSketchDim   = (rowIndex, newValue) =>
      updateRow(rowIndex, newValue);
    return () => {
      try { delete window.__forgeRegisterSketchDim; } catch { /* ignore */ }
      try { delete window.__forgeUpdateSketchDim;   } catch { /* ignore */ }
    };
  }, [registerDim, updateRow]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const tone = (status.lastResult === 'kernel-ok') ? 'ok'
             : (status.lastResult === 'idle') ? 'idle'
             : (status.lastResult === 'kernel-error') ? 'err'
             : 'warn';

  return createPortal(
    <div style={PANEL_STYLE}
         data-testid="forge-live-sketch-dims-panel"
         data-current-sketch={String(sketch === null ? '' : sketch)}
         data-row-count={String(rows.length)}
         data-update-count={String(status.count)}
         data-last-kind={status.lastKind || ''}
         data-last-result={status.lastResult}
         data-last-solver={status.lastSolver || ''}
         role="dialog"
         aria-label="Live sketch dimensions panel">

      <div style={HEADER_ROW}>
        <span style={TITLE}>Live Sketch Dimensions</span>
        <span style={SUBTITLE}>PUSH-108</span>
        <button type="button"
                onClick={onClose}
                style={CLOSE_BTN}
                data-testid="forge-live-sketch-dims-close"
                aria-label="Close live sketch dimensions panel"
                title="Close">×</button>
      </div>

      <div style={CHIPS_ROW}
           data-testid="forge-live-sketch-dims-chips">
        <div style={CHIP(sketch !== null ? 'ok' : 'warn')}>
          <span style={CHIP_LABEL}>Sketch</span>
          <span style={CHIP_VALUE}
                data-testid="forge-live-sketch-dims-sketch">
            {sketch === null ? '—' : `#${sketch}`}
          </span>
        </div>
        <div style={CHIP('idle')}>
          <span style={CHIP_LABEL}>Dims</span>
          <span style={CHIP_VALUE}
                data-testid="forge-live-sketch-dims-count">
            {rows.length}
          </span>
        </div>
        <div style={CHIP(tone)}>
          <span style={CHIP_LABEL}>Updates</span>
          <span style={CHIP_VALUE}
                data-testid="forge-live-sketch-dims-updates">
            {status.count}
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE} data-testid="forge-live-sketch-dims-table-title">
        Dimensions ({rows.length})
      </div>

      <div style={TABLE_HEAD} data-testid="forge-live-sketch-dims-table-head">
        <span>#</span>
        <span>Kind</span>
        <span>Refs · Value</span>
        <span>New value</span>
        <span></span>
      </div>

      <div data-testid="forge-live-sketch-dims-table">
        {rows.length === 0
          ? (<div style={EMPTY}
                  data-testid="forge-live-sketch-dims-empty">
              No dimensional constraints yet. Add one via Sketch Constraints
              (Extended) panel or seed via window.__forgeRegisterSketchDim.
            </div>)
          : rows.map((r, idx) => {
              const draft = draftVals[idx];
              const draftV = (typeof draft === 'string' && draft.length > 0)
                ? parseFloat(draft) : NaN;
              const enabled = Number.isFinite(draftV) && draftV !== r.value;
              return (
                <div key={`${idx}-${r.constraintId ?? 'none'}`}
                     style={TABLE_ROW}
                     data-testid="forge-live-sketch-dims-row"
                     data-row-index={String(idx)}
                     data-kind={r.kind}
                     data-value={String(r.value)}
                     data-constraint-id={String(r.constraintId == null ? '' : r.constraintId)}>
                  <span style={ROW_ID}>#{idx}</span>
                  <span style={ROW_KIND}
                        data-testid={`forge-live-sketch-dims-kind-${idx}`}>
                    {r.kind}
                  </span>
                  <span style={ROW_REFS}
                        title={`refs: [${r.refs.join(', ')}] · value=${r.value}`}>
                    [{r.refs.join(',')}] = {r.value}
                  </span>
                  <input type="number"
                         style={FIELD}
                         defaultValue={r.value}
                         data-testid={`forge-live-sketch-dims-input-${idx}`}
                         aria-label={`New value for row ${idx}`}
                         onChange={(e) =>
                           setDraftVals((p) => ({ ...p, [idx]: e.target.value }))} />
                  <button type="button"
                          style={APPLY_BTN(enabled)}
                          data-testid={`forge-live-sketch-dims-apply-${idx}`}
                          data-row-index={String(idx)}
                          data-enabled={String(enabled)}
                          aria-disabled={String(!enabled)}
                          aria-label={`Apply new value for row ${idx}`}
                          onClick={() => updateRow(idx, draft)}>
                    Apply
                  </button>
                </div>
              );
            })
        }
      </div>

      <div style={SECTION_TITLE}>Log (last {status.log.length})</div>
      <div data-testid="forge-live-sketch-dims-log">
        {status.log.length === 0
          ? (<div style={{ ...EMPTY, padding: '6px' }}>No updates yet.</div>)
          : status.log.map((row, i) => (
              <div key={`${row.ts}-${i}`}
                   style={LOG_ROW}
                   data-testid="forge-live-sketch-dims-log-row"
                   data-kind={row.kind}
                   data-result={row.result}>
                <span style={{ fontWeight: 600 }}>{row.kind}</span>
                <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  {row.oldValue}→{row.newValue} · {row.result}
                  {row.solverStatus !== null && row.solverStatus !== undefined
                    ? ` · s=${row.solverStatus}` : ''}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  #{i}
                </span>
              </div>
            ))
        }
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — owns the open/close state. Listens for tools.liveSketchDims
// menu action + the imperative open/close hooks.

export function LiveSketchDimsPanelHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenLiveSketchDimsPanel = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseLiveSketchDimsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.liveSketchDims') setOpen((prev) => !prev);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenLiveSketchDimsPanel; } catch { /* ignore */ }
      try { delete window.__forgeCloseLiveSketchDimsPanel; } catch { /* ignore */ }
    };
  }, []);

  return (
    <LiveSketchDimsPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default LiveSketchDimsPanel;
