// Forge-255 — Solar PV sizing (array + battery bank + inverter).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Solar PV → Solar PV sizing.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.solarpv)
      || (typeof window !== 'undefined' && window.electron && window.electron.solarpv);
}

function defaults() {
  return {
    dailyEnergyAcWh: 5000, peakSunHours: 5,
    panelWattPeak: 400,
    inverterEfficiency: 0.95, batteryEfficiency: 0.92,
    arrayDeratingFactor: 0.75,
    autonomyDays: 2, depthOfDischarge: 0.5, batteryBankVoltage: 48,
    peakAcLoadW: 3000, powerFactor: 0.9, inverterSizingFactor: 1.25,
  };
}

function SolarPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const arr = a.sizeArray({
        dailyEnergyAcWh: inp.dailyEnergyAcWh,
        peakSunHours: inp.peakSunHours,
        panelWattPeak: inp.panelWattPeak,
        inverterEfficiency: inp.inverterEfficiency,
        batteryEfficiency: inp.batteryEfficiency,
        arrayDeratingFactor: inp.arrayDeratingFactor,
      });
      const bat = a.sizeBatteryBank({
        dailyEnergyAcWh: inp.dailyEnergyAcWh,
        autonomyDays: inp.autonomyDays,
        depthOfDischarge: inp.depthOfDischarge,
        batteryBankVoltage: inp.batteryBankVoltage,
        batteryEfficiency: inp.batteryEfficiency,
      });
      const va = a.sizeInverterVA({
        peakAcLoadW: inp.peakAcLoadW,
        powerFactor: inp.powerFactor,
        sizingFactor: inp.inverterSizingFactor,
      });
      setResult({ arr, bat, va });
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-solar-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Solar PV sizing · NABCEP</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Wp = E_load / (PSH · η_inv · η_batt · derate). C_battery =
        E·days/(DoD·η_batt·V_bank). VA_inv = P_peak · sizing / pf.
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>Loads + insolation</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="E_load (Wh/d)">
            <input type="number" step="500" value={inp.dailyEnergyAcWh}
                   data-testid="forge-solar-Eload"
                   onChange={(e) => update({ dailyEnergyAcWh: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="PSH (h/d)">
            <input type="number" step="0.5" value={inp.peakSunHours}
                   data-testid="forge-solar-PSH"
                   onChange={(e) => update({ peakSunHours: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="Panel Wp">
            <input type="number" step="50" value={inp.panelWattPeak}
                   data-testid="forge-solar-Wp"
                   onChange={(e) => update({ panelWattPeak: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="derate">
            <input type="number" step="0.05" min="0" max="1" value={inp.arrayDeratingFactor}
                   data-testid="forge-solar-derate"
                   onChange={(e) => update({ arrayDeratingFactor: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="η_inv">
            <input type="number" step="0.01" min="0.5" max="1" value={inp.inverterEfficiency}
                   data-testid="forge-solar-etaInv"
                   onChange={(e) => update({ inverterEfficiency: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="η_batt">
            <input type="number" step="0.01" min="0.5" max="1" value={inp.batteryEfficiency}
                   data-testid="forge-solar-etaBatt"
                   onChange={(e) => update({ batteryEfficiency: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>Battery bank</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="autonomy (d)">
            <input type="number" step="0.5" value={inp.autonomyDays}
                   data-testid="forge-solar-autonomy"
                   onChange={(e) => update({ autonomyDays: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="DoD">
            <input type="number" step="0.05" min="0" max="1" value={inp.depthOfDischarge}
                   data-testid="forge-solar-DoD"
                   onChange={(e) => update({ depthOfDischarge: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="V_bank (V)">
            <input type="number" step="12" min="12" value={inp.batteryBankVoltage}
                   data-testid="forge-solar-Vbank"
                   onChange={(e) => update({ batteryBankVoltage: Number(e.target.value) || 12 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>Inverter</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="P_peak (W)">
            <input type="number" step="100" value={inp.peakAcLoadW}
                   data-testid="forge-solar-Ppeak"
                   onChange={(e) => update({ peakAcLoadW: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf">
            <input type="number" step="0.05" min="0.5" max="1" value={inp.powerFactor}
                   data-testid="forge-solar-pf"
                   onChange={(e) => update({ powerFactor: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="sizing factor">
            <input type="number" step="0.05" min="1" value={inp.inverterSizingFactor}
                   data-testid="forge-solar-sizing"
                   onChange={(e) => update({ inverterSizingFactor: Number(e.target.value) || 1 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <button data-testid="forge-solar-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-solar-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-solar-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-solar-array"
               style={{ fontWeight: 700 }}>
            Array: {result.arr.numberOfPanels} × {inp.panelWattPeak} Wp
            = {result.arr.installedArrayPowerWp} Wp (need {result.arr.requiredArrayPowerWp.toFixed(0)} Wp)
          </div>
          <div data-testid="forge-solar-batt"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            Battery: {result.bat.batteryCapacityAh.toFixed(0)} Ah @ {inp.batteryBankVoltage} V
            ({(result.bat.storageEnergyWh / 1000).toFixed(2)} kWh storage)
          </div>
          <div data-testid="forge-solar-inv"
               style={{ fontWeight: 700, color: '#a78bfa' }}>
            Inverter: {(result.va / 1000).toFixed(2)} kVA
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

export function SolarPvWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSolarWorkbench  = () => setOpen(true);
    window.__forgeCloseSolarWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.solar' || id === 'workbench.solar') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'solar') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SolarPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SolarPanel;
