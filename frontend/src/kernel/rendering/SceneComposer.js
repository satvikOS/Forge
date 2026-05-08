/**
 * ArchDisc — Scene Composer
 * Compose publication-ready scenes: backgrounds, environment reflections,
 * camera presets, turntable animation, multi-angle render export.
 */

import * as THREE from 'three';

const BACKGROUNDS = {
  studio: { top: 0x2a2a3e, bottom: 0x0d0d1a },
  white: { top: 0xffffff, bottom: 0xdddddd },
  dark: { top: 0x111122, bottom: 0x000000 },
  blueprint: { top: 0x1a3a5c, bottom: 0x0a1a2c },
  sunset: { top: 0xff6633, bottom: 0x1a0a2c },
  outdoor: { top: 0x87ceeb, bottom: 0x3a7a3a },
};

const CAMERA_PRESETS = {
  front: { pos: [0, 0, 10], target: [0, 0, 0] },
  back: { pos: [0, 0, -10], target: [0, 0, 0] },
  top: { pos: [0, 10, 0.01], target: [0, 0, 0] },
  bottom: { pos: [0, -10, 0.01], target: [0, 0, 0] },
  left: { pos: [-10, 0, 0], target: [0, 0, 0] },
  right: { pos: [10, 0, 0], target: [0, 0, 0] },
  isometric: { pos: [7, 7, 7], target: [0, 0, 0] },
  perspective: { pos: [8, 5, 8], target: [0, 0, 0] },
  closeup: { pos: [3, 2, 3], target: [0, 0, 0] },
  hero: { pos: [6, 3, 8], target: [0, 0.5, 0] },
};

export { BACKGROUNDS, CAMERA_PRESETS };

export default class SceneComposer {

  /**
   * Apply gradient background.
   */
  static setBackground(scene, presetName) {
    const preset = BACKGROUNDS[presetName];
    if (!preset) return;

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);

    const top = new THREE.Color(preset.top);
    const bottom = new THREE.Color(preset.bottom);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(1, `#${bottom.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    scene.background = texture;
  }

  /**
   * Apply camera preset, auto-framing to scene content.
   */
  static setCamera(camera, controls, presetName, scene) {
    const preset = CAMERA_PRESETS[presetName];
    if (!preset) return;

    // Calculate scene bounds
    const box = new THREE.Box3();
    scene.traverse(obj => {
      if (obj.isMesh && !obj.userData?.isHelper && obj.visible) {
        box.expandByObject(obj);
      }
    });

    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(5, 5, 5) : box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 5;
    const scale = maxDim * 0.8;

    camera.position.set(
      center.x + preset.pos[0] * scale / 10,
      center.y + preset.pos[1] * scale / 10,
      center.z + preset.pos[2] * scale / 10
    );

    if (controls) {
      controls.target.set(
        center.x + preset.target[0],
        center.y + preset.target[1],
        center.z + preset.target[2]
      );
      controls.update();
    }
  }

  /**
   * Add a ground plane with shadow receiver and optional reflection.
   */
  static addGroundPlane(scene, options = {}) {
    const {
      size = 50,
      color = 0x222233,
      opacity = 0.3,
      reflective = false,
    } = options;

    // Remove existing ground
    const existing = scene.getObjectByName('__composer_ground__');
    if (existing) scene.remove(existing);

    const geo = new THREE.PlaneGeometry(size, size);
    let mat;

    if (reflective) {
      mat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: opacity,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity,
        metalness: 0,
        roughness: 1,
      });
    }

    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    plane.name = '__composer_ground__';
    plane.userData.isHelper = true;
    scene.add(plane);
  }

  /**
   * Generate turntable animation frames.
   * Returns an array of data URLs (images).
   */
  static async turntableRender(renderer, scene, camera, controls, options = {}) {
    const {
      frames = 36,
      width = 1920,
      height = 1080,
      radius = null,
    } = options;

    const box = new THREE.Box3();
    scene.traverse(obj => {
      if (obj.isMesh && !obj.userData?.isHelper) box.expandByObject(obj);
    });
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 5 : box.getSize(new THREE.Vector3()).length();
    const dist = radius || size * 1.5;

    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const images = [];
    for (let i = 0; i < frames; i++) {
      const angle = (i / frames) * Math.PI * 2;
      camera.position.set(
        center.x + Math.sin(angle) * dist,
        center.y + dist * 0.4,
        center.z + Math.cos(angle) * dist
      );
      camera.lookAt(center);
      renderer.render(scene, camera);
      images.push(renderer.domElement.toDataURL('image/png'));
    }

    // Restore
    renderer.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevSize.x / prevSize.y;
    camera.updateProjectionMatrix();

    return images;
  }

  /**
   * Render multi-view layout (front, top, right, isometric) to single image.
   */
  static multiViewRender(renderer, scene, camera, controls, options = {}) {
    const { width = 3840, height = 2160 } = options;
    const views = ['front', 'top', 'right', 'isometric'];
    const halfW = width / 2, halfH = height / 2;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(halfW, halfH);
    camera.aspect = halfW / halfH;
    camera.updateProjectionMatrix();

    views.forEach((view, i) => {
      SceneComposer.setCamera(camera, null, view, scene);
      camera.lookAt(controls?.target || new THREE.Vector3());
      renderer.render(scene, camera);
      const x = (i % 2) * halfW;
      const y = Math.floor(i / 2) * halfH;
      ctx.drawImage(renderer.domElement, x, y);

      // Labels
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px monospace';
      ctx.fillText(view.toUpperCase(), x + 20, y + 36);
    });

    renderer.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevSize.x / prevSize.y;
    camera.updateProjectionMatrix();

    return canvas.toDataURL('image/png');
  }

  /**
   * Download image from data URL.
   */
  static downloadImage(dataUrl, filename = 'ArchDisc_Render.png') {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
