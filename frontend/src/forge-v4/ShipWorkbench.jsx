// Forge-157 — ShipWorkbench: hull library + naval-architecture
// calculator + IMO intact stability gate.
//
// Self-mounts via portal. Reachable through Tools > Ship workbench…
// (window.__forgeOpenShipWorkbench).

import React from 'react';
import { createPortal } from 'react-dom';
import {
  hullVolume, blockCoeff, prismaticCoeff, waterplaneCoeff,
  gzCurve, imoIntactStabilityCheck, HULL_LIBRARY, HEEL_SAMPLES_DEG,
} from './shipNavalArch.js';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 440, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

function GZCurveSVG({ data, width = 380, height = 180 }) {
  if (!data || data.length < 2)
    return <div style={{ color: 'var(--forge-ink-mute)' }}>no GZ data</div>;
  const padL = 36, padB = 22, padT = 8, padR = 8;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const xs = data.map((d) => d.heel_deg);
  const ys = data.map((d) => d.GZ_m);
  const xMin = 0, xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0.001, ...ys);
  const x = (v) => padL + (v / xMax) * w;
  const y = (v) => padT + h - ((v - yMin) / (yMax - yMin)) * h;
  const path = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${x(d.heel_deg).toFixed(1)} ${y(d.GZ_m).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} style={{ background: 'var(--forge-canvas)' }}>
      {/* zero axis */}
      <line x1={padL} y1={y(0)} x2={padL + w} y2={y(0)}
            stroke="var(--forge-rail-edge)" strokeDasharray="3 3" />
      {/* axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      {/* ticks */}
      {[0, 30, 60, 90].map((deg) => (
        <g key={deg}>
          <line x1={x(deg)} y1={padT + h} x2={x(deg)} y2={padT + h + 3}
                stroke="var(--forge-rail-edge)" />
          <text x={x(deg)} y={padT + h + 14} fontSize={9}
                fill="var(--forge-ink-mute)" textAnchor="middle"
                fontFamily="var(--forge-mono)">{deg}°</text>
        </g>
      ))}
      {/* curve */}
      <path d={path} fill="none" stroke="var(--forge-accent)" strokeWidth={1.5} />
      {data.map((d, i) => (
        <circle key={i} cx={x(d.heel_deg)} cy={y(d.GZ_m)} r={1.8}
                fill="var(--forge-accent)" />
      ))}
    </svg>
  );
}

export function ShipWorkbenchPanel({ open, onClose }) {
  const [hullId, setHullId] = React.useState('container-feeder');
  const hull = HULL_LIBRARY.find((h) => h.id === hullId) || HULL_LIBRARY[0];
  // Override-able inputs.
  const [L, setL] = React.useState(hull.Lpp_m);
  const [B, setB] = React.useState(hull.B_m);
  const [T, setT] = React.useState(hull.T_m);
  const [Cb, setCb] = React.useState(hull.Cb);
  const [GMt, setGMt] = React.useState(0.45);
  const [BMt, setBMt] = React.useState(2.10);
  React.useEffect(() => {
    setL(hull.Lpp_m); setB(hull.B_m); setT(hull.T_m); setCb(hull.Cb);
  }, [hullId, hull.Lpp_m, hull.B_m, hull.T_m, hull.Cb]);

  // Derived numbers.
  const volume_m3 = L * B * T * Cb;
  const displacement_t = volume_m3 * 1.025;       // saltwater 1.025 t/m³
  const Am   = B * T * 0.95;                      // assume Cm ≈ 0.95
  const Cp   = prismaticCoeff(volume_m3, Am, L);
  const Aw   = L * B * 0.85;                       // Cw ≈ 0.85 for fuller hulls
  const Cw   = waterplaneCoeff(Aw, L, B);
  const Cb_  = blockCoeff(volume_m3, L, B, T);

  const curve = gzCurve({ GMt_m: GMt, BMt_m: BMt, heelAnglesDeg: HEEL_SAMPLES_DEG });
  const imo   = imoIntactStabilityCheck(curve);

  if (!open) return null;
  return (
    <div style={panelStyle} data-testid="forge-ship-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Ship · naval architecture</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-ship-close">×</button>
      </header>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Hull library</div>
        <select value={hullId} onChange={(e) => setHullId(e.target.value)}
                style={{ width: '100%', background: 'var(--forge-canvas)',
                         color: 'var(--forge-ink)', border: '1px solid var(--forge-rail-edge)',
                         padding: '6px 8px', fontFamily: 'var(--forge-mono)' }}
                data-testid="forge-ship-hull">
          {HULL_LIBRARY.map((h) =>
            <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <small style={{ color: 'var(--forge-ink-mute)' }}>{hull.notes}</small>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {[
          { label: 'Lpp [m]', val: L, set: setL, step: 0.5 },
          { label: 'B [m]',   val: B, set: setB, step: 0.1 },
          { label: 'T [m]',   val: T, set: setT, step: 0.1 },
          { label: 'Cb',      val: Cb, set: setCb, step: 0.01 },
          { label: 'GM_T [m]', val: GMt, set: setGMt, step: 0.05 },
          { label: 'BM_T [m]', val: BMt, set: setBMt, step: 0.05 },
        ].map((f) => (
          <label key={f.label}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
            <input type="number" value={f.val} step={f.step}
                   onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                   style={{ width: '100%', background: 'var(--forge-canvas)',
                            color: 'var(--forge-ink)',
                            border: '1px solid var(--forge-rail-edge)',
                            padding: '4px 6px', fontFamily: 'var(--forge-mono)' }} />
          </label>
        ))}
      </section>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)' }}>
        <div>Volume ∇   {volume_m3.toFixed(1)} m³</div>
        <div>Displacement {displacement_t.toFixed(1)} t</div>
        <div>Cb {Cb_.toFixed(3)} · Cp {Cp.toFixed(3)} · Cw {Cw.toFixed(3)}</div>
        <div>Midship area Am {Am.toFixed(2)} m²</div>
        <div>Waterplane area Aw {Aw.toFixed(1)} m²</div>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>GZ curve (righting lever)</div>
        <GZCurveSVG data={curve} />
      </section>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        background: imo.pass ? 'rgba(126,201,143,0.15)' : 'rgba(226,106,106,0.15)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)' }}>
        <div><strong>IMO IS Code 2008 — intact stability</strong></div>
        <div>{imo.pass ? '✓ all criteria pass' : '✗ violations:'}</div>
        {!imo.pass && imo.violations.map((v, i) =>
          <div key={i} style={{ paddingLeft: 12 }}>· {v}</div>)}
      </section>
    </div>
  );
}

export function ShipWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenShipWorkbench = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.ship') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(<ShipWorkbenchPanel open={open}
                                          onClose={() => setOpen(false)} />,
                      document.body);
}

export default ShipWorkbenchPanel;
