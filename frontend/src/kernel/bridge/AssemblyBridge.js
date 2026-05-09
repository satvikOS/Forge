/**
 * ArchDisc Geometry Kernel — Assembly Bridge
 * Renders an entire Assembly into a Three.js scene.
 * Supports two modes:
 * - renderAssembly (default): each part is a separate group (best for ~100 parts)
 * - renderAssemblyInstanced: merges identical solids into InstancedMesh
 *   (handles 10K+ identical parts in a single draw call)
 */

import * as THREE from 'three';
import Tessellator from '../tessellation/Tessellator.js';
import ThreeJSBridge from './ThreeJSBridge.js';

export default class AssemblyBridge {

  /**
   * Render an assembly into a Three.js scene.
   * Auto-detects when to use instancing: if >50 parts share the same solid,
   * use InstancedMesh for that group. Single parts use regular meshes.
   * @param {Assembly} assembly
   * @param {THREE.Scene} scene
   * @param {object} options - { instanceThreshold = 5, forceInstanced = false }
   * @returns {THREE.Group} The root assembly group
   */
  static renderAssembly(assembly, scene, options = {}) {
    const { instanceThreshold = 5, forceInstanced = false } = options;

    // Group parts by shared solid identity (same geometry → can instance)
    const solidGroups = new Map(); // solid.id → [parts]
    const uniqueParts = [];

    for (const part of assembly.parts) {
      if (!part.solid || !part.visible) continue;
      const key = part.solid.id;
      if (!solidGroups.has(key)) solidGroups.set(key, []);
      solidGroups.get(key).push(part);
    }

    const root = new THREE.Group();
    root.name = assembly.name;
    root.userData.assemblyId = assembly.id;
    root.userData.isAssembly = true;

    let instancedCount = 0;
    let regularCount = 0;

    for (const [solidId, parts] of solidGroups) {
      if (forceInstanced || parts.length >= instanceThreshold) {
        // Use InstancedMesh
        const instGroup = AssemblyBridge._buildInstancedGroup(parts);
        if (instGroup) {
          root.add(instGroup);
          instancedCount += parts.length;
        }
      } else {
        // Use regular mesh per part
        for (const part of parts) {
          AssemblyBridge._addPartAsGroup(root, part);
          regularCount++;
        }
      }
    }

    root.userData.pickable = true;
    root.userData.generatedModel = true;
    root.userData.instancedCount = instancedCount;
    root.userData.regularCount = regularCount;
    scene.add(root);

    return root;
  }

  /** Build an InstancedMesh from N parts that share the same solid. */
  static _buildInstancedGroup(parts) {
    const first = parts[0];
    if (!first?.solid) return null;

    // Tessellate solid once
    const tessResult = Tessellator.tessellate(first.solid);
    if (!tessResult.vertices || tessResult.vertices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(tessResult.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(tessResult.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(tessResult.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({
      color: first.color || 0x4a90d9,
      metalness: 0.4,
      roughness: 0.35,
    });

    const inst = new THREE.InstancedMesh(geometry, material, parts.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = `Instanced_${first.solid.name || first.solid.id}_x${parts.length}`;
    inst.userData.pickable = true;
    inst.userData.generatedModel = true;
    inst.userData.instanced = true;
    inst.userData.instanceCount = parts.length;
    inst.userData.partIds = parts.map(p => p.id);
    inst.userData.partIDs = parts.map(p => p.partID);  // string IDs from registry
    inst.userData.kernelSolid = first.solid;

    // Set per-instance matrix
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      pos.set(p.position.x, p.position.y, p.position.z);
      euler.set(p.rotation.x, p.rotation.y, p.rotation.z);
      rot.setFromEuler(euler);
      scale.set(p.scale.x, p.scale.y, p.scale.z);
      matrix.compose(pos, rot, scale);
      inst.setMatrixAt(i, matrix);
      // Track three reference on part
      p.threeInstance = { mesh: inst, index: i };
    }
    inst.instanceMatrix.needsUpdate = true;

    // Per-instance color (optional — uses first part color for all if not varied)
    const hasVariedColors = parts.some(p => p.color !== first.color);
    if (hasVariedColors) {
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(parts.length * 3), 3);
      const c = new THREE.Color();
      for (let i = 0; i < parts.length; i++) {
        c.setHex(parts[i].color || 0x4a90d9);
        inst.setColorAt(i, c);
      }
    }

    return inst;
  }

  /** Add a single part as a regular Three.js group. */
  static _addPartAsGroup(root, part) {
    try {
      const group = ThreeJSBridge.solidToGroup(part.solid, {
        color: part.color,
        metalness: 0.4,
        roughness: 0.35,
        edges: true,
      });

      group.name = part.name;
      group.userData.partId = part.id;
      group.userData.partID = part.partID;
      group.userData.partName = part.name;
      group.userData.material = part.material;
      group.userData.pickable = true;
      group.userData.kernelSolid = part.solid;

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

  /**
   * Legacy non-instanced rendering — kept for compatibility.
   */
  static renderAssemblyLegacy(assembly, scene) {
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
