// Forge-201 — sheet metal flat-pattern unfold + bend allowance.
//
// Lightweight parametric calculator that complements the OCCT-backed
// `forge::sheet` workbench (Forge-24): you describe the part as a
// chain of flange lengths + bend specs (angle / radius / K-override),
// and the kernel returns developed length, sheet area, per-bend BA/BD,
// and per-flange start positions in the flat coord system.
//
// `window.__forgeSheetMetalUnfold(input)` is the scriptable surface.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
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
  width: 90,
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.sheetmetal)
      || (typeof window !== 'undefined' && window.electron && window.electron.sheetmetal);
}

export function sheetMetalUnfold(input) {
  const sm = api();
  if (!sm) throw new Error('forge.sheetmetal not available');
  return sm.unfoldChain(input);
}

const MATERIALS = [
  'aluminium', 'mild-steel', 'stainless-steel', 'copper', 'brass', 'galvanised',
];

function defaultInput() {
  return {
    material: 'mild-steel',
    thickness: 1.0,
    width: 50,
    flangeLengths: [50, 100, 50],
    bends: [
      { angleDeg: 90, innerRadius: 1.0, kOverride: 0 },
      { angleDeg: 90, innerRadius: 1.0, kOverride: 0 },
    ],
  };
}

function SheetMetalPanel({ open, onClose }) {
  const [input, setInput] = React.useState(defaultInput());
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');

  if (!open) return null;

  const update = (patch) => setInput({ ...input, ...patch });
  const updateFlange = (i, v) => {
    const copy = input.flangeLengths.slice();
    copy[i] = Number(v) || 0;
    update({ flangeLengths: copy });
  };
  const updateBend = (i, k, v) => {
    const copy = input.bends.map((b) => ({ ...b }));
    copy[i] = { ...copy[i], [k]: Number(v) || 0 };
    update({ bends: copy });
  };
  const addBend = () => update({
    flangeLengths: [...input.flangeLengths, 50],
    bends: [...input.bends, { angleDeg: 90, innerRadius: 1.0, kOverride: 0 }],
  });
  const removeBend = () => {
    if (input.bends.length === 0) return;
    update({
      flangeLengths: input.flangeLengths.slice(0, -1),
      bends: input.bends.slice(0, -1),
    });
  };

  const onUnfold = () => {
    setErr(''); setResult(null);
    try {
      const r = sheetMetalUnfold(input);
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-sheetmetal-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Sheet metal · flat pattern</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        BA = (π/180)·α·(R + K·T) per bend, summed with flange lengths
        gives the developed length. K is looked up from the material +
        R/T table; override per-bend if needed.
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--forge-ink-mute)' }}>Material</span>
          <select value={input.material} data-testid="forge-sheetmetal-material"
                  onChange={(e) => update({ material: e.target.value })}
                  style={fieldStyle}>
            {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--forge-ink-mute)' }}>Thickness (mm)</span>
          <input type="number" step="0.1" value={input.thickness}
                 data-testid="forge-sheetmetal-thickness"
                 onChange={(e) => update({ thickness: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--forge-ink-mute)' }}>Width (mm)</span>
          <input type="number" step="1" value={input.width}
                 data-testid="forge-sheetmetal-width"
                 onChange={(e) => update({ width: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </label>
      </div>

      <section data-testid="forge-sheetmetal-chain"
               style={{ background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)',
                        display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Chain (flange → bend → flange …)</div>
        {input.flangeLengths.map((L, i) => (
          <React.Fragment key={`fl-${i}`}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 24, color: 'var(--forge-ink-mute)' }}>F{i+1}</span>
              <input type="number" step="0.5" value={L}
                     data-testid={`forge-sheetmetal-flange-${i}`}
                     onChange={(e) => updateFlange(i, e.target.value)}
                     style={fieldStyle} />
              <span>mm</span>
            </div>
            {i < input.bends.length && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 24 }}>
                <span style={{ width: 24, color: 'var(--forge-ink-mute)' }}>B{i+1}</span>
                <span>α</span>
                <input type="number" step="1" value={input.bends[i].angleDeg}
                       data-testid={`forge-sheetmetal-bend-${i}-angle`}
                       onChange={(e) => updateBend(i, 'angleDeg', e.target.value)}
                       style={fieldStyle} />
                <span>R</span>
                <input type="number" step="0.1" value={input.bends[i].innerRadius}
                       data-testid={`forge-sheetmetal-bend-${i}-radius`}
                       onChange={(e) => updateBend(i, 'innerRadius', e.target.value)}
                       style={fieldStyle} />
                <span>K (0 = auto)</span>
                <input type="number" step="0.01" value={input.bends[i].kOverride}
                       data-testid={`forge-sheetmetal-bend-${i}-k`}
                       onChange={(e) => updateBend(i, 'kOverride', e.target.value)}
                       style={fieldStyle} />
              </div>
            )}
          </React.Fragment>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <button data-testid="forge-sheetmetal-add-bend" onClick={addBend}
                  style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)', fontWeight: 400 }}>+ bend</button>
          <button data-testid="forge-sheetmetal-remove-bend" onClick={removeBend}
                  style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)', fontWeight: 400 }}>− bend</button>
        </div>
      </section>

      <button data-testid="forge-sheetmetal-unfold" style={buttonStyle} onClick={onUnfold}>
        Compute flat pattern
      </button>

      {err && (
        <div data-testid="forge-sheetmetal-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {result && (
        <section data-testid="forge-sheetmetal-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Developed length&nbsp;&nbsp;{result.developedLength.toFixed(3)} mm</div>
          <div>Sheet area&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.sheetArea.toFixed(1)} mm²</div>
          <hr style={{ borderColor: 'var(--forge-rail-edge)' }} />
          {result.perBend.map((b, i) => (
            <div key={i}>
              B{i+1}: BA {b.bendAllowance.toFixed(3)}&nbsp;
              BD {b.bendDeduction.toFixed(3)}&nbsp;
              Rn {b.neutralRadius.toFixed(3)}&nbsp;
              K {b.effectiveK.toFixed(3)}
            </div>
          ))}
          <hr style={{ borderColor: 'var(--forge-rail-edge)' }} />
          <div style={{ color: 'var(--forge-ink-mute)' }}>
            flange start X (developed): {result.flangeStartX.map((x) => x.toFixed(2)).join(', ')}
          </div>
        </section>
      )}
    </div>
  );
}

export function SheetMetalUnfoldWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSheetMetalUnfoldWorkbench  = () => setOpen(true);
    window.__forgeCloseSheetMetalUnfoldWorkbench = () => setOpen(false);
    window.__forgeSheetMetalUnfold               = sheetMetalUnfold;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sheetmetal-unfold' || id === 'workbench.sheetmetal-unfold') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'sheetmetal-unfold') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SheetMetalPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SheetMetalPanel;
