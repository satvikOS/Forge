// Forge-73 — Project Library (standard parts).
//
// Drag-to-insert library of common engineering parts. Acts like the
// SolidWorks Design Library / Fusion 360 Insert > Standard Parts.
// Categories: Fasteners · Bearings · Pipe Fittings · Profiles · Springs
// · Custom. Each item carries metadata for the kernel call.

import React, { useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';

const LIB = {
  fasteners: {
    label: 'Fasteners',
    icon: 'misc.lock',
    items: [
      { id: 'hex-bolt-m6x25',  label: 'Hex bolt M6 × 25',    icon: 'solid.thread', spec: { kind: 'bolt', standard: 'ISO 4017', size: 'M6', length: 25 } },
      { id: 'hex-bolt-m8x30',  label: 'Hex bolt M8 × 30',    icon: 'solid.thread', spec: { kind: 'bolt', standard: 'ISO 4017', size: 'M8', length: 30 } },
      { id: 'hex-bolt-m10x40', label: 'Hex bolt M10 × 40',   icon: 'solid.thread', spec: { kind: 'bolt', standard: 'ISO 4017', size: 'M10', length: 40 } },
      { id: 'hex-nut-m6',      label: 'Hex nut M6',          icon: 'sketch.polygon', spec: { kind: 'nut',  standard: 'ISO 4032', size: 'M6' } },
      { id: 'washer-m6',       label: 'Washer M6',           icon: 'sketch.circle', spec: { kind: 'washer', standard: 'ISO 7089', size: 'M6' } },
      { id: 'screw-m4x10',     label: 'Cap screw M4 × 10',   icon: 'solid.thread', spec: { kind: 'screw', standard: 'ISO 4762', size: 'M4', length: 10 } },
      { id: 'screw-m4x16',     label: 'Cap screw M4 × 16',   icon: 'solid.thread', spec: { kind: 'screw', standard: 'ISO 4762', size: 'M4', length: 16 } },
    ],
  },
  bearings: {
    label: 'Bearings',
    icon: 'sketch.circle',
    items: [
      { id: 'bearing-608',  label: 'Ball bearing 608',  icon: 'sketch.circle', spec: { kind: 'bearing', standard: 'ISO 15', code: '608'  } },
      { id: 'bearing-6201', label: 'Ball bearing 6201', icon: 'sketch.circle', spec: { kind: 'bearing', standard: 'ISO 15', code: '6201' } },
      { id: 'bearing-6204', label: 'Ball bearing 6204', icon: 'sketch.circle', spec: { kind: 'bearing', standard: 'ISO 15', code: '6204' } },
    ],
  },
  profiles: {
    label: 'Structural Profiles',
    icon: 'wb.weldments',
    items: [
      { id: 'rect-40x60x3',  label: 'Rect tube 40×60×3 mm', icon: 'sketch.rect', spec: { kind: 'profile', shape: 'rect', a: 40, b: 60, t: 3 } },
      { id: 'sq-50x50x4',    label: 'Square tube 50×50×4',  icon: 'sketch.rect', spec: { kind: 'profile', shape: 'square', a: 50, t: 4 } },
      { id: 'round-48x3.6',  label: 'Round tube Ø48×3.6',   icon: 'sketch.circle', spec: { kind: 'profile', shape: 'round', d: 48.3, t: 3.6 } },
      { id: 'angle-50x50x5', label: 'Angle 50×50×5',        icon: 'wb.weldments', spec: { kind: 'profile', shape: 'angle', a: 50, t: 5 } },
      { id: 'c-100x50x5',    label: 'C-channel 100×50×5',   icon: 'wb.weldments', spec: { kind: 'profile', shape: 'c-channel', h: 100, w: 50, t: 5 } },
      { id: 'i-ipe100',      label: 'I-beam IPE100',        icon: 'wb.weldments', spec: { kind: 'profile', shape: 'i-beam', code: 'IPE100' } },
    ],
  },
  springs: {
    label: 'Springs',
    icon: 'pattern.spring',
    items: [
      { id: 'comp-12x60',  label: 'Compression Ø12 × 60', icon: 'pattern.spring', spec: { kind: 'spring', shape: 'compression', d: 12, length: 60 } },
      { id: 'ext-10x40',   label: 'Extension Ø10 × 40',   icon: 'pattern.spring', spec: { kind: 'spring', shape: 'extension', d: 10, length: 40 } },
    ],
  },
  pipe: {
    label: 'Pipe Fittings',
    icon: 'sketch.circle',
    items: [
      { id: 'elbow-90-dn25', label: 'Elbow 90° DN25', icon: 'sketch.arc', spec: { kind: 'fitting', shape: 'elbow', angle: 90, dn: 25 } },
      { id: 'tee-dn25',      label: 'Tee DN25',        icon: 'sketch.polygon', spec: { kind: 'fitting', shape: 'tee', dn: 25 } },
      { id: 'flange-dn50',   label: 'Flange DN50',     icon: 'sketch.circle', spec: { kind: 'fitting', shape: 'flange', dn: 50 } },
    ],
  },
};

export function ProjectLibrary({ open, onClose, onInsert }) {
  const [activeCat, setActiveCat] = useState('fasteners');
  const [filter, setFilter] = useState('');
  if (!open) return null;
  const cats = Object.entries(LIB);
  const items = (LIB[activeCat]?.items || []).filter((it) =>
    !filter || it.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <aside className="forge-library"
           role="region"
           aria-label="Project library"
           data-testid="forge-library">
      <header className="forge-library-header">
        <span>Standard Parts</span>
        <button type="button" onClick={onClose}
                aria-label="Close library"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <div className="forge-library-search">
        <Icon name="misc.search" size={12} />
        <input type="text"
               placeholder="Filter parts…"
               value={filter}
               onChange={(e) => setFilter(e.target.value)} />
      </div>
      <nav className="forge-library-cats" role="tablist">
        {cats.map(([id, cat]) => (
          <button key={id} type="button"
                  className="forge-library-cat"
                  data-active={String(id === activeCat)}
                  onClick={() => setActiveCat(id)}
                  aria-pressed={id === activeCat}>
            <Icon name={cat.icon} size={12} />
            <span>{cat.label}</span>
          </button>
        ))}
      </nav>
      <div className="forge-library-items">
        {items.length === 0 ? (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11, padding: 4 }}>
            No matches.
          </div>
        ) : items.map((it) => (
          <button key={it.id} type="button"
                  className="forge-library-item"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('forge/standard-part', JSON.stringify(it.spec)); }}
                  onClick={() => {
                    onInsert?.(it);
                    showToast({ kind: 'info', text: `${it.label} inserted at origin`, ttl: 1500 });
                  }}>
            <Icon name={it.icon} size={12} />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
