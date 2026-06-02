// Forge-239 — Soil bearing capacity (Terzaghi + Meyerhof).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Site & civil → Foundations → Bearing capacity.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.bearingcap)
      || (typeof window !== 'undefined' && window.electron && window.electron.bearingcap);
}

function defaults() {
  return {
    shape: 'strip', widthM: 1.5, depthM: 1.0,
    cohesionPa: 30000, surchargeKnPerM3: 18000,
    frictionAngleDeg: 25, factorOfSafety: 3,
  };
}

function BearingCapPanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-bearingcap-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Bearing capacity · Terzaghi + Meyerhof</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        q_ult = c·N_c·s_c·d_c + q·N_q·s_q·d_q + ½·γ·B·N_γ·s_γ·d_γ.
        Meyerhof N-factors; Brinch-Hansen depth (D/B ≤ 1); strip /
        square / circular shape.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Shape">
          <select value={inp.shape} data-testid="forge-bearingcap-shape"
                  onChange={(e) => update({ shape: e.target.value })}
                  style={fieldStyle}>
            <option value="strip">strip</option>
            <option value="square">square</option>
            <option value="circular">circular</option>
          </select>
        </Field>
        <Field label="B (m)">
          <input type="number" step="0.1" value={inp.widthM}
                 data-testid="forge-bearingcap-B"
                 onChange={(e) => update({ widthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="D (m)">
          <input type="number" step="0.1" value={inp.depthM}
                 data-testid="forge-bearingcap-D"
                 onChange={(e) => update({ depthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="c (Pa)">
          <input type="number" step="5000" value={inp.cohesionPa}
                 data-testid="forge-bearingcap-c"
                 onChange={(e) => update({ cohesionPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="γ (N/m³)">
          <input type="number" step="500" value={inp.surchargeKnPerM3}
                 data-testid="forge-bearingcap-gamma"
                 onChange={(e) => update({ surchargeKnPerM3: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="φ (°)">
          <input type="number" step="1" min="0" max="50" value={inp.frictionAngleDeg}
                 data-testid="forge-bearingcap-phi"
                 onChange={(e) => update({ frictionAngleDeg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="FS">
          <input type="number" step="0.5" value={inp.factorOfSafety}
                 data-testid="forge-bearingcap-FS"
                 onChange={(e) => update({ factorOfSafety: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-bearingcap-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-bearingcap-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-bearingcap-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>N_c&nbsp;&nbsp;{result.Nc.toFixed(2)}&nbsp;&nbsp;
               N_q&nbsp;&nbsp;{result.Nq.toFixed(2)}&nbsp;&nbsp;
               N_γ&nbsp;&nbsp;{result.Ngamma.toFixed(2)}</div>
          <div>s_c·d_c&nbsp;&nbsp;{(result.shapeFactorC * result.depthFactorC).toFixed(3)}</div>
          <div>s_q·d_q&nbsp;&nbsp;{(result.shapeFactorQ * result.depthFactorQ).toFixed(3)}</div>
          <div>s_γ·d_γ&nbsp;&nbsp;{(result.shapeFactorGamma * result.depthFactorGamma).toFixed(3)}</div>
          <div>q (surcharge)&nbsp;{(result.surchargePa / 1000).toFixed(2)} kPa</div>
          <div>q_ult&nbsp;&nbsp;{(result.ultimateBearingPa / 1000).toFixed(0)} kPa
               ({(result.ultimateBearingPa / 1e6).toFixed(3)} MPa)</div>
          <div data-testid="forge-bearingcap-qa"
               style={{ marginTop: 4, fontWeight: 700 }}>
            q_allow&nbsp;&nbsp;{(result.allowableBearingPa / 1000).toFixed(0)} kPa
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

export function BearingCapacityWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBearingCapWorkbench  = () => setOpen(true);
    window.__forgeCloseBearingCapWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bearingcap' || id === 'workbench.bearingcap') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'bearingcap') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BearingCapPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BearingCapPanel;
