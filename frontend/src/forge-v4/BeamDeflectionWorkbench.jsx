// Forge-216 — beam deflection calculator workbench.
//
// Closed-form δ_max, θ_max, M_max for five textbook beam configs.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 560, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.beam)
      || (typeof window !== 'undefined' && window.electron && window.electron.beam);
}

const CONFIGS = [
  { id: 'cantilever-point', label: 'Cantilever · tip point load', loadUnits: 'N' },
  { id: 'cantilever-udl',   label: 'Cantilever · UDL',            loadUnits: 'N/m' },
  { id: 'ss-point',         label: 'Simply supported · midspan P', loadUnits: 'N' },
  { id: 'ss-udl',           label: 'Simply supported · UDL',      loadUnits: 'N/m' },
  { id: 'ff-udl',           label: 'Fixed–fixed · UDL',           loadUnits: 'N/m' },
];

function defaults() {
  return {
    config: 'cantilever-point',
    length: 1.0, load: 100,
    E: 2e11, I: 1e-8,
  };
}

function BeamPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const cfg = CONFIGS.find((c) => c.id === inp.config);

  const onSolve = () => {
    setErr(''); setResult(null);
    try {
      const b = api();
      const r = b.solve({
        config: inp.config, length: inp.length, load: inp.load,
        youngsModulus: inp.E, secondMomentI: inp.I,
      });
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-beam-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Beam deflection</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Euler–Bernoulli closed-form formulas. Pick a config + inputs.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>Configuration</span>
        <select value={inp.config} data-testid="forge-beam-config"
                onChange={(e) => update({ config: e.target.value })}
                style={{ ...fieldStyle, width: '100%' }}>
          {CONFIGS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="L (m)">
          <input type="number" step="0.1" value={inp.length}
                 data-testid="forge-beam-L"
                 onChange={(e) => update({ length: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label={`Load (${cfg.loadUnits})`}>
          <input type="number" step="10" value={inp.load}
                 data-testid="forge-beam-load"
                 onChange={(e) => update({ load: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="E (Pa)">
          <input type="number" step="1e9" value={inp.E}
                 data-testid="forge-beam-E"
                 onChange={(e) => update({ E: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="I (m⁴)">
          <input type="number" step="1e-9" value={inp.I}
                 data-testid="forge-beam-I"
                 onChange={(e) => update({ I: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-beam-run" style={buttonStyle} onClick={onSolve}>
        Solve
      </button>

      {err && (
        <div data-testid="forge-beam-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-beam-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>δ_max&nbsp;&nbsp;{(result.deflectionMax * 1000).toFixed(3)} mm</div>
          <div>θ_max&nbsp;&nbsp;{result.slopeMax.toExponential(3)} rad</div>
          <div>M_max&nbsp;&nbsp;{result.momentMax.toFixed(3)} N·m</div>
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

export function BeamDeflectionWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBeamWorkbench  = () => setOpen(true);
    window.__forgeCloseBeamWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.beam' || id === 'workbench.beam') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'beam') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BeamPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BeamPanel;
