/**
 * SelectionHighlight — outline shader for hovered + selected meshes.
 *
 * Approach: "inflate + flip-normals" shell. For each selected mesh we
 * mount a sibling `<mesh>` that:
 *   1. Reuses the same BufferGeometry (no extra allocation).
 *   2. Renders with `side: THREE.BackSide` so we only see the outline.
 *   3. Scales out by a small factor in the vertex shader's normal
 *      direction — implemented as a 1.02 uniform scale on the mesh
 *      transform (good enough for opaque-on-dark; postprocessing-based
 *      OutlinePass is a follow-up).
 *
 * Click picking lives here too: a single canvas-level `onPointerDown`
 * raycasts via the @react-three/fiber event system, then resolves +
 * filters via `selectionLogic.js`.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';

import { resolvePicks, nearestPick, nextSelection } from './selectionLogic.js';

const OUTLINE_COLORS = {
  selected: 0xffaa1f,   // SolidWorks orange
  hover:    0x77bbff,
};

function makeOutlineMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    transparent: true,
    opacity: 0.85,
  });
}

/**
 * The shell mesh — instantiated per selected body. Inflates 2 % along
 * the bounding-sphere radius axis (uniform scale) so the outline sits
 * just outside the surface.
 */
function ShellMesh({ baseMesh, color }) {
  const mat = useMemo(() => makeOutlineMaterial(color), [color]);
  if (!baseMesh || !baseMesh.geometry) return null;
  const pos = baseMesh.position ? baseMesh.position.toArray() : [0, 0, 0];
  const quat = baseMesh.quaternion ? baseMesh.quaternion.toArray() : [0, 0, 0, 1];
  return (
    <mesh geometry={baseMesh.geometry}
          material={mat}
          position={pos}
          quaternion={quat}
          scale={[1.02, 1.02, 1.02]}
          renderOrder={2}
          frustumCulled={false} />
  );
}

export function SelectionHighlight({ meshes = [], selection = [],
                                      onSelect, bodyMesh,
                                      selectionFilter }) {
  // Map handle → mesh so we can look up which sibling to outline.
  const meshByHandle = useMemo(() => {
    const m = new Map();
    for (const mesh of meshes) {
      const ud = mesh.userData && mesh.userData.forge;
      if (ud && ud.handle) m.set(ud.handle, mesh);
    }
    return m;
  }, [meshes]);

  // Click → raycast → resolve → emit selection.
  const handlePointerDown = (e) => {
    if (!onSelect || !bodyMesh) return;
    e.stopPropagation();
    // r3f's event carries an `intersections` array (sorted near→far).
    const intersections = e.intersections || (e.intersection ? [e.intersection] : []);
    const picks = resolvePicks(intersections, bodyMesh, selectionFilter);
    const winner = nearestPick(picks);
    if (!winner) return;
    const mode = e.shiftKey || e.ctrlKey || e.metaKey ? 'add' : 'replace';
    const next = nextSelection(selection, winner, mode);
    onSelect(next);
  };

  return (
    <group name="forge-selection-outlines"
           onPointerDown={handlePointerDown}>
      {selection.map((s, i) => {
        const base = meshByHandle.get(s.handle);
        if (!base) return null;
        return <ShellMesh key={`${s.handle}-${i}`}
                          baseMesh={base}
                          color={OUTLINE_COLORS.selected} />;
      })}
    </group>
  );
}

export default SelectionHighlight;
