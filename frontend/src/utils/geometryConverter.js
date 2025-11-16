/**
 * Geometry Converter - Converts backend geometry format to SceneManager objects
 * 
 * Backend geometry format (from geometryGenerator.js):
 * {
 *   type: 'composite' | 'object' | 'scene',
 *   parts: [{ type, dimensions, position, material, detail }],
 *   mesh: { type, dimensions, ... },
 *   bounds: { min, max, center, size },
 *   metadata: { ... }
 * }
 * 
 * SceneManager object format:
 * {
 *   id: string,
 *   type: string,
 *   geometry: { type, width, height, depth, ... },
 *   position: { x, y, z },
 *   rotation: { x, y, z },
 *   scale: { x, y, z },
 *   material: { color, metalness, roughness },
 *   name: string,
 *   visible: true
 * }
 */

/**
 * Material mapping from backend material names to colors
 */
const MATERIAL_COLORS = {
  concrete: '#CCCCCC',
  metal: '#888888',
  glass: '#88CCFF',
  wood: '#8B4513',
  stone: '#696969',
  brick: '#B22222',
  plastic: '#FFFFFF',
  default: '#AAAAAA',
};

/**
 * Material properties mapping
 */
const MATERIAL_PROPERTIES = {
  concrete: { metalness: 0.1, roughness: 0.9 },
  metal: { metalness: 0.8, roughness: 0.2 },
  glass: { metalness: 0.9, roughness: 0.1 },
  wood: { metalness: 0.0, roughness: 0.8 },
  stone: { metalness: 0.1, roughness: 0.95 },
  brick: { metalness: 0.0, roughness: 0.9 },
  plastic: { metalness: 0.5, roughness: 0.5 },
  default: { metalness: 0.3, roughness: 0.7 },
};

/**
 * Convert backend model data to SceneManager objects
 */
export function convertModelDataToSceneObjects(modelData, namePrefix = 'AI_Generated') {
  if (!modelData) {
    console.warn('No model data provided to converter');
    return [];
  }
  
  const objects = [];
  
  // Handle composite type (multiple parts)
  if (modelData.type === 'composite' && modelData.parts) {
    console.log(`Converting composite model with ${modelData.parts.length} parts`);
    modelData.parts.forEach((part, index) => {
      const obj = convertPartToSceneObject(part, `${namePrefix}_part_${index}`);
      if (obj) objects.push(obj);
    });
  }
  // Handle single object type
  else if (modelData.type === 'object' && modelData.mesh) {
    console.log('Converting single object model');
    // Check if the mesh itself is a composite with parts
    if (modelData.mesh.type === 'composite' && modelData.mesh.parts) {
      console.log(`Mesh is composite with ${modelData.mesh.parts.length} parts`);
      modelData.mesh.parts.forEach((part, index) => {
        const obj = convertPartToSceneObject(part, `${namePrefix}_part_${index}`);
        if (obj) objects.push(obj);
      });
    } else {
      // Single mesh object
      const obj = convertPartToSceneObject(modelData.mesh, namePrefix);
      if (obj) objects.push(obj);
    }
  }
  // Handle scene type (complex scenes with meshes and instances)
  else if (modelData.type === 'scene') {
    console.log('Converting scene model');
    if (modelData.meshes) {
      modelData.meshes.forEach((mesh, index) => {
        const obj = convertPartToSceneObject(mesh, `${namePrefix}_mesh_${index}`);
        if (obj) objects.push(obj);
      });
    }
    if (modelData.instances) {
      modelData.instances.forEach((instance, index) => {
        // For instanced objects, create multiple copies
        const baseName = `${namePrefix}_instance_${index}`;
        if (instance.positions && Array.isArray(instance.positions)) {
          instance.positions.forEach((pos, posIndex) => {
            const obj = convertPartToSceneObject(
              { ...instance.mesh, position: pos },
              `${baseName}_${posIndex}`
            );
            if (obj) objects.push(obj);
          });
        }
      });
    }
  }
  // Fallback: try to convert as a single part
  else {
    console.log('Converting as generic part');
    const obj = convertPartToSceneObject(modelData, namePrefix);
    if (obj) objects.push(obj);
  }
  
  console.log(`Converted ${objects.length} objects from model data`);
  return objects;
}

/**
 * Convert a single backend part to a SceneManager object
 */
function convertPartToSceneObject(part, name) {
  if (!part || !part.type) {
    console.warn('Invalid part data:', part);
    return null;
  }
  
  // Generate unique ID
  const id = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Convert position (backend uses mm, convert to meters for Three.js)
  const position = normalizePosition(part.position || { x: 0, y: 0, z: 0 });
  
  // Convert rotation (if provided)
  const rotation = part.rotation || { x: 0, y: 0, z: 0 };
  
  // Convert scale (default to 1)
  const scale = part.scale || { x: 1, y: 1, z: 1 };
  
  // Convert geometry based on type
  const geometry = convertGeometry(part);
  
  // Convert material
  const material = convertMaterial(part.material || 'default');
  
  return {
    id,
    type: part.type,
    geometry,
    position,
    rotation,
    scale,
    material,
    name: part.name || name,
    visible: true,
    userData: {
      detail: part.detail,
      aiGenerated: true,
      originalData: part,
    },
  };
}

/**
 * Convert backend geometry to SceneManager geometry format
 */
function convertGeometry(part) {
  const type = part.type.toLowerCase();
  
  switch (type) {
    case 'box':
      return {
        type: 'box',
        width: mmToMeters(part.dimensions?.x || 1000),
        height: mmToMeters(part.dimensions?.y || 1000),
        depth: mmToMeters(part.dimensions?.z || 1000),
      };
      
    case 'cylinder':
      return {
        type: 'cylinder',
        radiusTop: mmToMeters(part.radius || part.radiusTop || 500),
        radiusBottom: mmToMeters(part.radiusBottom || part.radius || 500),
        height: mmToMeters(part.height || 1000),
        radialSegments: 32,
      };
      
    case 'sphere':
      return {
        type: 'sphere',
        radius: mmToMeters(part.radius || 500),
        widthSegments: 32,
        heightSegments: 16,
      };
      
    case 'cone':
      return {
        type: 'cone',
        radius: mmToMeters(part.radius || 500),
        height: mmToMeters(part.height || 1000),
        radialSegments: 32,
      };
      
    case 'plane':
      return {
        type: 'plane',
        width: mmToMeters(part.dimensions?.x || part.width || 1000),
        height: mmToMeters(part.dimensions?.y || part.height || 1000),
      };
      
    case 'torus':
      return {
        type: 'torus',
        radius: mmToMeters(part.radius || 500),
        tube: mmToMeters(part.tube || 100),
        radialSegments: 16,
        tubularSegments: 100,
      };
      
    default:
      // Default to box if type is unknown
      console.warn(`Unknown geometry type: ${type}, defaulting to box`);
      return {
        type: 'box',
        width: mmToMeters(part.dimensions?.x || 1000),
        height: mmToMeters(part.dimensions?.y || 1000),
        depth: mmToMeters(part.dimensions?.z || 1000),
      };
  }
}

/**
 * Convert backend material name to SceneManager material
 */
function convertMaterial(materialName) {
  const name = materialName?.toLowerCase() || 'default';
  const color = MATERIAL_COLORS[name] || MATERIAL_COLORS.default;
  const properties = MATERIAL_PROPERTIES[name] || MATERIAL_PROPERTIES.default;
  
  return {
    color,
    metalness: properties.metalness,
    roughness: properties.roughness,
  };
}

/**
 * Normalize position from backend format (mm) to Three.js (meters)
 */
function normalizePosition(pos) {
  return {
    x: mmToMeters(pos.x || 0),
    y: mmToMeters(pos.y || 0),
    z: mmToMeters(pos.z || 0),
  };
}

/**
 * Convert millimeters to meters (with scaling for better visibility)
 */
function mmToMeters(mm) {
  // Backend uses mm, but we need reasonable sizes in Three.js
  // Divide by 1000 to get meters, then scale down for better viewport fit
  return (mm / 1000) * 0.1; // Scale down by additional factor for better fit
}

/**
 * Get bounding box for a set of scene objects
 */
export function getObjectsBoundingBox(objects) {
  if (!objects || objects.length === 0) {
    return {
      min: { x: -1, y: -1, z: -1 },
      max: { x: 1, y: 1, z: 1 },
      center: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    };
  }
  
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  objects.forEach(obj => {
    const pos = obj.position;
    const geom = obj.geometry;
    
    // Approximate bounds based on geometry
    const halfWidth = (geom.width || geom.radius || 1) / 2;
    const halfHeight = (geom.height || geom.radius || 1) / 2;
    const halfDepth = (geom.depth || geom.radius || 1) / 2;
    
    minX = Math.min(minX, pos.x - halfWidth);
    maxX = Math.max(maxX, pos.x + halfWidth);
    minY = Math.min(minY, pos.y - halfHeight);
    maxY = Math.max(maxY, pos.y + halfHeight);
    minZ = Math.min(minZ, pos.z - halfDepth);
    maxZ = Math.max(maxZ, pos.z + halfDepth);
  });
  
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    size: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
  };
}
