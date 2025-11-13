/**
 * Transform Tools - Move, Rotate, Scale with gizmos
 */

import { TransformTool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Move Tool - Translate objects in 3D space
export class MoveTool extends TransformTool {
  constructor() {
    super('move', 'Move', '↔️', 'Move selected objects', 'G');
    this.isDragging = false;
    this.startPosition = null;
    this.objectStartPositions = new Map();
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    // Store initial positions
    this.objectStartPositions.clear();
    selected.forEach(obj => {
      this.objectStartPositions.set(obj.id, { ...obj.position });
    });
  }

  onMouseDown(event, context) {
    const { raycaster, camera, sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length === 0) return;
    
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    this.isDragging = true;
    this.startPosition = { x: mouse.x, y: mouse.y };
  }

  onMouseMove(event, context) {
    if (!this.isDragging || !this.startPosition) return;
    
    const { camera, sceneManager } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    const deltaX = mouse.x - this.startPosition.x;
    const deltaY = mouse.y - this.startPosition.y;
    
    // Get camera right and up vectors for screen-space movement
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    
    // Calculate movement in world space
    const moveAmount = 5; // Sensitivity
    const movement = new THREE.Vector3();
    
    if (this.axisLock === 'x') {
      movement.x = deltaX * moveAmount;
    } else if (this.axisLock === 'y') {
      movement.y = deltaY * moveAmount;
    } else if (this.axisLock === 'z') {
      movement.z = -deltaY * moveAmount;
    } else {
      movement.addScaledVector(right, deltaX * moveAmount);
      movement.addScaledVector(up, deltaY * moveAmount);
    }
    
    // Apply movement to all selected objects
    const selected = sceneManager.getSelectedObjects();
    selected.forEach(obj => {
      const startPos = this.objectStartPositions.get(obj.id);
      if (startPos) {
        obj.position.x = this.snapToGrid(startPos.x + movement.x);
        obj.position.y = this.snapToGrid(startPos.y + movement.y);
        obj.position.z = this.snapToGrid(startPos.z + movement.z);
      }
    });
    
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    if (this.isDragging) {
      const { sceneManager } = context;
      sceneManager.saveState();
    }
    this.isDragging = false;
    this.startPosition = null;
  }

  onKeyDown(event, context) {
    // Axis locking
    if (event.key === 'x' || event.key === 'X') {
      this.axisLock = this.axisLock === 'x' ? null : 'x';
      context.needsRender = true;
    } else if (event.key === 'y' || event.key === 'Y') {
      this.axisLock = this.axisLock === 'y' ? null : 'y';
      context.needsRender = true;
    } else if (event.key === 'z' || event.key === 'Z') {
      this.axisLock = this.axisLock === 'z' ? null : 'z';
      context.needsRender = true;
    } else if (event.key === 'Escape') {
      // Cancel operation
      this.cancelMove(context);
    } else if (event.key === 'Enter') {
      // Confirm operation
      this.confirmMove(context);
    }
  }

  cancelMove(context) {
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    // Restore original positions
    selected.forEach(obj => {
      const startPos = this.objectStartPositions.get(obj.id);
      if (startPos) {
        obj.position = { ...startPos };
      }
    });
    
    this.isDragging = false;
    context.needsRender = true;
  }

  confirmMove(context) {
    const { sceneManager } = context;
    sceneManager.saveState();
    this.isDragging = false;
  }
}

// Rotate Tool - Rotate objects around axes
export class RotateTool extends TransformTool {
  constructor() {
    super('rotate', 'Rotate', '🔄', 'Rotate selected objects', 'R');
    this.isDragging = false;
    this.startAngle = 0;
    this.objectStartRotations = new Map();
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    // Store initial rotations
    this.objectStartRotations.clear();
    selected.forEach(obj => {
      this.objectStartRotations.set(obj.id, { ...obj.rotation });
    });
  }

  onMouseDown(event, context) {
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length === 0) return;
    
    const rect = event.target.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    
    this.isDragging = true;
    this.startAngle = Math.atan2(y, x);
  }

  onMouseMove(event, context) {
    if (!this.isDragging) return;
    
    const { sceneManager } = context;
    const rect = event.target.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    
    const currentAngle = Math.atan2(y, x);
    const deltaAngle = currentAngle - this.startAngle;
    
    // Apply rotation to all selected objects
    const selected = sceneManager.getSelectedObjects();
    selected.forEach(obj => {
      const startRot = this.objectStartRotations.get(obj.id);
      if (startRot) {
        if (this.axisLock === 'x') {
          obj.rotation.x = this.snapToGrid(startRot.x + deltaAngle);
        } else if (this.axisLock === 'y') {
          obj.rotation.y = this.snapToGrid(startRot.y + deltaAngle);
        } else if (this.axisLock === 'z') {
          obj.rotation.z = this.snapToGrid(startRot.z + deltaAngle);
        } else {
          // Default to Z-axis rotation
          obj.rotation.z = this.snapToGrid(startRot.z + deltaAngle);
        }
      }
    });
    
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    if (this.isDragging) {
      const { sceneManager } = context;
      sceneManager.saveState();
    }
    this.isDragging = false;
  }

  onKeyDown(event, context) {
    // Axis locking
    if (event.key === 'x' || event.key === 'X') {
      this.axisLock = this.axisLock === 'x' ? null : 'x';
    } else if (event.key === 'y' || event.key === 'Y') {
      this.axisLock = this.axisLock === 'y' ? null : 'y';
    } else if (event.key === 'z' || event.key === 'Z') {
      this.axisLock = this.axisLock === 'z' ? null : 'z';
    }
    context.needsRender = true;
  }
}

// Scale Tool - Scale objects uniformly or per-axis
export class ScaleTool extends TransformTool {
  constructor() {
    super('scale', 'Scale', '⇔', 'Scale selected objects', 'S');
    this.isDragging = false;
    this.startDistance = 0;
    this.objectStartScales = new Map();
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    // Store initial scales
    this.objectStartScales.clear();
    selected.forEach(obj => {
      this.objectStartScales.set(obj.id, { ...obj.scale });
    });
  }

  onMouseDown(event, context) {
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length === 0) return;
    
    const rect = event.target.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    
    this.isDragging = true;
    this.startDistance = Math.sqrt(x * x + y * y);
  }

  onMouseMove(event, context) {
    if (!this.isDragging) return;
    
    const { sceneManager } = context;
    const rect = event.target.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    
    const currentDistance = Math.sqrt(x * x + y * y);
    const scaleFactor = currentDistance / this.startDistance;
    
    // Apply scale to all selected objects
    const selected = sceneManager.getSelectedObjects();
    selected.forEach(obj => {
      const startScale = this.objectStartScales.get(obj.id);
      if (startScale) {
        if (this.axisLock === 'x') {
          obj.scale.x = Math.max(0.1, this.snapToGrid(startScale.x * scaleFactor));
        } else if (this.axisLock === 'y') {
          obj.scale.y = Math.max(0.1, this.snapToGrid(startScale.y * scaleFactor));
        } else if (this.axisLock === 'z') {
          obj.scale.z = Math.max(0.1, this.snapToGrid(startScale.z * scaleFactor));
        } else {
          // Uniform scaling
          obj.scale.x = Math.max(0.1, this.snapToGrid(startScale.x * scaleFactor));
          obj.scale.y = Math.max(0.1, this.snapToGrid(startScale.y * scaleFactor));
          obj.scale.z = Math.max(0.1, this.snapToGrid(startScale.z * scaleFactor));
        }
      }
    });
    
    context.needsRender = true;
  }

  onMouseUp(event, context) {
    if (this.isDragging) {
      const { sceneManager } = context;
      sceneManager.saveState();
    }
    this.isDragging = false;
  }

  onKeyDown(event, context) {
    // Axis locking
    if (event.key === 'x' || event.key === 'X') {
      this.axisLock = this.axisLock === 'x' ? null : 'x';
    } else if (event.key === 'y' || event.key === 'Y') {
      this.axisLock = this.axisLock === 'y' ? null : 'y';
    } else if (event.key === 'z' || event.key === 'Z') {
      this.axisLock = this.axisLock === 'z' ? null : 'z';
    }
    context.needsRender = true;
  }
}

export default {
  MoveTool,
  RotateTool,
  ScaleTool,
};
