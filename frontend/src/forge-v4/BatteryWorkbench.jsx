// Forge-254 — Battery sizing: Peukert runtime + CC-CV charge + terminal V.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Battery → Battery sizing.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.battery)
      || (typeof window !== 'undefined' && window.electron && window.electron.battery);
}

function defaults() {
  return {
    mode: 'runtime',
    ratedCapacityAh: 100, ratedHours: 20, peukertExponent: 1.2,
    loadCurrentA: 50,
    chargeCurrentA: 20, initialSoc: 0.20, targetSoc: 0.95, cvPhaseFactor: 0.5,
    openCircuitVoltage: 12.6, internalResistanceOhm: 0.02,
  };
}

function BatteryPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'runtime') {
        setResult({ kind: 'runtime', ...a.runtime({
          ratedCapacityAh: inp.ratedCapacityAh, ratedHours: inp.ratedHours,
          peukertExponent: inp.peukertExponent, loadCurrentA: inp.loadCurrentA,
        })});
      } else if (inp.mode === 'charge') {
        setResult({ kind: 'charge', ...a.chargeTime({
          ratedCapacityAh: inp.ratedCapacityAh, chargeCurrentA: inp.chargeCurrentA,
          initialSoc: inp.initialSoc, targetSoc: inp.targetSoc,
          cvPhaseFactor: inp.cvPhaseFactor,
        })});
      } else {
        setResult({ kind: 'term', ...a.terminalState({
          openCircuitVoltage: inp.openCircuitVoltage,
          internalResistanceOhm: inp.internalResistanceOhm,
          loadCurrentA: inp.loadCurrentA,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-battery-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Battery sizing · Peukert + CC-CV + terminal V</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Peukert: C_eff = C·(C/(I·t_rated))^(n−1). CC-CV: t_cc = ΔSoC·C/I,
        t_total ≈ t_cc·(1 + cvFactor). Terminal: V = V_oc − I·R.
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['runtime', 'Runtime'], ['charge', 'Charge time'], ['terminal', 'Terminal V'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-battery-tab-${mode}`}
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

      {inp.mode === 'runtime' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="C_rated (Ah)">
            <input type="number" step="5" value={inp.ratedCapacityAh}
                   data-testid="forge-battery-Crated"
                   onChange={(e) => update({ ratedCapacityAh: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="t_rated (h)">
            <input type="number" step="1" value={inp.ratedHours}
                   data-testid="forge-battery-trated"
                   onChange={(e) => update({ ratedHours: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="n (Peukert)">
            <input type="number" step="0.05" min="1" value={inp.peukertExponent}
                   data-testid="forge-battery-n"
                   onChange={(e) => update({ peukertExponent: Number(e.target.value) || 1 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I (A)">
            <input type="number" step="1" value={inp.loadCurrentA}
                   data-testid="forge-battery-I"
                   onChange={(e) => update({ loadCurrentA: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      {inp.mode === 'charge' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="C_rated (Ah)">
            <input type="number" step="5" value={inp.ratedCapacityAh}
                   onChange={(e) => update({ ratedCapacityAh: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I_charge (A)">
            <input type="number" step="1" value={inp.chargeCurrentA}
                   data-testid="forge-battery-Ich"
                   onChange={(e) => update({ chargeCurrentA: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="SoC_i">
            <input type="number" step="0.05" min="0" max="1" value={inp.initialSoc}
                   data-testid="forge-battery-SoCi"
                   onChange={(e) => update({ initialSoc: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="SoC_f">
            <input type="number" step="0.05" min="0" max="1" value={inp.targetSoc}
                   data-testid="forge-battery-SoCf"
                   onChange={(e) => update({ targetSoc: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="cvFactor">
            <input type="number" step="0.1" min="0" value={inp.cvPhaseFactor}
                   onChange={(e) => update({ cvPhaseFactor: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      {inp.mode === 'terminal' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="V_oc (V)">
            <input type="number" step="0.05" value={inp.openCircuitVoltage}
                   data-testid="forge-battery-Voc"
                   onChange={(e) => update({ openCircuitVoltage: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="R_int (Ω)">
            <input type="number" step="0.005" value={inp.internalResistanceOhm}
                   data-testid="forge-battery-Rint"
                   onChange={(e) => update({ internalResistanceOhm: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I (A)">
            <input type="number" step="1" value={inp.loadCurrentA}
                   onChange={(e) => update({ loadCurrentA: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      <button data-testid="forge-battery-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-battery-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && result.kind === 'runtime' && (
        <section data-testid="forge-battery-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>C_eff&nbsp;{result.effectiveCapacityAh.toFixed(1)} Ah</div>
          <div data-testid="forge-battery-runtime"
               style={{ fontWeight: 700 }}>
            Runtime&nbsp;{result.runtimeHours.toFixed(2)} h
          </div>
        </section>
      )}
      {result && result.kind === 'charge' && (
        <section data-testid="forge-battery-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>t_cc&nbsp;{result.constantCurrentHours.toFixed(2)} h</div>
          <div>t_cv&nbsp;{result.constantVoltageHours.toFixed(2)} h</div>
          <div data-testid="forge-battery-charge"
               style={{ fontWeight: 700 }}>
            Total&nbsp;{result.totalHours.toFixed(2)} h
          </div>
        </section>
      )}
      {result && result.kind === 'term' && (
        <section data-testid="forge-battery-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>drop&nbsp;{result.dropV.toFixed(3)} V</div>
          <div data-testid="forge-battery-Vt"
               style={{ fontWeight: 700 }}>
            V_terminal&nbsp;{result.terminalVoltageV.toFixed(2)} V
          </div>
          <div data-testid="forge-battery-SoC"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            SoC&nbsp;{(result.stateOfCharge * 100).toFixed(0)}%
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

export function BatteryWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBatteryWorkbench  = () => setOpen(true);
    window.__forgeCloseBatteryWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.battery' || id === 'workbench.battery') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'battery') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BatteryPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BatteryPanel;
