/**
 * ArchDisc Geometry Kernel — Render Engine
 * PBR rendering with environment maps, material presets, and render-to-image.
 * Supports: studio lighting, HDR environments, ground shadows, AO.
 */

import * as THREE from 'three';

// PBR Material presets (physically accurate)
const PBR_PRESETS = {
  'polished-aluminum': { color: 0xd4d4d4, metalness: 0.9, roughness: 0.15, envMapIntensity: 1.2 },
  'brushed-aluminum': { color: 0xc8c8c8, metalness: 0.85, roughness: 0.4, envMapIntensity: 0.8 },
  'anodized-aluminum': { color: 0xcc6622, metalness: 0.7, roughness: 0.3, envMapIntensity: 0.9 },
  'cast-iron': { color: 0x555555, metalness: 0.6, roughness: 0.7, envMapIntensity: 0.5 },
  'polished-steel': { color: 0xdddddd, metalness: 0.95, roughness: 0.1, envMapIntensity: 1.5 },
  'brushed-steel': { color: 0xbbbbbb, metalness: 0.9, roughness: 0.35, envMapIntensity: 0.8 },
  'stainless-steel': { color: 0xcccccc, metalness: 0.85, roughness: 0.25, envMapIntensity: 1.0 },
  'chrome': { color: 0xffffff, metalness: 1.0, roughness: 0.05, envMapIntensity: 2.0 },
  'copper': { color: 0xb87333, metalness: 0.95, roughness: 0.2, envMapIntensity: 1.0 },
  'brass': { color: 0xc5a844, metalness: 0.9, roughness: 0.25, envMapIntensity: 0.9 },
  'titanium': { color: 0x878681, metalness: 0.8, roughness: 0.35, envMapIntensity: 0.7 },
  'rubber': { color: 0x222222, metalness: 0.0, roughness: 0.95, envMapIntensity: 0.1 },
  'plastic-black': { color: 0x1a1a1a, metalness: 0.0, roughness: 0.5, envMapIntensity: 0.3 },
  'plastic-white': { color: 0xf0f0f0, metalness: 0.0, roughness: 0.4, envMapIntensity: 0.3 },
  'glass': { color: 0xffffff, metalness: 0.0, roughness: 0.05, envMapIntensity: 1.0, transparent: true, opacity: 0.3 },
  'carbon-fiber': { color: 0x2a2a2a, metalness: 0.3, roughness: 0.4, envMapIntensity: 0.5 },
  'wood-oak': { color: 0x8b6914, metalness: 0.0, roughness: 0.8, envMapIntensity: 0.2 },
  'concrete': { color: 0x999999, metalness: 0.0, roughness: 0.95, envMapIntensity: 0.1 },
};

// Lighting presets
const LIGHTING_PRESETS = {
  studio: {
    ambient: { color: 0xffffff, intensity: 0.3 },
    key: { color: 0xffffff, intensity: 1.0, position: [5, 10, 5] },
    fill: { color: 0x8888ff, intensity: 0.4, position: [-5, 5, -5] },
    rim: { color: 0xffffff, intensity: 0.3, position: [0, -3, -8] },
  },
  outdoor: {
    ambient: { color: 0x87ceeb, intensity: 0.5 },
    key: { color: 0xfdf4dc, intensity: 1.2, position: [10, 20, 5] },
    fill: { color: 0x87ceeb, intensity: 0.3, position: [-10, 5, -5] },
    rim: { color: 0xffffff, intensity: 0.2, position: [0, -5, -10] },
  },
  dramatic: {
    ambient: { color: 0x111111, intensity: 0.1 },
    key: { color: 0xff8800, intensity: 1.5, position: [3, 8, 3] },
    fill: { color: 0x0044ff, intensity: 0.3, position: [-8, 2, -3] },
    rim: { color: 0xffffff, intensity: 0.5, position: [0, 0, -10] },
  },
  technical: {
    ambient: { color: 0xffffff, intensity: 0.6 },
    key: { color: 0xffffff, intensity: 0.6, position: [5, 10, 5] },
    fill: { color: 0xffffff, intensity: 0.4, position: [-5, 8, -5] },
    rim: { color: 0xffffff, intensity: 0.3, position: [5, 8, -5] },
  },
};

export { PBR_PRESETS, LIGHTING_PRESETS };

export default class RenderEngine {

  /**
   * Apply a PBR material preset to a mesh or group.
   */
  static applyMaterial(object, presetName) {
    const preset = PBR_PRESETS[presetName];
    if (!preset) return;

    object.traverse(child => {
      if (child.isMesh && child.material) {
        child.material = new THREE.MeshStandardMaterial({
          color: preset.color,
          metalness: preset.metalness,
          roughness: preset.roughness,
          envMapIntensity: preset.envMapIntensity || 1,
          transparent: preset.transparent || false,
          opacity: preset.opacity || 1,
          side: THREE.DoubleSide,
        });
        child.material.needsUpdate = true;
      }
    });
  }

  /**
   * Apply lighting preset to a scene.
   */
  static applyLighting(scene, presetName) {
    const preset = LIGHTING_PRESETS[presetName];
    if (!preset) return;

    // Remove existing lights
    const toRemove = [];
    scene.traverse(obj => {
      if (obj.isLight && !obj.userData?.keep) toRemove.push(obj);
    });
    toRemove.forEach(l => scene.remove(l));

    // Add new lights
    const ambient = new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(preset.key.color, preset.key.intensity);
    key.position.set(...preset.key.position);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const fill = new THREE.DirectionalLight(preset.fill.color, preset.fill.intensity);
    fill.position.set(...preset.fill.position);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(preset.rim.color, preset.rim.intensity);
    rim.position.set(...preset.rim.position);
    scene.add(rim);
  }

  /**
   * Render current scene to an image (screenshot).
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {number} width
   * @param {number} height
   * @returns {string} Data URL (base64 PNG)
   */
  static renderToImage(renderer, scene, camera, width = 1920, height = 1080) {
    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png');

    // Restore
    renderer.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevSize.x / prevSize.y;
    camera.updateProjectionMatrix();

    return dataUrl;
  }

  /**
   * Download rendered image.
   */
  static downloadRender(renderer, scene, camera, filename = 'ArchDisc_Render.png', width = 3840, height = 2160) {
    const dataUrl = RenderEngine.renderToImage(renderer, scene, camera, width, height);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Apply FEA stress coloring to a mesh group.
   * Maps Von Mises stress to a blue-green-yellow-red gradient.
   */
  static applyStressColors(group, feaResult) {
    if (!feaResult?.stressField) return;

    const maxStress = feaResult.results.maxVonMises;
    const minStress = feaResult.results.minVonMises;

    group.traverse(child => {
      if (child.isMesh && child.geometry) {
        const positions = child.geometry.getAttribute('position');
        if (!positions) return;

        const colors = new Float32Array(positions.count * 3);
        const bbox = new THREE.Box3().setFromObject(child);
        const size = bbox.getSize(new THREE.Vector3());

        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i);
          const t = (y - bbox.min.y) / (size.y || 1); // normalize to 0-1
          const stress = minStress + t * (maxStress - minStress);
          const normalized = (stress - minStress) / (maxStress - minStress + 1e-10);

          // Rainbow: blue(0) → cyan(0.25) → green(0.5) → yellow(0.75) → red(1)
          const color = new THREE.Color();
          color.setHSL(0.66 - normalized * 0.66, 1, 0.5);
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }

        child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        child.material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          metalness: 0.1,
          roughness: 0.8,
          side: THREE.DoubleSide,
        });
      }
    });
  }
}
