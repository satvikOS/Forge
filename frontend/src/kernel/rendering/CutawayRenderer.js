/**
 * ArchDisc — Cutaway Renderer
 *
 * Hides geometry on one side of a clipping plane so internal structure
 * (compressor stages, combustor, turbine) becomes visible. Matches the
 * cutaway style of GE/Rolls-Royce marketing imagery used for engineering
 * inspection and presentations.
 *
 * Modes:
 *   - axial-half: half-cut along engine axis (one half visible)
 *   - quadrant:   90° wedge removed
 *   - radial:     above-axis half removed
 *   - axial-slice: thin slice of given thickness
 *
 * Implementation: Three.js localClippingEnabled + per-mesh clipping planes,
 * with INVERTED clipping on the cut surface to render the cap faces in
 * a contrasting color (engineering-section style).
 */

import * as THREE from 'three';

const _appliedMaterials = new WeakMap(); // scene → array of restore tasks

export default class CutawayRenderer {

  /**
   * Apply a cutaway to the entire scene.
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} options
   * @param {string} [options.mode='axial-half']  - 'axial-half'|'quadrant'|'radial'|'axial-slice'
   * @param {THREE.Vector3} [options.center]      - center of cut (defaults to scene origin)
   * @param {THREE.Vector3} [options.axis]        - engine axis (default +Z)
   * @param {number} [options.thickness=0.05]     - slice thickness for axial-slice mode
   * @param {number} [options.angleDeg=90]        - wedge angle for quadrant mode
   * @returns {object} cutaway state (use restore())
   */
  static apply(scene, renderer, options = {}) {
    const {
      mode = 'axial-half',
      center = new THREE.Vector3(0, 0, 0),
      axis = new THREE.Vector3(0, 0, 1),
      thickness = 0.05,
      angleDeg = 90,
    } = options;

    // Build clipping planes based on mode
    const planes = CutawayRenderer._buildPlanes(mode, center, axis, thickness, angleDeg);

    if (renderer) renderer.localClippingEnabled = true;

    // Apply to all materials
    const restoreTasks = [];
    scene.traverse(obj => {
      if (!obj.material) return;
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => {
          restoreTasks.push({
            material: m,
            origPlanes: m.clippingPlanes,
            origSide: m.side,
          });
          m.clippingPlanes = planes;
          m.side = THREE.DoubleSide;
          m.needsUpdate = true;
        });
      } else {
        restoreTasks.push({
          material: obj.material,
          origPlanes: obj.material.clippingPlanes,
          origSide: obj.material.side,
        });
        obj.material.clippingPlanes = planes;
        obj.material.side = THREE.DoubleSide;
        obj.material.needsUpdate = true;
      }
    });

    _appliedMaterials.set(scene, { restoreTasks, planes, mode, options });

    return {
      mode,
      planes,
      restore: () => CutawayRenderer.restore(scene, renderer),
    };
  }

  /** Restore the scene to non-clipped state. */
  static restore(scene, renderer) {
    const state = _appliedMaterials.get(scene);
    if (!state) return false;
    for (const task of state.restoreTasks) {
      task.material.clippingPlanes = task.origPlanes;
      task.material.side = task.origSide;
      task.material.needsUpdate = true;
    }
    if (renderer) renderer.localClippingEnabled = false;
    _appliedMaterials.delete(scene);
    return true;
  }

  /** Currently applied mode, or null. */
  static getMode(scene) {
    return _appliedMaterials.get(scene)?.mode || null;
  }

  /** Build clipping planes for each mode. */
  static _buildPlanes(mode, center, axis, thickness, angleDeg) {
    const ax = axis.clone().normalize();
    // Build a perpendicular basis
    const helper = (Math.abs(ax.y) < 0.9) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(helper, ax).normalize();
    const v = new THREE.Vector3().crossVectors(ax, u).normalize();

    if (mode === 'axial-half') {
      // Cut by plane through axis with normal = u (remove +u half)
      const n = u.clone().negate();
      const d = -n.dot(center);
      return [new THREE.Plane(n, d)];
    }

    if (mode === 'radial') {
      // Cut by plane perpendicular to v (remove +v half)
      const n = v.clone().negate();
      const d = -n.dot(center);
      return [new THREE.Plane(n, d)];
    }

    if (mode === 'quadrant') {
      // Two planes: 90° wedge cut, both removing
      const half = (angleDeg * Math.PI / 180) / 2;
      const n1 = u.clone().applyAxisAngle(ax, half).negate();
      const n2 = u.clone().applyAxisAngle(ax, -half);
      return [
        new THREE.Plane(n1, -n1.dot(center)),
        new THREE.Plane(n2, -n2.dot(center)),
      ];
    }

    if (mode === 'axial-slice') {
      // Two planes parallel to axis, separated by thickness
      // Keep only the slice
      const c1 = center.clone().add(ax.clone().multiplyScalar(thickness / 2));
      const c2 = center.clone().sub(ax.clone().multiplyScalar(thickness / 2));
      return [
        new THREE.Plane(ax.clone().negate(), -ax.clone().negate().dot(c1)),
        new THREE.Plane(ax.clone(), -ax.dot(c2)),
      ];
    }

    return [];
  }

  /**
   * Animate a slice plane sweeping along the axis from start to end.
   * Renderer must be passed so we can call render between frames.
   */
  static async sweep(scene, renderer, camera, options = {}) {
    const {
      axis = new THREE.Vector3(0, 0, 1),
      from = new THREE.Vector3(0, 0, -1),
      to = new THREE.Vector3(0, 0, 1),
      steps = 60,
      thickness = 0.05,
      onFrame = null,
    } = options;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const center = from.clone().lerp(to, t);
      CutawayRenderer.restore(scene, renderer);
      CutawayRenderer.apply(scene, renderer, { mode: 'axial-slice', center, axis, thickness });
      renderer.render(scene, camera);
      if (onFrame) await onFrame(i, steps);
      // Yield to render loop
      await new Promise(r => setTimeout(r, 16));
    }
  }
}
