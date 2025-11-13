/**
 * Modeling Tools - Extrude, Push/Pull, Bevel, etc.
 */

import { ModelingTool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Extrude Tool - Extrude faces along their normal
export class ExtrudeTool extends ModelingTool {
  constructor() {
    super('extrude', 'Extrude', '⬆️', 'Extrude selected faces', 'E');
    this.isDragging = false;
    this.startY = 0;
    this.extrudeAmount = 0;
  }

  onMouseDown(event, context) {
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length === 0) return;
    
    this.isDragging = true;
    this.startY = event.clientY;
    this.extrudeAmount = 0;
  }

  onMouseMove(event, context) {
    if (!this.isDragging) return;
    
    const deltaY = this.startY - event.clientY;
    this.extrudeAmount = deltaY / 100; // Scale factor
    
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    if (this.isDragging && this.extrudeAmount !== 0) {
      const { sceneManager } = context;
      // Apply extrusion to selected objects
      const selected = sceneManager.getSelectedObjects();
      selected.forEach(obj => {
        if (obj.geometry && obj.geometry.type === 'box') {
          obj.geometry.height = (obj.geometry.height || 1) + this.extrudeAmount;
          obj.position.y += this.extrudeAmount / 2;
        }
      });
      sceneManager.saveState();
    }
    
    this.isDragging = false;
    this.extrudeAmount = 0;
    context.needsRender = true;
  }

  getSettings() {
    return {
      extrudeAmount: this.extrudeAmount.toFixed(2),
    };
  }
}

// Push/Pull Tool (SketchUp-style)
export class PushPullTool extends ModelingTool {
  constructor() {
    super('push_pull', 'Push/Pull', '↕️', 'Push or pull faces', 'P');
    this.isDragging = false;
    this.targetFace = null;
    this.startY = 0;
  }

  onClick(event, context) {
    const { raycaster, camera, scene, sceneManager } = context;
    
    // Raycast to find face
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    if (intersects.length > 0) {
      this.targetFace = intersects[0];
      this.isDragging = true;
      this.startY = event.clientY;
    }
  }

  onMouseMove(event, context) {
    if (!this.isDragging || !this.targetFace) return;
    
    const deltaY = this.startY - event.clientY;
    const pushAmount = deltaY / 100;
    
    // Apply push/pull based on face normal
    const object = this.targetFace.object;
    if (object.userData && object.userData.sceneObjectId) {
      const { sceneManager } = context;
      const sceneObj = sceneManager.getObject(object.userData.sceneObjectId);
      
      if (sceneObj && sceneObj.geometry) {
        if (sceneObj.geometry.type === 'box') {
          // Adjust the dimension in the direction of the face normal
          const normal = this.targetFace.face.normal;
          if (Math.abs(normal.y) > 0.5) {
            sceneObj.geometry.height = Math.max(0.1, (sceneObj.geometry.height || 1) + pushAmount * 0.1);
          } else if (Math.abs(normal.x) > 0.5) {
            sceneObj.geometry.width = Math.max(0.1, (sceneObj.geometry.width || 1) + pushAmount * 0.1);
          } else if (Math.abs(normal.z) > 0.5) {
            sceneObj.geometry.depth = Math.max(0.1, (sceneObj.geometry.depth || 1) + pushAmount * 0.1);
          }
        }
      }
    }
    
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    if (this.isDragging) {
      const { sceneManager } = context;
      sceneManager.saveState();
    }
    
    this.isDragging = false;
    this.targetFace = null;
  }
}

// Bevel Tool - Bevel edges and vertices
export class BevelTool extends ModelingTool {
  constructor() {
    super('bevel', 'Bevel', '◢', 'Bevel edges and corners', 'Ctrl+B');
    this.bevelAmount = 0.1;
    this.segments = 2;
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    selected.forEach(obj => {
      if (obj.userData) {
        obj.userData.bevel = {
          amount: this.bevelAmount,
          segments: this.segments,
        };
      }
    });
    
    sceneManager.saveState();
    context.needsRender = true;
  }

  onKeyDown(event, context) {
    if (event.key === '+' || event.key === '=') {
      this.bevelAmount = Math.min(this.bevelAmount + 0.05, 0.5);
      this.applyBevel(context);
    } else if (event.key === '-' || event.key === '_') {
      this.bevelAmount = Math.max(this.bevelAmount - 0.05, 0.01);
      this.applyBevel(context);
    }
  }

  applyBevel(context) {
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    selected.forEach(obj => {
      if (obj.userData) {
        obj.userData.bevel = {
          amount: this.bevelAmount,
          segments: this.segments,
        };
      }
    });
    
    context.needsRender = true;
  }

  getSettings() {
    return {
      amount: this.bevelAmount.toFixed(2),
      segments: this.segments,
    };
  }
}

// Subdivide Tool - Subdivide mesh for more detail
export class SubdivideTool extends ModelingTool {
  constructor() {
    super('subdivide', 'Subdivide', '⊞', 'Subdivide selected meshes');
    this.subdivisions = 1;
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    selected.forEach(obj => {
      if (obj.userData) {
        obj.userData.subdivisions = (obj.userData.subdivisions || 0) + this.subdivisions;
      }
    });
    
    sceneManager.saveState();
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// Duplicate Tool - Duplicate selected objects
export class DuplicateTool extends ModelingTool {
  constructor() {
    super('duplicate', 'Duplicate', '⊕', 'Duplicate selected objects', 'Shift+D');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    sceneManager.duplicateSelected();
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// Delete Tool - Delete selected objects
export class DeleteTool extends ModelingTool {
  constructor() {
    super('delete', 'Delete', '🗑️', 'Delete selected objects', 'Delete');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    sceneManager.deleteSelected();
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// Mirror Tool - Mirror objects across an axis
export class MirrorTool extends ModelingTool {
  constructor() {
    super('mirror', 'Mirror', '↔️', 'Mirror selected objects', 'Ctrl+M');
    this.mirrorAxis = 'x';
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    // Duplicate and mirror
    const duplicates = [];
    selected.forEach(obj => {
      const mirrored = obj.clone();
      
      if (this.mirrorAxis === 'x') {
        mirrored.scale.x *= -1;
        mirrored.position.x *= -1;
      } else if (this.mirrorAxis === 'y') {
        mirrored.scale.y *= -1;
        mirrored.position.y *= -1;
      } else if (this.mirrorAxis === 'z') {
        mirrored.scale.z *= -1;
        mirrored.position.z *= -1;
      }
      
      sceneManager.addObject(mirrored);
      duplicates.push(mirrored);
    });
    
    // Select the mirrored objects
    sceneManager.deselectAll();
    duplicates.forEach(obj => sceneManager.selectObject(obj.id, 'add'));
    
    sceneManager.saveState();
    context.needsRender = true;
    
    // Deactivate after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }

  onKeyDown(event, context) {
    if (event.key === 'x' || event.key === 'X') {
      this.mirrorAxis = 'x';
    } else if (event.key === 'y' || event.key === 'Y') {
      this.mirrorAxis = 'y';
    } else if (event.key === 'z' || event.key === 'Z') {
      this.mirrorAxis = 'z';
    }
  }
}

export default {
  ExtrudeTool,
  PushPullTool,
  BevelTool,
  SubdivideTool,
  DuplicateTool,
  DeleteTool,
  MirrorTool,
};
