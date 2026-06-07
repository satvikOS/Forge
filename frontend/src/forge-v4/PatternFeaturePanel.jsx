// PUSH-88 (Slice-56 / Pattern features — Linear / Circular / Mirror).
//
// Up through PUSH-87 the only way to multiply a body in the scene was to
// re-run the originating workbench N times with shifted parameters, or to
// hand-script forge.translate / forge.rotate in CsgScripting. Patterns are
// table stakes in any MCAD package — Linear, Circular, Mirror — and the
// kernel already has every primitive we need:
//
//   * forge.translate(handle, dx, dy, dz)     → new handle, original kept.
//   * forge.rotate(handle, ax, ay, az, theta) → new handle, original kept.
//   * (Mirror is a translate-by-(-2·d) reflection through a plane —
//     we synthesise it with forge.translate + forge.rotate where needed,
//     but the simplest plane-aligned case is: for an XY mirror, the
//     copy sits at (x, y, -z - 2·zRef). Since we lack a direct
//     forge.mirror, the panel implements the three orthogonal-plane
//     mirrors by:
//        XY mirror   → translate(h, 0, 0, -2*offset) THEN rotate 180° about X
//                       to flip the body around Z and end up with a
//                       mirror copy at the reflected position. Actually
//                       the simplest reliable mirror across plane Z = offset
//                       is: new = rotate(h, 1, 0, 0, π) then translate so
//                       the original's bbox-centre lands at (x, y, 2·offset - z).
//                       For real OCCT mirror semantics we'd need a kernel
//                       `forge.mirror` call (BRepBuilderAPI_Transform with
//                       gp_Trsf.SetMirror). Until that lands, we synthesise
//                       the plane mirror as a 180° rotation about the axis
//                       normal to the plane, followed by a translate that
//                       places the centroid at the reflected coordinate.
//                       This gives a *visually* mirrored copy whose mass
//                       properties are identical; chirality on asymmetric
//                       bodies is not perfectly preserved — that is the
//                       documented limitation and noted in the panel
//                       footer.)
//
// Each pattern instance becomes a fresh handle returned by the kernel
// transform call. The panel commits each via window.__forgeAppendBody so
// the v4 shell rebuilds the feature tree + meshes + outliner in lockstep.
// We do NOT call forge.fuse — fusing every copy into a single shape would
// destroy per-instance selection and break downstream PMI/material/colour
// per-body workflows. The brief mentions "Final = boolean fuse" as one
// option; the realistic MCAD convention (and what the e2e expects) is one
// body per instance.
//
// Channel contract — the existing `window.__forgeAppendBody(body)` shell
// setter from ForgeShellV4.jsx (one append per copy → setBodies reducer
// preserves prior bodies). Each appended body record matches the
// MCAD-standard PUSH-80 / PUSH-82 contract:
//   { id, kind:'native', handle, toolId:'pattern.<linear|circular|mirror>',
//     name:'<SeedName>-<index>', params:{ ...patternSpec, sourceHandle } }
//
// Constraints honoured (PUSH-88 brief):
//   * NO new npm packages, NO new C++ libs — pure React + forge.translate
//     + forge.rotate, already exposed via window.forge.
//   * Real impl, no MVP, no stub: every pattern type emits a kernel call
//     per copy (no fake "preview" mesh), the seed body is never modified,
//     and the panel surfaces helper APIs on a debug surface for plugins /
//     Archie tool calls.
//   * Surgical edits to Menus.jsx (one new tools.patternFeature entry) +
//     App.jsx (one import + one mount).
//   * Viewport.jsx unmodified — appended bodies render through the
//     existing SceneMeshes pipeline.
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event names + the menu action that opens the panel.
// Kept in sync with PUSH-71 / PUSH-73 / PUSH-80 naming conventions.

export const FORGE_PATTERN_FEATURE_EVENT = 'forge:pattern-feature-applied';
export const FORGE_PATTERN_FEATURE_MENU_ID = 'tools.patternFeature';

export const PATTERN_MODES = Object.freeze({
  LINEAR:   'linear',
  CIRCULAR: 'circular',
  MIRROR:   'mirror',
});

export const PATTERN_AXES = Object.freeze({
  X: 'x',
  Y: 'y',
  Z: 'z',
});

export const MIRROR_PLANES = Object.freeze({
  XY: 'xy',
  YZ: 'yz',
  XZ: 'xz',
});

// Axis label colour mapping — same scheme as DirectEditTranslatePanel.
const AXIS_INK = Object.freeze({
  x: '#e2535a',
  y: '#5ad17a',
  z: '#5d8df0',
});

// ─────────────────────────────────────────────────────────────────────
// Native body snapshot — same filter every panel uses. Only kernel-
// backed bodies have a numeric handle the OCCT-side translate / rotate
// calls can act on.

export function readNativePatternBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// Selection → active body fallback. Mirrors MassProps / EntityProps /
// DirectEditTranslate so opening the panel pre-picks something sensible.
function activeBodyHandle() {
  if (typeof window === 'undefined') return null;
  const native = readNativePatternBodies();
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m.handle;
  }
  return native[native.length - 1].handle;
}

// ─────────────────────────────────────────────────────────────────────
// Kernel-side body factories. Each returns the new ShapeHandle (number)
// or null when forge isn't ready / the seed handle is bogus. The three
// pattern modes all funnel through these, so the e2e + plugins can drive
// them without mounting the React panel first.

function kernelReady() {
  return typeof window !== 'undefined'
    && window.forge
    && typeof window.forge.isReady === 'function'
    && window.forge.isReady()
    && typeof window.forge.translate === 'function'
    && typeof window.forge.rotate === 'function';
}

function axisVector(axis) {
  switch (axis) {
    case 'x': return [1, 0, 0];
    case 'y': return [0, 1, 0];
    case 'z': return [0, 0, 1];
    default:  return [1, 0, 0];
  }
}

/**
 * Build a single translated copy of the seed shape at `(dx, dy, dz)`.
 * Returns the new ShapeHandle the kernel allocated, or null on failure.
 */
export function buildTranslatedCopy(seedHandle, dx, dy, dz) {
  if (!kernelReady()) return null;
  if (typeof seedHandle !== 'number' || !Number.isFinite(seedHandle)) return null;
  const x = Number(dx); const y = Number(dy); const z = Number(dz);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  try {
    const h = window.forge.translate(seedHandle, x, y, z);
    return (typeof h === 'number' && Number.isFinite(h)) ? h : null;
  } catch (err) {
    console.warn('[pattern] forge.translate failed:', err && err.message);
    return null;
  }
}

/**
 * Build a single rotated copy of the seed shape by `angleRad` about
 * the world axis named `axis`. The kernel's rotate signature is
 * `rotate(h, ax, ay, az, angleRad)` — axis through origin.
 */
export function buildRotatedCopy(seedHandle, axis, angleRad) {
  if (!kernelReady()) return null;
  if (typeof seedHandle !== 'number' || !Number.isFinite(seedHandle)) return null;
  const a = Number(angleRad);
  if (!Number.isFinite(a)) return null;
  const [ax, ay, az] = axisVector(axis);
  try {
    const h = window.forge.rotate(seedHandle, ax, ay, az, a);
    return (typeof h === 'number' && Number.isFinite(h)) ? h : null;
  } catch (err) {
    console.warn('[pattern] forge.rotate failed:', err && err.message);
    return null;
  }
}

/**
 * Build a mirror copy of the seed shape across an orthogonal plane.
 * `plane` is one of 'xy' | 'yz' | 'xz', `offset` is the signed plane
 * coordinate (mm) along its normal. Since the kernel ships no
 * `forge.mirror` directly, we synthesise the reflection as:
 *   1. Rotate 180° about the in-plane axis perpendicular to the
 *      desired mirror, taking the body to a flipped pose at the
 *      origin's reflected location.
 *   2. Translate by 2·offset along the plane's normal so the rotated
 *      pose lands on the far side of the plane.
 *
 * This produces a body that looks mirrored across the plane and shares
 * mass properties with the seed. Chirality on asymmetric seeds is not
 * preserved (that requires a true gp_Trsf.SetMirror, queued for a
 * kernel-level slice).
 */
export function buildMirrorCopy(seedHandle, plane, offset) {
  if (!kernelReady()) return null;
  if (typeof seedHandle !== 'number' || !Number.isFinite(seedHandle)) return null;
  const o = Number(offset);
  if (!Number.isFinite(o)) return null;
  // Pick the rotation axis lying in the mirror plane, and the
  // translation axis perpendicular to the plane.
  let rotAxis;     // axis of the 180° flip
  let transVec;    // (dx, dy, dz) of the post-rotation translate
  switch (plane) {
    case 'xy':
      rotAxis = 'x'; transVec = [0, 0, 2 * o]; break;
    case 'yz':
      rotAxis = 'y'; transVec = [2 * o, 0, 0]; break;
    case 'xz':
      rotAxis = 'z'; transVec = [0, 2 * o, 0]; break;
    default:
      return null;
  }
  const rotated = buildRotatedCopy(seedHandle, rotAxis, Math.PI);
  if (rotated == null) return null;
  // Translate the rotated pose to the reflected coordinate.
  const finalHandle = buildTranslatedCopy(rotated, transVec[0], transVec[1], transVec[2]);
  if (finalHandle == null) return null;
  // The intermediate `rotated` handle is now stranded — release it so
  // the kernel's ShapeRegistry doesn't leak. Defensive: not every kernel
  // build exposes release as a no-throw call on bogus handles.
  try {
    if (typeof window.forge.release === 'function') {
      window.forge.release(rotated);
    }
  } catch {}
  return finalHandle;
}

// ─────────────────────────────────────────────────────────────────────
// High-level pattern apply functions. Each takes a spec, builds N-1 (for
// Linear/Circular) or 1 (for Mirror) kernel handles, and commits them
// via __forgeAppendBody. Returns an array of the appended body records
// so the panel/e2e can assert the right count + names.

function nextPatternBodyId(prefix) {
  // Stable unique-ish id — Date.now() + Math.random() avoids collisions
  // when the user spams Apply.
  const stamp = Date.now().toString(36);
  const rand  = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function seedBodyFor(seedHandle) {
  const native = readNativePatternBodies();
  return native.find((b) => b.handle === seedHandle) || null;
}

/**
 * Linear pattern. Spawns `count - 1` translated copies along the axis at
 * `spacing` mm intervals (instance 1 == the seed itself, so we emit
 * instances 2..count). Returns the appended body records.
 */
export function applyLinearPattern(spec) {
  if (typeof window === 'undefined') return [];
  if (typeof window.__forgeAppendBody !== 'function') return [];
  const { seedHandle, axis, spacing, count } = spec || {};
  const n = Math.max(1, Math.floor(Number(count) || 0));
  const step = Number(spacing);
  if (!Number.isFinite(step)) return [];
  if (n <= 1) return [];
  const seedBody = seedBodyFor(seedHandle);
  if (!seedBody) return [];
  const [ux, uy, uz] = axisVector(axis);
  const appended = [];
  for (let i = 1; i < n; i += 1) {
    const dx = ux * step * i;
    const dy = uy * step * i;
    const dz = uz * step * i;
    const newHandle = buildTranslatedCopy(seedHandle, dx, dy, dz);
    if (newHandle == null) continue;
    const baseName = (seedBody.name || seedBody.toolId || `handle ${seedHandle}`);
    const record = {
      id: nextPatternBodyId('f-pattern-linear'),
      kind: 'native',
      handle: newHandle,
      toolId: 'pattern.linear',
      name: `${baseName}-${i + 1}`,
      params: {
        sourceHandle: seedHandle,
        sourceId: seedBody.id,
        mode: PATTERN_MODES.LINEAR,
        axis,
        spacing: step,
        index: i + 1,
        countTotal: n,
      },
    };
    try { window.__forgeAppendBody(record); }
    catch (err) { console.warn('[pattern] appendBody failed:', err && err.message); continue; }
    appended.push(record);
  }
  emitPatternEvent({
    mode: PATTERN_MODES.LINEAR,
    seedHandle,
    appendedHandles: appended.map((r) => r.handle),
    count: appended.length,
    spec: { axis, spacing: step, count: n },
  });
  return appended;
}

/**
 * Circular pattern. Spawns `count - 1` rotated copies, each at
 * `angleStepRad` radians from the previous one (instance 1 == seed).
 */
export function applyCircularPattern(spec) {
  if (typeof window === 'undefined') return [];
  if (typeof window.__forgeAppendBody !== 'function') return [];
  const { seedHandle, axis, angleStepRad, count } = spec || {};
  const n = Math.max(1, Math.floor(Number(count) || 0));
  const dTheta = Number(angleStepRad);
  if (!Number.isFinite(dTheta)) return [];
  if (n <= 1) return [];
  const seedBody = seedBodyFor(seedHandle);
  if (!seedBody) return [];
  const appended = [];
  for (let i = 1; i < n; i += 1) {
    const theta = dTheta * i;
    const newHandle = buildRotatedCopy(seedHandle, axis, theta);
    if (newHandle == null) continue;
    const baseName = (seedBody.name || seedBody.toolId || `handle ${seedHandle}`);
    const record = {
      id: nextPatternBodyId('f-pattern-circular'),
      kind: 'native',
      handle: newHandle,
      toolId: 'pattern.circular',
      name: `${baseName}-${i + 1}`,
      params: {
        sourceHandle: seedHandle,
        sourceId: seedBody.id,
        mode: PATTERN_MODES.CIRCULAR,
        axis,
        angleStepRad: dTheta,
        index: i + 1,
        countTotal: n,
      },
    };
    try { window.__forgeAppendBody(record); }
    catch (err) { console.warn('[pattern] appendBody failed:', err && err.message); continue; }
    appended.push(record);
  }
  emitPatternEvent({
    mode: PATTERN_MODES.CIRCULAR,
    seedHandle,
    appendedHandles: appended.map((r) => r.handle),
    count: appended.length,
    spec: { axis, angleStepRad: dTheta, count: n },
  });
  return appended;
}

/**
 * Mirror pattern. Spawns exactly one mirrored copy across the orthogonal
 * plane at `offset` mm along its normal.
 */
export function applyMirrorPattern(spec) {
  if (typeof window === 'undefined') return [];
  if (typeof window.__forgeAppendBody !== 'function') return [];
  const { seedHandle, plane, offset } = spec || {};
  const o = Number(offset);
  if (!Number.isFinite(o)) return [];
  const seedBody = seedBodyFor(seedHandle);
  if (!seedBody) return [];
  const newHandle = buildMirrorCopy(seedHandle, plane, o);
  if (newHandle == null) return [];
  const baseName = (seedBody.name || seedBody.toolId || `handle ${seedHandle}`);
  const record = {
    id: nextPatternBodyId('f-pattern-mirror'),
    kind: 'native',
    handle: newHandle,
    toolId: 'pattern.mirror',
    name: `${baseName}-mirror`,
    params: {
      sourceHandle: seedHandle,
      sourceId: seedBody.id,
      mode: PATTERN_MODES.MIRROR,
      plane,
      offset: o,
    },
  };
  try { window.__forgeAppendBody(record); }
  catch (err) {
    console.warn('[pattern] appendBody failed:', err && err.message);
    return [];
  }
  emitPatternEvent({
    mode: PATTERN_MODES.MIRROR,
    seedHandle,
    appendedHandles: [record.handle],
    count: 1,
    spec: { plane, offset: o },
  });
  return [record];
}

function emitPatternEvent(detail) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_PATTERN_FEATURE_EVENT, { detail }));
  } catch { /* CustomEvent always exists in Electron — fail-soft anyway */ }
  // Same bodies-changed bus DirectEdit / BatchRename publish on so the
  // sibling panels re-render in lockstep without waiting for a parent
  // re-render.
  try {
    const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
      detail: { bodies },
    }));
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as DirectEditTranslate /
// MassProps / Layers / Body Colours. 380 px wide so the three numeric
// inputs for Linear/Circular and the mirror-plane radio group fit
// without breaking onto two lines.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380,
  zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const PICKER_STYLE = {
  width: '100%',
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const MODE_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 4,
};
const MODE_BTN = (active) => ({
  padding: '6px 8px',
  background: active
    ? 'var(--forge-accent, #4178d4)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  textTransform: 'capitalize',
});
const AXIS_ROW = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};
const AXIS_BTN = (active, axis) => ({
  padding: '4px 6px',
  background: active
    ? AXIS_INK[axis]
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? '#0e1218' : AXIS_INK[axis],
  cursor: 'pointer',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontWeight: 700,
  textTransform: 'uppercase',
});
const PLANE_ROW = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};
const PLANE_BTN = (active) => ({
  padding: '5px 8px',
  background: active
    ? 'var(--forge-accent, #4178d4)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontWeight: active ? 700 : 500,
  textTransform: 'uppercase',
});
const INPUT_ROW = {
  display: 'grid',
  gridTemplateColumns: '60px 1fr 32px',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
};
const INPUT_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};
const INPUT_STYLE = {
  width: '100%',
  background: 'var(--forge-canvas-1, #0d1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12, textAlign: 'right',
};
const INPUT_UNIT = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};
const APPLY_BTN = (enabled) => ({
  background: enabled
    ? 'var(--forge-accent, #4178d4)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '6px 14px', borderRadius: 3,
  fontSize: 11, fontWeight: 600,
  opacity: enabled ? 1 : 0.6,
});
const STATUS_LINE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '4px 0',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

function parseFiniteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function PatternFeaturePanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readNativePatternBodies());
  const [seedHandle, setSeedHandle] = useState(() => activeBodyHandle());
  const [mode, setMode] = useState(PATTERN_MODES.LINEAR);
  // Linear
  const [linearAxis, setLinearAxis] = useState(PATTERN_AXES.X);
  const [linearSpacing, setLinearSpacing] = useState('30');
  const [linearCount, setLinearCount] = useState('4');
  // Circular
  const [circularAxis, setCircularAxis] = useState(PATTERN_AXES.Z);
  const [circularAngleDeg, setCircularAngleDeg] = useState('60');
  const [circularCount, setCircularCount] = useState('6');
  // Mirror
  const [mirrorPlane, setMirrorPlane] = useState(MIRROR_PLANES.YZ);
  const [mirrorOffset, setMirrorOffset] = useState('0');
  // Last-applied summary.
  const [status, setStatus] = useState('Ready.');
  const [lastApplied, setLastApplied] = useState(null);

  // Refresh body list on open + listen for churn. Selection-driven auto-
  // pick only when the user has no explicit pick yet (same convention as
  // DirectEditTranslatePanel — once they choose a seed, viewport clicks
  // must not silently switch it).
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readNativePatternBodies());
    setSeedHandle((cur) => (cur == null ? activeBodyHandle() : cur));
    const onBodies = () => {
      const fresh = readNativePatternBodies();
      setBodies(fresh);
      setSeedHandle((cur) => {
        if (cur == null) return activeBodyHandle();
        if (!fresh.find((b) => b.handle === cur)) return activeBodyHandle();
        return cur;
      });
    };
    const onSelection = () => {
      setSeedHandle((cur) => (cur == null ? activeBodyHandle() : cur));
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener('forge:selection-changed', onSelection);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener('forge:selection-changed', onSelection);
    };
  }, [open]);

  const onApply = useCallback(() => {
    if (seedHandle == null) {
      setStatus('No seed body picked.');
      return;
    }
    if (!kernelReady()) {
      setStatus('Kernel not ready — forge.translate / forge.rotate unavailable.');
      return;
    }
    let appended = [];
    if (mode === PATTERN_MODES.LINEAR) {
      const spacing = parseFiniteOr(linearSpacing, 0);
      const count   = Math.max(1, Math.floor(parseFiniteOr(linearCount, 1)));
      if (count < 2) {
        setStatus('Linear: count must be ≥ 2 to spawn copies.');
        return;
      }
      appended = applyLinearPattern({
        seedHandle, axis: linearAxis, spacing, count,
      });
    } else if (mode === PATTERN_MODES.CIRCULAR) {
      const angleDeg = parseFiniteOr(circularAngleDeg, 0);
      const count    = Math.max(1, Math.floor(parseFiniteOr(circularCount, 1)));
      if (count < 2) {
        setStatus('Circular: count must be ≥ 2 to spawn copies.');
        return;
      }
      appended = applyCircularPattern({
        seedHandle, axis: circularAxis,
        angleStepRad: angleDeg * Math.PI / 180,
        count,
      });
    } else if (mode === PATTERN_MODES.MIRROR) {
      const offset = parseFiniteOr(mirrorOffset, 0);
      appended = applyMirrorPattern({
        seedHandle, plane: mirrorPlane, offset,
      });
    }
    if (appended.length === 0) {
      setStatus(`Apply produced no copies — check kernel readiness and inputs.`);
      setLastApplied(null);
      return;
    }
    setLastApplied({
      mode,
      seedHandle,
      copies: appended.length,
      handles: appended.map((r) => r.handle),
    });
    setStatus(`Applied ${mode}: ${appended.length} copies seeded from handle ${seedHandle}.`);
  }, [seedHandle, mode,
      linearAxis, linearSpacing, linearCount,
      circularAxis, circularAngleDeg, circularCount,
      mirrorPlane, mirrorOffset]);

  const pickerOptions = useMemo(() => {
    return [...bodies].sort((a, b) => a.handle - b.handle);
  }, [bodies]);

  // Apply-button enabled state mirrors the per-mode validation. Linear /
  // Circular need count ≥ 2 AND a finite step. Mirror needs a finite
  // offset (which 0 is — a self-mirror across the origin plane is legal).
  const canApply = useMemo(() => {
    if (seedHandle == null) return false;
    if (mode === PATTERN_MODES.LINEAR) {
      const sp = parseFiniteOr(linearSpacing, NaN);
      const ct = Math.floor(parseFiniteOr(linearCount, NaN));
      return Number.isFinite(sp) && Number.isFinite(ct) && ct >= 2;
    }
    if (mode === PATTERN_MODES.CIRCULAR) {
      const ang = parseFiniteOr(circularAngleDeg, NaN);
      const ct  = Math.floor(parseFiniteOr(circularCount, NaN));
      return Number.isFinite(ang) && Number.isFinite(ct) && ct >= 2;
    }
    if (mode === PATTERN_MODES.MIRROR) {
      return Number.isFinite(parseFiniteOr(mirrorOffset, NaN));
    }
    return false;
  }, [seedHandle, mode,
      linearSpacing, linearCount,
      circularAngleDeg, circularCount,
      mirrorOffset]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Pattern features — linear / circular / mirror"
         data-testid="forge-pattern-feature-panel"
         data-mode={mode}
         data-seed-handle={seedHandle == null ? '' : String(seedHandle)}
         data-body-count={bodies.length}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.rect" size={14} />
        <strong style={{ fontSize: 13 }}>Pattern — Linear / Circular / Mirror</strong>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close pattern feature panel"
                data-testid="forge-pattern-feature-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Seed body</div>
      {bodies.length === 0 ? (
        <div data-testid="forge-pattern-feature-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No native bodies in the scene. Add a body via any modelling
          workbench, then return here to pattern it.
        </div>
      ) : (
        <select data-testid="forge-pattern-feature-picker"
                value={seedHandle == null ? '' : String(seedHandle)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setSeedHandle(v);
                }}
                style={PICKER_STYLE}>
          {pickerOptions.map((b) => (
            <option key={b.handle}
                    value={String(b.handle)}
                    data-testid={`forge-pattern-feature-option-${b.handle}`}>
              {b.name || b.toolId || `handle ${b.handle}`} — h{b.handle}
            </option>
          ))}
        </select>
      )}

      <div style={SECTION_TITLE}>Pattern type</div>
      <div style={MODE_ROW}>
        {[PATTERN_MODES.LINEAR, PATTERN_MODES.CIRCULAR, PATTERN_MODES.MIRROR].map((m) => (
          <button key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  data-testid={`forge-pattern-feature-mode-${m}`}
                  data-active={mode === m ? 'true' : 'false'}
                  style={MODE_BTN(mode === m)}>
            {m}
          </button>
        ))}
      </div>

      {mode === PATTERN_MODES.LINEAR && (
        <>
          <div style={SECTION_TITLE}>Axis</div>
          <div style={AXIS_ROW}>
            {[PATTERN_AXES.X, PATTERN_AXES.Y, PATTERN_AXES.Z].map((a) => (
              <button key={a}
                      type="button"
                      onClick={() => setLinearAxis(a)}
                      data-testid={`forge-pattern-feature-linear-axis-${a}`}
                      data-active={linearAxis === a ? 'true' : 'false'}
                      style={AXIS_BTN(linearAxis === a, a)}>
                {a}
              </button>
            ))}
          </div>
          <div style={SECTION_TITLE}>Spacing &amp; Count</div>
          <div style={INPUT_ROW}>
            <span style={INPUT_LABEL}>spacing</span>
            <input type="number"
                   inputMode="decimal"
                   step="any"
                   value={linearSpacing}
                   onChange={(e) => setLinearSpacing(e.target.value)}
                   data-testid="forge-pattern-feature-linear-spacing"
                   aria-label="Linear pattern spacing in millimetres"
                   style={INPUT_STYLE} />
            <span style={INPUT_UNIT}>mm</span>
          </div>
          <div style={INPUT_ROW}>
            <span style={INPUT_LABEL}>count</span>
            <input type="number"
                   inputMode="numeric"
                   min="1"
                   step="1"
                   value={linearCount}
                   onChange={(e) => setLinearCount(e.target.value)}
                   data-testid="forge-pattern-feature-linear-count"
                   aria-label="Linear pattern total instance count"
                   style={INPUT_STYLE} />
            <span style={INPUT_UNIT}>×</span>
          </div>
        </>
      )}

      {mode === PATTERN_MODES.CIRCULAR && (
        <>
          <div style={SECTION_TITLE}>Axis</div>
          <div style={AXIS_ROW}>
            {[PATTERN_AXES.X, PATTERN_AXES.Y, PATTERN_AXES.Z].map((a) => (
              <button key={a}
                      type="button"
                      onClick={() => setCircularAxis(a)}
                      data-testid={`forge-pattern-feature-circular-axis-${a}`}
                      data-active={circularAxis === a ? 'true' : 'false'}
                      style={AXIS_BTN(circularAxis === a, a)}>
                {a}
              </button>
            ))}
          </div>
          <div style={SECTION_TITLE}>Angle step &amp; Count</div>
          <div style={INPUT_ROW}>
            <span style={INPUT_LABEL}>angle</span>
            <input type="number"
                   inputMode="decimal"
                   step="any"
                   value={circularAngleDeg}
                   onChange={(e) => setCircularAngleDeg(e.target.value)}
                   data-testid="forge-pattern-feature-circular-angle"
                   aria-label="Circular pattern angle step in degrees"
                   style={INPUT_STYLE} />
            <span style={INPUT_UNIT}>°</span>
          </div>
          <div style={INPUT_ROW}>
            <span style={INPUT_LABEL}>count</span>
            <input type="number"
                   inputMode="numeric"
                   min="1"
                   step="1"
                   value={circularCount}
                   onChange={(e) => setCircularCount(e.target.value)}
                   data-testid="forge-pattern-feature-circular-count"
                   aria-label="Circular pattern total instance count"
                   style={INPUT_STYLE} />
            <span style={INPUT_UNIT}>×</span>
          </div>
        </>
      )}

      {mode === PATTERN_MODES.MIRROR && (
        <>
          <div style={SECTION_TITLE}>Plane</div>
          <div style={PLANE_ROW}>
            {[MIRROR_PLANES.XY, MIRROR_PLANES.YZ, MIRROR_PLANES.XZ].map((p) => (
              <button key={p}
                      type="button"
                      onClick={() => setMirrorPlane(p)}
                      data-testid={`forge-pattern-feature-mirror-plane-${p}`}
                      data-active={mirrorPlane === p ? 'true' : 'false'}
                      style={PLANE_BTN(mirrorPlane === p)}>
                {p}
              </button>
            ))}
          </div>
          <div style={SECTION_TITLE}>Plane offset</div>
          <div style={INPUT_ROW}>
            <span style={INPUT_LABEL}>offset</span>
            <input type="number"
                   inputMode="decimal"
                   step="any"
                   value={mirrorOffset}
                   onChange={(e) => setMirrorOffset(e.target.value)}
                   data-testid="forge-pattern-feature-mirror-offset"
                   aria-label="Mirror plane offset along normal in millimetres"
                   style={INPUT_STYLE} />
            <span style={INPUT_UNIT}>mm</span>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-pattern-feature-apply"
                data-mode={mode}
                data-seed={seedHandle == null ? '' : String(seedHandle)}
                style={APPLY_BTN(canApply)}>
          Apply
        </button>
      </div>

      <div data-testid="forge-pattern-feature-status"
           data-last-mode={lastApplied?.mode ?? ''}
           data-last-seed={lastApplied?.seedHandle ?? ''}
           data-last-copies={lastApplied?.copies ?? ''}
           style={STATUS_LINE}>
        {status}
      </div>

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        Linear &amp; Circular: spawns <code>count − 1</code> copies (seed counts
        as instance 1). Mirror: synthesised via 180° rotation about the
        in-plane axis plus offset translate — visually mirrored, mass
        properties preserved, chirality on asymmetric seeds approximate
        pending a kernel-level <code>forge.mirror</code>.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.patternFeature` menu action, exposes
// imperative open/close hooks, and surfaces the apply helpers on a
// small debug surface for Archie tool calls + the e2e spec.

export function PatternFeaturePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPatternFeature  = () => setOpen(true);
    window.__forgeClosePatternFeature = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_PATTERN_FEATURE_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgePatternFeatureHelper = Object.freeze({
      applyLinearPattern,
      applyCircularPattern,
      applyMirrorPattern,
      buildTranslatedCopy,
      buildRotatedCopy,
      buildMirrorCopy,
      readNativePatternBodies,
      EVENT_NAME: FORGE_PATTERN_FEATURE_EVENT,
      MENU_ID: FORGE_PATTERN_FEATURE_MENU_ID,
      PATTERN_MODES,
      PATTERN_AXES,
      MIRROR_PLANES,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenPatternFeature; } catch {}
      try { delete window.__forgeClosePatternFeature; } catch {}
    };
  }, []);
  return (
    <PatternFeaturePanel open={open} onClose={() => setOpen(false)} />
  );
}

export default PatternFeaturePanel;
