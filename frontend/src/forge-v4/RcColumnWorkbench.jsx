// Forge-257 — RC column ACI 318-19 §22.4 (axial + balanced interaction).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Structural → Concrete → RC column.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.rccolumn)
      || (typeof window !== 'undefined' && window.electron && window.electron.rccolumn);
}

function defaults() {
  return {
    tieType: 'tied',
    grossAreaM2: 0.16, effectiveDepthM: 0.34, overallDepthM: 0.4,
    widthM: 0.4, coverM: 0.06,
    steelAreaTotalM2: 2.322e-3,
    concreteFcPa: 28e6, steelFyPa: 414e6,
  };
}

function RcColPanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-rccolumn-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>RC column · ACI 318-19 §22.4</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        P_no = 0.85·f'_c·(A_g−A_st) + f_y·A_st; tied φ=0.65 max=0.80;
        spiral φ=0.75 max=0.85. Balanced: c_b=0.6·d, a_b=β_1·c_b →
        P_nb, M_nb (symmetric reinforcement).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="tie type">
          <select value={inp.tieType} data-testid="forge-rccolumn-tie"
                  onChange={(e) => update({ tieType: e.target.value })}
                  style={fieldStyle}>
            <option value="tied">tied</option>
            <option value="spiral">spiral</option>
          </select>
        </Field>
        <Field label="A_g (m²)">
          <input type="number" step="0.01" value={inp.grossAreaM2}
                 data-testid="forge-rccolumn-Ag"
                 onChange={(e) => update({ grossAreaM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="b (m)">
          <input type="number" step="0.05" value={inp.widthM}
                 data-testid="forge-rccolumn-b"
                 onChange={(e) => update({ widthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h (m)">
          <input type="number" step="0.05" value={inp.overallDepthM}
                 data-testid="forge-rccolumn-h"
                 onChange={(e) => update({ overallDepthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d (m)">
          <input type="number" step="0.05" value={inp.effectiveDepthM}
                 data-testid="forge-rccolumn-d"
                 onChange={(e) => update({ effectiveDepthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d' (m)">
          <input type="number" step="0.01" value={inp.coverM}
                 data-testid="forge-rccolumn-dp"
                 onChange={(e) => update({ coverM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A_st (m²)">
          <input type="number" step="1e-4" value={inp.steelAreaTotalM2}
                 data-testid="forge-rccolumn-Ast"
                 onChange={(e) => update({ steelAreaTotalM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f'_c (Pa)">
          <input type="number" step="5e6" value={inp.concreteFcPa}
                 data-testid="forge-rccolumn-fc"
                 onChange={(e) => update({ concreteFcPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f_y (Pa)">
          <input type="number" step="10e6" value={inp.steelFyPa}
                 data-testid="forge-rccolumn-fy"
                 onChange={(e) => update({ steelFyPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-rccolumn-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-rccolumn-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-rccolumn-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>β_1&nbsp;&nbsp;{result.beta1.toFixed(3)}&nbsp;&nbsp;
               φ&nbsp;&nbsp;{result.phi.toFixed(2)}&nbsp;&nbsp;
               max&nbsp;&nbsp;{result.maxFactor.toFixed(2)}</div>
          <div>P_no (nominal)&nbsp;&nbsp;{(result.nominalAxialN / 1000).toFixed(0)} kN</div>
          <div data-testid="forge-rccolumn-Pmax"
               style={{ marginTop: 4, fontWeight: 700 }}>
            φPn,max&nbsp;&nbsp;{(result.designMaxAxialN / 1000).toFixed(0)} kN
          </div>
          <div style={{ marginTop: 6 }}>
            P_nb (balanced)&nbsp;&nbsp;{(result.balancedAxialN / 1000).toFixed(0)} kN
          </div>
          <div>M_nb&nbsp;&nbsp;{(result.balancedMomentNm / 1000).toFixed(0)} kN·m</div>
          <div data-testid="forge-rccolumn-PMb"
               style={{ marginTop: 4, fontWeight: 700, color: '#fbbf24' }}>
            φP_nb / φM_nb&nbsp;&nbsp;{(result.designBalancedAxialN / 1000).toFixed(0)} kN
            /&nbsp;{(result.designBalancedMomentNm / 1000).toFixed(0)} kN·m
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

export function RcColumnWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRcColumnWorkbench  = () => setOpen(true);
    window.__forgeCloseRcColumnWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.rccolumn' || id === 'workbench.rccolumn') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'rccolumn') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RcColPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default RcColPanel;
