// Forge-241 — Pile capacity (α-method + Meyerhof end bearing).
//
// Layered ground; per-layer skin friction + tip bearing.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Site & civil → Foundations → Pile capacity.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.pilecap)
      || (typeof window !== 'undefined' && window.electron && window.electron.pilecap);
}

function defaults() {
  return {
    diameterM: 0.5, factorOfSafety: 3, Nq_tip: 100, limitTipBearingPa: 11e6,
    layers: [
      { type: 'clay', thicknessM: 10, effectiveUnitWeightNPerM3: 17000,
        undrainedShearStrengthPa: 50000, alpha: 0.8,
        frictionAngleDeg: 0, beta: 0 },
      { type: 'sand', thicknessM: 5, effectiveUnitWeightNPerM3: 10000,
        undrainedShearStrengthPa: 0, alpha: 0,
        frictionAngleDeg: 36, beta: 0.5 },
    ],
  };
}

function PileCapPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse({ ...inp, waterTableDepthM: -1 }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const updateTop = (patch) => setInp({ ...inp, ...patch });
  const updateLayer = (idx, patch) => {
    const layers = inp.layers.map((L, i) => (i === idx ? { ...L, ...patch } : L));
    setInp({ ...inp, layers });
  };
  const addLayer = () => setInp({
    ...inp,
    layers: [...inp.layers, {
      type: 'sand', thicknessM: 5, effectiveUnitWeightNPerM3: 18000,
      undrainedShearStrengthPa: 0, alpha: 0,
      frictionAngleDeg: 30, beta: 0.4,
    }],
  });
  const removeLayer = (idx) => {
    if (inp.layers.length <= 1) return;
    setInp({ ...inp, layers: inp.layers.filter((_, i) => i !== idx) });
  };

  return (
    <div style={panelStyle} data-testid="forge-pilecap-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Pile capacity · α-method + Meyerhof tip</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        f_s = α·c_u (clay) or β·σ'_v_mid (sand). Tip: 9·c_u (clay) or
        N_q·σ'_v capped at q_p,limit (sand). Q_ult = Σ f_s·π·d·t + q_p·A_p.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="d (m)">
          <input type="number" step="0.05" value={inp.diameterM}
                 data-testid="forge-pilecap-d"
                 onChange={(e) => updateTop({ diameterM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="FS">
          <input type="number" step="0.5" value={inp.factorOfSafety}
                 data-testid="forge-pilecap-FS"
                 onChange={(e) => updateTop({ factorOfSafety: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="N_q tip (sand)">
          <input type="number" step="10" value={inp.Nq_tip}
                 data-testid="forge-pilecap-Nq"
                 onChange={(e) => updateTop({ Nq_tip: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="q_p,limit (Pa)">
          <input type="number" step="1e6" value={inp.limitTipBearingPa}
                 data-testid="forge-pilecap-qplim"
                 onChange={(e) => updateTop({ limitTipBearingPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <div style={{ marginTop: 4, borderTop: '1px solid var(--forge-rail-edge)',
                    paddingTop: 6 }}>
        <strong>Soil profile (top → tip)</strong>
      </div>

      {inp.layers.map((L, idx) => (
        <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6,
                                background: 'var(--forge-canvas)',
                                padding: 6, borderRadius: 'var(--forge-radius)' }}
             data-testid={`forge-pilecap-layer-${idx}`}>
          <Field label="type">
            <select value={L.type}
                    onChange={(e) => updateLayer(idx, { type: e.target.value })}
                    style={fieldStyle}>
              <option value="clay">clay</option>
              <option value="sand">sand</option>
            </select>
          </Field>
          <Field label="t (m)">
            <input type="number" step="0.5" value={L.thicknessM}
                   onChange={(e) => updateLayer(idx, { thicknessM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="γ' (N/m³)">
            <input type="number" step="500" value={L.effectiveUnitWeightNPerM3}
                   onChange={(e) => updateLayer(idx, { effectiveUnitWeightNPerM3: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          {L.type === 'clay' && (<>
            <Field label="c_u (Pa)">
              <input type="number" step="5000" value={L.undrainedShearStrengthPa}
                     onChange={(e) => updateLayer(idx, { undrainedShearStrengthPa: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="α">
              <input type="number" step="0.05" value={L.alpha}
                     onChange={(e) => updateLayer(idx, { alpha: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>)}
          {L.type === 'sand' && (<>
            <Field label="φ (°)">
              <input type="number" step="1" value={L.frictionAngleDeg}
                     onChange={(e) => updateLayer(idx, { frictionAngleDeg: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="β">
              <input type="number" step="0.05" value={L.beta}
                     onChange={(e) => updateLayer(idx, { beta: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>)}
          <button onClick={() => removeLayer(idx)}
                  style={{ ...fieldStyle, width: 40, cursor: 'pointer',
                           background: 'var(--forge-bad, #ff6363)', color: '#0a0e14',
                           fontWeight: 700 }}>×</button>
        </div>
      ))}

      <button onClick={addLayer} data-testid="forge-pilecap-add"
              style={{ ...buttonStyle, alignSelf: 'flex-start',
                       background: 'var(--forge-canvas-2)',
                       color: 'var(--forge-ink)',
                       border: '1px solid var(--forge-rail-edge)' }}>
        + add layer
      </button>

      <button data-testid="forge-pilecap-run" style={buttonStyle} onClick={onCompute}>
        Compute capacity
      </button>

      {err && (
        <div data-testid="forge-pilecap-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pilecap-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          {result.layers.map((L, i) => (
            <div key={i}>
              L{i + 1}&nbsp;&nbsp;{L.topDepthM.toFixed(1)}-{L.bottomDepthM.toFixed(1)} m&nbsp;&nbsp;
              σ'_v_mid&nbsp;{(L.effectiveStressAtMidPa / 1000).toFixed(0)} kPa&nbsp;&nbsp;
              f_s&nbsp;{(L.skinFrictionPa / 1000).toFixed(1)} kPa&nbsp;&nbsp;
              Q_s,{i + 1}&nbsp;{(L.skinForceN / 1000).toFixed(0)} kN
            </div>
          ))}
          <div style={{ marginTop: 4 }}>Σ Q_s&nbsp;&nbsp;{(result.shaftForceN / 1000).toFixed(0)} kN</div>
          <div>σ'_v(tip)&nbsp;{(result.effectiveStressAtTipPa / 1000).toFixed(0)} kPa</div>
          <div>q_p&nbsp;&nbsp;{(result.tipBearingPa / 1e6).toFixed(2)} MPa</div>
          <div>Q_p&nbsp;&nbsp;{(result.tipForceN / 1000).toFixed(0)} kN</div>
          <div data-testid="forge-pilecap-Qult"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Q_ult&nbsp;&nbsp;{(result.ultimateCapacityN / 1000).toFixed(0)} kN
          </div>
          <div data-testid="forge-pilecap-Qa"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            Q_allow&nbsp;{(result.allowableCapacityN / 1000).toFixed(0)} kN
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

export function PileCapacityWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPileCapWorkbench  = () => setOpen(true);
    window.__forgeClosePileCapWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pilecap' || id === 'workbench.pilecap') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pilecap') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PileCapPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PileCapPanel;
