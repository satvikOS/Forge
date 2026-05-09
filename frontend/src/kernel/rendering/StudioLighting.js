/**
 * ArchDisc — Studio Lighting
 *
 * Drop-in 3-point lighting + hemisphere fill for engineering renders.
 * Adds a key light, fill light, rim light, and a soft hemisphere ambient
 * that approximates HDR environment lighting without needing an HDR file.
 *
 * Usage:
 *   const lights = StudioLighting.apply(scene, { intensity: 1.0 });
 *   StudioLighting.remove(scene, lights);
 */

const _applied = new WeakMap();

export default class StudioLighting {

  /**
   * Add 3-point + hemisphere lighting to the scene.
   * @param {THREE.Scene} scene
   * @param {object} [options]
   *   intensity   global multiplier (default 1.0)
   *   keyColor    key light hex (default warm white 0xfff5e6)
   *   fillColor   fill hex (default cool 0xc8e0ff)
   *   rimColor    rim hex (default 0xffffff)
   *   targetCenter THREE.Vector3 to aim lights at (default origin)
   *   targetSize   approximate scene size (default 5)
   *   THREE       three module
   * @returns {object} { lights: array, remove: () => void }
   */
  static apply(scene, options = {}) {
    const {
      intensity = 1.0,
      keyColor = 0xfff5e6,
      fillColor = 0xc8e0ff,
      rimColor = 0xffffff,
      targetCenter = null,
      targetSize = 5,
      THREE,
    } = options;

    if (!THREE) throw new Error('StudioLighting.apply: pass THREE module via options.THREE');

    const center = targetCenter || new THREE.Vector3(0, 0, 0);
    const dist = targetSize * 1.5;
    const lights = [];

    // Hemisphere — sky/ground gradient ambient
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x1a1a22, 0.5 * intensity);
    hemi.position.set(0, dist, 0);
    hemi.userData.studio = true;
    scene.add(hemi);
    lights.push(hemi);

    // Key light — warm, from upper-front-right
    const key = new THREE.DirectionalLight(keyColor, 1.6 * intensity);
    key.position.copy(center).add(new THREE.Vector3(dist * 0.7, dist * 0.5, dist * 0.6));
    key.castShadow = false;  // disable for performance on 30K parts
    key.userData.studio = true;
    scene.add(key);
    lights.push(key);

    // Fill light — cool, from lower-front-left, half intensity
    const fill = new THREE.DirectionalLight(fillColor, 0.6 * intensity);
    fill.position.copy(center).add(new THREE.Vector3(-dist * 0.6, dist * 0.2, dist * 0.4));
    fill.userData.studio = true;
    scene.add(fill);
    lights.push(fill);

    // Rim light — from behind to highlight silhouettes (engine outline)
    const rim = new THREE.DirectionalLight(rimColor, 0.9 * intensity);
    rim.position.copy(center).add(new THREE.Vector3(0, dist * 0.4, -dist * 0.8));
    rim.userData.studio = true;
    scene.add(rim);
    lights.push(rim);

    // Subtle ground reflector
    const ground = new THREE.DirectionalLight(0x404060, 0.25 * intensity);
    ground.position.copy(center).add(new THREE.Vector3(0, -dist * 0.5, 0));
    ground.userData.studio = true;
    scene.add(ground);
    lights.push(ground);

    _applied.set(scene, lights);
    return {
      lights,
      remove: () => StudioLighting.remove(scene),
    };
  }

  /** Remove studio lights added by apply(). */
  static remove(scene) {
    const lights = _applied.get(scene);
    if (!lights) return false;
    for (const l of lights) scene.remove(l);
    _applied.delete(scene);
    return true;
  }

  /**
   * Hot-mode lighting — replaces white key with orange key for the
   * "engine running at temperature" look.
   */
  static hot(scene, options = {}) {
    StudioLighting.remove(scene);
    return StudioLighting.apply(scene, {
      ...options,
      keyColor: 0xffaa66,
      fillColor: 0xff8866,
      rimColor: 0xffcc88,
      intensity: (options.intensity || 1.0) * 1.2,
    });
  }
}
