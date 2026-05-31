/**
 * Primitive Tools - Add 3D primitive objects to the scene
 */

import { Tool } from '../systems/ToolSystem';

// Base class for adding primitives
class AddPrimitiveTool extends Tool {
  constructor(id, name, icon, description, primitiveType, shortcut = null) {
    super(id, name, icon, description, 'add', shortcut);
    this.primitiveType = primitiveType;
  }

  onActivate(context) {
    super.onActivate(context);
    this.addPrimitive(context);
    // Deactivate after adding
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }

  addPrimitive(context) {
    const { sceneManager } = context;
    const geometry = this.createGeometry();
    const obj = sceneManager.createObject(
      `${this.name} ${sceneManager.objectIdCounter}`,
      this.primitiveType,
      geometry
    );
    
    // Select the new object
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
  }

  createGeometry() {
    // Override in subclasses
    return {};
  }
}

// Mesh Primitives
export class AddCubeTool extends AddPrimitiveTool {
  constructor() {
    super('add_cube', 'Cube', '⬛', 'Add a cube mesh');
  }

  createGeometry() {
    return {
      type: 'box',
      width: 1,
      height: 1,
      depth: 1,
    };
  }
}

export class AddSphereTool extends AddPrimitiveTool {
  constructor() {
    super('add_sphere', 'UV Sphere', '⚫', 'Add a UV sphere mesh');
  }

  createGeometry() {
    return {
      type: 'sphere',
      radius: 0.5,
      widthSegments: 32,
      heightSegments: 16,
    };
  }
}

export class AddCylinderTool extends AddPrimitiveTool {
  constructor() {
    super('add_cylinder', 'Cylinder', '⬭', 'Add a cylinder mesh');
  }

  createGeometry() {
    return {
      type: 'cylinder',
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1,
      radialSegments: 32,
    };
  }
}

export class AddConeTool extends AddPrimitiveTool {
  constructor() {
    super('add_cone', 'Cone', '🔺', 'Add a cone mesh');
  }

  createGeometry() {
    return {
      type: 'cone',
      radius: 0.5,
      height: 1,
      radialSegments: 32,
    };
  }
}

export class AddPlaneTool extends AddPrimitiveTool {
  constructor() {
    super('add_plane', 'Plane', '▭', 'Add a plane mesh');
  }

  createGeometry() {
    return {
      type: 'plane',
      width: 1,
      height: 1,
    };
  }
}

export class AddTorusTool extends AddPrimitiveTool {
  constructor() {
    super('add_torus', 'Torus', '⭕', 'Add a torus mesh');
  }

  createGeometry() {
    return {
      type: 'torus',
      radius: 0.5,
      tube: 0.2,
      radialSegments: 16,
      tubularSegments: 100,
    };
  }
}

export class AddIcoSphereTool extends AddPrimitiveTool {
  constructor() {
    super('add_icosphere', 'Ico Sphere', '⬢', 'Add an icosahedron sphere');
  }

  createGeometry() {
    return {
      type: 'icosphere',
      radius: 0.5,
      detail: 2,
    };
  }
}

export class AddCircleTool extends AddPrimitiveTool {
  constructor() {
    super('add_circle', 'Circle', '○', 'Add a circle mesh');
  }

  createGeometry() {
    return {
      type: 'circle',
      radius: 0.5,
      segments: 32,
    };
  }
}

export class AddGridTool extends AddPrimitiveTool {
  constructor() {
    super('add_grid', 'Grid', '⊞', 'Add a grid mesh');
  }

  createGeometry() {
    return {
      type: 'grid',
      width: 2,
      height: 2,
      widthSegments: 10,
      heightSegments: 10,
    };
  }
}

// Light Objects
export class AddPointLightTool extends Tool {
  constructor() {
    super('add_point_light', 'Point Light', '💡', 'Add a point light', 'light');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    
    const obj = sceneManager.createObject(
      `Point Light ${sceneManager.objectIdCounter}`,
      'point_light',
      {
        type: 'point_light',
        color: '#ffffff',
        intensity: 1.0,
        distance: 0,
        decay: 2,
      }
    );
    
    obj.position.y = 2;
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
    
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

export class AddDirectionalLightTool extends Tool {
  constructor() {
    super('add_directional_light', 'Directional Light', '☀️', 'Add a directional light', 'light');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    
    const obj = sceneManager.createObject(
      `Directional Light ${sceneManager.objectIdCounter}`,
      'directional_light',
      {
        type: 'directional_light',
        color: '#ffffff',
        intensity: 1.0,
      }
    );
    
    obj.position.set(5, 5, 5);
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
    
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

export class AddSpotLightTool extends Tool {
  constructor() {
    super('add_spot_light', 'Spot Light', '🔦', 'Add a spot light', 'light');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    
    const obj = sceneManager.createObject(
      `Spot Light ${sceneManager.objectIdCounter}`,
      'spot_light',
      {
        type: 'spot_light',
        color: '#ffffff',
        intensity: 1.0,
        angle: Math.PI / 6,
        penumbra: 0.1,
        decay: 2,
      }
    );
    
    obj.position.set(0, 3, 0);
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
    
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

export class AddAreaLightTool extends Tool {
  constructor() {
    super('add_area_light', 'Area Light', '▭', 'Add an area light', 'light');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    
    const obj = sceneManager.createObject(
      `Area Light ${sceneManager.objectIdCounter}`,
      'area_light',
      {
        type: 'area_light',
        color: '#ffffff',
        intensity: 1.0,
        width: 1,
        height: 1,
      }
    );
    
    obj.position.y = 2;
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
    
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

// Camera
export class AddCameraTool extends Tool {
  constructor() {
    super('add_camera', 'Camera', '📷', 'Add a camera', 'camera');
  }

  onActivate(context) {
    super.onActivate(context);
    const { sceneManager } = context;
    
    const obj = sceneManager.createObject(
      `Camera ${sceneManager.objectIdCounter}`,
      'camera',
      {
        type: 'perspective_camera',
        fov: 50,
        near: 0.1,
        far: 1000,
      }
    );
    
    obj.position.set(5, 5, 5);
    sceneManager.deselectAll();
    sceneManager.selectObject(obj.id);
    context.needsRender = true;
    
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }
}

export default {
  AddCubeTool,
  AddSphereTool,
  AddCylinderTool,
  AddConeTool,
  AddPlaneTool,
  AddTorusTool,
  AddIcoSphereTool,
  AddCircleTool,
  AddGridTool,
  AddPointLightTool,
  AddDirectionalLightTool,
  AddSpotLightTool,
  AddAreaLightTool,
  AddCameraTool,
};
