// PUSH-115 (Slice-84) — Thermal Analysis panel.
//
// PUSH-48 wired the full Simulation workbench (10 study types including
// Thermal) and PUSH-114 (Slice-83) factored Modal out into its own
// dedicated single-purpose panel. PUSH-115 does the same for steady-
// state heat conduction — the most common day-to-day thermal workflow:
//
//   "Given this body, this material, and these per-face boundary
//    conditions (fixed temperature OR heat flux), what is the
//    temperature field at steady state?"
//
// Surface contract:
//
//   1. Picks the active body from the live scene (defaults to the
//      selected body if window.__forgeSelection points at one).
//   2. Reads thermal conductivity k (W/mK) for that body from the
//      PUSH-109 store at window.__forgeMaterialProperties[handle].
//      "No material yet" → points the user at PUSH-109.
//   3. Per-face boundary conditions table:
//        face id (0..5 — six AABB faces of the body)
//        type   (Dirichlet | Neumann)
//        value  (T in °C  | q in W/m²)
//      Add / remove rows; rows persist on window.__forgeThermalAnalysis
//      so the e2e + Archie can audit the panel state.
//   4. Mesh resolution slider (mm) — same UX as PUSH-114 ; converted
//      to metres on the kernel hop.
//   5. Solve → real native call:
//        mesh = forge.fea.meshFromBrep(bodyHandle, sizeMeters)
//        dirichlet rows expanded to per-node nodal BCs via the
//          mesh.nodeToFace bitfield (bit `faceId` set on the AABB face).
//        Neumann rows distributed to element sources for elements with
//          ≥3 nodes on the face — q_body = q_n / characteristic_length.
//        forge.fea.solveThermal(mesh, { k }, dirichletNodal,
//                               sourcesElem, [])
//      Result: nodal Float64Array T (Kelvin) → display min/max/avg in °C.
//
// Real kernel only. No fabricated temperatures, no fallback table.
//
// AABB-face id convention (matches FeaExtras nodeToFace bitfield):
//
//   0 → −X     1 → +X
//   2 → −Y     3 → +Y
//   4 → −Z     5 → +Z

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const FACE_LABELS = Object.freeze([
  '-X (face 0)', '+X (face 1)', '-Y (face 2)', '+Y (face 3)', '-Z (face 4)', '+Z (face 5)',
]);

const BC_TYPES = Object.freeze(['Dirichlet', 'Neumann']);

const CELSIUS_OFFSET = 273.15;

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
 * Read thermal conductivity k (W/mK) for a body handle from the PUSH-109
 * material record. Returns null if no material has been set, or the
 * record has no k entry, so the caller can surface the "set a material
 * preset" hint.
 */
export function readThermalMaterialForHandle(handle) {
  if (typeof window === 'undefined' || !Number.isFinite(handle)) return null;
  const map = window.__forgeMaterialProperties;
  if (!map || typeof map !== 'object') return null;
  const rec = map[handle];
  if (!rec || typeof rec !== 'object') return null;
  const k = Number(rec.k);
  if (!Number.isFinite(k) || k <= 0) return null;
  return {
    k,                                          // W/mK
    density_gcc: Number(rec.density) || null,   // g/cc
    cp:          Number(rec.cp)      || null,   // J/kgK
    alpha:       Number(rec.alpha)   || null,   // ×1e-6 /K
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
 * Expand per-face Dirichlet rows to nodal {nodeId, T} entries using the
 * mesh's nodeToFace bitfield. T is converted °C → K on the way in.
 *
 * If a node sits on multiple faces (e.g. an AABB corner), all matching
 * Dirichlet rows are appended — the kernel honours the *last* write,
 * which produces a consistent corner temperature.
 */
function expandDirichlet(mesh, bcs) {
  const out = [];
  if (!mesh || !mesh.nodeToFace) return out;
  const nodeCount = mesh.nodeCount
    ?? (mesh.nodes ? mesh.nodes.length / 3 : mesh.nodeToFace.length);
  for (const bc of bcs) {
    if (bc.type !== 'Dirichlet') continue;
    const T_K = Number(bc.value) + CELSIUS_OFFSET;
    if (!Number.isFinite(T_K)) continue;
    const bit = 1 << (bc.faceId | 0);
    for (let i = 0; i < nodeCount; i++) {
      if ((mesh.nodeToFace[i] & bit) !== 0) {
        out.push({ nodeId: i, T: T_K });
      }
    }
  }
  return out;
}

/**
 * Expand per-face Neumann (heat flux W/m²) rows to per-element sources
 * (W/m³). For each element whose surface coincides with the AABB face,
 * we deposit q_body = q_n / characteristic_length where the length is
 * the mesh element size.
 *
 * Surface elements are detected as those with ≥3 (or ≥4 for hex) nodes
 * on the target face.
 */
function expandNeumannToSources(mesh, bcs, elemSize_m) {
  const out = [];
  if (!mesh || !mesh.tets || !mesh.nodeToFace) return out;
  const elemNodeCount = mesh.elemNodeCount || 4;
  const elemCount = mesh.elemCount
    ?? (mesh.tets.length / elemNodeCount);
  const minNodes = elemNodeCount >= 8 ? 4 : 3;
  const L = elemSize_m > 0 ? elemSize_m : 1e-3;
  for (const bc of bcs) {
    if (bc.type !== 'Neumann') continue;
    const q_n = Number(bc.value); // W/m²
    if (!Number.isFinite(q_n) || q_n === 0) continue;
    const bit = 1 << (bc.faceId | 0);
    const q_body = q_n / L; // W/m³
    for (let e = 0; e < elemCount; e++) {
      let count = 0;
      for (let q = 0; q < elemNodeCount; q++) {
        const nid = mesh.tets[e * elemNodeCount + q];
        if ((mesh.nodeToFace[nid] & bit) !== 0) count += 1;
      }
      if (count >= minNodes) out.push({ elemId: e, q: q_body });
    }
  }
  return out;
}

/**
 * Real-kernel steady-state thermal solve.
 *
 *   bodyHandle  — uint32 native ShapeHandle
 *   meshSize_mm — target element size in mm
 *   k_WmK       — conductivity in W/mK
 *   bcs         — array of { faceId: 0..5, type: 'Dirichlet'|'Neumann',
 *                            value: number }   value units:
 *                   Dirichlet → °C
 *                   Neumann   → W/m²
 *
 * Returns { temperature: { minC, maxC, avgC, nodeCount, T_K },
 *           meshInfo, error?, elapsedMs }.
 */
export function runThermalAnalysis(bodyHandle, meshSize_mm, k_WmK, bcs) {
  const fea = kernelFea();
  if (!fea) return { error: 'kernel not ready' };
  if (!Number.isInteger(bodyHandle) || bodyHandle <= 0) {
    return { error: `bad bodyHandle ${bodyHandle}` };
  }
  if (!(meshSize_mm > 0)) return { error: 'mesh size must be > 0' };
  if (!(k_WmK > 0))       return { error: 'thermal conductivity k must be > 0' };
  const dirichletRows = (bcs || []).filter((b) => b && b.type === 'Dirichlet');
  if (dirichletRows.length === 0) {
    return { error: 'add at least one Dirichlet BC — the steady-state solve is otherwise singular' };
  }
  const sizeMeters = meshSize_mm / 1000;

  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  let mesh;
  try {
    mesh = fea.meshFromBrep(bodyHandle, sizeMeters);
  } catch (err) {
    return { error: `mesh: ${err && err.message ? err.message : String(err)}` };
  }
  if (!mesh || typeof mesh !== 'object') {
    return { error: 'mesh: empty result from kernel' };
  }
  const nodeCount = mesh.nodeCount
    ?? (Array.isArray(mesh.nodes) || mesh.nodes ? mesh.nodes.length / 3 : 0);
  const elemCount = mesh.elemCount
    ?? (Array.isArray(mesh.tets) || mesh.tets
        ? mesh.tets.length / (mesh.elemNodeCount || 4) : 0);

  const dirichlet = expandDirichlet(mesh, bcs);
  if (dirichlet.length === 0) {
    return { error: 'no nodes on the requested Dirichlet faces — try a coarser mesh or different face ids' };
  }
  const sources = expandNeumannToSources(mesh, bcs, sizeMeters);

  let raw;
  try {
    raw = fea.solveThermal(mesh, { k: k_WmK }, dirichlet, sources, []);
  } catch (err) {
    return { error: `solveThermal: ${err && err.message ? err.message : String(err)}` };
  }
  if (!raw || !raw.T) {
    return { error: 'solveThermal: empty result' };
  }

  const T_K = raw.T;
  let sum = 0;
  for (let i = 0; i < T_K.length; i++) sum += T_K[i];
  const avgK = T_K.length > 0 ? sum / T_K.length : NaN;
  const minK = Number.isFinite(raw.minT) ? raw.minT : NaN;
  const maxK = Number.isFinite(raw.maxT) ? raw.maxT : NaN;

  const result = {
    temperature: {
      nodeCount: T_K.length,
      minK, maxK, avgK,
      minC: minK - CELSIUS_OFFSET,
      maxC: maxK - CELSIUS_OFFSET,
      avgC: avgK - CELSIUS_OFFSET,
      T_K,
    },
    residual: Number.isFinite(raw.residual) ? raw.residual : null,
    meshInfo: { nodeCount, elemCount, sizeMeters, sizeMm: meshSize_mm },
    bcExpansion: {
      dirichletRows: dirichletRows.length,
      dirichletNodes: dirichlet.length,
      neumannRows: (bcs || []).filter((b) => b.type === 'Neumann').length,
      sourceElems:  sources.length,
    },
  };
  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  result.elapsedMs = t1 - t0;

  if (typeof window !== 'undefined') {
    window.__forgeThermalAnalysis = {
      bodyHandle,
      meshSize_mm,
      k_WmK,
      bcs: (bcs || []).map((b) => ({ ...b })),
      temperature: {
        nodeCount: result.temperature.nodeCount,
        minC: result.temperature.minC,
        maxC: result.temperature.maxC,
        avgC: result.temperature.avgC,
        minK: result.temperature.minK,
        maxK: result.temperature.maxK,
        avgK: result.temperature.avgK,
      },
      residual: result.residual,
      meshInfo: result.meshInfo,
      bcExpansion: result.bcExpansion,
      timestamp: Date.now(),
    };
    try {
      window.dispatchEvent(new CustomEvent('forge:thermal-analysis-run', {
        detail: {
          bodyHandle,
          minC: result.temperature.minC,
          maxC: result.temperature.maxC,
          avgC: result.temperature.avgC,
        },
      }));
    } catch { /* ignore */ }
  }
  return result;
}

if (typeof window !== 'undefined') {
  window.__forgeThermalAnalysisHelper = Object.freeze({
    runThermalAnalysis,
    readThermalMaterialForHandle,
    FACE_LABELS,
    BC_TYPES,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1337,
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
  padding: '3px 4px',
  borderBottom: '1px solid var(--forge-canvas-3, #333)',
};

const statBoxStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  flex: 1,
};

export function ThermalAnalysisPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listNativeBodies());
  const [bodyHandle, setBodyHandle] = useState(() => preferredBody()?.handle ?? null);
  const [meshSize, setMeshSize] = useState(5);     // mm
  const [bcs, setBcs] = useState(() => [
    { faceId: 0, type: 'Dirichlet', value: 100 },
    { faceId: 1, type: 'Dirichlet', value: 0 },
  ]);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const [running, setRunning] = useState(false);

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
    () => activeBody ? readThermalMaterialForHandle(activeBody.handle) : null,
    [activeBody, bodies, result],
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

  const onAddBc = useCallback(() => {
    setBcs((rows) => [...rows, { faceId: 0, type: 'Dirichlet', value: 25 }]);
    setResult(null);
  }, []);

  const onRemoveBc = useCallback((idx) => () => {
    setBcs((rows) => rows.filter((_, i) => i !== idx));
    setResult(null);
  }, []);

  const onChangeBcField = useCallback((idx, field) => (e) => {
    const v = e?.target?.value;
    setBcs((rows) => rows.map((r, i) => {
      if (i !== idx) return r;
      if (field === 'faceId') return { ...r, faceId: Number(v) | 0 };
      if (field === 'type')   return { ...r, type: String(v) };
      if (field === 'value')  return { ...r, value: v === '' ? '' : Number(v) };
      return r;
    }));
    setResult(null);
  }, []);

  const onSolve = useCallback(() => {
    setError(null);
    setResult(null);
    if (!activeBody) { setError('Pick a body first.'); return; }
    if (!material)  { setError('No material k — open Material Properties (FEA) and Apply a preset for this body.'); return; }
    setRunning(true);
    try {
      const cleanBcs = (bcs || []).map((r) => ({
        faceId: Number(r.faceId) | 0,
        type:   r.type,
        value:  Number(r.value),
      }));
      const r = runThermalAnalysis(activeBody.handle, meshSize, material.k, cleanBcs);
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
  }, [activeBody, material, meshSize, bcs]);

  if (!open) return null;

  const T = result?.temperature;

  return (
    <div style={panelStyle} data-testid="forge-thermal-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Thermal Analysis (FEA · steady-state)</strong>
        <button onClick={onClose}
                data-testid="forge-thermal-close"
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
        Pick a body, define per-face boundary conditions (Dirichlet °C / Neumann W/m²),
        then Solve. Conductivity k is read from
        <code style={{ fontFamily: 'var(--forge-mono)', marginLeft: 4 }}>
          window.__forgeMaterialProperties[handle].k
        </code>.
      </div>

      <label style={labelStyle}>
        Body:
        <select data-testid="forge-thermal-body"
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

      <div data-testid="forge-thermal-material"
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
            <span data-testid="forge-thermal-material-k">
              k = {material.k.toFixed(2)} W/mK
            </span>
            {material.cp ? (
              <>
                {'  ·  '}
                <span data-testid="forge-thermal-material-cp">
                  cp = {material.cp.toFixed(0)} J/kgK
                </span>
              </>
            ) : null}
            {material.alpha ? (
              <>
                {'  ·  '}
                <span data-testid="forge-thermal-material-alpha">
                  α = {material.alpha.toFixed(1)} ×1e-6/K
                </span>
              </>
            ) : null}
          </>
        ) : (
          <span>No material k set for this body — open Material Properties (FEA).</span>
        )}
      </div>

      <label style={labelStyle}>
        Mesh resolution (mm):
        <input type="range"
               min={1} max={20} step={0.5}
               data-testid="forge-thermal-mesh-slider"
               value={meshSize}
               onChange={onChangeMesh}
               style={{ flex: 1 }} />
        <span data-testid="forge-thermal-mesh-value"
              style={{
                fontFamily: 'var(--forge-mono)',
                fontSize: 11,
                minWidth: 32, textAlign: 'right',
              }}>
          {meshSize.toFixed(1)}
        </span>
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <strong style={{ fontSize: 12 }}>Boundary conditions</strong>
        <button onClick={onAddBc}
                data-testid="forge-thermal-bc-add"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '2px 8px',
                  borderRadius: 3,
                  fontSize: 11,
                }}>
          + Add BC
        </button>
      </div>

      <table data-testid="forge-thermal-bc-table" style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Face</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Value</th>
            <th style={thStyle}>Unit</th>
            <th style={thStyle}> </th>
          </tr>
        </thead>
        <tbody>
          {bcs.length === 0 && (
            <tr>
              <td colSpan={5} style={{ ...tdStyle, color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
                No BCs — add at least one Dirichlet row before solving.
              </td>
            </tr>
          )}
          {bcs.map((row, idx) => (
            <tr key={idx}
                data-testid={`forge-thermal-bc-row-${idx}`}
                data-bc-index={idx}>
              <td style={tdStyle}>
                <select data-testid={`forge-thermal-bc-face-${idx}`}
                        value={row.faceId}
                        onChange={onChangeBcField(idx, 'faceId')}
                        style={{ ...inputStyle, width: 'auto' }}>
                  {FACE_LABELS.map((lbl, i) => (
                    <option key={i} value={i}>{lbl}</option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select data-testid={`forge-thermal-bc-type-${idx}`}
                        value={row.type}
                        onChange={onChangeBcField(idx, 'type')}
                        style={{ ...inputStyle, width: 'auto' }}>
                  {BC_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input type="number"
                       step={row.type === 'Neumann' ? 100 : 1}
                       data-testid={`forge-thermal-bc-value-${idx}`}
                       value={row.value === '' ? '' : row.value}
                       onChange={onChangeBcField(idx, 'value')}
                       style={{ ...inputStyle, width: 84 }} />
              </td>
              <td style={{ ...tdStyle, color: 'var(--forge-ink-mute)', fontSize: 10 }}>
                {row.type === 'Neumann' ? 'W/m²' : '°C'}
              </td>
              <td style={tdStyle}>
                <button onClick={onRemoveBc(idx)}
                        data-testid={`forge-thermal-bc-remove-${idx}`}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--forge-rail-edge)',
                          color: 'var(--forge-ink-mute)',
                          cursor: 'pointer',
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontSize: 11,
                        }}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <button onClick={onSolve}
                data-testid="forge-thermal-solve"
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
          {running ? 'Solving…' : 'Solve'}
        </button>
        <span data-testid="forge-thermal-status"
              style={{
                color: error
                  ? 'var(--forge-bad, #ff6363)'
                  : (result ? 'var(--forge-good, #5fb05f)' : 'var(--forge-ink-mute)'),
                fontSize: 11,
              }}>
          {error
            ? `Error · ${error}`
            : result
              ? `Solved · ${result.temperature.nodeCount} nodes · ${result.elapsedMs.toFixed(0)} ms`
              : (activeBody ? `Ready · ${bodyLabel(activeBody)}` : 'No body selected')}
        </span>
      </footer>

      {result && result.meshInfo && (
        <div data-testid="forge-thermal-mesh-info"
             style={{
               color: 'var(--forge-ink-mute)',
               fontFamily: 'var(--forge-mono)',
               fontSize: 10,
             }}>
          Mesh: {result.meshInfo.nodeCount} nodes · {result.meshInfo.elemCount} elements · size {result.meshInfo.sizeMm} mm
          {' · '}
          BC: {result.bcExpansion.dirichletNodes} Dirichlet nodes · {result.bcExpansion.sourceElems} Neumann source elements
        </div>
      )}

      {T && Number.isFinite(T.minC) && Number.isFinite(T.maxC) && Number.isFinite(T.avgC) && (
        <section data-testid="forge-thermal-stats"
                 style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>Min temperature</span>
            <strong data-testid="forge-thermal-min-c" style={{ fontSize: 14 }}>
              {T.minC.toFixed(2)} °C
            </strong>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}
                  data-testid="forge-thermal-min-k">
              {T.minK.toFixed(2)} K
            </span>
          </div>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>Avg temperature</span>
            <strong data-testid="forge-thermal-avg-c" style={{ fontSize: 14 }}>
              {T.avgC.toFixed(2)} °C
            </strong>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}
                  data-testid="forge-thermal-avg-k">
              {T.avgK.toFixed(2)} K
            </span>
          </div>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>Max temperature</span>
            <strong data-testid="forge-thermal-max-c" style={{ fontSize: 14 }}>
              {T.maxC.toFixed(2)} °C
            </strong>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}
                  data-testid="forge-thermal-max-k">
              {T.maxK.toFixed(2)} K
            </span>
          </div>
        </section>
      )}

      {error && (
        <div data-testid="forge-thermal-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — wires the menu action + imperative open/close hook.

export function ThermalAnalysisHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenThermalAnalysis  = () => setOpen(true);
    window.__forgeCloseThermalAnalysis = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.thermalAnalysis' || id === 'workbench.thermalAnalysis') {
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
    <ThermalAnalysisPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ThermalAnalysisPanel;
