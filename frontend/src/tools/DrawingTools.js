/**
 * Drawing Tools - Line, Rectangle, Circle drawing tools (SketchUp-style)
 */

import { Tool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Line Drawing Tool
export class LineTool extends Tool {
  constructor() {
    super('line', 'Line', '📏', 'Draw lines', 'drawing', 'L');
    this.points = [];
    this.isDrawing = false;
  }

  onMouseDown(event, context) {
    const { raycaster, camera, sceneManager } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    
    // Raycast to ground plane
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, point);
    
    if (point) {
      this.points.push(point.clone());
      
      if (this.points.length === 2) {
        // Create line object
        this.createLine(sceneManager);
        this.points = [];
      }
      
      context.needsRender = true;
    }
  }

  createLine(sceneManager) {
    const start = this.points[0];
    const end = this.points[1];
    
    // Calculate line dimensions
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    
    // Create cylinder representing the line
    const obj = sceneManager.createObject(
      `Line ${sceneManager.objectIdCounter}`,
      'line',
      {
        type: 'cylinder',
        radiusTop: 0.02,
        radiusBottom: 0.02,
        height: length,
        radialSegments: 8,
      }
    );
    
    obj.position = { x: center.x, y: center.y, z: center.z };
    
    // Calculate rotation to align with line direction
    const up = new THREE.Vector3(0, 1, 0);
    direction.normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    obj.rotation = { x: euler.x, y: euler.y, z: euler.z };
    
    sceneManager.saveState();
  }

  onKeyDown(event, context) {
    if (event.key === 'Escape') {
      this.points = [];
      context.needsRender = true;
    }
  }

  render(context) {
    if (this.points.length === 1) {
      return {
        type: 'preview_line',
        points: this.points,
        color: '#ff6b35',
      };
    }
    return null;
  }
}

// Rectangle Drawing Tool
export class RectangleTool extends Tool {
  constructor() {
    super('rectangle', 'Rectangle', '▭', 'Draw rectangles', 'drawing', 'Shift+R');
    this.startPoint = null;
    this.isDrawing = false;
  }

  onMouseDown(event, context) {
    const { raycaster, camera } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, point);
    
    if (point) {
      this.startPoint = point.clone();
      this.isDrawing = true;
    }
  }

  onMouseMove(event, context) {
    if (this.isDrawing && this.startPoint) {
      context.needsRender = true;
    }
  }

  onMouseUp(event, context) {
    if (this.isDrawing && this.startPoint) {
      const { raycaster, camera, sceneManager } = context;
      const rect = event.target.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      
      raycaster.setFromCamera(mouse, camera);
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const endPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, endPoint);
      
      if (endPoint) {
        this.createRectangle(this.startPoint, endPoint, sceneManager);
      }
      
      this.startPoint = null;
      this.isDrawing = false;
      context.needsRender = true;
    }
  }

  createRectangle(start, end, sceneManager) {
    const width = Math.abs(end.x - start.x);
    const depth = Math.abs(end.z - start.z);
    
    if (width < 0.1 || depth < 0.1) return; // Minimum size
    
    const center = new THREE.Vector3(
      (start.x + end.x) / 2,
      start.y,
      (start.z + end.z) / 2
    );
    
    const obj = sceneManager.createObject(
      `Rectangle ${sceneManager.objectIdCounter}`,
      'rectangle',
      {
        type: 'box',
        width: width,
        height: 0.05,
        depth: depth,
      }
    );
    
    obj.position = { x: center.x, y: center.y, z: center.z };
    sceneManager.saveState();
  }
}

// Circle Drawing Tool
export class CircleTool extends Tool {
  constructor() {
    super('circle_draw', 'Draw Circle', '○', 'Draw circles', 'drawing', 'Shift+C');
    this.center = null;
    this.isDrawing = false;
  }

  onMouseDown(event, context) {
    const { raycaster, camera } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, point);
    
    if (point) {
      this.center = point.clone();
      this.isDrawing = true;
    }
  }

  onMouseMove(event, context) {
    if (this.isDrawing && this.center) {
      context.needsRender = true;
    }
  }

  onMouseUp(event, context) {
    if (this.isDrawing && this.center) {
      const { raycaster, camera, sceneManager } = context;
      const rect = event.target.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      
      raycaster.setFromCamera(mouse, camera);
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const edgePoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, edgePoint);
      
      if (edgePoint) {
        const radius = this.center.distanceTo(edgePoint);
        if (radius > 0.1) {
          this.createCircle(this.center, radius, sceneManager);
        }
      }
      
      this.center = null;
      this.isDrawing = false;
      context.needsRender = true;
    }
  }

  createCircle(center, radius, sceneManager) {
    const obj = sceneManager.createObject(
      `Circle ${sceneManager.objectIdCounter}`,
      'circle_shape',
      {
        type: 'cylinder',
        radiusTop: radius,
        radiusBottom: radius,
        height: 0.05,
        radialSegments: 32,
      }
    );
    
    obj.position = { x: center.x, y: center.y, z: center.z };
    sceneManager.saveState();
  }
}

// Polygon Tool
export class PolygonTool extends Tool {
  constructor() {
    super('polygon', 'Polygon', '⬡', 'Draw polygons', 'drawing', 'Shift+P');
    this.points = [];
  }

  onMouseDown(event, context) {
    if (event.button === 2) { // Right click to finish
      if (this.points.length >= 3) {
        this.createPolygon(context.sceneManager);
      }
      this.points = [];
      context.needsRender = true;
      return;
    }

    const { raycaster, camera } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, point);
    
    if (point) {
      this.points.push(point.clone());
      context.needsRender = true;
    }
  }

  createPolygon(sceneManager) {
    // Create a simple representation using boxes
    // In a real implementation, this would use custom geometry
    for (let i = 0; i < this.points.length; i++) {
      const start = this.points[i];
      const end = this.points[(i + 1) % this.points.length];
      
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      
      const obj = sceneManager.createObject(
        `Polygon Edge ${i}`,
        'polygon_edge',
        {
          type: 'cylinder',
          radiusTop: 0.02,
          radiusBottom: 0.02,
          height: length,
          radialSegments: 8,
        }
      );
      
      obj.position = { x: center.x, y: center.y, z: center.z };
      
      const up = new THREE.Vector3(0, 1, 0);
      direction.normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
      const euler = new THREE.Euler().setFromQuaternion(quaternion);
      obj.rotation = { x: euler.x, y: euler.y, z: euler.z };
    }
    
    sceneManager.saveState();
  }

  onKeyDown(event, context) {
    if (event.key === 'Escape') {
      this.points = [];
      context.needsRender = true;
    } else if (event.key === 'Enter') {
      if (this.points.length >= 3) {
        this.createPolygon(context.sceneManager);
      }
      this.points = [];
      context.needsRender = true;
    }
  }
}

export default {
  LineTool,
  RectangleTool,
  CircleTool,
  PolygonTool,
};
