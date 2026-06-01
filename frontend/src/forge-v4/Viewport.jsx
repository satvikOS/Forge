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
//
// Forge-125: SceneMeshes now ticks the LOD scheduler each frame
// (lodScheduler.js). Bodies whose required level changed get queued
// for re-tessellation through the kernel's `tessellateAsync` /
// `tessellateLOD` API; the InstancedGroup uses the scheduler's
// per-body decisions to skip frustum-culled bodies and hide them by
// collapsing their instance matrix to a zero scale.

import React, { Suspense, useEffect, useRef, useState } from 'react';
import {
  tick as lodTick,
  setOnLevelChange as lodSetOnLevelChange,
  SYNTH_SEGMENTS,
} from './lodScheduler.js';
// Forge-158 — drive the AIS-style selection layer from r3f pointer
// events. The module is module-state + side-effects only (no React),
// so this import is safe to evaluate at module load.
import {
  onPointerOver as aisOnPointerOver,
  onPointerOut as aisOnPointerOut,
  onClick      as aisOnClick,
  onMissed     as aisOnMissed,
} from './aisSelection.js';

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
      onPointerMissed={() => aisOnMissed()}
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
      <SceneMeshes THREE={THREE} bundle={bundle} steps={steps}
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
  const { gl, camera, scene } = useThree();
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeRenderer = gl;
    // Forge-126 — SurfaceAnalysisOverlay projects analysis output into
    // screen space using the active camera. Expose it alongside the
    // renderer so the overlay doesn't have to instantiate its own.
    window.__forgeCamera = camera;
    window.__forgeScene  = scene;
    return () => {
      if (window.__forgeRenderer === gl) window.__forgeRenderer = null;
      if (window.__forgeCamera === camera) window.__forgeCamera = null;
      if (window.__forgeScene === scene) window.__forgeScene = null;
    };
  }, [gl, camera, scene]);
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
//
// Forge-125 — LOD streaming. The scene maintains *three* synthetic
// geometries per InstancedGroup (Low/Med/High segments). At runtime we
// pick the variant whose level the lodScheduler picked, then route the
// instance matrices into matching draw groups. Frustum-culled bodies get
// a zero-scale instance matrix so they cost a single matrix multiply
// each but don't rasterize any pixels.
function SceneMeshes({ THREE, bundle, steps, selection, onSelect, displayState, selectedRef }) {
  const [meshes, setMeshes] = React.useState([]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { buildSyntheticGeometry } = await import('./kernelDispatch.js');
      const next = [];
      for (const s of (steps || [])) {
        let g = null;
        // Forge-125: we keep three LOD variants for *synthetic* bodies
        // (the bulk of the 100k stress scene). Native handles get a
        // single geometry up-front and re-tessellate via the scheduler
        // through window.forge.tessellateLOD.
        const lodGeoms = { 0: null, 1: null, 2: null };
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
          // Build the High (segments=32) variant as the default geometry
          // so a body without scheduler data still renders cleanly.
          g = buildSyntheticGeometry(s.spec, THREE);
          // And pre-build Low / Med variants so the LOD swap is a
          // pointer change, not a tessellation hit on the main thread.
          for (const lvl of [0, 1, 2]) {
            const segSpec = withSegments(s.spec, SYNTH_SEGMENTS[lvl]);
            lodGeoms[lvl] = buildSyntheticGeometry(segSpec, THREE);
            lodGeoms[lvl]?.computeBoundingSphere?.();
          }
        }
        if (g) {
          g.computeBoundingSphere?.();
          next.push({ id: s.id, key: s.id, geometry: g, body: s,
                      instanceKey: instanceKeyFor(s),
                      lodGeoms });
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
      <LodSchedulerTicker bundle={bundle} THREE={THREE} bodies={steps || []} />
      {Array.from(groups.entries()).map(([key, members]) => {
        if (members.length === 1) {
          const m = members[0];
          const sel = selection?.ids?.includes(m.id) || selection?.ids?.includes(m.body?.handle);
          return (
            <mesh key={m.key}
                  geometry={m.geometry}
                  ref={(el) => {
                    if (!el) return;
                    if (selectedRef) selectedRef.current = el;
                    // Forge-158 — tag the mesh with the source body so
                    // aisSelection.resolvePointerEvent can recover bodyId
                    // from r3f's hit.object.userData.
                    el.userData = el.userData || {};
                    el.userData.body = m.body;
                    el.userData.forgeBody = m.body;
                    el.userData.bodyId = m.body?.handle ?? m.id;
                  }}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    aisOnPointerOver(e);
                  }}
                  onPointerOut={(e) => {
                    e.stopPropagation();
                    aisOnPointerOut(e);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    aisOnClick(e);
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

// Forge-125 — synthetic spec helper. Returns a copy with the segment
// count overridden so buildSyntheticGeometry produces a Low/Med/High
// variant of cylinder / sphere / torus / cone primitives. Boxes ignore
// segments which is fine — their visual is the same at every LOD.
function withSegments(spec, segs) {
  if (!spec) return spec;
  if (spec.kind === 'cylinder' || spec.kind === 'cone') {
    return { ...spec, segments: segs };
  }
  return spec;
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

// Forge-125 — ticks the LOD scheduler each animation frame. Lives inside
// the Canvas so it can pull camera + frustum from useThree, and stays
// outside of InstancedGroup so the scheduler runs once per frame, not
// once per draw group.
function LodSchedulerTicker({ bundle, THREE, bodies }) {
  const { useFrame, useThree } = bundle.r3f;
  const { camera, size } = useThree();
  const frustum = React.useRef(new THREE.Frustum());
  const matrix = React.useRef(new THREE.Matrix4());
  useFrame(() => {
    if (!bodies || bodies.length === 0) return;
    camera.updateMatrixWorld();
    matrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(matrix.current);
    lodTick({
      camera, bodies, frustum: frustum.current, THREE,
      screenH: size?.height ?? 1000,
      fovRad: (camera.fov || 45) * Math.PI / 180,
    });
  });
  return null;
}

function InstancedGroup({ THREE, members, displayState, onSelect, selection }) {
  // All members share geometry — use the first.
  const geom = members[0].geometry;
  const ref = React.useRef();
  const tmpMat = React.useRef(new THREE.Matrix4());
  const ZERO_SCALE = React.useRef(new THREE.Matrix4().makeScale(0, 0, 0));
  const HIDE_POS = React.useRef(new THREE.Vector3(0, -1e6, 0));  // safely off-screen

  // Initial placement — full visibility, identity scale. The frame-by-
  // frame LOD ticker (LodSchedulerTicker) updates these matrices each
  // frame for bodies that are culled.
  React.useEffect(() => {
    if (!ref.current) return;
    const m = tmpMat.current;
    members.forEach((mb, i) => {
      // Per-body position priority:
      //   1. body.xform  — explicit translation set by the producer
      //   2. body.spec.cells[0]  — single-cell position from kernelDispatch
      //   3. fallback grid stagger so instancing is still visible
      const xform = mb.body.xform
                  || mb.body.spec?.cells?.[0]
                  || { x: (i % 20) * 4 - 38, y: 0, z: Math.floor(i / 20) * 4 - 38 };
      m.makeTranslation(xform.x || 0, xform.y || 0, xform.z || 0);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [THREE, members]);

  // Forge-125 — per-frame frustum cull. Bodies the scheduler tagged as
  // hidden get their instance matrix collapsed to a zero scale → no
  // raster cost, no shadow contribution, but the slot index stays
  // stable for selection. We read the latest decision snapshot from
  // window.__forgeLodDecisions (set by lodScheduler.tick) once per
  // frame, batching the matrix mutations into one needsUpdate.
  React.useEffect(() => {
    let raf = 0;
    let prevHidden = new Uint8Array(members.length);
    function tick() {
      if (!ref.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      let dirty = false;
      const decisions = (typeof window !== 'undefined') ? window.__forgeLodDecisions : null;
      for (let i = 0; i < members.length; i++) {
        const mb = members[i];
        const d = decisions?.get?.(mb.body.id);
        const hide = d ? d.hidden : false;
        if (hide && !prevHidden[i]) {
          ref.current.setMatrixAt(i, ZERO_SCALE.current);
          prevHidden[i] = 1; dirty = true;
        } else if (!hide && prevHidden[i]) {
          const xform = mb.body.xform || mb.body.spec?.cells?.[0] || { x: 0, y: 0, z: 0 };
          tmpMat.current.makeTranslation(xform.x || 0, xform.y || 0, xform.z || 0);
          ref.current.setMatrixAt(i, tmpMat.current);
          prevHidden[i] = 0; dirty = true;
        }
      }
      if (dirty) ref.current.instanceMatrix.needsUpdate = true;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [THREE, members]);

  // Forge-125 — when the scheduler upgrades a body's LOD to High and
  // the kernel returns a new mesh, swap the InstancedMesh's geometry.
  // Since every member of an InstancedGroup shares geometry by design,
  // we swap *all* members up to the highest-required level present.
  React.useEffect(() => {
    if (!ref.current) return;
    function handleLevelChange(bodyId, level, mesh) {
      if (!ref.current) return;
      // Find the slot.
      const idx = members.findIndex((m) => m.body.id === bodyId);
      if (idx < 0) return;
      // Prefer cached synthetic-LOD geometry; only fall back to a
      // kernel mesh swap when native bodies stream in.
      const cached = members[idx].lodGeoms?.[level];
      if (cached && ref.current.geometry !== cached) {
        ref.current.geometry = cached;
      } else if (mesh && mesh.positions) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
        if (mesh.normals) g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
        if (mesh.indices) g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        g.computeBoundingSphere?.();
        ref.current.geometry = g;
      }
    }
    // Compose with any previously-registered listener: the lodScheduler
    // only carries one listener so we wrap it.
    const prev = (typeof window !== 'undefined') ? window.__forgeLodPrevListener : null;
    const composed = (id, lvl, m) => {
      try { prev?.(id, lvl, m); } catch { /* noop */ }
      handleLevelChange(id, lvl, m);
    };
    if (typeof window !== 'undefined') window.__forgeLodPrevListener = composed;
    lodSetOnLevelChange(composed);
    return () => { /* keep the listener so other groups still receive */ };
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
