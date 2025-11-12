/**
 * Camera Tools - Camera controls and view presets
 */

import { Tool } from '../systems/ToolSystem';
import * as THREE from 'three';

// View Preset Tool Base
class ViewPresetTool extends Tool {
  constructor(id, name, icon, description, position, target) {
    super(id, name, icon, description, 'camera');
    this.cameraPosition = position;
    this.cameraTarget = target || new THREE.Vector3(0, 0, 0);
  }

  onActivate(context) {
    super.onActivate(context);
    const { camera, controls } = context;
    
    if (camera && controls) {
      // Animate camera to new position
      camera.position.set(
        this.cameraPosition.x,
        this.cameraPosition.y,
        this.cameraPosition.z
      );
      
      if (controls.target) {
        controls.target.copy(this.cameraTarget);
      }
      
      controls.update();
      context.needsRender = true;
    }
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// View Presets
export class TopViewTool extends ViewPresetTool {
  constructor() {
    super(
      'view_top',
      'Top View',
      '⬇',
      'View from top',
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(0, 0, 0)
    );
  }
}

export class FrontViewTool extends ViewPresetTool {
  constructor() {
    super(
      'view_front',
      'Front View',
      '⬅',
      'View from front',
      new THREE.Vector3(0, 5, 10),
      new THREE.Vector3(0, 0, 0)
    );
  }
}

export class SideViewTool extends ViewPresetTool {
  constructor() {
    super(
      'view_side',
      'Side View',
      '⬆',
      'View from side',
      new THREE.Vector3(10, 5, 0),
      new THREE.Vector3(0, 0, 0)
    );
  }
}

export class PerspectiveViewTool extends ViewPresetTool {
  constructor() {
    super(
      'view_perspective',
      'Perspective',
      '🔲',
      'Perspective view',
      new THREE.Vector3(5, 5, 5),
      new THREE.Vector3(0, 0, 0)
    );
  }
}

// Focus on Selection Tool
export class FocusSelectionTool extends Tool {
  constructor() {
    super('focus_selection', 'Focus', '🎯', 'Focus camera on selection', 'camera', 'F');
  }

  onActivate(context) {
    super.onActivate(context);
    const { camera, controls, sceneManager } = context;
    
    const selected = sceneManager.getSelectedObjects();
    if (selected.length === 0) return;
    
    // Calculate bounding box of selected objects
    const bounds = this.calculateBounds(selected);
    const center = bounds.center;
    const size = bounds.size;
    
    // Calculate optimal camera distance
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov ? camera.fov : 50;
    const distance = maxDim / (2 * Math.tan((fov * Math.PI) / 360));
    
    // Position camera
    const direction = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    
    camera.position.copy(center).add(direction.multiplyScalar(distance * 1.5));
    controls.target.copy(center);
    controls.update();
    
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }

  calculateBounds(objects) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    objects.forEach(obj => {
      const pos = obj.position;
      const scale = obj.scale;
      const geom = obj.geometry;
      
      // Approximate bounds based on geometry type
      let sizeX = 1, sizeY = 1, sizeZ = 1;
      
      if (geom.type === 'box') {
        sizeX = (geom.width || 1) * scale.x / 2;
        sizeY = (geom.height || 1) * scale.y / 2;
        sizeZ = (geom.depth || 1) * scale.z / 2;
      } else if (geom.type === 'sphere') {
        const r = (geom.radius || 0.5) * Math.max(scale.x, scale.y, scale.z);
        sizeX = sizeY = sizeZ = r;
      } else if (geom.type === 'cylinder' || geom.type === 'cone') {
        const r = (geom.radius || geom.radiusTop || 0.5) * Math.max(scale.x, scale.z);
        sizeX = sizeZ = r;
        sizeY = (geom.height || 1) * scale.y / 2;
      }
      
      minX = Math.min(minX, pos.x - sizeX);
      minY = Math.min(minY, pos.y - sizeY);
      minZ = Math.min(minZ, pos.z - sizeZ);
      maxX = Math.max(maxX, pos.x + sizeX);
      maxY = Math.max(maxY, pos.y + sizeY);
      maxZ = Math.max(maxZ, pos.z + sizeZ);
    });
    
    return {
      center: new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2
      ),
      size: new THREE.Vector3(
        maxX - minX,
        maxY - minY,
        maxZ - minZ
      ),
    };
  }
}

// Frame All Tool - Zoom to fit all objects
export class FrameAllTool extends Tool {
  constructor() {
    super('frame_all', 'Frame All', '🖼️', 'Frame all objects in view', 'camera', 'Home');
  }

  onActivate(context) {
    super.onActivate(context);
    const { camera, controls, sceneManager } = context;
    
    const allObjects = sceneManager.getAllObjects();
    if (allObjects.length === 0) return;
    
    // Calculate bounding box of all objects
    const bounds = this.calculateBounds(allObjects);
    const center = bounds.center;
    const size = bounds.size;
    
    // Calculate optimal camera distance
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov ? camera.fov : 50;
    const distance = maxDim / (2 * Math.tan((fov * Math.PI) / 360));
    
    // Position camera at 45-45 degrees
    const offset = distance * 1.5;
    camera.position.set(
      center.x + offset * 0.707,
      center.y + offset * 0.707,
      center.z + offset * 0.707
    );
    
    controls.target.copy(center);
    controls.update();
    
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }

  calculateBounds(objects) {
    // Same as FocusSelectionTool.calculateBounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    objects.forEach(obj => {
      const pos = obj.position;
      const scale = obj.scale;
      const geom = obj.geometry;
      
      let sizeX = 1, sizeY = 1, sizeZ = 1;
      
      if (geom.type === 'box') {
        sizeX = (geom.width || 1) * scale.x / 2;
        sizeY = (geom.height || 1) * scale.y / 2;
        sizeZ = (geom.depth || 1) * scale.z / 2;
      } else if (geom.type === 'sphere') {
        const r = (geom.radius || 0.5) * Math.max(scale.x, scale.y, scale.z);
        sizeX = sizeY = sizeZ = r;
      } else if (geom.type === 'cylinder' || geom.type === 'cone') {
        const r = (geom.radius || geom.radiusTop || 0.5) * Math.max(scale.x, scale.z);
        sizeX = sizeZ = r;
        sizeY = (geom.height || 1) * scale.y / 2;
      }
      
      minX = Math.min(minX, pos.x - sizeX);
      minY = Math.min(minY, pos.y - sizeY);
      minZ = Math.min(minZ, pos.z - sizeZ);
      maxX = Math.max(maxX, pos.x + sizeX);
      maxY = Math.max(maxY, pos.y + sizeY);
      maxZ = Math.max(maxZ, pos.z + sizeZ);
    });
    
    return {
      center: new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2
      ),
      size: new THREE.Vector3(
        maxX - minX,
        maxY - minY,
        maxZ - minZ
      ),
    };
  }
}

export default {
  TopViewTool,
  FrontViewTool,
  SideViewTool,
  PerspectiveViewTool,
  FocusSelectionTool,
  FrameAllTool,
};
