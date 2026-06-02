// Forge-232 — Steel column (AISC 360 §E3) workbench.
//
// Compression member check: λ → F_e → F_cr → P_n → φPn / Pn·Ω.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.
//
// IA note: not added to the workbench rail to avoid overcrowding —
// reachable via Tools menu and `window.__forgeActiveWb = 'steelcol'`.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 600, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.steelcol)
      || (typeof window !== 'undefined' && window.electron && window.electron.steelcol);
}

function defaults() {
  return {
    effectiveLengthK: 1.0, unbracedLength: 4.0,
    radiusOfGyration: 0.0516, area: 9.29e-3,
    youngsModulus: 200e9, yieldStress: 250e6,
  };
}

function SteelColPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-steelcol-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Steel column · AISC 360 §E3</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        λ = KL/r; F_e = π²E/λ². Inelastic if λ ≤ 4.71·√(E/F_y):
        F_cr = 0.658^(F_y/F_e)·F_y. Else F_cr = 0.877·F_e. P_n =
        F_cr·A; φPn = 0.9·P_n; ASD = P_n/1.67.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="K">
          <input type="number" step="0.05" value={inp.effectiveLengthK}
                 data-testid="forge-steelcol-K"
                 onChange={(e) => update({ effectiveLengthK: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="L_b (m)">
          <input type="number" step="0.1" value={inp.unbracedLength}
                 data-testid="forge-steelcol-L"
                 onChange={(e) => update({ unbracedLength: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="r (m)">
          <input type="number" step="0.001" value={inp.radiusOfGyration}
                 data-testid="forge-steelcol-r"
                 onChange={(e) => update({ radiusOfGyration: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A (m²)">
          <input type="number" step="1e-4" value={inp.area}
                 data-testid="forge-steelcol-A"
                 onChange={(e) => update({ area: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="E (Pa)">
          <input type="number" step="1e9" value={inp.youngsModulus}
                 data-testid="forge-steelcol-E"
                 onChange={(e) => update({ youngsModulus: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_y (Pa)">
          <input type="number" step="10e6" value={inp.yieldStress}
                 data-testid="forge-steelcol-Fy"
                 onChange={(e) => update({ yieldStress: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-steelcol-run" style={buttonStyle} onClick={onCompute}>
        Check
      </button>

      {err && (
        <div data-testid="forge-steelcol-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-steelcol-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-steelcol-regime"
               style={{ color: result.inelasticRegime ? '#4ade80' : '#fbbf24',
                        fontWeight: 700, fontSize: 13 }}>
            {result.inelasticRegime ? 'INELASTIC' : 'ELASTIC'} regime
          </div>
          <div>λ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.slenderness.toFixed(1)}</div>
          <div>λ_lim&nbsp;{result.slendernessLimit.toFixed(1)}</div>
          <div>F_e&nbsp;&nbsp;&nbsp;{(result.eulerStress / 1e6).toFixed(1)} MPa</div>
          <div>F_cr&nbsp;&nbsp;{(result.criticalStress / 1e6).toFixed(1)} MPa</div>
          <div>P_n&nbsp;&nbsp;&nbsp;{(result.nominalStrength / 1000).toFixed(0)} kN</div>
          <div data-testid="forge-steelcol-LRFD"
               style={{ marginTop: 4, fontWeight: 700 }}>
            φPn (LRFD)&nbsp;&nbsp;{(result.designStrengthLRFD / 1000).toFixed(0)} kN
          </div>
          <div>Pn/Ω (ASD)&nbsp;&nbsp;{(result.allowableStrengthASD / 1000).toFixed(0)} kN</div>
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

export function SteelColumnWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSteelColWorkbench  = () => setOpen(true);
    window.__forgeCloseSteelColWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.steelcol' || id === 'workbench.steelcol') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'steelcol') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SteelColPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SteelColPanel;
