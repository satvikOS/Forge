/**
 * Measurement Tools - Distance, angle, and dimension tools
 */

import { Tool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Tape Measure Tool - Measure distances
export class TapeMeasureTool extends Tool {
  constructor() {
    super('tape_measure', 'Tape Measure', '📏', 'Measure distances', 'measurement', 'M');
    this.startPoint = null;
    this.measurements = [];
  }

  onMouseDown(event, context) {
    const { raycaster, camera, scene } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    let point;
    if (intersects.length > 0) {
      point = intersects[0].point.clone();
    } else {
      // Intersect with ground plane
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      point = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, point);
    }
    
    if (point) {
      if (!this.startPoint) {
        this.startPoint = point;
      } else {
        // Create measurement
        const distance = this.startPoint.distanceTo(point);
        this.measurements.push({
          start: this.startPoint.clone(),
          end: point.clone(),
          distance: distance,
          timestamp: Date.now(),
        });
        this.startPoint = null;
      }
      context.needsRender = true;
    }
  }

  onKeyDown(event, context) {
    if (event.key === 'Escape') {
      this.startPoint = null;
      context.needsRender = true;
    } else if (event.key === 'c' || event.key === 'C') {
      // Clear all measurements
      this.measurements = [];
      context.needsRender = true;
    }
  }

  render(context) {
    const elements = [];
    
    // Render existing measurements
    this.measurements.forEach((measurement, index) => {
      elements.push({
        type: 'measurement_line',
        start: measurement.start,
        end: measurement.end,
        distance: measurement.distance.toFixed(3),
        color: '#00ff00',
        index,
      });
    });
    
    // Render current measurement in progress
    if (this.startPoint) {
      elements.push({
        type: 'measurement_preview',
        start: this.startPoint,
        color: '#ffff00',
      });
    }
    
    return elements.length > 0 ? elements : null;
  }

  getSettings() {
    return {
      measurementCount: this.measurements.length,
      unit: 'meters',
    };
  }
}

// Protractor Tool - Measure angles
export class ProtractorTool extends Tool {
  constructor() {
    super('protractor', 'Protractor', '📐', 'Measure angles', 'measurement');
    this.points = [];
    this.measurements = [];
  }

  onMouseDown(event, context) {
    const { raycaster, camera, scene } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    let point;
    if (intersects.length > 0) {
      point = intersects[0].point.clone();
    } else {
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      point = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, point);
    }
    
    if (point) {
      this.points.push(point);
      
      if (this.points.length === 3) {
        // Calculate angle
        const angle = this.calculateAngle(this.points[0], this.points[1], this.points[2]);
        this.measurements.push({
          points: [...this.points],
          angle: angle,
          timestamp: Date.now(),
        });
        this.points = [];
      }
      
      context.needsRender = true;
    }
  }

  calculateAngle(p1, vertex, p2) {
    const v1 = new THREE.Vector3().subVectors(p1, vertex).normalize();
    const v2 = new THREE.Vector3().subVectors(p2, vertex).normalize();
    const angle = v1.angleTo(v2);
    return THREE.MathUtils.radToDeg(angle);
  }

  onKeyDown(event, context) {
    if (event.key === 'Escape') {
      this.points = [];
      context.needsRender = true;
    } else if (event.key === 'c' || event.key === 'C') {
      this.measurements = [];
      context.needsRender = true;
    }
  }

  render(context) {
    const elements = [];
    
    // Render existing angle measurements
    this.measurements.forEach((measurement, index) => {
      elements.push({
        type: 'angle_measurement',
        points: measurement.points,
        angle: measurement.angle.toFixed(2),
        color: '#00ffff',
        index,
      });
    });
    
    // Render current measurement in progress
    if (this.points.length > 0) {
      elements.push({
        type: 'angle_preview',
        points: this.points,
        color: '#ffff00',
      });
    }
    
    return elements.length > 0 ? elements : null;
  }
}

// Dimension Tool - Create dimension annotations
export class DimensionTool extends Tool {
  constructor() {
    super('dimension', 'Dimension', '↔', 'Add dimension annotations', 'measurement');
    this.startPoint = null;
    this.dimensions = [];
  }

  onMouseDown(event, context) {
    const { raycaster, camera, scene, sceneManager } = context;
    const rect = event.target.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    let point;
    if (intersects.length > 0) {
      point = intersects[0].point.clone();
    } else {
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      point = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, point);
    }
    
    if (point) {
      if (!this.startPoint) {
        this.startPoint = point;
      } else {
        // Create dimension annotation
        const distance = this.startPoint.distanceTo(point);
        const dimension = {
          start: this.startPoint.clone(),
          end: point.clone(),
          distance: distance,
          label: `${distance.toFixed(2)}m`,
        };
        
        // Store as annotation object in scene
        const obj = sceneManager.createObject(
          `Dimension ${sceneManager.objectIdCounter}`,
          'dimension',
          {
            type: 'dimension',
            start: this.startPoint,
            end: point,
            distance: distance,
          }
        );
        
        this.dimensions.push(dimension);
        this.startPoint = null;
        sceneManager.saveState();
      }
      context.needsRender = true;
    }
  }

  onKeyDown(event, context) {
    if (event.key === 'Escape') {
      this.startPoint = null;
      context.needsRender = true;
    }
  }
}

// Area Calculator Tool
export class AreaCalculatorTool extends Tool {
  constructor() {
    super('area_calculator', 'Area', '▭', 'Calculate area', 'measurement');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length > 0) {
      let totalArea = 0;
      
      selected.forEach(obj => {
        const area = this.calculateArea(obj);
        totalArea += area;
      });
      
      console.log(`Total area: ${totalArea.toFixed(2)} m²`);
      // Could display in UI
    }
  }

  calculateArea(object) {
    const geom = object.geometry;
    
    switch (geom.type) {
      case 'box':
        const w = (geom.width || 1) * object.scale.x;
        const h = (geom.height || 1) * object.scale.y;
        const d = (geom.depth || 1) * object.scale.z;
        return 2 * (w * h + w * d + h * d);
      
      case 'sphere':
        const r = (geom.radius || 0.5) * Math.max(object.scale.x, object.scale.y, object.scale.z);
        return 4 * Math.PI * r * r;
      
      case 'plane':
        const width = (geom.width || 1) * object.scale.x;
        const height = (geom.height || 1) * object.scale.z;
        return width * height;
      
      case 'cylinder':
        const rad = (geom.radiusTop || 0.5) * Math.max(object.scale.x, object.scale.z);
        const height2 = (geom.height || 1) * object.scale.y;
        return 2 * Math.PI * rad * (rad + height2);
      
      default:
        return 0;
    }
  }
}

// Volume Calculator Tool
export class VolumeCalculatorTool extends Tool {
  constructor() {
    super('volume_calculator', 'Volume', '⬚', 'Calculate volume', 'measurement');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    const selected = sceneManager.getSelectedObjects();
    
    if (selected.length > 0) {
      let totalVolume = 0;
      
      selected.forEach(obj => {
        const volume = this.calculateVolume(obj);
        totalVolume += volume;
      });
      
      console.log(`Total volume: ${totalVolume.toFixed(3)} m³`);
    }
  }

  calculateVolume(object) {
    const geom = object.geometry;
    
    switch (geom.type) {
      case 'box':
        const w = (geom.width || 1) * object.scale.x;
        const h = (geom.height || 1) * object.scale.y;
        const d = (geom.depth || 1) * object.scale.z;
        return w * h * d;
      
      case 'sphere':
        const r = (geom.radius || 0.5) * Math.max(object.scale.x, object.scale.y, object.scale.z);
        return (4 / 3) * Math.PI * r * r * r;
      
      case 'cylinder':
        const rad = (geom.radiusTop || 0.5) * Math.max(object.scale.x, object.scale.z);
        const height = (geom.height || 1) * object.scale.y;
        return Math.PI * rad * rad * height;
      
      case 'cone':
        const rad2 = (geom.radius || 0.5) * Math.max(object.scale.x, object.scale.z);
        const height2 = (geom.height || 1) * object.scale.y;
        return (1 / 3) * Math.PI * rad2 * rad2 * height2;
      
      default:
        return 0;
    }
  }
}

export default {
  TapeMeasureTool,
  ProtractorTool,
  DimensionTool,
  AreaCalculatorTool,
  VolumeCalculatorTool,
};
