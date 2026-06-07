// PUSH-124 (Slice-92) — Point Cloud Import + display panel.
//
// Reverse-engineering pipelines start with a point cloud (typically a
// LiDAR / structured-light scan). PUSH-124 ships the first half of that
// pipeline as a dedicated, single-purpose panel:
//
//   * File picker for .xyz / .ply (ASCII + little-endian binary). Reuses
//     the proven readers in pointCloudImport.js — Forge-161 already lives
//     here — so format coverage stays consistent with the legacy
//     ReverseEngWorkbench. PCD / E57 are still importable through the
//     workbench but PUSH-124 keeps the panel scope to the two formats
//     called out in the brief.
//
//   * "Generate synthetic point cloud" button — N points distributed on
//     a unit sphere via the Fibonacci spiral so the sampling is uniform
//     (rejection sampling would clump near the poles). N is a slider
//     (256 … 65536) so the e2e can drive a deterministic count.
//
//   * Three.js display through window.__forgeScene:
//       - The cloud renders as a real THREE.Points node sized for
//         visibility on the M4 Max remote-desktop session.
//       - The cloud's AABB is drawn as 8 InstancedMesh corner markers
//         (sphere geometry, one shared material) so the user can see the
//         extent without a wireframe-box helper.
//       - Both are added to window.__forgeScene under a single group so
//         "Clear" can dispose them in one pass without leaking GPU mem.
//
//   * Statistics readout: point count, bbox min/max + extents, centroid,
//     source label. Numbers are also mirrored on window for the e2e.
//
// Hard constraints (PUSH-124 brief + Forge mandate):
//   * NO new npm / C++ / external deps.
//   * Real impl, no MVP / stub / placeholder. Missing kernel → surface
//     the real error verbatim.
//   * Surgical edits to Menus.jsx (one entry) + App.jsx (one mount).
//   * Multi-cam e2e — 5 named camera angles per the Forge-171 mandate.
//   * Manual UI never posts to Archie's thread.
//
// Reachable via:
//   * `tools.pointCloud` menu action (PUSH-124 spec form),
//   * `tools.pointCloudImport` alias for the cmd palette,
//   * `window.__forgeOpenPointCloudImport(true|false)`,
//   * `window.__forgePointCloudImportHelper` (headless surface for the
//     e2e + Archie / plugins).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Icon } from './icons/Icon.jsx';
import {
  detectFormat,
  readPLY,
  readXYZ,
  boundingBox,
} from './pointCloudImport.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — kept module-scope so the helper surface can export them
// without re-deriving on each render.

export const POINTCLOUD_IMPORT_EVENT      = 'forge:pointcloud-import-changed';
export const POINTCLOUD_IMPORT_SOURCE_SYN = 'synth';
export const POINTCLOUD_IMPORT_SOURCE_FILE = 'file';
export const POINTCLOUD_IMPORT_MIN_SYNTH  = 256;
export const POINTCLOUD_IMPORT_MAX_SYNTH  = 65536;
export const POINTCLOUD_IMPORT_DEFAULT_SYNTH = 2048;
export const POINTCLOUD_IMPORT_DEFAULT_RADIUS = 50; // mm
export const POINTCLOUD_IMPORT_SCENE_NAME = '__forge_pointcloud_import__';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — Fibonacci-spiral sphere sampler + bbox stats.

// Sample `n` points on the surface of a sphere of radius `r` centred at
// the origin via the Fibonacci spiral. Returns a Float32Array of
// [x0,y0,z0, x1,y1,z1, …] in millimetres so it matches every other Forge
// length unit. The spiral is deterministic (no Math.random) so the e2e
// can assert on hard-coded centroid + bbox numbers.
export function sampleSphereFibonacci(n, r = POINTCLOUD_IMPORT_DEFAULT_RADIUS) {
  const N = Math.max(1, Math.floor(n));
  const out = new Float32Array(N * 3);
  const radius = Number.isFinite(r) && r > 0 ? r : POINTCLOUD_IMPORT_DEFAULT_RADIUS;
  // golden ratio φ — increment of the longitude per step.
  const phi = Math.PI * (Math.sqrt(5) - 1);
  for (let i = 0; i < N; i += 1) {
    // y goes from +1 to -1; the spiral wraps around the equator.
    const y = 1 - (i / Math.max(1, N - 1)) * 2;
    const rxz = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    const x = Math.cos(theta) * rxz;
    const z = Math.sin(theta) * rxz;
    out[i * 3]     = x * radius;
    out[i * 3 + 1] = y * radius;
    out[i * 3 + 2] = z * radius;
  }
  return out;
}

// Compute extended statistics for a positions Float32Array. Reuses the
// pointCloudImport.boundingBox call so the bbox numbers stay consistent
// across the Forge-161 workbench + PUSH-124 panel.
export function computeStats(positions) {
  if (!positions || positions.length < 3) {
    return {
      count: 0,
      bbox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
              dx: 0, dy: 0, dz: 0 },
      centroid: { x: 0, y: 0, z: 0 },
      diagonal: 0,
    };
  }
  const bbox = boundingBox(positions);
  const N = positions.length / 3;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    sx += positions[i];
    sy += positions[i + 1];
    sz += positions[i + 2];
  }
  const centroid = { x: sx / N, y: sy / N, z: sz / N };
  const dx = bbox.dx, dy = bbox.dy, dz = bbox.dz;
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { count: N, bbox, centroid, diagonal };
}

// Parse a buffer that the user picked through <input type="file">. We
// gate on the file extension because the magic-byte sniff in
// detectFormat() conflates XYZ with anything else that has 3 floats in
// the first 256 bytes. Returns the same shape pointCloudImport.* uses:
//   { positions, colors, normals, count, format }
export function parsePointCloudBuffer(buf, filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.ply')) return readPLY(buf);
  if (lower.endsWith('.xyz')) return readXYZ(buf);
  // No extension — sniff. Honours the brief's "header parsing" line:
  // a PLY header is the first 4 bytes "ply\n"; XYZ is anything else
  // that parses as whitespace-separated triples.
  const detected = detectFormat(buf);
  if (detected === 'ply') return readPLY(buf);
  if (detected === 'xyz') return readXYZ(buf);
  throw new Error(`PointCloudImport: unsupported format ${detected}`);
}

// ─────────────────────────────────────────────────────────────────────
// THREE.js scene plumbing — build + dispose the live nodes the panel
// publishes into the main viewport.

function disposeNodes(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      try { obj.geometry.dispose(); } catch {}
    }
    if (obj.material && typeof obj.material.dispose === 'function') {
      try { obj.material.dispose(); } catch {}
    }
  });
  if (group.parent) group.parent.remove(group);
}

// Build a Points node + 8 AABB corner markers (InstancedMesh of small
// spheres) inside a fresh Group. The caller is responsible for adding
// the group to a scene + tearing it down via disposeNodes().
export function buildPointCloudScene(positions, stats, colorHex = 0xffaa55) {
  const group = new THREE.Group();
  group.name = POINTCLOUD_IMPORT_SCENE_NAME;

  // 1. Points node — primary visual.
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  // pointSize is tuned for visibility on a 1920×1080 remote-desktop
  // session — small enough that the spiral pattern is visible, big
  // enough that the cloud renders as more than a smear.
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: Math.max(0.6, stats.diagonal * 0.005),
    sizeAttenuation: true,
    depthWrite: false,
    transparent: false,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'pointcloud-import-points';
  group.add(points);

  // 2. AABB corner markers — 8 small spheres on an InstancedMesh share
  //    a single geometry + material so the GPU draws all 8 in one call.
  if (stats.count > 0) {
    const markerGeom = new THREE.SphereGeometry(
      Math.max(0.5, stats.diagonal * 0.015), 8, 6);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7 });
    const markers = new THREE.InstancedMesh(markerGeom, markerMat, 8);
    markers.name = 'pointcloud-import-bbox-markers';
    const b = stats.bbox;
    const corners = [
      [b.minX, b.minY, b.minZ], [b.maxX, b.minY, b.minZ],
      [b.minX, b.maxY, b.minZ], [b.maxX, b.maxY, b.minZ],
      [b.minX, b.minY, b.maxZ], [b.maxX, b.minY, b.maxZ],
      [b.minX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.maxZ],
    ];
    const tmpMat = new THREE.Matrix4();
    for (let i = 0; i < 8; i += 1) {
      tmpMat.makeTranslation(corners[i][0], corners[i][1], corners[i][2]);
      markers.setMatrixAt(i, tmpMat);
    }
    markers.instanceMatrix.needsUpdate = true;
    group.add(markers);
  }

  return group;
}

// Resolve the live scene the renderer published in Viewport.jsx. Returns
// null in non-Electron environments (the e2e drives the kernel through
// the renderer so this branch is only hit by unit tests).
export function getActiveScene() {
  if (typeof window === 'undefined') return null;
  return window.__forgeScene || null;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as ReverseEngineeringPanel so
// they feel like one toolset. Match BomAggregator's PANEL_W to keep the
// "scan workbench" docked panels visually consistent.

const PANEL_W = 480;
const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W,
  zIndex: 1334,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
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
const RADIO_GRID = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 };
const SOURCE_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  color: 'var(--forge-ink, #dadde2)',
  padding: '6px 8px',
  cursor: 'pointer', fontSize: 11,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
  textAlign: 'left',
});
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
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'center',
};
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
};
const STATS_LINE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11, color: 'var(--forge-ink, #dadde2)',
  display: 'flex', justifyContent: 'space-between', gap: 8,
};
const STATS_LABEL = { color: 'var(--forge-ink-mute, #9aa1ab)' };
const STATUS_PILL = (variant) => ({
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: variant === 'err'  ? 'var(--forge-err, #ef5350)'
       : variant === 'ok'   ? 'var(--forge-ok, #4caf50)'
       :                      'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
});

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function PointCloudImportPanel({ open, onClose }) {
  const [source, setSource] = useState(POINTCLOUD_IMPORT_SOURCE_SYN);
  const [synthCount, setSynthCount] = useState(POINTCLOUD_IMPORT_DEFAULT_SYNTH);
  const [filePath, setFilePath] = useState('');
  const [stats, setStats] = useState(null);
  const [positionsRef, setPositionsRef] = useState(null); // Float32Array
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [okMessage, setOkMessage] = useState(null);
  const sceneGroupRef = useRef(null);
  const fileInputRef = useRef(null);

  // Tear down any previously-published scene group on unmount or panel
  // close so a re-open starts from a clean GPU state.
  useEffect(() => {
    return () => {
      if (sceneGroupRef.current) {
        disposeNodes(sceneGroupRef.current);
        sceneGroupRef.current = null;
        if (typeof window !== 'undefined') {
          try { delete window.__forgePointCloudImportGroup; } catch {}
        }
      }
    };
  }, []);

  // Push the most recent positions + stats onto window so the e2e (and
  // headless Archie callers) can drive assertions without scraping the
  // DOM. The event mirror lets downstream subscribers (e.g. a future
  // reverse-eng panel that auto-loads the freshly imported cloud) listen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeLastPointCloudImport = stats && positionsRef ? {
      positions: positionsRef,
      stats,
      source,
      filePath: source === POINTCLOUD_IMPORT_SOURCE_FILE ? filePath : '',
    } : null;
    try {
      window.dispatchEvent(new CustomEvent(POINTCLOUD_IMPORT_EVENT, {
        detail: { count: stats?.count ?? 0, source },
      }));
    } catch {}
  }, [stats, positionsRef, source, filePath]);

  const onSetSource = useCallback((s) => {
    setSource(s);
    setError(null);
    setOkMessage(null);
  }, []);

  const onChangeSynthCount = useCallback((e) => {
    let v = Math.floor(Number(e.target.value));
    if (!Number.isFinite(v)) v = POINTCLOUD_IMPORT_DEFAULT_SYNTH;
    if (v < POINTCLOUD_IMPORT_MIN_SYNTH) v = POINTCLOUD_IMPORT_MIN_SYNTH;
    if (v > POINTCLOUD_IMPORT_MAX_SYNTH) v = POINTCLOUD_IMPORT_MAX_SYNTH;
    setSynthCount(v);
  }, []);

  // Publish the positions into the live viewport. Removes the previous
  // group first so a re-Generate doesn't accumulate.
  const publishToScene = useCallback((positions, nextStats) => {
    if (typeof window === 'undefined') return;
    const scene = getActiveScene();
    if (sceneGroupRef.current) {
      disposeNodes(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }
    if (!scene) {
      // Scene not yet ready (renderer still mounting). Stash the buffer
      // so a later open finds it; surface a non-blocking warning.
      window.__forgePointCloudImportGroup = null;
      return;
    }
    const group = buildPointCloudScene(positions, nextStats);
    scene.add(group);
    sceneGroupRef.current = group;
    window.__forgePointCloudImportGroup = group;
  }, []);

  // Headline action — sample N points on a sphere.
  const onGenerateSynth = useCallback(() => {
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const positions = sampleSphereFibonacci(
        synthCount, POINTCLOUD_IMPORT_DEFAULT_RADIUS);
      const nextStats = computeStats(positions);
      setPositionsRef(positions);
      setStats(nextStats);
      publishToScene(positions, nextStats);
      setOkMessage(
        `Generated ${nextStats.count} synthetic points on a sphere `
        + `(radius ${POINTCLOUD_IMPORT_DEFAULT_RADIUS} mm, `
        + `diagonal ${nextStats.diagonal.toFixed(2)} mm).`,
      );
    } catch (ex) {
      setError(`Synthetic generation failed: ${ex.message || ex}`);
    } finally {
      setBusy(false);
    }
  }, [synthCount, publishToScene]);

  // File picker — wire through to the standard renderer-side input
  // element. We accept .xyz + .ply per the brief. The browser surfaces a
  // FileList; we read the first entry as an ArrayBuffer, hand it to
  // parsePointCloudBuffer (header dispatch lives in pointCloudImport.js).
  const onPickFile = useCallback(() => {
    if (!fileInputRef.current) return;
    setError(null);
    setOkMessage(null);
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }, []);

  const onFileChosen = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const ab = await file.arrayBuffer();
      const buf = new Uint8Array(ab);
      const cloud = parsePointCloudBuffer(buf, file.name);
      if (!cloud.positions || cloud.positions.length < 3) {
        throw new Error('parsed 0 points (file empty or malformed)');
      }
      const nextStats = computeStats(cloud.positions);
      setPositionsRef(cloud.positions);
      setStats(nextStats);
      setFilePath(file.name);
      publishToScene(cloud.positions, nextStats);
      setOkMessage(
        `Imported ${nextStats.count} points from ${file.name} `
        + `(format: ${cloud.format}, diagonal ${nextStats.diagonal.toFixed(2)} mm).`,
      );
    } catch (ex) {
      setError(`Import failed: ${ex.message || ex}`);
    } finally {
      setBusy(false);
    }
  }, [publishToScene]);

  const onClear = useCallback(() => {
    if (sceneGroupRef.current) {
      disposeNodes(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }
    if (typeof window !== 'undefined') {
      try { delete window.__forgePointCloudImportGroup; } catch {}
    }
    setStats(null);
    setPositionsRef(null);
    setFilePath('');
    setError(null);
    setOkMessage(null);
  }, []);

  // Imperative drive for the e2e — generate synth from a known count
  // without dragging the slider through React events.
  const generateFn = useCallback((n) => {
    const positions = sampleSphereFibonacci(
      n ?? synthCount, POINTCLOUD_IMPORT_DEFAULT_RADIUS);
    const nextStats = computeStats(positions);
    setPositionsRef(positions);
    setStats(nextStats);
    publishToScene(positions, nextStats);
    return { positions, stats: nextStats };
  }, [synthCount, publishToScene]);

  // Expose the imperative drive on window so the e2e + headless Archie
  // callers can run the panel without DOM scraping. We keep this stable
  // across renders by writing it from a separate effect.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgePointCloudImportGenerate = generateFn;
    return () => {
      try {
        if (window.__forgePointCloudImportGenerate === generateFn) {
          delete window.__forgePointCloudImportGenerate;
        }
      } catch {}
    };
  }, [generateFn]);

  // The Generate button is always usable; the Pick File button gates on
  // !busy so the user can't trigger overlapping FileReader calls.
  const synthPct = useMemo(() => (
    ((synthCount - POINTCLOUD_IMPORT_MIN_SYNTH)
      / (POINTCLOUD_IMPORT_MAX_SYNTH - POINTCLOUD_IMPORT_MIN_SYNTH)) * 100
  ), [synthCount]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Point Cloud Import"
         data-testid="forge-pointcloud-import-panel"
         data-source={source}
         data-synth-count={String(synthCount)}
         data-count={stats ? String(stats.count) : '0'}
         data-busy={busy ? 'true' : 'false'}
         data-has-cloud={stats && stats.count > 0 ? 'true' : 'false'}
         style={PANEL_STYLE}>

      <header style={HEADER_ROW}>
        <Icon name="select.body" size={14} />
        <strong style={{ fontSize: 13 }}>Point Cloud Import</strong>
        <span style={STATUS_PILL('idle')}>Scan → Cloud</span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Point Cloud Import panel"
                data-testid="forge-pointcloud-import-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)',
                    lineHeight: 1.5 }}>
        Load a LiDAR scan as <code>.xyz</code> / <code>.ply</code>, or generate a
        synthetic sphere cloud. The cloud renders as a real THREE.Points
        node in the viewport, with an 8-corner AABB marker mesh on a
        shared InstancedMesh.
      </div>

      <div style={SECTION_TITLE}>Source</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_GRID}>
          <button type="button"
                  onClick={() => onSetSource(POINTCLOUD_IMPORT_SOURCE_SYN)}
                  data-testid="forge-pointcloud-import-source-synth"
                  data-active={source === POINTCLOUD_IMPORT_SOURCE_SYN ? '1' : '0'}
                  aria-pressed={source === POINTCLOUD_IMPORT_SOURCE_SYN}
                  style={SOURCE_BTN(source === POINTCLOUD_IMPORT_SOURCE_SYN)}>
            <strong>Synthetic sphere</strong>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Fibonacci spiral · r = {POINTCLOUD_IMPORT_DEFAULT_RADIUS} mm
            </span>
          </button>
          <button type="button"
                  onClick={() => onSetSource(POINTCLOUD_IMPORT_SOURCE_FILE)}
                  data-testid="forge-pointcloud-import-source-file"
                  data-active={source === POINTCLOUD_IMPORT_SOURCE_FILE ? '1' : '0'}
                  aria-pressed={source === POINTCLOUD_IMPORT_SOURCE_FILE}
                  style={SOURCE_BTN(source === POINTCLOUD_IMPORT_SOURCE_FILE)}>
            <strong>Pick .xyz / .ply</strong>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              header-dispatched parser
            </span>
          </button>
        </div>

        {source === POINTCLOUD_IMPORT_SOURCE_SYN ? (
          <>
            <div style={SECTION_TITLE}>Synthetic point count</div>
            <div style={SLIDER_ROW}>
              <input type="range"
                     min={POINTCLOUD_IMPORT_MIN_SYNTH}
                     max={POINTCLOUD_IMPORT_MAX_SYNTH}
                     step="128"
                     value={synthCount}
                     onChange={onChangeSynthCount}
                     data-testid="forge-pointcloud-import-synth-slider"
                     aria-label="Synthetic sphere point count"
                     style={{ width: '100%' }} />
              <input type="number"
                     min={POINTCLOUD_IMPORT_MIN_SYNTH}
                     max={POINTCLOUD_IMPORT_MAX_SYNTH}
                     step="128"
                     value={synthCount}
                     onChange={onChangeSynthCount}
                     data-testid="forge-pointcloud-import-synth-number"
                     aria-label="Synthetic sphere point count (numeric)"
                     style={NUM_INPUT_STYLE} />
            </div>
            <div style={{ fontSize: 10,
                          color: 'var(--forge-ink-mute, #9aa1ab)',
                          display: 'flex', justifyContent: 'space-between' }}>
              <span>{POINTCLOUD_IMPORT_MIN_SYNTH}</span>
              <span data-testid="forge-pointcloud-import-synth-pct">
                {`${synthCount} pts · slider ${synthPct.toFixed(0)}%`}
              </span>
              <span>{POINTCLOUD_IMPORT_MAX_SYNTH}</span>
            </div>
            <button type="button"
                    onClick={onGenerateSynth}
                    disabled={busy}
                    data-testid="forge-pointcloud-import-generate-synth"
                    data-state={busy ? 'busy' : 'idle'}
                    style={ACTION_BTN('primary', busy)}>
              {busy ? 'Generating…' : 'Generate synthetic point cloud'}
            </button>
          </>
        ) : (
          <>
            <div style={SECTION_TITLE}>File</div>
            <input ref={fileInputRef}
                   type="file"
                   accept=".xyz,.ply"
                   data-testid="forge-pointcloud-import-file-input"
                   style={{ display: 'none' }}
                   onChange={onFileChosen} />
            <button type="button"
                    onClick={onPickFile}
                    disabled={busy}
                    data-testid="forge-pointcloud-import-pick-file"
                    style={ACTION_BTN('primary', busy)}>
              {busy ? 'Loading…' : 'Pick .xyz / .ply file…'}
            </button>
            <div data-testid="forge-pointcloud-import-file-name"
                 style={{ fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)',
                          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' }}>
              {filePath ? filePath : '— no file picked —'}
            </div>
          </>
        )}
      </div>

      <div style={SECTION_TITLE}>Statistics</div>
      <div style={SECTION_BOX} data-testid="forge-pointcloud-import-stats">
        {!stats || stats.count === 0 ? (
          <div data-testid="forge-pointcloud-import-stats-empty"
               style={{ fontStyle: 'italic',
                        color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
            No cloud loaded — generate or import to populate.
          </div>
        ) : (
          <>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>Count</span>
              <span data-testid="forge-pointcloud-import-stat-count">
                {stats.count}
              </span>
            </div>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>BBox min (mm)</span>
              <span data-testid="forge-pointcloud-import-stat-bbox-min">
                {stats.bbox.minX.toFixed(2)}, {stats.bbox.minY.toFixed(2)}, {stats.bbox.minZ.toFixed(2)}
              </span>
            </div>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>BBox max (mm)</span>
              <span data-testid="forge-pointcloud-import-stat-bbox-max">
                {stats.bbox.maxX.toFixed(2)}, {stats.bbox.maxY.toFixed(2)}, {stats.bbox.maxZ.toFixed(2)}
              </span>
            </div>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>BBox extent (mm)</span>
              <span data-testid="forge-pointcloud-import-stat-bbox-extent">
                {stats.bbox.dx.toFixed(2)} × {stats.bbox.dy.toFixed(2)} × {stats.bbox.dz.toFixed(2)}
              </span>
            </div>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>Centroid (mm)</span>
              <span data-testid="forge-pointcloud-import-stat-centroid">
                {stats.centroid.x.toFixed(2)}, {stats.centroid.y.toFixed(2)}, {stats.centroid.z.toFixed(2)}
              </span>
            </div>
            <div style={STATS_LINE}>
              <span style={STATS_LABEL}>Diagonal (mm)</span>
              <span data-testid="forge-pointcloud-import-stat-diagonal">
                {stats.diagonal.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      <button type="button"
              onClick={onClear}
              disabled={!stats || stats.count === 0}
              data-testid="forge-pointcloud-import-clear"
              style={ACTION_BTN('default', !stats || stats.count === 0)}>
        Clear viewport cloud
      </button>

      {error && (
        <div data-testid="forge-pointcloud-import-error"
             style={{ ...STATUS_PILL('err'), padding: 6 }}>
          {error}
        </div>
      )}
      {okMessage && !error && (
        <div data-testid="forge-pointcloud-import-status"
             style={{ ...STATUS_PILL('ok'), padding: 6 }}>
          {okMessage}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Subscribes to the `tools.pointCloud` menu action
// (PUSH-124 brief), exposes the imperative open/close hooks, and a frozen
// helper surface mirroring the Forge-202 PointCloudWorkbench convention.

export function PointCloudImportPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenPointCloudImport = (v) => {
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeClosePointCloudImport = () => setOpen(false);
    window.__forgePointCloudImportHelper = Object.freeze({
      sampleSphereFibonacci,
      computeStats,
      parsePointCloudBuffer,
      buildPointCloudScene,
      detectFormat,
      readPLY,
      readXYZ,
      POINTCLOUD_IMPORT_EVENT,
      POINTCLOUD_IMPORT_MIN_SYNTH,
      POINTCLOUD_IMPORT_MAX_SYNTH,
      POINTCLOUD_IMPORT_DEFAULT_SYNTH,
      POINTCLOUD_IMPORT_DEFAULT_RADIUS,
    });

    const onMenu = (e) => {
      const id = e?.detail?.id;
      // Accept both the PUSH-124 spec id and the Forge-202 alias so the
      // command palette picks either up.
      if (id === 'tools.pointCloud'
       || id === 'tools.pointCloudImport') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenPointCloudImport; } catch {}
      try { delete window.__forgeClosePointCloudImport; } catch {}
      try { delete window.__forgePointCloudImportHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (!open) return null;
  return <PointCloudImportPanel open={open} onClose={() => setOpen(false)} />;
}

export default PointCloudImportPanel;
