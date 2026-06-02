// Forge-192 — HVAC psychrometric chart workbench.
//
// User picks any two of (Tdb, RH, W, Tdp, Twb, h), the kernel resolves
// the full moist-air state. We plot the resulting point on a 2D
// psychrometric chart with iso-RH curves at 10..100 %.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const VAR_LABELS = [
  { key: 'tdb', label: 'Tdb [°C]',    mask: 1,  default: 25 },
  { key: 'rh',  label: 'RH [0..1]',   mask: 2,  default: 0.50 },
  { key: 'w',   label: 'W [kg/kg]',   mask: 4,  default: 0.0099 },
  { key: 'tdp', label: 'Tdp [°C]',    mask: 8,  default: 14 },
  { key: 'twb', label: 'Twb [°C]',    mask: 16, default: 18 },
  { key: 'h',   label: 'h [kJ/kg]',   mask: 32, default: 50.4 },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 540, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function PsychChart({ state, pAtm, width = 500, height = 300 }) {
  if (!state) return null;
  const padL = 36, padR = 8, padT = 14, padB = 22;
  const w = width - padL - padR, h = height - padT - padB;
  const tdbLo = -10, tdbHi = 50;
  const wLo = 0, wHi = 0.030;
  const X = (T) => padL + ((T - tdbLo) / (tdbHi - tdbLo)) * w;
  const Y = (W) => padT + h - ((W - wLo) / (wHi - wLo)) * h;
  // Iso-RH curves: for each RH 10..100, sample Tdb across range, compute W.
  const f = (typeof window !== 'undefined') ? window.forge : null;
  const rhCurves = [];
  if (f && f.psychro) {
    for (const rh of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
      const pts = [];
      for (let T = tdbLo; T <= tdbHi; T += 1) {
        const ps = f.psychro.saturationPressurePa(T);
        const pw = rh * ps;
        const wRatio = f.psychro.humidityRatio(pw, pAtm);
        if (wRatio < wHi + 0.01 && wRatio >= 0) {
          pts.push([X(T).toFixed(1), Y(Math.min(wRatio, wHi)).toFixed(1)]);
        }
      }
      rhCurves.push({ rh, pts });
    }
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-psy-chart">
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      {[0, 10, 20, 30, 40, 50].map((T) => (
        <g key={T}>
          <line x1={X(T)} y1={padT + h} x2={X(T)} y2={padT + h + 3}
                stroke="var(--forge-rail-edge)" />
          <text x={X(T)} y={padT + h + 12} fontSize={9}
                textAnchor="middle" fill="var(--forge-ink-mute)"
                fontFamily="var(--forge-mono)">{T}°</text>
        </g>
      ))}
      {rhCurves.map(({ rh, pts }, i) => {
        const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
        const colors = ['#56a8d4', '#56b6c6', '#56c4b0', '#56d49b', '#79c170',
                        '#a0c156', '#d4c356', '#d4a356', '#d97a3b', '#d95c3b'];
        return (
          <path key={i} d={d} fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={1} opacity={0.7} />
        );
      })}
      <circle cx={X(state.tdbC)} cy={Y(state.humidityRatio)}
              r={5} fill="var(--forge-accent)"
              stroke="#0a0e14" strokeWidth={1} />
      <text x={X(state.tdbC) + 7} y={Y(state.humidityRatio) - 6}
            fontSize={10} fill="var(--forge-ink)"
            fontFamily="var(--forge-mono)">
        ({state.tdbC.toFixed(1)}°, W={state.humidityRatio.toFixed(4)})
      </text>
      <text x={padL + 4} y={padT + 10} fontSize={9}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        psychrometric chart · iso-RH 10..100 % · p = {Math.round(pAtm)} Pa
      </text>
    </svg>
  );
}

export function PsychrometricWorkbenchPanel({ open, onClose }) {
  const [pAtm, setPAtm] = React.useState(101325);
  const [pickedA, setPickedA] = React.useState('tdb');
  const [pickedB, setPickedB] = React.useState('rh');
  const [valueA, setValueA] = React.useState(25);
  const [valueB, setValueB] = React.useState(0.50);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [state, setState] = React.useState(null);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.psychro) {
      setStatus({ kind: 'err', text: 'forge.psychro unavailable' });
      return;
    }
    if (pickedA === pickedB) {
      setStatus({ kind: 'err', text: 'pick two different inputs' });
      return;
    }
    try {
      const va = VAR_LABELS.find((v) => v.key === pickedA);
      const vb = VAR_LABELS.find((v) => v.key === pickedB);
      const mask = va.mask | vb.mask;
      const s = f.psychro.stateFromTwo(mask, valueA, valueB, pAtm);
      setState(s);
      setStatus({ kind: 'ok',
        text: `Tdb ${s.tdbC.toFixed(1)} · RH ${(s.rh * 100).toFixed(1)} % · W ${s.humidityRatio.toFixed(4)} · h ${s.enthalpyKJperKg.toFixed(1)} kJ/kg` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [pickedA, pickedB, valueA, valueB, pAtm]);

  React.useEffect(() => { if (open) onRun(); }, [open]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-psy-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Psychrometric · ASHRAE Hyland-Wexler</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-psy-close">×</button>
      </header>

      <section>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>p_atm [Pa]</small>
          <input type="number" value={pAtm} step={500}
                 onChange={(e) => setPAtm(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-psy-patm" />
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Input A</small>
          <select value={pickedA}
                  onChange={(e) => setPickedA(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-psy-pickA">
            {VAR_LABELS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
          <input type="number" value={valueA} step={0.01}
                 onChange={(e) => setValueA(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-psy-valA" />
        </div>
        <div>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Input B</small>
          <select value={pickedB}
                  onChange={(e) => setPickedB(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-psy-pickB">
            {VAR_LABELS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
          <input type="number" value={valueB} step={0.01}
                 onChange={(e) => setValueB(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-psy-valB" />
        </div>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-psy-run">
        Compute psychrometric state
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-psy-status">
        {status.text}
      </section>

      {state && <PsychChart state={state} pAtm={pAtm} />}

      {state && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-psy-result">
          <div>Tdb              {state.tdbC.toFixed(2)} °C</div>
          <div>RH               {(state.rh * 100).toFixed(2)} %</div>
          <div>W (humidity)     {state.humidityRatio.toFixed(5)} kg/kg dry air</div>
          <div>Tdp (dew point)  {state.tdpC.toFixed(2)} °C</div>
          <div>Twb (wet bulb)   {state.twbC.toFixed(2)} °C</div>
          <div>h (enthalpy)     {state.enthalpyKJperKg.toFixed(2)} kJ/kg</div>
          <div>pw (vapour)      {state.vapourPressurePa.toFixed(0)} Pa</div>
          <div>ps (sat)         {state.satPressurePa.toFixed(0)} Pa</div>
        </section>
      )}
    </div>
  );
}

export function PsychrometricWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPsychrometricWorkbench  = () => setOpen(true);
    window.__forgeClosePsychrometricWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.psychro' || e?.detail?.id === 'workbench.psychro') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'psychro') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PsychrometricWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PsychrometricWorkbenchPanel;
