// Forge-91 — FEA Result Viewer.
//
// Vertex-coloured BufferGeometry overlay for the active body, with a
// deformation amplification slider and an animation loop for modal /
// dynamic playback. Honestly named the way an engineer would expect —
// the input `result` is the raw kernel return shape, the input
// `mesh` is the kernel's tet/hex mesh with `.nodes` + `.elements`.
//
// Field options (auto-detected from `result`):
//   displacement     — sqrt(ux² + uy² + uz²)
//   vonMises         — pulled straight from result.vonMises / result.stress
//   principal        — max principal computed from stress tensor when given
//   modeShape[k]     — for modal playback, scaled by sin(2π f t) × amp
//   temperature      — result.temperature (Kelvin → °C for display)
//   fatigueLife      — result.life (cycles, log scale)
//
// The component is loader-aware: dynamically imports three so the SSR
// shell stays small. Mounts inside a Canvas the caller already provides
// (so this is a "scene fragment" — Group + Points + Mesh).

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildSliceMesh } from './sciviz/slice.js';
import { buildClipMesh } from './sciviz/clip.js';
import { buildIsosurfaceMesh } from './sciviz/isosurface.js';
import { TransferFunction } from './sciviz/colorMaps.js';
import {
  RESULT_FIELDS, unitsFor, nodalFieldFor, fieldStats, defaultIsovalue,
  sliceResult, clipResult, isoResult, probeResult, buildFieldReport,
} from './sciviz/resultFilters.js';
import {
  resultsStore, resultsManager, installResultsManagerApi,
} from './resultsManagerStore.js';
import { captureSnapshot } from '../foundation/SnapshotPng.js';

// Convert a Float64Array of nodal displacement into a per-node vec3 magnitude.
function nodeMagnitude(u, nodeCount) {
  if (!u) return null;
  const out = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const x = u[3 * i + 0], y = u[3 * i + 1], z = u[3 * i + 2];
    out[i] = Math.sqrt(x * x + y * y + z * z);
  }
  return out;
}

// 'jet' colormap (Matlab default). Returns [r, g, b] in [0,1].
function jet(t) {
  const x = Math.max(0, Math.min(1, t));
  // Piecewise linear; matches `jet` to within ~2 %.
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [r, g, b];
}

// 'turbo' colormap (Mikko Mononen's). More perceptually uniform than jet.
function turbo(t) {
  const x = Math.max(0, Math.min(1, t));
  const r = 0.13572138 + 4.61539260 * x - 42.66032258 * x * x + 132.13108234 * x * x * x
          - 152.94239396 * Math.pow(x, 4) + 59.28637943 * Math.pow(x, 5);
  const g = 0.09140261 + 2.19418839 * x + 4.84296658 * x * x - 14.18503333 * x * x * x
          + 4.27729857 * Math.pow(x, 4) + 2.82956604 * Math.pow(x, 5);
  const b = 0.10667330 + 12.64194608 * x - 60.58204836 * x * x + 110.36276771 * x * x * x
          - 89.90310912 * Math.pow(x, 4) + 27.34824973 * Math.pow(x, 5);
  return [Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b))];
}

const COLORMAPS = { jet, turbo };

/** Convert a nodal scalar field + element list to a tri-faceted BufferGeometry. */
function buildBufferGeometry(THREE, mesh, scalarField, dispField, amp) {
  if (!mesh || !mesh.nodes || !mesh.elements) return null;
  const { nodes, elements, nodeCount, elemNodeCount = 4 } = mesh;
  if (!scalarField) return null;

  // Find scalar bounds.
  let smin = Infinity, smax = -Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const v = scalarField[i];
    if (v < smin) smin = v;
    if (v > smax) smax = v;
  }
  if (!Number.isFinite(smin) || !Number.isFinite(smax) || smin === smax) {
    smin = 0; smax = 1;
  }

  // Build deformed node positions in mm (kernel uses metres).
  const M = 1000; // metres → mm for the viewport
  const deformed = new Float32Array(nodeCount * 3);
  for (let i = 0; i < nodeCount; i++) {
    const xb = nodes[3 * i + 0] * M;
    const yb = nodes[3 * i + 1] * M;
    const zb = nodes[3 * i + 2] * M;
    if (dispField && amp > 0) {
      deformed[3 * i + 0] = xb + dispField[3 * i + 0] * M * amp;
      deformed[3 * i + 1] = yb + dispField[3 * i + 1] * M * amp;
      deformed[3 * i + 2] = zb + dispField[3 * i + 2] * M * amp;
    } else {
      deformed[3 * i + 0] = xb;
      deformed[3 * i + 1] = yb;
      deformed[3 * i + 2] = zb;
    }
  }

  // Tet face table (4 triangles per tet). Hex face table (12 triangles per hex).
  const TET_FACES = [[0,2,1],[0,1,3],[1,2,3],[0,3,2]];
  const HEX_FACES = [
    [0,1,2],[0,2,3], [4,6,5],[4,7,6],
    [0,4,5],[0,5,1], [1,5,6],[1,6,2],
    [2,6,7],[2,7,3], [3,7,4],[3,4,0],
  ];

  const isHex = elemNodeCount === 8;
  const FACES = isHex ? HEX_FACES : TET_FACES;
  const elemCount = elements.length / elemNodeCount;
  const tris = elemCount * FACES.length;

  const positions = new Float32Array(tris * 9);
  const colors    = new Float32Array(tris * 9);
  const normals   = new Float32Array(tris * 9);
  const cmap = COLORMAPS.turbo;

  let p = 0, c = 0;
  for (let e = 0; e < elemCount; e++) {
    const base = e * elemNodeCount;
    for (const tri of FACES) {
      const ia = elements[base + tri[0]];
      const ib = elements[base + tri[1]];
      const ic = elements[base + tri[2]];
      // positions
      const ax = deformed[3*ia], ay = deformed[3*ia+1], az = deformed[3*ia+2];
      const bx = deformed[3*ib], by = deformed[3*ib+1], bz = deformed[3*ib+2];
      const cx = deformed[3*ic], cy = deformed[3*ic+1], cz = deformed[3*ic+2];
      positions[p+0] = ax; positions[p+1] = ay; positions[p+2] = az;
      positions[p+3] = bx; positions[p+4] = by; positions[p+5] = bz;
      positions[p+6] = cx; positions[p+7] = cy; positions[p+8] = cz;
      // normal (flat)
      const ux = bx-ax, uy = by-ay, uz = bz-az;
      const vx = cx-ax, vy = cy-ay, vz = cz-az;
      let nx = uy*vz - uz*vy;
      let ny = uz*vx - ux*vz;
      let nz = ux*vy - uy*vx;
      const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      for (let k = 0; k < 3; k++) {
        normals[p + k*3 + 0] = nx;
        normals[p + k*3 + 1] = ny;
        normals[p + k*3 + 2] = nz;
      }
      // colours
      const ta = (scalarField[ia] - smin) / (smax - smin);
      const tb = (scalarField[ib] - smin) / (smax - smin);
      const tc = (scalarField[ic] - smin) / (smax - smin);
      const ca = cmap(ta), cb = cmap(tb), cc = cmap(tc);
      colors[c+0]=ca[0]; colors[c+1]=ca[1]; colors[c+2]=ca[2];
      colors[c+3]=cb[0]; colors[c+4]=cb[1]; colors[c+5]=cb[2];
      colors[c+6]=cc[0]; colors[c+7]=cc[1]; colors[c+8]=cc[2];
      p += 9; c += 9;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  g.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  g._smin = smin;
  g._smax = smax;
  // Stash the deformed node lattice (mm) + the displayed scalar so the
  // click-to-probe raycast can resolve a hit point to its nearest node.
  g._nodePos = deformed;
  g._nodeScalar = scalarField;
  g._nodeCount = nodeCount;
  return g;
}

// World-space (metres) axis-aligned bounds of the FE node lattice.
function meshBounds(mesh) {
  const n = mesh.nodeCount ?? (mesh.nodes ? mesh.nodes.length / 3 : 0);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.nodes[3 * i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [1, 1, 1] };
  return { min, max };
}

// Build a (point, normal) axis-aligned plane in metres from the store's
// axis + normalised position over the bounding box.
function planeFromStore(mesh, axis, position01) {
  const bb = meshBounds(mesh);
  const ai = { x: 0, y: 1, z: 2 }[axis] ?? 0;
  const normal = [0, 0, 0]; normal[ai] = 1;
  const point = [
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  ];
  point[ai] = bb.min[ai] + position01 * (bb.max[ai] - bb.min[ai]);
  return { point, normal };
}

/** Pick the scalar field for the active result tab. */
function pickScalarField(result, mesh, tab, modeIndex, time) {
  if (!result || !mesh) return { scalar: null, disp: null };
  switch (tab) {
    case 'Displacement': {
      const disp = result.u || result.displacement || null;
      const scalar = disp ? nodeMagnitude(disp, mesh.nodeCount) : null;
      return { scalar, disp };
    }
    case 'vonMises': {
      const disp = result.u || result.displacement || null;
      const scalar = result.vonMises || result.stress || null;
      return { scalar, disp };
    }
    case 'Principal': {
      // Compute max principal from full stress tensor [σxx σyy σzz τxy τyz τzx]
      const t = result.stressTensor;
      if (!t) {
        return { scalar: result.vonMises || null, disp: result.u || null };
      }
      const out = new Float32Array(mesh.nodeCount);
      for (let i = 0; i < mesh.nodeCount; i++) {
        const sxx = t[6*i], syy = t[6*i+1], szz = t[6*i+2];
        const txy = t[6*i+3], tyz = t[6*i+4], tzx = t[6*i+5];
        const I1 = sxx + syy + szz;
        const I2 = sxx*syy + syy*szz + szz*sxx - txy*txy - tyz*tyz - tzx*tzx;
        const I3 = sxx*syy*szz + 2*txy*tyz*tzx - sxx*tyz*tyz - syy*tzx*tzx - szz*txy*txy;
        // Cardano's principal-stress invariants → max root
        const p = I1 / 3;
        const q = p*p - I2/3;
        const r = (2*p*p*p - p*I2 + I3) / 2;
        const denom = Math.pow(Math.max(0, q), 1.5) || 1;
        const phi = Math.acos(Math.max(-1, Math.min(1, r / denom))) / 3;
        const s1 = p + 2 * Math.sqrt(Math.max(0, q)) * Math.cos(phi);
        out[i] = s1;
      }
      return { scalar: out, disp: result.u };
    }
    case 'Modes': {
      // Mode shapes: result.modes[k].shape (Float64Array, 3*nodeCount).
      // Animate by ±sin(2π f t).
      const modes = result.modes || (result.eigenvectors
        ? result.eigenvectors.map((shape, k) => ({
            freq: Math.sqrt(Math.max(0, result.eigenvalues[k])) / (2*Math.PI),
            shape,
          }))
        : null);
      if (!modes || !modes[modeIndex]) return { scalar: null, disp: null };
      const m = modes[modeIndex];
      const phase = Math.sin(2 * Math.PI * (m.freq || 1) * time);
      const disp = new Float64Array(3 * mesh.nodeCount);
      for (let i = 0; i < 3 * mesh.nodeCount; i++) disp[i] = m.shape[i] * phase;
      const scalar = nodeMagnitude(disp, mesh.nodeCount);
      return { scalar, disp };
    }
    case 'Temperature': {
      // Temperature comes back from solveThermal as Kelvin. Display °C.
      const T = result.temperature;
      if (!T) return { scalar: null, disp: null };
      const C = new Float32Array(mesh.nodeCount);
      for (let i = 0; i < mesh.nodeCount; i++) C[i] = T[i] - 273.15;
      return { scalar: C, disp: null };
    }
    case 'Fatigue Life': {
      const life = result.life;
      if (!life) return { scalar: null, disp: null };
      // Log scale — life is typically 10² to 10⁸ cycles.
      const out = new Float32Array(mesh.nodeCount);
      for (let i = 0; i < mesh.nodeCount; i++) {
        out[i] = Math.log10(Math.max(1, life[i] || 1));
      }
      return { scalar: out, disp: null };
    }
    default:
      return { scalar: null, disp: null };
  }
}

/**
 * Headless component: returns a <group> with a mesh whose vertex colours
 * encode the chosen scalar. Designed to live INSIDE an existing Canvas;
 * the parent supplies camera + lights + grid.
 *
 * Props:
 *   THREE        — the three module the parent loaded
 *   result       — kernel solver return shape
 *   mesh         — kernel mesh { nodes, elements, nodeCount, elemCount, elemNodeCount? }
 *   resultTab    — 'Displacement' | 'vonMises' | 'Principal' | 'Modes' | 'Temperature' | 'Fatigue Life'
 *   amp          — deformation amplification factor (0..100)
 *   playing      — boolean, drives animation
 *   modeIndex    — for Modes tab
 *   onLegend     — callback({min, max, units}) — keeps legend in sync
 */
export function FeaResultScene({ THREE, result, mesh, resultTab, amp = 1,
                                 playing = false, modeIndex = 0, onLegend = null,
                                 onProbe = null, dim = false }) {
  const meshRef = useRef();
  const geomRef = useRef(null);
  const [time, setTime] = useState(0);

  // Animation loop (modal / dynamic playback).
  useEffect(() => {
    if (!playing) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => (t + dt) % 1e6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Rebuild the BufferGeometry whenever inputs change.
  const buffer = useMemo(() => {
    if (!THREE) return null;
    const { scalar, disp } = pickScalarField(result, mesh, resultTab, modeIndex, time);
    if (!scalar) return null;
    const g = buildBufferGeometry(THREE, mesh, scalar, disp, amp);
    if (g && onLegend) {
      const units = unitsForTab(resultTab);
      onLegend({ min: g._smin, max: g._smax, units, tab: resultTab });
    }
    return g;
  }, [THREE, result, mesh, resultTab, amp, modeIndex, time, onLegend]);

  // Dispose of old geometry to avoid GPU leaks.
  useEffect(() => {
    const prev = geomRef.current;
    geomRef.current = buffer;
    if (prev && prev !== buffer && typeof prev.dispose === 'function') prev.dispose();
  }, [buffer]);

  // Click-to-probe: raycast hit point (mm) → nearest node → readout. The hit
  // is in scene units (mm); probeResult finds the nearest stashed node.
  const handleProbe = (e) => {
    if (!onProbe || !buffer || !buffer._nodePos) return;
    e.stopPropagation();
    const p = e.point; // THREE.Vector3 in scene mm
    const probe = probeResult(
      mesh, buffer._nodeScalar, [p.x, p.y, p.z],
      { nodes: buffer._nodePos, nodeCount: buffer._nodeCount },
    );
    if (probe.nodeId < 0) return;
    onProbe({
      nodeId: probe.nodeId,
      value: probe.value,
      // position back to metres for an SI-clean report
      position: probe.position ? probe.position.map((v) => v / 1000) : null,
      field: resultTab,
      units: unitsForTab(resultTab),
      at: Date.now(),
    });
  };

  if (!buffer) return null;
  return (
    <mesh ref={meshRef} geometry={buffer} castShadow receiveShadow
          onClick={handleProbe}>
      <meshStandardMaterial vertexColors flatShading metalness={0.05} roughness={0.65}
                            transparent={dim} opacity={dim ? 0.18 : 1}
                            depthWrite={!dim} />
    </mesh>
  );
}

// ── Sci-viz result overlay (ParaView Slice / Clip / Contour) ───────────────
// REUSES sciviz/slice|clip|isosurface + resultFilters; renders the active
// filter over the FE result field. Built in metres, scaled ×1000 to the mm
// viewport so it registers with the deformed base mesh.
export function SciVizResultOverlay({ THREE, mesh, field, range, rstate }) {
  const group = useMemo(() => {
    if (!THREE || !mesh || !field || rstate.mode === 'none') return null;
    const [lo, hi] = range && range[1] > range[0] ? range : [0, 1];
    const tf = new TransferFunction({ preset: rstate.preset, range: [lo, hi] });
    const g = new THREE.Group();
    g.name = 'sciviz-result-overlay';
    try {
      if (rstate.mode === 'slice') {
        const pl = planeFromStore(mesh, rstate.axis, rstate.position01);
        g.add(buildSliceMesh(THREE, sliceResult(mesh, field, pl), tf, { opacity: rstate.opacity }));
      } else if (rstate.mode === 'clip') {
        const pl = planeFromStore(mesh, rstate.axis, rstate.position01);
        const spec = { type: 'plane', plane: pl, invert: rstate.invert };
        g.add(buildClipMesh(THREE, clipResult(mesh, field, spec), tf, { opacity: rstate.opacity }));
      } else if (rstate.mode === 'iso') {
        const isov = rstate.isovalue != null ? rstate.isovalue : defaultIsovalue(field);
        g.add(buildIsosurfaceMesh(THREE, isoResult(mesh, field, isov), tf, { opacity: rstate.opacity }));
      }
    } catch (err) {
      console.warn('[forge.v4.SciVizResultOverlay]', err && err.message);
      return null;
    }
    g.scale.setScalar(1000);
    return g;
  }, [THREE, mesh, field, range, rstate.mode, rstate.axis, rstate.position01,
      rstate.invert, rstate.isovalue, rstate.opacity, rstate.preset]);

  // dispose previous group's geometries on swap
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = group;
    if (prev && prev !== group) {
      prev.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
  }, [group]);

  if (!group) return null;
  return <primitive object={group} />;
}

// Small markers at probed nodes (mm = metres × 1000).
function ProbeMarkers({ probes }) {
  if (!probes || !probes.length) return null;
  return (
    <group name="forge-probe-markers">
      {probes.map((p, i) => p.position && (
        <mesh key={`${p.nodeId}-${i}`} position={p.position.map((v) => v * 1000)}>
          <sphereGeometry args={[1.4, 12, 12]} />
          <meshBasicMaterial color="#f0f3f8" />
        </mesh>
      ))}
    </group>
  );
}

function unitsForTab(tab) {
  switch (tab) {
    case 'Displacement': return 'm';
    case 'vonMises':
    case 'Principal':    return 'Pa';
    case 'Modes':        return 'mode shape';
    case 'Temperature':  return '°C';
    case 'Fatigue Life': return 'log₁₀ cycles';
    default: return '';
  }
}

/** Floating legend strip — DOM, not WebGL, so it stays sharp on retina. */
export function FeaResultLegend({ legend }) {
  if (!legend) return null;
  const stops = 12;
  const ramp = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const [r, g, b] = turbo(t);
    ramp.push(`rgb(${(r*255)|0},${(g*255)|0},${(b*255)|0}) ${Math.round(t*100)}%`);
  }
  const gradient = `linear-gradient(to top, ${ramp.join(', ')})`;
  const fmt = (v) => {
    if (Math.abs(v) >= 1e6) return v.toExponential(2);
    if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2);
    return v.toFixed(3);
  };
  return (
    <div className="forge-fea-legend"
         data-testid="forge-fea-legend"
         style={{
           position: 'absolute', right: 12, top: 80,
           width: 28, height: 220,
           background: gradient,
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 3,
           boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
         }}>
      <div style={{
        position: 'absolute', left: 36, top: -2,
        fontSize: 10, fontFamily: 'var(--forge-mono)',
        color: 'var(--forge-ink-2)', whiteSpace: 'nowrap',
      }}>{fmt(legend.max)} {legend.units}</div>
      <div style={{
        position: 'absolute', left: 36, bottom: -2,
        fontSize: 10, fontFamily: 'var(--forge-mono)',
        color: 'var(--forge-ink-2)', whiteSpace: 'nowrap',
      }}>{fmt(legend.min)}</div>
      <div style={{
        position: 'absolute', left: 36, top: '50%',
        transform: 'translateY(-50%)',
        fontSize: 9, fontFamily: 'var(--forge-mono)',
        color: 'var(--forge-ink-mute)', textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>{legend.tab}</div>
    </div>
  );
}

/**
 * Self-contained viewer: a <Canvas> that loads three + r3f + drei,
 * mounts the FeaResultScene, OrbitControls, and the legend. Used from
 * the Simulation workbench's results pane.
 */
export function FeaResultViewer({ result, mesh, resultTab = 'Displacement',
                                  initialAmp = 1, playing = false,
                                  modeIndex = 0 }) {
  const [bundle, setBundle] = useState(null);
  const [amp, setAmp] = useState(initialAmp);
  const [tab, setTab] = useState(resultTab);
  const [play, setPlay] = useState(playing);
  const [legend, setLegend] = useState(null);
  const [mIdx, setMIdx] = useState(modeIndex);
  const [exportStatus, setExportStatus] = useState(null);

  // Results-manager state lives in the external event-reducer store so the
  // window/CUA `sim.results.*` setters never call a React setState.
  const rstate = useSyncExternalStore(resultsStore.subscribe, resultsStore.getState, resultsStore.getState);
  useEffect(() => { installResultsManagerApi(); }, []);

  // r3f renderer/scene/camera handle for the report PNG (reuses captureSnapshot).
  const glRef = useRef(null);

  useEffect(() => { setTab(resultTab); }, [resultTab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r3f, drei, three] = await Promise.all([
          import('@react-three/fiber'),
          import('@react-three/drei'),
          import('three'),
        ]);
        if (!cancelled) setBundle({ r3f, drei, three });
      } catch (err) {
        console.warn('[forge.v4.FeaResultViewer] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const numModes = (result && result.modes) ? result.modes.length
                 : (result && result.eigenvalues) ? result.eigenvalues.length
                 : 0;

  // The sci-viz field the results-manager cuts / clips / isos / probes over.
  const scivizField = useMemo(
    () => nodalFieldFor(result, mesh, rstate.field),
    [result, mesh, rstate.field],
  );
  const scivizStats = useMemo(
    () => (scivizField ? fieldStats(scivizField) : null),
    [scivizField],
  );
  const scivizRange = scivizStats ? [scivizStats.min, scivizStats.max] : [0, 1];

  // A probe is computed in the scene (raycast) → published to the store.
  const onProbe = (probe) => { resultsManager.addProbe(probe); };

  // Report export — REUSES SnapshotPng.captureSnapshot for the PNG + assembles
  // the numeric summary via resultFilters.buildFieldReport, then downloads JSON.
  const exportReport = () => {
    try {
      const report = buildFieldReport({
        fieldKey: rstate.field,
        field: scivizField,
        probes: rstate.probes,
        filter: {
          mode: rstate.mode, axis: rstate.axis, position01: rstate.position01,
          isovalue: rstate.isovalue, invert: rstate.invert,
        },
      });
      // PNG via the existing snapshot util (no new renderer).
      let png = { ok: false };
      if (glRef.current) {
        png = captureSnapshot({
          viewport: glRef.current,
          multiplier: 2,
          filename: `fea-result-${rstate.field}-${Date.now()}.png`,
          download: true,
        });
      }
      report.png = png.ok ? { filename: png.filename, bytes: png.bytes, width: png.width, height: png.height } : { ok: false };
      // numeric summary JSON download
      if (typeof document !== 'undefined') {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `fea-result-${rstate.field}-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setExportStatus({
        ok: true,
        field: rstate.field,
        min: report.stats.min, max: report.stats.max, mean: report.stats.mean,
        probes: report.probeCount, png: png.ok,
      });
    } catch (err) {
      setExportStatus({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  };

  if (!bundle) {
    return (
      <div data-testid="forge-fea-result-viewer"
           style={{ position: 'relative', width: '100%', height: '100%',
                    background: 'var(--forge-canvas)' }}>
        <div style={{ position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)',
                      fontSize: 11 }}>
          loading result viewer…
        </div>
      </div>
    );
  }
  const { Canvas } = bundle.r3f;
  const { OrbitControls, Grid } = bundle.drei;
  const THREE = bundle.three;

  return (
    <div data-testid="forge-fea-result-viewer"
         style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [120, 90, 120], fov: 45, near: 0.1, far: 5000 }}
              gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
              onCreated={({ gl, scene, camera }) => { glRef.current = { renderer: gl, scene, camera }; }}
              data-testid="forge-fea-canvas">
        <color attach="background" args={['#0a0b0e']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[40, 60, 30]} intensity={0.9} />
        <directionalLight position={[-30, -20, -40]} intensity={0.2} />
        <Grid args={[200, 200]} cellColor="#2a2f3d" sectionColor="#3a4253"
              sectionSize={10} position={[0, -5, 0]}
              fadeDistance={140} fadeStrength={1.4} infiniteGrid />
        <FeaResultScene THREE={THREE} result={result} mesh={mesh}
                        resultTab={tab} amp={amp} playing={play}
                        modeIndex={mIdx}
                        onLegend={setLegend}
                        onProbe={onProbe}
                        dim={rstate.mode === 'slice' || rstate.mode === 'clip' ? rstate.dimBase : false} />
        <SciVizResultOverlay THREE={THREE} mesh={mesh} field={scivizField}
                             range={scivizRange} rstate={rstate} />
        <ProbeMarkers probes={rstate.probes} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                       minDistance={5} maxDistance={500} />
      </Canvas>
      <FeaResultLegend legend={legend} />
      <ResultViewerControls amp={amp} setAmp={setAmp}
                            tab={tab} setTab={setTab}
                            play={play} setPlay={setPlay}
                            modeIndex={mIdx} setModeIndex={setMIdx}
                            numModes={numModes} />
      <ResultsManagerControls rstate={rstate} mgr={resultsManager}
                              stats={scivizStats}
                              fieldAvailable={!!scivizField}
                              onExport={exportReport}
                              exportStatus={exportStatus} />
      <ProbeHud probes={rstate.probes} onClear={() => resultsManager.clearProbes()} />
    </div>
  );
}

// ── Results-manager control panel (cut / clip / iso + field + report) ──────
function ResultsManagerControls({ rstate, mgr, stats, fieldAvailable, onExport, exportStatus }) {
  const MODES = [['none', 'Off'], ['slice', 'Cut'], ['clip', 'Clip'], ['iso', 'Iso']];
  const isoDefault = stats ? stats.mean : 0;
  const isoVal = rstate.isovalue != null ? rstate.isovalue : isoDefault;
  const fmt = (v) => (v == null ? '—'
    : (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0)) ? v.toExponential(2) : v.toFixed(3));
  return (
    <div className="forge-fea-resultsmgr"
         data-testid="forge-fea-resultsmgr"
         data-mode={rstate.mode}
         style={{
           position: 'absolute', right: 12, bottom: 12,
           display: 'flex', flexDirection: 'column', gap: 6,
           background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
           border: '1px solid var(--forge-rail-edge)', borderRadius: 4,
           padding: 8, minWidth: 250, fontSize: 10, color: 'var(--forge-ink-mute)',
         }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'var(--forge-ink-2)' }}>sci-viz results manager</div>
      {/* filter mode */}
      <div style={{ display: 'flex', gap: 4 }}>
        {MODES.map(([m, lbl]) => (
          <button key={m} type="button"
                  data-resultsmgr-mode={m}
                  data-active={String(rstate.mode === m)}
                  onClick={() => mgr.setMode(m)}
                  style={miniBtn(rstate.mode === m)}>{lbl}</button>
        ))}
      </div>
      {/* field selector */}
      <label style={rowStyle}>
        <span style={lblStyle}>Field</span>
        <select className="forge-tool-input"
                data-testid="forge-resultsmgr-field"
                value={rstate.field}
                onChange={(e) => mgr.setField(e.target.value)}
                style={{ flex: 1, fontSize: 10 }}>
          {RESULT_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      {!fieldAvailable && (
        <div style={{ color: 'var(--forge-warn)' }}>field "{rstate.field}" not in result</div>
      )}
      {(rstate.mode === 'slice' || rstate.mode === 'clip') && (
        <>
          <label style={rowStyle}>
            <span style={lblStyle}>Axis</span>
            {['x', 'y', 'z'].map((a) => (
              <button key={a} type="button"
                      data-resultsmgr-axis={a}
                      data-active={String(rstate.axis === a)}
                      onClick={() => mgr.setAxis(a)}
                      style={miniBtn(rstate.axis === a)}>{a.toUpperCase()}</button>
            ))}
          </label>
          <label style={rowStyle}>
            <span style={lblStyle}>Pos {rstate.position01.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.01}
                   data-testid="forge-resultsmgr-pos"
                   value={rstate.position01}
                   onChange={(e) => mgr.setPosition(parseFloat(e.target.value))}
                   style={{ flex: 1 }} />
          </label>
          {rstate.mode === 'clip' && (
            <button type="button"
                    data-testid="forge-resultsmgr-invert"
                    data-active={String(rstate.invert)}
                    onClick={() => mgr.setInvert(!rstate.invert)}
                    style={miniBtn(rstate.invert)}>invert half-space</button>
          )}
        </>
      )}
      {rstate.mode === 'iso' && (
        <label style={rowStyle}>
          <span style={lblStyle}>Iso {fmt(isoVal)}</span>
          <input type="range"
                 min={stats ? stats.min : 0} max={stats ? stats.max : 1}
                 step={stats ? Math.max((stats.max - stats.min) / 100, 1e-9) : 0.01}
                 data-testid="forge-resultsmgr-iso"
                 value={isoVal}
                 onChange={(e) => mgr.setIsovalue(parseFloat(e.target.value))}
                 style={{ flex: 1 }} />
        </label>
      )}
      {rstate.mode === 'iso' && (
        <button type="button" onClick={() => mgr.setIsovalue(null)}
                style={miniBtn(rstate.isovalue == null)}>σ_mean default</button>
      )}
      {/* field stats */}
      {stats && (
        <div style={{ fontFamily: 'var(--forge-mono)', fontSize: 9,
                      color: 'var(--forge-ink-2)' }}>
          min {fmt(stats.min)} · mean {fmt(stats.mean)} · max {fmt(stats.max)} {unitsFor(rstate.field)}
        </div>
      )}
      <button type="button"
              data-testid="forge-resultsmgr-export"
              onClick={onExport}
              className="forge-tool-dock-btn"
              data-kind="confirm"
              style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
        Export report (PNG + summary)
      </button>
      {exportStatus && (
        <div data-testid="forge-resultsmgr-export-status"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 9,
                      color: exportStatus.ok ? 'var(--forge-ok)' : 'var(--forge-err)' }}>
          {exportStatus.ok
            ? `report: ${exportStatus.field} min/mean/max ${fmt(exportStatus.min)}/${fmt(exportStatus.mean)}/${fmt(exportStatus.max)} · ${exportStatus.probes} probes · png ${exportStatus.png ? '✓' : '✗'}`
            : `export failed: ${exportStatus.error}`}
        </div>
      )}
    </div>
  );
}

// ── Probe readout HUD ──────────────────────────────────────────────────────
function ProbeHud({ probes, onClear }) {
  if (!probes || !probes.length) return null;
  const last = probes[probes.length - 1];
  const fmt = (v) => (v == null ? '—'
    : (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0)) ? v.toExponential(3) : v.toFixed(4));
  return (
    <div className="forge-fea-probe-hud"
         data-testid="forge-fea-probe-hud"
         style={{
           position: 'absolute', left: 12, bottom: 12,
           background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
           border: '1px solid var(--forge-rail-edge)', borderRadius: 4,
           padding: 8, minWidth: 200, fontSize: 10,
           fontFamily: 'var(--forge-mono)', color: 'var(--forge-ink-2)',
         }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    color: 'var(--forge-ink-mute)', textTransform: 'uppercase',
                    letterSpacing: '0.06em', marginBottom: 4 }}>
        <span>probe · node #{last.nodeId}</span>
        <button type="button" onClick={onClear}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         fontSize: 10 }}>clear</button>
      </div>
      <div data-testid="forge-fea-probe-value">
        {last.field}: <strong style={{ color: 'var(--forge-ink)' }}>{fmt(last.value)}</strong> {last.units}
      </div>
      {last.position && (
        <div style={{ color: 'var(--forge-ink-mute)' }}>
          @ [{last.position.map((v) => v.toFixed(4)).join(', ')}] m
        </div>
      )}
      {probes.length > 1 && (
        <div style={{ color: 'var(--forge-ink-mute)', marginTop: 2 }}>
          {probes.length} probes recorded
        </div>
      )}
    </div>
  );
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 6 };
const lblStyle = { minWidth: 64, textTransform: 'uppercase', letterSpacing: '0.05em' };
function miniBtn(active) {
  return {
    background: active ? 'var(--forge-accent-mute)' : 'transparent',
    color: 'var(--forge-ink)',
    border: active ? '1px solid var(--forge-accent-rim)' : '1px solid var(--forge-rail-edge)',
    borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer',
  };
}

function ResultViewerControls({ amp, setAmp, tab, setTab,
                                play, setPlay, modeIndex, setModeIndex, numModes }) {
  const TABS = ['Displacement', 'vonMises', 'Principal',
                'Modes', 'Temperature', 'Fatigue Life'];
  return (
    <div className="forge-fea-controls"
         data-testid="forge-fea-controls"
         style={{
           position: 'absolute', left: 12, top: 12,
           display: 'flex', flexDirection: 'column', gap: 6,
           background: 'rgba(0,0,0,0.55)',
           backdropFilter: 'blur(4px)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 4, padding: 8, minWidth: 240,
         }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {TABS.map((t) => (
          <button key={t} type="button"
                  data-fea-result-tab={t}
                  data-active={String(tab === t)}
                  onClick={() => setTab(t)}
                  style={{
                    background: tab === t ? 'var(--forge-accent-mute)' : 'transparent',
                    color: 'var(--forge-ink)',
                    border: tab === t ? '1px solid var(--forge-accent-rim)'
                                       : '1px solid var(--forge-rail-edge)',
                    borderRadius: 3, padding: '3px 8px',
                    fontSize: 11, cursor: 'pointer',
                  }}>{t}</button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                       fontSize: 10, color: 'var(--forge-ink-mute)' }}>
        <span style={{ minWidth: 90, textTransform: 'uppercase',
                       letterSpacing: '0.06em' }}>Deform × {amp.toFixed(1)}</span>
        <input type="range" min={0} max={100} step={0.5}
               value={amp}
               data-testid="forge-fea-deform-slider"
               onChange={(e) => setAmp(parseFloat(e.target.value))}
               style={{ flex: 1 }} />
      </label>
      {tab === 'Modes' && numModes > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                         fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          <span style={{ minWidth: 90, textTransform: 'uppercase',
                         letterSpacing: '0.06em' }}>Mode {modeIndex + 1}/{numModes}</span>
          <input type="range" min={0} max={numModes - 1} step={1}
                 value={modeIndex}
                 onChange={(e) => setModeIndex(parseInt(e.target.value, 10))}
                 style={{ flex: 1 }} />
        </label>
      )}
      <button type="button"
              data-testid="forge-fea-play-toggle"
              data-active={String(play)}
              onClick={() => setPlay((v) => !v)}
              style={{
                background: play ? 'var(--forge-accent-mute)' : 'transparent',
                color: 'var(--forge-ink)',
                border: '1px solid var(--forge-rail-edge)',
                borderRadius: 3, padding: '4px 10px',
                fontSize: 11, cursor: 'pointer',
              }}>{play ? '■ Stop' : '▶ Play animation'}</button>
    </div>
  );
}

export default FeaResultViewer;
