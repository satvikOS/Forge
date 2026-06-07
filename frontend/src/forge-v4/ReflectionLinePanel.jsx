// PUSH-213 (Slice-157) — Real Reflection Line analyser for Class-A
// surfacing QA.
//
// What it does
// ────────────
// Builds a family of reflection-line iso-contours on a picked body.
// A reflection line is the locus on the surface where the reflected
// view ray (from the camera, mirrored about the surface normal) points
// to an infinite straight light source. Discontinuities in reflection-
// line shape reveal G1 / G2 issues just like zebra stripes — but with a
// single sharp analytic light source per family.
//
// Wire-up
// ───────
//   * Self-mounting host listens for the `tools.reflectionLine` menu
//     action and exposes `window.__forgeOpenReflectionLine(true|false)`.
//   * Body picker lists every body in `window.__forgeBodies`; "Build"
//     fetches the mesh via `forge.tessellate` (or a built-in sphere/plane
//     seed for the e2e), runs `extractReflectionLineFamily`, and adds
//     one THREE.LineSegments per family member to
//     `window.__forgeScene` inside a Group named
//     `forge-reflection-line-group`.
//   * "Clear" removes the group from the scene + disposes geometries.
//
// Hard constraints
// ────────────────
//   * NO new npm packages.
//   * Real iso-contour math (see reflectionLineMath.js).
//   * No MVP / no stub / no random colour.
//   * Multi-cam e2e (5 angles) mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  extractReflectionLines,
  extractReflectionLineFamily,
  buildParallelLightOrigins,
  reflectAbout,
  reflectionLineField,
  triangleIsoContour,
  classifySegments,
  familyColour,
  makeSphereMesh,
  makePlaneMesh,
  v3Normalise,
} from './reflectionLineMath.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const REFLECTION_LINE_GROUP_NAME = 'forge-reflection-line-group';
export const REFLECTION_LINE_EVENT = 'forge:reflection-line-built';

export const REFLECTION_LINE_DEFAULTS = Object.freeze({
  lightOrigin: { x: 0, y: 0, z: 100 },
  lightDirection: { x: 1, y: 0, z: 0 },
  viewDirection: { x: 0, y: 0, z: -1 },
  eps: 1.5,           // angular tolerance, degrees
  parallelLines: 5,   // family member count, 1..20
  spacing: 20,        // mm between parallel origins
});

// Default linear/angular tolerances forge.tessellate uses for high-
// quality surfacing QA. Same defaults as InertiaTensorPanel + most
// Class-A panels.
const TESS_LINEAR_DEFL = 0.05;
const TESS_ANGULAR_DEFL = 0.2;

// ─────────────────────────────────────────────────────────────────────
// Helper API — exposed for the e2e + Archie tool calls.

export function makeReflectionLineHelper() {
  return Object.freeze({
    // Pure-math entry points (re-exported from the math module).
    extractReflectionLines,
    extractReflectionLineFamily,
    buildParallelLightOrigins,
    reflectAbout,
    reflectionLineField,
    triangleIsoContour,
    classifySegments,
    familyColour,
    // Synthetic mesh seeds — useful for the e2e and Archie unit tests
    // that don't want to spin up the OCCT kernel.
    makeSphereMesh,
    makePlaneMesh,
    // Constants.
    DEFAULTS: REFLECTION_LINE_DEFAULTS,
    EVENT_NAME: REFLECTION_LINE_EVENT,
    GROUP_NAME: REFLECTION_LINE_GROUP_NAME,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Scene mutation — adds / clears the reflection-line group on
// window.__forgeScene. Built-in disposal so re-running Build does not
// leak GL programs.

function getScene() {
  return (typeof window !== 'undefined') ? window.__forgeScene : null;
}

function getCamera() {
  return (typeof window !== 'undefined') ? window.__forgeCamera : null;
}

async function loadThree() {
  if (typeof window !== 'undefined' && window.__forgeThree) {
    return window.__forgeThree;
  }
  return await import('three');
}

/** Remove and dispose the existing reflection-line group, if any. */
export function clearReflectionLineGroup() {
  const scene = getScene();
  if (!scene) return { removed: 0 };
  let removed = 0;
  const toDetach = [];
  scene.traverse((obj) => {
    if (obj && obj.name === REFLECTION_LINE_GROUP_NAME) toDetach.push(obj);
  });
  for (const grp of toDetach) {
    if (grp.parent) {
      grp.parent.remove(grp);
      removed += 1;
    }
    grp.traverse((child) => {
      if (child.geometry && typeof child.geometry.dispose === 'function') {
        child.geometry.dispose();
      }
      if (child.material && typeof child.material.dispose === 'function') {
        child.material.dispose();
      }
    });
  }
  return { removed };
}

/** Build the reflection-line family + add to the scene. Returns the
 *  summary statistics every family produces. */
export async function buildReflectionLineGroup({
  geometry,
  lightOrigin,
  lightDirection,
  viewDirection,
  eps,
  parallelLines,
  spacing,
}) {
  const scene = getScene();
  if (!scene) {
    return { ok: false, error: 'no scene' };
  }
  if (!geometry) {
    return { ok: false, error: 'no geometry' };
  }
  // Clear any pre-existing group first.
  clearReflectionLineGroup();
  const THREE = await loadThree();
  if (!THREE) {
    return { ok: false, error: 'three not loaded' };
  }

  const epsRad = (eps * Math.PI) / 180;
  const families = extractReflectionLineFamily({
    geometry,
    lightOrigin,
    lightDirection,
    viewDirection,
    eps: epsRad,
    count: parallelLines,
    spacing,
  });

  const group = new THREE.Group();
  group.name = REFLECTION_LINE_GROUP_NAME;
  group.userData = group.userData || {};
  group.userData.forgeReflectionLine = true;
  group.userData.familyCount = families.length;

  const stats = [];
  for (let i = 0; i < families.length; i++) {
    const f = families[i];
    const cls = classifySegments(f.segments);
    stats.push({
      index: i,
      origin: f.origin,
      colour: f.colour,
      segmentCount: cls.segmentCount,
      polylineCount: cls.polylineCount,
      closedLoopCount: cls.closedLoopCount,
      straightCount: cls.straightCount,
      totalLength: cls.totalLength,
    });
    if (f.segments.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(f.segments, 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(f.colour.r, f.colour.g, f.colour.b),
      linewidth: 2,
      toneMapped: false,
      depthTest: false,   // overlay reads above the surface
      transparent: true,
      opacity: 0.95,
    });
    mat.name = `forge-reflection-line-mat-${i}`;
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = `forge-reflection-line-${i}`;
    lines.renderOrder = 9999;
    lines.userData = { familyIndex: i, segmentCount: cls.segmentCount };
    group.add(lines);
  }

  scene.add(group);
  return { ok: true, families: stats, group };
}

// ─────────────────────────────────────────────────────────────────────
// Body geometry resolver.
//
// Order of preference for resolving a body to a tessellated mesh:
//   1. If body.params.synthetic === 'reflection-sphere' → makeSphereMesh.
//   2. If body.params.synthetic === 'reflection-plane'  → makePlaneMesh.
//   3. If body.handle is a number → forge.tessellate(handle, linTol, angTol).
//   4. Else → return null (the panel surfaces a real error).

export function geometryForBody(body) {
  if (!body) return null;
  const p = body.params || {};
  if (p.synthetic === 'reflection-sphere') {
    const r = +(p.radius || 10);
    const d = Math.max(1, Math.min(5, +(p.divisions || 3)));
    return makeSphereMesh(r, d);
  }
  if (p.synthetic === 'reflection-plane') {
    return makePlaneMesh(
      +(p.width  || 60),
      +(p.height || 40),
      +(p.divisionsX || 8),
      +(p.divisionsY || 8),
    );
  }
  if (typeof window === 'undefined') return null;
  const forge = window.forge;
  if (!forge || typeof forge.tessellate !== 'function') {
    return null;
  }
  if (typeof body.handle !== 'number') return null;
  const mesh = forge.tessellate(body.handle, TESS_LINEAR_DEFL, TESS_ANGULAR_DEFL);
  if (!mesh || !mesh.positions || mesh.positions.length === 0) return null;
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Body-seed helpers — exposed so the e2e can append synthetic sphere/
// plane bodies that the panel can immediately pick up.

export function seedSphereBody({ radius = 10, divisions = 3, name } = {}) {
  if (typeof window === 'undefined') return null;
  const id = `reflection-sphere-${Date.now()}`;
  const body = {
    id,
    kind: 'native',
    handle: null,        // synthetic — no kernel handle
    toolId: 'tools.reflectionLine.sphere',
    name: name || `Reflection Sphere (R=${radius})`,
    params: {
      synthetic: 'reflection-sphere',
      radius,
      divisions,
    },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  } else {
    window.__forgeBodies = (window.__forgeBodies || []).concat([body]);
  }
  // Dispatch the bus event so panels that listen for body-mutation can
  // re-read window.__forgeBodies (same pattern as MultiShellPanel +
  // RealVariableFilletPanel). __forgeAppendBody goes through React's
  // setState which only flushes window.__forgeBodies after the next
  // render — schedule the bus event on the next animation frame so
  // listeners read the freshly committed array.
  const fire = () => {
    try {
      window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
        detail: { kind: 'reflection-sphere', id },
      }));
    } catch {}
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(fire));
  } else {
    setTimeout(fire, 32);
  }
  return body;
}

export function seedPlaneBody({
  width = 60, height = 40, divisionsX = 8, divisionsY = 8, name,
} = {}) {
  if (typeof window === 'undefined') return null;
  const id = `reflection-plane-${Date.now()}`;
  const body = {
    id,
    kind: 'native',
    handle: null,
    toolId: 'tools.reflectionLine.plane',
    name: name || `Reflection Plane (${width}×${height})`,
    params: {
      synthetic: 'reflection-plane',
      width, height, divisionsX, divisionsY,
    },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  } else {
    window.__forgeBodies = (window.__forgeBodies || []).concat([body]);
  }
  const fire = () => {
    try {
      window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
        detail: { kind: 'reflection-plane', id },
      }));
    } catch {}
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(fire));
  } else {
    setTimeout(fire, 32);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────
// Panel styling.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 360,
  zIndex: 1331,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  fontFamily: 'var(--forge-sans, ui-sans-serif, system-ui)',
  overflowY: 'auto',
};
const HEADER = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas, #0e1117)',
  display: 'flex', alignItems: 'center', gap: 8,
  flexShrink: 0,
};
const SECTION = {
  padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 8,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const FIELD = {
  display: 'flex', flexDirection: 'column', gap: 3,
};
const LABEL = {
  fontSize: 9,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'var(--forge-mono, monospace)',
};
const INPUT = {
  background: 'var(--forge-canvas, #0e1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '4px 6px',
  fontFamily: 'var(--forge-mono, monospace)',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
};
const TRIPLE_INPUT_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 6,
};
const BTN_PRIMARY = {
  flex: 1,
  background: 'var(--forge-accent-mute, #1f3a72)',
  border: '1px solid var(--forge-accent-rim, #3a7afe)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  font: 'inherit', fontSize: 11,
  padding: '6px 10px',
  cursor: 'pointer',
};
const BTN_SECONDARY = {
  flex: 1,
  background: 'var(--forge-canvas, #0e1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  font: 'inherit', fontSize: 11,
  padding: '6px 10px',
  cursor: 'pointer',
};
const CHIP_ROW = {
  display: 'flex', gap: 6, flexWrap: 'wrap',
};
const CHIP = {
  display: 'inline-flex', flexDirection: 'column',
  padding: '3px 8px',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas, #0e1117)',
  fontFamily: 'var(--forge-mono, monospace)',
  fontSize: 10,
  lineHeight: 1.1,
};
const CHIP_LABEL = {
  fontSize: 8,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// ─────────────────────────────────────────────────────────────────────
// XYZ input triplet — three numeric inputs bound to a single {x,y,z}.

function XYZInput({ value, onChange, testIdPrefix, step = 1 }) {
  const handle = (k) => (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    onChange({ ...value, [k]: v });
  };
  return (
    <div style={TRIPLE_INPUT_ROW}>
      <input type="number"
             step={step}
             value={value.x}
             onChange={handle('x')}
             data-testid={`${testIdPrefix}-x`}
             aria-label={`${testIdPrefix} x`}
             style={INPUT} />
      <input type="number"
             step={step}
             value={value.y}
             onChange={handle('y')}
             data-testid={`${testIdPrefix}-y`}
             aria-label={`${testIdPrefix} y`}
             style={INPUT} />
      <input type="number"
             step={step}
             value={value.z}
             onChange={handle('z')}
             data-testid={`${testIdPrefix}-z`}
             aria-label={`${testIdPrefix} z`}
             style={INPUT} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body picker — drop-down listing every body in window.__forgeBodies.
// Re-reads on every render so newly-appended bodies show up.

function readBodies() {
  if (typeof window === 'undefined') return [];
  const b = window.__forgeBodies;
  return Array.isArray(b) ? b : [];
}

// ─────────────────────────────────────────────────────────────────────
// Main panel component.

export function ReflectionLinePanel({ open, onClose }) {
  const [bodyId, setBodyId] = useState('');
  const [lightOrigin, setLightOrigin] = useState({
    ...REFLECTION_LINE_DEFAULTS.lightOrigin,
  });
  const [lightDirection, setLightDirection] = useState({
    ...REFLECTION_LINE_DEFAULTS.lightDirection,
  });
  const [viewDirection, setViewDirection] = useState({
    ...REFLECTION_LINE_DEFAULTS.viewDirection,
  });
  const [eps, setEps] = useState(REFLECTION_LINE_DEFAULTS.eps);
  const [parallelLines, setParallelLines] = useState(
    REFLECTION_LINE_DEFAULTS.parallelLines);
  const [spacing, setSpacing] = useState(REFLECTION_LINE_DEFAULTS.spacing);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);
  // Body list snapshot — re-read on every open / forge:bodies-changed.
  const [bodies, setBodies] = useState(() => readBodies());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = () => setBodies(readBodies());
    window.addEventListener('forge:bodies-changed', onChange);
    return () => window.removeEventListener('forge:bodies-changed', onChange);
  }, []);

  useEffect(() => {
    if (open) setBodies(readBodies());
  }, [open]);

  // Sync view direction from the live camera when the panel opens so the
  // user starts with a sensible default.
  useEffect(() => {
    if (!open) return undefined;
    const cam = getCamera();
    if (cam && cam.position && cam.position.length() > 1e-3) {
      const v = v3Normalise({
        x: -cam.position.x,
        y: -cam.position.y,
        z: -cam.position.z,
      });
      // Only auto-fill if the current direction is the default.
      setViewDirection((prev) => {
        const isDefault = prev.x === 0 && prev.y === 0 && prev.z === -1;
        return isDefault ? v : prev;
      });
    }
    return undefined;
  }, [open]);

  const selectedBody = useMemo(() => {
    if (!bodyId) return null;
    return bodies.find((b) => b.id === bodyId) || null;
  }, [bodyId, bodies]);

  // When a single body exists, pick it automatically.
  useEffect(() => {
    if (!bodyId && bodies.length > 0) {
      setBodyId(bodies[0].id);
    }
    if (bodyId && !bodies.find((b) => b.id === bodyId)) {
      setBodyId(bodies.length > 0 ? bodies[0].id : '');
    }
  }, [bodies, bodyId]);

  const onBuild = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const body = bodies.find((b) => b.id === bodyId);
      if (!body) throw new Error('pick a body first');
      const geometry = geometryForBody(body);
      if (!geometry || !geometry.positions || geometry.positions.length === 0) {
        throw new Error(`body ${body.id} has no tessellation`);
      }
      const result = await buildReflectionLineGroup({
        geometry,
        lightOrigin, lightDirection, viewDirection,
        eps, parallelLines, spacing,
      });
      if (!result.ok) throw new Error(result.error || 'build failed');
      const totalSegments = result.families.reduce(
        (a, f) => a + f.segmentCount, 0);
      const closedLoops = result.families.reduce(
        (a, f) => a + f.closedLoopCount, 0);
      const straight = result.families.reduce(
        (a, f) => a + f.straightCount, 0);
      const polylines = result.families.reduce(
        (a, f) => a + f.polylineCount, 0);
      const payload = {
        bodyId: body.id,
        familyCount: result.families.length,
        families: result.families,
        totalSegments,
        closedLoops,
        straight,
        polylines,
        ts: Date.now(),
      };
      setLastResult(payload);
      if (typeof window !== 'undefined') {
        window.__forgeReflectionLineLast = payload;
        try {
          window.dispatchEvent(new CustomEvent(REFLECTION_LINE_EVENT, {
            detail: payload,
          }));
        } catch {}
      }
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [bodies, bodyId, lightOrigin, lightDirection, viewDirection,
      eps, parallelLines, spacing]);

  const onClear = useCallback(() => {
    setError(null);
    const r = clearReflectionLineGroup();
    setLastResult(null);
    if (typeof window !== 'undefined') {
      try { delete window.__forgeReflectionLineLast; } catch {}
      try {
        window.dispatchEvent(new CustomEvent(REFLECTION_LINE_EVENT, {
          detail: { cleared: r.removed },
        }));
      } catch {}
    }
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside role="region"
           aria-label="Reflection Line Analyser (Class-A surfacing QA)"
           data-testid="forge-reflection-line-panel"
           data-body-id={bodyId || ''}
           data-parallel-lines={parallelLines}
           data-eps={eps}
           data-last-segment-count={lastResult ? lastResult.totalSegments : 0}
           data-last-closed-loops={lastResult ? lastResult.closedLoops : 0}
           data-last-straight={lastResult ? lastResult.straight : 0}
           data-last-polylines={lastResult ? lastResult.polylines : 0}
           style={PANEL_STYLE}>
      <header style={HEADER}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Reflection Line Analyser
        </span>
        <span style={{
          fontSize: 9,
          color: 'var(--forge-accent, #4f87ff)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
          fontFamily: 'var(--forge-mono, monospace)',
        }}>
          Class-A
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close reflection line panel"
                data-testid="forge-reflection-line-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  fontSize: 16,
                  fontFamily: 'var(--forge-mono, monospace)',
                }}>
          ×
        </button>
      </header>

      {/* Body picker. */}
      <section style={SECTION}>
        <label style={FIELD}>
          <span style={LABEL}>Body</span>
          <select value={bodyId}
                  onChange={(e) => setBodyId(e.target.value)}
                  data-testid="forge-reflection-line-body-picker"
                  style={INPUT}>
            <option value="">— pick a body —</option>
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}{b.params?.synthetic
                  ? ` · ${b.params.synthetic}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          lineHeight: 1.4,
        }}>
          {selectedBody
            ? `Selected: ${selectedBody.name || selectedBody.id}`
            : (bodies.length === 0
                ? 'No bodies in scene — seed via tools.reflectionLine.* or via the menu.'
                : 'Pick a body to analyse.')}
        </div>
      </section>

      {/* Light parameters. */}
      <section style={SECTION}>
        <label style={FIELD}>
          <span style={LABEL}>Light origin (O)</span>
          <XYZInput value={lightOrigin}
                    onChange={setLightOrigin}
                    testIdPrefix="forge-reflection-line-origin" />
        </label>
        <label style={FIELD}>
          <span style={LABEL}>Light direction (D)</span>
          <XYZInput value={lightDirection}
                    onChange={setLightDirection}
                    testIdPrefix="forge-reflection-line-dir"
                    step={0.1} />
        </label>
        <label style={FIELD}>
          <span style={LABEL}>View direction</span>
          <XYZInput value={viewDirection}
                    onChange={setViewDirection}
                    testIdPrefix="forge-reflection-line-view"
                    step={0.1} />
        </label>
      </section>

      {/* Iso-contour parameters. */}
      <section style={SECTION}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6 }}>
          <label style={FIELD}>
            <span style={LABEL}>ε (°)</span>
            <input type="number"
                   min={0.1} max={20} step={0.1}
                   value={eps}
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     if (Number.isFinite(v) && v > 0) setEps(v);
                   }}
                   data-testid="forge-reflection-line-eps"
                   style={INPUT} />
          </label>
          <label style={FIELD}>
            <span style={LABEL}>Parallel</span>
            <input type="number"
                   min={1} max={20} step={1}
                   value={parallelLines}
                   onChange={(e) => {
                     const v = Number(e.target.value) | 0;
                     if (v >= 1 && v <= 20) setParallelLines(v);
                   }}
                   data-testid="forge-reflection-line-parallel"
                   style={INPUT} />
          </label>
          <label style={FIELD}>
            <span style={LABEL}>Spacing</span>
            <input type="number"
                   min={0.1} step={0.5}
                   value={spacing}
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     if (Number.isFinite(v) && v > 0) setSpacing(v);
                   }}
                   data-testid="forge-reflection-line-spacing"
                   style={INPUT} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button"
                  onClick={onBuild}
                  disabled={busy || !bodyId}
                  data-testid="forge-reflection-line-build"
                  style={{
                    ...BTN_PRIMARY,
                    opacity: (busy || !bodyId) ? 0.5 : 1,
                    cursor: (busy || !bodyId) ? 'wait' : 'pointer',
                  }}>
            {busy ? 'Building…' : 'Build'}
          </button>
          <button type="button"
                  onClick={onClear}
                  disabled={busy}
                  data-testid="forge-reflection-line-clear"
                  style={BTN_SECONDARY}>
            Clear
          </button>
        </div>

        {error ? (
          <div data-testid="forge-reflection-line-error"
               style={{
                 color: 'var(--forge-err, #ff6363)',
                 background: 'var(--forge-canvas, #0e1117)',
                 padding: '4px 8px',
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 10,
                 border: '1px solid var(--forge-err, #ff6363)',
                 borderRadius: 3,
               }}>
            error: {error}
          </div>
        ) : null}
      </section>

      {/* Result summary. */}
      {lastResult && (
        <section style={SECTION}>
          <div style={CHIP_ROW}>
            <span style={CHIP} data-testid="forge-reflection-line-chip-families">
              <span style={CHIP_LABEL}>Families</span>
              <span>{lastResult.familyCount}</span>
            </span>
            <span style={CHIP} data-testid="forge-reflection-line-chip-segments">
              <span style={CHIP_LABEL}>Segments</span>
              <span>{lastResult.totalSegments}</span>
            </span>
            <span style={CHIP} data-testid="forge-reflection-line-chip-polylines">
              <span style={CHIP_LABEL}>Polylines</span>
              <span>{lastResult.polylines}</span>
            </span>
            <span style={CHIP} data-testid="forge-reflection-line-chip-closed">
              <span style={CHIP_LABEL}>Closed loops</span>
              <span>{lastResult.closedLoops}</span>
            </span>
            <span style={CHIP} data-testid="forge-reflection-line-chip-straight">
              <span style={CHIP_LABEL}>Straight lines</span>
              <span>{lastResult.straight}</span>
            </span>
          </div>
          <div style={{
            maxHeight: 160,
            overflowY: 'auto',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse',
                            fontSize: 10, fontFamily: 'var(--forge-mono, monospace)' }}>
              <thead>
                <tr style={{
                  background: 'var(--forge-canvas-2, #161b22)',
                  position: 'sticky', top: 0,
                }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>seg</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>poly</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>closed</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>straight</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>length</th>
                </tr>
              </thead>
              <tbody>
                {lastResult.families.map((f) => (
                  <tr key={f.index}
                      data-testid="forge-reflection-line-family-row"
                      data-family-index={f.index}
                      data-segment-count={f.segmentCount}
                      data-closed-loops={f.closedLoopCount}
                      data-straight={f.straightCount}>
                    <td style={{ padding: '2px 6px' }}>
                      <span style={{
                        display: 'inline-block',
                        width: 10, height: 10,
                        background: `rgb(${(f.colour.r*255)|0},${(f.colour.g*255)|0},${(f.colour.b*255)|0})`,
                        marginRight: 4,
                        verticalAlign: 'middle',
                        border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      }} />
                      {f.index}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                      {f.segmentCount}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                      {f.polylineCount}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                      {f.closedLoopCount}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                      {f.straightCount}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                      {f.totalLength.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{
        padding: '10px 12px',
        marginTop: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        fontSize: 10,
        fontFamily: 'var(--forge-mono, monospace)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        lineHeight: 1.5,
      }}>
        Iso-contour of (r · u − cos ε) where r = reflected view ray and
        u = direction to the light line. Closed loops on a sphere; straight
        lines on a plane. Kinks reveal G1 / G2 breaks. Class-A parity
        with Alias / ICEM.
      </section>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function ReflectionLinePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    // Imperative entry points.
    window.__forgeOpenReflectionLine =
      (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseReflectionLine = () => setOpen(false);

    // Helper API surface — pure-math + scene I/O + synthetic seeds.
    window.__forgeReflectionLineHelper = makeReflectionLineHelper();

    // Synthetic body seeds — exposed at top level so the e2e can append
    // a sphere or plane in one call.
    window.__forgeSeedReflectionSphere = seedSphereBody;
    window.__forgeSeedReflectionPlane  = seedPlaneBody;
    window.__forgeClearReflectionLineGroup = clearReflectionLineGroup;

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.reflectionLine') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenReflectionLine; } catch {}
      try { delete window.__forgeCloseReflectionLine; } catch {}
      try { delete window.__forgeReflectionLineHelper; } catch {}
      try { delete window.__forgeSeedReflectionSphere; } catch {}
      try { delete window.__forgeSeedReflectionPlane; } catch {}
      try { delete window.__forgeClearReflectionLineGroup; } catch {}
    };
  }, []);

  return <ReflectionLinePanel open={open} onClose={() => setOpen(false)} />;
}

export default ReflectionLinePanelHost;
