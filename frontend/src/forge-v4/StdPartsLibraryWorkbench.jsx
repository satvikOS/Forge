// Forge-204 — standard parts library workbench.
//
// Searchable catalogue of parametric fasteners, bearings, gears.
// Selecting an entry generates a triangle mesh via the kernel
// `stdparts` namespace. The mesh is exposed at
// `window.__forgeLastStdPart` so the renderer / scene tree / export
// pipelines can pick it up.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 560, zIndex: 1310,
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

const inputStyle = {
  width: '100%',
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.stdparts)
      || (typeof window !== 'undefined' && window.electron && window.electron.stdparts);
}

const CATALOGUE = [
  { id: 'bolt-m3',  family: 'bolt', label: 'ISO 4014 — M3 × 20', mCode: 3,  length: 20 },
  { id: 'bolt-m4',  family: 'bolt', label: 'ISO 4014 — M4 × 25', mCode: 4,  length: 25 },
  { id: 'bolt-m5',  family: 'bolt', label: 'ISO 4014 — M5 × 25', mCode: 5,  length: 25 },
  { id: 'bolt-m6',  family: 'bolt', label: 'ISO 4014 — M6 × 30', mCode: 6,  length: 30 },
  { id: 'bolt-m8',  family: 'bolt', label: 'ISO 4014 — M8 × 30', mCode: 8,  length: 30 },
  { id: 'bolt-m10', family: 'bolt', label: 'ISO 4014 — M10 × 40', mCode: 10, length: 40 },
  { id: 'bolt-m12', family: 'bolt', label: 'ISO 4014 — M12 × 50', mCode: 12, length: 50 },
  { id: 'bolt-m16', family: 'bolt', label: 'ISO 4014 — M16 × 60', mCode: 16, length: 60 },
  { id: 'nut-m3',   family: 'nut',  label: 'ISO 4032 — M3',  mCode: 3  },
  { id: 'nut-m4',   family: 'nut',  label: 'ISO 4032 — M4',  mCode: 4  },
  { id: 'nut-m5',   family: 'nut',  label: 'ISO 4032 — M5',  mCode: 5  },
  { id: 'nut-m6',   family: 'nut',  label: 'ISO 4032 — M6',  mCode: 6  },
  { id: 'nut-m8',   family: 'nut',  label: 'ISO 4032 — M8',  mCode: 8  },
  { id: 'nut-m10',  family: 'nut',  label: 'ISO 4032 — M10', mCode: 10 },
  { id: 'nut-m12',  family: 'nut',  label: 'ISO 4032 — M12', mCode: 12 },
  { id: 'wash-m6',  family: 'washer', label: 'DIN 125 — M6 washer',  innerDiameter: 6.4,  outerDiameter: 12, thickness: 1.6 },
  { id: 'wash-m8',  family: 'washer', label: 'DIN 125 — M8 washer',  innerDiameter: 8.4,  outerDiameter: 16, thickness: 1.6 },
  { id: 'wash-m10', family: 'washer', label: 'DIN 125 — M10 washer', innerDiameter: 10.5, outerDiameter: 20, thickness: 2.0 },
  { id: 'bear-6000', family: 'bearing', label: 'Deep-groove 6000 (10 × 26 × 8)',  innerDiameter: 10, outerDiameter: 26, width: 8  },
  { id: 'bear-6004', family: 'bearing', label: 'Deep-groove 6004 (20 × 42 × 12)', innerDiameter: 20, outerDiameter: 42, width: 12 },
  { id: 'bear-6204', family: 'bearing', label: 'Deep-groove 6204 (20 × 47 × 14)', innerDiameter: 20, outerDiameter: 47, width: 14 },
  { id: 'gear-m1-z20', family: 'gear', label: 'Spur m=1 z=20 w=5',  module: 1.0, teeth: 20, faceWidth: 5  },
  { id: 'gear-m2-z30', family: 'gear', label: 'Spur m=2 z=30 w=10', module: 2.0, teeth: 30, faceWidth: 10 },
  { id: 'gear-m1-z40', family: 'gear', label: 'Spur m=1 z=40 w=6',  module: 1.0, teeth: 40, faceWidth: 6  },
];

export function generateStdPart(entry) {
  const sp = api();
  if (!sp) throw new Error('forge.stdparts not available');
  switch (entry.family) {
    case 'bolt': {
      const spec = sp.specForMetricBolt(entry.mCode, entry.length);
      return sp.makeBolt(spec, 24);
    }
    case 'nut': {
      const spec = sp.specForMetricNut(entry.mCode);
      return sp.makeNut(spec, 24);
    }
    case 'washer':
      return sp.makeWasher({
        innerDiameter: entry.innerDiameter,
        outerDiameter: entry.outerDiameter,
        thickness:     entry.thickness,
      }, 24);
    case 'bearing':
      return sp.makeBearing({
        innerDiameter: entry.innerDiameter,
        outerDiameter: entry.outerDiameter,
        width:         entry.width,
      }, 24);
    case 'gear':
      return sp.makeSpurGear({
        module:        entry.module,
        teeth:         entry.teeth,
        faceWidth:     entry.faceWidth,
        pressureAngle: 0.349,
      }, 12);
    default:
      throw new Error(`unknown stdpart family: ${entry.family}`);
  }
}

function StdPartsPanel({ open, onClose }) {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [mesh, setMesh] = React.useState(null);
  const [err, setErr] = React.useState('');

  if (!open) return null;

  const filtered = CATALOGUE.filter((e) =>
    e.label.toLowerCase().includes(query.toLowerCase()) ||
    e.family.includes(query.toLowerCase()));

  const onInsert = () => {
    if (!selected) return;
    setErr(''); setMesh(null);
    try {
      const m = generateStdPart(selected);
      setMesh(m);
      if (typeof window !== 'undefined') window.__forgeLastStdPart = m;
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-stdparts-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Standard parts</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ISO/ANSI parametric catalogue — fasteners, bearings, gears.
      </div>

      <input
        placeholder="search the catalogue…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="forge-stdparts-search"
        style={inputStyle}
      />

      <section data-testid="forge-stdparts-list"
               style={{ background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)',
                        maxHeight: 280, overflowY: 'auto',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        {filtered.map((e) => (
          <div key={e.id}
               data-testid={`forge-stdparts-row-${e.id}`}
               onClick={() => setSelected(e)}
               style={{ padding: '4px 6px', cursor: 'pointer',
                        background: selected?.id === e.id ? 'var(--forge-accent)' : 'transparent',
                        color: selected?.id === e.id ? '#0a0e14' : 'var(--forge-ink)' }}>
            <span style={{ display: 'inline-block', width: 60, opacity: 0.6 }}>
              {e.family.padEnd(8, ' ')}
            </span>
            {e.label}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)' }}>no matches</div>
        )}
      </section>

      <button
        data-testid="forge-stdparts-insert"
        style={buttonStyle} onClick={onInsert}
        disabled={!selected}
      >
        Insert into scene
      </button>

      {err && (
        <div data-testid="forge-stdparts-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {mesh && (
        <section data-testid="forge-stdparts-mesh-stats"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          {selected.label}<br />
          {mesh.positions.length / 3} verts, {mesh.indices.length / 3} tris
        </section>
      )}
    </div>
  );
}

export function StdPartsLibraryWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenStdPartsWorkbench  = () => setOpen(true);
    window.__forgeCloseStdPartsWorkbench = () => setOpen(false);
    window.__forgeStdPartsCatalogue      = CATALOGUE;
    window.__forgeGenerateStdPart        = generateStdPart;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.stdparts' || id === 'workbench.stdparts') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'stdparts') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <StdPartsPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default StdPartsPanel;
