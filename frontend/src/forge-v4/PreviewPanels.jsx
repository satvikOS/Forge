// Forge-76 — Specialty preview panels.
//
// Six bottom-docked previews surface the legacy-era panels (Drawing
// Preview / Section Preview / Slicer Preview / Manufacture Preview /
// Cost Estimation / DFM Check). User flips between them via a tab
// strip; tabs persist while panel is open. Each panel renders an SVG
// or table preview at the bottom of the viewport area.
//
// Toggled from View menu or Cmd+P (preview); active tab persisted to
// forge.v4.preview.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

const TABS = [
  { id: 'drawing',  label: 'Drawing',   icon: 'wb.drawing'  },
  { id: 'section',  label: 'Section',   icon: 'view.section' },
  { id: 'slicer',   label: 'Slicer',    icon: 'pattern.linear' },
  { id: 'mfg',      label: 'Manufacture', icon: 'wb.mfg' },
  { id: 'cost',     label: 'Cost',      icon: 'measure.mass' },
  { id: 'dfm',      label: 'DFM Check', icon: 'measure.interfere' },
];

export function PreviewPanels({ open, onClose, activeTab, onSwitchTab, body, features }) {
  if (!open) return null;
  return (
    <aside className="forge-preview"
           role="region"
           aria-label="Preview panels"
           data-testid="forge-preview">
      <header className="forge-preview-header">
        <span>Preview</span>
        <nav className="forge-preview-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === activeTab}
                    className="forge-preview-tab"
                    data-active={String(t.id === activeTab)}
                    data-tab-id={t.id}
                    onClick={() => onSwitchTab?.(t.id)}>
              <Icon name={t.icon} size={12} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose}
                aria-label="Close preview"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <div className="forge-preview-body">
        {activeTab === 'drawing'  && <DrawingPreview features={features} />}
        {activeTab === 'section'  && <SectionPreview />}
        {activeTab === 'slicer'   && <SlicerPreview features={features} />}
        {activeTab === 'mfg'      && <ManufacturePreview features={features} />}
        {activeTab === 'cost'     && <CostPreview features={features} />}
        {activeTab === 'dfm'      && <DFMPreview features={features} />}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────── Drawing
function DrawingPreview({ features }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                  height: '100%', padding: 8 }}>
      <SheetView label="FRONT" />
      <SheetView label="TOP" />
      <SheetView label="RIGHT" />
      <SheetView label="ISO" isIso />
    </div>
  );
}
function SheetView({ label, isIso }) {
  return (
    <div style={{
      background: 'var(--forge-surface)',
      border: '1px solid var(--forge-rail-edge)',
      borderRadius: 4,
      padding: 6,
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg viewBox="0 0 100 60" width="80%" height="80%">
        {!isIso ? (
          <>
            <rect x={15} y={10} width={70} height={40} fill="none"
                  stroke="var(--forge-ink)" strokeWidth={0.6} />
            <line x1={15} y1={20} x2={85} y2={20} stroke="var(--forge-ink-2)" strokeWidth={0.3} />
            <line x1={50} y1={5}  x2={50} y2={55}
                  stroke="var(--forge-accent)" strokeWidth={0.3}
                  strokeDasharray="2 1.5" />
          </>
        ) : (
          <>
            <path d="M50 8 L20 25 L20 45 L50 55 L80 45 L80 25 Z"
                  fill="none" stroke="var(--forge-ink)" strokeWidth={0.6} />
            <path d="M20 25 L50 35 L80 25 M50 35 L50 55"
                  stroke="var(--forge-ink-2)" strokeWidth={0.3} fill="none" />
          </>
        )}
        <text x={50} y={58} textAnchor="middle"
              fill="var(--forge-ink-mute)" fontSize={3}
              fontFamily="var(--forge-mono)">{label}</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────── Section
function SectionPreview() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%' }}>
      <svg viewBox="0 0 240 120" width="80%" height="80%">
        {/* Body outline */}
        <rect x={40} y={20} width={160} height={80} fill="var(--forge-surface)"
              stroke="var(--forge-ink)" strokeWidth={1.2} />
        {/* Hatch lines on cut */}
        {[0,1,2,3,4,5,6,7,8,9,10].map((i) => (
          <line key={i}
                x1={40 + i*16} y1={20}
                x2={40 + i*16 - 12} y2={32}
                stroke="var(--forge-ink-2)" strokeWidth={0.5} />
        ))}
        <text x={120} y={110} textAnchor="middle"
              fill="var(--forge-ink-mute)" fontSize={6}
              fontFamily="var(--forge-mono)">SECTION A-A · scale 1:1</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────── Slicer
function SlicerPreview({ features }) {
  const [layer, setLayer] = useState(50);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                    padding: '4px 12px',
                    borderBottom: '1px solid var(--forge-rail-edge)' }}>
        <span style={{ fontSize: 11 }}>Layer</span>
        <input type="range" min="0" max="100" value={layer}
               onChange={(e) => setLayer(parseInt(e.target.value, 10))}
               style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          {layer.toString().padStart(3, '0')} / 100 · z={(layer * 0.2).toFixed(1)} mm
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'center' }}>
        <svg viewBox="0 0 100 100" width="60%" height="100%">
          {/* Print bed grid */}
          {Array.from({length: 10}).map((_, i) => (
            <React.Fragment key={i}>
              <line x1={10 + i*8} y1={10} x2={10 + i*8} y2={90}
                    stroke="var(--forge-rail-edge)" strokeWidth={0.2} />
              <line x1={10} y1={10 + i*8} x2={90} y2={10 + i*8}
                    stroke="var(--forge-rail-edge)" strokeWidth={0.2} />
            </React.Fragment>
          ))}
          {/* Active layer outline */}
          <circle cx={50} cy={50} r={20 + (layer / 100) * 8}
                  fill="none" stroke="var(--forge-accent)" strokeWidth={0.8} />
          <circle cx={50} cy={50} r={20} fill="var(--forge-accent-mute)" />
        </svg>
      </div>
      <div style={{ padding: '4px 12px',
                    borderTop: '1px solid var(--forge-rail-edge)',
                    fontSize: 11, color: 'var(--forge-ink-2)',
                    display: 'flex', gap: 16,
                    fontFamily: 'var(--forge-mono)' }}>
        <span>Material · PLA</span>
        <span>Nozzle · 0.4 mm</span>
        <span>Infill · 20 %</span>
        <span>Time · 2 h 14 min</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Manufacture
function ManufacturePreview({ features }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%' }}>
      <svg viewBox="0 0 240 120" width="80%" height="80%">
        {/* Stock outline */}
        <rect x={20} y={20} width={200} height={80} fill="none"
              stroke="var(--forge-ink-2)" strokeWidth={0.6} strokeDasharray="3 1.5" />
        {/* Pocket */}
        <rect x={60} y={40} width={120} height={40} fill="var(--forge-canvas)"
              stroke="var(--forge-ink)" strokeWidth={0.8} />
        {/* Toolpath spiral */}
        <path d="M 80 60 q 0 -15 20 -15 q 20 0 20 15 q 0 15 -10 15 q -10 0 -10 -10 q 0 -8 5 -8"
              fill="none" stroke="var(--forge-accent)" strokeWidth={0.6} />
        {/* Drill points */}
        {[140, 150, 160].map((x) => (
          <circle key={x} cx={x} cy={60} r={2}
                  fill="var(--forge-accent)" stroke="var(--forge-ink)"
                  strokeWidth={0.4} />
        ))}
      </svg>
      <div style={{ position: 'absolute', bottom: 8, left: 12,
                    fontFamily: 'var(--forge-mono)', fontSize: 11,
                    color: 'var(--forge-ink-2)' }}>
        Toolpath · Adaptive clearing · est. 18 min 22 sec
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Cost
function CostPreview({ features }) {
  const rows = [
    { item: 'Material (Aluminum 6061)',  qty: '1.42 kg', cost: 8.92 },
    { item: 'CNC machining (3.5 h)',     qty: '3.5 h',   cost: 175.00 },
    { item: 'Surface finish (anodize)',  qty: '1 ea',    cost: 28.00 },
    { item: 'Hardware (4× M6 bolts)',    qty: '4 ea',    cost: 1.20 },
    { item: 'Packaging + shipping',      qty: '1 ea',    cost: 14.50 },
  ];
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <div style={{ padding: 16, height: '100%', display: 'flex',
                  flexDirection: 'column', gap: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forge-rail-edge)',
                       color: 'var(--forge-ink-mute)', textAlign: 'left' }}>
            <th style={{ padding: '4px 6px', fontWeight: 500 }}>Item</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>USD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <td style={{ padding: '4px 6px' }}>{r.item}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right',
                           fontFamily: 'var(--forge-mono)' }}>{r.qty}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right',
                           fontFamily: 'var(--forge-mono)' }}>${r.cost.toFixed(2)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ padding: '6px', fontWeight: 600 }}>Total per unit</td>
            <td></td>
            <td style={{ padding: '6px', textAlign: 'right',
                         fontWeight: 600,
                         color: 'var(--forge-accent)',
                         fontFamily: 'var(--forge-mono)' }}>
              ${total.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                    fontStyle: 'italic' }}>
        Estimates · regional rates · qty discount tiers available at 10 / 100 / 1000 units.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── DFM
function DFMPreview({ features }) {
  const checks = [
    { id: 'walls',  label: 'Wall thickness ≥ 1.5 mm',  status: 'ok',   detail: 'All walls 1.8–4.0 mm' },
    { id: 'draft',  label: 'Draft angle ≥ 1° (molded)', status: 'warn', detail: '3 faces at 0.5° — increase to 1.5°' },
    { id: 'undercut', label: 'No undercuts in mold direction', status: 'ok' },
    { id: 'sharp', label: 'No internal sharp corners',  status: 'err', detail: '4 corners need fillet ≥ 0.5 mm' },
    { id: 'tol',   label: 'Tolerances within machine capability', status: 'ok' },
    { id: 'feature', label: 'Min feature size ≥ tool diameter', status: 'ok' },
    { id: 'hole',  label: 'Hole diameters ≥ 2 mm', status: 'ok' },
  ];
  const COLOR = { ok: 'var(--forge-ok)', warn: 'var(--forge-warn)', err: 'var(--forge-err)' };
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 12 }}>
        Design-for-Manufacture · CNC milling
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                   display: 'flex', flexDirection: 'column', gap: 4 }}>
        {checks.map((c) => (
          <li key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 10px',
                background: 'var(--forge-surface)',
                borderLeft: `3px solid ${COLOR[c.status]}`,
                borderRadius: 3,
                fontSize: 11,
              }}>
            <span style={{ color: COLOR[c.status], fontWeight: 600, minWidth: 30,
                           fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
              {c.status.toUpperCase()}
            </span>
            <span style={{ flex: 1 }}>{c.label}</span>
            {c.detail && (
              <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
                {c.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div style={{
        marginTop: 8,
        fontSize: 11, color: 'var(--forge-ink-2)',
        background: 'var(--forge-surface)',
        padding: '6px 10px', borderRadius: 3,
      }}>
        Score · 5/7 passes · 1 warning · 1 error. Address sharp corners
        to ship-ready.
      </div>
    </div>
  );
}
