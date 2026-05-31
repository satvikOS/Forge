// Forge-70 — viewport surface.
//
// Lazy-loads three / react-three-fiber / drei in the browser; SSR
// renders a minimal placeholder. Hosts:
//   - perspective camera + 3 lights (ambient + 2 directional)
//   - drei <Grid> infinite floor
//   - the Forge brand mark as a calibrated 10mm hero object (until
//     the kernel produces real meshes)
//   - SceneMeshes resolves driver-supplied step handles through
//     window.forge.tessellate when available
//   - HUD overlays: view name + axes triad + scale bar + selection
//     read-out

import React, { Suspense, useEffect, useRef, useState } from 'react';

function ViewportFallback() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 8, color: 'var(--forge-ink-mute)',
      fontSize: 11,
    }}>
      <div style={{ fontFamily: 'var(--forge-mono)' }}>loading viewport…</div>
    </div>
  );
}

export function Viewport({ steps = [], selection, onSelect,
                           viewName = 'iso', displayState = 'shaded',
                           activeWb = 'mech' }) {
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
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
        console.warn('[forge.v4.viewport] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <>
      {bundle ? (
        <Suspense fallback={<ViewportFallback />}>
          <ViewportScene bundle={bundle} steps={steps}
                         selection={selection} onSelect={onSelect}
                         viewName={viewName} displayState={displayState} />
        </Suspense>
      ) : <ViewportFallback />}
      <ViewportHUD viewName={viewName} displayState={displayState}
                   selection={selection} steps={steps} activeWb={activeWb} />
    </>
  );
}

function ViewportScene({ bundle, steps, selection, onSelect,
                         viewName, displayState }) {
  const { Canvas, useFrame } = bundle.r3f;
  const { OrbitControls, Grid } = bundle.drei;
  const THREE = bundle.three;
  return (
    <Canvas
      camera={{ position: cameraFor(viewName), fov: 45, near: 0.1, far: 5000 }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100%', height: '100%' }}
      data-testid="forge-v4-canvas"
    >
      <color attach="background" args={getBgColor(displayState)} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[20, 30, 20]} intensity={0.9} />
      <directionalLight position={[-15, -10, -20]} intensity={0.25} />
      <Grid args={[200, 200]}
            cellColor="#2a2f3d"
            sectionColor="#3a4253"
            sectionSize={10}
            position={[0, -5, 0]}
            fadeDistance={140}
            fadeStrength={1.4}
            infiniteGrid />
      <ForgeMark3D THREE={THREE} useFrame={useFrame} />
      <SceneMeshes THREE={THREE} steps={steps}
                   selection={selection} onSelect={onSelect}
                   displayState={displayState} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                     minDistance={5} maxDistance={300} />
    </Canvas>
  );
}

function cameraFor(viewName) {
  switch (viewName) {
    case 'front':  return [0, 0, 60];
    case 'back':   return [0, 0, -60];
    case 'top':    return [0, 60, 0.01];
    case 'bottom': return [0, -60, 0.01];
    case 'right':  return [60, 0, 0];
    case 'left':   return [-60, 0, 0];
    default:       return [40, 25, 40];   // iso
  }
}
function getBgColor(state) {
  if (state === 'wireframe') return [0.0, 0.0, 0.0];
  return [0.04, 0.05, 0.07];
}

// Calibrated 10 mm Forge mark — anvil silhouette + spark — rotating
// gently as the hero when no part is loaded.
function ForgeMark3D({ THREE, useFrame }) {
  const group = React.useRef();
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.12; });
  return (
    <group ref={group}>
      {/* Anvil body — approximated by stacked boxes */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[10, 1.6, 4]} />
        <meshStandardMaterial color="#9aa0aa" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[8, 1.2, 3]} />
        <meshStandardMaterial color="#8a8f99" roughness={0.45} metalness={0.65} />
      </mesh>
      <mesh position={[0, -1.6, 0]}>
        <boxGeometry args={[5, 1.4, 2.6]} />
        <meshStandardMaterial color="#7a7f88" roughness={0.55} metalness={0.55} />
      </mesh>
      {/* Spark */}
      <mesh position={[0, 4.5, 0]}>
        <octahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color="#ffffff" emissive="#aaaaaa" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

// Kernel-driven meshes — resolved through window.forge.tessellate.
function SceneMeshes({ THREE, steps, selection, onSelect, displayState }) {
  const [meshes, setMeshes] = useState([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.forge ||
        typeof window.forge.tessellate !== 'function') {
      setMeshes([]); return;
    }
    const next = [];
    for (const s of steps) {
      if (typeof s.handle !== 'number') continue;
      try {
        const m = window.forge.tessellate(s.handle, 0.1, 0.5);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        if (m.indices) g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingSphere?.();
        next.push({ id: s.id, handle: s.handle, geometry: g });
      } catch { /* skip */ }
    }
    setMeshes(next);
    return () => { for (const x of next) x.geometry.dispose?.(); };
  }, [THREE, steps]);
  if (meshes.length === 0) return null;
  return (
    <group>
      {meshes.map((m) => {
        const sel = selection?.ids?.includes(m.handle);
        return (
          <mesh key={m.id} geometry={m.geometry}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.({ kind: 'body', ids: [m.handle] });
                }}>
            {displayState === 'wireframe'
              ? <meshBasicMaterial color={sel ? '#ffffff' : '#c4ccd6'} wireframe />
              : <meshStandardMaterial
                  color={sel ? '#ffffff' : '#c4ccd6'}
                  roughness={0.4} metalness={0.2}
                  transparent={displayState === 'transparent'}
                  opacity={displayState === 'transparent' ? 0.5 : 1} />}
          </mesh>
        );
      })}
    </group>
  );
}

function ViewportHUD({ viewName, displayState, selection, steps, activeWb }) {
  const wbLabel = {
    mech: 'Part', drawing: 'Draft', sheet: 'Sheet Metal',
    weld: 'Weldments', mold: 'Mold Tools',
    sim: 'Simulation', mfg: 'Manufacturing',
  }[activeWb] || activeWb;
  return (
    <>
      <div style={{
        position: 'absolute', top: 10, left: 12,
        font: '10px var(--forge-mono)', color: 'var(--forge-ink-2)',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        padding: '4px 9px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>{wbLabel} · {viewName} · {displayState}</div>
      <div style={{
        position: 'absolute', bottom: 10, left: 12,
        display: 'flex', gap: 10,
        font: '10px var(--forge-mono)',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        padding: '4px 9px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>
        <span style={{ color: 'var(--forge-ink)' }}>▶ X</span>
        <span style={{ color: 'var(--forge-ink-2)' }}>▲ Y</span>
        <span style={{ color: 'var(--forge-ink-mute)' }}>● Z</span>
      </div>
      <div style={{
        position: 'absolute', bottom: 10, right: 12,
        font: '10px var(--forge-mono)', color: 'var(--forge-ink-2)',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        padding: '4px 9px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>
        <span style={{
          display: 'inline-block', width: 40, height: 2,
          background: 'var(--forge-ink-2)', margin: '0 6px 2px',
          verticalAlign: 'middle',
        }} />10 mm
      </div>
      {selection?.kind === 'body' && (selection.ids?.length ?? 0) > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 12,
          font: 'inherit', color: 'var(--forge-ink)',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
          padding: '6px 10px', borderRadius: 4,
          border: '1px solid var(--forge-accent-rim)',
          borderLeft: '3px solid var(--forge-accent)',
          fontSize: 11,
          minWidth: 160,
        }}>
          <div style={{
            color: 'var(--forge-accent)', fontSize: 9,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            fontWeight: 600, marginBottom: 4,
          }}>Selected · {selection.kind}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr',
            gap: '2px 12px', fontFamily: 'var(--forge-mono)', fontSize: 11,
          }}>
            <span style={{ color: 'var(--forge-ink-mute)' }}>id</span><span>#{selection.ids[0]}</span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>steps</span><span>{steps?.length || 0}</span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>state</span><span>{displayState}</span>
          </div>
        </div>
      )}
    </>
  );
}
