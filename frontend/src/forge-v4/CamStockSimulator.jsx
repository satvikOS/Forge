// Forge-92 — CAM Stock Simulator + toolpath playback.
//
// Renders three things over the viewport canvas:
//
//   1. A wireframe stock box (the AABB the panel configured) so the
//      operator can visually confirm where the stock sits relative to
//      the part body.
//
//   2. A polyline trace of the toolpath. Cutting moves are drawn in the
//      copper accent colour; rapids are drawn dashed-grey.
//
//   3. A cutter cone/cylinder animated along the toolpath as a
//      timeline-driven playhead. Play / Pause / Scrub controls live in
//      the parent ManufacturingWorkbench — this component owns only the
//      3D layer + emits a small overlay control strip when standalone.
//
// All values are mm. The component lazy-imports three / r3f / drei the
// same way Viewport.jsx does — we never pull r3f into the SSR bundle.

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { toolpathSegments } from './camDispatch.js';

export function CamStockSimulator({
  stockAabb,           // Float64Array | [minX,minY,minZ,maxX,maxY,maxZ]
  toolpath,            // native toolpath { moves: Float32Array, moveCount }
  tool,                // { diameter, length, type }
  playing = false,     // bool — drive the playhead through moves
  cursorIndex = 0,     // int — current move index when not playing
  speedMmMin = 6000,   // playback speed (mm/min of simulated feed)
  onCursorChange,      // (i) => void — emits while playing
  visible = true,
}) {
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
        console.warn('[forge.v4.cam-sim] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;
  if (!bundle) {
    return (
      <div data-testid="forge-cam-sim-loading"
           style={{
             position: 'absolute', inset: 0,
             display: 'flex', alignItems: 'center', justifyContent: 'center',
             color: 'var(--forge-ink-mute)', fontSize: 11,
             fontFamily: 'var(--forge-mono)',
           }}>
        loading sim viewport…
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <CamSimScene bundle={bundle}
                   stockAabb={stockAabb}
                   toolpath={toolpath}
                   tool={tool}
                   playing={playing}
                   cursorIndex={cursorIndex}
                   speedMmMin={speedMmMin}
                   onCursorChange={onCursorChange} />
    </Suspense>
  );
}

function CamSimScene({ bundle, stockAabb, toolpath, tool,
                       playing, cursorIndex, speedMmMin, onCursorChange }) {
  const { Canvas } = bundle.r3f;
  const { OrbitControls, Line, Grid } = bundle.drei;
  const THREE = bundle.three;

  const segs = React.useMemo(() => toolpathSegments(toolpath), [toolpath]);
  const aabb = stockAabb instanceof Float64Array
    ? stockAabb
    : (Array.isArray(stockAabb) ? Float64Array.from(stockAabb) : null);

  // ────────────── scene layout
  const stock = aabb ? {
    cx: (aabb[0] + aabb[3]) / 2,
    cy: (aabb[1] + aabb[4]) / 2,
    cz: (aabb[2] + aabb[5]) / 2,
    dx: aabb[3] - aabb[0],
    dy: aabb[4] - aabb[1],
    dz: aabb[5] - aabb[2],
  } : null;

  // Frame the camera so the larger of (stock, toolpath bbox) reads.
  const camTarget = stock ? [stock.cx, stock.cz, stock.cy] : [0, 0, 0];
  const camDist = stock ? Math.max(stock.dx, stock.dy, stock.dz) * 2.4 : 100;
  const camPos = [camTarget[0] + camDist, camTarget[1] + camDist * 0.7, camTarget[2] + camDist];

  // Cutting vs rapid lines split — drei <Line> wants its own segment array
  // for each color, so we build them once.
  const { cutPoints, rapidPoints } = React.useMemo(() => {
    if (!segs || segs.length < 2) return { cutPoints: [], rapidPoints: [] };
    const cut = [];
    const rapid = [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1], b = segs[i];
      // Three coords: convert kernel (x,y,z) to scene (x,z,y) since the
      // viewport Y is up. Toolpath origin matches stock origin.
      const pa = [a.x, a.z, a.y];
      const pb = [b.x, b.z, b.y];
      if (b.cutting) {
        cut.push(pa, pb);
      } else {
        rapid.push(pa, pb);
      }
    }
    return { cutPoints: cut, rapidPoints: rapid };
  }, [segs]);

  // ────────────── animated cursor
  const playRef = useRef({ idx: cursorIndex || 0, elapsedMm: 0, prev: 0 });
  useEffect(() => { playRef.current.idx = cursorIndex || 0; }, [cursorIndex]);
  // Cutter mesh follows the active move's endpoint.
  const cutterPos = React.useMemo(() => {
    if (!segs || segs.length === 0) return [0, 0, 0];
    const i = Math.max(0, Math.min(segs.length - 1, cursorIndex || 0));
    const s = segs[i];
    return [s.x, s.z, s.y];
  }, [segs, cursorIndex]);

  return (
    <Canvas
      camera={{ position: camPos, fov: 42, near: 0.1, far: 5000 }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100%', height: '100%' }}
      data-testid="forge-cam-sim-canvas"
    >
      <color attach="background" args={[0.04, 0.05, 0.07]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[60, 80, 40]} intensity={0.85} />
      <directionalLight position={[-40, -20, -60]} intensity={0.25} />
      <Grid args={[400, 400]}
            cellColor={'#2a2f3d'} sectionColor={'#3a4253'}
            sectionSize={10} fadeDistance={250} fadeStrength={1.5}
            infiniteGrid
            position={[0, stock ? aabb[2] - 0.01 : -0.01, 0]} />

      {/* Stock — wireframe overlay */}
      {stock && (
        <mesh position={[stock.cx, stock.cz, stock.cy]}>
          <boxGeometry args={[stock.dx, stock.dz, stock.dy]} />
          <meshBasicMaterial color={'#e1b250'} wireframe transparent opacity={0.55} />
        </mesh>
      )}

      {/* Toolpath polyline — cutting in accent, rapids dashed grey */}
      {cutPoints.length >= 2 && (
        <Line points={cutPoints} color={'#ffb37a'} lineWidth={1.6}
              segments />
      )}
      {rapidPoints.length >= 2 && (
        <Line points={rapidPoints} color={'#5a6271'} lineWidth={0.9}
              dashed dashSize={1.2} gapSize={0.8} segments />
      )}

      {/* Cutter mesh — cone (for VBit/Chamfer/Drill) or cylinder */}
      {tool && (
        <CutterMesh THREE={THREE} tool={tool} position={cutterPos} />
      )}

      <PlaybackTick playing={playing} segs={segs}
                    speedMmMin={speedMmMin}
                    cursorIndex={cursorIndex}
                    onCursorChange={onCursorChange}
                    useFrame={bundle.r3f.useFrame} />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                     target={camTarget}
                     minDistance={5} maxDistance={1500} />
    </Canvas>
  );
}

function CutterMesh({ THREE, tool, position }) {
  const r = (tool.diameter || 6) / 2;
  const h = Math.max(8, Math.min(40, tool.length || 25));
  const isCone = (tool.type === 'VBit' || tool.type === 'Drill' ||
                  tool.type === 'ChamferTool');
  // Position the geometry so the cutting tip sits at the move endpoint.
  // For cones, the tip is at local origin once the geometry's pivot is
  // offset by half its height.
  return (
    <group position={position}>
      <mesh position={[0, h / 2, 0]}>
        {isCone
          ? <coneGeometry args={[r, h, 24]} />
          : <cylinderGeometry args={[r, r, h, 24]} />}
        <meshStandardMaterial color={'#c0c5cf'}
                              roughness={0.35} metalness={0.7} />
      </mesh>
      {/* spindle stub */}
      <mesh position={[0, h + 6, 0]}>
        <cylinderGeometry args={[r * 1.4, r * 1.4, 8, 16]} />
        <meshStandardMaterial color={'#3d4250'} roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

// useFrame-driven cursor advance. Reads `segs` + speedMmMin and emits
// onCursorChange when the elapsed move distance crosses a segment.
function PlaybackTick({ playing, segs, speedMmMin, cursorIndex,
                       onCursorChange, useFrame }) {
  const stateRef = useRef({ t0: 0, baseIdx: cursorIndex || 0 });
  React.useEffect(() => {
    stateRef.current = { t0: performance.now(), baseIdx: cursorIndex || 0 };
  }, [playing, cursorIndex]);
  useFrame(() => {
    if (!playing || !segs || segs.length < 2) return;
    const s = stateRef.current;
    const dtSec = (performance.now() - s.t0) / 1000;
    const dMm = dtSec * (speedMmMin / 60);
    // Walk forward until we've consumed dMm worth of move length.
    let consumed = 0;
    let i = s.baseIdx;
    while (i < segs.length - 1) {
      const a = segs[i], b = segs[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (consumed + segLen > dMm) break;
      consumed += segLen;
      i++;
    }
    if (i !== (cursorIndex || 0)) onCursorChange?.(i);
    // Loop back to the start when we run off the end of the program.
    if (i >= segs.length - 1) {
      stateRef.current = { t0: performance.now(), baseIdx: 0 };
      onCursorChange?.(0);
    }
  });
  return null;
}

export default CamStockSimulator;
