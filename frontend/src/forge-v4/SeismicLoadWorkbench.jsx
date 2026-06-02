// Forge-234 — Seismic load (ASCE 7 §12.8) workbench.
//
// Equivalent lateral force: T_a → C_s → V = C_s · W with the basic
// C_s clamped between the S_D1 / T branch and the minimum clause.
//
// Per the Forge-233 rule: not added to the workbench rail. Reached
// via Tools menu → Structural → Loads & code → Seismic.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.seismic)
      || (typeof window !== 'undefined' && window.electron && window.electron.seismic);
}

function defaults() {
  return {
    system: 'steel-mrf', heightM: 20,
    SDS: 1.0, SD1: 0.6, TL: 8,
    R: 8, Ie: 1.0,
    seismicWeightKN: 5000,
  };
}

function SeismicPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const Ta = a.approximateFundamentalPeriod(inp.system, inp.heightM);
      const cs = a.seismicResponseCoefficient({
        SDS: inp.SDS, SD1: inp.SD1, T: Ta, TL: inp.TL, R: inp.R, Ie: inp.Ie,
      });
      const V_N = a.baseShear(cs.CsGoverning, inp.seismicWeightKN * 1000);
      setResult({ Ta, cs, V_N });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-seismic-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Seismic load · ASCE 7 §12.8</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        T_a = C_t·h_n^x; C_s = S_DS/(R/I_e), clamped between
        S_D1/(T·(R/I_e)) and the 0.044·S_DS·I_e floor; V = C_s·W.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="System">
          <select value={inp.system} data-testid="forge-seismic-system"
                  onChange={(e) => update({ system: e.target.value })}
                  style={fieldStyle}>
            <option value="steel-mrf">steel MRF</option>
            <option value="concrete-mrf">concrete MRF</option>
            <option value="steel-ebf">steel EBF</option>
            <option value="other">other</option>
          </select>
        </Field>
        <Field label="h_n (m)">
          <input type="number" step="1" value={inp.heightM}
                 data-testid="forge-seismic-h"
                 onChange={(e) => update({ heightM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S_DS (g)">
          <input type="number" step="0.05" value={inp.SDS}
                 data-testid="forge-seismic-SDS"
                 onChange={(e) => update({ SDS: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S_D1 (g)">
          <input type="number" step="0.05" value={inp.SD1}
                 data-testid="forge-seismic-SD1"
                 onChange={(e) => update({ SD1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="T_L (s)">
          <input type="number" step="1" value={inp.TL}
                 data-testid="forge-seismic-TL"
                 onChange={(e) => update({ TL: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="R">
          <input type="number" step="0.5" value={inp.R}
                 data-testid="forge-seismic-R"
                 onChange={(e) => update({ R: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="I_e">
          <input type="number" step="0.05" value={inp.Ie}
                 data-testid="forge-seismic-Ie"
                 onChange={(e) => update({ Ie: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="W (kN)">
          <input type="number" step="100" value={inp.seismicWeightKN}
                 data-testid="forge-seismic-W"
                 onChange={(e) => update({ seismicWeightKN: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-seismic-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-seismic-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-seismic-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>T_a (period)&nbsp;&nbsp;{result.Ta.toFixed(3)} s</div>
          <div>C_s basic&nbsp;&nbsp;&nbsp;&nbsp;{result.cs.CsBasic.toFixed(4)}</div>
          <div>C_s max&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.cs.CsMax.toFixed(4)}</div>
          <div>C_s min&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.cs.CsMin.toFixed(4)}</div>
          <div>C_s governing&nbsp;{result.cs.CsGoverning.toFixed(4)}</div>
          <div data-testid="forge-seismic-V"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Base shear V&nbsp;&nbsp;{(result.V_N / 1000).toFixed(1)} kN
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

export function SeismicLoadWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSeismicWorkbench  = () => setOpen(true);
    window.__forgeCloseSeismicWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.seismic' || id === 'workbench.seismic') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'seismic') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SeismicPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SeismicPanel;
