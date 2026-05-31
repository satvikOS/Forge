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
import EngineMaterials from '../materials/EngineMaterials.js';

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

    // Apply PBR material based on the part's material name (titanium glints,
    // CMC reads as ceramic, composite has clearcoat, etc.). Color from the
    // part overrides the library default if explicitly set.
    const material = EngineMaterials.makeMaterial(THREE, first.material, {
      color: first.color,
    });
    // DoubleSide is REQUIRED here for the same reason it is on the foundation
    // manifold bridge (Render fix #1, commit c300ff6a). `EngineMaterials
    // .makeMaterial` builds a `MeshPhysicalMaterial` without touching `side`,
    // so it inherits the Three.js default of `FrontSide`. A user-reported bug
    // in the Assembly tab showed 6 instanced components rendering only their
    // edges/outlines at one camera angle ("have to move around to the other
    // side") — the classic FrontSide-only symptom on a body whose normals
    // happen to face away from the camera (e.g. cylinders / boxes inserted
    // with a rotation, parts whose tessellated triangles came out with
    // inverted winding from a particular CSG path). Flipping to DoubleSide
    // is harmless on closed solids and rescues every other case.
    material.side = THREE.DoubleSide;

    const inst = new THREE.InstancedMesh(geometry, material, parts.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    // Off-centre instances on a large airframe can place the instance-mesh
    // bounding sphere outside the camera frustum at certain orbit angles
    // (matches the Render fix #2 rationale on Viewport3D overlays). Turn
    // frustum culling off so the InstancedMesh is always drawn — the
    // overhead is one extra draw call, negligible at the 5+ part threshold.
    inst.frustumCulled = false;
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

      // Apply real material PBR — replaces ThreeJSBridge's default.
      // We also re-assert DoubleSide and frustum-cull-off defensively:
      // `ThreeJSBridge.solidToGroup` already builds the mesh material with
      // `side: DoubleSide`, but any future material swap or
      // applyToMaterial-style override could regress it back to FrontSide
      // (a MeshPhysicalMaterial built without `side` defaults to FrontSide).
      // The user-reported Assembly-tab visibility bug — only edges visible
      // at one angle, body fills in after orbiting — is the classic
      // FrontSide-only symptom; reasserting DoubleSide on every mesh in
      // the part group guarantees the body renders from every angle even
      // if the kernel-side default ever changes.
      group.traverse(obj => {
        if (obj.isMesh && obj.material) {
          EngineMaterials.applyToMaterial(obj.material, part.material, {
            color: part.color,
          });
          // Re-assert side after the PBR overlay, in case a future
          // applyToMaterial variant decides to copy `side` from the
          // material library (some preset rows could legitimately want
          // FrontSide for transparency, but assembly bodies are solids
          // and must remain DoubleSide).
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            m.side = THREE.DoubleSide;
            m.needsUpdate = true;
          }
          obj.frustumCulled = false;
        }
      });

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

        // Re-assert DoubleSide + frustum-cull-off for the same reasons
        // as the primary _addPartAsGroup path. See that method for the
        // full rationale tied to the Assembly-tab visibility report.
        group.traverse(obj => {
          if (obj.isMesh && obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
              m.side = THREE.DoubleSide;
              m.needsUpdate = true;
            }
            obj.frustumCulled = false;
          }
        });

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
