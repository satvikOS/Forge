// Forge-240 — Retaining wall (Rankine + stability checks).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Site & civil → Foundations → Retaining wall.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.retwall)
      || (typeof window !== 'undefined' && window.electron && window.electron.retwall);
}

function defaults() {
  return {
    totalHeightM: 6.0, embedmentDepthM: 1.0,
    baseWidthM: 4.0, toeWidthM: 1.0,
    stemThicknessM: 0.4, baseThicknessM: 0.6,
    unitWeightSoilNPerM3: 18000, frictionAngleDeg: 30,
    cohesionPa: 0, frictionCoeffBase: 0.5,
    surchargePa: 0, unitWeightConcreteNPerM3: 23600,
    allowableBearingPa: 200000,
  };
}

function RetWallPanel({ open, onClose }) {
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

  const fsRow = (label, value, threshold, testid) => (
    <div data-testid={testid}
         style={{ color: value >= threshold ? '#4ade80' : '#ff6363',
                  fontWeight: 700 }}>
      {label}&nbsp;&nbsp;{value.toFixed(2)}&nbsp;
      ({value >= threshold ? `≥ ${threshold} OK` : `< ${threshold} FAIL`})
    </div>
  );

  return (
    <div style={panelStyle} data-testid="forge-retwall-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Retaining wall · Rankine + stability</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        K_a, K_p (Rankine, level backfill). Stability: FS_OT = M_R/M_OT,
        FS_S = (μW + cB + P_p)/F_d, FS_B = q_allow/q_toe.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="H (m)">
          <input type="number" step="0.5" value={inp.totalHeightM}
                 data-testid="forge-retwall-H"
                 onChange={(e) => update({ totalHeightM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="D (m)">
          <input type="number" step="0.1" value={inp.embedmentDepthM}
                 data-testid="forge-retwall-D"
                 onChange={(e) => update({ embedmentDepthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="B base (m)">
          <input type="number" step="0.1" value={inp.baseWidthM}
                 data-testid="forge-retwall-B"
                 onChange={(e) => update({ baseWidthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="toe (m)">
          <input type="number" step="0.1" value={inp.toeWidthM}
                 data-testid="forge-retwall-toe"
                 onChange={(e) => update({ toeWidthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="stem t (m)">
          <input type="number" step="0.05" value={inp.stemThicknessM}
                 data-testid="forge-retwall-stem"
                 onChange={(e) => update({ stemThicknessM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="base t (m)">
          <input type="number" step="0.05" value={inp.baseThicknessM}
                 data-testid="forge-retwall-basethick"
                 onChange={(e) => update({ baseThicknessM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="γ soil (N/m³)">
          <input type="number" step="500" value={inp.unitWeightSoilNPerM3}
                 data-testid="forge-retwall-gamma"
                 onChange={(e) => update({ unitWeightSoilNPerM3: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="φ (°)">
          <input type="number" step="1" value={inp.frictionAngleDeg}
                 data-testid="forge-retwall-phi"
                 onChange={(e) => update({ frictionAngleDeg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="μ base">
          <input type="number" step="0.05" value={inp.frictionCoeffBase}
                 data-testid="forge-retwall-mu"
                 onChange={(e) => update({ frictionCoeffBase: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="q_s (Pa)">
          <input type="number" step="1000" value={inp.surchargePa}
                 data-testid="forge-retwall-qs"
                 onChange={(e) => update({ surchargePa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="γ conc. (N/m³)">
          <input type="number" step="100" value={inp.unitWeightConcreteNPerM3}
                 data-testid="forge-retwall-gammac"
                 onChange={(e) => update({ unitWeightConcreteNPerM3: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="q_allow (Pa)">
          <input type="number" step="10000" value={inp.allowableBearingPa}
                 data-testid="forge-retwall-qa"
                 onChange={(e) => update({ allowableBearingPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-retwall-run" style={buttonStyle} onClick={onCompute}>
        Check
      </button>

      {err && (
        <div data-testid="forge-retwall-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-retwall-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>K_a&nbsp;&nbsp;{result.Ka.toFixed(3)}&nbsp;&nbsp;K_p&nbsp;&nbsp;{result.Kp.toFixed(3)}</div>
          <div>P_a&nbsp;&nbsp;{(result.activeForceN / 1000).toFixed(1)} kN&nbsp;&nbsp;
               P_p&nbsp;&nbsp;{(result.passiveForceN / 1000).toFixed(1)} kN</div>
          <div>W total&nbsp;&nbsp;{(result.weightTotalN / 1000).toFixed(1)} kN</div>
          <div>M_OT&nbsp;&nbsp;{(result.overturningMomentNm / 1000).toFixed(1)} kN·m&nbsp;&nbsp;
               M_R&nbsp;&nbsp;{(result.resistingMomentNm / 1000).toFixed(1)} kN·m</div>
          <div>x_R&nbsp;&nbsp;{result.resultantArmM.toFixed(3)} m&nbsp;&nbsp;
               e&nbsp;&nbsp;{result.eccentricityM.toFixed(3)} m</div>
          <div>q_toe&nbsp;&nbsp;{(result.toeBearingPa / 1000).toFixed(1)} kPa&nbsp;&nbsp;
               q_heel&nbsp;&nbsp;{(result.heelBearingPa / 1000).toFixed(1)} kPa</div>

          <div style={{ marginTop: 4 }}>
            {fsRow('FS overturning', result.safetyFactorOverturning, 2.0, 'forge-retwall-fs-ot')}
            {fsRow('FS sliding',     result.safetyFactorSliding,    1.5, 'forge-retwall-fs-s')}
            {fsRow('FS bearing',     result.safetyFactorBearing,    1.0, 'forge-retwall-fs-b')}
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

export function RetainingWallWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRetWallWorkbench  = () => setOpen(true);
    window.__forgeCloseRetWallWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.retwall' || id === 'workbench.retwall') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'retwall') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RetWallPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default RetWallPanel;
