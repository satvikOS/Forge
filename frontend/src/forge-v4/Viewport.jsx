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
//
// PUSH-205 (Slice-160): InstancedGroup now consumes both
// `window.__forgeVisibleBodies` (Set<id> published by OctreeCullingTicker
// / PUSH-204) and `window.__forgeLodLevel` (Map<id, 0..2> mirrored from
// the LOD scheduler). The visible-set drives per-instance ZERO_SCALE so
// frustum-culled bodies cost a single matrix multiply but raster nothing;
// the LOD map fires `forge:lod-needed` events when a body crosses a
// level boundary so the kernel can asynchronously re-tessellate without
// blocking the render loop. The viewport HUD shows a `visible / total`
// chip when the scene exceeds 50 bodies so the 100k-part regime is
// observable at a glance.

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
// PUSH-204 (Slice-154) — wire the OctreeIndex (PUSH-164) into the live
// viewport so per-frame culling is O(log N + visible) instead of an
// O(N) walk through window.__forgeBodies. We build the octree once
// per body-list change, then every animation frame extract the 6
// camera frustum planes from the projection × view matrix and ask the
// octree which body ids intersect. The result is published to
// `window.__forgeVisibleBodies` (Set<id>) so SceneMeshes can filter the
// draw list and so e2e harnesses can assert that culling is real.
//
// Cost guarantees:
//   • build    — O(N log N) only when steps array identity changes.
//   • query    — O(log N + V) where V = visible body count.
//   • set ops  — Set construction is O(V).
//
// The contract from octreeIndex.js (OctreeIndex.planesFromCamera) lets
// us avoid a hard-import of THREE for the math; we just need
// camera.projectionMatrix + camera.matrixWorldInverse, which r3f
// guarantees are up-to-date after `camera.updateMatrixWorld()`.
import {
  OctreeIndex,
  getOctreeIndex,
  installOctreeWindowApi,
} from './octreeIndex.js';
// Single shared fit-to-bounds math (also used by the auto-zoom-to-fit-on-
// build hook in ForgeShellV4). __forgeFitToBounds delegates to this so there
// is exactly one framing implementation.
import { computeCameraFit } from './cameraFit.js';

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
                           sectionPlane = null,        // {axis:'X'|'Y'|'Z', offset:number, enabled:bool}
                           explodeOffsets = {} }) {    // PUSH-31: { bodyId: [dx,dy,dz] }
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
                         sectionPlane={sectionPlane}
                         explodeOffsets={explodeOffsets} />
        </Suspense>
      ) : <ViewportFallback />}
      <ViewportHUD viewName={viewName} displayState={displayState}
                   selection={selection} steps={steps} activeWb={activeWb} />
    </>
  );
}

// PUSH-31 — inside-Canvas helper that re-applies the global clipping
// plane array each time `clippingPlanes` changes. The Canvas onCreated
// callback only fires once, so toggling section view after first paint
// previously did nothing.
function ClippingUpdater({ clippingPlanes, bundle }) {
  const { useThree } = bundle.r3f;
  const gl = useThree((s) => s.gl);
  React.useEffect(() => {
    if (!gl) return undefined;
    gl.clippingPlanes = clippingPlanes;
    gl.localClippingEnabled = true;
    return undefined;
  }, [gl, clippingPlanes]);
  return null;
}

// PUSH-31 — visual gizmo for the section cutting plane. Renders a
// translucent square aligned with the cut so the user sees WHERE the
// section is, not just that it's "enabled somewhere". Sized at 500mm
// to comfortably encompass typical Mech bodies (engine block ~640mm).
function SectionGizmo({ THREE, plane }) {
  const axis = (plane.axis || 'X').toUpperCase();
  const off = Number(plane.offset) || 0;
  const size = 500;
  // Orient the plane normal-up axis: rotate a base XY square so its
  // normal matches the cutting axis.
  let rotation = [0, 0, 0];
  let position = [0, 0, 0];
  if (axis === 'X') { rotation = [0, Math.PI / 2, 0]; position = [off, 0, 0]; }
  else if (axis === 'Y') { rotation = [Math.PI / 2, 0, 0]; position = [0, off, 0]; }
  else                   { rotation = [0, 0, 0];           position = [0, 0, off]; }
  return (
    <mesh position={position} rotation={rotation} renderOrder={9999}
          userData={{ helper: true }}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#7aa2f7" transparent opacity={0.18}
                         side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function ViewportScene({ bundle, steps, selection, onSelect,
                         viewName, displayState, theme,
                         gizmoMode, onGizmoChange, centerToken,
                         sketchOverlay, sectionPlane,
                         explodeOffsets = {} }) {
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
      camera={{ position: cameraFor(viewName), fov: 45, near: 0.1, far: 200000 }}
      gl={{ antialias: true, alpha: false, localClippingEnabled: true }}
      onCreated={({ gl }) => { gl.clippingPlanes = clippingPlanes; gl.localClippingEnabled = true; }}
      onPointerMissed={() => aisOnMissed()}
      style={{ width: '100%', height: '100%' }}
      data-testid="forge-v4-canvas"
    >
      {/* PUSH-31 — keep the renderer's global clipping array in sync with
          sectionPlane changes (onCreated only fires once, so toggling section
          view after first paint did nothing). */}
      <ClippingUpdater clippingPlanes={clippingPlanes} bundle={bundle} />
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
      {/* PUSH-31 — translucent plane indicator when section view is on. */}
      {sectionPlane?.enabled && (
        <SectionGizmo THREE={THREE} plane={sectionPlane} />
      )}
      {sketchOverlay && <SketchOverlay Line={Line} overlay={sketchOverlay} ink={labelInk} />}
      <EdgePickOverlay Line={Line} steps={steps} selection={selection} onSelect={onSelect} />
      <SceneMeshes THREE={THREE} bundle={bundle} steps={steps}
                   selection={selection} onSelect={onSelect}
                   displayState={displayState}
                   selectedRef={selectedRef}
                   explodeOffsets={explodeOffsets} />
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
                     minDistance={5} maxDistance={80000}
                     enabled={!gizmoBusy} />
      <CameraCenterEffect orbitRef={orbitRef} bundle={bundle}
                          viewName={viewName} centerToken={centerToken} />
      <RendererPublisher bundle={bundle} />
      {GizmoHelper && GizmoViewport && (
        <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
          <GizmoViewport axisColors={['#6f7177', '#9a9ca2', '#d7d9de']}
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

// Slice-3 edge picking — when the active selection filter is 'edge', render
// each BREP edge of the native bodies as a pickable line. Clicking a line
// reports {kind:'edge', bodyHandle, edgeId} so fillet/chamfer/dimension can
// target THAT edge. A fat transparent line sits under each visible line to
// make the ~1px edge easy to hit with the cursor.
function EdgePickOverlay({ Line, steps, selection, onSelect }) {
  const enabled = selection?.kind === 'edge';
  const [edgeData, setEdgeData] = React.useState([]);
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.forge?.direct?.edgeSegments) {
      setEdgeData([]);
      return;
    }
    const out = [];
    for (const s of (steps || [])) {
      if (s.kind !== 'native' || typeof s.handle !== 'number') continue;
      try {
        const segs = window.forge.direct.edgeSegments(s.handle, 0.25);
        for (const e of segs) {
          const pts = [];
          const p = e.points;
          for (let i = 0; i + 2 < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]]);
          if (pts.length >= 2) out.push({ bodyHandle: s.handle, edgeId: e.id, pts });
        }
      } catch { /* skip bodies the kernel can't sample */ }
    }
    setEdgeData(out);
  }, [enabled, steps]);
  if (!enabled || edgeData.length === 0) return null;
  const selEdge = (selection?.kind === 'edge' && typeof selection.edgeId === 'number')
    ? selection.edgeId : null;
  return (
    <group renderOrder={8}>
      {edgeData.map((e) => {
        const isSel = selEdge === e.edgeId && selection.bodyHandle === e.bodyHandle;
        const pick = (ev) => {
          ev.stopPropagation();
          onSelect?.({ kind: 'edge', ids: [e.bodyHandle],
                       bodyHandle: e.bodyHandle, edgeId: e.edgeId });
        };
        return (
          <group key={`${e.bodyHandle}-${e.edgeId}`}>
            {/* fat invisible hit line for easy picking */}
            <Line points={e.pts} color="#000000" transparent opacity={0}
                  lineWidth={10} onClick={pick} onPointerDown={pick} />
            {/* visible edge */}
            <Line points={e.pts} color={isSel ? '#ffd166' : '#5fd0ff'}
                  lineWidth={isSel ? 4 : 2} onClick={pick} />
          </group>
        );
      })}
    </group>
  );
}
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
    window.__forgeThree  = bundle.three;
    return () => {
      if (window.__forgeRenderer === gl) window.__forgeRenderer = null;
      if (window.__forgeCamera === camera) window.__forgeCamera = null;
      if (window.__forgeScene === scene) window.__forgeScene = null;
      if (window.__forgeThree === bundle.three) window.__forgeThree = null;
    };
  }, [gl, camera, scene]);
  return null;
}

function CameraCenterEffect({ orbitRef, bundle, viewName, centerToken }) {
  const { useThree, useFrame } = bundle.r3f;
  const THREE = bundle.three;
  const { camera } = useThree();
  // PUSH-27 — expose the OrbitControls. Use useFrame (already imported
  // from bundle.r3f above) so we capture the controls AFTER they've been
  // attached — Drei's OrbitControls only sets its ref after first frame.
  useFrame(() => {
    if (typeof window === 'undefined') return;
    if (orbitRef.current && window.__forgeOrbit !== orbitRef.current) {
      window.__forgeOrbit = orbitRef.current;
    }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOrbit = orbitRef.current;
    window.__forgeFitToBounds = (box, opts = {}) => {
      if (!orbitRef.current || !box) return;
      // Single shared fit math (cameraFit.js). When no explicit `dir` is
      // passed we hand the current camera position + controls target so the
      // fit keeps the user's current view direction (per-spec) instead of
      // snapping to a fixed iso angle.
      const fit = computeCameraFit(box, {
        fovDeg: camera.fov,
        aspect: camera.aspect || 1.778,
        margin: opts.margin,
        dir: opts.dir,
        currentPosition: camera.position.toArray(),
        currentTarget: orbitRef.current.target.toArray(),
      });
      if (!fit) return;
      camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
      camera.near = fit.near;
      camera.far = fit.far;
      camera.updateProjectionMatrix();
      orbitRef.current.target.set(fit.target[0], fit.target[1], fit.target[2]);
      orbitRef.current.update();
    };
    return () => {
      if (window.__forgeOrbit === orbitRef.current) window.__forgeOrbit = null;
      delete window.__forgeFitToBounds;
    };
  }, [camera, orbitRef]);
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
  if (theme === 'high-contrast') return [0, 0, 0];
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
// Forge-196 — kernel mesh fields cross the contextBridge; depending on the
// Electron version a Float32Array may arrive intact, as an ArrayBuffer, as a
// plain Array, or as a numeric-keyed object. Re-marshal to the requested
// TypedArray; null means "absent or unusable" (caller decides loudly).
function toTypedArray(a, Ctor) {
  if (a == null) return null;
  if (a instanceof Ctor) return a;
  if (ArrayBuffer.isView(a)) return new Ctor(a.buffer, a.byteOffset, a.byteLength / Ctor.BYTES_PER_ELEMENT);
  if (a instanceof ArrayBuffer) return new Ctor(a);
  if (Array.isArray(a) || typeof a.length === 'number') return Ctor.from(a);
  if (typeof a === 'object') {
    const keys = Object.keys(a);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return Ctor.from({ length: keys.length }, (_, i) => a[i]);
    }
  }
  return null;
}

function SceneMeshes({ THREE, bundle, steps, selection, onSelect, displayState, selectedRef,
                       explodeOffsets = {} }) {
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
        let faceIds = null;
        if (s.kind === 'native' && typeof s.handle === 'number' &&
            typeof window !== 'undefined' && window.forge?.tessellate) {
          try {
            const m = window.forge.tessellate(s.handle, 0.1, 0.5);
            // Forge-196 — contextBridge clones typed arrays lossily on some
            // Electron versions (see preload writeBlob); re-marshal before
            // BufferAttribute, which hard-requires TypedArrays.
            const pos = toTypedArray(m.positions, Float32Array);
            if (!pos || pos.length === 0) {
              throw new Error(`tessellate returned no positions (got ${m.positions ? m.positions.constructor?.name : m.positions})`);
            }
            g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const nrm = toTypedArray(m.normals, Float32Array);
            if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
            const idx = toTypedArray(m.indices, Uint32Array);
            if (idx) g.setIndex(new THREE.BufferAttribute(idx, 1));
            // Slice-2 face picking — keep the per-triangle BREP face id map so a
            // raycast hit (intersection.faceIndex) resolves to the OCCT face id.
            if (m.faceIds) faceIds = m.faceIds;
          } catch (err) {
            g = null;
            console.error('[forge.v4.scene] tessellate FAILED — body will not render:',
                          { id: s.id, toolId: s.toolId, handle: s.handle, error: err.message });
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
                      faceIds,
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
      <AnimationPoseTicker bundle={bundle} />
      <OctreeCullingTicker bundle={bundle} THREE={THREE} bodies={steps || []} />
      {Array.from(groups.entries()).map(([key, members]) => {
        if (members.length === 1) {
          const m = members[0];
          // Multi-body manager (Slice-5) — honor per-body visibility.
          if (m.body && m.body.visible === false) return null;
          const sel = selection?.ids?.includes(m.id) || selection?.ids?.includes(m.body?.handle);
          // PUSH-31 — read explode offset for this body (defaults to 0,0,0).
          // Wires ExplodedView's offset table to the rendered position so
          // dragging the slider actually moves bodies in the viewport.
          const off = explodeOffsets?.[m.id] || [0, 0, 0];
          return (
            <mesh key={m.key}
                  geometry={m.geometry}
                  position={[off[0] || 0, off[1] || 0, off[2] || 0]}
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
                    el.userData.faceIds = m.faceIds || null;
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
                    // Slice-2 — when the active selection filter is faces (or
                    // edges/verts), resolve the picked BREP face id from the
                    // raycast triangle and report a sub-entity selection so
                    // sketch-on-face / direct-edit can target THIS face. Falls
                    // back to whole-body selection otherwise.
                    const fids = m.faceIds;
                    if ((selection?.kind === 'face') && fids &&
                        typeof e.faceIndex === 'number' && e.faceIndex < fids.length) {
                      const faceId = fids[e.faceIndex];
                      onSelect?.({ kind: 'face',
                                   ids: [m.body?.handle ?? m.id],
                                   bodyHandle: m.body?.handle ?? m.id,
                                   faceId,
                                   point: e.point ? [e.point.x, e.point.y, e.point.z] : null });
                    } else {
                      // Forge-197 — aisOnClick above already applied the
                      // modifier-key routing (Shift extends, Ctrl/Cmd
                      // toggles); its compat shape carries EVERY selected
                      // body id. Pass that through instead of stomping the
                      // set back to a single id.
                      const ais = (typeof window !== 'undefined'
                                   && window.__forgeSelection
                                   && window.__forgeSelection.kind === 'body'
                                   && window.__forgeSelection.ids.length)
                        ? window.__forgeSelection
                        : { kind: 'body', ids: [m.body?.handle ?? m.id] };
                      onSelect?.(ais);
                    }
                  }}>
              {displayState === 'wireframe'
                ? <meshBasicMaterial color={sel ? '#ffffff' : colorForBody(m.body)} wireframe />
                : (() => {
                    // Forge flagship photoreal: when a per-body PBR preset is
                    // assigned (window.__forgeBodyPBR), drive metalness/roughness/
                    // envMapIntensity/clearcoat from the REAL material class
                    // (titanium / nickel superalloy / CFRP / …) via a
                    // meshPhysicalMaterial; otherwise keep the neutral default.
                    const pbr = pbrPropsForBody(m.body);
                    if (pbr && displayState !== 'transparent') {
                      return (
                        <meshPhysicalMaterial
                          color={sel ? '#ffffff' : colorForBody(m.body)}
                          metalness={pbr.metalness ?? 1.0}
                          roughness={pbr.roughness ?? 0.4}
                          envMapIntensity={pbr.envMapIntensity ?? 1.0}
                          clearcoat={pbr.clearcoat ?? 0}
                          clearcoatRoughness={pbr.clearcoatRoughness ?? 0}
                          sheen={pbr.sheen ?? 0} />
                      );
                    }
                    return (
                      <meshStandardMaterial
                        color={sel ? '#ffffff' : colorForBody(m.body)}
                        roughness={0.42} metalness={0.18}
                        transparent={displayState === 'transparent'}
                        opacity={displayState === 'transparent' ? 0.5 : 1} />
                    );
                  })()}
            </mesh>
          );
        }
        return (
          <InstancedGroup key={key} THREE={THREE} bundle={bundle} members={members}
                          displayState={displayState}
                          onSelect={onSelect} selection={selection} />
        );
      })}
    </group>
  );
}

// PUSH-31 — color bodies so multi-part assemblies (e.g. V12 engine)
// don't all visually blend into one grey blob. We use the body's
// numeric handle (stable per body, unique across the session) hashed
// into HSL space.
function colorForBody(body) {
  if (!body) return '#c4ccd6';
  // PUSH-59/71 contract (finally wired): an explicit per-body colour override in
  // window.__forgeBodyColors (Map<handle,'#rrggbb'>) wins over every heuristic.
  // This is the surface BodyColorsPanel + the CAE-in-motion stress colormap
  // overlay write into, so an FEA von-Mises tint paints the real body.
  if (typeof window !== 'undefined' && window.__forgeBodyColors instanceof Map
      && typeof body.handle === 'number') {
    const ov = window.__forgeBodyColors.get(body.handle);
    if (ov) return ov;
  }
  // Forge flagship photoreal: a per-body material preset (window.__forgeBodyPBR,
  // Map<handle, {color,...}>) drives the base colour so a tagged engine body
  // (titanium / nickel superalloy / CFRP …) reads with its real albedo.
  if (typeof window !== 'undefined' && window.__forgeBodyPBR instanceof Map
      && typeof body.handle === 'number') {
    const pbr = window.__forgeBodyPBR.get(body.handle);
    if (pbr && pbr.color) return pbr.color;
  }
  // Role-based colors when the body's name/toolId hints at the kind.
  const name = (body.name || body.toolId || '').toLowerCase();
  // PUSH-31 — recognize V12 / general mech-assembly part roles so a
  // multi-body assembly reads as an engine instead of a candy bowl.
  // Order matters: more-specific patterns first.
  if (/head\b|cylhead|valvecover/.test(name))     return '#3a4a6a'; // dark blue heads
  if (/bore|cylbore|liner/.test(name))            return '#1a1d24'; // dark gun-metal bore
  if (/journal|main|throw|crank|conrod/.test(name)) return '#a02d2d'; // crank red
  if (/pan|sump/.test(name))                       return '#8a939e'; // light cast pan
  if (/deck|block|cylblock/.test(name))            return '#6a737d'; // cast iron / aluminium block
  if (/cam\b|valve|piston/.test(name))             return '#c98a3c'; // bronze tone
  if (/fillet|chamfer/.test(name))      return '#e0af68';   // warm accent
  if (/cut|hole|drill/.test(name))      return '#3a1f1f';   // dark cavity
  if (/pattern|linear|circular/.test(name)) return '#7aa2f7'; // pattern blue
  if (/revolve/.test(name))             return '#bb9af7';
  if (/sweep|loft/.test(name))          return '#9ece6a';
  // Default: hash the numeric handle so each Extrude gets a stable hue.
  const h = (typeof body.handle === 'number'
    ? body.handle
    : (body.id || '').split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  );
  const hue = (Math.abs(h) * 37) % 360;
  return `hsl(${hue}, 45%, 60%)`;
}

// Forge flagship photoreal — return the per-body PBR preset (metalness,
// roughness, envMapIntensity, clearcoat …) from window.__forgeBodyPBR
// (Map<handle, preset>) so the SceneMeshes single-mesh path can render a body
// with its real engineering reflectance. Returns null when no preset is
// assigned (keeps the neutral default look for ordinary modelling bodies).
function pbrPropsForBody(body) {
  if (!body || typeof window === 'undefined') return null;
  if (!(window.__forgeBodyPBR instanceof Map)) return null;
  if (typeof body.handle !== 'number') return null;
  return window.__forgeBodyPBR.get(body.handle) || null;
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
// PUSH-57 — read window.__forgeAnimationPose (Map<handle, {pos:[x,y,z]}>)
// each frame and apply the per-body translation to whichever rendered
// mesh tags itself with userData.body.handle === <handle>. The pose is
// published by AnimationTimelineWorkbench when its tracks are bound to
// the real scene (Build-from-bodies button); otherwise the map is
// empty and the ticker is a no-op. Imperative position mutation skips
// React re-renders, which is essential for 60 fps scrubbing.
function AnimationPoseTicker({ bundle }) {
  const { useFrame, useThree } = bundle.r3f;
  const { scene } = useThree();
  const diagRef = React.useRef({ ticks: 0, lastApplied: 0 });
  useFrame(() => {
    if (typeof window === 'undefined') return;
    diagRef.current.ticks += 1;
    const pose = window.__forgeAnimationPose;
    if (!pose || typeof pose.get !== 'function' || pose.size === 0) return;
    let applied = 0;
    scene.traverse((obj) => {
      const handle = obj?.userData?.body?.handle;
      if (typeof handle !== 'number') return;
      const p = pose.get(handle);
      // p.pos may be a Float64Array (kernel ABI) or a plain array — both
      // are indexable, so don't bail on Array.isArray.
      if (p && p.pos && typeof p.pos.length === 'number' && p.pos.length >= 3) {
        obj.position.set(
          Number(p.pos[0]) || 0,
          Number(p.pos[1]) || 0,
          Number(p.pos[2]) || 0);
        applied += 1;
      }
      // Flagship rotor-spin: when the pose carries a quaternion (set by
      // forgeFlagshipRender.setRotorSpin) apply it so a rotating body actually
      // turns about the engine axis. Absent quat → orientation untouched.
      if (p && p.quat && typeof p.quat.length === 'number' && p.quat.length === 4) {
        obj.quaternion.set(
          Number(p.quat[0]) || 0, Number(p.quat[1]) || 0,
          Number(p.quat[2]) || 0, Number(p.quat[3]) || 1);
        if (!(p.pos && p.pos.length >= 3)) applied += 1;
      }
    });
    diagRef.current.lastApplied = applied;
    if (typeof window !== 'undefined') {
      window.__forgeAnimationTickerStats = {
        ticks: diagRef.current.ticks,
        lastApplied: diagRef.current.lastApplied,
        poseSize: pose.size,
      };
    }
  });
  return null;
}

// PUSH-204 — Octree frustum culling ticker. Each frame:
//   1. (Re)build the octree if the bodies-array identity changed.
//   2. Extract the 6 frustum planes from camera.projectionMatrix ×
//      camera.matrixWorldInverse via OctreeIndex.planesFromCamera.
//   3. Query the octree → Set<id>.
//   4. Publish to window.__forgeVisibleBodies for SceneMeshes / e2e.
function OctreeCullingTicker({ bundle, THREE, bodies }) {
  const { useFrame, useThree } = bundle.r3f;
  const { camera } = useThree();
  const lastBodiesRef = React.useRef(null);
  const octreeRef = React.useRef(null);
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      try { installOctreeWindowApi(); } catch (e) { /* noop — surface only */ }
    }
  }, []);
  useFrame(() => {
    if (typeof window === 'undefined') return;
    if (!bodies || bodies.length === 0) {
      try { window.__forgeVisibleBodies = new Set(); } catch {}
      return;
    }
    if (lastBodiesRef.current !== bodies) {
      lastBodiesRef.current = bodies;
      const items = [];
      for (const b of bodies) {
        const id = b?.id ?? b?.body?.id ?? b?.handle;
        if (id == null) continue;
        const xform = b.xform || b.spec?.cells?.[0] || { x: 0, y: 0, z: 0 };
        const bbox = b.spec?.bbox || b.bbox || null;
        const half = 50;
        const cx = (xform.x || 0), cy = (xform.y || 0), cz = (xform.z || 0);
        const aabb = bbox
          ? { minX: cx + bbox.minX, minY: cy + bbox.minY, minZ: cz + bbox.minZ,
              maxX: cx + bbox.maxX, maxY: cy + bbox.maxY, maxZ: cz + bbox.maxZ }
          : { minX: cx - half, minY: cy - half, minZ: cz - half,
              maxX: cx + half, maxY: cy + half, maxZ: cz + half };
        items.push({ id, aabb });
      }
      try { octreeRef.current = new OctreeIndex(items); }
      catch (e) { octreeRef.current = null; }
    }
    const idx = octreeRef.current;
    if (!idx) return;
    camera.updateMatrixWorld();
    const planes = OctreeIndex.planesFromCamera(camera);
    const visible = idx.queryFrustum(planes);
    try {
      window.__forgeVisibleBodies = visible instanceof Set ? visible : new Set(visible);
    } catch {}
  });
  return null;
}

function LodSchedulerTicker({ bundle, THREE, bodies }) {
  const { useFrame, useThree } = bundle.r3f;
  const { camera, size } = useThree();
  const frustum = React.useRef(new THREE.Frustum());
  const matrix = React.useRef(new THREE.Matrix4());
  // PUSH-205 — mirror the scheduler's per-body level decisions into
  // window.__forgeLodLevel so InstancedGroup can detect level changes
  // and dispatch `forge:lod-needed` events for kernel re-tessellation.
  // Keeping a stable Map instance avoids the GC pressure of allocating
  // a new Map per frame (one per body-list ≈ 100k bodies in the
  // stress scene).
  const levelMap = React.useRef(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!levelMap.current) levelMap.current = new Map();
    window.__forgeLodLevel = levelMap.current;
    return () => {
      if (typeof window !== 'undefined' && window.__forgeLodLevel === levelMap.current) {
        window.__forgeLodLevel = null;
      }
    };
  }, []);
  useFrame(() => {
    if (!bodies || bodies.length === 0) {
      // Keep the level map alive but emptied so consumers don't read
      // stale entries from a previous body-list.
      if (levelMap.current && levelMap.current.size > 0) levelMap.current.clear();
      return;
    }
    camera.updateMatrixWorld();
    matrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(matrix.current);
    lodTick({
      camera, bodies, frustum: frustum.current, THREE,
      screenH: size?.height ?? 1000,
      fovRad: (camera.fov || 45) * Math.PI / 180,
    });
    // Roll the scheduler's decisions into the stable level map. We don't
    // wipe the map between frames — entries are overwritten in place so
    // a body that disappeared from `bodies` is pruned below.
    if (typeof window === 'undefined' || !levelMap.current) return;
    const lm = levelMap.current;
    const dec = window.__forgeLodDecisions;
    if (!dec || typeof dec.get !== 'function') return;
    // First pass: copy current decisions into the level map.
    const seen = new Set();
    for (const b of bodies) {
      if (!b || !b.id) continue;
      const d = dec.get(b.id);
      if (!d) continue;
      const lvl = (typeof d.level === 'number') ? d.level : 0;
      lm.set(b.id, lvl);
      seen.add(b.id);
    }
    // Second pass: prune stale entries (bodies no longer in the scene)
    // so the map size stays bounded. The cost is O(map.size) but only
    // happens when bodies disappear — typical scenes hold steady.
    if (lm.size > seen.size) {
      for (const id of lm.keys()) {
        if (!seen.has(id)) lm.delete(id);
      }
    }
  });
  return null;
}

function InstancedGroup({ THREE, bundle, members, displayState, onSelect, selection }) {
  // All members share geometry — use the first.
  const geom = members[0].geometry;
  const ref = React.useRef();
  const tmpMat = React.useRef(new THREE.Matrix4());
  const ZERO_SCALE = React.useRef(new THREE.Matrix4().makeScale(0, 0, 0));
  const HIDE_POS = React.useRef(new THREE.Vector3(0, -1e6, 0));  // safely off-screen

  // PUSH-205 — per-instance hidden flags + last-known LOD level. We
  // hold these on a ref so they survive across frames without
  // triggering React re-renders.
  const prevHidden = React.useRef(null);
  const prevLevel = React.useRef(null);

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
    // Reset per-instance trackers when membership changes.
    prevHidden.current = new Uint8Array(members.length);
    prevLevel.current = new Int8Array(members.length).fill(-1);
  }, [THREE, members]);

  // PUSH-205 — per-frame consumer of:
  //   • window.__forgeLodDecisions (Map<id, {hidden, level, dist}>)
  //     published by LodSchedulerTicker → frame-by-frame "the scheduler
  //     wants this body hidden / at level N"
  //   • window.__forgeVisibleBodies (Set<id>) published by
  //     OctreeCullingTicker → octree's frustum cull (O(log N + V))
  //   • window.__forgeLodLevel (Map<id, level>) — same payload as the
  //     LOD scheduler's decision but stable across frames; this loop
  //     dispatches `forge:lod-needed` on level transitions so the
  //     kernel can asynchronously tessellate at the chosen LOD.
  //
  // The two cull sources are UNION'd: a body is hidden if either the
  // LOD scheduler tagged it hidden OR the octree's visible set does
  // NOT contain its id. This keeps both systems honest — if the
  // scheduler says "show me" but the octree says "not in frustum", we
  // still skip the raster cost. Same matrix-mutation batching as
  // Forge-125: one needsUpdate per frame.
  //
  // Forge-125 dispatch is preserved via the composed onLevelChange
  // listener set elsewhere — we do NOT remove that, since it handles
  // geometry swaps for kernel re-tessellation.
  // bundle is always provided by the parent ViewportScene (which only
  // renders when bundle is loaded), so `useFrame` is safe to call
  // unconditionally — and MUST be, since hooks can't be conditional.
  const { useFrame } = bundle.r3f;
  useFrame(() => {
    if (!ref.current) return;
    if (typeof window === 'undefined') return;
    const decisions = window.__forgeLodDecisions;
    const visible   = window.__forgeVisibleBodies;
    const levelMap  = window.__forgeLodLevel;
    const visibleIsSet = visible instanceof Set;
    let dirty = false;
    const ph = prevHidden.current;
    const pl = prevLevel.current;
    if (!ph || ph.length !== members.length) return;
    for (let i = 0; i < members.length; i++) {
      const mb = members[i];
      const bid = mb.body?.id ?? mb.id;
      const bhandle = mb.body?.handle;
      // LOD scheduler hidden flag.
      const d = decisions?.get?.(bid);
      const schedHidden = d ? !!d.hidden : false;
      // Octree visibility — empty set or no set means "no octree yet"
      // → don't cull (avoid blanking the viewport before the index
      // builds on the first frame).
      let octreeHidden = false;
      if (visibleIsSet && visible.size > 0) {
        const inVisByBid = bid != null && visible.has(bid);
        const inVisByHandle = bhandle != null && visible.has(bhandle);
        octreeHidden = !(inVisByBid || inVisByHandle);
      }
      const hide = schedHidden || octreeHidden;
      if (hide && !ph[i]) {
        ref.current.setMatrixAt(i, ZERO_SCALE.current);
        ph[i] = 1; dirty = true;
      } else if (!hide && ph[i]) {
        const xform = mb.body.xform || mb.body.spec?.cells?.[0] || { x: 0, y: 0, z: 0 };
        tmpMat.current.makeTranslation(xform.x || 0, xform.y || 0, xform.z || 0);
        ref.current.setMatrixAt(i, tmpMat.current);
        ph[i] = 0; dirty = true;
      }
      // LOD level transition → emit forge:lod-needed so the kernel
      // can tessellate. We only dispatch when the level actually
      // changed and the body is currently visible (no point
      // tessellating an off-screen body at higher resolution).
      if (!hide && levelMap && typeof levelMap.get === 'function' && bid != null) {
        const lvl = levelMap.get(bid);
        if (typeof lvl === 'number' && lvl !== pl[i]) {
          pl[i] = lvl;
          try {
            window.dispatchEvent(new CustomEvent('forge:lod-needed', {
              detail: { bodyId: bid, level: lvl, handle: bhandle ?? null },
            }));
          } catch { /* ignore — JSDOM, sealed window, etc. */ }
        }
      }
    }
    if (dirty) ref.current.instanceMatrix.needsUpdate = true;
  });

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

function ViewportHUD({ steps = [] } = {}) {
  // Forge-79 — viewport is now bare. Status (wb · view · displayState)
  // lives in the bottom status bar, axes triad is provided by the drei
  // GizmoHelper, and the scale bar / selection HUD were redundant with
  // the right Properties panel + bottom status. Less is more.
  //
  // PUSH-205 (Slice-160) — for the 100k-part regime, a tiny
  // `visible / total` chip lives in the lower-right corner. It reads
  // `window.__forgeVisibleBodies` (Set published by OctreeCullingTicker)
  // and `window.__forgeBodies` / the live `steps` prop for the total.
  // Below 50 bodies the octree is irrelevant noise and the chip stays
  // hidden so the viewport reads clean.
  const total = Array.isArray(steps) ? steps.length : 0;
  const [visibleCount, setVisibleCount] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (total <= 50) return undefined;
    let raf = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const vs = window.__forgeVisibleBodies;
      const n = (vs instanceof Set) ? vs.size : 0;
      setVisibleCount((prev) => (prev === n ? prev : n));
      // Throttle to every ~250 ms — the chip is informational, not a
      // perf-critical readout. The full per-frame loop already lives in
      // InstancedGroup; we don't need to re-render the HUD that often.
      raf = window.setTimeout(tick, 250);
    };
    raf = window.setTimeout(tick, 250);
    return () => {
      mounted = false;
      if (raf) window.clearTimeout(raf);
    };
  }, [total]);
  if (total <= 50) return null;
  return (
    <div data-testid="forge-viewport-cullchip"
         style={{
           position: 'absolute', right: 12, bottom: 12,
           padding: '4px 10px', borderRadius: 14,
           background: 'rgba(20, 22, 27, 0.78)',
           color: '#cfd5e1',
           fontFamily: 'var(--forge-mono, monospace)',
           fontSize: 11, letterSpacing: '0.05em',
           border: '1px solid rgba(255, 255, 255, 0.08)',
           boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
           pointerEvents: 'none', userSelect: 'none',
           zIndex: 14,
         }}>
      <span style={{ opacity: 0.65 }}>visible </span>
      <span style={{ color: '#9ece6a' }}>{visibleCount}</span>
      <span style={{ opacity: 0.65 }}> / {total}</span>
    </div>
  );
}
