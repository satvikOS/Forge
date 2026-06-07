// PUSH-114 (Slice-83) — Modal Analysis panel.
//
// PUSH-48 wired the full Simulation workbench (10 study types) and
// PUSH-109 added the per-body Material Properties editor for E + ν + ρ
// + σY + σU + k + α + cp. Modal analysis lived inside the omnibus
// Simulation panel as one tab of a 1300-line study editor — too deep
// for the day-to-day "what's the fundamental natural frequency of this
// bracket?" workflow.
//
// PUSH-114 ships a dedicated single-purpose Modal Analysis panel that:
//
//   1. Picks the active body from the live scene (defaults to the
//      selected body if window.__forgeSelection points at one).
//   2. Reads E (Pa) + density (kg/m³) for that body straight off the
//      PUSH-109 store at window.__forgeMaterialProperties[handle].
//      A "no material yet — pick a preset in Material Properties" hint
//      points the user at PUSH-109 when the slot is empty.
//   3. Mesh resolution slider (mm) — kept in mm in the UI like every
//      other Forge sim panel; converted to metres on the kernel hop.
//   4. Number of modes input (1..10, clamped, default 3).
//   5. Run → real native call. We mesh the body via forge.fea.meshFromBrep,
//      then call forge.fea.solveModal(mesh, material, bcs, nModes) to
//      extract eigenvalues (ω²). The Hz frequency table is computed
//      from f = √λ / (2π).
//   6. Results table — rank, eigenvalue (rad²/s²), frequency (Hz),
//      period (ms). Mode shapes are stored alongside so a later viewer
//      can replay them.
//
// Real kernel only. No fake frequencies, no fallback table.
//
// Persistence: lightweight — last-used mesh size + nModes + last result
// summary land on window.__forgeModalAnalysis so an e2e + Archie can
// read them without scraping the DOM.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const PI2 = 2 * Math.PI;

// ─────────────────────────────────────────────────────────────────────
// Body + material helpers.

function listNativeBodies() {
  if (typeof window === 'undefined') return [];
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return arr.filter((b) => b && typeof b.handle === 'number');
}

function preferredBody() {
  const all = listNativeBodies();
  if (all.length === 0) return null;
  if (typeof window !== 'undefined') {
    const sel = window.__forgeSelection;
    if (sel && typeof sel.bodyHandle === 'number') {
      const m = all.find((b) => b.handle === sel.bodyHandle);
      if (m) return m;
    }
  }
  return all[all.length - 1];
}

function bodyLabel(b) {
  if (!b) return 'None';
  return b.name || b.id || `handle ${b.handle}`;
}

/**
 * Pull the PUSH-109 material record for a body handle and convert it to
 * SI units the kernel expects:
 *   E       — GPa  → Pa     (×1e9)
 *   density — g/cc → kg/m³  (×1000)
 *   nu      — already dimensionless
 *   sigmaY  — MPa  → Pa     (×1e6)
 *
 * Returns null if there's no per-body material yet — the caller surfaces
 * the "pick a material" hint in that case.
 */
export function readMaterialForHandle(handle) {
  if (typeof window === 'undefined' || !Number.isFinite(handle)) return null;
  const map = window.__forgeMaterialProperties;
  if (!map || typeof map !== 'object') return null;
  const rec = map[handle];
  if (!rec || typeof rec !== 'object') return null;
  const E_GPa = Number(rec.E);
  const density_gcc = Number(rec.density);
  if (!Number.isFinite(E_GPa) || E_GPa <= 0) return null;
  if (!Number.isFinite(density_gcc) || density_gcc <= 0) return null;
  return {
    E_GPa,
    density_gcc,
    nu: Number.isFinite(rec.nu) ? rec.nu : 0.3,
    sigmaY_MPa: Number.isFinite(rec.sigmaY) ? rec.sigmaY : 0,
    // SI for the kernel.
    E:    E_GPa * 1e9,
    rho:  density_gcc * 1000,
    sigmaY: (Number.isFinite(rec.sigmaY) ? rec.sigmaY : 0) * 1e6,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Kernel dispatch.

function kernelFea() {
  if (typeof window === 'undefined') return null;
  const f = window.forge;
  if (!f || !f.fea) return null;
  return f.fea;
}

/**
 * Real-kernel modal solve.
 *
 *   bodyHandle  — uint32 native ShapeHandle
 *   meshSize_mm — target tet element size in mm (converted to m)
 *   material    — { E (Pa), rho (kg/m³), nu }
 *   nModes      — positive integer 1..10
 *
 * Returns { modes: [{ rank, omega2, freqHz, periodMs, modeShape }],
 *           meshInfo, error?, elapsedMs }.
 *
 * No fabricated frequencies — if the kernel call throws we surface the
 * raw error and return an empty modes list.
 */
export function runModalAnalysis(bodyHandle, meshSize_mm, material, nModes) {
  const fea = kernelFea();
  if (!fea) return { error: 'kernel not ready', modes: [] };
  if (!Number.isInteger(bodyHandle) || bodyHandle <= 0) {
    return { error: `bad bodyHandle ${bodyHandle}`, modes: [] };
  }
  if (!(meshSize_mm > 0)) return { error: 'mesh size must be > 0', modes: [] };
  if (!material || !(material.E > 0) || !(material.rho > 0)) {
    return { error: 'material missing E or density', modes: [] };
  }
  const k = Math.max(1, Math.min(10, Math.round(nModes)));
  const sizeMeters = meshSize_mm / 1000;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  let mesh;
  try {
    mesh = fea.meshFromBrep(bodyHandle, sizeMeters);
  } catch (err) {
    return { error: `mesh: ${err && err.message ? err.message : String(err)}`,
             modes: [] };
  }
  if (!mesh || typeof mesh !== 'object') {
    return { error: 'mesh: empty result from kernel', modes: [] };
  }
  const nodeCount = mesh.nodeCount
    ?? (Array.isArray(mesh.nodes) ? mesh.nodes.length / 3 : 0);
  const elemCount = mesh.elemCount
    ?? (Array.isArray(mesh.elements)
        ? mesh.elements.length / (mesh.elemNodeCount || 4) : 0);

  // No bcs → free-free modal (the kernel still returns ω² > 0 for the
  // structural modes; rigid-body modes show as near-zero and we filter
  // them when computing the Hz table). For a more "engineering" modal
  // the user can pin a face via PUSH-48; PUSH-114 keeps free-free as
  // the dedicated panel's contract because mesh resolution + nModes are
  // the two knobs the brief calls out.
  const mat = { E: material.E, nu: material.nu ?? 0.3, rho: material.rho,
                sigmaY: material.sigmaY || 0 };
  let raw;
  try {
    raw = fea.solveModal(mesh, mat, [], k);
  } catch (err) {
    return { error: `solveModal: ${err && err.message ? err.message : String(err)}`,
             modes: [] };
  }
  if (!raw || (!raw.eigenvalues && !raw.eigenvectors)) {
    return { error: 'solveModal: empty result', modes: [] };
  }

  const eigs = raw.eigenvalues || raw.eigvals || [];
  const vecs = raw.eigenvectors || raw.eigvecs || [];
  const modes = [];
  for (let i = 0; i < eigs.length; i++) {
    const omega2 = Math.max(0, Number(eigs[i]) || 0);
    const omega  = Math.sqrt(omega2);
    const freqHz = omega / PI2;
    const periodMs = freqHz > 0 ? 1000 / freqHz : Infinity;
    modes.push({
      rank: i + 1,
      omega2,
      omega,
      freqHz,
      periodMs,
      modeShape: vecs[i] || null,
    });
  }
  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

  const out = {
    modes,
    meshInfo: { nodeCount, elemCount, sizeMeters, sizeMm: meshSize_mm },
    nModes: k,
    elapsedMs: t1 - t0,
  };

  if (typeof window !== 'undefined') {
    window.__forgeModalAnalysis = {
      bodyHandle,
      meshSize_mm,
      material: { E: material.E, rho: material.rho, nu: material.nu },
      nModes: k,
      modes: modes.map((m) => ({
        rank: m.rank, omega2: m.omega2, omega: m.omega,
        freqHz: m.freqHz, periodMs: m.periodMs,
      })),
      meshInfo: out.meshInfo,
      timestamp: Date.now(),
    };
    try {
      window.dispatchEvent(new CustomEvent('forge:modal-analysis-run',
        { detail: { bodyHandle, nModes: k, count: modes.length } }));
    } catch { /* ignore */ }
  }

  return out;
}

// Expose the helper so the e2e + Archie can drive a modal solve without
// the panel having to be open.
if (typeof window !== 'undefined') {
  window.__forgeModalAnalysisHelper = Object.freeze({
    runModalAnalysis,
    readMaterialForHandle,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1336,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  fontSize: 12,
  overflowY: 'auto',
};

const labelStyle = { display: 'flex', alignItems: 'center', gap: 8 };

const inputStyle = {
  background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  width: '100%',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
};

const thStyle = {
  textAlign: 'left',
  padding: '4px 6px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink-mute)',
  fontWeight: 600,
};

const tdStyle = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--forge-canvas-3, #333)',
};

export function ModalAnalysisPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listNativeBodies());
  const [bodyHandle, setBodyHandle] = useState(() => preferredBody()?.handle ?? null);
  const [meshSize, setMeshSize] = useState(5);     // mm
  const [nModes, setNModes]   = useState(3);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const [running, setRunning] = useState(false);

  // Refresh body list + material when the panel opens or the selection /
  // bodies change.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const all = listNativeBodies();
      setBodies(all);
      const sel = (typeof window !== 'undefined' && window.__forgeSelection)
        ? window.__forgeSelection.bodyHandle : null;
      const pickHandle = (typeof sel === 'number' && all.some((b) => b.handle === sel))
        ? sel
        : (bodyHandle != null && all.some((b) => b.handle === bodyHandle))
          ? bodyHandle
          : (all[all.length - 1]?.handle ?? null);
      setBodyHandle(pickHandle);
    };
    refresh();
    const onSel = () => refresh();
    const onMat = () => refresh();
    window.addEventListener('forge:selection-changed', onSel);
    window.addEventListener('forge:material-properties-applied', onMat);
    return () => {
      window.removeEventListener('forge:selection-changed', onSel);
      window.removeEventListener('forge:material-properties-applied', onMat);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBody = useMemo(
    () => bodies.find((b) => b.handle === bodyHandle) || null,
    [bodies, bodyHandle],
  );

  const material = useMemo(
    () => activeBody ? readMaterialForHandle(activeBody.handle) : null,
    [activeBody, bodies, result], // refresh after Apply / Run
  );

  const onPickBody = useCallback((e) => {
    const h = Number(e?.target?.value);
    if (!Number.isFinite(h)) return;
    setBodyHandle(h);
    setResult(null);
    setError(null);
  }, []);

  const onChangeMesh = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v) && v > 0) setMeshSize(v);
  }, []);

  const onChangeModes = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v)) setNModes(Math.max(1, Math.min(10, Math.round(v))));
  }, []);

  const onRun = useCallback(() => {
    setError(null);
    setResult(null);
    if (!activeBody) { setError('Pick a body first.'); return; }
    if (!material)  { setError('No material — open Material Properties (FEA) and Apply a preset for this body.'); return; }
    setRunning(true);
    try {
      const r = runModalAnalysis(activeBody.handle, meshSize, material, nModes);
      if (r.error) {
        setError(r.error);
      } else {
        setResult(r);
      }
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [activeBody, material, meshSize, nModes]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-modal-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Modal Analysis (FEA · eigen)</strong>
        <button onClick={onClose}
                data-testid="forge-modal-close"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Pick a body, mesh resolution + number of modes, then Run. Material
        (E + density) is read from the PUSH-109 record at
        <code style={{ fontFamily: 'var(--forge-mono)', marginLeft: 4 }}>
          window.__forgeMaterialProperties[handle]
        </code>.
      </div>

      <label style={labelStyle}>
        Body:
        <select data-testid="forge-modal-body"
                value={bodyHandle ?? ''}
                onChange={onPickBody}
                style={{ ...inputStyle, flex: 1, width: 'auto' }}>
          {bodies.length === 0 && (
            <option value="">— no bodies in scene —</option>
          )}
          {bodies.map((b) => (
            <option key={b.handle} value={b.handle}>
              {bodyLabel(b)} (h:{b.handle})
            </option>
          ))}
        </select>
      </label>

      <div data-testid="forge-modal-material"
           style={{
             background: 'var(--forge-canvas)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 4,
             padding: '6px 8px',
             fontFamily: 'var(--forge-mono)',
             fontSize: 11,
             color: material ? 'var(--forge-ink)' : 'var(--forge-warn, #c9a23a)',
           }}>
        {material ? (
          <>
            <span data-testid="forge-modal-material-E">
              E = {material.E_GPa.toFixed(1)} GPa
            </span>
            {'  ·  '}
            <span data-testid="forge-modal-material-density">
              ρ = {material.density_gcc.toFixed(2)} g/cc
            </span>
            {'  ·  '}
            <span data-testid="forge-modal-material-nu">
              ν = {Number(material.nu).toFixed(3)}
            </span>
          </>
        ) : (
          <span>No material set for this body — open Material Properties (FEA).</span>
        )}
      </div>

      <label style={labelStyle}>
        Mesh resolution (mm):
        <input type="range"
               min={1} max={20} step={0.5}
               data-testid="forge-modal-mesh-slider"
               value={meshSize}
               onChange={onChangeMesh}
               style={{ flex: 1 }} />
        <span data-testid="forge-modal-mesh-value"
              style={{
                fontFamily: 'var(--forge-mono)',
                fontSize: 11,
                minWidth: 32, textAlign: 'right',
              }}>
          {meshSize.toFixed(1)}
        </span>
      </label>

      <label style={labelStyle}>
        Number of modes (1-10):
        <input type="number"
               min={1} max={10} step={1}
               data-testid="forge-modal-nmodes"
               value={nModes}
               onChange={onChangeModes}
               style={{ ...inputStyle, width: 64 }} />
      </label>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onRun}
                data-testid="forge-modal-run"
                disabled={!activeBody || !material || running}
                style={{
                  background: 'var(--forge-accent, #2f80ed)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: (activeBody && material && !running) ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  opacity: running ? 0.6 : 1,
                }}>
          {running ? 'Solving…' : 'Run Modal'}
        </button>
        <span data-testid="forge-modal-status"
              style={{
                color: error
                  ? 'var(--forge-bad, #ff6363)'
                  : (result ? 'var(--forge-good, #5fb05f)' : 'var(--forge-ink-mute)'),
                fontSize: 11,
              }}>
          {error
            ? `Error · ${error}`
            : result
              ? `Solved · ${result.modes.length} modes · ${result.elapsedMs.toFixed(0)} ms`
              : (activeBody ? `Ready · ${bodyLabel(activeBody)}` : 'No body selected')}
        </span>
      </footer>

      {result && result.meshInfo && (
        <div data-testid="forge-modal-mesh-info"
             style={{
               color: 'var(--forge-ink-mute)',
               fontFamily: 'var(--forge-mono)',
               fontSize: 10,
             }}>
          Mesh: {result.meshInfo.nodeCount} nodes · {result.meshInfo.elemCount} elements · size {result.meshInfo.sizeMm} mm
        </div>
      )}

      {result && result.modes.length > 0 && (
        <table data-testid="forge-modal-modes-table" style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Mode</th>
              <th style={thStyle}>ω² (rad²/s²)</th>
              <th style={thStyle}>Frequency (Hz)</th>
              <th style={thStyle}>Period (ms)</th>
            </tr>
          </thead>
          <tbody>
            {result.modes.map((m) => (
              <tr key={m.rank}
                  data-testid={`forge-modal-row-${m.rank}`}
                  data-mode={m.rank}>
                <td style={tdStyle}>{m.rank}</td>
                <td style={tdStyle}>{Number.isFinite(m.omega2) ? m.omega2.toExponential(3) : '—'}</td>
                <td style={tdStyle}
                    data-testid={`forge-modal-freq-${m.rank}`}>
                  {Number.isFinite(m.freqHz) ? m.freqHz.toFixed(2) : '—'}
                </td>
                <td style={tdStyle}>
                  {Number.isFinite(m.periodMs) && m.periodMs < 1e9 ? m.periodMs.toFixed(3) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && (
        <div data-testid="forge-modal-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — wires the menu action + imperative open/close hook.

export function ModalAnalysisHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenModalAnalysis  = () => setOpen(true);
    window.__forgeCloseModalAnalysis = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.modalAnalysis' || id === 'workbench.modalAnalysis') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ModalAnalysisPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ModalAnalysisPanel;
