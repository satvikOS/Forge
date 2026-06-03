// Forge-258 — Machining (feeds + speeds + cutting force + power).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Manufacturing → Machining → Machining.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.machining)
      || (typeof window !== 'undefined' && window.electron && window.electron.machining);
}

function defaults() {
  return {
    mode: 'turning',
    diameterMm: 50, cuttingSpeedM_min: 200,
    feedPerRevMm: 0.30, depthOfCutMm: 2,
    specificCuttingForceN_mm2: 2500, machineEfficiency: 0.80,
    leadAngleDeg: 90,
    feedPerToothMm: 0.10, numberOfTeeth: 4,
    axialDepthMm: 5, radialDepthMm: 20,
  };
}

function MachiningPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'turning') {
        setResult({ kind: 'turning', ...a.turning({
          diameterMm: inp.diameterMm, cuttingSpeedM_min: inp.cuttingSpeedM_min,
          feedPerRevMm: inp.feedPerRevMm, depthOfCutMm: inp.depthOfCutMm,
          specificCuttingForceN_mm2: inp.specificCuttingForceN_mm2,
          machineEfficiency: inp.machineEfficiency,
          leadAngleDeg: inp.leadAngleDeg,
        })});
      } else if (inp.mode === 'milling') {
        setResult({ kind: 'milling', ...a.milling({
          diameterMm: inp.diameterMm, cuttingSpeedM_min: inp.cuttingSpeedM_min,
          feedPerToothMm: inp.feedPerToothMm, numberOfTeeth: inp.numberOfTeeth,
          axialDepthMm: inp.axialDepthMm, radialDepthMm: inp.radialDepthMm,
          specificCuttingForceN_mm2: inp.specificCuttingForceN_mm2,
          machineEfficiency: inp.machineEfficiency,
        })});
      } else {
        setResult({ kind: 'drilling', ...a.drilling({
          diameterMm: inp.diameterMm, cuttingSpeedM_min: inp.cuttingSpeedM_min,
          feedPerRevMm: inp.feedPerRevMm,
          specificCuttingForceN_mm2: inp.specificCuttingForceN_mm2,
          machineEfficiency: inp.machineEfficiency,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-machining-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Machining · feeds + speeds + power</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        n = V_c·1000/(π·D). Turning: F_c = K_c·a_p·f. Milling:
        F_z·z·n feed rate. Drilling: torque K_c·D²·f/8.
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['turning', 'Turning'], ['milling', 'Milling'], ['drilling', 'Drilling'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-machining-tab-${mode}`}
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="D (mm)">
          <input type="number" step="1" value={inp.diameterMm}
                 data-testid="forge-machining-D"
                 onChange={(e) => update({ diameterMm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="V_c (m/min)">
          <input type="number" step="10" value={inp.cuttingSpeedM_min}
                 data-testid="forge-machining-Vc"
                 onChange={(e) => update({ cuttingSpeedM_min: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K_c (N/mm²)">
          <input type="number" step="100" value={inp.specificCuttingForceN_mm2}
                 data-testid="forge-machining-Kc"
                 onChange={(e) => update({ specificCuttingForceN_mm2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="η">
          <input type="number" step="0.05" min="0.5" max="1" value={inp.machineEfficiency}
                 data-testid="forge-machining-eta"
                 onChange={(e) => update({ machineEfficiency: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        {(inp.mode === 'turning' || inp.mode === 'drilling') && (
          <Field label="f (mm/rev)">
            <input type="number" step="0.05" value={inp.feedPerRevMm}
                   data-testid="forge-machining-f"
                   onChange={(e) => update({ feedPerRevMm: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        )}
        {inp.mode === 'turning' && (
          <>
            <Field label="a_p (mm)">
              <input type="number" step="0.5" value={inp.depthOfCutMm}
                     data-testid="forge-machining-ap"
                     onChange={(e) => update({ depthOfCutMm: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="κ (°)">
              <input type="number" step="5" min="1" max="90" value={inp.leadAngleDeg}
                     onChange={(e) => update({ leadAngleDeg: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>
        )}
        {inp.mode === 'milling' && (
          <>
            <Field label="f_z (mm)">
              <input type="number" step="0.025" value={inp.feedPerToothMm}
                     data-testid="forge-machining-fz"
                     onChange={(e) => update({ feedPerToothMm: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="z teeth">
              <input type="number" step="1" min="1" value={inp.numberOfTeeth}
                     data-testid="forge-machining-z"
                     onChange={(e) => update({ numberOfTeeth: Number(e.target.value) || 1 })}
                     style={fieldStyle} />
            </Field>
            <Field label="a_p (mm)">
              <input type="number" step="1" value={inp.axialDepthMm}
                     onChange={(e) => update({ axialDepthMm: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="a_e (mm)">
              <input type="number" step="1" value={inp.radialDepthMm}
                     onChange={(e) => update({ radialDepthMm: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>
        )}
      </div>

      <button data-testid="forge-machining-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-machining-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-machining-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-machining-n"
               style={{ fontWeight: 700 }}>
            n&nbsp;{result.spindleSpeedRpm.toFixed(0)} rpm
          </div>
          {result.kind === 'turning' && (<>
            <div>F_c&nbsp;{result.cuttingForceN.toFixed(0)} N</div>
            <div>MRR&nbsp;{result.mrrCm3Min.toFixed(1)} cm³/min</div>
          </>)}
          {result.kind === 'milling' && (<>
            <div>F (feed)&nbsp;{result.feedRateMmMin.toFixed(1)} mm/min</div>
            <div>F_c&nbsp;{result.cuttingForceN.toFixed(0)} N</div>
            <div>MRR&nbsp;{result.mrrCm3Min.toFixed(1)} cm³/min</div>
          </>)}
          {result.kind === 'drilling' && (<>
            <div>F (feed)&nbsp;{result.feedRateMmMin.toFixed(1)} mm/min</div>
            <div>thrust&nbsp;{result.thrustForceN.toFixed(0)} N</div>
            <div>torque&nbsp;{result.torqueNm.toFixed(2)} N·m</div>
          </>)}
          <div data-testid="forge-machining-P"
               style={{ marginTop: 4, fontWeight: 700, color: '#fbbf24' }}>
            P_spindle&nbsp;{result.powerKw.toFixed(2)} kW
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

export function MachiningWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMachiningWorkbench  = () => setOpen(true);
    window.__forgeCloseMachiningWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.machining' || id === 'workbench.machining') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'machining') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MachiningPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MachiningPanel;
