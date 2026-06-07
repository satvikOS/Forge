// PUSH-120 (Slice-88) — Buckling Analysis panel.
//
// PUSH-48 wired the omnibus Simulation workbench (10 study types
// including linearised buckling). PUSH-114 factored Modal into its own
// dedicated panel and PUSH-115 did the same for steady-state Thermal.
// PUSH-120 ships the equivalent dedicated single-purpose Buckling
// Analysis panel for the most common day-to-day workflow:
//
//   "Given this body, this material, and a compressive load applied
//    axially across one AABB face with the opposite face clamped,
//    what is the critical buckling factor λ, and therefore the critical
//    load P_cr = λ × |F_applied|?"
//
// Surface contract:
//
//   1. Picks the active body from the live scene (defaults to the
//      selected body if window.__forgeSelection points at one).
//   2. Reads Young's modulus E (Pa) + ν + density (kg/m³) for that body
//      from the PUSH-109 store at window.__forgeMaterialProperties[handle].
//      "No material yet" → points the user at PUSH-109.
//   3. Applied load configuration:
//        * Magnitude (N)               — pure positive number
//        * Direction (-X / +X / -Y / +Y / -Z / +Z) — one AABB face axis
//        * Loaded face id (0..5)       — distributed across nodes on the
//                                        chosen face; sign of the per-node
//                                        load is implied by Direction.
//        * Clamp face id (0..5)        — pinned in all 3 DOF; defaults
//                                        to the opposite face of Loaded.
//   4. Mesh resolution slider (mm).
//   5. nModes input (1..5, clamped, default 3).
//   6. Run → real native call:
//        mesh   = forge.fea.meshFromBrep(bodyHandle, sizeMeters)
//        loads  = expand Direction × Magnitude across loaded-face nodes
//                 (per-node F = ±Magnitude / nNodes along the chosen axis)
//        bcs    = pinned all 3 DOF on every clamp-face node
//        result = forge.fea.solveBuckling(mesh, material, loads, bcs, nModes)
//      Results: λ₁ (first critical buckling factor), P_cr = λ × |F|, and
//      a modes table listing every reported λᵢ with its P_cr,i.
//
// Real kernel only. No fabricated factors, no fallback table.
//
// AABB-face id convention (matches FeaExtras nodeToFace bitfield, used
// by ThermalAnalysisPanel as well):
//
//   0 → −X     1 → +X
//   2 → −Y     3 → +Y
//   4 → −Z     5 → +Z
//
// Persistence: lightweight — last-used mesh size + load + nModes + last
// result summary land on window.__forgeBucklingAnalysis so an e2e +
// Archie can read them without scraping the DOM.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// AABB-face id convention — six AABB faces of a brep body. Order +
// labels match the PUSH-115 ThermalAnalysisPanel exactly so a user
// switching between thermal + buckling doesn't have to relearn the
// face indices.
export const FACE_LABELS = Object.freeze([
  '-X (face 0)', '+X (face 1)', '-Y (face 2)', '+Y (face 3)', '-Z (face 4)', '+Z (face 5)',
]);

// Direction signs — index 0..5 maps to a unit vector pointing INTO the
// face (i.e. compressive on the loaded face). Loaded face 1 (+X) is
// canonically loaded along -X (pushing into the body) for a column under
// axial compression, which matches the forge-kernel buckling smoke at
// forge-kernel/test/buckling_smoke.js.
export const DIRECTIONS = Object.freeze([
  { id: '-X', fx: -1, fy:  0, fz:  0, label: '−X' },
  { id: '+X', fx:  1, fy:  0, fz:  0, label: '+X' },
  { id: '-Y', fx:  0, fy: -1, fz:  0, label: '−Y' },
  { id: '+Y', fx:  0, fy:  1, fz:  0, label: '+Y' },
  { id: '-Z', fx:  0, fy:  0, fz: -1, label: '−Z' },
  { id: '+Z', fx:  0, fy:  0, fz:  1, label: '+Z' },
]);

// Default opposite-face mapping. Loaded face → clamp face (and vice
// versa); also drives the canonical compressive direction so a fresh
// user gets a textbook fixed-free column with a single click.
const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];

// Each loaded face has a canonical inward compressive direction. Face 1
// (+X) → -X load. Used to auto-pick the Direction when the user picks a
// loaded face.
const INWARD_DIR_FOR_FACE = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

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
 *   nu      — dimensionless
 *
 * Returns null if the body has no PUSH-109 record yet — the caller
 * surfaces the "open Material Properties (FEA)" hint in that case.
 */
export function readBucklingMaterialForHandle(handle) {
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
    // SI for the kernel.
    E:   E_GPa * 1e9,
    rho: density_gcc * 1000,
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
 * Expand a face id into per-node selection by scanning mesh.nodeToFace.
 * Returns an array of node ids.
 */
function nodesOnFace(mesh, faceId) {
  const out = [];
  if (!mesh || !mesh.nodeToFace) return out;
  const bit = 1 << (faceId | 0);
  const nodeCount = mesh.nodeCount
    ?? (mesh.nodes ? mesh.nodes.length / 3 : mesh.nodeToFace.length);
  for (let i = 0; i < nodeCount; i++) {
    if ((mesh.nodeToFace[i] & bit) !== 0) out.push(i);
  }
  return out;
}

/**
 * Real-kernel linearised buckling solve.
 *
 *   bodyHandle  — uint32 native ShapeHandle
 *   meshSize_mm — target element size in mm (converted to m)
 *   material    — { E (Pa), rho (kg/m³), nu }
 *   loadSpec    — { magnitudeN: number > 0,
 *                   directionId: '-X'..'+Z',
 *                   loadedFaceId: 0..5,
 *                   clampFaceId:  0..5 }
 *   nModes      — positive integer 1..5
 *
 * Returns { lambda1, P_cr, modes: [{ rank, lambda, P_cr_i }],
 *           meshInfo, loadInfo, error?, elapsedMs }.
 */
export function runBucklingAnalysis(bodyHandle, meshSize_mm, material, loadSpec, nModes) {
  const fea = kernelFea();
  if (!fea) return { error: 'kernel not ready', modes: [] };
  if (typeof fea.solveBuckling !== 'function') {
    return { error: 'forge.fea.solveBuckling missing — kernel not built', modes: [] };
  }
  if (!Number.isInteger(bodyHandle) || bodyHandle <= 0) {
    return { error: `bad bodyHandle ${bodyHandle}`, modes: [] };
  }
  if (!(meshSize_mm > 0)) return { error: 'mesh size must be > 0', modes: [] };
  if (!material || !(material.E > 0) || !(material.rho > 0)) {
    return { error: 'material missing E or density', modes: [] };
  }
  if (!loadSpec || !(loadSpec.magnitudeN > 0)) {
    return { error: 'applied load magnitude must be > 0', modes: [] };
  }
  const dir = DIRECTIONS.find((d) => d.id === loadSpec.directionId);
  if (!dir) {
    return { error: `unknown load direction ${loadSpec.directionId}`, modes: [] };
  }
  const loadedFaceId = loadSpec.loadedFaceId | 0;
  const clampFaceId  = loadSpec.clampFaceId  | 0;
  if (loadedFaceId < 0 || loadedFaceId > 5) {
    return { error: `loaded face id ${loadedFaceId} out of range (0..5)`, modes: [] };
  }
  if (clampFaceId < 0 || clampFaceId > 5) {
    return { error: `clamp face id ${clampFaceId} out of range (0..5)`, modes: [] };
  }
  if (clampFaceId === loadedFaceId) {
    return { error: 'clamp face must differ from loaded face', modes: [] };
  }

  const k = Math.max(1, Math.min(5, Math.round(nModes)));
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
    ?? (Array.isArray(mesh.tets)
        ? mesh.tets.length / (mesh.elemNodeCount || 4) : 0);

  // Expand BCs — every node on the clamp face is pinned in all 3 DOF.
  const clampNodes = nodesOnFace(mesh, clampFaceId);
  if (clampNodes.length === 0) {
    return {
      error: `no mesh nodes on clamp face ${clampFaceId} — coarsen the mesh or pick a different face`,
      modes: [],
    };
  }
  const bcs = clampNodes.map((id) => ({ nodeId: id, fx: true, fy: true, fz: true }));

  // Expand loads — distribute the magnitude over loaded-face nodes.
  const loadedNodes = nodesOnFace(mesh, loadedFaceId);
  if (loadedNodes.length === 0) {
    return {
      error: `no mesh nodes on loaded face ${loadedFaceId} — coarsen the mesh or pick a different face`,
      modes: [],
    };
  }
  const perNode = loadSpec.magnitudeN / loadedNodes.length;
  const loads = loadedNodes.map((id) => ({
    nodeId: id,
    fx: perNode * dir.fx,
    fy: perNode * dir.fy,
    fz: perNode * dir.fz,
  }));

  const mat = { E: material.E, nu: material.nu ?? 0.3, rho: material.rho };
  let raw;
  try {
    raw = fea.solveBuckling(mesh, mat, loads, bcs, k);
  } catch (err) {
    return {
      error: `solveBuckling: ${err && err.message ? err.message : String(err)}`,
      modes: [],
    };
  }
  if (!raw || !raw.loadFactors) {
    return { error: 'solveBuckling: empty result', modes: [] };
  }

  // |Applied|  — the kernel uses Σ |F_i| across every loaded node which
  // for our uniform per-node distribution simply equals magnitudeN.
  const F_applied = loadSpec.magnitudeN;

  const lambdas = Array.from(raw.loadFactors || []);
  const modes = [];
  for (let i = 0; i < lambdas.length; i++) {
    const lam = Number(lambdas[i]);
    if (!Number.isFinite(lam)) continue;
    modes.push({
      rank: i + 1,
      lambda: lam,
      P_cr_i: lam * F_applied,
    });
  }

  const lambda1 = Number.isFinite(raw.firstCriticalLoad)
    ? (F_applied > 0 ? raw.firstCriticalLoad / F_applied : NaN)
    : (modes[0]?.lambda ?? NaN);
  const P_cr = Number.isFinite(raw.firstCriticalLoad)
    ? raw.firstCriticalLoad
    : (Number.isFinite(lambda1) ? lambda1 * F_applied : NaN);

  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const out = {
    modes,
    lambda1,
    P_cr,
    F_applied,
    meshInfo: { nodeCount, elemCount, sizeMeters, sizeMm: meshSize_mm },
    loadInfo: {
      magnitudeN: loadSpec.magnitudeN,
      directionId: dir.id,
      loadedFaceId,
      clampFaceId,
      loadedNodes: loadedNodes.length,
      clampNodes:  clampNodes.length,
    },
    cpuMs: Number.isFinite(raw.cpuMs) ? raw.cpuMs : null,
    nModes: Number.isFinite(raw.nModes) ? raw.nModes : modes.length,
    elapsedMs: t1 - t0,
  };

  if (typeof window !== 'undefined') {
    window.__forgeBucklingAnalysis = {
      bodyHandle,
      meshSize_mm,
      material: { E: material.E, rho: material.rho, nu: material.nu },
      loadSpec: {
        magnitudeN:  loadSpec.magnitudeN,
        directionId: dir.id,
        loadedFaceId,
        clampFaceId,
      },
      nModes: k,
      lambda1: out.lambda1,
      P_cr: out.P_cr,
      F_applied: out.F_applied,
      modes: modes.map((m) => ({
        rank: m.rank,
        lambda: m.lambda,
        P_cr_i: m.P_cr_i,
      })),
      meshInfo: out.meshInfo,
      loadInfo: out.loadInfo,
      cpuMs: out.cpuMs,
      timestamp: Date.now(),
    };
    try {
      window.dispatchEvent(new CustomEvent('forge:buckling-analysis-run', {
        detail: {
          bodyHandle,
          lambda1: out.lambda1,
          P_cr: out.P_cr,
          count: modes.length,
        },
      }));
    } catch { /* ignore */ }
  }

  return out;
}

// Expose the helper so the e2e + Archie can drive a buckling solve
// without the panel having to be open.
if (typeof window !== 'undefined') {
  window.__forgeBucklingAnalysisHelper = Object.freeze({
    runBucklingAnalysis,
    readBucklingMaterialForHandle,
    FACE_LABELS,
    DIRECTIONS,
    OPPOSITE_FACE,
    INWARD_DIR_FOR_FACE,
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
  zIndex: 1338,
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

export function BucklingAnalysisPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listNativeBodies());
  const [bodyHandle, setBodyHandle] = useState(() => preferredBody()?.handle ?? null);
  const [meshSize, setMeshSize] = useState(5);            // mm
  const [magnitudeN, setMagnitudeN] = useState(1000);     // N
  const [loadedFaceId, setLoadedFaceId] = useState(1);    // +X face
  const [clampFaceId, setClampFaceId] = useState(0);      // -X face
  const [directionId, setDirectionId] = useState('-X');   // load pushes into the body along -X
  const [nModes, setNModes] = useState(3);
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
    () => activeBody ? readBucklingMaterialForHandle(activeBody.handle) : null,
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

  const onChangeMagnitude = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v) && v > 0) setMagnitudeN(v);
  }, []);

  const onChangeLoadedFace = useCallback((e) => {
    const id = Number(e?.target?.value) | 0;
    setLoadedFaceId(id);
    // Auto-pick the opposite face for the clamp + the inward direction.
    setClampFaceId(OPPOSITE_FACE[id]);
    setDirectionId(INWARD_DIR_FOR_FACE[id]);
    setResult(null);
  }, []);

  const onChangeClampFace = useCallback((e) => {
    setClampFaceId(Number(e?.target?.value) | 0);
    setResult(null);
  }, []);

  const onChangeDirection = useCallback((e) => {
    setDirectionId(String(e?.target?.value));
    setResult(null);
  }, []);

  const onChangeModes = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v)) setNModes(Math.max(1, Math.min(5, Math.round(v))));
  }, []);

  const onRun = useCallback(() => {
    setError(null);
    setResult(null);
    if (!activeBody) { setError('Pick a body first.'); return; }
    if (!material)  { setError('No material — open Material Properties (FEA) and Apply a preset for this body.'); return; }
    if (!(magnitudeN > 0)) { setError('Applied load magnitude must be > 0 N.'); return; }
    if (loadedFaceId === clampFaceId) {
      setError('Clamp face must differ from the loaded face.');
      return;
    }
    setRunning(true);
    try {
      const loadSpec = {
        magnitudeN,
        directionId,
        loadedFaceId,
        clampFaceId,
      };
      const r = runBucklingAnalysis(activeBody.handle, meshSize, material, loadSpec, nModes);
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
  }, [activeBody, material, meshSize, magnitudeN, directionId,
      loadedFaceId, clampFaceId, nModes]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-buckling-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Buckling Analysis (FEA · linearised eigen)</strong>
        <button onClick={onClose}
                data-testid="forge-buckling-close"
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
        Pick a body, an axial load, and the clamp + loaded AABB faces, then Run.
        Material (E + density) is read from
        <code style={{ fontFamily: 'var(--forge-mono)', marginLeft: 4 }}>
          window.__forgeMaterialProperties[handle]
        </code>.
        Result: λ such that critical load P_cr = λ × F_applied.
      </div>

      <label style={labelStyle}>
        Body:
        <select data-testid="forge-buckling-body"
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

      <div data-testid="forge-buckling-material"
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
            <span data-testid="forge-buckling-material-E">
              E = {material.E_GPa.toFixed(1)} GPa
            </span>
            {'  ·  '}
            <span data-testid="forge-buckling-material-density">
              ρ = {material.density_gcc.toFixed(2)} g/cc
            </span>
            {'  ·  '}
            <span data-testid="forge-buckling-material-nu">
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
               data-testid="forge-buckling-mesh-slider"
               value={meshSize}
               onChange={onChangeMesh}
               style={{ flex: 1 }} />
        <span data-testid="forge-buckling-mesh-value"
              style={{
                fontFamily: 'var(--forge-mono)',
                fontSize: 11,
                minWidth: 32, textAlign: 'right',
              }}>
          {meshSize.toFixed(1)}
        </span>
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 4 }}>
        <strong style={{ fontSize: 12 }}>Applied load</strong>
      </div>

      <label style={labelStyle}>
        Magnitude (N):
        <input type="number" min={1} step={100}
               data-testid="forge-buckling-magnitude"
               value={magnitudeN}
               onChange={onChangeMagnitude}
               style={{ ...inputStyle, width: 120 }} />
      </label>

      <label style={labelStyle}>
        Direction:
        <select data-testid="forge-buckling-direction"
                value={directionId}
                onChange={onChangeDirection}
                style={{ ...inputStyle, width: 100 }}>
          {DIRECTIONS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Loaded face:
        <select data-testid="forge-buckling-loaded-face"
                value={loadedFaceId}
                onChange={onChangeLoadedFace}
                style={{ ...inputStyle, width: 'auto' }}>
          {FACE_LABELS.map((lbl, i) => (
            <option key={i} value={i}>{lbl}</option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Clamp face:
        <select data-testid="forge-buckling-clamp-face"
                value={clampFaceId}
                onChange={onChangeClampFace}
                style={{ ...inputStyle, width: 'auto' }}>
          {FACE_LABELS.map((lbl, i) => (
            <option key={i} value={i}>{lbl}</option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Number of modes (1-5):
        <input type="number"
               min={1} max={5} step={1}
               data-testid="forge-buckling-nmodes"
               value={nModes}
               onChange={onChangeModes}
               style={{ ...inputStyle, width: 64 }} />
      </label>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onRun}
                data-testid="forge-buckling-run"
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
          {running ? 'Solving…' : 'Run Buckling'}
        </button>
        <span data-testid="forge-buckling-status"
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
        <div data-testid="forge-buckling-mesh-info"
             style={{
               color: 'var(--forge-ink-mute)',
               fontFamily: 'var(--forge-mono)',
               fontSize: 10,
             }}>
          Mesh: {result.meshInfo.nodeCount} nodes · {result.meshInfo.elemCount} elements · size {result.meshInfo.sizeMm} mm
          {' · '}
          Load: {result.loadInfo.loadedNodes} loaded-face nodes · {result.loadInfo.clampNodes} clamp-face nodes
        </div>
      )}

      {result && Number.isFinite(result.lambda1) && (
        <section data-testid="forge-buckling-stats"
                 style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
              Buckling factor λ₁
            </span>
            <strong data-testid="forge-buckling-lambda1" style={{ fontSize: 14 }}>
              {result.lambda1.toExponential(3)}
            </strong>
          </div>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
              Applied load F
            </span>
            <strong data-testid="forge-buckling-f-applied" style={{ fontSize: 14 }}>
              {result.F_applied.toExponential(3)} N
            </strong>
          </div>
          <div style={statBoxStyle}>
            <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
              Critical load P_cr
            </span>
            <strong data-testid="forge-buckling-p-cr" style={{ fontSize: 14 }}>
              {result.P_cr.toExponential(3)} N
            </strong>
          </div>
        </section>
      )}

      {result && result.modes.length > 0 && (
        <table data-testid="forge-buckling-modes-table" style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Mode</th>
              <th style={thStyle}>λ</th>
              <th style={thStyle}>P_cr = λ × F (N)</th>
            </tr>
          </thead>
          <tbody>
            {result.modes.map((m) => (
              <tr key={m.rank}
                  data-testid={`forge-buckling-row-${m.rank}`}
                  data-mode={m.rank}
                  data-lambda={m.lambda}>
                <td style={tdStyle}>{m.rank}</td>
                <td style={tdStyle}
                    data-testid={`forge-buckling-lambda-${m.rank}`}>
                  {Number.isFinite(m.lambda) ? m.lambda.toExponential(3) : '—'}
                </td>
                <td style={tdStyle}
                    data-testid={`forge-buckling-pcr-${m.rank}`}>
                  {Number.isFinite(m.P_cr_i) ? m.P_cr_i.toExponential(3) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && (
        <div data-testid="forge-buckling-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — wires the menu action + imperative open/close hook.

export function BucklingAnalysisHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBucklingAnalysis  = () => setOpen(true);
    window.__forgeCloseBucklingAnalysis = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bucklingAnalysis' || id === 'workbench.bucklingAnalysis') {
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
    <BucklingAnalysisPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BucklingAnalysisPanel;
