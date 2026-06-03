// Forge-264 — PID tuning (Ziegler-Nichols + Cohen-Coon).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Operations → Control → PID tuning.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 640, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '6px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const fieldStyle = {
  width: 110, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.pidtuning)
      || (typeof window !== 'undefined' && window.electron && window.electron.pidtuning);
}

function defaults() {
  return {
    mode: 'zn',
    controller: 'PID',
    ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
    processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
  };
}

function PIDPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'zn') {
        setResult({ method: 'Ziegler-Nichols', ...a.zieglerNichols({
          controller: inp.controller,
          ultimateGainKu: inp.ultimateGainKu,
          ultimatePeriodPuSec: inp.ultimatePeriodPuSec,
        })});
      } else {
        setResult({ method: 'Cohen-Coon', ...a.cohenCoon({
          controller: inp.controller,
          processGainKp: inp.processGainKp,
          timeConstantTau: inp.timeConstantTau,
          deadTimeTheta: inp.deadTimeTheta,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-pidtune-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>PID tuning · Ziegler-Nichols + Cohen-Coon</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ZN: closed-loop K_u / P_u → P / PI / PID gains. Cohen-Coon:
        FOPDT K_p, τ, θ → optimal Kp, Ti, Td.
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['zn', 'Ziegler-Nichols'], ['cc', 'Cohen-Coon'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-pidtune-tab-${mode}`}
                  onClick={() => update({ mode })}
                  style={{ flex: 1, padding: '4px 8px', cursor: 'pointer',
                           fontWeight: 700,
                           background: inp.mode === mode ? 'var(--forge-accent)' : 'var(--forge-canvas)',
                           color: inp.mode === mode ? '#0a0e14' : 'var(--forge-ink)',
                           border: '1px solid var(--forge-rail-edge)' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="controller">
          <select value={inp.controller} data-testid="forge-pidtune-ctrl"
                  onChange={(e) => update({ controller: e.target.value })}
                  style={fieldStyle}>
            <option value="P">P</option>
            <option value="PI">PI</option>
            <option value="PID">PID</option>
          </select>
        </Field>
        {inp.mode === 'zn' && (<>
          <Field label="K_u">
            <input type="number" step="0.5" value={inp.ultimateGainKu}
                   data-testid="forge-pidtune-Ku"
                   onChange={(e) => update({ ultimateGainKu: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="P_u (s)">
            <input type="number" step="1" value={inp.ultimatePeriodPuSec}
                   data-testid="forge-pidtune-Pu"
                   onChange={(e) => update({ ultimatePeriodPuSec: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
        {inp.mode === 'cc' && (<>
          <Field label="K_p (gain)">
            <input type="number" step="0.5" value={inp.processGainKp}
                   data-testid="forge-pidtune-Kp"
                   onChange={(e) => update({ processGainKp: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="τ (s)">
            <input type="number" step="1" value={inp.timeConstantTau}
                   data-testid="forge-pidtune-tau"
                   onChange={(e) => update({ timeConstantTau: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="θ (s, deadtime)">
            <input type="number" step="0.5" value={inp.deadTimeTheta}
                   data-testid="forge-pidtune-theta"
                   onChange={(e) => update({ deadTimeTheta: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
      </div>

      <button data-testid="forge-pidtune-run" style={buttonStyle} onClick={onCompute}>
        Compute gains
      </button>

      {err && (
        <div data-testid="forge-pidtune-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pidtune-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 2 }}>
            {result.method} · {inp.controller}
          </div>
          <div data-testid="forge-pidtune-Kp"
               style={{ fontWeight: 700 }}>
            K_p&nbsp;{result.Kp.toFixed(3)}
          </div>
          {inp.controller !== 'P' && (
            <div data-testid="forge-pidtune-Ti"
                 style={{ fontWeight: 700, color: '#fbbf24' }}>
              T_i&nbsp;{result.Ti.toFixed(3)} s
            </div>
          )}
          {inp.controller === 'PID' && (
            <div data-testid="forge-pidtune-Td"
                 style={{ fontWeight: 700, color: '#a78bfa' }}>
              T_d&nbsp;{result.Td.toFixed(3)} s
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--forge-ink-mute)' }}>{label}</span>
      {children}
    </label>
  );
}

export function PIDTuningWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPIDTuneWorkbench  = () => setOpen(true);
    window.__forgeClosePIDTuneWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pidtune' || id === 'workbench.pidtune') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pidtune') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PIDPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PIDPanel;
