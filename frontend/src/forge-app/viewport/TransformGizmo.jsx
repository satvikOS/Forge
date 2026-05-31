/**
 * TransformGizmo — manipulator on the active selection.
 *
 * Wraps drei's `<TransformControls>` so the user can translate, rotate
 * or scale the selected body (or assembly instance). Tab cycles modes;
 * the toolbar can also drive `mode` from above.
 *
 * On drag end:
 *   - If the selection is an instance (kind === 'instance'), we build
 *     the resulting 4×4 world matrix and call
 *     `forge.updateTransform(instanceId, matrix)` so the kernel keeps
 *     the placement in sync.
 *   - If it's a free body (kind === 'body'), the kernel has no
 *     equivalent (BREP bodies are at their canonical pose), so we
 *     emit `onConvertToFeature` so the UI can offer "Convert to Move
 *     feature" — the actual conversion lives in Forge-9 FeatureTree.
 *
 * Importantly: we never crash when there's no selection. drei's
 * TransformControls is mounted lazily.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';

import { getForge, isForgeReady } from '../../kernel/forge/index.js';

const GIZMO_MODES = ['translate', 'rotate', 'scale'];

export function TransformGizmo({ meshes = [], selection = [],
                                  mode = 'translate',
                                  onConvertToFeature = () => {},
                                  onTransformEnd = () => {} }) {
  const [activeMode, setActiveMode] = useState(mode);
  const targetRef = useRef(null);

  // Sync external mode → internal.
  useEffect(() => { setActiveMode(mode); }, [mode]);

  // Tab cycles modes when the canvas has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setActiveMode((m) => {
        const i = GIZMO_MODES.indexOf(m);
        return GIZMO_MODES[(i + 1) % GIZMO_MODES.length];
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!selection || selection.length === 0) return null;
  const first = selection[0];
  const target = meshes.find((m) => m.userData?.forge?.handle === first.handle);
  if (!target) return null;
  targetRef.current = target;

  const handleDragEnd = () => {
    const m = targetRef.current;
    if (!m) return;
    // Compose the resulting world matrix from the mesh's current TRS.
    m.updateMatrix();
    const mat = m.matrix.toArray();
    onTransformEnd({ handle: first.handle, matrix: mat });

    if (first.kind === 'instance') {
      try {
        if (isForgeReady()) {
          const forge = getForge();
          if (typeof forge.updateTransform === 'function') {
            forge.updateTransform(first.handle, mat);
          }
        }
      } catch (e) {
        console.warn('[forge.gizmo] updateTransform failed', e);
      }
    } else if (first.kind === 'body') {
      onConvertToFeature({ handle: first.handle, matrix: mat });
    }
  };

  return (
    <TransformControls object={target}
                       mode={activeMode}
                       onMouseUp={handleDragEnd} />
  );
}

export default TransformGizmo;
