// Forge-245 — Transformer OC + SC + regulation + efficiency.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Transformer.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.transformer)
      || (typeof window !== 'undefined' && window.electron && window.electron.transformer);
}

function defaults() {
  return {
    // OC test (LV)
    ocV: 415, ocI: 5, ocP: 250,
    // SC test (HV)
    scV: 400, scI: 4.545, scP: 800,
    // Reg + η
    ratedKva: 50, ratedHvV: 11000, ratedHvI: 4.545,
    pf: 0.8, leading: false, loadFraction: 1.0,
  };
}

function XfmrPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const oc = a.openCircuitTest({
        openCircuitVoltageV: inp.ocV, openCircuitCurrentA: inp.ocI,
        openCircuitPowerW: inp.ocP,
      });
      const sc = a.shortCircuitTest({
        shortCircuitCurrentA: inp.scI, shortCircuitVoltageV: inp.scV,
        shortCircuitPowerW: inp.scP,
      });
      const reg = a.voltageRegulation({
        equivalentResistanceOhm: sc.equivalentResistanceOhm,
        equivalentReactanceOhm:  sc.equivalentReactanceOhm,
        ratedHvCurrentA: inp.ratedHvI, loadFraction: inp.loadFraction,
        powerFactor: inp.pf, leading: inp.leading,
        ratedHvVoltageV: inp.ratedHvV,
      });
      const eff = a.efficiency({
        ratedKva: inp.ratedKva, openCircuitPowerW: inp.ocP,
        shortCircuitPowerW: inp.scP, loadFraction: inp.loadFraction,
        powerFactor: inp.pf,
      });
      const xstar = a.maximumEfficiencyLoadFraction(inp.ocP, inp.scP);
      setResult({ oc, sc, reg, eff, xstar });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-xformer-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Transformer · OC + SC + regulation + η</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        OC → R_c, X_m. SC → R_eq, Z_eq, X_eq. Reg = I_L·(R·cosφ ± X·sinφ)/V.
        η = (x·S·cosφ)/(x·S·cosφ + P_oc + x²·P_sc); peak at √(P_oc/P_sc).
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>OC test (LV)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="V_oc">
            <input type="number" step="5" value={inp.ocV}
                   data-testid="forge-xformer-ocV"
                   onChange={(e) => update({ ocV: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I_oc">
            <input type="number" step="0.1" value={inp.ocI}
                   data-testid="forge-xformer-ocI"
                   onChange={(e) => update({ ocI: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="P_oc">
            <input type="number" step="10" value={inp.ocP}
                   data-testid="forge-xformer-ocP"
                   onChange={(e) => update({ ocP: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>SC test (HV)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="V_sc">
            <input type="number" step="5" value={inp.scV}
                   data-testid="forge-xformer-scV"
                   onChange={(e) => update({ scV: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I_sc">
            <input type="number" step="0.1" value={inp.scI}
                   data-testid="forge-xformer-scI"
                   onChange={(e) => update({ scI: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="P_sc">
            <input type="number" step="10" value={inp.scP}
                   data-testid="forge-xformer-scP"
                   onChange={(e) => update({ scP: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>Loading + ratings</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="kVA">
            <input type="number" step="1" value={inp.ratedKva}
                   data-testid="forge-xformer-kVA"
                   onChange={(e) => update({ ratedKva: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="V_HV">
            <input type="number" step="100" value={inp.ratedHvV}
                   data-testid="forge-xformer-VHV"
                   onChange={(e) => update({ ratedHvV: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I_HV rated">
            <input type="number" step="0.1" value={inp.ratedHvI}
                   data-testid="forge-xformer-IHV"
                   onChange={(e) => update({ ratedHvI: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf">
            <input type="number" step="0.05" min="0" max="1" value={inp.pf}
                   data-testid="forge-xformer-pf"
                   onChange={(e) => update({ pf: Number(e.target.value) || 0 })}
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
          <Field label="x (load)">
            <input type="number" step="0.05" min="0" value={inp.loadFraction}
                   data-testid="forge-xformer-x"
                   onChange={(e) => update({ loadFraction: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <button data-testid="forge-xformer-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-xformer-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-xformer-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>OC results</div>
          <div>cosφ_oc&nbsp;{result.oc.cosPhiOc.toFixed(4)}&nbsp;&nbsp;
               R_c&nbsp;{result.oc.coreResistanceOhm.toFixed(1)} Ω&nbsp;&nbsp;
               X_m&nbsp;{result.oc.magnetisingReactanceOhm.toFixed(1)} Ω</div>
          <div style={{ color: 'var(--forge-ink-mute)', marginTop: 4 }}>SC results</div>
          <div>R_eq&nbsp;{result.sc.equivalentResistanceOhm.toFixed(2)} Ω&nbsp;&nbsp;
               Z_eq&nbsp;{result.sc.equivalentImpedanceOhm.toFixed(2)} Ω&nbsp;&nbsp;
               X_eq&nbsp;{result.sc.equivalentReactanceOhm.toFixed(2)} Ω</div>
          <div data-testid="forge-xformer-reg"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Regulation&nbsp;{result.reg.regulationPct.toFixed(2)}% ({result.reg.voltageDropV.toFixed(1)} V)
          </div>
          <div data-testid="forge-xformer-eta"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            η&nbsp;{(result.eff * 100).toFixed(2)}% &nbsp;
            x*&nbsp;{result.xstar.toFixed(3)} (max-η load fraction)
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

export function TransformerWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenXformerWorkbench  = () => setOpen(true);
    window.__forgeCloseXformerWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.xformer' || id === 'workbench.xformer') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'xformer') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <XfmrPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default XfmrPanel;
