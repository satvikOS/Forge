// Forge-244 — Three-phase power + PF correction + per-unit.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Three-phase power.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 680, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.threephase)
      || (typeof window !== 'undefined' && window.electron && window.electron.threephase);
}

function defaults() {
  return {
    mode: 'power',
    connection: 'star', lineLineVoltageV: 415, lineCurrentA: 100,
    powerFactor: 0.866, leading: false,
    pfRealPowerW: 100000, pf1: 0.8, pf2: 0.95, pfVLL: 415, pfF: 50,
    puBaseVA: 100e6, puBaseV: 138e3, puZ: 50,
  };
}

function ThreePhasePanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'power') {
        setResult({ kind: 'power', ...a.balancedPower({
          connection: inp.connection,
          lineLineVoltageV: inp.lineLineVoltageV,
          lineCurrentA: inp.lineCurrentA,
          powerFactor: inp.powerFactor,
          leading: inp.leading,
        })});
      } else if (inp.mode === 'pf') {
        setResult({ kind: 'pf', ...a.powerFactorCorrection({
          realPowerW: inp.pfRealPowerW,
          powerFactor1: inp.pf1, powerFactor2: inp.pf2,
          lineLineVoltageV: inp.pfVLL, frequencyHz: inp.pfF,
        })});
      } else {
        setResult({ kind: 'pu', ...a.perUnit({
          baseVA: inp.puBaseVA,
          baseVoltageLineLineV: inp.puBaseV,
          ohmicZ: inp.puZ,
        })});
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-threephase-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Three-phase · power / pf-correction / per-unit</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        S = √3·V_LL·I_L; P = S·cosφ; Q = S·sinφ. PF correction:
        ΔQ_c = P·(tanφ_1 − tanφ_2), C = ΔQ_c/(ω·V_LL²) (Δ-bank).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['power', 'Balanced power'], ['pf', 'PF correction'], ['pu', 'Per-unit'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-3p-tab-${mode}`}
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

      {inp.mode === 'power' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="connection">
            <select value={inp.connection} data-testid="forge-3p-conn"
                    onChange={(e) => update({ connection: e.target.value })}
                    style={fieldStyle}>
              <option value="star">star (Y)</option>
              <option value="delta">delta (Δ)</option>
            </select>
          </Field>
          <Field label="V_LL (V)">
            <input type="number" step="10" value={inp.lineLineVoltageV}
                   data-testid="forge-3p-VLL"
                   onChange={(e) => update({ lineLineVoltageV: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I_L (A)">
            <input type="number" step="5" value={inp.lineCurrentA}
                   data-testid="forge-3p-IL"
                   onChange={(e) => update({ lineCurrentA: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf">
            <input type="number" step="0.05" min="0" max="1" value={inp.powerFactor}
                   data-testid="forge-3p-pf"
                   onChange={(e) => update({ powerFactor: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="lead/lag">
            <select value={inp.leading ? 'lead' : 'lag'}
                    data-testid="forge-3p-leadlag"
                    onChange={(e) => update({ leading: e.target.value === 'lead' })}
                    style={fieldStyle}>
              <option value="lag">lag (inductive)</option>
              <option value="lead">lead (capacitive)</option>
            </select>
          </Field>
        </div>
      )}

      {inp.mode === 'pf' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="P (W)">
            <input type="number" step="1000" value={inp.pfRealPowerW}
                   data-testid="forge-3p-P"
                   onChange={(e) => update({ pfRealPowerW: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf₁">
            <input type="number" step="0.05" min="0" max="1" value={inp.pf1}
                   data-testid="forge-3p-pf1"
                   onChange={(e) => update({ pf1: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf₂">
            <input type="number" step="0.05" min="0" max="1" value={inp.pf2}
                   data-testid="forge-3p-pf2"
                   onChange={(e) => update({ pf2: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="V_LL (V)">
            <input type="number" step="10" value={inp.pfVLL}
                   data-testid="forge-3p-pfVLL"
                   onChange={(e) => update({ pfVLL: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="f (Hz)">
            <input type="number" step="1" value={inp.pfF}
                   data-testid="forge-3p-f"
                   onChange={(e) => update({ pfF: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      {inp.mode === 'pu' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="S_base (VA)">
            <input type="number" step="1e6" value={inp.puBaseVA}
                   data-testid="forge-3p-Sbase"
                   onChange={(e) => update({ puBaseVA: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="V_base (V_LL)">
            <input type="number" step="1000" value={inp.puBaseV}
                   data-testid="forge-3p-Vbase"
                   onChange={(e) => update({ puBaseV: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="Z (Ω)">
            <input type="number" step="1" value={inp.puZ}
                   data-testid="forge-3p-Z"
                   onChange={(e) => update({ puZ: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      <button data-testid="forge-threephase-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-threephase-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && result.kind === 'power' && (
        <section data-testid="forge-threephase-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>V_ph&nbsp;&nbsp;{result.phaseVoltageV.toFixed(1)} V&nbsp;&nbsp;
               I_ph&nbsp;&nbsp;{result.phaseCurrentA.toFixed(1)} A</div>
          <div>S&nbsp;&nbsp;{(result.apparentVA / 1000).toFixed(2)} kVA</div>
          <div>P&nbsp;&nbsp;{(result.realW / 1000).toFixed(2)} kW</div>
          <div data-testid="forge-threephase-Q"
               style={{ fontWeight: 700 }}>
            Q&nbsp;&nbsp;{(result.reactiveVAR / 1000).toFixed(2)} kVAR
            {result.reactiveVAR < 0 ? ' (lead)' : ' (lag)'}
          </div>
        </section>
      )}
      {result && result.kind === 'pf' && (
        <section data-testid="forge-threephase-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>φ₁&nbsp;{(result.phi1Rad * 180 / Math.PI).toFixed(2)}°&nbsp;&nbsp;
               φ₂&nbsp;{(result.phi2Rad * 180 / Math.PI).toFixed(2)}°</div>
          <div>Q₁&nbsp;&nbsp;{(result.reactiveBeforeVAR / 1000).toFixed(2)} kVAR</div>
          <div>Q₂&nbsp;&nbsp;{(result.reactiveAfterVAR / 1000).toFixed(2)} kVAR</div>
          <div data-testid="forge-threephase-Qc"
               style={{ fontWeight: 700 }}>
            ΔQ_c&nbsp;&nbsp;{(result.capacitorVAR / 1000).toFixed(2)} kVAR
          </div>
          <div data-testid="forge-threephase-C"
               style={{ fontWeight: 700 }}>
            C&nbsp;&nbsp;{(result.capacitanceF * 1e6).toFixed(2)} μF (Δ-bank)
          </div>
        </section>
      )}
      {result && result.kind === 'pu' && (
        <section data-testid="forge-threephase-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Z_base&nbsp;&nbsp;{result.baseImpedanceOhm.toFixed(2)} Ω</div>
          <div>I_base&nbsp;&nbsp;{result.baseCurrentA.toFixed(1)} A</div>
          <div data-testid="forge-threephase-Zpu"
               style={{ fontWeight: 700 }}>
            Z_pu&nbsp;&nbsp;{result.zpu.toFixed(4)}
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

export function ThreePhaseWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenThreePhaseWorkbench  = () => setOpen(true);
    window.__forgeCloseThreePhaseWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.threephase' || id === 'workbench.threephase') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'threephase') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ThreePhasePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ThreePhasePanel;
