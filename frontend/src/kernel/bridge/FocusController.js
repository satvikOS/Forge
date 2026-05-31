/**
 * ArchDisc — Focus Controller
 *
 * Camera and visibility controller that zooms onto a single component
 * by partID and dims all other components for visual emphasis.
 *
 * Usage:
 *   FocusController.focusByPartID(partID, scene, camera, controls);
 *   FocusController.clearFocus(scene);
 *
 * Behavior:
 *   - Camera repositions to frame the target's bounding box
 *   - All other meshes drop to ~10% opacity (configurable)
 *   - InstancedMesh: dims all instances of a different solid; if the target
 *     is itself an instance within an InstancedMesh, that instance gets
 *     full opacity via per-instance color and the rest are dimmed
 *   - clearFocus restores all original materials/visibility
 */

import * as THREE from 'three';

const _origStates = new WeakMap(); // mesh → { material, opacity, transparent }
let _focusedPartID = null;

export default class FocusController {

  /** Find the THREE.Object3D representing a partID in the scene. */
  static findByPartID(partID, scene) {
    let found = null;
    scene.traverse(obj => {
      if (found) return;
      // Regular mesh: userData.partID set on group
      if (obj.userData?.partID === partID) {
        found = { object: obj, kind: 'mesh' };
        return;
      }
      // InstancedMesh: userData.partIDs is array
      if (obj.isInstancedMesh && Array.isArray(obj.userData?.partIDs)) {
        const idx = obj.userData.partIDs.indexOf(partID);
        if (idx >= 0) {
          found = { object: obj, kind: 'instance', index: idx };
        }
      }
    });
    return found;
  }

  /** Compute world-space bounding box for a target (mesh or instance). */
  static computeTargetBox(target) {
    if (!target) return null;
    const box = new THREE.Box3();
    if (target.kind === 'mesh') {
      box.setFromObject(target.object);
    } else if (target.kind === 'instance') {
      const inst = target.object;
      const matrix = new THREE.Matrix4();
      inst.getMatrixAt(target.index, matrix);
      // Combine instance matrix with the mesh's world matrix
      inst.updateWorldMatrix(true, false);
      const finalMat = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, matrix);
      // Get geometry bbox and transform
      if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
      box.copy(inst.geometry.boundingBox).applyMatrix4(finalMat);
    }
    return box;
  }

  /**
   * Focus on a single component.
   * @param {string} partID
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object} [controls] - OrbitControls or null
   * @param {object} [options] - { dimOpacity = 0.08, animate = false, padding = 1.4 }
   * @returns {object|null} { partID, target, box, cameraPos, controlTarget } or null if not found
   */
  static focusByPartID(partID, scene, camera, controls = null, options = {}) {
    const { dimOpacity = 0.08, padding = 1.4 } = options;

    const target = FocusController.findByPartID(partID, scene);
    if (!target) return null;

    const box = FocusController.computeTargetBox(target);
    if (!box || box.isEmpty()) return null;

    // Dim everything else
    FocusController._dimOthers(scene, target, dimOpacity);

    // Frame camera on target
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.01;

    const fov = camera.fov || 50;
    const dist = (maxDim / Math.tan((fov * Math.PI / 180) / 2)) * padding;

    const dir = new THREE.Vector3(0.7, 0.5, 0.7).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(dist));
    camera.lookAt(center);
    camera.near = Math.max(0.0001, maxDim * 0.001);
    camera.far = Math.max(1000, maxDim * 1000);
    camera.updateProjectionMatrix();

    if (controls?.target) {
      controls.target.copy(center);
      controls.update?.();
    }

    _focusedPartID = partID;

    return {
      partID,
      target,
      box: { min: box.min.toArray(), max: box.max.toArray() },
      center: center.toArray(),
      size: size.toArray(),
      cameraPos: camera.position.toArray(),
    };
  }

  /** Restore all materials/opacity from the latest focus call. */
  static clearFocus(scene) {
    scene.traverse(obj => {
      if (!obj.material) return;
      const orig = _origStates.get(obj);
      if (orig) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m, i) => {
            const o = orig.materials?.[i];
            if (o) {
              m.opacity = o.opacity;
              m.transparent = o.transparent;
              m.depthWrite = o.depthWrite;
              m.needsUpdate = true;
            }
          });
        } else {
          obj.material.opacity = orig.opacity;
          obj.material.transparent = orig.transparent;
          obj.material.depthWrite = orig.depthWrite;
          obj.material.needsUpdate = true;
        }
        // Restore per-instance colors if needed
        if (obj.isInstancedMesh && orig.instanceColor !== undefined) {
          if (orig.instanceColor === null) {
            obj.instanceColor = null;
          } else {
            obj.instanceColor.array.set(orig.instanceColor);
            obj.instanceColor.needsUpdate = true;
          }
        }
        _origStates.delete(obj);
      }
    });
    _focusedPartID = null;
  }

  /** Currently focused partID (or null). */
  static getFocused() {
    return _focusedPartID;
  }

  /** Apply dimming to everything except target. */
  static _dimOthers(scene, target, dimOpacity) {
    scene.traverse(obj => {
      if (!obj.material) return;
      if (!obj.isMesh && !obj.isInstancedMesh) return;
      // Skip non-pickable (helpers, gizmos, etc.)
      if (obj.userData?.helper || obj.userData?.gizmo) return;

      const isTargetMesh = (target.kind === 'mesh' && obj === target.object);
      const isTargetInstanceMesh = (target.kind === 'instance' && obj === target.object);

      // Save original state if not already
      if (!_origStates.has(obj)) {
        if (Array.isArray(obj.material)) {
          _origStates.set(obj, {
            materials: obj.material.map(m => ({
              opacity: m.opacity,
              transparent: m.transparent,
              depthWrite: m.depthWrite,
            })),
          });
        } else {
          const state = {
            opacity: obj.material.opacity,
            transparent: obj.material.transparent,
            depthWrite: obj.material.depthWrite,
          };
          if (obj.isInstancedMesh) {
            state.instanceColor = obj.instanceColor
              ? new Float32Array(obj.instanceColor.array)
              : null;
          }
          _origStates.set(obj, state);
        }
      }

      if (isTargetMesh) {
        // Keep at full opacity
        FocusController._setOpacity(obj, 1.0);
      } else if (isTargetInstanceMesh) {
        // Highlight the one instance, dim the rest via instance color
        FocusController._highlightInstance(obj, target.index, dimOpacity);
      } else {
        // Dim entirely
        FocusController._setOpacity(obj, dimOpacity);
      }
    });
  }

  static _setOpacity(obj, value) {
    const apply = (m) => {
      m.transparent = value < 1;
      m.opacity = value;
      m.depthWrite = value >= 1;
      m.needsUpdate = true;
    };
    if (Array.isArray(obj.material)) obj.material.forEach(apply);
    else apply(obj.material);
  }

  /** For an InstancedMesh, dim all instances except the highlighted index. */
  static _highlightInstance(inst, index, dimOpacity) {
    // Use per-instance color: full color for highlighted, dim grey for rest
    if (!inst.instanceColor) {
      inst.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(inst.count * 3),
        3
      );
      // Initialize to material color
      const c = new THREE.Color();
      const baseColor = inst.material?.color || new THREE.Color(0xffffff);
      for (let i = 0; i < inst.count; i++) {
        c.copy(baseColor);
        inst.setColorAt(i, c);
      }
    }
    const arr = inst.instanceColor.array;
    const dimVal = dimOpacity * 0.5; // multiplicative dim
    for (let i = 0; i < inst.count; i++) {
      const off = i * 3;
      if (i === index) {
        // Brighten
        arr[off] = 1.0;
        arr[off + 1] = 1.0;
        arr[off + 2] = 1.0;
      } else {
        arr[off] = dimVal;
        arr[off + 1] = dimVal;
        arr[off + 2] = dimVal;
      }
    }
    inst.instanceColor.needsUpdate = true;
    // Also reduce material opacity for dimmed instances? Hard with single material.
    // Setting transparent + lower opacity affects all instances, so keep instanceColor
    // as the primary dimming mechanism.
  }
}
