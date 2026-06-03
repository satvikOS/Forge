// Forge-247 — Symmetrical components + fault currents.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Symmetrical components.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.symcomp)
      || (typeof window !== 'undefined' && window.electron && window.electron.symcomp);
}

function defaults() {
  return {
    mode: 'decompose',
    Va_mag: 1, Va_ang: 0,
    Vb_mag: 1, Vb_ang: 180,
    Vc_mag: 0, Vc_ang: 0,
    V_prefault: 1.0,
    Z0_mag: 0.10, Z0_ang: 90,
    Z1_mag: 0.15, Z1_ang: 90,
    Z2_mag: 0.15, Z2_ang: 90,
  };
}

function SymPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'decompose') {
        const r = a.decompose({
          Va: { magnitude: inp.Va_mag, angleDeg: inp.Va_ang },
          Vb: { magnitude: inp.Vb_mag, angleDeg: inp.Vb_ang },
          Vc: { magnitude: inp.Vc_mag, angleDeg: inp.Vc_ang },
        });
        setResult({ kind: 'decompose', ...r });
      } else {
        const r = a.faultCurrents({
          prefaultPhaseVoltage: inp.V_prefault,
          Z0_magnitude: inp.Z0_mag, Z0_angleDeg: inp.Z0_ang,
          Z1_magnitude: inp.Z1_mag, Z1_angleDeg: inp.Z1_ang,
          Z2_magnitude: inp.Z2_mag, Z2_angleDeg: inp.Z2_ang,
        });
        setResult({ kind: 'fault', ...r });
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-symcomp-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Symmetrical components · Fortescue</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        a = 1∠120°. [V₀ V₊ V₋]ᵀ = (1/3)·M·[Vₐ V_b V_c]ᵀ with
        Fortescue M. Fault currents: I_3φ=V/Z₁; I_LG=3V/(Z₀+Z₁+Z₂);
        I_LL=√3·V/(Z₁+Z₂).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['decompose', 'Decompose'], ['fault', 'Fault currents'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-symcomp-tab-${mode}`}
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

      {inp.mode === 'decompose' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['a', 'b', 'c'].map((ph) => (
            <React.Fragment key={ph}>
              <Field label={`|V_${ph}|`}>
                <input type="number" step="0.05" value={inp[`V${ph}_mag`]}
                       data-testid={`forge-symcomp-V${ph}-mag`}
                       onChange={(e) => update({ [`V${ph}_mag`]: Number(e.target.value) || 0 })}
                       style={fieldStyle} />
              </Field>
              <Field label={`∠V_${ph}°`}>
                <input type="number" step="5" value={inp[`V${ph}_ang`]}
                       data-testid={`forge-symcomp-V${ph}-ang`}
                       onChange={(e) => update({ [`V${ph}_ang`]: Number(e.target.value) || 0 })}
                       style={fieldStyle} />
              </Field>
            </React.Fragment>
          ))}
        </div>
      )}

      {inp.mode === 'fault' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="V_pre">
            <input type="number" step="0.05" value={inp.V_prefault}
                   data-testid="forge-symcomp-Vpre"
                   onChange={(e) => update({ V_prefault: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          {['0', '1', '2'].map((idx) => (
            <React.Fragment key={idx}>
              <Field label={`|Z_${idx}|`}>
                <input type="number" step="0.01" value={inp[`Z${idx}_mag`]}
                       data-testid={`forge-symcomp-Z${idx}-mag`}
                       onChange={(e) => update({ [`Z${idx}_mag`]: Number(e.target.value) || 0 })}
                       style={fieldStyle} />
              </Field>
              <Field label={`∠Z_${idx}°`}>
                <input type="number" step="5" value={inp[`Z${idx}_ang`]}
                       data-testid={`forge-symcomp-Z${idx}-ang`}
                       onChange={(e) => update({ [`Z${idx}_ang`]: Number(e.target.value) || 0 })}
                       style={fieldStyle} />
              </Field>
            </React.Fragment>
          ))}
        </div>
      )}

      <button data-testid="forge-symcomp-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-symcomp-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && result.kind === 'decompose' && (
        <section data-testid="forge-symcomp-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>V₀ &nbsp;{result.zero.magnitude.toFixed(4)} ∠{result.zero.angleDeg.toFixed(2)}°</div>
          <div data-testid="forge-symcomp-Vplus"
               style={{ fontWeight: 700 }}>
            V₊ &nbsp;{result.positive.magnitude.toFixed(4)} ∠{result.positive.angleDeg.toFixed(2)}°
          </div>
          <div data-testid="forge-symcomp-Vminus">
            V₋ &nbsp;{result.negative.magnitude.toFixed(4)} ∠{result.negative.angleDeg.toFixed(2)}°
          </div>
        </section>
      )}
      {result && result.kind === 'fault' && (
        <section data-testid="forge-symcomp-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-symcomp-I3"
               style={{ fontWeight: 700 }}>
            I_3φ&nbsp;{result.threePhaseFaultI.toFixed(4)} p.u.
          </div>
          <div data-testid="forge-symcomp-ILG"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            I_LG&nbsp;{result.lineToGroundFaultI.toFixed(4)} p.u.
          </div>
          <div data-testid="forge-symcomp-ILL"
               style={{ fontWeight: 700, color: '#a78bfa' }}>
            I_LL&nbsp;{result.lineToLineFaultI.toFixed(4)} p.u.
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

export function SymComponentsWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSymCompWorkbench  = () => setOpen(true);
    window.__forgeCloseSymCompWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.symcomp' || id === 'workbench.symcomp') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'symcomp') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SymPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SymPanel;
