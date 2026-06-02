// Forge-179 — Cost estimation workbench.
//
// Drives forge.cost.computeUnit + forge.cost.computeProject for any
// body on the scene. UI lets the user pick a material, set stock /
// finished volume, qty, and process; surfaces the per-line breakdown +
// tornado-chart sensitivity. Pulls bodies from window.__forgeBodies and
// estimates volume via window.forge.massProps when available — otherwise
// the user enters a manual volume.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const MATERIALS = [
  { name: 'Al6061',      densityKgM3: 2700, pricePerKgUSD: 5.50,
    mrrEndmillCm3Min: 15, mrrDrillCm3Min: 8,  mrrTurnCm3Min: 25, co2PerKg: 8.2 },
  { name: 'S1018 steel', densityKgM3: 7850, pricePerKgUSD: 1.20,
    mrrEndmillCm3Min: 5,  mrrDrillCm3Min: 3,  mrrTurnCm3Min: 8,  co2PerKg: 1.9 },
  { name: '304 SS',      densityKgM3: 8000, pricePerKgUSD: 6.50,
    mrrEndmillCm3Min: 2,  mrrDrillCm3Min: 1.5,mrrTurnCm3Min: 3,  co2PerKg: 6.1 },
  { name: 'Brass C36',   densityKgM3: 8500, pricePerKgUSD: 8.80,
    mrrEndmillCm3Min: 25, mrrDrillCm3Min: 15, mrrTurnCm3Min: 35, co2PerKg: 4.6 },
  { name: 'Ti6Al4V',     densityKgM3: 4430, pricePerKgUSD: 32.0,
    mrrEndmillCm3Min: 1,  mrrDrillCm3Min: 0.8,mrrTurnCm3Min: 1.5,co2PerKg: 75.0 },
];

const PROCESSES = [
  { name: '3-axis CNC', setupMin: 30, labourUsdMin: 1.50 },
  { name: 'Lathe',      setupMin: 25, labourUsdMin: 1.20 },
  { name: 'Sheet press',setupMin: 60, labourUsdMin: 0.80 },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 500, zIndex: 1310,
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

function TornadoChart({ tornado, width = 460, height = 140 }) {
  if (!tornado || !tornado.length) return null;
  const padL = 100, padR = 30, padT = 12, padB = 18;
  const w = width - padL - padR, h = height - padT - padB;
  const maxAbs = Math.max(0.01, ...tornado.map((t) => Math.abs(t.usd)));
  const barH = (h - tornado.length * 4) / tornado.length;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-cost-tornado">
      <line x1={padL + w / 2} y1={padT} x2={padL + w / 2} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      {tornado.map((t, i) => {
        const v = t.usd;
        const bw = Math.abs(v) / maxAbs * (w / 2);
        const y = padT + i * (barH + 4);
        const x = v >= 0 ? padL + w / 2 : padL + w / 2 - bw;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={barH}
                  fill={v >= 0 ? 'var(--forge-accent)' : '#56a8d4'} />
            <text x={padL - 4} y={y + barH * 0.7} fontSize={10}
                  textAnchor="end" fill="var(--forge-ink-mute)"
                  fontFamily="var(--forge-mono)">{t.label}</text>
            <text x={padL + w + 4} y={y + barH * 0.7} fontSize={10}
                  fill="var(--forge-ink)" fontFamily="var(--forge-mono)">
              {v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CostWorkbenchPanel({ open, onClose }) {
  const [bodyIdx, setBodyIdx] = React.useState(0);
  const [scene, setScene] = React.useState([]);
  const [materialIdx, setMaterialIdx] = React.useState(0);
  const [processIdx, setProcessIdx] = React.useState(0);
  const [toolFamily, setToolFamily] = React.useState(0);
  const [volumeCm3, setVolumeCm3] = React.useState(150);
  const [stockCm3, setStockCm3] = React.useState(300);
  const [qty, setQty] = React.useState(50);
  const [result, setResult] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  React.useEffect(() => {
    if (!open) return;
    setScene(Array.isArray(window.__forgeBodies) ? window.__forgeBodies : []);
  }, [open]);

  // Auto-extract volume from massProps when a body is picked.
  React.useEffect(() => {
    if (!scene[bodyIdx] || !window.forge?.massProps) return;
    try {
      const mp = window.forge.massProps(scene[bodyIdx].handle);
      // massProps reports volume in mm³ — convert to cm³.
      if (mp && mp.volume > 0) {
        const cm3 = mp.volume / 1000;
        setVolumeCm3(parseFloat(cm3.toFixed(2)));
        setStockCm3(parseFloat((cm3 * 2).toFixed(2)));
      }
    } catch { /* ignore */ }
  }, [bodyIdx, scene]);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.cost) {
      setStatus({ kind: 'err', text: 'forge.cost kernel not available' });
      return;
    }
    try {
      const inputs = {
        body: {
          materialName: MATERIALS[materialIdx].name,
          volumeCm3, stockVolumeCm3: stockCm3,
          processName: PROCESSES[processIdx].name,
          toolFamily, qty,
        },
        materials: MATERIALS,
        processes: PROCESSES,
      };
      const r = f.cost.computeUnit(inputs);
      setResult(r);
      setStatus({ kind: 'ok',
        text: `unit $${r.unitUsd.toFixed(2)} · batch $${r.batchUsd.toFixed(2)} · ` +
              `mass ${(r.massKg * 1000).toFixed(1)} g · machining ${r.machiningTimeMin.toFixed(1)} min` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [materialIdx, processIdx, toolFamily, volumeCm3, stockCm3, qty]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-cost-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Cost estimation · material × machining × labour</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-cost-close">×</button>
      </header>

      {scene.length > 0 && (
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Pick a body from scene</small>
          <select value={bodyIdx}
                  onChange={(e) => setBodyIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-cost-body">
            {scene.map((b, i) =>
              <option key={i} value={i}>{b.name || b.label || `body_${i}`}</option>)}
          </select>
        </label>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Material</small>
          <select value={materialIdx}
                  onChange={(e) => setMaterialIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-cost-mat">
            {MATERIALS.map((m, i) =>
              <option key={i} value={i}>{m.name}  $${m.pricePerKgUSD}/kg</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Process</small>
          <select value={processIdx}
                  onChange={(e) => setProcessIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-cost-process">
            {PROCESSES.map((p, i) =>
              <option key={i} value={i}>{p.name}  ${p.labourUsdMin}/min</option>)}
          </select>
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {[
          { l: 'Vol [cm³]', v: volumeCm3, s: setVolumeCm3, t: 'forge-cost-vol', step: 5 },
          { l: 'Stock',     v: stockCm3,  s: setStockCm3,  t: 'forge-cost-stk', step: 5 },
          { l: 'Qty',       v: qty,       s: setQty,       t: 'forge-cost-qty', step: 1 },
          { l: 'Tool 0/1/2',v: toolFamily,s: setToolFamily,t: 'forge-cost-tool',step: 1 },
        ].map((f) => (
          <label key={f.l}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.l}</small>
            <input type="number" value={f.v} step={f.step}
                   onChange={(e) => f.s(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid={f.t} />
          </label>
        ))}
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-cost-run">
        Compute cost
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-cost-status">
        {status.text}
      </section>

      {result && (
        <>
          <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                            background: 'var(--forge-canvas)',
                            padding: 'var(--forge-space-2)',
                            borderRadius: 'var(--forge-radius)' }}
                   data-testid="forge-cost-result">
            <div>Material   ${result.unitMaterialUsd.toFixed(2)}</div>
            <div>Machining  ${result.unitMachiningUsd.toFixed(2)}  ({result.machiningTimeMin.toFixed(1)} min)</div>
            <div>Setup      ${result.unitSetupUsd.toFixed(2)}</div>
            <div>──────────────</div>
            <div><strong>Unit  ${result.unitUsd.toFixed(2)}</strong></div>
            <div><strong>Batch ×{qty}  ${result.batchUsd.toFixed(2)}</strong></div>
            <div>Mass {(result.massKg * 1000).toFixed(1)} g</div>
          </section>
          <TornadoChart tornado={result.tornado} />
        </>
      )}
    </div>
  );
}

export function CostWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCostWorkbench  = () => setOpen(true);
    window.__forgeCloseCostWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.cost' || e?.detail?.id === 'workbench.cost') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'cost') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CostWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CostWorkbenchPanel;
