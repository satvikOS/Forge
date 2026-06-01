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
                           activeWb = 'mech',
                           theme = 'dark',
                           gizmoMode = null,           // 'translate'|'rotate'|'scale'|null
                           onGizmoChange = null,
                           centerToken = 0,            // bump to recentre camera on origin
                           sketchOverlay = null,       // {lines, circles, arcs} from current sketch
                           sectionPlane = null }) {    // {axis:'X'|'Y'|'Z', offset:number, enabled:bool}
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
                         viewName={viewName} displayState={displayState}
                         theme={theme}
                         gizmoMode={gizmoMode} onGizmoChange={onGizmoChange}
                         centerToken={centerToken}
                         sketchOverlay={sketchOverlay}
                         sectionPlane={sectionPlane} />
        </Suspense>
      ) : <ViewportFallback />}
      <ViewportHUD viewName={viewName} displayState={displayState}
                   selection={selection} steps={steps} activeWb={activeWb} />
    </>
  );
}

function ViewportScene({ bundle, steps, selection, onSelect,
                         viewName, displayState, theme,
                         gizmoMode, onGizmoChange, centerToken,
                         sketchOverlay, sectionPlane }) {
  const { Canvas } = bundle.r3f;
  const { OrbitControls, Grid, TransformControls, GizmoHelper, GizmoViewport, Html, Line } = bundle.drei;
  const THREE = bundle.three;
  const selectedRef = React.useRef(null);
  const orbitRef = React.useRef(null);
  const [gizmoBusy, setGizmoBusy] = React.useState(false);
  const showGizmo = !!gizmoMode && !!selectedRef.current;
  const labelInk = theme === 'light' ? '#14161b' : '#ebecef';

  // Forge-118 — build clipping planes from sectionPlane prop.
  const clippingPlanes = React.useMemo(() => {
    if (!sectionPlane?.enabled) return [];
    const axis = (sectionPlane.axis || 'X').toUpperCase();
    const off = Number(sectionPlane.offset) || 0;
    const n = axis === 'X' ? [-1,0,0] : axis === 'Y' ? [0,-1,0] : [0,0,-1];
    const plane = new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), off);
    return [plane];
  }, [THREE, sectionPlane?.enabled, sectionPlane?.axis, sectionPlane?.offset]);

  return (
    <Canvas
      camera={{ position: cameraFor(viewName), fov: 45, near: 0.1, far: 5000 }}
      gl={{ antialias: true, alpha: false, localClippingEnabled: true }}
      onCreated={({ gl }) => { gl.clippingPlanes = clippingPlanes; gl.localClippingEnabled = true; }}
      style={{ width: '100%', height: '100%' }}
      data-testid="forge-v4-canvas"
    >
      <color attach="background" args={getBgColor(displayState, theme)} />
      <ambientLight intensity={theme === 'light' ? 0.7 : 0.45} />
      <directionalLight position={[20, 30, 20]} intensity={0.9} />
      <directionalLight position={[-15, -10, -20]} intensity={0.25} />
      <Grid args={[200, 200]}
            cellColor={theme === 'light' ? '#bdc1c8' : '#2a2f3d'}
            sectionColor={theme === 'light' ? '#8d929b' : '#3a4253'}
            sectionSize={10}
            position={[0, -5, 0]}
            fadeDistance={140}
            fadeStrength={1.4}
            infiniteGrid />
      <OriginAxes Line={Line} Html={Html} labelInk={labelInk} />
      {sketchOverlay && <SketchOverlay Line={Line} overlay={sketchOverlay} ink={labelInk} />}
      <SceneMeshes THREE={THREE} steps={steps}
                   selection={selection} onSelect={onSelect}
                   displayState={displayState}
                   selectedRef={selectedRef} />
      {showGizmo && selectedRef.current && (
        <TransformControls
          object={selectedRef.current}
          mode={gizmoMode}
          size={1.0}
          onMouseDown={() => setGizmoBusy(true)}
          onMouseUp={() => setGizmoBusy(false)}
          onObjectChange={() => onGizmoChange?.(selectedRef.current)}
        />
      )}
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.08}
                     minDistance={5} maxDistance={300}
                     enabled={!gizmoBusy} />
      <CameraCenterEffect orbitRef={orbitRef} bundle={bundle}
                          viewName={viewName} centerToken={centerToken} />
      <RendererPublisher bundle={bundle} />
      {GizmoHelper && GizmoViewport && (
        <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
          <GizmoViewport axisColors={['#e26a6a', '#5cc88f', '#4aa0e1']}
                         labelColor={labelInk} />
        </GizmoHelper>
      )}
    </Canvas>
  );
}

// XYZ origin triad — three orthogonal axis lines + labels at the world origin.
// Replaces the legacy ForgeMark3D anvil so the viewport starts empty with a
// proper CAD reference frame at (0,0,0). Axes are 25 mm long (2.5× a grid
// section) so they project past the local grid and remain legible at any
// camera angle.
function OriginAxes({ Line, Html, labelInk }) {
  const len = 25;          // mm — extends past one 10 mm grid section
  const xColor = '#e26a6a', yColor = '#5cc88f', zColor = '#4aa0e1';
  const labelStyle = {
    color: labelInk, fontFamily: 'var(--forge-mono)', fontSize: 13,
    fontWeight: 700, letterSpacing: '0.06em', pointerEvents: 'none',
    transform: 'translate(-50%, -50%)', userSelect: 'none',
    textShadow: '0 0 4px rgba(0,0,0,0.55)',
  };
  if (!Line) return null;
  return (
    <group renderOrder={2}>
      <Line points={[[0,0,0], [len,0,0]]} color={xColor} lineWidth={2.5} />
      <Line points={[[0,0,0], [0,len,0]]} color={yColor} lineWidth={2.5} />
      <Line points={[[0,0,0], [0,0,len]]} color={zColor} lineWidth={2.5} />
      {/* faint negative-direction segments so origin reads as a true triad */}
      <Line points={[[0,0,0], [-len*0.35,0,0]]} color={xColor} lineWidth={1} dashed dashSize={0.6} gapSize={0.4} opacity={0.5} transparent />
      <Line points={[[0,0,0], [0,-len*0.35,0]]} color={yColor} lineWidth={1} dashed dashSize={0.6} gapSize={0.4} opacity={0.5} transparent />
      <Line points={[[0,0,0], [0,0,-len*0.35]]} color={zColor} lineWidth={1} dashed dashSize={0.6} gapSize={0.4} opacity={0.5} transparent />
      {/* origin sphere (slightly larger so it's always legible) */}
      <mesh>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color={labelInk} />
      </mesh>
      {/* arrowhead cones at positive tips */}
      <mesh position={[len, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.55, 1.4, 12]} />
        <meshBasicMaterial color={xColor} />
      </mesh>
      <mesh position={[0, len, 0]}>
        <coneGeometry args={[0.55, 1.4, 12]} />
        <meshBasicMaterial color={yColor} />
      </mesh>
      <mesh position={[0, 0, len]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.55, 1.4, 12]} />
        <meshBasicMaterial color={zColor} />
      </mesh>
      {/* axis labels just past the arrowheads */}
      {Html && (
        <>
          <Html position={[len + 2.2, 0, 0]} center distanceFactor={null}>
            <span style={{ ...labelStyle, color: xColor }}>X</span>
          </Html>
          <Html position={[0, len + 2.2, 0]} center distanceFactor={null}>
            <span style={{ ...labelStyle, color: yColor }}>Y</span>
          </Html>
          <Html position={[0, 0, len + 2.2]} center distanceFactor={null}>
            <span style={{ ...labelStyle, color: zColor }}>Z</span>
          </Html>
        </>
      )}
    </group>
  );
}

// Forge-85 — overlay for the in-progress sketch session. Renders lines,
// circles, and arcs in plane-local coordinates lifted to the active plane.
// Drawn in a brighter accent so it reads as "work in progress" while the
// user is still editing the sketch.
function SketchOverlay({ Line, overlay, ink }) {
  if (!overlay) return null;
  const accent = '#7ec9ff';
  return (
    <group renderOrder={3}>
      {(overlay.lines || []).map((l) => (
        <Line key={l.id} points={[l.a, l.b]} color={accent} lineWidth={2} />
      ))}
      {(overlay.circles || []).map((c) => {
        const seg = 48;
        const pts = [];
        for (let i = 0; i <= seg; i++) {
          const ang = (i / seg) * Math.PI * 2;
          pts.push([
            c.center[0] + c.r * Math.cos(ang),
            c.center[1] + c.r * Math.sin(ang),
            c.center[2],
          ]);
        }
        return <Line key={c.id} points={pts} color={accent} lineWidth={2} />;
      })}
      {(overlay.arcs || []).map((a) => {
        const v0 = [a.a[0] - a.center[0], a.a[1] - a.center[1], a.a[2] - a.center[2]];
        const v1 = [a.b[0] - a.center[0], a.b[1] - a.center[1], a.b[2] - a.center[2]];
        const r0 = Math.sqrt(v0[0]*v0[0] + v0[1]*v0[1] + v0[2]*v0[2]);
        const a0 = Math.atan2(v0[1], v0[0]);
        const a1 = Math.atan2(v1[1], v1[0]);
        const seg = 40;
        const pts = [];
        for (let i = 0; i <= seg; i++) {
          const t = i / seg;
          const ang = a0 + (a1 - a0) * t;
          pts.push([
            a.center[0] + r0 * Math.cos(ang),
            a.center[1] + r0 * Math.sin(ang),
            a.center[2],
          ]);
        }
        return <Line key={a.id} points={pts} color={accent} lineWidth={2} />;
      })}
    </group>
  );
}

// Detects centerToken bumps and re-centres the camera target on origin while
// preserving the current named view's framing direction. Eases over ~280 ms
// so the recentre reads as a deliberate gesture, not a teleport.
// Expose the active WebGLRenderer to window.__forgeRenderer so
// PerfStatsHUD + Archie can read perf counters.
function RendererPublisher({ bundle }) {
  const { useThree } = bundle.r3f;
  const { gl } = useThree();
  React.useEffect(() => {
    if (typeof window !== 'undefined') window.__forgeRenderer = gl;
    return () => { if (typeof window !== 'undefined' && window.__forgeRenderer === gl) window.__forgeRenderer = null; };
  }, [gl]);
  return null;
}

function CameraCenterEffect({ orbitRef, bundle, viewName, centerToken }) {
  const { useThree, useFrame } = bundle.r3f;
  const THREE = bundle.three;
  const { camera } = useThree();
  const animRef = React.useRef(null);
  React.useEffect(() => {
    if (centerToken === 0) return;
    const ctrls = orbitRef.current;
    if (!ctrls) return;
    const pos = cameraFor(viewName);
    animRef.current = {
      t0: performance.now(),
      dur: 280,
      camFrom: camera.position.clone(),
      camTo: new THREE.Vector3(pos[0], pos[1], pos[2]),
      tgtFrom: ctrls.target.clone(),
      tgtTo: new THREE.Vector3(0, 0, 0),
    };
  }, [centerToken]);
  useFrame(() => {
    const a = animRef.current;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.t0) / a.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
    camera.position.lerpVectors(a.camFrom, a.camTo, e);
    const ctrls = orbitRef.current;
    if (ctrls) {
      ctrls.target.lerpVectors(a.tgtFrom, a.tgtTo, e);
      ctrls.update?.();
    }
    camera.lookAt(ctrls?.target || a.tgtTo);
    if (t >= 1) animRef.current = null;
  });
  return null;
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
function getBgColor(state, theme) {
  if (theme === 'light') {
    if (state === 'wireframe') return [1.0, 1.0, 1.0];
    return [0.92, 0.93, 0.95];   // greyish off-white viewport
  }
  if (theme === 'contrast') return [0, 0, 0];
  if (state === 'wireframe') return [0, 0, 0];
  return [0.04, 0.05, 0.07];
}

// Body meshes — Forge-83: each body is either kernel-tessellated (native
// handle via window.forge.tessellate) or synthetically constructed from a
// spec via kernelDispatch.buildSyntheticGeometry.
//
// Forge-106 — instanced rendering for repeated parts. Bodies that share a
// (toolId · spec) key are batched into a single THREE.InstancedMesh so the
// viewport stays at 60fps even with thousands of M8-bolts-like instances.
// Unique bodies render as individual meshes (so selection still works).
function SceneMeshes({ THREE, steps, selection, onSelect, displayState, selectedRef }) {
  const [meshes, setMeshes] = React.useState([]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { buildSyntheticGeometry } = await import('./kernelDispatch.js');
      const next = [];
      for (const s of (steps || [])) {
        let g = null;
        if (s.kind === 'native' && typeof s.handle === 'number' &&
            typeof window !== 'undefined' && window.forge?.tessellate) {
          try {
            const m = window.forge.tessellate(s.handle, 0.1, 0.5);
            g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
            if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
            if (m.indices) g.setIndex(new THREE.BufferAttribute(m.indices, 1));
          } catch (err) {
            console.warn('[forge.v4.scene] tessellate failed:', err.message);
          }
        }
        if (!g && s.kind === 'synthetic' && s.spec) {
          g = buildSyntheticGeometry(s.spec, THREE);
        }
        if (g) {
          g.computeBoundingSphere?.();
          next.push({ id: s.id, key: s.id, geometry: g, body: s,
                      instanceKey: instanceKeyFor(s) });
        }
      }
      if (!cancelled) setMeshes(next);
    })();
    return () => { cancelled = true; };
  }, [THREE, steps]);

  React.useEffect(() => {
    if (!selectedRef) return;
    if (meshes.length === 0) { selectedRef.current = null; return; }
  }, [meshes.length, selectedRef]);
  if (meshes.length === 0) return null;

  // Group meshes by their instance key. Groups with > 1 member render as
  // an InstancedMesh; singletons render as plain meshes.
  const groups = new Map();
  for (const m of meshes) {
    const k = m.instanceKey;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }

  return (
    <group>
      {Array.from(groups.entries()).map(([key, members]) => {
        if (members.length === 1) {
          const m = members[0];
          const sel = selection?.ids?.includes(m.id) || selection?.ids?.includes(m.body?.handle);
          return (
            <mesh key={m.key}
                  geometry={m.geometry}
                  ref={(el) => { if (selectedRef) selectedRef.current = el; }}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    if (typeof window !== 'undefined') window.__forgeHovered = m.body;
                  }}
                  onPointerOut={(e) => {
                    e.stopPropagation();
                    if (typeof window !== 'undefined' && window.__forgeHovered === m.body)
                      window.__forgeHovered = null;
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.({ kind: 'body', ids: [m.body?.handle ?? m.id] });
                  }}>
              {displayState === 'wireframe'
                ? <meshBasicMaterial color={sel ? '#ffffff' : '#c4ccd6'} wireframe />
                : <meshStandardMaterial
                    color={sel ? '#ffffff' : '#c4ccd6'}
                    roughness={0.42} metalness={0.18}
                    transparent={displayState === 'transparent'}
                    opacity={displayState === 'transparent' ? 0.5 : 1} />}
            </mesh>
          );
        }
        return (
          <InstancedGroup key={key} THREE={THREE} members={members}
                          displayState={displayState}
                          onSelect={onSelect} selection={selection} />
        );
      })}
    </group>
  );
}

// Build a key that groups bodies sharing a geometry source. Native handles
// are unique per OCCT body, so they don't instance unless we tag them with
// a shared instanceTag; synthetic specs key by their kind + dimensions.
function instanceKeyFor(body) {
  if (body.instanceTag) return body.instanceTag;
  if (body.kind === 'synthetic' && body.spec) {
    return `syn:${body.spec.kind}:${body.spec.dx ?? ''}:${body.spec.dy ?? ''}:${body.spec.dz ?? ''}:${body.spec.r ?? ''}:${body.spec.h ?? ''}:${body.spec.R ?? ''}`;
  }
  return `uniq:${body.id}`;
}

function InstancedGroup({ THREE, members, displayState, onSelect, selection }) {
  // All members share geometry — use the first.
  const geom = members[0].geometry;
  const ref = React.useRef();
  React.useEffect(() => {
    if (!ref.current) return;
    const m = new THREE.Matrix4();
    members.forEach((mb, i) => {
      // No explicit transform — instance positions decided by group cells if
      // present, else stagger along X for visual proof of instancing.
      const xform = mb.body.spec?.cells?.[i] || { x: 0, y: 0, z: 0 };
      m.makeTranslation(xform.x, xform.y, xform.z);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [THREE, members]);

  return (
    <instancedMesh ref={ref}
                   args={[geom, undefined, members.length]}
                   onClick={(e) => {
                     e.stopPropagation();
                     const idx = e.instanceId;
                     const m = members[idx ?? 0];
                     if (m) onSelect?.({ kind: 'body', ids: [m.body?.handle ?? m.id] });
                   }}>
      {displayState === 'wireframe'
        ? <meshBasicMaterial color="#c4ccd6" wireframe />
        : <meshStandardMaterial color="#c4ccd6"
            roughness={0.42} metalness={0.18}
            transparent={displayState === 'transparent'}
            opacity={displayState === 'transparent' ? 0.5 : 1} />}
    </instancedMesh>
  );
}

function ViewportHUD() {
  // Forge-79 — viewport is now bare. Status (wb · view · displayState)
  // lives in the bottom status bar, axes triad is provided by the drei
  // GizmoHelper, and the scale bar / selection HUD were redundant with
  // the right Properties panel + bottom status. Less is more.
  return null;
}
