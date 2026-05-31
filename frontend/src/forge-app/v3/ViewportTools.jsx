// Forge v3 — viewport tools. Gizmo + measurement + section all live as
// children of the r3f <Canvas>, conditionally mounted by the shell
// based on the active verb. Tests render the wrapper at SSR level —
// the THREE-backed children only mount client-side.

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Forge-56 — Gizmo. Wraps drei's TransformControls so the shell can
// switch mode (translate / rotate / scale) without re-mounting the
// THREE object. Renders nothing in SSR.
export function Gizmo({ mode = 'translate', enabled = true, targetRef,
                        onChange, onDragStart, onDragEnd }) {
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const drei = await import('@react-three/drei');
        if (!cancelled) setBundle(drei);
      } catch { /* keep null → no gizmo */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!bundle || !enabled || !targetRef?.current) return null;
  const { TransformControls } = bundle;
  return (
    <TransformControls
      object={targetRef.current}
      mode={mode}
      size={0.85}
      onObjectChange={onChange}
      onMouseDown={onDragStart}
      onMouseUp={onDragEnd}
    />
  );
}

// Forge-56 — Measurement. Captures point-picks in viewport space and
// computes distance / angle / area based on the active sub-mode.
//
//   mode: 'distance' → 2 picks, render line + label
//         'angle'    → 3 picks, render arc + label
//         'area'     → 3+ picks (close polygon), render polygon + label
//
// State lives in the shell so measurement persists across orbit /
// selection changes. The shell calls `record(point3)` whenever the
// user picks; the component renders the geometry + labels.
export function MeasurementOverlay({ mode = 'distance', points = [], unit = 'mm' }) {
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const [drei, three] = await Promise.all([
          import('@react-three/drei'), import('three'),
        ]);
        if (!cancelled) setBundle({ drei, three });
      } catch { /* no overlay */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!bundle || points.length === 0) return null;
  const { Line, Html } = bundle.drei;
  const THREE = bundle.three;

  if (mode === 'distance' && points.length >= 2) {
    const a = points[0], b = points[1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return (
      <group>
        <Line points={[a, b]} color="#d97a3b" lineWidth={2}
              dashed={false} />
        <Html position={mid} center distanceFactor={32}>
          <span style={{
            color: '#fff', background: 'rgba(217,122,59,0.85)',
            padding: '2px 6px', borderRadius: 3,
            font: '12px JetBrains Mono, monospace', whiteSpace: 'nowrap',
          }}>{d.toFixed(2)} {unit}</span>
        </Html>
      </group>
    );
  }
  if (mode === 'angle' && points.length >= 3) {
    const [p0, p1, p2] = points;
    const v1 = [p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]];
    const v2 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2 || 1))));
    return (
      <group>
        <Line points={[p0, p1, p2]} color="#d97a3b" lineWidth={2} />
        <Html position={p1} center distanceFactor={32}>
          <span style={{
            color: '#fff', background: 'rgba(217,122,59,0.85)',
            padding: '2px 6px', borderRadius: 3,
            font: '12px JetBrains Mono, monospace', whiteSpace: 'nowrap',
          }}>{(ang * 180 / Math.PI).toFixed(1)}°</span>
        </Html>
      </group>
    );
  }
  if (mode === 'area' && points.length >= 3) {
    // Polygon area via the shoelace formula in the average normal plane.
    const closed = [...points, points[0]];
    const area = polygonAreaXY(points);
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[2], 0) / points.length;
    return (
      <group>
        <Line points={closed} color="#d97a3b" lineWidth={2} />
        <Html position={[cx, cy, cz]} center distanceFactor={32}>
          <span style={{
            color: '#fff', background: 'rgba(217,122,59,0.85)',
            padding: '2px 6px', borderRadius: 3,
            font: '12px JetBrains Mono, monospace', whiteSpace: 'nowrap',
          }}>{area.toFixed(2)} {unit}²</span>
        </Html>
      </group>
    );
  }
  return null;
}

// 3D polygon area: project to dominant plane, then shoelace.
export function polygonAreaXY(pts) {
  if (pts.length < 3) return 0;
  // Approx normal from first 3 points to choose projection plane.
  const a = pts[0], b = pts[1], c = pts[2];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  // Drop dominant axis.
  const drop = ax >= ay && ax >= az ? 0 : (ay >= az ? 1 : 2);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const px = drop === 0 ? p[1] : p[0];
    const py = drop === 2 ? p[1] : p[2];
    const qx = drop === 0 ? q[1] : q[0];
    const qy = drop === 2 ? q[1] : q[2];
    sum += (px * qy - qx * py);
  }
  return Math.abs(sum) / 2;
}

// Forge-56 — Section plane. Adds a global clipping plane to the
// renderer so geometry is cut on one side of the plane. Default
// orientation is +X (slices through the YZ plane at the world origin);
// callers can override `plane` to any THREE.Plane equivalent triple
// + d.
export function SectionPlane({ enabled = false,
                               plane = { normal: [1, 0, 0], constant: 0 } }) {
  const [THREE, setTHREE] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const three = await import('three');
        if (!cancelled) setTHREE(three);
      } catch { /* no section */ }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  // Apply the plane to the renderer via r3f's invalidate cycle.
  const planeRef = useRef(null);
  useEffect(() => {
    if (!THREE || !enabled) return;
    const p = new THREE.Plane(
      new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
      plane.constant,
    );
    planeRef.current = p;
    return () => { planeRef.current = null; };
  }, [THREE, enabled, plane.normal[0], plane.normal[1], plane.normal[2], plane.constant]);

  // The visual cut indicator — a thin copper plane mesh on the cut.
  // The actual clipping is wired by the shell into Canvas's gl prop
  // (out of scope for the SSR-safe child component).
  if (!enabled || !THREE) return null;
  const n = plane.normal;
  const c = plane.constant;
  return (
    <group>
      {/* visual rectangle on the section plane (oriented to its normal) */}
      <mesh quaternion={makeQuaternion(THREE, n)}
            position={[n[0] * c, n[1] * c, n[2] * c]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial color="#d97a3b" opacity={0.18} transparent
                           side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function makeQuaternion(THREE, normal) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const q = new THREE.Quaternion();
  q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return q;
}
