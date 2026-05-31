// Forge v3 — viewport surface. Hosts the THREE / react-three-fiber
// scene. SSR-safe — the empty-state renders on the server; the canvas
// only mounts in the browser (lazy-imported so the renderer doesn't
// pay the THREE bundle cost until the viewport is actually rendered).
//
// Models come from the driver's `steps` array via window.forge or, in
// the dev shell with no native kernel, from a tiny built-in scene that
// proves the viewport is alive: a copper-tinted Forge mark hovering
// over the grid. Replaces "blank canvas" with "always something to
// look at" — every commercial peer has an empty viewport that tells
// you nothing; Forge gives you the brand mark, lit, framed, orbitable.

import React, { Suspense, useEffect, useRef, useState } from 'react';

function ViewportEmptyHint() {
  return (
    <div className="forge-v3-viewport-empty" data-testid="forge-v3-viewport-empty">
      <span className="forge-v3-viewport-empty-mark" aria-hidden="true">⎈</span>
      <div style={{ fontSize: 14, color: 'var(--forge-v3-ink)' }}>
        Forge — a blank canvas.
      </div>
      <div className="forge-v3-viewport-empty-hint">
        Press <kbd>⌘K</kbd> and tell Archie what you want.
      </div>
    </div>
  );
}

export function ViewportSurface({ selection, onSelect, steps = [] }) {
  // Mount the r3f canvas only client-side. SSR renders the empty-state.
  const [canvasReady, setCanvasReady] = useState(false);
  const [bundle, setBundle] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    // Detect window + lazy-load r3f to keep SSR clean and the initial
    // renderer-side bundle small.
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const [{ Canvas, useFrame }, drei, three] = await Promise.all([
          import('@react-three/fiber'),
          import('@react-three/drei'),
          import('three'),
        ]);
        if (cancelled) return;
        setBundle({ Canvas, useFrame, drei, three });
        setCanvasReady(true);
      } catch (err) {
        // r3f failed to load — keep the empty-state up.
        // eslint-disable-next-line no-console
        console.warn('[forge.v3.viewport] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="forge-v3-viewport"
          role="region"
          aria-label="Forge viewport"
          data-testid="forge-v3-viewport"
          ref={rootRef}>
      {canvasReady && bundle
        ? (
          <Suspense fallback={<ViewportEmptyHint />}>
            <ViewportScene bundle={bundle} steps={steps}
                           selection={selection} onSelect={onSelect} />
          </Suspense>
        )
        : <ViewportEmptyHint />
      }
    </main>
  );
}

/**
 * The actual r3f scene. Split out so a renderer that fails to load
 * three.js silently falls back to the empty-state.
 *
 * Default scene (dev shell, no models): a copper-tinted Forge mark
 * with a subtle floor grid + 3 lights. Becomes a real mesh tree when
 * the driver has steps producing geometry.
 */
function ViewportScene({ bundle, steps, selection, onSelect }) {
  const { Canvas, useFrame } = bundle;
  const { OrbitControls, Grid, Environment } = bundle.drei;
  const THREE = bundle.three;

  // Compose camera + lights + the mark + the per-step meshes (when
  // present). The driver's step payloads carry the mesh handles; we
  // resolve them through window.forge.tessellate when available.
  return (
    <Canvas
      camera={{ position: [40, 25, 40], fov: 45, near: 0.1, far: 5000 }}
      data-testid="forge-v3-viewport-canvas"
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={[0.055, 0.063, 0.078]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[20, 30, 20]} intensity={0.9} />
      <directionalLight position={[-15, -10, -20]} intensity={0.25} />

      <Grid args={[100, 100]}
            cellColor="#2a2f3d"
            sectionColor="#3a4253"
            sectionSize={10}
            position={[0, -5, 0]}
            fadeDistance={120}
            fadeStrength={1.4}
            infiniteGrid />

      <ForgeMark THREE={THREE} useFrame={useFrame} />

      <SceneMeshes THREE={THREE} steps={steps}
                   selection={selection} onSelect={onSelect} />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                     minDistance={5} maxDistance={300} />
    </Canvas>
  );
}

// The "always something to look at" Forge brand object — a copper
// chevron + ring that orbits gently when no geometry is loaded. Not
// just a logo: it's a calibrated 10mm-scale object so users immediately
// have a sense of the world's units.
function ForgeMark({ THREE, useFrame }) {
  const group = React.useRef();
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.18;
  });
  return (
    <group ref={group}>
      {/* Ring — 10 mm diameter */}
      <mesh>
        <torusGeometry args={[5, 0.4, 16, 64]} />
        <meshStandardMaterial color="#d97a3b" roughness={0.35} metalness={0.5} />
      </mesh>
      {/* Chevron — Forge mark */}
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[2.2, 4.0, 4]} />
        <meshStandardMaterial color="#d97a3b" roughness={0.4} metalness={0.55} />
      </mesh>
    </group>
  );
}

// Render scene meshes from the driver's steps array. When window.forge
// is present we tessellate and cache; otherwise this is a no-op and
// the ForgeMark stays as the hero.
function SceneMeshes({ THREE, steps, selection, onSelect }) {
  const [meshes, setMeshes] = useState([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.forge ||
        typeof window.forge.tessellate !== 'function') {
      setMeshes([]);
      return;
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
      } catch { /* skip bad handles */ }
    }
    setMeshes(next);
    return () => {
      for (const m of next) m.geometry.dispose?.();
    };
  }, [THREE, steps]);

  if (meshes.length === 0) return null;
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.id} geometry={m.geometry}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.({ kind: 'body', ids: [m.handle] });
              }}>
          <meshStandardMaterial
            color={selection?.ids?.includes(m.handle) ? '#d97a3b' : '#c4ccd6'}
            roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}
