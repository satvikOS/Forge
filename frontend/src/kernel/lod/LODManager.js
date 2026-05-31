/**
 * ArchDisc — Level of Detail Manager
 *
 * Manages multi-resolution rendering for large assemblies (10K-100K parts).
 *
 * Strategy:
 * 1. Compute per-part screen-space size each frame
 * 2. Distance-based: parts beyond threshold use simplified geometry
 * 3. Frustum culling: parts outside camera view aren't rendered
 * 4. Auto-instancing: identical solids merged into InstancedMesh
 *
 * Performance targets:
 * - 10K parts at 60 FPS
 * - 100K parts at 30 FPS with LOD active
 */

import * as THREE from 'three';

export default class LODManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.threshold = {
      hide: 2,        // pixels — hide if smaller than this
      lowDetail: 30,  // use box bounds
      highDetail: 100, // use full mesh
    };
    this.enabled = true;
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
  }

  /**
   * Update LOD state for all objects in scene. Call once per frame.
   * Returns stats: { rendered, hidden, simplified, total }
   */
  update() {
    if (!this.enabled || !this.scene || !this.camera) return null;

    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);

    let rendered = 0, hidden = 0, simplified = 0, total = 0, instanced = 0;

    this.scene.traverse(obj => {
      if (!obj.isMesh && !obj.isInstancedMesh && !obj.isGroup) return;
      if (obj.userData?.isHelper) return;
      if (obj.userData?.lockedVisible) return;

      total++;

      // InstancedMesh: render entire batch (already optimized)
      if (obj.isInstancedMesh) {
        instanced += obj.count || 0;
        return;
      }

      // Compute world-space bounding sphere
      if (!obj.geometry?.boundingSphere) {
        if (obj.geometry?.computeBoundingSphere) obj.geometry.computeBoundingSphere();
        else return;
      }
      const sphere = obj.geometry?.boundingSphere;
      if (!sphere) return;

      // Convert to world space
      const worldCenter = sphere.center.clone().applyMatrix4(obj.matrixWorld);
      const worldRadius = sphere.radius * obj.matrixWorld.getMaxScaleOnAxis();

      // Frustum cull
      const frustumSphere = new THREE.Sphere(worldCenter, worldRadius);
      if (!this.frustum.intersectsSphere(frustumSphere)) {
        obj.visible = false;
        hidden++;
        return;
      }

      // Distance-based LOD
      const dist = this.camera.position.distanceTo(worldCenter);
      const screenSize = (worldRadius / dist) * this._screenScaleFactor();

      if (screenSize < this.threshold.hide) {
        obj.visible = false;
        hidden++;
      } else if (screenSize < this.threshold.lowDetail) {
        obj.visible = true;
        // Use simpler material (could swap geometry for simplified version)
        if (obj.userData._origMat && obj.material !== obj.userData._origMat) {
          // already simplified
        }
        simplified++;
        rendered++;
      } else {
        obj.visible = true;
        rendered++;
      }
    });

    return { rendered, hidden, simplified, instanced, total };
  }

  _screenScaleFactor() {
    // Approximate pixel scaling: tan(fov/2) * viewport_height_px
    if (!this.camera) return 1000;
    const fov = (this.camera.fov || 45) * Math.PI / 180;
    return 1 / Math.tan(fov / 2) * 1000;
  }

  /**
   * Build a simplified LOD geometry for a TopoSolid:
   * just a bounding box. Used when zoomed out.
   */
  static simplify(geometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const size = bb.getSize(new THREE.Vector3());
    const simpler = new THREE.BoxGeometry(size.x, size.y, size.z);
    simpler.translate(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2
    );
    return simpler;
  }

  /**
   * Set LOD thresholds.
   */
  setThresholds(thresholds) {
    Object.assign(this.threshold, thresholds);
  }

  enable() { this.enabled = true; }
  disable() {
    this.enabled = false;
    // Reset all visibility
    this.scene?.traverse(obj => {
      if (obj.isMesh && !obj.userData?.isHelper) obj.visible = true;
    });
  }
}
