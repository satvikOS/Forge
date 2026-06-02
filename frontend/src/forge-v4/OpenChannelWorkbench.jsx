// Forge-242 — Open-channel flow (Manning + critical / normal depth).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Open channel → Open channel.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.openchannel)
      || (typeof window !== 'undefined' && window.electron && window.electron.openchannel);
}

function defaults() {
  return {
    bottomWidthM: 3, sideSlopeM: 2,
    manningN: 0.025, slope: 0.0015,
    targetDischarge: 24.1,
  };
}

function OpenChannelPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const geom = { bottomWidthM: inp.bottomWidthM, sideSlopeM: inp.sideSlopeM };
      const y_n = a.normalDepth({
        geom, manningN: inp.manningN, slope: inp.slope,
        targetDischarge: inp.targetDischarge,
      });
      const y_c = a.criticalDepth({
        geom, dischargeQ: inp.targetDischarge, gravityG: 9.81,
      });
      const reg = a.flowRegime({
        geom, depthM: y_n,
        dischargeQ: inp.targetDischarge, gravityG: 9.81,
      });
      setResult({ y_n, y_c, ...reg });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-openchan-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Open channel · Manning + critical depth</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Trapezoidal channel. Q = (1/n)·A·R^(2/3)·√S; y_n via Newton;
        y_c from Q²·T/(g·A³) = 1; Fr = V/√(g·A/T).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="b (m)">
          <input type="number" step="0.5" value={inp.bottomWidthM}
                 data-testid="forge-openchan-b"
                 onChange={(e) => update({ bottomWidthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="m (side)">
          <input type="number" step="0.5" value={inp.sideSlopeM}
                 data-testid="forge-openchan-m"
                 onChange={(e) => update({ sideSlopeM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="n (Manning)">
          <input type="number" step="0.001" value={inp.manningN}
                 data-testid="forge-openchan-n"
                 onChange={(e) => update({ manningN: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S (m/m)">
          <input type="number" step="0.0001" value={inp.slope}
                 data-testid="forge-openchan-S"
                 onChange={(e) => update({ slope: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Q (m³/s)">
          <input type="number" step="0.5" value={inp.targetDischarge}
                 data-testid="forge-openchan-Q"
                 onChange={(e) => update({ targetDischarge: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-openchan-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-openchan-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-openchan-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>y_n (normal)&nbsp;&nbsp;{result.y_n.toFixed(3)} m</div>
          <div>y_c (critical)&nbsp;&nbsp;{result.y_c.toFixed(3)} m</div>
          <div>A&nbsp;&nbsp;{result.area.toFixed(2)} m²&nbsp;&nbsp;
               T&nbsp;&nbsp;{result.topWidth.toFixed(2)} m&nbsp;&nbsp;
               D_h&nbsp;&nbsp;{result.hydraulicDepth.toFixed(2)} m</div>
          <div>V&nbsp;&nbsp;{result.velocity.toFixed(2)} m/s</div>
          <div data-testid="forge-openchan-fr"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.regime === 1 ? '#4ade80'
                             : result.regime === -1 ? '#fbbf24'
                             : '#a78bfa' }}>
            Fr&nbsp;&nbsp;{result.froude.toFixed(3)}&nbsp;&nbsp;
            ({result.regime === 1  ? 'SUBCRITICAL'
            : result.regime === -1 ? 'SUPERCRITICAL'
            : 'CRITICAL'})
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

export function OpenChannelWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenOpenChanWorkbench  = () => setOpen(true);
    window.__forgeCloseOpenChanWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.openchan' || id === 'workbench.openchan') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'openchan') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <OpenChannelPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default OpenChannelPanel;
