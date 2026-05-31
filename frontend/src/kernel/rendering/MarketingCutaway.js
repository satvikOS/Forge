/**
 * ArchDisc — Marketing Cutaway Renderer
 *
 * Produces the GE/Rolls-Royce-style cutaway poster look:
 *   - Engine displayed horizontally (axis = view-X)
 *   - Color-coded sections: fan blue, LPC green, HPC orange,
 *     combustor red, HPT yellow, LPT cyan, exhaust grey
 *   - Accessories, fasteners, harnesses, brackets HIDDEN so the
 *     core flow path is visible
 *   - Axis-bisecting cut (slice through engine centerline)
 *   - White / bright background for marketing renders
 *
 * Used to produce the "this is what a turbofan looks like" image
 * that matches the reference cutaway diagrams.
 */

import * as THREE from 'three';

// Categories whose color codes the engine section in cutaway mode
const SECTION_COLORS = {
  INLET: 0x6e7caf,
  INLE:  0x6e7caf,
  FAN:   0x4a90d9,  // blue
  LPC:   0x4ed99d,  // green
  HPC:   0xd9a04a,  // orange
  COMB:  0xd94a4a,  // red
  HPT:   0xd9c84a,  // yellow
  LPT:   0x4ad9c8,  // cyan
  EXH:   0x707080,  // grey
  SHFT:  0x999999,  // shaft grey
  BRG:   0x707070,
  NAC:   0xeeeeee,  // outer cowl white
};

// Categories that obscure the cutaway view — hide them
const ACCESSORY_HIDE = new Set([
  'AGB', 'FUEL', 'OIL', 'AIR', 'IGN', 'FADEC', 'ELEC', 'HYD',
  'MNT', 'TRV', 'FAS', 'STR', 'PIP', 'DRN', 'FIRE',
]);

const _state = new WeakMap();   // scene → original visibility/colors

export default class MarketingCutaway {

  /**
   * Apply the marketing-cutaway look to a scene that already has the
   * engine rendered.
   *
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} options
   *   axisDir         engine axis world-vector (default +Z)
   *   center          engine centerline point (default origin)
   *   hideAccessories boolean (default true)
   *   colorBySection  boolean (default true)
   * @returns {object} { restore: () => void }
   */
  static apply(scene, renderer, options = {}) {
    const {
      axisDir = new THREE.Vector3(0, 0, 1),
      center = new THREE.Vector3(0, 0, 0),
      hideAccessories = true,
      colorBySection = true,
    } = options;

    const restoreTasks = [];

    // 1. Apply per-mesh visibility + color overrides.
    //    Includes LineSegments (edge wireframes) so accessory edge-lines
    //    don't show as floating dark cubes when their meshes are hidden.
    scene.traverse(obj => {
      const isRenderable = obj.isMesh || obj.isInstancedMesh
        || obj.isLine || obj.isLineSegments;
      if (!isRenderable) return;
      if (!obj.material || obj.userData?.helper || obj.userData?.gizmo) return;

      // Determine the partID's category. Look on the mesh itself, on
      // its parent group (since AssemblyBridge sets partID on the
      // group, not on internal meshes), and on InstancedMesh's array.
      let category = null;
      const findID = () => {
        if (obj.userData?.partID) return obj.userData.partID;
        // Walk up parents
        let p = obj.parent;
        while (p) {
          if (p.userData?.partID) return p.userData.partID;
          p = p.parent;
        }
        return null;
      };
      const id = findID();
      if (id) {
        const mm = id.match(/^[A-Z0-9]+-([A-Z]+)-/);
        if (mm) category = mm[1];
      } else if (Array.isArray(obj.userData?.partIDs) && obj.userData.partIDs.length) {
        const mm = obj.userData.partIDs[0].match(/^[A-Z0-9]+-([A-Z]+)-/);
        if (mm) category = mm[1];
      }

      const task = { object: obj, prevVisible: obj.visible };

      // Hide accessories
      if (hideAccessories && category && ACCESSORY_HIDE.has(category)) {
        obj.visible = false;
      }

      // Color by section
      if (colorBySection && category && SECTION_COLORS[category] != null) {
        const c = SECTION_COLORS[category];
        const apply = (m) => {
          task.materials = task.materials || [];
          task.materials.push({
            material: m,
            color: m.color?.getHex(),
            emissive: m.emissive?.getHex(),
            emissiveIntensity: m.emissiveIntensity,
          });
          if (m.color) m.color.setHex(c);
          // Slight emissive boost so colors pop without lighting
          if (m.emissive) {
            m.emissive.setHex(c);
            m.emissiveIntensity = 0.12;
          }
          m.needsUpdate = true;
        };
        if (Array.isArray(obj.material)) obj.material.forEach(apply);
        else apply(obj.material);

        // For InstancedMesh, force the per-instance colors uniform if any
        if (obj.isInstancedMesh && obj.instanceColor) {
          const arr = obj.instanceColor.array;
          const cc = new THREE.Color(c);
          for (let i = 0; i < obj.count; i++) {
            arr[i * 3] = cc.r;
            arr[i * 3 + 1] = cc.g;
            arr[i * 3 + 2] = cc.b;
          }
          obj.instanceColor.needsUpdate = true;
          task.instanceColorBackup = new Float32Array(obj.instanceColor.array);
        }
      }

      restoreTasks.push(task);
    });

    // 2. Axis-bisecting clipping plane
    const ax = axisDir.clone().normalize();
    const helper = (Math.abs(ax.y) < 0.9) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(helper, ax).normalize();
    // Cut so the +U side is removed → see inside from -U direction
    const cutPlane = new THREE.Plane(u.clone().negate(), -u.clone().negate().dot(center));
    if (renderer) renderer.localClippingEnabled = true;
    scene.traverse(obj => {
      if (!obj.material) return;
      const apply = (m) => {
        m._mc_origPlanes = m.clippingPlanes;
        m._mc_origSide = m.side;
        m.clippingPlanes = [cutPlane];
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      };
      if (Array.isArray(obj.material)) obj.material.forEach(apply);
      else apply(obj.material);
    });

    _state.set(scene, { restoreTasks, renderer });

    return {
      restore: () => MarketingCutaway.restore(scene),
    };
  }

  /** Restore visibility, colors, and clipping. */
  static restore(scene) {
    const state = _state.get(scene);
    if (!state) return false;

    for (const t of state.restoreTasks) {
      t.object.visible = t.prevVisible;
      if (t.materials) {
        for (const r of t.materials) {
          if (r.color != null) r.material.color.setHex(r.color);
          if (r.emissive != null && r.material.emissive) r.material.emissive.setHex(r.emissive);
          if (r.emissiveIntensity != null) r.material.emissiveIntensity = r.emissiveIntensity;
          r.material.needsUpdate = true;
        }
      }
      if (t.instanceColorBackup && t.object.instanceColor) {
        t.object.instanceColor.array.set(t.instanceColorBackup);
        t.object.instanceColor.needsUpdate = true;
      }
    }

    // Restore clipping
    scene.traverse(obj => {
      if (!obj.material) return;
      const apply = (m) => {
        if (m._mc_origPlanes !== undefined) {
          m.clippingPlanes = m._mc_origPlanes;
          delete m._mc_origPlanes;
        }
        if (m._mc_origSide !== undefined) {
          m.side = m._mc_origSide;
          delete m._mc_origSide;
        }
        m.needsUpdate = true;
      };
      if (Array.isArray(obj.material)) obj.material.forEach(apply);
      else apply(obj.material);
    });
    if (state.renderer) state.renderer.localClippingEnabled = false;

    _state.delete(scene);
    return true;
  }

  static getSectionColor(category) {
    return SECTION_COLORS[category] ?? 0x999999;
  }

  static sectionLegend() {
    return Object.entries(SECTION_COLORS).map(([cat, hex]) => ({
      category: cat,
      colorHex: '#' + hex.toString(16).padStart(6, '0'),
    }));
  }
}

export { SECTION_COLORS };
