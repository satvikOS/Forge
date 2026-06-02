// Forge-212 — S-N fatigue life workbench.
//
// Basquin + Miner's rule from the kernel. Material picker → load
// blocks → per-block Nf + damage + total damage + cycles remaining.
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
  width: 100,
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.fatigue)
      || (typeof window !== 'undefined' && window.electron && window.electron.fatigue);
}

export function fatigueDamage(input) {
  const f = api();
  if (!f) throw new Error('forge.fatigue not available');
  return f.cumulativeDamage(input);
}

const MATERIALS = ['mild-steel', '4340-steel', '7075-T6', '2024-T3', 'Ti-6Al-4V', 'ductile-iron'];

function defaultBlocks() {
  return [
    { stressAmplitudeMPa: 500, appliedCycles: 100 },
    { stressAmplitudeMPa: 400, appliedCycles: 500 },
    { stressAmplitudeMPa: 300, appliedCycles: 1000 },
  ];
}

function FatiguePanel({ open, onClose }) {
  const [material, setMaterial] = React.useState('mild-steel');
  const [blocks, setBlocks]     = React.useState(defaultBlocks);
  const [result, setResult]     = React.useState(null);
  const [err, setErr]           = React.useState('');

  if (!open) return null;

  const onRun = () => {
    setErr(''); setResult(null);
    try {
      const fApi = api();
      const mat = fApi.materialDefaults(material);
      const r = fatigueDamage({ blocks, material: mat });
      setResult({ r, mat });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const updateBlock = (i, k, v) => {
    const copy = blocks.map((b) => ({ ...b }));
    copy[i] = { ...copy[i], [k]: Number(v) || 0 };
    setBlocks(copy);
  };
  const addBlock = () => setBlocks([
    ...blocks,
    { stressAmplitudeMPa: 200, appliedCycles: 1000 },
  ]);
  const removeBlock = () => setBlocks(blocks.slice(0, -1));

  return (
    <div style={panelStyle} data-testid="forge-fatigue-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Fatigue life (S-N + Miner)</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Basquin's law σ_a = σ'_f·(2N_f)^b per block, Miner's rule
        D = Σ n_i/N_f,i, failure ⇔ D ≥ 1.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Material</span>
        <select value={material}
                data-testid="forge-fatigue-material"
                onChange={(e) => setMaterial(e.target.value)}
                style={{ ...fieldStyle, width: 180 }}>
          {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <section style={{ background: 'var(--forge-canvas)', padding: 6,
                        borderRadius: 4 }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>
          Load blocks
        </div>
        {blocks.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 24, color: 'var(--forge-ink-mute)' }}>{i+1}</span>
            <span>σ_a (MPa)</span>
            <input type="number" step="10" value={b.stressAmplitudeMPa}
                   data-testid={`forge-fatigue-stress-${i}`}
                   onChange={(e) => updateBlock(i, 'stressAmplitudeMPa', e.target.value)}
                   style={fieldStyle} />
            <span>n cycles</span>
            <input type="number" step="100" value={b.appliedCycles}
                   data-testid={`forge-fatigue-cycles-${i}`}
                   onChange={(e) => updateBlock(i, 'appliedCycles', e.target.value)}
                   style={fieldStyle} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4 }}>
          <button data-testid="forge-fatigue-add" onClick={addBlock}
                  style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)', fontWeight: 400 }}>+ block</button>
          <button data-testid="forge-fatigue-remove" onClick={removeBlock}
                  style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)', fontWeight: 400 }}>− block</button>
        </div>
      </section>

      <button data-testid="forge-fatigue-run" style={buttonStyle} onClick={onRun}>
        Compute damage
      </button>

      {err && (
        <div data-testid="forge-fatigue-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-fatigue-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-fatigue-status"
               style={{ color: result.r.failed ? '#ff6363' : '#4ade80',
                        fontWeight: 700, fontSize: 13 }}>
            {result.r.failed ? 'FAILED (D ≥ 1)' : 'PASS (D < 1)'}
          </div>
          <div>material&nbsp;&nbsp;{material} (σ'f = {result.mat.sigmaFCoef} MPa, b = {result.mat.bExponent})</div>
          <div>total D&nbsp;&nbsp;&nbsp;{result.r.totalDamage.toExponential(3)}</div>
          <div>cycles left&nbsp;{result.r.cyclesRemaining.toFixed(0)}</div>
          <hr style={{ borderColor: 'var(--forge-rail-edge)' }} />
          {Array.from(result.r.perBlock).map((b, i) => (
            <div key={i}>
              block {i+1}: Nf = {b.cyclesToFailure.toFixed(0)}, D = {b.damageContribution.toExponential(2)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function FatigueLifeWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFatigueWorkbench  = () => setOpen(true);
    window.__forgeCloseFatigueWorkbench = () => setOpen(false);
    window.__forgeFatigueDamage         = fatigueDamage;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.fatigue' || id === 'workbench.fatigue') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'fatigue') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FatiguePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FatiguePanel;
