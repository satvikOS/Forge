// PUSH-173 (Slice 129) — Mass moment of inertia tensor panel.
//
// PUSH-58 shipped the basic Mass Properties panel (volume + area + COM +
// density × volume → mass). That's enough for procurement BOM rollup but
// it's NOT enough for dynamics: every rigid-body equation of motion needs
// the full 3×3 inertia tensor — diagonal moments (Ixx, Iyy, Izz), products
// of inertia (Ixy, Iyz, Ixz), and the principal axes for the body frame.
//
// What this panel does:
//
//   * Picks the active native body (selection-aware, falls back to the
//     last native body in window.__forgeBodies, same pattern as PUSH-58).
//   * Reads the material assignment via PUSH-61's bodyMaterials helper.
//     User can override the material via the dropdown for what-if studies.
//   * On "Compute", pulls the kernel tessellation via window.forge.tessellate
//     and runs computeInertiaFromMesh() — pure-JS divergence-theorem /
//     tetrahedron-sum integration (see inertiaMath.js). The kernel ships
//     the triangles via forge.tessellate (the same API the AP242 export
//     and 3-printable STL use), so this stays a pure post-processing UI.
//   * Renders:
//       - Volume + mass cross-check (matches MassPropsPanel reading)
//       - 3×3 inertia tensor matrix (g·mm² + kg·m² toggle)
//       - Principal moments (sorted eigenvalues)
//       - Principal axes (matching eigenvectors)
//   * Exposes window.__forgeInertiaTensorHelper for headless callers /
//     the e2e spec / Archie to drive the panel without click-puppetry.
//
// Reachable via the tools.inertiaTensor menu action + Cmd+K palette.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import computeInertiaFromMesh, { INERTIA_UNITS } from './inertiaMath.js';
import {
  getBodyMaterial,
  setBodyMaterial,
  FORGE_BODY_MATERIALS_EVENT,
} from './bodyMaterials.js';

// Same density table as MassPropsPanel (PUSH-58). Re-imported here as a
// constant rather than pulled from MassPropsPanel because we don't want
// a circular import — both modules are siblings.
const DENSITY_G_CC = Object.freeze({
  steel:     7.85,
  aluminum:  2.70,
  plastic:   1.05,
  titanium:  4.50,
  brass:     8.50,
});
const MATERIAL_LIST = Object.freeze(['steel', 'aluminum', 'plastic', 'titanium', 'brass']);

// Tessellation defaults — same as AP242 export so the inertia integral
// matches the geometry the rest of Forge thinks it has.
const DEFAULT_LINEAR_DEFL  = 0.1;
const DEFAULT_ANGULAR_DEFL = 0.3;

// ─────────────────────────────────────────────────────────────────────
// Active body resolver — same pattern as MassPropsPanel.

function activeBody() {
  if (typeof window === 'undefined') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const native = bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  return native[native.length - 1];
}

// ─────────────────────────────────────────────────────────────────────
// Kernel tessellation helper — surfaces a real error if the kernel hook
// is missing so Archie or the e2e gets a usable diagnostic.

function tessellateBody(handle) {
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (!forge || typeof forge.tessellate !== 'function') {
    throw new Error('forge.tessellate unavailable — kernel build missing the tessellate hook');
  }
  const mesh = forge.tessellate(handle, DEFAULT_LINEAR_DEFL, DEFAULT_ANGULAR_DEFL);
  if (!mesh || !mesh.positions || mesh.positions.length === 0) {
    throw new Error(`forge.tessellate(${handle}) returned no triangles`);
  }
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────
// Helper API exposed on window so the e2e + Archie can drive headless.

function installHelper() {
  if (typeof window === 'undefined') return;
  window.__forgeInertiaTensorHelper = Object.freeze({
    computeInertiaFromMesh,
    DENSITY_G_CC,
    MATERIAL_LIST,
    tessellateBody,
    activeBody,
    // One-shot end-to-end driver — pulls the active body, runs the
    // tessellation + inertia integration and returns the full result.
    computeForActiveBody(materialKey = null) {
      const b = activeBody();
      if (!b) throw new Error('no native body in scene');
      const density = DENSITY_G_CC[materialKey || getBodyMaterial(b)] ?? DENSITY_G_CC.steel;
      const mesh = tessellateBody(b.handle);
      const result = computeInertiaFromMesh(mesh.positions, mesh.indices, density);
      window.__forgeLastInertiaTensor = { body: b, density, result };
      return { body: b, density, result };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same vocabulary as MassPropsPanel.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 420, zIndex: 1331,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const labelMute = { color: 'var(--forge-ink-mute)' };
const mono = { fontFamily: 'var(--forge-mono, ui-monospace, monospace)' };

const matrixCell = {
  padding: '4px 8px',
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  textAlign: 'right',
  minWidth: 96,
};

const button = {
  padding: '6px 12px',
  background: 'var(--forge-accent, #58a6ff)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-canvas)',
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: 4,
};

const buttonAlt = {
  padding: '4px 8px',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  borderRadius: 4,
};

// ─────────────────────────────────────────────────────────────────────
// Number formatting — keep 6 sig figs but cap at a useful precision.

function fmt(n, digits = 4) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 1e-3 || abs >= 1e6) return n.toExponential(digits);
  return n.toFixed(digits);
}

// ─────────────────────────────────────────────────────────────────────
// Component.

export function InertiaTensorPanel({ open, onClose }) {
  const [body, setBody] = useState(() => activeBody());
  const [material, setMaterial] = useState(() => getBodyMaterial(activeBody()));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [useSi, setUseSi] = useState(false);

  // Keep the active body in sync with selection / scene mutations.
  useEffect(() => {
    if (!open) return undefined;
    const next = activeBody();
    setBody(next);
    setMaterial(getBodyMaterial(next));
    const onPick = () => {
      const n = activeBody();
      setBody(n);
      setMaterial(getBodyMaterial(n));
    };
    window.addEventListener('forge:selection-changed', onPick);
    return () => window.removeEventListener('forge:selection-changed', onPick);
  }, [open]);

  // PUSH-61 — if another surface writes a material for our active body
  // (BOM / MassProps / MaterialsBrowser), re-sync the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const onApplied = () => {
      const b = activeBody();
      setMaterial(getBodyMaterial(b));
    };
    window.addEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
    return () => window.removeEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
  }, [open]);

  const onMaterialChange = useCallback((e) => {
    const next = e?.target?.value;
    if (typeof next !== 'string' || next.length === 0) return;
    setMaterial(next);
    setBodyMaterial(body, next);
  }, [body]);

  const onCompute = useCallback(() => {
    if (!body || typeof body.handle !== 'number') {
      setError('No native body in scene — add a body first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const mesh = tessellateBody(body.handle);
      const density = DENSITY_G_CC[material] ?? DENSITY_G_CC.steel;
      const r = computeInertiaFromMesh(mesh.positions, mesh.indices, density);
      setResult(r);
      // Publish the latest result for headless consumers / the e2e.
      if (typeof window !== 'undefined') {
        window.__forgeLastInertiaTensor = { body, density, result: r };
        window.dispatchEvent(new CustomEvent('forge:inertia-tensor-computed', {
          detail: { bodyId: body.id, handle: body.handle, density, result: r },
        }));
      }
    } catch (ex) {
      setError(String(ex?.message || ex));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [body, material]);

  const tensor = useMemo(() => {
    if (!result) return null;
    return useSi ? result.tensorSi : result.tensor;
  }, [result, useSi]);

  const principal = useMemo(() => {
    if (!result) return null;
    return useSi ? result.principalMomentsSi : result.principalMoments;
  }, [result, useSi]);

  if (!open) return null;

  const density = DENSITY_G_CC[material] ?? DENSITY_G_CC.steel;
  const unitLabel = useSi ? INERTIA_UNITS.TENSOR_SI : INERTIA_UNITS.TENSOR;

  return (
    <div style={panelStyle} data-testid="forge-inertia-tensor-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Inertia Tensor (PUSH-173)</strong>
        <button onClick={onClose}
                data-testid="forge-inertia-tensor-close"
                style={buttonAlt}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Active body: <strong data-testid="forge-inertia-tensor-body">
          {body ? (body.name || body.id || `handle ${body.handle}`) : 'None — add a body first'}
        </strong>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Material:
        <select data-testid="forge-inertia-tensor-material"
                value={material}
                onChange={onMaterialChange}
                style={{ flex: 1, background: 'var(--forge-canvas)',
                         color: 'var(--forge-ink)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 4, padding: '4px 6px' }}>
          {MATERIAL_LIST.map((m) => (
            <option key={m} value={m}>{m} ({DENSITY_G_CC[m]} g/cc)</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Density (g/cc):
        <input type="number" step="0.01" min="0.01"
               data-testid="forge-inertia-tensor-density"
               value={density}
               readOnly
               style={{ flex: 1, background: 'var(--forge-canvas)',
                        color: 'var(--forge-ink)',
                        border: '1px solid var(--forge-rail-edge)',
                        borderRadius: 4, padding: '4px 6px',
                        fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }} />
      </label>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={onCompute}
                data-testid="forge-inertia-tensor-compute"
                disabled={busy || !body}
                style={{ ...button, opacity: (busy || !body) ? 0.5 : 1 }}>
          {busy ? 'Computing…' : 'Compute'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <input type="checkbox"
                 data-testid="forge-inertia-tensor-si-toggle"
                 checked={useSi}
                 onChange={(e) => setUseSi(!!e.target.checked)} />
          <span style={labelMute}>SI (kg·m²)</span>
        </label>
      </div>

      {error && (
        <div data-testid="forge-inertia-tensor-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}

      {result && (
        <section data-testid="forge-inertia-tensor-results"
                 style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr',
                        columnGap: 8, rowGap: 4, ...mono, fontSize: 11 }}>
            <div style={labelMute}>Volume</div>
            <div data-testid="forge-inertia-tensor-volume">
              {fmt(result.volume, 3)} {INERTIA_UNITS.VOLUME}
            </div>
            <div style={labelMute}>Mass</div>
            <div data-testid="forge-inertia-tensor-mass">
              {fmt(result.mass, 3)} {INERTIA_UNITS.MASS}
              {' '}({fmt(result.mass / 1000, 6)} kg)
            </div>
            <div style={labelMute}>Centre of mass</div>
            <div data-testid="forge-inertia-tensor-com">
              ({fmt(result.centerOfMass[0], 3)},
               {' '}{fmt(result.centerOfMass[1], 3)},
               {' '}{fmt(result.centerOfMass[2], 3)}) {INERTIA_UNITS.COM}
            </div>
            <div style={labelMute}>Triangles</div>
            <div data-testid="forge-inertia-tensor-tris">{result.triangleCount}</div>
          </div>

          <div>
            <div style={{ marginBottom: 4, ...labelMute, fontWeight: 700 }}>
              Inertia Tensor ({unitLabel}, about centroid)
            </div>
            <div style={{ display: 'grid',
                          gridTemplateColumns: 'repeat(3, max-content)',
                          gap: 4 }}
                 data-testid="forge-inertia-tensor-matrix">
              {[0, 1, 2].map((i) => (
                [0, 1, 2].map((j) => (
                  <div key={`${i}-${j}`}
                       data-testid={`forge-inertia-tensor-cell-${i}${j}`}
                       data-row={i} data-col={j}
                       style={matrixCell}>
                    {fmt(tensor[i][j], 4)}
                  </div>
                ))
              ))}
            </div>
            <div style={{ fontSize: 10, ...labelMute, marginTop: 4 }}>
              Ixx={fmt(tensor[0][0])}  Iyy={fmt(tensor[1][1])}  Izz={fmt(tensor[2][2])}
              <br />
              Ixy={fmt(tensor[0][1])}  Iyz={fmt(tensor[1][2])}  Ixz={fmt(tensor[0][2])}
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 4, ...labelMute, fontWeight: 700 }}>
              Principal Moments ({unitLabel}, ascending)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}
                 data-testid="forge-inertia-tensor-principal-moments">
              {principal.map((p, i) => (
                <div key={i}
                     data-testid={`forge-inertia-tensor-principal-${i}`}
                     style={matrixCell}>
                  I{i + 1} = {fmt(p, 4)}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 4, ...labelMute, fontWeight: 700 }}>
              Principal Axes (unit eigenvectors)
            </div>
            <div style={{ display: 'grid',
                          gridTemplateColumns: '32px repeat(3, max-content)',
                          gap: 4, alignItems: 'center' }}
                 data-testid="forge-inertia-tensor-principal-axes">
              {result.principalAxes.map((axis, i) => (
                <React.Fragment key={i}>
                  <div style={{ ...labelMute, ...mono, textAlign: 'right' }}>
                    a{i + 1}=
                  </div>
                  {axis.map((c, j) => (
                    <div key={j}
                         data-testid={`forge-inertia-tensor-axis-${i}-${j}`}
                         style={matrixCell}>
                      {fmt(c, 4)}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>
      )}

      {!result && !error && (
        <div style={labelMute} data-testid="forge-inertia-tensor-empty">
          Pick a material then click <strong>Compute</strong> to integrate the inertia tensor from the tessellated mesh.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — mounts the panel into document.body and wires the global API.

export function InertiaTensorHost() {
  const [open, setOpen] = useState(false);
  const installedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!installedRef.current) {
      installHelper();
      installedRef.current = true;
    }
    window.__forgeOpenInertiaTensor  = () => setOpen(true);
    window.__forgeCloseInertiaTensor = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.inertiaTensor' || id === 'workbench.inertiaTensor') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <InertiaTensorPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default InertiaTensorPanel;
