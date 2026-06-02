// Forge-217 — helical compression spring design workbench.
//
// Shigley Ch. 10 formulas: k, K_W (Wahl), τ_max, h_solid, δ at force.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.spring)
      || (typeof window !== 'undefined' && window.electron && window.electron.spring);
}

function defaults() {
  return {
    wireDiameter: 0.002, meanDiameter: 0.016,
    activeCoils: 10, totalCoils: 12,
    shearModulus: 80e9, appliedForce: 50,
  };
}

function SpringPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onDesign = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().design(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-spring-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Compression spring · Shigley</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Rate k = G·d⁴/(8·D³·N_a), τ_max with Wahl factor K_W = (4C−1)/
        (4C−4) + 0.615/C, C = D/d.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Wire d (m)">
          <input type="number" step="0.0005" value={inp.wireDiameter}
                 data-testid="forge-spring-d"
                 onChange={(e) => update({ wireDiameter: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Mean D (m)">
          <input type="number" step="0.001" value={inp.meanDiameter}
                 data-testid="forge-spring-D"
                 onChange={(e) => update({ meanDiameter: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Active coils">
          <input type="number" step="1" value={inp.activeCoils}
                 data-testid="forge-spring-Na"
                 onChange={(e) => update({ activeCoils: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Total coils">
          <input type="number" step="1" value={inp.totalCoils}
                 data-testid="forge-spring-Nt"
                 onChange={(e) => update({ totalCoils: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="G (Pa)">
          <input type="number" step="1e9" value={inp.shearModulus}
                 data-testid="forge-spring-G"
                 onChange={(e) => update({ shearModulus: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Force (N)">
          <input type="number" step="5" value={inp.appliedForce}
                 data-testid="forge-spring-F"
                 onChange={(e) => update({ appliedForce: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-spring-run" style={buttonStyle} onClick={onDesign}>
        Design
      </button>

      {err && (
        <div data-testid="forge-spring-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-spring-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>C (D/d)&nbsp;&nbsp;&nbsp;{result.springIndex.toFixed(3)}</div>
          <div>K_W (Wahl)&nbsp;{result.wahlFactor.toFixed(4)}</div>
          <div>k (rate)&nbsp;&nbsp;{(result.rate / 1000).toFixed(2)} kN/m</div>
          <div>τ_max&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.maxShearStress / 1e6).toFixed(1)} MPa</div>
          <div>solid h&nbsp;&nbsp;&nbsp;{(result.solidHeight * 1000).toFixed(1)} mm</div>
          <div>δ at F&nbsp;&nbsp;&nbsp;&nbsp;{(result.deflectionAtF * 1000).toFixed(2)} mm</div>
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

export function SpringDesignWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSpringWorkbench  = () => setOpen(true);
    window.__forgeCloseSpringWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.spring' || id === 'workbench.spring') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'spring') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SpringPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SpringPanel;
