/**
 * SectionView — cutting plane visualisation.
 *
 * The math (offset, normal, clipping descriptor) lives in
 * `sectionPlaneLogic.js`. This component renders the *visible* plane
 * (a translucent quad) so the user can see + drag it. The actual
 * material clippingPlanes are wired by ForgeViewport which reads
 * AppState.sectionPlane and feeds it into each mesh's material.
 *
 * Drag-to-slide is handled with a r3f onPointerMove on a draggable
 * 2D handle (the centre dot of the quad). We surface the new offset
 * via onChange so the parent can mutate AppState.
 */

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

export function SectionView({ state, size = 200,
                                onChange = () => {} }) {
  const groupRef = useRef(null);
  const draggingRef = useRef(false);

  if (!state || !state.enabled) return null;

  // Build a quaternion that takes +Z onto the plane normal.
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
                          new THREE.Vector3(...state.normal));
    return q;
  }, [state.normal[0], state.normal[1], state.normal[2]]);

  const position = useMemo(() => {
    return new THREE.Vector3(...state.normal).multiplyScalar(state.offset);
  }, [state.normal[0], state.normal[1], state.normal[2], state.offset]);

  const onPointerDown = (e) => {
    e.stopPropagation();
    draggingRef.current = { startOffset: state.offset };
  };
  const onPointerUp = () => { draggingRef.current = false; };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    // Project the world-space pointer position onto the plane normal.
    if (!e.point) return;
    const off = e.point.x * state.normal[0] +
                e.point.y * state.normal[1] +
                e.point.z * state.normal[2];
    onChange({ ...state, offset: off });
  };

  return (
    <group ref={groupRef}
           position={position}
           quaternion={quat}
           onPointerDown={onPointerDown}
           onPointerUp={onPointerUp}
           onPointerMove={onPointerMove}>
      <mesh renderOrder={4}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={0x4477ff}
                           transparent
                           opacity={0.12}
                           side={THREE.DoubleSide}
                           depthWrite={false} />
        <Edges color="#4477ff" scale={1} />
      </mesh>
      {/* Centre handle the user grabs to slide. */}
      <mesh renderOrder={5}>
        <sphereGeometry args={[2, 16, 12]} />
        <meshBasicMaterial color={0x4477ff} />
      </mesh>
    </group>
  );
}

export default SectionView;
