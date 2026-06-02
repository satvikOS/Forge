// Forge-243 — Sharp-crested weir / V-notch / orifice flow.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Open channel → Weir / V-notch / orifice.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.weir)
      || (typeof window !== 'undefined' && window.electron && window.electron.weir);
}

function defaults() {
  return {
    mode: 'rect',
    crestLengthM: 2.0, headM: 0.3,
    rectCd: 0.62, endContractions: 0,
    notchAngleDeg: 90, vCd: 0.58, vHeadM: 0.2,
    orifAreaM2: 0.01, orifHeadM: 1.5, orifCd: 0.62,
  };
}

function WeirPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      let Q;
      if (inp.mode === 'rect') {
        Q = a.rectWeirDischarge({
          crestLengthM: inp.crestLengthM, headM: inp.headM,
          dischargeCoeff: inp.rectCd, endContractions: inp.endContractions,
          gravityG: 9.81,
        });
      } else if (inp.mode === 'vnotch') {
        Q = a.vNotchDischarge({
          notchAngleDeg: inp.notchAngleDeg, headM: inp.vHeadM,
          dischargeCoeff: inp.vCd, gravityG: 9.81,
        });
      } else {
        Q = a.orificeDischarge({
          areaM2: inp.orifAreaM2, headM: inp.orifHeadM,
          dischargeCoeff: inp.orifCd, gravityG: 9.81,
        });
      }
      setResult(Q);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-weir-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Weir / V-notch / orifice</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Rectangular: Q = (2/3)·C_d·L·√(2g)·H^(3/2). V-notch:
        Q = (8/15)·C_d·√(2g)·tan(θ/2)·H^(5/2). Orifice: Q = C_d·A·√(2gH).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['rect', 'Rect weir'], ['vnotch', 'V-notch'], ['orifice', 'Orifice'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-weir-tab-${mode}`}
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

      {inp.mode === 'rect' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="L (m)">
            <input type="number" step="0.1" value={inp.crestLengthM}
                   data-testid="forge-weir-L"
                   onChange={(e) => update({ crestLengthM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="H (m)">
            <input type="number" step="0.05" value={inp.headM}
                   data-testid="forge-weir-H"
                   onChange={(e) => update({ headM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="C_d">
            <input type="number" step="0.01" value={inp.rectCd}
                   data-testid="forge-weir-Cd"
                   onChange={(e) => update({ rectCd: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="end contractions">
            <select value={inp.endContractions}
                    data-testid="forge-weir-contractions"
                    onChange={(e) => update({ endContractions: Number(e.target.value) })}
                    style={fieldStyle}>
              <option value="0">0 (full)</option>
              <option value="1">1</option>
              <option value="2">2 (suppressed)</option>
            </select>
          </Field>
        </div>
      )}
      {inp.mode === 'vnotch' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="θ (°)">
            <input type="number" step="1" value={inp.notchAngleDeg}
                   data-testid="forge-weir-theta"
                   onChange={(e) => update({ notchAngleDeg: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="H (m)">
            <input type="number" step="0.05" value={inp.vHeadM}
                   data-testid="forge-weir-vH"
                   onChange={(e) => update({ vHeadM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="C_d">
            <input type="number" step="0.01" value={inp.vCd}
                   data-testid="forge-weir-vCd"
                   onChange={(e) => update({ vCd: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}
      {inp.mode === 'orifice' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="A (m²)">
            <input type="number" step="0.001" value={inp.orifAreaM2}
                   data-testid="forge-weir-A"
                   onChange={(e) => update({ orifAreaM2: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="H (m)">
            <input type="number" step="0.1" value={inp.orifHeadM}
                   data-testid="forge-weir-orifH"
                   onChange={(e) => update({ orifHeadM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="C_d">
            <input type="number" step="0.01" value={inp.orifCd}
                   data-testid="forge-weir-orifCd"
                   onChange={(e) => update({ orifCd: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      <button data-testid="forge-weir-run" style={buttonStyle} onClick={onCompute}>
        Compute Q
      </button>

      {err && (
        <div data-testid="forge-weir-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {typeof result === 'number' && (
        <section data-testid="forge-weir-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 13,
                          fontWeight: 700 }}>
          Q&nbsp;&nbsp;{result.toFixed(4)} m³/s&nbsp;&nbsp;({(result * 1000).toFixed(1)} L/s)
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

export function WeirOrificeWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenWeirWorkbench  = () => setOpen(true);
    window.__forgeCloseWeirWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.weir' || id === 'workbench.weir') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'weir') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WeirPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default WeirPanel;
