// PUSH-209 (Slice-163) — Variable-Section Sweep panel.
//
// Class-A surfacing primitive used by CATIA Generative Shape Design /
// Alias / ICEM Surf to sweep a profile cross-section along a spine while
// morphing the section so it touches one or more guide curves at every
// sample. Surface contract:
//
//   * Spine curve picker — a small dropdown picks between "straight",
//     "arc XZ 90°", or a user-supplied polyline (via the headless API).
//   * Profile editor — radial polyline; presets: circle, square. Slider
//     for circle radius.
//   * Guides list — add up to 4 guides. Each guide is a 3D polyline; the
//     panel offers "tapered (axial)" and "opposite tapered" presets, plus
//     the option to use a previously-built guide via the headless API.
//   * nSamples slider — 4..400, default 60.
//   * Build button → tessellates a THREE.BufferGeometry tube, commits it
//     to `window.__forgeScene`, surfaces:
//       - vertex / triangle count
//       - max guide-touch error
//       - per-guide max error
//
// Window surface:
//   * window.__forgeOpenVariableSectionSweep(true|false)
//   * window.__forgeCloseVariableSectionSweep()
//   * window.__forgeVariableSectionSweepHelper                — math surface
//   * window.__forgeVariableSectionSweepLast                  — last result
//
// Headed event: `forge:variable-section-sweep-built` with the result
// payload mirroring window.__forgeVariableSectionSweepLast.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import {
  VARSWEEP_EVENT,
  VARSWEEP_STORAGE,
  VARSWEEP_MIN_SAMPLES,
  VARSWEEP_MAX_SAMPLES,
  VARSWEEP_DEFAULT_SAMPLES,
  VARSWEEP_MIN_PROFILE_PTS,
  VARSWEEP_MAX_PROFILE_PTS,
  VARSWEEP_DEFAULT_PROFILE_PTS,
  VARSWEEP_MAX_GUIDES,
  VARSWEEP_GUIDE_TOUCH_TOL,
  VARSWEEP_KERNEL_SIGMA,
  VARSWEEP_KERNEL_REG,
  buildVariableSectionSweep,
  validateInputs,
  buildSpineFrames,
  morphProfile,
  projectGuide,
  tessellateSweep,
  normaliseProfile,
  evalProfileXYAtAngle,
  evalCurve,
  evalCurveTangent,
  buildStraightSpine,
  buildArcSpine,
  buildCircleProfile,
  buildSquareProfile,
  buildTaperGuide,
  buildOppositeTaperGuide,
  angularDistance,
} from './variableSectionSweepMath.js';

// Re-export so plugins / e2e have a stable import path.
export {
  VARSWEEP_EVENT,
  VARSWEEP_STORAGE,
  VARSWEEP_MIN_SAMPLES,
  VARSWEEP_MAX_SAMPLES,
  VARSWEEP_DEFAULT_SAMPLES,
  VARSWEEP_MIN_PROFILE_PTS,
  VARSWEEP_MAX_PROFILE_PTS,
  VARSWEEP_DEFAULT_PROFILE_PTS,
  VARSWEEP_MAX_GUIDES,
  VARSWEEP_GUIDE_TOUCH_TOL,
};

// ─────────────────────────────────────────────────────────────────────
// Scene group name — single group per panel session so a re-build can
// dispose the previous mesh in one pass without leaking GPU mem.

export const VARSWEEP_SCENE_NAME = '__forge_variable_section_sweep__';

// ─────────────────────────────────────────────────────────────────────
// THREE wiring.

function getActiveScene() {
  if (typeof window === 'undefined') return null;
  return window.__forgeScene || null;
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry) {
      try { obj.geometry.dispose(); } catch {}
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) { try { m.dispose(); } catch {} }
    }
  });
  if (group.parent) {
    try { group.parent.remove(group); } catch {}
  }
}

// Build a THREE.Mesh from the buildVariableSectionSweep output. Vertex
// normals are computed so the swept tube lights correctly.
export function buildSweepMesh(result, colorHex = 0x4f87ff) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.1,
    roughness: 0.55,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'variable-section-sweep-mesh';
  return mesh;
}

// Spine + guides wireframe preview so the user sees the inputs in 3D.
export function buildSpinePreview(spine, samples = 64) {
  const pts = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const p = evalCurve(spine, t);
    pts[i * 3]     = p[0];
    pts[i * 3 + 1] = p[1];
    pts[i * 3 + 2] = p[2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffaa55, linewidth: 2 });
  const line = new THREE.Line(geom, mat);
  line.name = 'variable-section-sweep-spine';
  return line;
}

export function buildGuidesPreview(guides, samples = 32) {
  const group = new THREE.Group();
  group.name = 'variable-section-sweep-guides';
  for (let gi = 0; gi < guides.length; gi++) {
    const guide = guides[gi];
    const pts = new Float32Array(samples * 3);
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const p = evalCurve(guide.curve, t);
      pts[i * 3]     = p[0];
      pts[i * 3 + 1] = p[1];
      pts[i * 3 + 2] = p[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x55ffaa });
    const line = new THREE.Line(geom, mat);
    line.name = `variable-section-sweep-guide-${gi}`;
    group.add(line);
  }
  return group;
}

// ─────────────────────────────────────────────────────────────────────
// Install the helper API on window the moment this module is imported.

if (typeof window !== 'undefined') {
  try {
    window.__forgeVariableSectionSweepHelper = Object.freeze({
      buildVariableSectionSweep,
      validateInputs,
      buildSpineFrames,
      morphProfile,
      projectGuide,
      tessellateSweep,
      normaliseProfile,
      evalProfileXYAtAngle,
      evalCurve,
      evalCurveTangent,
      buildStraightSpine,
      buildArcSpine,
      buildCircleProfile,
      buildSquareProfile,
      buildTaperGuide,
      buildOppositeTaperGuide,
      angularDistance,
      buildSweepMesh,
      buildSpinePreview,
      buildGuidesPreview,
      EVENT_NAME:    VARSWEEP_EVENT,
      STORAGE_KEY:   VARSWEEP_STORAGE,
      MIN_SAMPLES:   VARSWEEP_MIN_SAMPLES,
      MAX_SAMPLES:   VARSWEEP_MAX_SAMPLES,
      DEFAULT_SAMPLES: VARSWEEP_DEFAULT_SAMPLES,
      MIN_PROFILE_PTS: VARSWEEP_MIN_PROFILE_PTS,
      MAX_PROFILE_PTS: VARSWEEP_MAX_PROFILE_PTS,
      DEFAULT_PROFILE_PTS: VARSWEEP_DEFAULT_PROFILE_PTS,
      MAX_GUIDES:    VARSWEEP_MAX_GUIDES,
      GUIDE_TOUCH_TOL: VARSWEEP_GUIDE_TOUCH_TOL,
      KERNEL_SIGMA:  VARSWEEP_KERNEL_SIGMA,
      KERNEL_REG:    VARSWEEP_KERNEL_REG,
      SCENE_NAME:    VARSWEEP_SCENE_NAME,
    });
  } catch { /* fail soft */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-208.

const PANEL_W = 480;
const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W,
  zIndex: 1337,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column',
  gap: 'var(--forge-space-2, 8px)',
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
const PRESET_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};
const PRESET_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 0', cursor: 'pointer', fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 60px', gap: 8, alignItems: 'center',
};
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const CHIP_ROW = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const CHIP = (variant) => ({
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid ' + (variant === 'ok'
    ? 'var(--forge-ok, #4caf50)'
    : variant === 'err' ? 'var(--forge-err, #ef5350)'
    : 'var(--forge-rail-edge, #2a2d34)'),
  borderRadius: 4,
  padding: '4px 8px',
  display: 'flex', flexDirection: 'column',
  gap: 2,
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink, #dadde2)',
  minWidth: 80,
});
const CHIP_LABEL = {
  fontSize: 8,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const ROW_CMP = {
  display: 'grid',
  gridTemplateColumns: '24px 1fr 60px 60px',
  gap: 4,
  alignItems: 'center',
  fontSize: 10,
  padding: '2px 4px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STATUS_PILL = (variant) => ({
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: variant === 'err'  ? 'var(--forge-err, #ef5350)'
       : variant === 'ok'   ? 'var(--forge-ok, #4caf50)'
       :                      'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid currentColor',
});
const ERR_BOX = {
  color: 'var(--forge-err, #ef5350)',
  background: 'var(--forge-canvas-1, #0e1218)',
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  border: '1px solid var(--forge-err, #ef5350)',
  borderRadius: 3,
};

// ─────────────────────────────────────────────────────────────────────
// Defaults — driven so the panel is "ready to build" the moment it opens.

const SPINE_HEIGHT = 100;
const SPINE_PRESETS = {
  straight: () => buildStraightSpine({ height: SPINE_HEIGHT, z0: 0 }),
  arcXZ:    () => buildArcSpine({ radius: SPINE_HEIGHT, sweepDeg: 90, segments: 32 }),
};
const PROFILE_PRESETS = {
  circle: (params) => buildCircleProfile({ radius: params?.radius ?? 20 }),
  square: (params) => buildSquareProfile({ side: params?.side ?? 40 }),
};
const GUIDE_PRESETS = {
  tapered: () => buildTaperGuide({
    spineHeight: SPINE_HEIGHT, baseRadius: 20, tipRadius: 5,
  }),
  oppositeTaper: () => buildOppositeTaperGuide({
    spineHeight: SPINE_HEIGHT, baseRadius: 20, tipRadius: 5,
  }),
};

function describeGuide(guide, i) {
  if (!guide) return `#${i}: (none)`;
  const n = (guide.curve?.pts || []).length;
  const ang = Number.isFinite(guide.angle)
    ? `θ=${(guide.angle * 180 / Math.PI).toFixed(0)}°`
    : 'θ=auto';
  return `#${i}: polyline (${n} pts) · ${ang}`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function VariableSectionSweepPanel({ open, onClose }) {
  const [spineName, setSpineName] = useState('straight');
  const [profileName, setProfileName] = useState('circle');
  const [circleRadius, setCircleRadius] = useState(20);
  const [guides, setGuides] = useState([]);
  const [nSamples, setNSamples] = useState(VARSWEEP_DEFAULT_SAMPLES);
  const [nProfilePts, setNProfilePts] = useState(VARSWEEP_DEFAULT_PROFILE_PTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const sceneGroupRef = useRef(null);

  // Tear down the scene group on unmount.
  useEffect(() => {
    return () => {
      if (sceneGroupRef.current) {
        disposeGroup(sceneGroupRef.current);
        sceneGroupRef.current = null;
        if (typeof window !== 'undefined') {
          try { delete window.__forgeVariableSectionSweepGroup; } catch {}
        }
      }
    };
  }, []);

  // Reset error / busy when closed so re-opening is fresh.
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Derived inputs.
  const spine = useMemo(() => {
    const fn = SPINE_PRESETS[spineName];
    return fn ? fn() : SPINE_PRESETS.straight();
  }, [spineName]);

  const profile = useMemo(() => {
    if (profileName === 'circle') {
      return PROFILE_PRESETS.circle({ radius: circleRadius });
    }
    return PROFILE_PRESETS[profileName]();
  }, [profileName, circleRadius]);

  const onAddGuide = useCallback((presetId) => {
    const fn = GUIDE_PRESETS[presetId];
    if (!fn) return;
    setGuides((prev) => {
      if (prev.length >= VARSWEEP_MAX_GUIDES) return prev;
      return [...prev, fn()];
    });
  }, []);

  const onClearGuides = useCallback(() => {
    setGuides([]);
  }, []);

  const onRemoveGuide = useCallback((idx) => {
    setGuides((prev) => prev.filter((_g, i) => i !== idx));
  }, []);

  const onChangeSamples = useCallback((e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) v = VARSWEEP_DEFAULT_SAMPLES;
    if (v < VARSWEEP_MIN_SAMPLES) v = VARSWEEP_MIN_SAMPLES;
    if (v > VARSWEEP_MAX_SAMPLES) v = VARSWEEP_MAX_SAMPLES;
    setNSamples(v);
  }, []);

  const onChangeProfilePts = useCallback((e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) v = VARSWEEP_DEFAULT_PROFILE_PTS;
    if (v < VARSWEEP_MIN_PROFILE_PTS) v = VARSWEEP_MIN_PROFILE_PTS;
    if (v > VARSWEEP_MAX_PROFILE_PTS) v = VARSWEEP_MAX_PROFILE_PTS;
    setNProfilePts(v);
  }, []);

  const onChangeCircleRadius = useCallback((e) => {
    let v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v <= 0) v = 20;
    setCircleRadius(v);
  }, []);

  // Live validation (without building).
  const inputValidation = useMemo(() => {
    return validateInputs({
      spine, profile, guides, nSamples, nProfilePts,
    });
  }, [spine, profile, guides, nSamples, nProfilePts]);

  const publishToScene = useCallback((res) => {
    if (typeof window === 'undefined') return;
    const scene = getActiveScene();
    if (sceneGroupRef.current) {
      disposeGroup(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }
    if (!scene) {
      window.__forgeVariableSectionSweepGroup = null;
      return;
    }
    const group = new THREE.Group();
    group.name = VARSWEEP_SCENE_NAME;
    group.add(buildSweepMesh(res));
    group.add(buildSpinePreview(spine));
    if (guides.length > 0) group.add(buildGuidesPreview(guides));
    scene.add(group);
    sceneGroupRef.current = group;
    window.__forgeVariableSectionSweepGroup = group;
  }, [spine, guides]);

  const onBuild = useCallback(() => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      try {
        const res = buildVariableSectionSweep({
          spine, profile, guides, nSamples, nProfilePts,
        });
        if (!res.ok) {
          setError(res.reason || 'unknown build failure');
          setResult(null);
          if (typeof window !== 'undefined') {
            try {
              window.__forgeVariableSectionSweepLast = {
                ok: false, reason: res.reason,
              };
              window.dispatchEvent(new CustomEvent(VARSWEEP_EVENT, {
                detail: { ok: false, reason: res.reason },
              }));
            } catch {}
          }
          return;
        }
        setResult(res);
        publishToScene(res);
        if (typeof window !== 'undefined') {
          // Strip the giant typed arrays into plain summaries for the
          // window mirror so the e2e can assert without serialising
          // a Float32Array through evaluate().
          const summary = {
            ok: true,
            nSamples: res.stats.nSamples,
            nProfilePts: res.stats.nProfilePts,
            nGuides: res.stats.nGuides,
            vertexCount: res.vertexCount,
            triangleCount: res.triangleCount,
            guideTouchErrorMax: res.stats.guideTouchErrorMax,
            guideTouchErrorPerSample: Array.from(res.stats.guideTouchErrorPerSample),
            guideStats: res.stats.guideStats.map((gs) => ({
              index: gs.index,
              maxError: gs.maxError,
              perSampleError: Array.from(gs.perSampleError),
            })),
            tol: res.stats.tol,
            pass: res.stats.pass,
            sigma: res.stats.sigma,
            ts: Date.now(),
          };
          window.__forgeVariableSectionSweepLast = summary;
          try {
            window.dispatchEvent(new CustomEvent(VARSWEEP_EVENT, {
              detail: summary,
            }));
          } catch {}
        }
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 40);
  }, [spine, profile, guides, nSamples, nProfilePts, publishToScene]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const guidesAddDisabled = guides.length >= VARSWEEP_MAX_GUIDES;

  return createPortal(
    <aside role="region"
           aria-label="Variable-Section Sweep panel"
           data-testid="forge-varsweep-panel"
           data-spine={spineName}
           data-profile={profileName}
           data-n-samples={nSamples}
           data-n-profile-pts={nProfilePts}
           data-n-guides={guides.length}
           data-input-ok={inputValidation.ok ? '1' : '0'}
           style={PANEL_STYLE}>

      <div style={HEADER_ROW}>
        <strong style={{ flex: 1 }}>
          Variable-Section Sweep · guided (Class-A)
        </strong>
        <span data-testid="forge-varsweep-status"
              style={STATUS_PILL(
                error ? 'err'
                : result && result.stats && result.stats.pass ? 'ok'
                : 'mute')}>
          {error ? 'error'
            : busy ? 'busy'
            : result
              ? (result.stats.pass
                ? `touch ok (${result.stats.guideTouchErrorMax.toExponential(1)})`
                : `touch warn (${result.stats.guideTouchErrorMax.toExponential(1)})`)
              : 'idle'}
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close Variable-Section Sweep panel"
                data-testid="forge-varsweep-close"
                style={CLOSE_BTN}>
          ×
        </button>
      </div>

      <div style={SECTION_TITLE}>Spine curve</div>
      <div style={SECTION_BOX}>
        <div style={PRESET_GRID}>
          {[
            { id: 'straight', label: 'straight' },
            { id: 'arcXZ',    label: 'arc XZ 90°' },
          ].map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => setSpineName(p.id)}
                    data-testid={`forge-varsweep-spine-${p.id}`}
                    style={PRESET_BTN(spineName === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Profile cross-section</div>
      <div style={SECTION_BOX}>
        <div style={PRESET_GRID}>
          {[
            { id: 'circle', label: 'circle' },
            { id: 'square', label: 'square' },
          ].map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => setProfileName(p.id)}
                    data-testid={`forge-varsweep-profile-${p.id}`}
                    style={PRESET_BTN(profileName === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {profileName === 'circle' && (
          <div style={SLIDER_ROW}>
            <span style={{ fontSize: 10 }}>circle radius</span>
            <input type="number"
                   min={0.001}
                   step={0.1}
                   value={circleRadius}
                   onChange={onChangeCircleRadius}
                   data-testid="forge-varsweep-circle-radius"
                   style={NUM_INPUT_STYLE} />
          </div>
        )}
      </div>

      <div style={SECTION_TITLE}>
        Guides ({guides.length} of {VARSWEEP_MAX_GUIDES})
      </div>
      <div style={SECTION_BOX}
           data-testid="forge-varsweep-guide-list"
           data-guide-count={guides.length}>
        {guides.map((g, i) => (
          <div key={i} style={ROW_CMP}
               data-testid={`forge-varsweep-guide-${i}`}
               data-guide-angle={Number.isFinite(g.angle) ? g.angle : ''}>
            <span>{i.toString().padStart(2, '0')}</span>
            <span>{describeGuide(g, i)}</span>
            <span style={{ textAlign: 'right' }}>
              {(g.curve?.pts || []).length} pts
            </span>
            <button type="button"
                    onClick={() => onRemoveGuide(i)}
                    data-testid={`forge-varsweep-guide-remove-${i}`}
                    style={{
                      ...ACTION_BTN('default', false),
                      padding: '2px 4px',
                      fontSize: 10,
                    }}>
              remove
            </button>
          </div>
        ))}
        {guides.length === 0 && (
          <div style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontStyle: 'italic',
            fontSize: 10,
          }}>
            no guides — sweep produces a straight prism
          </div>
        )}
        <div style={PRESET_GRID}>
          <button type="button"
                  onClick={() => onAddGuide('tapered')}
                  disabled={guidesAddDisabled}
                  data-testid="forge-varsweep-add-tapered"
                  style={ACTION_BTN('default', guidesAddDisabled)}>
            + tapered
          </button>
          <button type="button"
                  onClick={() => onAddGuide('oppositeTaper')}
                  disabled={guidesAddDisabled}
                  data-testid="forge-varsweep-add-opposite"
                  style={ACTION_BTN('default', guidesAddDisabled)}>
            + opposite
          </button>
          <button type="button"
                  onClick={onClearGuides}
                  disabled={guides.length === 0}
                  data-testid="forge-varsweep-clear-guides"
                  style={ACTION_BTN('default', guides.length === 0)}>
            clear
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>n samples (spine)</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={VARSWEEP_MIN_SAMPLES}
                 max={VARSWEEP_MAX_SAMPLES}
                 step={1}
                 value={nSamples}
                 onChange={onChangeSamples}
                 data-testid="forge-varsweep-samples-slider" />
          <input type="number"
                 min={VARSWEEP_MIN_SAMPLES}
                 max={VARSWEEP_MAX_SAMPLES}
                 step={1}
                 value={nSamples}
                 onChange={onChangeSamples}
                 data-testid="forge-varsweep-samples-input"
                 style={NUM_INPUT_STYLE} />
        </div>
      </div>

      <div style={SECTION_TITLE}>n profile spokes</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={VARSWEEP_MIN_PROFILE_PTS}
                 max={VARSWEEP_MAX_PROFILE_PTS}
                 step={2}
                 value={nProfilePts}
                 onChange={onChangeProfilePts}
                 data-testid="forge-varsweep-profile-pts-slider" />
          <input type="number"
                 min={VARSWEEP_MIN_PROFILE_PTS}
                 max={VARSWEEP_MAX_PROFILE_PTS}
                 step={1}
                 value={nProfilePts}
                 onChange={onChangeProfilePts}
                 data-testid="forge-varsweep-profile-pts-input"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {nSamples} × {nProfilePts} = {nSamples * nProfilePts} vertices ·
          {2 * (nSamples - 1) * nProfilePts} triangles
        </div>
      </div>

      {!inputValidation.ok && (
        <div data-testid="forge-varsweep-input-err"
             style={ERR_BOX}>
          input invalid: {inputValidation.reason}
        </div>
      )}

      <div style={SECTION_TITLE}>Action</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onBuild}
                disabled={busy || !inputValidation.ok}
                data-testid="forge-varsweep-build"
                style={ACTION_BTN('primary', busy || !inputValidation.ok)}>
          {busy ? 'Building…' : 'Build · sweep + commit to scene'}
        </button>
        {error && (
          <div data-testid="forge-varsweep-error"
               style={ERR_BOX}>
            build failed: {error}
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={SECTION_TITLE}>Result</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-varsweep-chip-samples"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Samples</span>
                <span>{result.stats.nSamples}</span>
              </span>
              <span data-testid="forge-varsweep-chip-profile-pts"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Spokes</span>
                <span>{result.stats.nProfilePts}</span>
              </span>
              <span data-testid="forge-varsweep-chip-guides"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Guides</span>
                <span>{result.stats.nGuides}</span>
              </span>
              <span data-testid="forge-varsweep-chip-vertices"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Vertices</span>
                <span>{result.vertexCount}</span>
              </span>
              <span data-testid="forge-varsweep-chip-triangles"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Triangles</span>
                <span>{result.triangleCount}</span>
              </span>
              <span data-testid="forge-varsweep-chip-touch-max"
                    style={CHIP(result.stats.pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>Touch max</span>
                <span>{result.stats.guideTouchErrorMax.toExponential(3)}</span>
              </span>
              <span data-testid="forge-varsweep-chip-tol"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Tol</span>
                <span>{result.stats.tol.toExponential(1)}</span>
              </span>
            </div>
          </div>

          {result.stats.nGuides > 0 && (
            <>
              <div style={SECTION_TITLE}>Per-guide touch error</div>
              <div style={SECTION_BOX}
                   data-testid="forge-varsweep-guide-errs">
                {result.stats.guideStats.map((gs) => (
                  <div key={gs.index} style={ROW_CMP}
                       data-testid={`forge-varsweep-guide-err-${gs.index}`}
                       data-max-err={gs.maxError}>
                    <span>{gs.index.toString().padStart(2, '0')}</span>
                    <span>
                      {gs.maxError <= result.stats.tol ? 'pass' : 'warn'} · max
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {gs.maxError.toExponential(3)}
                    </span>
                    <span style={{
                      textAlign: 'right',
                      color: gs.maxError <= result.stats.tol
                        ? 'var(--forge-ok, #4caf50)'
                        : 'var(--forge-err, #ef5350)',
                    }}>
                      {gs.maxError <= result.stats.tol ? 'OK' : '!'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div style={{
        marginTop: 'auto',
        fontSize: 10,
        fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        lineHeight: 1.5,
      }}>
        Parallel-transport frame · radial-basis profile morph ·
        up to {VARSWEEP_MAX_GUIDES} guide curves.
      </div>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function VariableSectionSweepPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenVariableSectionSweep = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseVariableSectionSweep = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.variableSectionSweep') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenVariableSectionSweep; } catch {}
      try { delete window.__forgeCloseVariableSectionSweep; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  return <VariableSectionSweepPanel open={open} onClose={() => setOpen(false)} />;
}

export default VariableSectionSweepPanelHost;
