/**
 * ArchDisc Geometry Kernel — Assembly Bridge
 * Renders an entire Assembly into a Three.js scene.
 * Each part gets its own group with proper transforms, colors, and picking.
 */

import * as THREE from 'three';
import ThreeJSBridge from './ThreeJSBridge.js';

export default class AssemblyBridge {

  /**
   * Render an assembly into a Three.js scene.
   * @param {Assembly} assembly
   * @param {THREE.Scene} scene
   * @returns {THREE.Group} The root assembly group
   */
  static renderAssembly(assembly, scene) {
    const root = new THREE.Group();
    root.name = assembly.name;
    root.userData.assemblyId = assembly.id;
    root.userData.isAssembly = true;

    for (const part of assembly.parts) {
      if (!part.solid || !part.visible) continue;

      try {
        const group = ThreeJSBridge.solidToGroup(part.solid, {
          color: part.color,
          metalness: 0.4,
          roughness: 0.35,
          edges: true,
        });

        group.name = part.name;
        group.userData.partId = part.id;
        group.userData.partName = part.name;
        group.userData.material = part.material;
        group.userData.pickable = true;
        group.userData.kernelSolid = part.solid;

        // Apply transform
        group.position.set(part.position.x, part.position.y, part.position.z);
        group.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
        group.scale.set(part.scale.x, part.scale.y, part.scale.z);

        group.castShadow = true;
        group.receiveShadow = true;

        part.threeGroup = group;
        root.add(group);
      } catch (err) {
        console.warn(`Failed to render part ${part.name}:`, err.message);
      }
    }

    root.userData.pickable = true;
    root.userData.generatedModel = true;
    scene.add(root);

    return root;
  }

  /**
   * Focus camera on entire assembly.
   */
  static focusOnAssembly(root, camera, controls) {
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim / Math.tan((camera.fov * Math.PI / 180) / 2) * 2;

    camera.position.set(
      center.x + dist * 0.6,
      center.y + dist * 0.4,
      center.z + dist * 0.6
    );
    controls.target.copy(center);
    controls.update();
  }

  /**
   * Apply exploded view to assembly.
   */
  static explode(root, assembly, factor = 2.5) {
    const offsets = assembly.explode(factor);
    for (const { partId, offset } of offsets) {
      const part = assembly.getPart(partId);
      if (part?.threeGroup) {
        part.threeGroup.position.set(
          part.position.x + offset.x,
          part.position.y + offset.y,
          part.position.z + offset.z
        );
      }
    }
  }

  /**
   * Reset exploded view.
   */
  static collapse(assembly) {
    for (const part of assembly.parts) {
      if (part.threeGroup) {
        part.threeGroup.position.set(part.position.x, part.position.y, part.position.z);
      }
    }
  }

  /**
   * Dispose of assembly rendering.
   */
  static dispose(root, scene) {
    root.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene.remove(root);
  }
}
