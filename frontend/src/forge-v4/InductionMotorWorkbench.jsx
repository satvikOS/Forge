// Forge-246 — Three-phase induction motor Thevenin + torque-slip.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Induction motor.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.inductionmotor)
      || (typeof window !== 'undefined' && window.electron && window.electron.inductionmotor);
}

function defaults() {
  return {
    phaseVoltageV: 460 / Math.sqrt(3), frequencyHz: 60, poles: 4,
    stator_R1: 0.641, stator_X1: 1.106,
    rotor_R2: 0.332, rotor_X2: 0.464,
    mag_Xm: 26.3,
    slip: 0.022,
  };
}

function ImPanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-imotor-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Induction motor · Thevenin + T-s</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ω_s = 4π·f/poles; T_d(s) = (3/ω_s)·|V_th|²·(R₂/s)/[(R_th+R₂/s)² + (X_th+X₂)²].
        s_b = R₂/√(R_th² + (X_th+X₂)²); T_max at s_b.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="V_ph (V)">
          <input type="number" step="10" value={inp.phaseVoltageV}
                 data-testid="forge-imotor-Vph"
                 onChange={(e) => update({ phaseVoltageV: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f (Hz)">
          <input type="number" step="1" value={inp.frequencyHz}
                 data-testid="forge-imotor-f"
                 onChange={(e) => update({ frequencyHz: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="poles">
          <input type="number" step="2" value={inp.poles}
                 data-testid="forge-imotor-poles"
                 onChange={(e) => update({ poles: Number(e.target.value) || 2 })}
                 style={fieldStyle} />
        </Field>
        <Field label="R₁ (Ω)">
          <input type="number" step="0.05" value={inp.stator_R1}
                 data-testid="forge-imotor-R1"
                 onChange={(e) => update({ stator_R1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="X₁ (Ω)">
          <input type="number" step="0.05" value={inp.stator_X1}
                 data-testid="forge-imotor-X1"
                 onChange={(e) => update({ stator_X1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="R₂ (Ω)">
          <input type="number" step="0.05" value={inp.rotor_R2}
                 data-testid="forge-imotor-R2"
                 onChange={(e) => update({ rotor_R2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="X₂ (Ω)">
          <input type="number" step="0.05" value={inp.rotor_X2}
                 data-testid="forge-imotor-X2"
                 onChange={(e) => update({ rotor_X2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="X_m (Ω)">
          <input type="number" step="1" value={inp.mag_Xm}
                 data-testid="forge-imotor-Xm"
                 onChange={(e) => update({ mag_Xm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="slip s">
          <input type="number" step="0.005" value={inp.slip}
                 data-testid="forge-imotor-slip"
                 onChange={(e) => update({ slip: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-imotor-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-imotor-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-imotor-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>n_s&nbsp;{result.synchronousRpm.toFixed(0)} rpm&nbsp;&nbsp;
               n_m&nbsp;{result.mechanicalRpm.toFixed(0)} rpm</div>
          <div>|V_th|&nbsp;{result.thevenin_V.toFixed(1)} V&nbsp;&nbsp;
               R_th&nbsp;{result.thevenin_R.toFixed(3)} Ω&nbsp;&nbsp;
               X_th&nbsp;{result.thevenin_X.toFixed(3)} Ω</div>
          <div data-testid="forge-imotor-Td"
               style={{ marginTop: 4, fontWeight: 700 }}>
            T_d&nbsp;{result.developedTorqueNm.toFixed(2)} N·m
          </div>
          <div>P_ag&nbsp;{(result.airGapPowerW / 1000).toFixed(2)} kW&nbsp;&nbsp;
               P_mech&nbsp;{(result.mechPowerW / 1000).toFixed(2)} kW</div>
          <div>I₂&nbsp;{result.rotorCurrentA.toFixed(1)} A</div>
          <div data-testid="forge-imotor-Tmax"
               style={{ marginTop: 4, fontWeight: 700, color: '#fbbf24' }}>
            T_max&nbsp;{result.breakdownTorqueNm.toFixed(2)} N·m @ s_b={result.breakdownSlip.toFixed(3)}
          </div>
          <div data-testid="forge-imotor-Tstart"
               style={{ fontWeight: 700, color: '#a78bfa' }}>
            T_start&nbsp;{result.startingTorqueNm.toFixed(2)} N·m,&nbsp;
            I_start&nbsp;{result.startingCurrentA.toFixed(0)} A
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

export function InductionMotorWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenIMotorWorkbench  = () => setOpen(true);
    window.__forgeCloseIMotorWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.imotor' || id === 'workbench.imotor') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'imotor') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ImPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ImPanel;
