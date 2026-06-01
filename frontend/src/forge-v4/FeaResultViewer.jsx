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

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  return g;
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
                                 playing = false, modeIndex = 0, onLegend = null }) {
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

  if (!buffer) return null;
  return (
    <mesh ref={meshRef} geometry={buffer} castShadow receiveShadow>
      <meshStandardMaterial vertexColors flatShading metalness={0.05} roughness={0.65} />
    </mesh>
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
              gl={{ antialias: true, alpha: false }}
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
                        onLegend={setLegend} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                       minDistance={5} maxDistance={500} />
      </Canvas>
      <FeaResultLegend legend={legend} />
      <ResultViewerControls amp={amp} setAmp={setAmp}
                            tab={tab} setTab={setTab}
                            play={play} setPlay={setPlay}
                            modeIndex={mIdx} setModeIndex={setMIdx}
                            numModes={numModes} />
    </div>
  );
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
