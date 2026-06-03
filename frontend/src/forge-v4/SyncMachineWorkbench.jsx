// Forge-249 — Cylindrical-rotor synchronous machine.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Synchronous machine.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 660, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.syncmachine)
      || (typeof window !== 'undefined' && window.electron && window.electron.syncmachine);
}

function defaults() {
  return {
    mode: 'generator',
    terminalPhaseVoltageV: 277, synchronousReactanceOhm: 1.0,
    armatureResistanceOhm: 0,
    realPowerPerPhaseW: 200000,
    powerFactor: 0.8, leading: false,
  };
}

function SyncMPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try { setResult(api().analyse(inp)); }
    catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-syncm-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Synchronous machine · cylindrical rotor</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Generator: E_f = V_t + jX_s·I_a. Motor: E_f = V_t − jX_s·I_a.
        P = |V_t||E_f|sinδ/X_s; Q = |V_t|(|E_f|cosδ − |V_t|)/X_s.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="mode">
          <select value={inp.mode} data-testid="forge-syncm-mode"
                  onChange={(e) => update({ mode: e.target.value })}
                  style={fieldStyle}>
            <option value="generator">generator</option>
            <option value="motor">motor</option>
          </select>
        </Field>
        <Field label="V_t (V)">
          <input type="number" step="10" value={inp.terminalPhaseVoltageV}
                 data-testid="forge-syncm-Vt"
                 onChange={(e) => update({ terminalPhaseVoltageV: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="X_s (Ω)">
          <input type="number" step="0.1" value={inp.synchronousReactanceOhm}
                 data-testid="forge-syncm-Xs"
                 onChange={(e) => update({ synchronousReactanceOhm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="R_a (Ω)">
          <input type="number" step="0.01" value={inp.armatureResistanceOhm}
                 data-testid="forge-syncm-Ra"
                 onChange={(e) => update({ armatureResistanceOhm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="P/φ (W)">
          <input type="number" step="10000" value={inp.realPowerPerPhaseW}
                 data-testid="forge-syncm-P"
                 onChange={(e) => update({ realPowerPerPhaseW: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="pf">
          <input type="number" step="0.05" min="0" max="1" value={inp.powerFactor}
                 data-testid="forge-syncm-pf"
                 onChange={(e) => update({ powerFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="lead/lag">
          <select value={inp.leading ? 'lead' : 'lag'}
                  onChange={(e) => update({ leading: e.target.value === 'lead' })}
                  style={fieldStyle}>
            <option value="lag">lag</option>
            <option value="lead">lead</option>
          </select>
        </Field>
      </div>

      <button data-testid="forge-syncm-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-syncm-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-syncm-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>I_a&nbsp;{result.armatureCurrentA.toFixed(1)} A ∠{result.armatureCurrentAngDeg.toFixed(2)}°</div>
          <div data-testid="forge-syncm-Ef"
               style={{ marginTop: 4, fontWeight: 700 }}>
            E_f&nbsp;{result.inducedEmfV.toFixed(1)} V ∠δ={result.inducedEmfAngDeg.toFixed(2)}°
          </div>
          <div>Q/φ&nbsp;{(result.reactivePowerPerPhaseVar / 1000).toFixed(2)} kVAR</div>
          <div data-testid="forge-syncm-Pmax"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            P_max/φ&nbsp;{(result.maxPullOutPowerW / 1000).toFixed(1)} kW (at δ=90°)
          </div>
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

export function SyncMachineWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSyncMWorkbench  = () => setOpen(true);
    window.__forgeCloseSyncMWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.syncm' || id === 'workbench.syncm') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'syncm') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SyncMPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SyncMPanel;
