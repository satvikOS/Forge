// Forge-132 — Topology result viewer.
//
// Renders the SIMP density field as a three.js mesh with grey-scale
// vertex colours and a threshold slider that hides elements with
// ρ_e < threshold so the engineer sees the optimised shape.
//
// Strict parity with FeaResultViewer's conventions:
//   - dynamic-imports three + r3f so SSR stays lean
//   - one BufferGeometry rebuilt on every threshold change
//   - opaque dark canvas + monochrome lighting + infinite grid
//   - DOM controls live in a glass-blurred floating chip top-left
//
// Inputs:
//   mesh    — { nodes, elements, nodeCount, elemCount, elemNodeCount }
//   density — Float64Array (or regular array) of length elemCount, ∈ [0,1]
//   onClose — optional teardown callback for the host

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Tet face table + hex face table (matches FeaResultViewer).
const TET_FACES = [[0,2,1],[0,1,3],[1,2,3],[0,3,2]];
const HEX_FACES = [
  [0,1,2],[0,2,3], [4,6,5],[4,7,6],
  [0,4,5],[0,5,1], [1,5,6],[1,6,2],
  [2,6,7],[2,7,3], [3,7,4],[3,4,0],
];

function buildDensityGeometry(THREE, mesh, density, threshold) {
  if (!mesh || !mesh.nodes || !mesh.elements) return null;
  if (!density) return null;
  const { nodes, elements } = mesh;
  const enc = mesh.elemNodeCount || 4;
  const ne  = mesh.elemCount || (elements.length / enc);
  const isHex = enc === 8;
  const FACES = isHex ? HEX_FACES : TET_FACES;

  // Count elements above threshold (so we size buffers correctly).
  let kept = 0;
  for (let e = 0; e < ne; e++) if (density[e] >= threshold) kept++;
  if (kept === 0) return null;

  const tris = kept * FACES.length;
  const positions = new Float32Array(tris * 9);
  const colors    = new Float32Array(tris * 9);
  const normals   = new Float32Array(tris * 9);

  const M = 1000;        // metres → mm so the viewport scale matches Forge
  let p = 0, c = 0;
  for (let e = 0; e < ne; e++) {
    const rho = density[e];
    if (rho < threshold) continue;
    const base = e * enc;
    // grey-scale: ρ=0 → black, ρ=1 → white. Apply a gentle gamma so the
    // mid-densities don't all collapse to washed-out grey.
    const grey = Math.pow(Math.max(0, Math.min(1, rho)), 0.65);
    for (const tri of FACES) {
      const ia = elements[base + tri[0]];
      const ib = elements[base + tri[1]];
      const ic = elements[base + tri[2]];
      const ax = nodes[3*ia]   * M, ay = nodes[3*ia+1] * M, az = nodes[3*ia+2] * M;
      const bx = nodes[3*ib]   * M, by = nodes[3*ib+1] * M, bz = nodes[3*ib+2] * M;
      const cx = nodes[3*ic]   * M, cy = nodes[3*ic+1] * M, cz = nodes[3*ic+2] * M;
      positions[p+0] = ax; positions[p+1] = ay; positions[p+2] = az;
      positions[p+3] = bx; positions[p+4] = by; positions[p+5] = bz;
      positions[p+6] = cx; positions[p+7] = cy; positions[p+8] = cz;
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
        colors[c + k*3 + 0]  = grey;
        colors[c + k*3 + 1]  = grey;
        colors[c + k*3 + 2]  = grey;
      }
      p += 9; c += 9;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  g.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  g._kept = kept;
  g._total = ne;
  return g;
}

export function TopologyResultScene({ THREE, mesh, density, threshold = 0.3,
                                      onStats = null }) {
  const meshRef = useRef();
  const geomRef = useRef(null);
  const buffer = useMemo(() => {
    if (!THREE) return null;
    const g = buildDensityGeometry(THREE, mesh, density, threshold);
    if (g && onStats) onStats({ kept: g._kept, total: g._total });
    return g;
  }, [THREE, mesh, density, threshold, onStats]);
  useEffect(() => {
    const prev = geomRef.current;
    geomRef.current = buffer;
    if (prev && prev !== buffer && typeof prev.dispose === 'function') prev.dispose();
  }, [buffer]);
  if (!buffer) return null;
  return (
    <mesh ref={meshRef} geometry={buffer} castShadow receiveShadow>
      <meshStandardMaterial vertexColors flatShading metalness={0.0} roughness={0.85} />
    </mesh>
  );
}

export function TopologyResultViewer({ mesh, density,
                                       initialThreshold = 0.3,
                                       compliance = null,
                                       iterations = null,
                                       onClose = null }) {
  const [bundle, setBundle] = useState(null);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [stats, setStats] = useState({ kept: 0, total: 0 });

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
        console.warn('[forge.v4.TopologyResultViewer] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!density) {
    return (
      <div data-testid="forge-topology-viewer"
           style={{ position: 'relative', width: '100%', height: '100%',
                    background: 'var(--forge-canvas)' }}>
        <div style={{ position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)',
                      fontSize: 11 }}>
          no density field — kernel required
        </div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div data-testid="forge-topology-viewer"
           style={{ position: 'relative', width: '100%', height: '100%',
                    background: 'var(--forge-canvas)' }}>
        <div style={{ position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)',
                      fontSize: 11 }}>
          loading topology viewer…
        </div>
      </div>
    );
  }
  const { Canvas } = bundle.r3f;
  const { OrbitControls, Grid } = bundle.drei;
  const THREE = bundle.three;

  const fmt = (v) => Math.abs(v) >= 1e3 ? v.toExponential(2) : v.toFixed(2);

  return (
    <div data-testid="forge-topology-viewer"
         style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [120, 90, 120], fov: 45, near: 0.1, far: 5000 }}
              gl={{ antialias: true, alpha: false }}
              data-testid="forge-topology-canvas">
        <color attach="background" args={['#0a0b0e']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[40, 60, 30]} intensity={0.95} />
        <directionalLight position={[-30, -20, -40]} intensity={0.3} />
        <Grid args={[200, 200]} cellColor="#2a2f3d" sectionColor="#3a4253"
              sectionSize={10} position={[0, -5, 0]}
              fadeDistance={140} fadeStrength={1.4} infiniteGrid />
        <TopologyResultScene THREE={THREE} mesh={mesh} density={density}
                             threshold={threshold} onStats={setStats} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                       minDistance={5} maxDistance={500} />
      </Canvas>

      <div className="forge-topology-controls"
           data-testid="forge-topology-controls"
           style={{
             position: 'absolute', left: 12, top: 12,
             display: 'flex', flexDirection: 'column', gap: 6,
             background: 'rgba(0,0,0,0.55)',
             backdropFilter: 'blur(4px)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 4, padding: 10, minWidth: 260,
           }}>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                       textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Topology result
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                         fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          <span style={{ minWidth: 90, textTransform: 'uppercase',
                         letterSpacing: '0.06em' }}>
            ρ &gt; {threshold.toFixed(2)}
          </span>
          <input type="range" min={0} max={1} step={0.01}
                 value={threshold}
                 data-testid="forge-topology-threshold"
                 onChange={(e) => setThreshold(parseFloat(e.target.value))}
                 style={{ flex: 1 }} />
        </label>
        <div style={{ fontSize: 10, fontFamily: 'var(--forge-mono)',
                       color: 'var(--forge-ink-2)' }}>
          shown {stats.kept}/{stats.total} elements
          {' · '}vf {(stats.total > 0 ? (stats.kept / stats.total * 100) : 0).toFixed(1)}%
        </div>
        {compliance != null && (
          <div data-testid="forge-topology-compliance"
               style={{ fontSize: 10, fontFamily: 'var(--forge-mono)',
                         color: 'var(--forge-ink-2)' }}>
            compliance {fmt(compliance)}
          </div>
        )}
        {Array.isArray(iterations) && iterations.length > 0 && (
          <div data-testid="forge-topology-history"
               style={{ fontSize: 10, fontFamily: 'var(--forge-mono)',
                         color: 'var(--forge-ink-mute)' }}>
            iters {iterations.length}
            {' · last Δρ '}
            {iterations[iterations.length-1].change?.toExponential(2) || '—'}
          </div>
        )}
        {onClose && (
          <button type="button"
                  data-testid="forge-topology-close"
                  onClick={onClose}
                  style={{
                    background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                    color: 'var(--forge-ink)', borderRadius: 3,
                    padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                    marginTop: 4,
                  }}>close</button>
        )}
      </div>
    </div>
  );
}

export default TopologyResultViewer;
