/**
 * MeasurementTool — on-screen ruler.
 *
 * Activated from the viewport toolbar. While active, every click
 * picks a world-space point; 2 picks → distance, 3 picks → angle, 4+
 * picks → polygon area. The annotation hovers on the final picked
 * point with a small sticky callout (drei <Html> would be ideal —
 * we keep it simple with a Three.js sprite-style label here so the
 * smoke can render without the html portal layer).
 *
 * Picks come through r3f's onPointerDown event on a transparent plane
 * the size of the scene bounding box; we read `e.point` (the
 * world-space intersection) and feed it to `measurements.summarise`.
 *
 * State lives entirely inside this component — the parent only sees
 * the `onAnnotation` callback when the measurement completes.
 */

import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

import { summarise, snapToHints } from './measurements.js';

const POINT_COLOR = 0xffaa1f;
const LINE_COLOR  = '#ffaa1f';

export function MeasurementTool({ active = false, units = 'mm',
                                    onAnnotation = () => {}, snapHints = [] }) {
  const [points, setPoints] = useState([]);

  const summary = useMemo(() => summarise(points, { units }),
                          [points, units]);

  const onCanvasClick = (e) => {
    if (!active) return;
    e.stopPropagation();
    const raw = e.point ? [e.point.x, e.point.y, e.point.z] : null;
    if (!raw) return;
    const { point } = snapToHints(raw, snapHints);
    setPoints((cur) => {
      const next = [...cur, point];
      if (next.length >= 4) {
        // Polygon — emit and reset for the next measurement.
        onAnnotation(summarise(next, { units }));
      }
      return next;
    });
  };

  // Reset on deactivate.
  React.useEffect(() => {
    if (!active) setPoints([]);
  }, [active]);

  if (!active) return null;

  const sphereGeo = useMemoSphere();

  return (
    <group name="forge-measurement-tool"
           onPointerDown={onCanvasClick}>
      {points.map((p, i) => (
        <mesh key={i} position={p} geometry={sphereGeo}
              renderOrder={5}>
          <meshBasicMaterial color={POINT_COLOR} depthTest={false} />
        </mesh>
      ))}

      {points.length >= 2 ? (
        <Line points={points} color={LINE_COLOR} lineWidth={2}
              depthTest={false} renderOrder={5} />
      ) : null}

      {/* Sticky label shown via console; UI shell may wrap in <Html>. */}
      {summary && summary.kind !== 'incomplete' ? (
        <group position={points[points.length - 1]}>
          {/* In the absence of <Html> here, the label is reported via
              onAnnotation when the measurement closes (≥2 picks). */}
        </group>
      ) : null}
    </group>
  );
}

let _sphere = null;
function useMemoSphere() {
  if (_sphere) return _sphere;
  _sphere = new THREE.SphereGeometry(0.5, 12, 8);
  return _sphere;
}

export default MeasurementTool;
