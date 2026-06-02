// Forge-186 — HVAC ductwork workbench.
//
// Drives forge.duct.compute + forge.duct.sizeRoundForFriction. Editable
// route table (kind, dims, length per segment) + design conditions
// (flow rate, target friction rate). Shows per-segment velocity,
// Reynolds, friction factor, friction drop, fitting drop + a summary
// card with total drop and max velocity (with ASHRAE velocity-class
// flagging).
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const SEG_LABELS = [
  'Round run',     // 0
  'Rect run',      // 1
  'Elbow 90°',     // 2
  'Elbow 45°',     // 3
  'Elbow 22.5°',   // 4
  'Trans R↔R',     // 5
  'Tee straight',  // 6
  'Tee branch',    // 7
];

// ASHRAE velocity classes (low-pressure systems, m/s).
const VEL_CLASS = [
  { lo: 0,    hi: 5,  label: 'low',     color: 'var(--forge-ok, #4ec18b)' },
  { lo: 5,    hi: 10, label: 'medium',  color: '#d4c356' },
  { lo: 10,   hi: 18, label: 'high',    color: 'var(--forge-accent)' },
  { lo: 18,   hi: 1e9,label: 'over',    color: 'var(--forge-bad, #ff6363)' },
];

function velClass(v) {
  return VEL_CLASS.find((c) => v >= c.lo && v < c.hi) || VEL_CLASS[3];
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
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
  padding: '3px 5px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function PressureBar({ result, width = 520, height = 80 }) {
  if (!result || !result.segments.length) return null;
  const total = result.totalDropPa;
  if (total < 1e-3) return null;
  let acc = 0;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-duct-bar">
      {result.segments.map((s, i) => {
        const w = (s.totalDropPa / total) * width;
        const x = acc;
        acc += w;
        const colors = ['#56a8d4', '#79c170', '#d4c356', '#d49d56', '#d97a3b', '#7079d4'];
        return (
          <g key={i}>
            <rect x={x} y={12} width={Math.max(0.5, w)} height={32}
                  fill={colors[i % colors.length]}
                  stroke="rgba(0,0,0,0.2)" />
            {w > 32 && (
              <text x={x + w / 2} y={32} fontSize={10}
                    textAnchor="middle" fill="#0a0e14"
                    fontFamily="var(--forge-mono)">
                {SEG_LABELS[s.kind].split(' ')[0]}
              </text>
            )}
          </g>
        );
      })}
      <text x={4} y={60} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        ΔP total {total.toFixed(1)} Pa · max V {result.maxVelocityMs.toFixed(1)} m/s · L {result.totalLengthM.toFixed(1)} m
      </text>
    </svg>
  );
}

export function DuctworkWorkbenchPanel({ open, onClose }) {
  const [flowM3s, setFlowM3s] = React.useState(0.472);    // 1000 cfm
  const [targetPaM, setTargetPaM] = React.useState(1.0);  // ASHRAE friction rate
  const [route, setRoute] = React.useState([
    { kind: 0, diameterMm: 300, widthMm: 0, heightMm: 0, lengthM: 10 },
    { kind: 2, diameterMm: 300, widthMm: 0, heightMm: 0, lengthM: 0 },
    { kind: 0, diameterMm: 300, widthMm: 0, heightMm: 0, lengthM: 5 },
    { kind: 7, diameterMm: 300, widthMm: 0, heightMm: 0, lengthM: 0 },
    { kind: 1, diameterMm: 0,   widthMm: 250, heightMm: 200, lengthM: 6 },
  ]);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);
  const [sizingD, setSizingD] = React.useState(null);

  const air = { rhoKgM3: 1.204, nuM2s: 1.516e-5, epsilonMm: 0.09 };

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.duct) {
      setStatus({ kind: 'err', text: 'forge.duct unavailable' });
      return;
    }
    try {
      const r = f.duct.compute({ flowRateM3s: flowM3s, air, route });
      const D = f.duct.sizeRoundForFriction(flowM3s, targetPaM, air);
      setResult(r);
      setSizingD(D);
      const vc = velClass(r.maxVelocityMs);
      setStatus({ kind: 'ok',
        text: `ΔP ${r.totalDropPa.toFixed(1)} Pa · max V ${r.maxVelocityMs.toFixed(1)} m/s (${vc.label}) · suggest D ${D.toFixed(0)} mm` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [flowM3s, route, targetPaM]);

  React.useEffect(() => { if (open) onRun(); }, [open]);

  const addSegment = () => setRoute((arr) =>
    [...arr, { kind: 0, diameterMm: 300, widthMm: 0, heightMm: 0, lengthM: 5 }]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-duct-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>HVAC ductwork · ASHRAE sizing + Δp</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-duct-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Flow rate [m³/s]</small>
          <input type="number" value={flowM3s} step={0.01}
                 onChange={(e) => setFlowM3s(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-duct-flow" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Target friction [Pa/m]</small>
          <input type="number" value={targetPaM} step={0.1}
                 onChange={(e) => setTargetPaM(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-duct-friction" />
        </label>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Route</div>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th style={{ textAlign: 'left' }}>kind</th>
              <th>D [mm]</th><th>W</th><th>H</th><th>L [m]</th><th></th>
            </tr>
          </thead>
          <tbody>
            {route.map((s, i) => (
              <tr key={i}>
                <td><select value={s.kind}
                            onChange={(e) => setRoute((arr) => arr.map((x, j) =>
                              j === i ? { ...x, kind: parseInt(e.target.value) || 0 } : x))}
                            style={fieldInputStyle}
                            data-testid={`forge-duct-kind-${i}`}>
                  {SEG_LABELS.map((l, k) => <option key={k} value={k}>{l}</option>)}
                </select></td>
                <td><input type="number" value={s.diameterMm} step={10}
                           onChange={(e) => setRoute((arr) => arr.map((x, j) =>
                             j === i ? { ...x, diameterMm: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-duct-d-${i}`} /></td>
                <td><input type="number" value={s.widthMm} step={10}
                           onChange={(e) => setRoute((arr) => arr.map((x, j) =>
                             j === i ? { ...x, widthMm: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-duct-w-${i}`} /></td>
                <td><input type="number" value={s.heightMm} step={10}
                           onChange={(e) => setRoute((arr) => arr.map((x, j) =>
                             j === i ? { ...x, heightMm: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-duct-h-${i}`} /></td>
                <td><input type="number" value={s.lengthM} step={0.5}
                           onChange={(e) => setRoute((arr) => arr.map((x, j) =>
                             j === i ? { ...x, lengthM: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-duct-l-${i}`} /></td>
                <td><button onClick={() => setRoute((arr) => arr.filter((_, j) => j !== i))}
                            style={{ ...fieldInputStyle, width: 24, cursor: 'pointer' }}>−</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addSegment}
                style={{ ...fieldInputStyle, cursor: 'pointer', marginTop: 4 }}
                data-testid="forge-duct-add">
          + add segment
        </button>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-duct-run">
        Compute pressure drop + sizing
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-duct-status">
        {status.text}
      </section>

      {result && <PressureBar result={result} />}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          maxHeight: 200, overflowY: 'auto' }}
                 data-testid="forge-duct-result">
          {result.segments.map((s, i) => {
            const vc = velClass(s.velocityMs);
            return (
              <div key={i} style={{ color: vc.color }}>
                {String(i + 1).padStart(2, '0')} {SEG_LABELS[s.kind].padEnd(13, ' ')}
                Dh {s.hydraulicDiameterMm.toFixed(0).padStart(4, ' ')} mm
                · V {s.velocityMs.toFixed(2).padStart(5, ' ')} m/s
                · ΔP {s.totalDropPa.toFixed(2).padStart(6, ' ')} Pa
              </div>
            );
          })}
          <div>──────────────</div>
          <div><strong>Total ΔP {result.totalDropPa.toFixed(2)} Pa over {result.totalLengthM.toFixed(1)} m</strong></div>
          <div>Sizing suggests D = {sizingD ? sizingD.toFixed(0) : '–'} mm @ {targetPaM} Pa/m</div>
        </section>
      )}
    </div>
  );
}

export function DuctworkWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDuctworkWorkbench  = () => setOpen(true);
    window.__forgeCloseDuctworkWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.duct' || e?.detail?.id === 'workbench.duct') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'duct') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <DuctworkWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default DuctworkWorkbenchPanel;
