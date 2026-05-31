/**
 * Layout Manager - Calculates spatial positioning for multiple designs
 * Ensures designs don't overlap and are positioned adjacent to each other
 */

/**
 * Calculate the next position for a new design based on existing designs
 * @param {Array} existingDesigns - Array of design groups with bounds
 * @param {Object} newDesignBounds - Bounds of the new design {min, max, size}
 * @param {number} spacing - Spacing between designs in meters (default: 5)
 * @returns {Object} Position {x, y, z} for the new design
 */
export function calculateNextPosition(existingDesigns, newDesignBounds, spacing = 5) {
  // If no existing designs, place at origin
  if (!existingDesigns || existingDesigns.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  // Use grid-based layout for multiple designs
  // Place designs in a row along the X-axis
  const lastDesign = existingDesigns[existingDesigns.length - 1];
  
  if (!lastDesign || !lastDesign.bounds) {
    return { x: 0, y: 0, z: 0 };
  }

  // Calculate position to the right of the last design
  const newX = lastDesign.bounds.max.x + spacing + (newDesignBounds.size?.x || 0) / 2;
  
  return {
    x: newX,
    y: 0, // Keep all designs at ground level
    z: 0,
  };
}

/**
 * Parse position from prompt text
 * Supports phrases like "10m to the right", "next to tower", "20 meters east"
 * @param {string} prompt - User prompt text
 * @param {Array} existingDesigns - Array of existing design groups
 * @returns {Object|null} Position {x, y, z} or null if no position specified
 */
export function parsePositionFromPrompt(prompt, existingDesigns) {
  if (!prompt) return null;

  const lowerPrompt = prompt.toLowerCase();
  
  // Pattern: "X meters/m to the right/left/north/south/east/west"
  const distancePattern = /(\d+)\s*(meters?|m)\s+(?:to the\s+)?(right|left|north|south|east|west)/i;
  const match = lowerPrompt.match(distancePattern);
  
  if (match && existingDesigns.length > 0) {
    const distance = parseFloat(match[1]);
    const direction = match[3].toLowerCase();
    
    const lastDesign = existingDesigns[existingDesigns.length - 1];
    const basePos = lastDesign.position || { x: 0, y: 0, z: 0 };
    
    switch (direction) {
      case 'right':
      case 'east':
        return { x: basePos.x + distance, y: basePos.y, z: basePos.z };
      case 'left':
      case 'west':
        return { x: basePos.x - distance, y: basePos.y, z: basePos.z };
      case 'north':
        return { x: basePos.x, y: basePos.y, z: basePos.z - distance };
      case 'south':
        return { x: basePos.x, y: basePos.y, z: basePos.z + distance };
    }
  }
  
  return null;
}

/**
 * Calculate bounding box for a group of objects
 * @param {Array} objects - Array of scene objects
 * @returns {Object} Bounds {min, max, center, size}
 */
export function calculateBounds(objects) {
  if (!objects || objects.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 },
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  objects.forEach(obj => {
    if (!obj.position) return;
    
    const { x, y, z } = obj.position;
    const geom = obj.geometry || {};
    
    // Estimate object bounds based on geometry
    const halfWidth = (geom.width || 1) / 2;
    const halfHeight = (geom.height || 1) / 2;
    const halfDepth = (geom.depth || 1) / 2;
    
    minX = Math.min(minX, x - halfWidth);
    minY = Math.min(minY, y - halfHeight);
    minZ = Math.min(minZ, z - halfDepth);
    
    maxX = Math.max(maxX, x + halfWidth);
    maxY = Math.max(maxY, y + halfHeight);
    maxZ = Math.max(maxZ, z + halfDepth);
  });

  const min = { x: minX, y: minY, z: minZ };
  const max = { x: maxX, y: maxY, z: maxZ };
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
  const size = {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ,
  };

  return { min, max, center, size };
}

/**
 * Check if two bounding boxes overlap
 * @param {Object} bounds1 - First bounding box {min, max}
 * @param {Object} bounds2 - Second bounding box {min, max}
 * @returns {boolean} True if boxes overlap
 */
export function checkOverlap(bounds1, bounds2) {
  if (!bounds1 || !bounds2) return false;
  
  return !(
    bounds1.max.x < bounds2.min.x ||
    bounds1.min.x > bounds2.max.x ||
    bounds1.max.y < bounds2.min.y ||
    bounds1.min.y > bounds2.max.y ||
    bounds1.max.z < bounds2.min.z ||
    bounds1.min.z > bounds2.max.z
  );
}
