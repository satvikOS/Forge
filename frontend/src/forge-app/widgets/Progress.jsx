/**
 * Progress — operation progress + cancel overlay (Forge-28).
 *
 * `useProgress(operationKind)` returns a controller you can call from
 * anywhere: { start(msg), update(pct, msg), done(), cancel(), signal }.
 *
 * `<ProgressOverlay>` is the singleton host: it subscribes to
 * `ProgressBus` and renders a stacked card per in-flight op in the
 * bottom-right of the viewport. Cancel button triggers
 * `ProgressBus.cancel(id)` which aborts the op's AbortController.
 *
 * Wiring:
 *   - `runForgePrompt({ signal })` (Forge-17) honours the signal via
 *     fetch — Forge-28 plumbs the bus's controller through.
 *   - `ForgeFEA.runStatic({ cancelToken })` / `runDynamic({ cancelToken })`
 *     poll the token between Newmark steps (extended in Fea.js this slice).
 *   - Export pipelines (STEP/STL/BREP) can wrap their call sites with
 *     `ProgressBus.track({ kind: 'export', msg }, fn)`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as ProgressBus from '../../kernel/forge/ProgressBus.js';

/**
 * Hook: returns a stable controller for a single operation. The op is
 * lazy-started on first `start()` so passive component mounts don't
 * spawn empty cards.
 */
export function useProgress(kind = 'op') {
  const opRef = useRef(null);

  const start = useCallback((msg = '') => {
    if (opRef.current) ProgressBus.done(opRef.current.id);
    opRef.current = ProgressBus.start({ kind, msg });
    return opRef.current;
  }, [kind]);

  const update = useCallback((pct, msg) => {
    if (!opRef.current) return;
    ProgressBus.update(opRef.current.id, { pct, msg });
  }, []);

  const done = useCallback((msg) => {
    if (!opRef.current) return;
    ProgressBus.done(opRef.current.id, msg ? { msg } : undefined);
    opRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    if (!opRef.current) return;
    ProgressBus.cancel(opRef.current.id);
    opRef.current = null;
  }, []);

  const signal = () => opRef.current?.controller?.signal ?? null;

  // Cancel on unmount so we don't leave a card forever.
  useEffect(() => () => {
    if (opRef.current) ProgressBus.cancel(opRef.current.id);
  }, []);

  return { start, update, done, cancel, signal };
}

const STYLES = {
  host: {
    position: 'fixed', right: 16, bottom: 16, zIndex: 9998,
    display: 'flex', flexDirection: 'column', gap: 8,
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    pointerEvents: 'auto',
    minWidth: 280, maxWidth: 340,
    background: '#1f2024', color: '#e8e8ea',
    border: '1px solid #2c2d33', borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: 12, fontSize: 13,
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  kind: { fontSize: 11, color: '#9a9ca5', textTransform: 'uppercase', letterSpacing: 0.5 },
  cancel: {
    marginLeft: 'auto', cursor: 'pointer',
    background: 'transparent', border: '1px solid #3a3b42',
    color: '#e8e8ea', borderRadius: 4,
    padding: '2px 8px', fontSize: 11,
  },
  barTrack: {
    width: '100%', height: 4, background: '#0f1014',
    borderRadius: 2, overflow: 'hidden', marginTop: 6,
  },
  barFill: (pct, indeterminate) => ({
    height: '100%',
    width: indeterminate ? '40%' : `${Math.round(pct * 100)}%`,
    background: '#2c5cff',
    transition: 'width 120ms linear',
    animation: indeterminate ? 'forge-progress-pulse 1.6s ease-in-out infinite' : 'none',
  }),
  msg: { color: '#c8c9cf', fontSize: 12, marginTop: 4 },
};

/**
 * <ProgressOverlay> — mount once in the app shell. Renders one card per
 * in-flight op. Cards self-dismiss when the op transitions to done /
 * cancelled / error (ProgressBus GCs the record after a short delay).
 */
export function ProgressOverlay() {
  const [ops, setOps] = useState(ProgressBus.list());
  useEffect(() => {
    const dispose = ProgressBus.onChange(() => setOps(ProgressBus.list()));
    return dispose;
  }, []);

  if (!ops.length) return null;
  return (
    <div data-forge-progress-host style={STYLES.host}>
      <style>{`@keyframes forge-progress-pulse {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(280%); }
      }`}</style>
      {ops.map((op) => (
        <div key={op.id} data-forge-op-id={op.id} style={STYLES.card}>
          <div style={STYLES.header}>
            <span style={STYLES.kind}>{op.kind}</span>
            {op.status === 'running' ? (
              <button type="button" style={STYLES.cancel}
                      onClick={() => ProgressBus.cancel(op.id)}>
                Cancel
              </button>
            ) : null}
          </div>
          <div style={STYLES.barTrack}>
            <div style={STYLES.barFill(op.pct ?? 0, op.pct == null)} />
          </div>
          <div style={STYLES.msg}>
            {op.status === 'cancelled' ? 'Cancelled' :
             op.status === 'error' ? `Error: ${op.error || 'unknown'}` :
             op.status === 'done' ? (op.msg || 'Done') :
             (op.msg || 'Working…')}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ProgressOverlay;
