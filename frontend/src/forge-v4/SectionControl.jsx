// Forge-118 — cross-section cutting plane control.
//
// Floating panel near the HUT with axis radio (X/Y/Z), offset slider, and
// enable toggle. The selected state is published to window.__forgeSection
// and consumed by Viewport.jsx via the sectionPlane prop.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + var(--forge-toolbar-h) + 56px)',
  left: 'calc(var(--forge-wb-rail-w) + var(--forge-space-3))',
  zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  minWidth: 220,
};

const axisBtn = (active) => ({
  flex: 1,
  background: active ? 'var(--forge-accent-mute)' : 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', padding: '4px 0', cursor: 'pointer',
  fontFamily: 'var(--forge-mono)', fontSize: 11,
});

export function SectionControl({ open, onClose, plane, onChange }) {
  if (!open) return null;
  return (
    <div style={panelStyle} data-testid="forge-section-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Section · cutting plane</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-section-close">×</button>
      </header>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <input type="checkbox" checked={!!plane.enabled}
               onChange={(e) => onChange({ ...plane, enabled: e.target.checked })}
               data-testid="forge-section-enabled" />
        <span>Enabled</span>
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        {['X','Y','Z'].map((axis) => (
          <button key={axis}
                  style={axisBtn(plane.axis === axis)}
                  onClick={() => onChange({ ...plane, axis })}
                  data-section-axis={axis}>
            {axis}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <small style={{ color: 'var(--forge-ink-mute)' }}>Offset (mm)</small>
        <input type="range" min={-100} max={100} step={0.5}
               value={plane.offset || 0}
               onChange={(e) => onChange({ ...plane, offset: parseFloat(e.target.value) })}
               data-testid="forge-section-offset" />
        <output style={{ fontFamily: 'var(--forge-mono)', textAlign: 'right' }}>
          {(plane.offset || 0).toFixed(2)} mm
        </output>
      </label>
    </div>
  );
}

export function SectionControlHost() {
  const [open, setOpen] = React.useState(false);
  const [plane, setPlane] = React.useState({ enabled: false, axis: 'Z', offset: 0 });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeSection = plane;
    window.__forgeOpenSection = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    window.__forgeSetSection = (next) => setPlane(next);
    window.dispatchEvent(new CustomEvent('forge:section-update', { detail: plane }));
  }, [plane, open]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SectionControl open={open} onClose={() => setOpen(false)}
                    plane={plane} onChange={setPlane} />,
    document.body);
}
