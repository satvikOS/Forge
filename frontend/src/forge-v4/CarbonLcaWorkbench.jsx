// Forge-180 — Carbon LCA workbench.
//
// Cradle-to-gate kgCO2e accounting via forge.carbon.computeLca. Lets
// the user pick a material + process + grid region (different countries
// have very different CO2/kWh), set production qty, and see per-stage +
// total carbon footprint. Region presets cover the EU average, the
// Norway low-carbon grid, the India coal-heavy grid, and a configurable
// custom value.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const MATERIALS = [
  { name: 'Al6061',      densityKgM3: 2700, co2PerKg:  8.2, recyclingCredit: 0.85 },
  { name: 'S1018 steel', densityKgM3: 7850, co2PerKg:  1.9, recyclingCredit: 0.75 },
  { name: '304 SS',      densityKgM3: 8000, co2PerKg:  6.1, recyclingCredit: 0.85 },
  { name: 'Brass C36',   densityKgM3: 8500, co2PerKg:  4.6, recyclingCredit: 0.85 },
  { name: 'Ti6Al4V',     densityKgM3: 4430, co2PerKg: 75.0, recyclingCredit: 0.30 },
];

const PROCESSES = [
  { name: '3-axis CNC', spindleKW: 5,  overheadFactor: 1.5 },
  { name: 'Lathe',      spindleKW: 8,  overheadFactor: 1.4 },
  { name: 'Sheet press',spindleKW: 60, overheadFactor: 1.2 },
];

const GRID_PRESETS = [
  { name: 'Norway',       kwh: 0.020 },
  { name: 'France',       kwh: 0.060 },
  { name: 'EU average',   kwh: 0.385 },
  { name: 'USA average',  kwh: 0.401 },
  { name: 'Germany',      kwh: 0.420 },
  { name: 'India',        kwh: 0.708 },
  { name: 'Australia',    kwh: 0.520 },
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

function StackedBar({ stages, width = 460, height = 60 }) {
  const total = stages.reduce((s, x) => s + Math.abs(x.value), 0);
  if (total < 1e-9) return null;
  let acc = 0;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-carbon-bar">
      {stages.map((s) => {
        const w = Math.abs(s.value) / total * width;
        const x = acc;
        acc += w;
        return (
          <g key={s.label}>
            <rect x={x} y={8} width={w} height={height - 30}
                  fill={s.color} stroke="rgba(0,0,0,0.2)" strokeWidth={0.4} />
            <text x={x + w / 2} y={height - 8} fontSize={9}
                  textAnchor="middle"
                  fill="var(--forge-ink-mute)"
                  fontFamily="var(--forge-mono)">
              {s.label}  {s.value >= 0 ? '+' : '−'}{Math.abs(s.value).toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CarbonLcaWorkbenchPanel({ open, onClose }) {
  const [materialIdx, setMaterialIdx] = React.useState(0);
  const [processIdx, setProcessIdx]   = React.useState(0);
  const [gridIdx, setGridIdx]         = React.useState(2);   // EU
  const [volumeCm3, setVolumeCm3]     = React.useState(150);
  const [stockCm3, setStockCm3]       = React.useState(300);
  const [machiningMin, setMachiningMin] = React.useState(10);
  const [transportKm, setTransportKm] = React.useState(800);
  const [qty, setQty]                 = React.useState(50);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.carbon) {
      setStatus({ kind: 'err', text: 'forge.carbon kernel not available' });
      return;
    }
    try {
      const cfg = {
        material: { ...MATERIALS[materialIdx], recycledContent: 0.40 },
        process:  PROCESSES[processIdx],
        volumeCm3, stockVolumeCm3: stockCm3,
        machiningTimeMin: machiningMin,
        gridCo2PerKwh: GRID_PRESETS[gridIdx].kwh,
        transportKm,
        transportEmissionsPerTkm: 0.062,
        qty,
      };
      const r = f.carbon.computeLca(cfg);
      setResult(r);
      setStatus({ kind: 'ok',
        text: `unit ${r.unitTotalKgCo2.toFixed(2)} kgCO2e · batch ${r.batchTotalKgCo2.toFixed(1)} ` +
              `· energy ${r.energyKwh.toFixed(2)} kWh` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [materialIdx, processIdx, gridIdx, volumeCm3, stockCm3, machiningMin, transportKm, qty]);

  if (!open) return null;

  const stages = result ? [
    { label: 'material', value: result.unitMaterialKgCo2,  color: 'var(--forge-accent)' },
    { label: 'manuf',    value: result.unitManufKgCo2,     color: '#56a8d4' },
    { label: 'transport',value: result.unitTransportKgCo2, color: '#d4c356' },
    { label: 'EOL credit',value: result.unitRecyclingCreditKgCo2, color: '#79c170' },
  ] : null;

  return (
    <div style={panelStyle} data-testid="forge-carbon-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Carbon LCA · cradle-to-gate kgCO2e</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-carbon-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Material</small>
          <select value={materialIdx} onChange={(e) => setMaterialIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-carbon-mat">
            {MATERIALS.map((m, i) =>
              <option key={i} value={i}>{m.name} {m.co2PerKg.toFixed(1)} CO2/kg</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Process</small>
          <select value={processIdx} onChange={(e) => setProcessIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-carbon-process">
            {PROCESSES.map((p, i) =>
              <option key={i} value={i}>{p.name}</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Grid region</small>
          <select value={gridIdx} onChange={(e) => setGridIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-carbon-grid">
            {GRID_PRESETS.map((g, i) =>
              <option key={i} value={i}>{g.name}  {g.kwh.toFixed(3)} kg/kWh</option>)}
          </select>
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
        {[
          { l: 'Vol cm³',  v: volumeCm3,    s: setVolumeCm3,   t: 'forge-carbon-vol', step: 5 },
          { l: 'Stock',    v: stockCm3,     s: setStockCm3,    t: 'forge-carbon-stk', step: 5 },
          { l: 'Mach min', v: machiningMin, s: setMachiningMin,t: 'forge-carbon-min', step: 1 },
          { l: 'Truck km', v: transportKm,  s: setTransportKm, t: 'forge-carbon-km',  step: 100 },
          { l: 'Qty',      v: qty,          s: setQty,         t: 'forge-carbon-qty', step: 1 },
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
              data-testid="forge-carbon-run">
        Compute carbon footprint
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-carbon-status">
        {status.text}
      </section>

      {result && stages && (
        <>
          <StackedBar stages={stages} />
          <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                            background: 'var(--forge-canvas)',
                            padding: 'var(--forge-space-2)',
                            borderRadius: 'var(--forge-radius)' }}
                   data-testid="forge-carbon-result">
            <div>Mass         {(result.massKg * 1000).toFixed(0)} g</div>
            <div>Material     {result.unitMaterialKgCo2.toFixed(3)} kgCO2e</div>
            <div>Manuf        {result.unitManufKgCo2.toFixed(3)} kgCO2e  ({result.energyKwh.toFixed(2)} kWh)</div>
            <div>Transport    {result.unitTransportKgCo2.toFixed(3)} kgCO2e</div>
            <div>EOL credit   {result.unitRecyclingCreditKgCo2.toFixed(3)} kgCO2e</div>
            <div>──────────────</div>
            <div><strong>Unit total {result.unitTotalKgCo2.toFixed(3)} kgCO2e</strong></div>
            <div><strong>Batch ×{qty} {result.batchTotalKgCo2.toFixed(2)} kgCO2e</strong></div>
          </section>
        </>
      )}
    </div>
  );
}

export function CarbonLcaWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCarbonLcaWorkbench  = () => setOpen(true);
    window.__forgeCloseCarbonLcaWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.carbon' || e?.detail?.id === 'workbench.carbon') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'carbon') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CarbonLcaWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CarbonLcaWorkbenchPanel;
