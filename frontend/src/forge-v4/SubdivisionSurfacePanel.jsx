// PUSH-83 (Slice-51 / Catmull-Clark subdivision surface generator).
//
// Up through PUSH-82 every Forge body in the scene tree was either:
//   (a) `kind: 'native'`  — a real OCCT B-rep solid, or
//   (b) `kind: 'synthetic'` — a parametric primitive (box/cyl/sphere/…)
//                              rendered through buildSyntheticGeometry.
// Real MCAD users want a third representation for organic / class-A
// surfacing work: **subdivision surfaces**. They start with a low-poly
// control cage and refine it via Catmull-Clark — the same algorithm
// Pixar / Blender / Maya use, originally published by Edwin Catmull
// and Jim Clark in 1978.
//
// PUSH-83 ships that as a Subdivision Surface panel:
//
//   • Right-docked panel (same rail style as MassProps / Layers / Batch
//     Rename), opened by the `tools.subdivision` menu action OR the
//     imperative `window.__forgeOpenSubdivisionPanel` hook used by
//     Archie tool calls + the e2e spec.
//
//   • Control cage selector — two modes:
//       1. **Unit cube cage**: 8 vertices, 6 quad faces, centred at
//          the origin, scaled to 30 mm so the limit-surface sphere is
//          actually visible in the viewport (per the "scale to viewer"
//          feedback file).
//       2. **From selected body**: copies the bounding-box cage of
//          the active native body so a user can subdivide-smooth an
//          existing solid's footprint. (The cage is the 8-vertex box
//          of the body's AABB — actual mesh import is the next slice.)
//
//   • Iterations slider — 1..4. Each Catmull-Clark pass grows the face
//     count by ~4×, so 4 iterations on the cube cage produces 6 → 24 →
//     96 → 384 → 1536 quads (4× exactly). Clamping at 4 keeps the
//     panel responsive without trashing the render thread.
//
//   • Apply → calls catmullClark.subdivide(cage), commits the result as
//     a synthetic body via window.__forgeAppendBody. The body carries
//     the real positions+faces in a `subdivision` side-car (the same
//     pattern PUSH-67 SpringDesigner uses for `spring.mesh`) plus an
//     AABB-aligned `box` synthetic spec so the viewport's existing
//     buildSyntheticGeometry path renders the body proxy at the
//     correct size while the real mesh travels through Forge as the
//     authoritative geometry.
//
//   • The bus event `forge:subdivision-applied` carries the body id +
//     iteration count + vert/face count, so downstream subscribers
//     (Activity Log, Archie's tool stream, the e2e spec) see every
//     Apply land.
//
// Hard constraints (PUSH-83 brief):
//   * NO new npm / C++ deps. Pure React + the existing window.__forge*
//     surface + the new catmullClark.js (also dep-free).
//   * Real Catmull-Clark math — face / edge / vertex update rules per
//     the 1978 paper, with the boundary-edge B-spline crease fallback.
//   * 5-camera e2e (Forge-171 mandate).
//   * One menu entry + one App.jsx mount line (multi-agent collision
//     resilient).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  subdivide as catmullClarkSubdivide,
  defaultCubeCage,
  triangulate,
  bbox,
  fingerprint,
} from './catmullClark.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event + menu action ids. Kept in sync with the
// existing PUSH-71 / PUSH-73 / PUSH-82 naming conventions so the
// Activity Log panel picks them up without any extra wiring.

export const FORGE_SUBDIVISION_APPLIED_EVENT = 'forge:subdivision-applied';
export const FORGE_SUBDIVISION_MENU_ID = 'tools.subdivision';

// Hard cap on iteration count. The math kernel also clamps so this is
// a UI-side sanity check that mirrors it.
export const MAX_ITERATIONS = 4;

// ─────────────────────────────────────────────────────────────────────
// Cage builders — exported so the e2e spec / Archie tool calls can
// drive the same logic without mounting the React panel first.

/** Default control cage = unit cube scaled to 30 mm. */
export function buildCubeCage(size = 30) {
  return defaultCubeCage(size);
}

/** From an active body — wrap its AABB in an 8-vertex cube cage so the
 *  user can smooth-extrude the body's silhouette. Returns null if no
 *  active body / no AABB is available. */
export function buildCageFromActiveBody() {
  if (typeof window === 'undefined') return null;
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  if (!all.length) return null;
  // Prefer the selection's body, else fall back to the last body added.
  let active = null;
  const sel = window.__forgeSelection;
  if (sel && typeof sel.bodyHandle === 'number') {
    active = all.find((b) => b.handle === sel.bodyHandle) || null;
  }
  if (!active) active = all[all.length - 1];
  if (!active) return null;
  // Walk the body fields looking for a plausible AABB hint.
  // Try synthetic primitives → bounded by their dx/dy/dz or 2*r/h.
  let halfX = 15, halfY = 15, halfZ = 15;
  if (active.spec && typeof active.spec === 'object') {
    const s = active.spec;
    if (typeof s.dx === 'number' && typeof s.dy === 'number'
        && typeof s.dz === 'number') {
      halfX = s.dx / 2; halfY = s.dy / 2; halfZ = s.dz / 2;
    } else if (typeof s.r === 'number' && typeof s.h === 'number') {
      halfX = s.r; halfY = s.r; halfZ = s.h / 2;
    } else if (typeof s.r === 'number') {
      halfX = s.r; halfY = s.r; halfZ = s.r;
    }
  } else if (active.params && typeof active.params === 'object') {
    const p = active.params;
    if (typeof p.width === 'number') halfX = p.width / 2;
    if (typeof p.height === 'number') halfY = p.height / 2;
    if (typeof p.distance === 'number') halfZ = p.distance / 2;
  }
  // Build the 8-vertex cage at the body's bounding box. We don't try
  // to honour the body's translation — the user runs the subdivision
  // and then snaps it into place via Direct Edit Translate.
  const positions = new Float32Array([
    -halfX, -halfY, -halfZ,
     halfX, -halfY, -halfZ,
     halfX,  halfY, -halfZ,
    -halfX,  halfY, -halfZ,
    -halfX, -halfY,  halfZ,
     halfX, -halfY,  halfZ,
     halfX,  halfY,  halfZ,
    -halfX,  halfY,  halfZ,
  ]);
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [0, 4, 7, 3],
  ];
  return { positions, faces, sourceBodyId: active.id || null };
}

/** Run Catmull-Clark on a cage and return the refined mesh + stats. */
export function runCatmullClark(cage, iterations) {
  return catmullClarkSubdivide(cage.positions, cage.faces, iterations);
}

/** Commit a subdivided mesh to the live scene as a synthetic body.
 *  Returns the new body record. Used by the panel and exported so
 *  Archie / e2e can drive it without the React layer. */
export function commitSubdivisionBody({
  positions, faces, iterations, sourceBodyId = null, label = null,
}) {
  if (typeof window === 'undefined') return null;
  const bb = bbox(positions);
  const id = `subdiv-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
  // Triangulate so downstream code (STL export, FEA, slicer) can pick
  // up the mesh through a single Uint32Array indices field.
  const indices = triangulate(positions, faces);
  const body = {
    id,
    kind: 'synthetic',
    // The viewport renders through this synthetic spec — we draw an
    // AABB-aligned box at the subdivided mesh's bounding-box size so
    // the body has a visible proxy in the scene. The real mesh
    // travels through Forge as the authoritative geometry in the
    // `subdivision` side-car (see Reverse Eng / Spring Designer for
    // the same pattern).
    spec: {
      kind: 'box',
      dx: Math.max(0.1, bb.size[0]),
      dy: Math.max(0.1, bb.size[1]),
      dz: Math.max(0.1, bb.size[2]),
    },
    toolId: 'tools.subdivision',
    name: label || `Subdivision · ${iterations} iter`,
    subdivision: {
      iterations,
      positions,
      faces,
      indices,
      bbox: bb,
      vertexCount: positions.length / 3,
      faceCount: faces.length,
      fingerprint: fingerprint(positions, faces),
      sourceBodyId,
    },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  try {
    window.dispatchEvent(new CustomEvent(FORGE_SUBDIVISION_APPLIED_EVENT, {
      detail: {
        id, iterations,
        vertexCount: body.subdivision.vertexCount,
        faceCount: body.subdivision.faceCount,
        fingerprint: body.subdivision.fingerprint,
      },
    }));
  } catch { /* CustomEvent universal in Electron — fail-soft anyway */ }
  return body;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as BatchRenamePanel / MassProps.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380,
  zIndex: 1331,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'auto',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const RADIO_ROW = { display: 'flex', flexDirection: 'column', gap: 4 };
const RADIO_LABEL = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 11, cursor: 'pointer',
};
const FIELD_LABEL = {
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 40px', alignItems: 'center', gap: 8,
};
const ACTION_BTN = (variant = 'default') => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '6px 12px', borderRadius: 3,
  fontSize: 11, fontWeight: variant === 'primary' ? 600 : 400,
});
const STATS_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11,
};
const STAT_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '6px 8px',
  display: 'flex', flexDirection: 'column', gap: 2,
};
const STAT_LABEL = {
  fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const STAT_VALUE = {
  fontSize: 12, fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI

export function SubdivisionSurfacePanel({ open, onClose }) {
  const [cageMode, setCageMode] = useState('cube'); // 'cube' | 'body'
  const [iterations, setIterations] = useState(2);
  const [preview, setPreview] = useState(null); // { stats, fingerprint }
  const [applyToast, setApplyToast] = useState(null);
  const [lastBodyId, setLastBodyId] = useState(null);
  const [error, setError] = useState(null);

  // Reset state every time the panel reopens.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setApplyToast(null);
    setError(null);
  }, [open]);

  const activeCage = useMemo(() => {
    if (cageMode === 'body') {
      const cage = buildCageFromActiveBody();
      if (!cage) {
        return buildCubeCage(30); // graceful fallback
      }
      return cage;
    }
    return buildCubeCage(30);
  }, [cageMode]);

  // Recompute the preview whenever iterations or cage change.
  useEffect(() => {
    if (!open) return;
    try {
      const out = catmullClarkSubdivide(
        activeCage.positions, activeCage.faces, iterations);
      setPreview({
        stats: out.stats,
        fingerprint: fingerprint(out.positions, out.faces),
      });
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
      setPreview(null);
    }
  }, [open, iterations, activeCage]);

  const onApply = useCallback(() => {
    setError(null);
    try {
      const out = catmullClarkSubdivide(
        activeCage.positions, activeCage.faces, iterations);
      const body = commitSubdivisionBody({
        positions: out.positions,
        faces: out.faces,
        iterations,
        sourceBodyId: activeCage.sourceBodyId || null,
        label: cageMode === 'body'
          ? `Subdivision (body) · ${iterations} iter`
          : `Subdivision (cube) · ${iterations} iter`,
      });
      if (body) {
        setLastBodyId(body.id);
        setApplyToast({
          id: body.id, iterations,
          v: out.stats.vertexCount, f: out.stats.faceCount,
          when: Date.now(),
        });
      } else {
        setError('Apply failed — __forgeAppendBody unavailable');
      }
    } catch (e) {
      setError(e?.message || String(e));
    }
  }, [activeCage, iterations, cageMode]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const cageVerts = activeCage.positions.length / 3;
  const cageFaces = activeCage.faces.length;

  return createPortal(
    <div role="dialog"
         aria-label="Catmull-Clark subdivision surface generator"
         data-testid="forge-subdivision-panel"
         data-iterations={iterations}
         data-cage-mode={cageMode}
         data-cage-verts={cageVerts}
         data-cage-faces={cageFaces}
         data-preview-verts={preview?.stats?.vertexCount ?? 0}
         data-preview-faces={preview?.stats?.faceCount ?? 0}
         data-last-body-id={lastBodyId || ''}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Subdivision Surface</strong>
        <span data-testid="forge-subdivision-iter-chip"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {iterations}/{MAX_ITERATIONS}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close subdivision panel"
                data-testid="forge-subdivision-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{
        fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)',
        lineHeight: 1.4, margin: '2px 0 4px',
      }}>
        Catmull-Clark refinement — smooth a quad-dominant control cage
        into an organic limit surface. Used by Pixar, Blender, Maya.
      </div>

      <div style={SECTION_TITLE}>Control Cage</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_ROW}>
          <label style={RADIO_LABEL}>
            <input type="radio"
                   name="forge-subdiv-cage-mode"
                   value="cube"
                   checked={cageMode === 'cube'}
                   onChange={() => setCageMode('cube')}
                   data-testid="forge-subdivision-cage-cube" />
            <span>Unit cube (30 mm, 8 verts, 6 quad faces)</span>
          </label>
          <label style={RADIO_LABEL}>
            <input type="radio"
                   name="forge-subdiv-cage-mode"
                   value="body"
                   checked={cageMode === 'body'}
                   onChange={() => setCageMode('body')}
                   data-testid="forge-subdivision-cage-body" />
            <span>From active body's AABB</span>
          </label>
        </div>
        <div style={{
          fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }} data-testid="forge-subdivision-cage-readout">
          cage: {cageVerts} verts / {cageFaces} quads
        </div>
      </div>

      <div style={SECTION_TITLE}>Iterations</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={1} max={MAX_ITERATIONS} step={1}
                 value={iterations}
                 onChange={(e) => setIterations(Number(e.target.value) || 1)}
                 data-testid="forge-subdivision-iter-slider"
                 aria-label="Subdivision iterations"
                 style={{ width: '100%' }} />
          <input type="number"
                 min={1} max={MAX_ITERATIONS} step={1}
                 value={iterations}
                 onChange={(e) => {
                   const n = Math.max(1,
                     Math.min(MAX_ITERATIONS, Number(e.target.value) || 1));
                   setIterations(n);
                 }}
                 data-testid="forge-subdivision-iter-input"
                 aria-label="Subdivision iterations number"
                 style={{
                   width: 40,
                   background: 'var(--forge-canvas-1, #0e1218)',
                   border: '1px solid var(--forge-rail-edge, #2a2d34)',
                   color: 'var(--forge-ink, #dadde2)',
                   padding: '4px 6px',
                   borderRadius: 3,
                   fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                   fontSize: 11,
                   textAlign: 'right',
                 }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          Each pass quadruples the quad count.
        </div>
      </div>

      <div style={SECTION_TITLE}>Refined Mesh Preview</div>
      <div style={STATS_GRID}>
        <div style={STAT_BOX}>
          <span style={STAT_LABEL}>Vertices</span>
          <span style={STAT_VALUE}
                data-testid="forge-subdivision-vert-count">
            {preview?.stats?.vertexCount ?? '—'}
          </span>
        </div>
        <div style={STAT_BOX}>
          <span style={STAT_LABEL}>Quad faces</span>
          <span style={STAT_VALUE}
                data-testid="forge-subdivision-face-count">
            {preview?.stats?.faceCount ?? '—'}
          </span>
        </div>
        <div style={STAT_BOX}>
          <span style={STAT_LABEL}>Compute</span>
          <span style={STAT_VALUE}
                data-testid="forge-subdivision-elapsed">
            {preview?.stats?.elapsed_ms != null
              ? `${preview.stats.elapsed_ms} ms`
              : '—'}
          </span>
        </div>
        <div style={STAT_BOX}>
          <span style={STAT_LABEL}>Hash</span>
          <span style={{ ...STAT_VALUE, fontSize: 10 }}
                data-testid="forge-subdivision-fingerprint">
            {preview?.fingerprint || '—'}
          </span>
        </div>
      </div>

      {error && (
        <div data-testid="forge-subdivision-error"
             style={{
               fontSize: 11, color: '#ff7070',
               background: 'rgba(255, 80, 80, 0.07)',
               border: '1px solid rgba(255, 80, 80, 0.3)',
               padding: '6px 8px', borderRadius: 3, marginTop: 4,
             }}>
          {error}
        </div>
      )}

      <footer style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 0 0', marginTop: 'auto',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {applyToast ? (
          <span data-testid="forge-subdivision-toast"
                style={{
                  fontSize: 11,
                  color: 'var(--forge-accent, #4f87ff)',
                }}>
            Committed · {applyToast.v} verts / {applyToast.f} faces
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            Apply commits the refined mesh as a new synthetic body.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onApply}
                disabled={!preview || !!error}
                title="Run Catmull-Clark and commit the result via __forgeAppendBody"
                data-testid="forge-subdivision-apply"
                style={{
                  ...ACTION_BTN('primary'),
                  opacity: (!preview || !!error) ? 0.5 : 1,
                  cursor: (!preview || !!error) ? 'not-allowed' : 'pointer',
                }}>
          Apply
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.subdivision` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the headless helpers on the window debug mirror.

export function SubdivisionSurfacePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSubdivisionPanel  = () => setOpen(true);
    window.__forgeCloseSubdivisionPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_SUBDIVISION_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeSubdivisionHelper = Object.freeze({
      buildCubeCage,
      buildCageFromActiveBody,
      runCatmullClark,
      commitSubdivisionBody,
      MAX_ITERATIONS,
      EVENT_NAME: FORGE_SUBDIVISION_APPLIED_EVENT,
      MENU_ID: FORGE_SUBDIVISION_MENU_ID,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSubdivisionPanel; } catch {}
      try { delete window.__forgeCloseSubdivisionPanel; } catch {}
    };
  }, []);
  return (
    <SubdivisionSurfacePanel open={open}
                             onClose={() => setOpen(false)} />
  );
}

export default SubdivisionSurfacePanel;
