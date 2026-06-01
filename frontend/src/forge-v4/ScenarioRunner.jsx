// Forge-105 — Scenario Runner modal.
//
// A catalogue of real-world test campaigns (see scenarioLibrary.js) the
// user can pick from. Workflow:
//
//   1. user picks a scenario card from the left rail
//   2. UI shows description, spec citation, and an editable params panel
//   3. user enters / confirms the target body handle
//   4. ▶ Run — kicks off the dispatch.* call, kernel-offline yields a
//      clean error toast (not a crash)
//   5. on success, the result + mesh are piped to FeaResultViewer in the
//      right pane; "Play animation" is auto-engaged
//   6. while playing, we auto-start the canvas video capture; on stop the
//      .webm is downloaded
//
// Self-mounts via window.__forgeOpenScenarioRunner() — ForgeShellV4.jsx is
// frozen. Manual UI clicks NEVER post to Archie's thread; we go straight
// to simulationDispatch + the FeaResultViewer.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from './Toast.jsx';
import * as simulationDispatch from './simulationDispatch.js';
import { SCENARIOS, getScenario } from './scenarioLibrary.js';
import { FeaResultViewer } from './FeaResultViewer.jsx';

// ─────────────────────────────────────────────────────────── helpers

function activeBodyHandleFromWindow() {
  if (typeof window === 'undefined') return null;
  const sel = window.__forgeSelection;
  if (sel && typeof sel.bodyHandle === 'number') return sel.bodyHandle;
  if (Array.isArray(window.__forgeBodies) && window.__forgeBodies.length) {
    const b = window.__forgeBodies[0];
    if (typeof b.handle === 'number') return b.handle;
  }
  return null;
}

function pickInitialTab(kind) {
  if (!kind) return 'Displacement';
  if (kind.startsWith('fea.thermal')) return 'Temperature';
  if (kind === 'fea.fatigue')          return 'Fatigue Life';
  if (kind === 'fea.dynamic')          return 'Modes';
  if (kind === 'assembly.motion')      return 'Displacement';
  return 'Displacement';
}

// ─────────────────────────────────────────────────────────── component

export function ScenarioRunner({ open, onClose, defaultBodyHandle = null }) {
  const [selectedId, setSelectedId] = useState(SCENARIOS[0].id);
  const [params, setParams]         = useState(() => ({ ...SCENARIOS[0].defaults }));
  const [bodyHandle, setBodyHandle] = useState(
    defaultBodyHandle != null ? defaultBodyHandle : activeBodyHandleFromWindow());
  const [busy, setBusy]             = useState(false);
  const [running, setRunning]       = useState(false);
  const [result, setResult]         = useState(null);
  const [mesh, setMesh]             = useState(null);
  const [resultTab, setResultTab]   = useState('Displacement');
  const [error, setError]           = useState(null);

  // Reset params when the user picks a different scenario.
  const scenario = useMemo(() => getScenario(selectedId) || SCENARIOS[0], [selectedId]);
  useEffect(() => {
    setParams({ ...scenario.defaults });
    setError(null);
  }, [scenario.id]);

  // Stop any in-flight recording when the modal closes.
  useEffect(() => {
    if (!open && running) {
      try { window.dispatchEvent(new CustomEvent('forge:capture-stop',
        { detail: { filename: `forge-scenario-${scenario.id}` } })); } catch { /* noop */ }
      setRunning(false);
    }
  }, [open, running, scenario.id]);

  // ─── Run handler ───
  const onRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setMesh(null);

    if (typeof bodyHandle !== 'number' || bodyHandle <= 0) {
      const msg = 'Pick a body first — enter a valid handle in the field above.';
      setError(msg);
      showToast({ kind: 'warn', text: msg, ttl: 3500 });
      setBusy(false);
      return;
    }

    let dispatchResult;
    try {
      dispatchResult = await scenario.run({
        params, bodyHandle, dispatch: simulationDispatch,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setError(msg);
      showToast({ kind: 'err', text: `Scenario crashed: ${msg}`, ttl: 4000 });
      setBusy(false);
      return;
    }

    if (!dispatchResult || dispatchResult.error) {
      const reason = (dispatchResult && dispatchResult.error) || 'no result';
      setError(reason);
      showToast({ kind: 'warn',
        text: `Scenario "${scenario.name}" did not complete: ${reason}`,
        ttl: 4500 });
      setBusy(false);
      return;
    }

    // Pull the mesh that was used so the viewer has geometry. The kernel
    // returns it on the result, or we can re-fetch from the dispatch's
    // mesh helper. We try both.
    let usedMesh = dispatchResult.mesh || null;
    if (!usedMesh) {
      const m = simulationDispatch.mesh(bodyHandle, 3);
      if (m && !m.error) usedMesh = m.mesh;
    }

    setResult(dispatchResult);
    setMesh(usedMesh);
    setResultTab(pickInitialTab(scenario.kind));
    setRunning(true);
    setBusy(false);

    // Auto-record the animated playback.
    try {
      window.dispatchEvent(new CustomEvent('forge:capture-start', {
        detail: { fps: 60, codec: 'vp9', scenarioId: scenario.id },
      }));
    } catch { /* noop */ }

    showToast({ kind: 'ok',
      text: `${scenario.name} · ${dispatchResult.elapsedMs ? `${dispatchResult.elapsedMs.toFixed(0)} ms` : 'ran'}`,
      ttl: 2200 });
  }, [scenario, params, bodyHandle]);

  const onStopRecording = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent('forge:capture-stop', {
        detail: { filename: `forge-scenario-${scenario.id}` },
      }));
    } catch { /* noop */ }
    setRunning(false);
  }, [scenario.id]);

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  return createPortal(
    <div data-testid="forge-scenario-runner"
         role="dialog"
         aria-label="Scenario Runner"
         style={DIALOG_OUTER}>
      <style>{SR_CSS}</style>
      <div style={DIALOG_BACKDROP} onClick={onClose} />
      <div style={DIALOG_BODY}>
        {/* ── header ── */}
        <header style={HEADER}>
          <span style={{ fontWeight: 700, letterSpacing: '0.04em' }}>
            Scenario Runner
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--forge-ink-mute)', fontSize: 11,
                         fontFamily: 'var(--forge-mono)' }}>
            {SCENARIOS.length} validated campaigns
          </span>
          <button type="button"
                  data-testid="forge-scenario-close"
                  aria-label="Close"
                  onClick={onClose}
                  style={CLOSE_BTN}>×</button>
        </header>

        {/* ── three-column layout ── */}
        <div style={GRID}>
          {/* catalogue list */}
          <aside data-testid="forge-scenario-list" style={LEFT_COL}>
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button"
                      data-scenario-id={s.id}
                      data-active={String(selectedId === s.id)}
                      onClick={() => setSelectedId(s.id)}
                      className="forge-scenario-card"
                      style={{
                        ...CARD_BASE,
                        ...(selectedId === s.id ? CARD_ACTIVE : {}),
                      }}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={CARD_SPEC}>{s.spec}</span>
              </button>
            ))}
          </aside>

          {/* params + run */}
          <section data-testid="forge-scenario-config" style={MID_COL}>
            <h3 style={H3}>{scenario.name}</h3>
            <div style={SPEC_BADGE}>{scenario.spec}</div>
            <p style={DESC}>{scenario.description}</p>

            <div style={{ height: 1, background: 'var(--forge-rail-edge)', margin: '8px 0' }} />

            <label style={LABEL}>
              <span style={LABEL_SPAN}>Target body handle</span>
              <input type="number"
                     data-testid="forge-scenario-body-handle"
                     value={bodyHandle == null ? '' : bodyHandle}
                     onChange={(e) => {
                       const v = parseInt(e.target.value, 10);
                       setBodyHandle(Number.isFinite(v) ? v : null);
                     }}
                     style={INPUT_NUM} />
            </label>

            <div style={PARAMS_BOX} data-testid="forge-scenario-params">
              {Object.entries(scenario.paramSchema).map(([key, schema]) => (
                <ParamField key={key} keyName={key} schema={schema}
                            value={params[key]}
                            onChange={(v) => setParams((p) => ({ ...p, [key]: v }))} />
              ))}
            </div>

            {error && (
              <div data-testid="forge-scenario-error" style={ERROR_BANNER}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button"
                      data-testid="forge-scenario-run"
                      data-busy={String(busy)}
                      disabled={busy}
                      onClick={onRun}
                      style={{ ...RUN_BTN, opacity: busy ? 0.55 : 1 }}>
                {busy ? 'Running…' : `▶ Run ${scenario.name}`}
              </button>
              {running && (
                <button type="button"
                        data-testid="forge-scenario-stop-recording"
                        onClick={onStopRecording}
                        style={STOP_BTN}>
                  ■ Stop & save .webm
                </button>
              )}
            </div>
          </section>

          {/* result viewer */}
          <section data-testid="forge-scenario-result-pane" style={RIGHT_COL}>
            {result && mesh ? (
              <FeaResultViewer result={result} mesh={mesh}
                               resultTab={resultTab}
                               initialAmp={1}
                               playing={true} />
            ) : (
              <div style={EMPTY_RESULT}>
                <span style={{ color: 'var(--forge-ink-mute)', fontSize: 11,
                               fontFamily: 'var(--forge-mono)',
                               letterSpacing: '0.06em',
                               textTransform: 'uppercase' }}>
                  result viewer will appear here
                </span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body);
}

// ─── small atomic widgets ───
function ParamField({ keyName, schema, value, onChange }) {
  if (schema.options) {
    return (
      <label style={LABEL}>
        <span style={LABEL_SPAN}>{schema.label || keyName}</span>
        <select value={value == null ? '' : value}
                data-scenario-param={keyName}
                onChange={(e) => onChange(e.target.value)}
                style={INPUT_NUM}>
          {schema.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label style={LABEL}>
      <span style={LABEL_SPAN}>
        {schema.label || keyName}{schema.unit ? ` (${schema.unit})` : ''}
      </span>
      <input type="number"
             data-scenario-param={keyName}
             value={value == null ? '' : value}
             min={schema.min} max={schema.max} step={schema.step}
             onChange={(e) => {
               const v = parseFloat(e.target.value);
               onChange(Number.isFinite(v) ? v : 0);
             }}
             style={INPUT_NUM} />
    </label>
  );
}

// ─── styles ───
const DIALOG_OUTER = {
  position: 'fixed', inset: 0,
  zIndex: 2300,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const DIALOG_BACKDROP = {
  position: 'absolute', inset: 0,
  background: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(2px)',
};
const DIALOG_BODY = {
  position: 'relative',
  width: 'min(1180px, 96vw)', height: 'min(720px, 90vh)',
  background: 'var(--forge-canvas-2, #0a0b0e)',
  border: '1px solid var(--forge-rail-edge, #1d2027)',
  borderRadius: 6,
  boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink, #ebecef)',
};
const HEADER = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge, #1d2027)',
  fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
};
const CLOSE_BTN = {
  background: 'transparent', border: 'none',
  color: 'var(--forge-ink-mute)', cursor: 'pointer',
  fontSize: 18, lineHeight: 1, padding: '0 4px',
};
const GRID = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '280px 320px 1fr',
  minHeight: 0,
};
const LEFT_COL = {
  borderRight: '1px solid var(--forge-rail-edge, #1d2027)',
  overflowY: 'auto',
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 4,
};
const MID_COL = {
  borderRight: '1px solid var(--forge-rail-edge, #1d2027)',
  overflowY: 'auto',
  padding: 16,
  display: 'flex', flexDirection: 'column',
};
const RIGHT_COL = {
  position: 'relative', overflow: 'hidden',
  background: 'var(--forge-canvas, #000)',
};
const CARD_BASE = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  gap: 2,
  padding: '8px 10px',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #1d2027)',
  borderRadius: 4,
  color: 'var(--forge-ink, #ebecef)',
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
};
const CARD_ACTIVE = {
  background: 'var(--forge-accent-mute, rgba(255,255,255,0.08))',
  borderColor: 'var(--forge-accent-rim, rgba(255,255,255,0.28))',
};
const CARD_SPEC = {
  color: 'var(--forge-ink-mute, #757a85)',
  fontFamily: 'var(--forge-mono)',
  fontSize: 10,
};
const H3 = {
  margin: '0 0 6px 0',
  fontSize: 14, letterSpacing: '0.02em',
};
const SPEC_BADGE = {
  display: 'inline-block',
  alignSelf: 'flex-start',
  padding: '2px 6px',
  background: 'var(--forge-accent-mute, rgba(255,255,255,0.08))',
  border: '1px solid var(--forge-accent-rim, rgba(255,255,255,0.28))',
  borderRadius: 3,
  fontSize: 10, fontFamily: 'var(--forge-mono)',
  color: 'var(--forge-ink-2, #b0b4bd)',
  marginBottom: 8,
};
const DESC = {
  margin: 0, fontSize: 11, lineHeight: 1.5,
  color: 'var(--forge-ink-2, #b0b4bd)',
};
const LABEL = {
  display: 'flex', alignItems: 'center', gap: 10,
  marginBottom: 6,
};
const LABEL_SPAN = {
  minWidth: 120, fontSize: 10,
  color: 'var(--forge-ink-mute, #757a85)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const INPUT_NUM = {
  flex: 1,
  padding: '3px 6px',
  background: 'var(--forge-canvas, #000)',
  color: 'var(--forge-ink, #ebecef)',
  border: '1px solid var(--forge-rail-edge, #1d2027)',
  borderRadius: 3,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const PARAMS_BOX = {
  marginTop: 8,
  padding: 10,
  background: 'var(--forge-canvas, #000)',
  border: '1px solid var(--forge-rail-edge, #1d2027)',
  borderRadius: 4,
};
const ERROR_BANNER = {
  marginTop: 10,
  padding: '6px 10px',
  background: 'rgba(226,106,106,0.08)',
  border: '1px solid var(--forge-err, #e26a6a)',
  borderRadius: 3,
  color: 'var(--forge-err, #e26a6a)',
  fontSize: 11, fontFamily: 'var(--forge-mono)',
};
const RUN_BTN = {
  padding: '6px 14px',
  background: 'var(--forge-accent-mute, rgba(255,255,255,0.08))',
  border: '1px solid var(--forge-accent-rim, rgba(255,255,255,0.28))',
  borderRadius: 3,
  color: 'var(--forge-ink, #ebecef)',
  fontFamily: 'var(--forge-mono)', fontSize: 11,
  letterSpacing: '0.04em', textTransform: 'uppercase',
  cursor: 'pointer',
};
const STOP_BTN = {
  ...RUN_BTN,
  background: 'rgba(226,106,106,0.18)',
  borderColor: 'var(--forge-err, #e26a6a)',
  color: 'var(--forge-err, #e26a6a)',
};
const EMPTY_RESULT = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const SR_CSS = `
.forge-scenario-card:hover {
  background: var(--forge-accent-mute, rgba(255,255,255,0.06));
}
`;

// ─────────────────────────────────────────────────────────── self-mount

/**
 * Self-mounting host. ForgeShellV4 is frozen, so this portals onto
 * document.body and exposes:
 *
 *   window.__forgeOpenScenarioRunner(true|false)
 *
 * The mock kernel / e2e test can toggle the modal via this global.
 */
export function ScenarioRunnerHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenScenarioRunner = (v) =>
      setOpen(v === undefined ? true : !!v);
    return () => {
      try { delete window.__forgeOpenScenarioRunner; } catch { /* noop */ }
    };
  }, []);
  return <ScenarioRunner open={open} onClose={() => setOpen(false)} />;
}

export default ScenarioRunner;
