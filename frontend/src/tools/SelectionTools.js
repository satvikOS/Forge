/**
 * Selection Tools - Blender/SketchUp style selection tools
 */

import { SelectionTool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Basic Select Tool - Click to select objects
export class SelectTool extends SelectionTool {
  constructor() {
    super('select', 'Select', '🖱️', 'Select objects with click', 'S');
    this.startPoint = null;
  }

  onClick(event, context) {
    const { raycaster, camera, scene, sceneManager } = context;
    
    // Update raycaster from mouse position
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    if (intersects.length > 0) {
      const object = intersects[0].object;
      const mode = event.shiftKey ? 'add' : event.ctrlKey ? 'subtract' : 'replace';
      
      // Find the scene object ID from userData
      if (object.userData && object.userData.sceneObjectId) {
        sceneManager.selectObject(object.userData.sceneObjectId, mode);
      }
    } else if (!event.shiftKey && !event.ctrlKey) {
      sceneManager.deselectAll();
    }
  }
}

// Box Select Tool - Drag to select multiple objects
export class SelectBoxTool extends SelectionTool {
  constructor() {
    super('select_box', 'Box Select', '⬚', 'Select multiple objects with box', 'B');
    this.startPoint = null;
    this.endPoint = null;
    this.isSelecting = false;
  }

  onMouseDown(event, context) {
    const rect = event.target.getBoundingClientRect();
    this.startPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    this.isSelecting = true;
  }

  onMouseMove(event, context) {
    if (this.isSelecting && this.startPoint) {
      const rect = event.target.getBoundingClientRect();
      this.endPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      context.needsRender = true;
    }
  }

  onMouseUp(event, context) {
    if (this.isSelecting && this.startPoint && this.endPoint) {
      this.performBoxSelection(context, event.shiftKey);
    }
    this.startPoint = null;
    this.endPoint = null;
    this.isSelecting = false;
    context.needsRender = true;
  }

  performBoxSelection(context, addToSelection) {
    const { camera, scene, sceneManager } = context;
    const rect = context.canvas.getBoundingClientRect();
    
    // Create normalized device coordinates for box corners
    const minX = Math.min(this.startPoint.x, this.endPoint.x);
    const maxX = Math.max(this.startPoint.x, this.endPoint.x);
    const minY = Math.min(this.startPoint.y, this.endPoint.y);
    const maxY = Math.max(this.startPoint.y, this.endPoint.y);
    
    if (!addToSelection) {
      sceneManager.deselectAll();
    }
    
    // Check each object if it's within the box
    scene.children.forEach(object => {
      if (object.userData && object.userData.sceneObjectId) {
        const pos = new THREE.Vector3();
        object.getWorldPosition(pos);
        pos.project(camera);
        
        const x = (pos.x * 0.5 + 0.5) * rect.width;
        const y = (pos.y * -0.5 + 0.5) * rect.height;
        
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          sceneManager.selectObject(object.userData.sceneObjectId, 'add');
        }
      }
    });
  }

  render(context) {
    if (this.isSelecting && this.startPoint && this.endPoint) {
      return {
        type: 'box',
        startPoint: this.startPoint,
        endPoint: this.endPoint,
        color: '#ff6b35',
        fillOpacity: 0.1,
        strokeWidth: 2
      };
    }
    return null;
  }
}

// Circle Select Tool - Radial selection
export class SelectCircleTool extends SelectionTool {
  constructor() {
    super('select_circle', 'Circle Select', '⭕', 'Select objects in circular area', 'C');
    this.center = null;
    this.radius = 50;
    this.isSelecting = false;
  }

  onMouseDown(event, context) {
    this.isSelecting = true;
    this.updateSelection(event, context);
  }

  onMouseMove(event, context) {
    const rect = event.target.getBoundingClientRect();
    this.center = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    if (this.isSelecting) {
      this.updateSelection(event, context);
    }
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    this.isSelecting = false;
  }

  updateSelection(event, context) {
    const { camera, scene, sceneManager } = context;
    const rect = context.canvas.getBoundingClientRect();
    
    scene.children.forEach(object => {
      if (object.userData && object.userData.sceneObjectId) {
        const pos = new THREE.Vector3();
        object.getWorldPosition(pos);
        pos.project(camera);
        
        const x = (pos.x * 0.5 + 0.5) * rect.width;
        const y = (pos.y * -0.5 + 0.5) * rect.height;
        
        const dx = x - this.center.x;
        const dy = y - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= this.radius) {
          const mode = event.shiftKey ? 'add' : event.ctrlKey ? 'subtract' : 'add';
          sceneManager.selectObject(object.userData.sceneObjectId, mode);
        }
      }
    });
  }

  onKeyDown(event, context) {
    // Adjust radius with mouse wheel or +/- keys
    if (event.key === '+' || event.key === '=') {
      this.radius = Math.min(this.radius + 10, 200);
      context.needsRender = true;
    } else if (event.key === '-' || event.key === '_') {
      this.radius = Math.max(this.radius - 10, 20);
      context.needsRender = true;
    }
  }

  render(context) {
    if (this.center) {
      return {
        type: 'circle',
        center: this.center,
        radius: this.radius,
        color: '#ff6b35',
        fillOpacity: 0.1,
        strokeWidth: 2
      };
    }
    return null;
  }
}

// Select All Tool
export class SelectAllTool extends SelectionTool {
  constructor() {
    super('select_all', 'Select All', '⬚', 'Select all objects', 'A');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    sceneManager.selectAll();
    // Deactivate immediately after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// Invert Selection Tool
export class InvertSelectionTool extends SelectionTool {
  constructor() {
    super('invert_selection', 'Invert Selection', '↔', 'Invert current selection', 'I');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    sceneManager.invertSelection();
    // Deactivate immediately after use
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

export default {
  SelectTool,
  SelectBoxTool,
  SelectCircleTool,
  SelectAllTool,
  InvertSelectionTool,
};
