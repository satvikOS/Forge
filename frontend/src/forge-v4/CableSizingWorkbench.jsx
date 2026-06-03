// Forge-252 — Cable sizing (NEC 310 ampacity + IEC 60364 voltage drop).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Cable → Cable sizing.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 720, zIndex: 1310,
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
  width: 120, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.cable)
      || (typeof window !== 'undefined' && window.electron && window.electron.cable);
}

function defaults() {
  return {
    conductorSize: '4', material: 'copper',
    ambientTempC: 35, numCurrentCarryingConductors: 4,
    system: 'threePhase',
    xsecMm2: 21.2,            // 4 AWG
    lengthMeters: 50, loadAmperes: 60, powerFactor: 0.9,
    rhoOhmMmSqPerM: 0.0172, X_per_km: 0,
    systemVoltage: 400,
  };
}

function CablePanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [ampacity, setAmpacity] = React.useState(null);
  const [vdrop, setVdrop] = React.useState(null);
  const [table, setTable] = React.useState([]);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    try {
      const a = api();
      if (a && a.ampacityTable) setTable(a.ampacityTable());
    } catch (_) {}
  }, []);

  if (!open) return null;

  const onCompute = () => {
    setErr(''); setAmpacity(null); setVdrop(null);
    try {
      const a = api();
      setAmpacity(a.ampacity({
        conductorSize: inp.conductorSize, material: inp.material,
        ambientTempC: inp.ambientTempC,
        numCurrentCarryingConductors: inp.numCurrentCarryingConductors,
      }));
      setVdrop(a.voltageDrop({
        system: inp.system,
        xsecMm2: inp.xsecMm2,
        lengthMeters: inp.lengthMeters,
        loadAmperes: inp.loadAmperes,
        powerFactor: inp.powerFactor,
        materialResistivityOhmMmSqPerM: inp.rhoOhmMmSqPerM,
        conductorReactanceOhmPerKm: inp.X_per_km,
        systemVoltage: inp.systemVoltage,
      }));
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-cable-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Cable sizing · NEC 310 + IEC 60364</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Ampacity = base · ambient · grouping · material. ΔV (1-φ) =
        2·I·L·(R·cosφ + X·sinφ); 3-φ uses √3.
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>NEC 310 ampacity</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="size">
            <select value={inp.conductorSize} data-testid="forge-cable-size"
                    onChange={(e) => update({ conductorSize: e.target.value })}
                    style={fieldStyle}>
              {table.map((t) => (
                <option key={t.size} value={t.size}>{t.size}</option>
              ))}
            </select>
          </Field>
          <Field label="material">
            <select value={inp.material} data-testid="forge-cable-material"
                    onChange={(e) => update({ material: e.target.value })}
                    style={fieldStyle}>
              <option value="copper">copper</option>
              <option value="aluminum">aluminum</option>
            </select>
          </Field>
          <Field label="ambient °C">
            <input type="number" step="1" value={inp.ambientTempC}
                   data-testid="forge-cable-Tamb"
                   onChange={(e) => update({ ambientTempC: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="N conductors">
            <input type="number" step="1" min="1" value={inp.numCurrentCarryingConductors}
                   data-testid="forge-cable-N"
                   onChange={(e) => update({ numCurrentCarryingConductors: Number(e.target.value) || 1 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6,
                    borderRadius: 'var(--forge-radius)' }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>Voltage drop</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="system">
            <select value={inp.system} data-testid="forge-cable-system"
                    onChange={(e) => update({ system: e.target.value })}
                    style={fieldStyle}>
              <option value="singlePhase">single-phase</option>
              <option value="threePhase">three-phase</option>
            </select>
          </Field>
          <Field label="A (mm²)">
            <input type="number" step="0.5" value={inp.xsecMm2}
                   data-testid="forge-cable-A"
                   onChange={(e) => update({ xsecMm2: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="L (m)">
            <input type="number" step="5" value={inp.lengthMeters}
                   data-testid="forge-cable-L"
                   onChange={(e) => update({ lengthMeters: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="I (A)">
            <input type="number" step="5" value={inp.loadAmperes}
                   data-testid="forge-cable-I"
                   onChange={(e) => update({ loadAmperes: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="pf">
            <input type="number" step="0.05" min="0" max="1" value={inp.powerFactor}
                   data-testid="forge-cable-pf"
                   onChange={(e) => update({ powerFactor: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="V">
            <input type="number" step="10" value={inp.systemVoltage}
                   data-testid="forge-cable-V"
                   onChange={(e) => update({ systemVoltage: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      </div>

      <button data-testid="forge-cable-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-cable-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {ampacity && (
        <section data-testid="forge-cable-amp"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>base&nbsp;{ampacity.baseAmpacityA.toFixed(0)} A&nbsp;
               × ambient {ampacity.ambientFactor.toFixed(2)}&nbsp;
               × grouping {ampacity.groupingFactor.toFixed(2)}&nbsp;
               × material {ampacity.materialFactor.toFixed(2)}</div>
          <div data-testid="forge-cable-Ieff"
               style={{ marginTop: 4, fontWeight: 700,
                        color: ampacity.effectiveAmpacityA >= inp.loadAmperes
                          ? '#4ade80' : '#ff6363' }}>
            Effective&nbsp;{ampacity.effectiveAmpacityA.toFixed(1)} A
            {ampacity.effectiveAmpacityA >= inp.loadAmperes ? ' ≥ load OK' : ' < load FAIL'}
          </div>
        </section>
      )}
      {vdrop && (
        <section data-testid="forge-cable-vd"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>R&nbsp;{vdrop.cableResistanceOhmPerKm.toFixed(3)} Ω/km</div>
          <div data-testid="forge-cable-Vd"
               style={{ fontWeight: 700,
                        color: vdrop.voltageDropPct <= 3 ? '#4ade80' : '#fbbf24' }}>
            ΔV&nbsp;{vdrop.voltageDropV.toFixed(2)} V&nbsp;({vdrop.voltageDropPct.toFixed(2)}%)
            {vdrop.voltageDropPct <= 3 ? ' OK ≤ 3%' : ' over 3% limit'}
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

export function CableSizingWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCableWorkbench  = () => setOpen(true);
    window.__forgeCloseCableWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.cable' || id === 'workbench.cable') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'cable') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CablePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CablePanel;
