/**
 * Placement Engine - Handles realistic and detailed object placement in 3D scenes
 * Ensures proper spatial relationships, contextual positioning, and environmental coherence
 */

class PlacementEngine {
  constructor() {
    // Seeded random for consistent placement
    this.seed = Date.now();
  }

  /**
   * Set random seed for deterministic placement
   */
  setSeed(seed) {
    this.seed = seed;
  }

  /**
   * Seeded random number generator
   */
  seededRandom(min = 0, max = 1) {
    const x = Math.sin(this.seed++) * 10000;
    const rand = x - Math.floor(x);
    return min + rand * (max - min);
  }

  /**
   * Calculate realistic positions for elements based on taxonomy analysis
   * @param {Array} elements - Array of elements from taxonomy analysis
   * @param {Object} spatialComposition - Spatial composition data
   * @param {Object} environmentalContext - Environmental context data
   * @returns {Array} Elements with calculated positions
   */
  calculatePositions(elements, spatialComposition, environmentalContext) {
    console.log('📐 Calculating realistic positions for', elements.length, 'elements');
    
    const layout = spatialComposition?.layout || 'organic';
    const centerPoint = spatialComposition?.centerPoint || 'center';
    
    // Reset seed for consistent placement
    this.setSeed(Date.now());
    
    // Separate elements by placement priority
    const primaryElements = elements.filter(el => el.placement?.priority === 'primary');
    const secondaryElements = elements.filter(el => el.placement?.priority === 'secondary');
    const tertiaryElements = elements.filter(el => el.placement?.priority === 'tertiary');
    
    const positionedElements = [];
    
    // Place primary elements first (buildings, major features)
    positionedElements.push(...this.placePrimaryElements(primaryElements, layout, environmentalContext));
    
    // Place secondary elements (roads, smaller buildings)
    positionedElements.push(...this.placeSecondaryElements(secondaryElements, positionedElements, layout));
    
    // Place tertiary elements (vegetation, decorations)
    positionedElements.push(...this.placeTertiaryElements(tertiaryElements, positionedElements, layout));
    
    console.log('✅ Positioned', positionedElements.length, 'elements');
    return positionedElements;
  }

  /**
   * Place primary elements (buildings, major structures)
   */
  placePrimaryElements(elements, layout, environmentalContext) {
    const positioned = [];
    
    for (const element of elements) {
      const count = element.quantity || 1;
      const spacing = element.placement?.spacing || 50;
      const clustering = element.placement?.clustering || 'moderate';
      
      for (let i = 0; i < count; i++) {
        const position = this.calculateElementPosition(
          element,
          i,
          count,
          layout,
          clustering,
          spacing,
          positioned
        );
        
        positioned.push({
          ...element,
          instanceIndex: i,
          position,
          rotation: this.calculateRotation(element, layout)
        });
      }
    }
    
    return positioned;
  }

  /**
   * Place secondary elements (roads, infrastructure)
   */
  placeSecondaryElements(elements, existingElements, layout) {
    const positioned = [];
    
    for (const element of elements) {
      const count = element.quantity || 1;
      
      // If it's a road or path, connect buildings
      if (element.category === 'infrastructure' && element.subcategory?.includes('road')) {
        positioned.push(...this.placeRoads(element, existingElements));
      } 
      // If it's water, place at appropriate location
      else if (element.category === 'water_bodies') {
        positioned.push(...this.placeWater(element, existingElements));
      }
      // Otherwise, place normally
      else {
        for (let i = 0; i < count; i++) {
          const position = this.calculateElementPosition(
            element,
            i,
            count,
            layout,
            element.placement?.clustering || 'moderate',
            element.placement?.spacing || 30,
            [...existingElements, ...positioned]
          );
          
          positioned.push({
            ...element,
            instanceIndex: i,
            position,
            rotation: this.calculateRotation(element, layout)
          });
        }
      }
    }
    
    return positioned;
  }

  /**
   * Place tertiary elements (vegetation, decorations)
   */
  placeTertiaryElements(elements, existingElements, layout) {
    const positioned = [];
    
    for (const element of elements) {
      const count = element.quantity || 1;
      const spacing = element.placement?.spacing || 5;
      
      for (let i = 0; i < count; i++) {
        const position = this.findOpenSpace(
          element,
          spacing,
          existingElements.concat(positioned)
        );
        
        if (position) {
          positioned.push({
            ...element,
            instanceIndex: i,
            position,
            rotation: this.calculateRotation(element, layout)
          });
        }
      }
    }
    
    return positioned;
  }

  /**
   * Calculate position for an individual element
   */
  calculateElementPosition(element, index, total, layout, clustering, spacing, existingElements) {
    switch (layout) {
      case 'grid':
        return this.calculateGridPosition(index, total, spacing);
      case 'linear':
        return this.calculateLinearPosition(index, total, spacing);
      case 'organic':
        return this.calculateOrganicPosition(index, clustering, spacing, existingElements);
      case 'clustered':
        return this.calculateClusteredPosition(index, total, spacing);
      case 'radial':
        return this.calculateRadialPosition(index, total, spacing);
      case 'scattered':
        return this.calculateScatteredPosition(spacing, existingElements);
      default:
        return this.calculateOrganicPosition(index, clustering, spacing, existingElements);
    }
  }

  /**
   * Grid layout positioning
   */
  calculateGridPosition(index, total, spacing) {
    const gridSize = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    
    // Add slight random offset for more natural look
    const offsetX = this.seededRandom(-spacing * 0.1, spacing * 0.1);
    const offsetZ = this.seededRandom(-spacing * 0.1, spacing * 0.1);
    
    return {
      x: (col - gridSize / 2) * spacing + offsetX,
      y: 0,
      z: (row - gridSize / 2) * spacing + offsetZ
    };
  }

  /**
   * Linear layout positioning (for coastal, riverside)
   */
  calculateLinearPosition(index, total, spacing) {
    const offsetX = this.seededRandom(-spacing * 0.2, spacing * 0.2);
    
    return {
      x: (index - total / 2) * spacing + offsetX,
      y: 0,
      z: this.seededRandom(-spacing * 0.3, spacing * 0.3)
    };
  }

  /**
   * Organic layout positioning (for villages, natural scenes)
   */
  calculateOrganicPosition(index, clustering, spacing, existingElements) {
    const maxAttempts = 50;
    const spread = clustering === 'dense' ? 50 : clustering === 'moderate' ? 100 : 200;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const position = {
        x: this.seededRandom(-spread, spread),
        y: 0,
        z: this.seededRandom(-spread, spread)
      };
      
      // Check if position is valid (not too close to existing elements)
      if (this.isPositionValid(position, spacing, existingElements)) {
        return position;
      }
    }
    
    // Fallback if no valid position found
    return {
      x: this.seededRandom(-spread, spread),
      y: 0,
      z: this.seededRandom(-spread, spread)
    };
  }

  /**
   * Clustered layout positioning
   */
  calculateClusteredPosition(index, total, spacing) {
    const clusterCount = Math.ceil(total / 5); // Group in clusters of ~5
    const cluster = Math.floor(index / 5);
    const clusterIndex = index % 5;
    
    const clusterX = (cluster % 3 - 1) * spacing * 3;
    const clusterZ = (Math.floor(cluster / 3) - 1) * spacing * 3;
    
    return {
      x: clusterX + this.seededRandom(-spacing * 0.5, spacing * 0.5),
      y: 0,
      z: clusterZ + this.seededRandom(-spacing * 0.5, spacing * 0.5)
    };
  }

  /**
   * Radial layout positioning (around a center point)
   */
  calculateRadialPosition(index, total, spacing) {
    const angle = (index / total) * Math.PI * 2;
    const radius = spacing * (1 + Math.floor(index / 8));
    
    return {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius
    };
  }

  /**
   * Scattered layout positioning
   */
  calculateScatteredPosition(spacing, existingElements) {
    const maxSpread = 200;
    
    for (let attempt = 0; attempt < 50; attempt++) {
      const position = {
        x: this.seededRandom(-maxSpread, maxSpread),
        y: 0,
        z: this.seededRandom(-maxSpread, maxSpread)
      };
      
      if (this.isPositionValid(position, spacing, existingElements)) {
        return position;
      }
    }
    
    return {
      x: this.seededRandom(-maxSpread, maxSpread),
      y: 0,
      z: this.seededRandom(-maxSpread, maxSpread)
    };
  }

  /**
   * Calculate rotation based on element type and layout
   */
  calculateRotation(element, layout) {
    // Roads and linear elements should align with layout
    if (element.category === 'infrastructure') {
      if (layout === 'linear') {
        return { x: 0, y: 0, z: 0 };
      }
    }
    
    // Buildings get slight random rotation for variety
    if (element.category === 'residential' || element.category === 'commercial' || element.category === 'institutional') {
      return {
        x: 0,
        y: this.seededRandom(0, Math.PI * 2),
        z: 0
      };
    }
    
    // Natural elements get full random rotation
    if (element.category === 'flora' || element.category === 'landforms') {
      return {
        x: 0,
        y: this.seededRandom(0, Math.PI * 2),
        z: 0
      };
    }
    
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Check if a position is valid (not too close to existing elements)
   */
  isPositionValid(position, minSpacing, existingElements) {
    for (const existing of existingElements) {
      if (!existing.position) continue;
      
      const dx = position.x - existing.position.x;
      const dz = position.z - existing.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minSpacing) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Find open space for placing an element
   */
  findOpenSpace(element, minSpacing, existingElements) {
    const maxAttempts = 100;
    const maxSpread = 200;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const position = {
        x: this.seededRandom(-maxSpread, maxSpread),
        y: 0,
        z: this.seededRandom(-maxSpread, maxSpread)
      };
      
      if (this.isPositionValid(position, minSpacing, existingElements)) {
        return position;
      }
    }
    
    return null;
  }

  /**
   * Place roads to connect buildings
   */
  placeRoads(roadElement, buildings) {
    const roads = [];
    const buildingPositions = buildings
      .filter(el => el.category === 'residential' || el.category === 'commercial' || el.category === 'institutional')
      .map(el => el.position)
      .filter(pos => pos);
    
    if (buildingPositions.length < 2) {
      // Not enough buildings to connect, place roads in grid
      const count = roadElement.quantity || 5;
      for (let i = 0; i < count; i++) {
        roads.push({
          ...roadElement,
          instanceIndex: i,
          position: {
            x: (i - count / 2) * 40,
            y: 0,
            z: 0
          },
          rotation: { x: 0, y: i % 2 === 0 ? 0 : Math.PI / 2, z: 0 }
        });
      }
      return roads;
    }
    
    // Create roads between buildings
    const count = Math.min(roadElement.quantity || 10, buildingPositions.length);
    for (let i = 0; i < count; i++) {
      const start = buildingPositions[i % buildingPositions.length];
      const end = buildingPositions[(i + 1) % buildingPositions.length];
      
      const midpoint = {
        x: (start.x + end.x) / 2,
        y: 0,
        z: (start.z + end.z) / 2
      };
      
      const angle = Math.atan2(end.z - start.z, end.x - start.x);
      
      roads.push({
        ...roadElement,
        instanceIndex: i,
        position: midpoint,
        rotation: { x: 0, y: angle, z: 0 }
      });
    }
    
    return roads;
  }

  /**
   * Place water features appropriately
   */
  placeWater(waterElement, existingElements) {
    const waterFeatures = [];
    
    // Water should be at edge or center depending on type
    const isOcean = waterElement.subcategory === 'ocean' || waterElement.subcategory === 'sea';
    const isRiver = waterElement.subcategory === 'river' || waterElement.subcategory === 'stream';
    
    if (isOcean) {
      // Ocean at the edge
      waterFeatures.push({
        ...waterElement,
        instanceIndex: 0,
        position: { x: 0, y: 0, z: 150 }, // South edge
        rotation: { x: 0, y: 0, z: 0 }
      });
    } else if (isRiver) {
      // River flows through scene
      waterFeatures.push({
        ...waterElement,
        instanceIndex: 0,
        position: { x: -50, y: 0, z: 0 },
        rotation: { x: 0, y: Math.PI / 4, z: 0 }
      });
    } else {
      // Lake or pond in open area
      const position = this.findOpenSpace(waterElement, 50, existingElements);
      if (position) {
        waterFeatures.push({
          ...waterElement,
          instanceIndex: 0,
          position,
          rotation: { x: 0, y: 0, z: 0 }
        });
      }
    }
    
    return waterFeatures;
  }
}

module.exports = new PlacementEngine();
