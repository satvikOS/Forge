// Forge-251 — Short-circuit study (Z_bus driving-point fault MVA).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Short-circuit study.
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
  width: 90, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.shortcircuit)
      || (typeof window !== 'undefined' && window.electron && window.electron.shortcircuit);
}

function defaults() {
  return {
    numBuses: 3, prefaultVoltagePu: 1.0,
    generators: [{ busIndex: 0, subtransientX: 0.20 }],
    branches: [
      { from: 0, to: 1, R: 0, X: 0.10 },
      { from: 1, to: 2, R: 0, X: 0.10 },
    ],
  };
}

function SCPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try { setResult(api().analyse(inp)); }
    catch (e) { setErr(String(e?.message || e)); }
  };

  return (
    <div style={panelStyle} data-testid="forge-scstudy-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Short-circuit study · Z_bus fault MVA</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Y_bus from generator sub-transient shunts (1/(jX_d'')) + branch
        admittances. Z_bus = Y_bus⁻¹. I_F = V/|Z_ii|; S_F = V²/|Z_ii|.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Field label="N buses">
          <input type="number" step="1" min="2" value={inp.numBuses}
                 data-testid="forge-scstudy-N"
                 onChange={(e) => setInp({ ...inp, numBuses: Number(e.target.value) || 2 })}
                 style={fieldStyle} />
        </Field>
        <Field label="V_pre (pu)">
          <input type="number" step="0.05" value={inp.prefaultVoltagePu}
                 data-testid="forge-scstudy-Vpre"
                 onChange={(e) => setInp({ ...inp, prefaultVoltagePu: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <div>
        <strong>Generators</strong>
        <table style={{ width: '100%', fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
          <thead><tr style={{ color: 'var(--forge-ink-mute)' }}><th>bus</th><th>X_d''</th></tr></thead>
          <tbody>
            {inp.generators.map((g, i) => (
              <tr key={i}>
                <td><input type="number" step="1" value={g.busIndex}
                       onChange={(e) => {
                         const generators = inp.generators.map((gg, j) =>
                           j === i ? { ...gg, busIndex: Number(e.target.value) || 0 } : gg);
                         setInp({ ...inp, generators });
                       }} style={fieldStyle} /></td>
                <td><input type="number" step="0.05" value={g.subtransientX}
                       onChange={(e) => {
                         const generators = inp.generators.map((gg, j) =>
                           j === i ? { ...gg, subtransientX: Number(e.target.value) || 0 } : gg);
                         setInp({ ...inp, generators });
                       }} style={fieldStyle} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <strong>Branches</strong>
        <table style={{ width: '100%', fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
          <thead><tr style={{ color: 'var(--forge-ink-mute)' }}><th>from</th><th>to</th><th>R</th><th>X</th></tr></thead>
          <tbody>
            {inp.branches.map((br, i) => (
              <tr key={i}>
                {['from', 'to', 'R', 'X'].map((k) => (
                  <td key={k}>
                    <input type="number" step="0.01" value={br[k]}
                           onChange={(e) => {
                             const branches = inp.branches.map((bb, j) =>
                               j === i ? { ...bb, [k]: Number(e.target.value) || 0 } : bb);
                             setInp({ ...inp, branches });
                           }} style={fieldStyle} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button data-testid="forge-scstudy-run" style={buttonStyle} onClick={onCompute}>
        Solve
      </button>

      {err && (
        <div data-testid="forge-scstudy-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-scstudy-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <table style={{ width: '100%' }}>
            <thead><tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th>bus</th><th>|Z_ii| (pu)</th><th>∠Z° </th><th>I_F (pu)</th><th>S_F (pu)</th>
            </tr></thead>
            <tbody>
              {result.buses.map((b, i) => (
                <tr key={i} data-testid={`forge-scstudy-row-${i}`}>
                  <td>{i}</td>
                  <td>{b.zDriveMag.toFixed(4)}</td>
                  <td>{b.zDriveAngDeg.toFixed(1)}</td>
                  <td style={{ fontWeight: 700 }}>{b.faultCurrentPu.toFixed(3)}</td>
                  <td style={{ fontWeight: 700, color: '#fbbf24' }}>{b.faultMvaPu.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

export function ShortCircuitWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSCStudyWorkbench  = () => setOpen(true);
    window.__forgeCloseSCStudyWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.scstudy' || id === 'workbench.scstudy') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'scstudy') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SCPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SCPanel;
