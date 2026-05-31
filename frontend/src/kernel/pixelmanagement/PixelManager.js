/**
 * ArchDisc — Pixel Management System (Proprietary)
 *
 * Captures the entire screen state so AI knows:
 * - Exact pixel coordinates of every UI element
 * - Which 3D object is under any pixel
 * - Screen-space bounding boxes of all components
 * - UI element states (buttons, inputs, panels)
 * - Viewport projection: world coords ↔ screen coords
 *
 * This enables atomic-level precision: AI can target specific pixels,
 * measure on-screen distances, and validate visual output.
 */

import * as THREE from 'three';

export default class PixelManager {
  constructor() {
    this.screenWidth = 0;
    this.screenHeight = 0;
    this.uiElements = new Map();  // elementId → { rect, type, state, label }
    this.sceneObjects = new Map(); // objectId → { screenRect, worldBBox, name }
    this.pixelBuffer = null;       // GPU readback buffer
    this.objectIdBuffer = null;    // per-pixel object ID
    this.depthBuffer = null;       // per-pixel depth
    this.registered = false;
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
  }

  /**
   * Register with the viewport and start tracking.
   */
  register(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.screenWidth = renderer.domElement.width;
    this.screenHeight = renderer.domElement.height;
    this.registered = true;
  }

  /**
   * Capture full screen state — call this before AI needs to analyze.
   * Returns a complete snapshot of everything visible on screen.
   */
  captureState() {
    if (!this.registered) return null;

    const state = {
      timestamp: Date.now(),
      screen: {
        width: this.screenWidth,
        height: this.screenHeight,
        dpr: window.devicePixelRatio,
      },
      ui: this._captureUIElements(),
      viewport: this._captureViewportState(),
      objects: this._captureSceneObjects(),
      camera: this._captureCameraState(),
    };

    return state;
  }

  /**
   * World position → screen pixel coordinates.
   */
  worldToScreen(worldPos) {
    if (!this.camera) return null;
    const vec = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    vec.project(this.camera);
    return {
      x: Math.round((vec.x + 1) / 2 * this.screenWidth),
      y: Math.round((-vec.y + 1) / 2 * this.screenHeight),
      visible: vec.z < 1, // behind camera if z > 1
    };
  }

  /**
   * Screen pixel → world ray (for AI to target specific pixels).
   */
  screenToWorldRay(screenX, screenY) {
    if (!this.camera) return null;
    this._mouse.x = (screenX / this.screenWidth) * 2 - 1;
    this._mouse.y = -(screenY / this.screenHeight) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    return {
      origin: this._raycaster.ray.origin.clone(),
      direction: this._raycaster.ray.direction.clone(),
    };
  }

  /**
   * Get the 3D object at a specific pixel.
   */
  objectAtPixel(screenX, screenY) {
    if (!this.scene || !this.camera) return null;
    this._mouse.x = (screenX / this.screenWidth) * 2 - 1;
    this._mouse.y = -(screenY / this.screenHeight) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);

    const pickable = [];
    this.scene.traverse(obj => {
      if (obj.isMesh && !obj.userData?.isHelper) pickable.push(obj);
    });

    const hits = this._raycaster.intersectObjects(pickable, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    let target = hit.object;
    while (target.parent && target.parent !== this.scene) target = target.parent;

    return {
      name: target.name || 'Unknown',
      pixelX: screenX,
      pixelY: screenY,
      worldPoint: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      distance: hit.distance,
      faceIndex: hit.faceIndex,
      solidId: target.userData?.kernelSolid?.id,
      partId: target.userData?.partId,
    };
  }

  /**
   * Measure on-screen distance between two world points (in pixels).
   */
  measureScreenDistance(worldA, worldB) {
    const a = this.worldToScreen(worldA);
    const b = this.worldToScreen(worldB);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    return {
      pixels: Math.sqrt(dx * dx + dy * dy),
      pointA: a,
      pointB: b,
      worldDistance: Math.sqrt(
        (worldB.x - worldA.x) ** 2 +
        (worldB.y - worldA.y) ** 2 +
        (worldB.z - worldA.z) ** 2
      ),
    };
  }

  /**
   * Get screen-space bounding box of a 3D object.
   */
  screenBoundingBox(object) {
    if (!this.camera) return null;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;

    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      c.project(this.camera);
      const sx = (c.x + 1) / 2 * this.screenWidth;
      const sy = (-c.y + 1) / 2 * this.screenHeight;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    return {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
      centerX: Math.round((minX + maxX) / 2),
      centerY: Math.round((minY + maxY) / 2),
    };
  }

  /**
   * Generate a complete pixel map of all objects — for AI consumption.
   * Returns a grid of object IDs at sampled pixel locations.
   */
  generatePixelMap(resolution = 64) {
    if (!this.scene || !this.camera) return null;

    const stepX = this.screenWidth / resolution;
    const stepY = this.screenHeight / resolution;
    const map = [];

    for (let row = 0; row < resolution; row++) {
      const rowData = [];
      for (let col = 0; col < resolution; col++) {
        const sx = col * stepX + stepX / 2;
        const sy = row * stepY + stepY / 2;
        const obj = this.objectAtPixel(sx, sy);
        rowData.push(obj ? { name: obj.name, id: obj.solidId || obj.partId } : null);
      }
      map.push(rowData);
    }

    return { resolution, stepX, stepY, map };
  }

  // --- Internal capture methods ---

  _captureUIElements() {
    const elements = [];
    const selectors = [
      '.tool-icon-button', '.dropdown-item', '.gizmo-btn',
      '.topbar-menu-trigger', '.feature-tree-item', '.sidebar-tab',
      '.thought-bubble', '.tool-status-bar', '.ai-console',
      '.header-button', '.workbench-current',
    ];

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        elements.push({
          selector: sel,
          index: i,
          label: el.textContent?.trim()?.substring(0, 50) || el.title || '',
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          visible: rect.width > 0 && rect.height > 0,
          enabled: !el.disabled,
          active: el.classList.contains('active'),
        });
      });
    }

    return elements;
  }

  _captureViewportState() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      resolution: { width: canvas.width, height: canvas.height },
      dpr: window.devicePixelRatio,
    };
  }

  _captureSceneObjects() {
    const objects = [];
    if (!this.scene) return objects;

    this.scene.traverse(obj => {
      if (!obj.isMesh && !obj.isGroup) return;
      if (obj.userData?.isHelper) return;
      if (!obj.name || obj.name.startsWith('__')) return;

      const screenBox = this.screenBoundingBox(obj);
      const worldBox = new THREE.Box3().setFromObject(obj);
      const worldSize = worldBox.getSize(new THREE.Vector3());

      objects.push({
        name: obj.name,
        type: obj.type,
        visible: obj.visible,
        screenRect: screenBox,
        worldSize: { x: worldSize.x.toFixed(4), y: worldSize.y.toFixed(4), z: worldSize.z.toFixed(4) },
        solidId: obj.userData?.kernelSolid?.id,
        partId: obj.userData?.partId,
        pickable: obj.userData?.pickable !== false,
      });
    });

    return objects;
  }

  _captureCameraState() {
    if (!this.camera) return null;
    return {
      position: { x: this.camera.position.x.toFixed(4), y: this.camera.position.y.toFixed(4), z: this.camera.position.z.toFixed(4) },
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      aspect: this.camera.aspect.toFixed(4),
    };
  }
}
