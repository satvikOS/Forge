// Forge-266 — Orifice plate flow meter (ISO 5167-2).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Pipe & duct flow → Orifice plate.
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
  width: 130, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.orificeplate)
      || (typeof window !== 'undefined' && window.electron && window.electron.orificeplate);
}

function defaults() {
  return {
    pipeDiameterM: 0.1, orificeDiameterM: 0.05,
    upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
    differentialPressurePa: 500000,
    compressible: false, kappaSpecHeatRatio: 1.4,
    upstreamPressurePa: 0,
  };
}

function OrificePanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-orifice-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Orifice plate · ISO 5167-2</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ṁ = (C·ε/√(1−β⁴))·A_d·√(2·ρ·ΔP). C from Reader-Harris/Gallagher
        (corner taps). ε = 1 for liquids; gas form per ISO 5167-2.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="D (m)">
          <input type="number" step="0.01" value={inp.pipeDiameterM}
                 data-testid="forge-orifice-D"
                 onChange={(e) => update({ pipeDiameterM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d (m)">
          <input type="number" step="0.005" value={inp.orificeDiameterM}
                 data-testid="forge-orifice-d"
                 onChange={(e) => update({ orificeDiameterM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ρ (kg/m³)">
          <input type="number" step="100" value={inp.upstreamDensityKgM3}
                 data-testid="forge-orifice-rho"
                 onChange={(e) => update({ upstreamDensityKgM3: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="μ (Pa·s)">
          <input type="number" step="1e-4" value={inp.dynamicViscosityPas}
                 data-testid="forge-orifice-mu"
                 onChange={(e) => update({ dynamicViscosityPas: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ΔP (Pa)">
          <input type="number" step="10000" value={inp.differentialPressurePa}
                 data-testid="forge-orifice-dP"
                 onChange={(e) => update({ differentialPressurePa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="phase">
          <select value={inp.compressible ? 'gas' : 'liquid'}
                  data-testid="forge-orifice-phase"
                  onChange={(e) => update({ compressible: e.target.value === 'gas' })}
                  style={fieldStyle}>
            <option value="liquid">liquid (ε=1)</option>
            <option value="gas">gas (ε &lt; 1)</option>
          </select>
        </Field>
        {inp.compressible && (<>
          <Field label="κ (c_p/c_v)">
            <input type="number" step="0.05" value={inp.kappaSpecHeatRatio}
                   data-testid="forge-orifice-kappa"
                   onChange={(e) => update({ kappaSpecHeatRatio: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="p₁ (Pa)">
            <input type="number" step="10000" value={inp.upstreamPressurePa}
                   data-testid="forge-orifice-p1"
                   onChange={(e) => update({ upstreamPressurePa: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
      </div>

      <button data-testid="forge-orifice-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-orifice-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-orifice-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>β&nbsp;{result.betaRatio.toFixed(3)}&nbsp;&nbsp;
               A_d&nbsp;{(result.throatAreaM2 * 1e4).toFixed(2)} cm²&nbsp;&nbsp;
               Re_D&nbsp;{result.reynoldsNumberD.toExponential(2)}</div>
          <div>C&nbsp;{result.dischargeCoefficient.toFixed(4)}&nbsp;&nbsp;
               ε&nbsp;{result.expansibilityFactor.toFixed(4)}</div>
          <div data-testid="forge-orifice-m"
               style={{ marginTop: 4, fontWeight: 700 }}>
            ṁ&nbsp;{result.massFlowKgS.toFixed(3)} kg/s
          </div>
          <div data-testid="forge-orifice-Q"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            Q&nbsp;{(result.volumeFlowM3S * 1000).toFixed(2)} L/s
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

export function OrificePlateWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenOrificeWorkbench  = () => setOpen(true);
    window.__forgeCloseOrificeWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.orifice' || id === 'workbench.orifice') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'orifice') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <OrificePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default OrificePanel;
