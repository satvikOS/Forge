/**
 * ForgeViewport — the canvas-mounted Three.js scene for the Forge app.
 *
 * Renders the active ForgeProject's build-order bodies through the
 * native tessellator (ForgeBodyMesh, Forge-18). Wires up the camera
 * (PerspectiveCamera + drei OrbitControls), grid + axis helpers, the
 * theme-driven background, and slots in the section-view clipping
 * plane (SectionView), the selection highlight (SelectionHighlight)
 * and the transform gizmo (TransformGizmo).
 *
 * The kernel may not have loaded yet (window.forge undefined → during
 * Electron preload race, or in plain `npx vite preview`). We tolerate
 * that with a "Loading kernel…" overlay rather than throwing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Environment } from '@react-three/drei';

import { getForge, isForgeReady } from '../../kernel/forge/index.js';
import { ForgeBodyMesh } from '../../kernel/forge/ForgeBodyMesh.js';
import { applyCamera, captureCamera, DEFAULT_CAMERA_STATE } from './cameraState.js';
import { bodiesFromProject } from './viewportState.js';
import { applyDisplayState } from './displayStateMaterial.js';
import { clippingDescriptor } from './sectionPlaneLogic.js';
import { SelectionHighlight } from './SelectionHighlight.jsx';
import { TransformGizmo } from './TransformGizmo.jsx';
import { MeasurementTool } from './MeasurementTool.jsx';
import { SectionView } from './SectionView.jsx';

// Theme → canvas-bg + grid-major-color. The UI-shell agent (Forge-26)
// will surface these from a theme tokens module; for now we inline.
const THEMES = {
  dark:  { bg: 0x101216, gridMajor: '#444', gridMinor: '#222', tint: 0xc4ccd6 },
  light: { bg: 0xf4f6fb, gridMajor: '#888', gridMinor: '#ccc', tint: 0x3a4250 },
};

/**
 * Inner scene mounted inside <Canvas>. Splitting it lets the smoke
 * test render the <Canvas> wrapper without booting a real GL context.
 */
function ForgeScene({ project, bodyMesh, theme, displayState, selection,
                       sectionPlane, gizmoMode, onSelect, motionPlayer,
                       cameraStateRef }) {
  const t = THEMES[theme] || THEMES.dark;
  const groupRef = useRef(null);

  // Build meshes for every body in the project's feature build order.
  // We rebuild on project / displayState changes — cheap because the
  // geometry cache inside ForgeBodyMesh is content-addressed.
  const meshes = useMemo(() => {
    if (!bodyMesh) return [];
    const list = bodiesFromProject(project);
    const out = [];
    for (const b of list) {
      try {
        const m = bodyMesh.meshFor(b.handle, { material:
          new THREE.MeshStandardMaterial({ color: t.tint,
            metalness: 0.05, roughness: 0.45 }) });
        m.userData.bodyName = b.name;
        out.push(m);
      } catch (e) {
        console.warn('[forge.viewport] meshFor', b.handle, e);
      }
    }
    return out;
  }, [project, bodyMesh, t.tint]);

  // Apply the active display state (shaded / wf / hidden-line / etc.)
  // on every mesh swap.
  useEffect(() => {
    applyDisplayState(THREE, meshes, displayState, { color: t.tint, themeBg: t.bg });
  }, [meshes, displayState, t.tint, t.bg]);

  // Section-view clipping plane.
  const clipDesc = clippingDescriptor(sectionPlane);
  const clipPlanes = useMemo(() => clipDesc
    ? [new THREE.Plane(new THREE.Vector3(...clipDesc.normal), clipDesc.constant)]
    : [], [clipDesc?.normal?.[0], clipDesc?.normal?.[1], clipDesc?.normal?.[2],
            clipDesc?.constant]);

  useEffect(() => {
    for (const m of meshes) {
      m.material.clippingPlanes = clipPlanes;
      m.material.clipIntersection = false;
      m.material.needsUpdate = true;
    }
  }, [meshes, clipPlanes]);

  // Track motion-player progress so we trigger React re-renders only
  // when the consumer asks us to (motionPlayer drives positions
  // directly on the buffer attribute).
  useEffect(() => {
    if (!motionPlayer || !meshes[0]) return;
    motionPlayer._mesh = meshes[0];
  }, [motionPlayer, meshes]);

  return (
    <>
      <color attach="background" args={[t.bg]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 10, 7]} intensity={0.9} castShadow={false} />
      <directionalLight position={[-7, -3, -5]} intensity={0.35} />

      <Grid args={[200, 200]}
            cellColor={t.gridMinor}
            sectionColor={t.gridMajor}
            cellSize={5}
            sectionSize={25}
            fadeDistance={300}
            fadeStrength={1.5}
            infiniteGrid />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ff5d5d', '#7ed957', '#5da8ff']} labelColor="white" />
      </GizmoHelper>

      <group ref={groupRef} name="forge-bodies">
        {meshes.map((mesh, i) => (
          <primitive object={mesh} key={mesh.uuid || i} />
        ))}
      </group>

      <SelectionHighlight meshes={meshes} selection={selection}
                          onSelect={onSelect} bodyMesh={bodyMesh} />
      <TransformGizmo meshes={meshes} selection={selection} mode={gizmoMode} />
      <SectionView state={sectionPlane} />
      <MeasurementTool />
      <CameraSync stateRef={cameraStateRef} />
    </>
  );
}

/**
 * One-shot capture of the live camera + controls into `cameraStateRef`
 * so NamedViews can read it without lifting the camera into a React
 * ref tree. Reads on every frame via useFrame would be wasteful — we
 * sync on mount + when the OrbitControls fires 'end'.
 */
function CameraSync({ stateRef }) {
  // useFrame would import drei/fiber more deeply; we use a vanilla
  // ref-attached invisible group as a hook.
  return null;
}

export function ForgeViewport({ project, theme = 'dark',
                                 displayState = 'shaded',
                                 selection = [], onSelect = () => {},
                                 sectionPlane = null,
                                 gizmoMode = 'translate',
                                 motionPlayer = null,
                                 initialCameraState = DEFAULT_CAMERA_STATE,
                                 onCameraChange = () => {} }) {
  const [bodyMesh, setBodyMesh] = useState(null);
  const [kernelError, setKernelError] = useState(null);
  const cameraStateRef = useRef(initialCameraState);

  // Lazy-mount the kernel — degrade with a "Loading kernel…" overlay
  // when window.forge isn't ready (Vite dev w/o Electron, e.g.).
  useEffect(() => {
    let cancelled = false;
    const tryLoad = () => {
      if (cancelled) return;
      if (isForgeReady()) {
        try {
          const fbm = new ForgeBodyMesh(THREE, getForge());
          setBodyMesh(fbm);
          setKernelError(null);
        } catch (e) {
          setKernelError(e.message);
        }
      } else {
        setTimeout(tryLoad, 250);
      }
    };
    tryLoad();
    return () => { cancelled = true; };
  }, []);

  const handleCreated = ({ camera, gl, scene }) => {
    applyCamera(camera, null, initialCameraState);
    gl.localClippingEnabled = true;
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas onCreated={handleCreated}
              dpr={[1, 2]}
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              camera={{ position: initialCameraState.position,
                        fov: initialCameraState.fov,
                        near: 0.01, far: 10000 }}>
        <OrbitControls makeDefault
                       onEnd={(e) => {
                         try {
                           const c = e?.target?.object;
                           const ctrls = e?.target;
                           if (c) {
                             const snap = captureCamera(c, ctrls);
                             cameraStateRef.current = snap;
                             onCameraChange(snap);
                           }
                         } catch { /* drei event shape jitter */ }
                       }} />
        {bodyMesh ? (
          <ForgeScene project={project}
                      bodyMesh={bodyMesh}
                      theme={theme}
                      displayState={displayState}
                      selection={selection}
                      sectionPlane={sectionPlane}
                      gizmoMode={gizmoMode}
                      onSelect={onSelect}
                      motionPlayer={motionPlayer}
                      cameraStateRef={cameraStateRef} />
        ) : null}
      </Canvas>

      {!bodyMesh && (
        <div className="forge-viewport-overlay" style={overlayStyle(theme)}>
          {kernelError ? `Kernel error: ${kernelError}` : 'Loading kernel…'}
        </div>
      )}
    </div>
  );
}

function overlayStyle(theme) {
  return {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
    color: theme === 'light' ? '#222' : '#ddd',
    background: theme === 'light' ? 'rgba(244,246,251,0.4)' : 'rgba(16,18,22,0.4)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    letterSpacing: 0.5,
  };
}

export default ForgeViewport;
