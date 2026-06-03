// Forge-262 — Boiler efficiency (Direct + Indirect methods).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Combustion → Boiler efficiency.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.boilereff)
      || (typeof window !== 'undefined' && window.electron && window.electron.boilereff);
}

function defaults() {
  return {
    mode: 'direct',
    steamFlowKgPerS: 5, feedwaterEnthalpyKjPerKg: 100,
    steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.4,
    heatingValueKjPerKg: 42000,
    dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
    flueGasTempC: 250, ambientTempC: 25,
    dryFlueGasCpKjPerKgK: 1.005, radiationLossPct: 2.0,
  };
}

function BoilerPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'direct') {
        setResult({ kind: 'direct', ...a.directMethod({
          steamFlowKgPerS: inp.steamFlowKgPerS,
          feedwaterEnthalpyKjPerKg: inp.feedwaterEnthalpyKjPerKg,
          steamEnthalpyKjPerKg: inp.steamEnthalpyKjPerKg,
          fuelFlowKgPerS: inp.fuelFlowKgPerS,
          heatingValueKjPerKg: inp.heatingValueKjPerKg,
        })});
      } else {
        setResult({ kind: 'indirect', ...a.indirectMethod({
          dryFlueGasKgPerKgFuel: inp.dryFlueGasKgPerKgFuel,
          moistureKgPerKgFuel: inp.moistureKgPerKgFuel,
          flueGasTempC: inp.flueGasTempC,
          ambientTempC: inp.ambientTempC,
          heatingValueKjPerKg: inp.heatingValueKjPerKg,
          dryFlueGasCpKjPerKgK: inp.dryFlueGasCpKjPerKgK,
          radiationLossPct: inp.radiationLossPct,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-boilereff-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Boiler efficiency · Direct + Indirect</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Direct: η = m_steam·(h_out−h_in)/(m_fuel·HV). Indirect:
        η = 100 − (L₁ dry flue + L₂ water vapour + L₃ radiation).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['direct', 'Direct method'], ['indirect', 'Indirect method'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-boilereff-tab-${mode}`}
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

      <Field label="HV (kJ/kg)">
        <input type="number" step="1000" value={inp.heatingValueKjPerKg}
               data-testid="forge-boilereff-HV"
               onChange={(e) => update({ heatingValueKjPerKg: Number(e.target.value) || 0 })}
               style={fieldStyle} />
      </Field>

      {inp.mode === 'direct' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="m_steam (kg/s)">
            <input type="number" step="0.5" value={inp.steamFlowKgPerS}
                   data-testid="forge-boilereff-mst"
                   onChange={(e) => update({ steamFlowKgPerS: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="h_in (kJ/kg)">
            <input type="number" step="10" value={inp.feedwaterEnthalpyKjPerKg}
                   data-testid="forge-boilereff-hin"
                   onChange={(e) => update({ feedwaterEnthalpyKjPerKg: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="h_out (kJ/kg)">
            <input type="number" step="100" value={inp.steamEnthalpyKjPerKg}
                   data-testid="forge-boilereff-hout"
                   onChange={(e) => update({ steamEnthalpyKjPerKg: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="m_fuel (kg/s)">
            <input type="number" step="0.05" value={inp.fuelFlowKgPerS}
                   data-testid="forge-boilereff-mf"
                   onChange={(e) => update({ fuelFlowKgPerS: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      {inp.mode === 'indirect' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="m_dfg (kg/kg)">
            <input type="number" step="1" value={inp.dryFlueGasKgPerKgFuel}
                   data-testid="forge-boilereff-mdfg"
                   onChange={(e) => update({ dryFlueGasKgPerKgFuel: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="m_H2O (kg/kg)">
            <input type="number" step="0.05" value={inp.moistureKgPerKgFuel}
                   data-testid="forge-boilereff-mH2O"
                   onChange={(e) => update({ moistureKgPerKgFuel: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="T_flue (°C)">
            <input type="number" step="10" value={inp.flueGasTempC}
                   data-testid="forge-boilereff-Tflue"
                   onChange={(e) => update({ flueGasTempC: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="T_amb (°C)">
            <input type="number" step="1" value={inp.ambientTempC}
                   data-testid="forge-boilereff-Tamb"
                   onChange={(e) => update({ ambientTempC: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="cp_dfg (kJ/kgK)">
            <input type="number" step="0.005" value={inp.dryFlueGasCpKjPerKgK}
                   data-testid="forge-boilereff-cp"
                   onChange={(e) => update({ dryFlueGasCpKjPerKgK: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="L₃ radiation %">
            <input type="number" step="0.5" value={inp.radiationLossPct}
                   data-testid="forge-boilereff-L3"
                   onChange={(e) => update({ radiationLossPct: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      <button data-testid="forge-boilereff-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-boilereff-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && result.kind === 'direct' && (
        <section data-testid="forge-boilereff-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Q_out&nbsp;{(result.heatOutputKw / 1000).toFixed(2)} MW</div>
          <div>Q_in&nbsp;&nbsp;{(result.heatInputKw / 1000).toFixed(2)} MW</div>
          <div data-testid="forge-boilereff-eta"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.efficiencyPct > 85 ? '#4ade80'
                             : result.efficiencyPct > 70 ? '#fbbf24' : '#ff6363' }}>
            η_direct&nbsp;{result.efficiencyPct.toFixed(2)}%
          </div>
        </section>
      )}
      {result && result.kind === 'indirect' && (
        <section data-testid="forge-boilereff-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>L₁ dry flue gas&nbsp;{result.dryFlueGasLossPct.toFixed(2)}%</div>
          <div>L₂ water vapour&nbsp;{result.waterVapourLossPct.toFixed(2)}%</div>
          <div>L₃ radiation&nbsp;{result.radiationLossPct.toFixed(2)}%</div>
          <div>total losses&nbsp;{result.totalLossesPct.toFixed(2)}%</div>
          <div data-testid="forge-boilereff-eta"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.efficiencyPct > 85 ? '#4ade80'
                             : result.efficiencyPct > 70 ? '#fbbf24' : '#ff6363' }}>
            η_indirect&nbsp;{result.efficiencyPct.toFixed(2)}%
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

export function BoilerEfficiencyWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBoilerEffWorkbench  = () => setOpen(true);
    window.__forgeCloseBoilerEffWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.boilereff' || id === 'workbench.boilereff') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'boilereff') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BoilerPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BoilerPanel;
