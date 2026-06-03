// Forge-248 — Transmission line ABCD + sending-end analysis.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Transmission line.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 700, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.tline)
      || (typeof window !== 'undefined' && window.electron && window.electron.tline);
}

function defaults() {
  return {
    model: 'mediumPi',
    resistancePerKmOhm: 0.16, reactancePerKmOhm: 0.5,
    conductancePerKmS: 0, susceptancePerKmS: 3e-6,
    lengthKm: 200,
    receivingPhaseVoltageV: 127017, receivingPowerW: 50e6,
    receivingPowerFactor: 0.85, leading: false,
  };
}

function TLinePanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse({
        model: inp.model,
        params: {
          resistancePerKmOhm: inp.resistancePerKmOhm,
          reactancePerKmOhm:  inp.reactancePerKmOhm,
          conductancePerKmS:  inp.conductancePerKmS,
          susceptancePerKmS:  inp.susceptancePerKmS,
          lengthKm: inp.lengthKm,
        },
        load: {
          receivingPhaseVoltageV: inp.receivingPhaseVoltageV,
          receivingPowerW: inp.receivingPowerW,
          receivingPowerFactor: inp.receivingPowerFactor,
          leading: inp.leading,
        },
      }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-tline-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Transmission line · ABCD</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Short: A=D=1, B=Z. Medium-π: A=D=1+YZ/2, C=Y(1+YZ/4).
        Long: A=cosh(γL), B=Z_c·sinh(γL), C=sinh(γL)/Z_c.
        V_S = A·V_R + B·I_R; I_S = C·V_R + D·I_R.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="model">
          <select value={inp.model} data-testid="forge-tline-model"
                  onChange={(e) => update({ model: e.target.value })}
                  style={fieldStyle}>
            <option value="short">short</option>
            <option value="mediumPi">medium π</option>
            <option value="long">long</option>
          </select>
        </Field>
        <Field label="L (km)">
          <input type="number" step="10" value={inp.lengthKm}
                 data-testid="forge-tline-L"
                 onChange={(e) => update({ lengthKm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="r (Ω/km)">
          <input type="number" step="0.05" value={inp.resistancePerKmOhm}
                 data-testid="forge-tline-r"
                 onChange={(e) => update({ resistancePerKmOhm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="x (Ω/km)">
          <input type="number" step="0.05" value={inp.reactancePerKmOhm}
                 data-testid="forge-tline-x"
                 onChange={(e) => update({ reactancePerKmOhm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="b (S/km)">
          <input type="number" step="1e-6" value={inp.susceptancePerKmS}
                 data-testid="forge-tline-b"
                 onChange={(e) => update({ susceptancePerKmS: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="V_R (ph V)">
          <input type="number" step="1000" value={inp.receivingPhaseVoltageV}
                 data-testid="forge-tline-VR"
                 onChange={(e) => update({ receivingPhaseVoltageV: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="P_R (W)">
          <input type="number" step="1e6" value={inp.receivingPowerW}
                 data-testid="forge-tline-PR"
                 onChange={(e) => update({ receivingPowerW: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="pf">
          <input type="number" step="0.05" min="0" max="1"
                 value={inp.receivingPowerFactor}
                 data-testid="forge-tline-pf"
                 onChange={(e) => update({ receivingPowerFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="lead/lag">
          <select value={inp.leading ? 'lead' : 'lag'}
                  onChange={(e) => update({ leading: e.target.value === 'lead' })}
                  style={fieldStyle}>
            <option value="lag">lag</option>
            <option value="lead">lead</option>
          </select>
        </Field>
      </div>

      <button data-testid="forge-tline-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-tline-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-tline-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>A&nbsp;{result.abcd.A_mag.toFixed(4)} ∠{result.abcd.A_ang.toFixed(2)}°&nbsp;&nbsp;
               B&nbsp;{result.abcd.B_mag.toFixed(2)} ∠{result.abcd.B_ang.toFixed(2)}°</div>
          <div>C&nbsp;{result.abcd.C_mag.toExponential(2)} ∠{result.abcd.C_ang.toFixed(2)}°&nbsp;&nbsp;
               D&nbsp;{result.abcd.D_mag.toFixed(4)} ∠{result.abcd.D_ang.toFixed(2)}°</div>
          <div data-testid="forge-tline-VS"
               style={{ marginTop: 4, fontWeight: 700 }}>
            |V_S|&nbsp;{(result.sendingVoltageV / 1000).toFixed(2)} kV ∠{result.sendingVoltageAngDeg.toFixed(2)}°
          </div>
          <div>|I_S|&nbsp;{result.sendingCurrentA.toFixed(1)} A ∠{result.sendingCurrentAngDeg.toFixed(2)}°</div>
          <div>P_S&nbsp;{(result.sendingRealPowerW / 1e6).toFixed(2)} MW&nbsp;&nbsp;
               pf_S&nbsp;{result.sendingPowerFactor.toFixed(3)}</div>
          <div data-testid="forge-tline-reg"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            Regulation&nbsp;{result.regulationPct.toFixed(2)}%
          </div>
          <div data-testid="forge-tline-eta"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            η&nbsp;{(result.efficiency * 100).toFixed(2)}%
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

export function TransmissionLineWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenTLineWorkbench  = () => setOpen(true);
    window.__forgeCloseTLineWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.tline' || id === 'workbench.tline') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'tline') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TLinePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default TLinePanel;
