/**
 * Geometry Generator - Procedural 3D geometry generation
 * Handles generation of architectural elements, props, details, and environments
 */
const placementEngine = require('./placementEngine');

class GeometryGenerator {
  /**
   * Generate geometry based on specifications
   */
  generateFromSpec(spec) {
    const { objectCount = 1, elements = [], scene = {}, taxonomyData = null } = spec;
    
    // Use taxonomy-aware generation if available
    if (taxonomyData && taxonomyData.spatialComposition) {
      return this.generateTaxonomyScene(elements, taxonomyData);
    }
    
    // Determine if this is a complex scene or single object
    if (objectCount > 1 || elements.length > 1) {
      return this.generateComplexScene(elements, scene);
    } else {
      const element = elements[0] || { type: 'object', name: 'Object' };
      return this.generateSingleObject(element);
    }
  }
  
  /**
   * Generate scene using taxonomy data with realistic placement
   */
  generateTaxonomyScene(elements, taxonomyData) {
    const { spatialComposition, environmentalContext, realism } = taxonomyData;
    
    console.log('🎨 Generating taxonomy-aware scene with realistic placement');
    
    // Calculate realistic positions using placement engine
    const positionedElements = placementEngine.calculatePositions(
      elements,
      spatialComposition,
      environmentalContext
    );
    
    const meshes = [];
    const instances = [];
    
    // Generate geometry for each positioned element
    positionedElements.forEach((element, index) => {
      try {
        const geometry = this.generateTaxonomyElement(element, realism);
        
        meshes.push({
          ...geometry,
          position: element.position,
          rotation: element.rotation,
          name: `${element.name || 'Object'}_${element.instanceIndex}`,
          taxonomyData: {
            category: element.category,
            subcategory: element.subcategory,
            placement: element.placement
          }
        });
      } catch (error) {
        console.error(`Error generating element ${element.name}:`, error);
      }
    });
    
    return {
      type: 'taxonomy_scene',
      meshes,
      instances,
      bounds: this.calculateSceneBounds(meshes, instances),
      metadata: {
        taxonomyData,
        elementCount: positionedElements.length
      }
    };
  }
  
  /**
   * Generate element based on taxonomy category
   */
  generateTaxonomyElement(element, realism) {
    const { category, subcategory, dimensions, materials, features } = element;
    const detailLevel = realism?.detailLevel || 'high';
    
    // Convert dimensions from meters to millimeters
    const dims = {
      width: (dimensions?.width || 10) * 1000,
      height: (dimensions?.height || 10) * 1000,
      depth: (dimensions?.depth || 10) * 1000
    };
    
    // Map taxonomy categories to generation methods
    switch (category) {
      case 'residential':
      case 'commercial':
      case 'institutional':
      case 'industrial':
        return this.generateBuilding({
          ...element,
          type: 'building',
          dimensions: dims,
          details: features || [],
          materials: materials || ['concrete']
        });
        
      case 'infrastructure':
        if (subcategory && subcategory.includes('road')) {
          return this.generateRoad(element, dims);
        } else if (subcategory === 'bridge') {
          return this.generateStructure({ ...element, dimensions: dims });
        }
        return this.generateGenericObject({ ...element, dimensions: dims });
        
      case 'flora':
        return this.generateVegetation(element, dims);
        
      case 'landforms':
        return this.generateTerrain({ ...element, dimensions: dims });
        
      case 'water_bodies':
        return this.generateWater(element, dims);
        
      case 'land_vehicles':
      case 'water_vehicles':
      case 'air_vehicles':
        return this.generateVehicle({ ...element, dimensions: dims });
        
      default:
        return this.generateGenericObject({ ...element, dimensions: dims });
    }
  }
  
  /**
   * Generate road/path geometry
   */
  generateRoad(element, dimensions) {
    const { width, depth } = dimensions;
    const length = width; // Road length
    const roadWidth = element.subcategory === 'highway' ? 20000 : 
                     element.subcategory === 'street' ? 10000 : 6000;
    
    return {
      type: 'box',
      componentType: 'road',
      dimensions: { x: length, y: 200, z: roadWidth },
      position: { x: 0, y: -100, z: 0 },
      material: 'asphalt',
      detail: 'road_surface',
      metadata: {
        editable: true,
        roadType: element.subcategory
      }
    };
  }
  
  /**
   * Generate vegetation (trees, shrubs)
   */
  generateVegetation(element, dimensions) {
    const { height } = dimensions;
    const trunkHeight = height * 0.6;
    const crownSize = height * 0.5;
    
    return {
      type: 'composite',
      parts: [
        {
          type: 'cylinder',
          dimensions: { radius: 300, height: trunkHeight },
          position: { x: 0, y: trunkHeight / 2, z: 0 },
          material: 'wood',
          detail: 'trunk'
        },
        {
          type: 'sphere',
          dimensions: { radius: crownSize },
          position: { x: 0, y: trunkHeight + crownSize / 2, z: 0 },
          material: 'foliage',
          detail: 'crown'
        }
      ],
      metadata: {
        vegetationType: element.subcategory
      }
    };
  }
  
  /**
   * Generate water body geometry
   */
  generateWater(element, dimensions) {
    const { width, depth } = dimensions;
    
    return {
      type: 'plane',
      componentType: 'water',
      dimensions: { x: width * 1000, z: depth * 1000 },
      position: { x: 0, y: 0, z: 0 },
      material: 'water',
      detail: 'water_surface',
      metadata: {
        waterType: element.subcategory,
        animated: true
      }
    };
  }

  /**
   * Generate complex scene with multiple objects
   */
  generateComplexScene(elements, sceneConfig) {
    const meshes = [];
    const instances = [];
    
    elements.forEach((element, index) => {
      const quantity = element.quantity || 1;
      
      if (quantity > 1) {
        // Use instancing for repeated elements
        const baseMesh = this.generateElement(element);
        const positions = this.calculateInstancePositions(quantity, element, index);
        instances.push({
          mesh: baseMesh,
          positions,
          count: quantity,
        });
      } else {
        // Generate individual mesh
        const mesh = this.generateElement(element);
        const position = this.calculatePosition(index, elements.length);
        meshes.push({
          ...mesh,
          position,
          name: element.name || `Object_${index}`,
        });
      }
    });
    
    return {
      type: 'scene',
      meshes,
      instances,
      bounds: this.calculateSceneBounds(meshes, instances),
      metadata: sceneConfig,
    };
  }

  /**
   * Generate single object with high detail
   */
  generateSingleObject(element) {
    const geometry = this.generateElement(element);
    
    return {
      type: 'object',
      mesh: geometry,
      name: element.name || 'Object',
      metadata: element,
    };
  }

  /**
   * Generate geometry for a specific element type
   */
  generateElement(element) {
    const type = element.type?.toLowerCase() || 'object';
    
    switch (type) {
      case 'building':
        return this.generateBuilding(element);
      case 'structure':
        return this.generateStructure(element);
      case 'vehicle':
      case 'car':
        return this.generateVehicle(element);
      case 'furniture':
        return this.generateFurniture(element);
      case 'prop':
        return this.generateProp(element);
      case 'terrain':
        return this.generateTerrain(element);
      default:
        return this.generateGenericObject(element);
    }
  }

  /**
   * Generate building geometry with enhanced architectural details and hierarchy (Issue #28)
   */
  generateBuilding(element) {
    const { dimensions = {}, details = [], floors = 10, name = '' } = element;
    const width = dimensions.width || 20000;
    const height = dimensions.height || 30000;
    const depth = dimensions.depth || 15000;
    
    // Check if this is a special landmark that needs custom geometry
    if (details && details.buildingType === 'landmark') {
      return this.generateLandmarkStructure(element, name, dimensions, details);
    }
    
    const parts = [];
    let componentId = 0;
    
    // Generate unique ID for component
    const genId = (type) => `${type}_${componentId++}`;
    
    // Main structure (parent component)
    const mainStructureId = genId('structure');
    parts.push({
      id: mainStructureId,
      name: 'Main Structure',
      type: 'box',
      componentType: 'building_structure',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'concrete',
      detail: 'main_structure',
      parent: null,
      children: [],
      metadata: {
        editable: true,
        locked: false,
        aiGenerated: true,
        level: 0,
        properties: {
          structural: true,
          loadBearing: true,
        }
      }
    });
    
    // Calculate number of floors if not provided
    const floorCount = floors || Math.floor(height / 3000);
    const floorHeight = height / floorCount;
    
    // Add floors (horizontal slabs) with hierarchy
    for (let i = 1; i < floorCount; i++) {
      const floorId = genId('floor');
      parts.push({
        id: floorId,
        name: `Floor ${i}`,
        type: 'box',
        componentType: 'floor_slab',
        dimensions: { x: width, y: 200, z: depth },
        position: { x: 0, y: i * floorHeight, z: 0 },
        material: 'concrete',
        detail: 'floor_slab',
        parent: mainStructureId,
        children: [],
        metadata: {
          editable: true,
          locked: false,
          aiGenerated: true,
          level: 1,
          floorNumber: i,
          properties: {
            structural: true,
            thickness: 200,
          }
        }
      });
      
      // Add floor to main structure's children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(floorId);
      }
    }
    
    // Enhanced detail generation based on specified features
    const hasWindows = details.includes('windows') || details.includes('glass_facade') || 
                      details.includes('curtain_walls') || details.length === 0;
    const hasBalconies = details.includes('balconies') || details.includes('terraces');
    const hasEntrance = details.includes('entrances') || details.includes('lobby');
    const hasRoofGarden = details.includes('roof_garden') || details.includes('rooftop_terrace');
    const hasColumns = details.includes('columns') || details.includes('structural_elements');
    const hasCurtainWalls = details.includes('curtain_walls') || details.includes('glass_facade');
    const hasUndergroundParking = details.includes('underground_parking') || details.includes('basement_levels');
    
    // Add curtain wall facade or traditional windows with hierarchy
    if (hasCurtainWalls) {
      const curtainWallParts = this.generateCurtainWallFacade(width, height, depth, floorCount, mainStructureId, componentId);
      componentId += curtainWallParts.length;
      parts.push(...curtainWallParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...curtainWallParts.map(p => p.id));
      }
    } else if (hasWindows) {
      const windowParts = this.generateWindowGrid(width, height, depth, floorCount, mainStructureId, componentId);
      componentId += windowParts.length;
      parts.push(...windowParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...windowParts.map(p => p.id));
      }
    }
    
    // Add window frames and mullions for detail
    if (hasWindows || hasCurtainWalls) {
      const frameParts = this.generateWindowFrames(width, height, depth, floorCount, mainStructureId, componentId);
      componentId += frameParts.length;
      parts.push(...frameParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...frameParts.map(p => p.id));
      }
    }
    
    // Add balconies
    if (hasBalconies) {
      const balconyParts = this.generateBalconies(width, height, depth, floorCount, mainStructureId, componentId);
      componentId += balconyParts.length;
      parts.push(...balconyParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...balconyParts.map(p => p.id));
      }
    }
    
    // Add entrance features
    if (hasEntrance) {
      const entranceParts = this.generateEntranceFeatures(width, depth, mainStructureId, componentId);
      componentId += entranceParts.length;
      parts.push(...entranceParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...entranceParts.map(p => p.id));
      }
    }
    
    // Add rooftop features
    if (hasRoofGarden) {
      const rooftopParts = this.generateRooftopFeatures(width, height, depth, mainStructureId, componentId);
      componentId += rooftopParts.length;
      parts.push(...rooftopParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...rooftopParts.map(p => p.id));
      }
    }
    
    // Add structural columns (visible in glass buildings)
    if (hasColumns || hasCurtainWalls) {
      const columnParts = this.generateStructuralColumns(width, height, depth, mainStructureId, componentId);
      componentId += columnParts.length;
      parts.push(...columnParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...columnParts.map(p => p.id));
      }
    }
    
    // Add underground parking indicator
    if (hasUndergroundParking) {
      const parkingParts = this.generateUndergroundLevel(width, depth, mainStructureId, componentId);
      componentId += parkingParts.length;
      parts.push(...parkingParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...parkingParts.map(p => p.id));
      }
    }
    
    // Add railings if specified
    if (details.includes('railings')) {
      const railingParts = this.generateRailings(width, height, depth, mainStructureId, componentId);
      componentId += railingParts.length;
      parts.push(...railingParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...railingParts.map(p => p.id));
      }
    }
    
    // Add pipes/mechanical if specified
    if (details.includes('pipes') || details.includes('mechanical_room')) {
      const pipeParts = this.generatePipes(width, height, depth, mainStructureId, componentId);
      componentId += pipeParts.length;
      parts.push(...pipeParts);
      
      // Add to main structure children
      const mainStructure = parts.find(p => p.id === mainStructureId);
      if (mainStructure) {
        mainStructure.children.push(...pipeParts.map(p => p.id));
      }
    }
    
    return {
      type: 'composite',
      parts,
      subdivisions: 1,
      beveling: 0.05,
      hierarchical: true, // Mark as hierarchical structure
      componentCount: componentId,
    };
  }

  /**
   * Generate structure (platform, framework, etc.)
   */
  generateStructure(element) {
    const { dimensions = {}, details = [] } = element;
    const width = dimensions.width || 10000;
    const height = dimensions.height || 5000;
    const depth = dimensions.depth || 10000;
    
    const parts = [];
    
    // Main platform
    parts.push({
      type: 'box',
      dimensions: { x: width, y: 500, z: depth },
      position: { x: 0, y: 0, z: 0 },
      material: 'metal',
      detail: 'platform',
    });
    
    // Support columns
    const columns = 4;
    for (let i = 0; i < columns; i++) {
      for (let j = 0; j < columns; j++) {
        const x = (i - columns / 2 + 0.5) * (width / columns);
        const z = (j - columns / 2 + 0.5) * (depth / columns);
        parts.push({
          type: 'cylinder',
          radius: 200,
          height: height,
          position: { x, y: -height / 2, z },
          material: 'metal',
          detail: 'column',
        });
      }
    }
    
    // Add beams
    parts.push(...this.generateBeams(width, height, depth));
    
    return {
      type: 'composite',
      parts,
      subdivisions: 0,
      beveling: 0.02,
    };
  }

  /**
   * Generate vehicle geometry
   */
  generateVehicle(element) {
    const { dimensions = {} } = element;
    const length = dimensions.width || dimensions.length || 4500;
    const width = dimensions.depth || dimensions.width || 1850;
    const height = dimensions.height || 1450;
    
    const parts = [];
    
    // Main body
    parts.push({
      type: 'box',
      dimensions: { x: length * 0.8, y: height * 0.5, z: width },
      position: { x: 0, y: height * 0.25, z: 0 },
      material: 'metal',
      detail: 'body',
      subdivisions: 2,
    });
    
    // Cabin/roof
    parts.push({
      type: 'box',
      dimensions: { x: length * 0.4, y: height * 0.3, z: width * 0.9 },
      position: { x: length * 0.1, y: height * 0.65, z: 0 },
      material: 'glass',
      detail: 'cabin',
      subdivisions: 1,
    });
    
    // Wheels
    const wheelRadius = height * 0.3;
    const wheelPositions = [
      { x: length * 0.3, z: width * 0.4 },
      { x: length * 0.3, z: -width * 0.4 },
      { x: -length * 0.3, z: width * 0.4 },
      { x: -length * 0.3, z: -width * 0.4 },
    ];
    
    wheelPositions.forEach((pos, i) => {
      parts.push({
        type: 'cylinder',
        radius: wheelRadius,
        height: 200,
        position: { x: pos.x, y: 0, z: pos.z },
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
        material: 'plastic',
        detail: `wheel_${i}`,
      });
    });
    
    return {
      type: 'composite',
      parts,
      subdivisions: 2,
      beveling: 0.08,
    };
  }

  /**
   * Generate furniture geometry
   */
  generateFurniture(element) {
    const { dimensions = {}, name = '' } = element;
    const width = dimensions.width || 800;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 800;
    
    const parts = [];
    
    if (name.toLowerCase().includes('chair')) {
      // Chair seat
      parts.push({
        type: 'box',
        dimensions: { x: width, y: 50, z: depth },
        position: { x: 0, y: height * 0.45, z: 0 },
        material: 'plastic',
        detail: 'seat',
      });
      
      // Chair back
      parts.push({
        type: 'box',
        dimensions: { x: width, y: height * 0.5, z: 50 },
        position: { x: 0, y: height * 0.7, z: -depth * 0.45 },
        material: 'plastic',
        detail: 'back',
      });
      
      // Chair legs
      for (let i = 0; i < 4; i++) {
        const x = (i % 2 - 0.5) * width * 0.8;
        const z = (Math.floor(i / 2) - 0.5) * depth * 0.8;
        parts.push({
          type: 'cylinder',
          radius: 25,
          height: height * 0.45,
          position: { x, y: height * 0.225, z },
          material: 'metal',
          detail: `leg_${i}`,
        });
      }
    } else if (name.toLowerCase().includes('desk') || name.toLowerCase().includes('table')) {
      // Desk top
      parts.push({
        type: 'box',
        dimensions: { x: width, y: 50, z: depth },
        position: { x: 0, y: height * 0.7, z: 0 },
        material: 'wood',
        detail: 'top',
      });
      
      // Desk legs
      for (let i = 0; i < 4; i++) {
        const x = (i % 2 - 0.5) * width * 0.9;
        const z = (Math.floor(i / 2) - 0.5) * depth * 0.9;
        parts.push({
          type: 'box',
          dimensions: { x: 80, y: height * 0.7, z: 80 },
          position: { x, y: height * 0.35, z },
          material: 'metal',
          detail: `leg_${i}`,
        });
      }
    } else {
      // Generic furniture
      parts.push({
        type: 'box',
        dimensions: { x: width, y: height, z: depth },
        position: { x: 0, y: height / 2, z: 0 },
        material: 'wood',
        detail: 'main',
      });
    }
    
    return {
      type: 'composite',
      parts,
      subdivisions: 1,
      beveling: 0.05,
    };
  }

  /**
   * Generate prop geometry
   */
  generateProp(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 1000;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 1000;
    
    return {
      type: 'composite',
      parts: [
        {
          type: 'box',
          dimensions: { x: width, y: height, z: depth },
          position: { x: 0, y: height / 2, z: 0 },
          material: 'default',
          detail: 'main',
        },
      ],
      subdivisions: 1,
      beveling: 0.05,
    };
  }

  /**
   * Generate terrain geometry
   */
  generateTerrain(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 50000;
    const depth = dimensions.depth || 50000;
    
    return {
      type: 'plane',
      dimensions: { x: width, z: depth },
      position: { x: 0, y: 0, z: 0 },
      material: 'concrete',
      detail: 'terrain',
      subdivisions: 10,
    };
  }

  /**
   * Generate generic object
   */
  generateGenericObject(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 1000;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 1000;
    
    return {
      type: 'box',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'default',
    };
  }

  /**
   * Generate facade panels for buildings
   */
  generateFacadePanels(width, height, depth) {
    const panels = [];
    const panelHeight = 3000;
    const panelWidth = 2000;
    const floors = Math.floor(height / panelHeight);
    
    // Front facade
    for (let floor = 0; floor < floors; floor++) {
      for (let i = 0; i < Math.floor(width / panelWidth); i++) {
        panels.push({
          type: 'box',
          dimensions: { x: panelWidth, y: panelHeight, z: 50 },
          position: {
            x: (i - Math.floor(width / panelWidth) / 2 + 0.5) * panelWidth,
            y: floor * panelHeight + panelHeight / 2,
            z: depth / 2 + 25,
          },
          material: 'glass',
          detail: 'facade_panel',
        });
      }
    }
    
    return panels;
  }

  /**
   * Generate landmark-specific structures (towers, bridges, monuments)
   */
  generateLandmarkStructure(element, name, dimensions, details) {
    console.log('🏛️  Generating landmark-specific geometry for:', name);
    
    const width = dimensions.width || 20000;
    const height = dimensions.height || 30000;
    const depth = dimensions.depth || 15000;
    const parts = [];
    let componentId = 0;
    
    const genId = (type) => `landmark_${type}_${componentId++}`;
    const nameLower = (name || '').toLowerCase();
    
    // Detect landmark type from name
    let landmarkType = 'tower'; // default
    if (nameLower.includes('tower') || nameLower.includes('eiffel') || nameLower.includes('space needle') || nameLower.includes('cn tower')) {
      landmarkType = 'tower';
    } else if (nameLower.includes('bridge') || nameLower.includes('golden gate') || nameLower.includes('brooklyn')) {
      landmarkType = 'bridge';
    } else if (nameLower.includes('arch') || nameLower.includes('gateway')) {
      landmarkType = 'arch';
    } else if (nameLower.includes('dome') || nameLower.includes('capitol') || nameLower.includes('pantheon')) {
      landmarkType = 'dome';
    } else if (nameLower.includes('pyramid')) {
      landmarkType = 'pyramid';
    } else if (nameLower.includes('statue') || nameLower.includes('monument')) {
      landmarkType = 'statue';
    }
    
    console.log('   Detected landmark type:', landmarkType);
    console.log('   Dimensions: W=' + width + 'mm, H=' + height + 'mm, D=' + depth + 'mm');
    
    // Generate geometry based on landmark type
    switch (landmarkType) {
      case 'tower':
        return this.generateTowerLandmark(width, height, depth, name, details);
      case 'bridge':
        return this.generateBridgeLandmark(width, height, depth, name, details);
      case 'arch':
        return this.generateArchLandmark(width, height, depth, name, details);
      case 'dome':
        return this.generateDomeLandmark(width, height, depth, name, details);
      case 'pyramid':
        return this.generatePyramidLandmark(width, height, depth, name, details);
      case 'statue':
        return this.generateStatueLandmark(width, height, depth, name, details);
      default:
        return this.generateGenericLandmark(width, height, depth, name, details);
    }
  }
  
  /**
   * Generate tower landmark (Eiffel Tower, CN Tower, Space Needle, etc.)
   */
  generateTowerLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `tower_${type}_${componentId++}`;
    
    // Create tapering tower structure - wider at base, narrower at top
    const sections = 8; // Number of vertical sections
    const baseWidth = width;
    const baseDepth = depth;
    const topWidth = width * 0.15; // Top is 15% of base width
    const topDepth = depth * 0.15;
    
    const mainStructureId = genId('main');
    
    // Generate tapered sections
    for (let i = 0; i < sections; i++) {
      const sectionHeight = height / sections;
      const progress = i / sections;
      const nextProgress = (i + 1) / sections;
      
      // Linear interpolation for tapering
      const sectionBottomWidth = baseWidth * (1 - progress * 0.85);
      const sectionBottomDepth = baseDepth * (1 - progress * 0.85);
      const sectionTopWidth = baseWidth * (1 - nextProgress * 0.85);
      const sectionTopDepth = baseDepth * (1 - nextProgress * 0.85);
      
      const avgWidth = (sectionBottomWidth + sectionTopWidth) / 2;
      const avgDepth = (sectionBottomDepth + sectionTopDepth) / 2;
      
      // Main tapered section
      parts.push({
        id: genId('section'),
        name: `Tower Section ${i + 1}`,
        type: 'box',
        componentType: 'tower_section',
        dimensions: { x: avgWidth, y: sectionHeight, z: avgDepth },
        position: { x: 0, y: i * sectionHeight + sectionHeight / 2, z: 0 },
        material: details.materials?.[0] || 'steel',
        detail: 'tower_structure',
        parent: i === 0 ? null : mainStructureId,
        children: [],
        metadata: {
          editable: true,
          locked: false,
          aiGenerated: true,
          landmarkType: 'tower',
          section: i + 1,
          taper: {
            bottomWidth: sectionBottomWidth,
            topWidth: sectionTopWidth,
            bottomDepth: sectionBottomDepth,
            topDepth: sectionTopDepth
          }
        }
      });
      
      // Add cross-bracing lattice structure every 2 sections
      if (i % 2 === 0 && i < sections - 1) {
        const bracingCount = 12;
        for (let b = 0; b < bracingCount; b++) {
          const angle = (b / bracingCount) * Math.PI * 2;
          const bracingRadius = avgWidth * 0.45;
          
          parts.push({
            id: genId('bracing'),
            name: `Cross Bracing ${i}-${b}`,
            type: 'cylinder',
            componentType: 'structural_bracing',
            radius: 150,
            height: sectionHeight * 1.2,
            dimensions: { x: 300, y: sectionHeight * 1.2, z: 300 },
            position: {
              x: Math.cos(angle) * bracingRadius,
              y: i * sectionHeight + sectionHeight / 2,
              z: Math.sin(angle) * bracingRadius
            },
            rotation: { x: Math.PI / 6, y: angle, z: 0 },
            material: 'steel',
            detail: 'lattice_bracing',
            parent: mainStructureId,
            children: [],
            metadata: {
              editable: false,
              structural: true,
              landmarkDetail: true
            }
          });
        }
      }
    }
    
    // Add observation platform at 70% height
    const platformHeight = height * 0.7;
    const platformWidth = baseWidth * 0.4;
    const platformDepth = baseDepth * 0.4;
    
    parts.push({
      id: genId('platform'),
      name: 'Observation Platform',
      type: 'box',
      componentType: 'observation_deck',
      dimensions: { x: platformWidth, y: 500, z: platformDepth },
      position: { x: 0, y: platformHeight, z: 0 },
      material: 'concrete',
      detail: 'platform',
      parent: mainStructureId,
      children: [],
      metadata: {
        editable: true,
        accessible: true,
        landmarkFeature: 'observation_deck'
      }
    });
    
    // Add spire/antenna at top
    const spireHeight = height * 0.15;
    const spireRadius = topWidth * 0.2;
    
    parts.push({
      id: genId('spire'),
      name: 'Tower Spire',
      type: 'cylinder',
      componentType: 'spire',
      radius: spireRadius,
      height: spireHeight,
      dimensions: { x: spireRadius * 2, y: spireHeight, z: spireRadius * 2 },
      position: { x: 0, y: height + spireHeight / 2, z: 0 },
      material: 'metal',
      detail: 'spire',
      parent: mainStructureId,
      children: [],
      metadata: {
        editable: true,
        iconic: true,
        landmarkFeature: 'spire'
      }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Tower Landmark',
      metadata: {
        landmarkType: 'tower',
        heightMeters: height / 1000,
        realWorldReplica: true,
        aiGenerated: true
      }
    };
  }
  
  /**
   * Generate bridge landmark (Golden Gate, Brooklyn Bridge, etc.)
   */
  generateBridgeLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `bridge_${type}_${componentId++}`;
    
    const mainSpan = depth; // Bridge length
    const deckWidth = width * 0.3;
    const deckHeight = 2000;
    const towerHeight = height;
    const cableCount = 20;
    
    // Bridge deck
    parts.push({
      id: genId('deck'),
      name: 'Bridge Deck',
      type: 'box',
      componentType: 'bridge_deck',
      dimensions: { x: deckWidth, y: deckHeight, z: mainSpan },
      position: { x: 0, y: height * 0.3, z: 0 },
      material: 'steel',
      detail: 'deck',
      parent: null,
      children: [],
      metadata: { landmarkType: 'bridge', structural: true }
    });
    
    // Two main towers
    [-mainSpan * 0.3, mainSpan * 0.3].forEach((zPos, idx) => {
      parts.push({
        id: genId('tower'),
        name: `Bridge Tower ${idx + 1}`,
        type: 'box',
        componentType: 'suspension_tower',
        dimensions: { x: width * 0.15, y: towerHeight, z: depth * 0.15 },
        position: { x: 0, y: towerHeight / 2, z: zPos },
        material: 'steel',
        detail: 'tower',
        parent: null,
        children: [],
        metadata: { landmarkType: 'bridge', iconic: true }
      });
    });
    
    // Suspension cables
    for (let i = 0; i < cableCount; i++) {
      const progress = i / (cableCount - 1);
      const zPos = (progress - 0.5) * mainSpan;
      const cableY = height * 0.3 + Math.abs(progress - 0.5) * height * 0.4;
      
      parts.push({
        id: genId('cable'),
        name: `Suspension Cable ${i + 1}`,
        type: 'cylinder',
        componentType: 'suspension_cable',
        radius: 100,
        height: cableY - height * 0.3,
        dimensions: { x: 200, y: cableY - height * 0.3, z: 200 },
        position: { x: 0, y: (cableY + height * 0.3) / 2, z: zPos },
        material: 'steel',
        detail: 'cable',
        parent: null,
        children: [],
        metadata: { structural: true, flexible: true }
      });
    }
    
    return {
      type: 'composite',
      parts,
      name: name || 'Bridge Landmark',
      metadata: { landmarkType: 'bridge', realWorldReplica: true }
    };
  }
  
  /**
   * Generate arch landmark
   */
  generateArchLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `arch_${type}_${componentId++}`;
    
    const archThickness = width * 0.2;
    const legWidth = width * 0.3;
    
    // Left leg
    parts.push({
      id: genId('leg'),
      name: 'Arch Leg Left',
      type: 'box',
      componentType: 'arch_leg',
      dimensions: { x: legWidth, y: height * 0.7, z: depth },
      position: { x: -width * 0.35, y: height * 0.35, z: 0 },
      material: details.materials?.[0] || 'steel',
      detail: 'leg',
      parent: null,
      children: [],
      metadata: { landmarkType: 'arch', structural: true }
    });
    
    // Right leg
    parts.push({
      id: genId('leg'),
      name: 'Arch Leg Right',
      type: 'box',
      componentType: 'arch_leg',
      dimensions: { x: legWidth, y: height * 0.7, z: depth },
      position: { x: width * 0.35, y: height * 0.35, z: 0 },
      material: details.materials?.[0] || 'steel',
      detail: 'leg',
      parent: null,
      children: [],
      metadata: { landmarkType: 'arch', structural: true }
    });
    
    // Top arch
    parts.push({
      id: genId('span'),
      name: 'Arch Span',
      type: 'box',
      componentType: 'arch_span',
      dimensions: { x: width, y: archThickness, z: depth },
      position: { x: 0, y: height * 0.85, z: 0 },
      material: details.materials?.[0] || 'steel',
      detail: 'span',
      parent: null,
      children: [],
      metadata: { landmarkType: 'arch', iconic: true }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Arch Landmark',
      metadata: { landmarkType: 'arch', realWorldReplica: true }
    };
  }
  
  /**
   * Generate dome landmark
   */
  generateDomeLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `dome_${type}_${componentId++}`;
    
    // Base building
    parts.push({
      id: genId('base'),
      name: 'Dome Base',
      type: 'box',
      componentType: 'building_base',
      dimensions: { x: width, y: height * 0.4, z: depth },
      position: { x: 0, y: height * 0.2, z: 0 },
      material: 'stone',
      detail: 'base',
      parent: null,
      children: [],
      metadata: { landmarkType: 'dome' }
    });
    
    // Dome structure
    parts.push({
      id: genId('dome'),
      name: 'Main Dome',
      type: 'sphere',
      componentType: 'dome',
      radius: width * 0.45,
      dimensions: { x: width * 0.9, y: height * 0.6, z: depth * 0.9 },
      position: { x: 0, y: height * 0.7, z: 0 },
      material: 'metal',
      detail: 'dome',
      parent: null,
      children: [],
      metadata: { landmarkType: 'dome', iconic: true }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Dome Landmark',
      metadata: { landmarkType: 'dome', realWorldReplica: true }
    };
  }
  
  /**
   * Generate pyramid landmark
   */
  generatePyramidLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `pyramid_${type}_${componentId++}`;
    
    // Main pyramid
    parts.push({
      id: genId('pyramid'),
      name: 'Pyramid Structure',
      type: 'pyramid',
      componentType: 'pyramid',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'stone',
      detail: 'pyramid',
      parent: null,
      children: [],
      metadata: { landmarkType: 'pyramid', ancient: true }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Pyramid Landmark',
      metadata: { landmarkType: 'pyramid', realWorldReplica: true }
    };
  }
  
  /**
   * Generate statue/monument landmark
   */
  generateStatueLandmark(width, height, depth, name, details) {
    const parts = [];
    let componentId = 0;
    const genId = (type) => `statue_${type}_${componentId++}`;
    
    // Pedestal
    const pedestalHeight = height * 0.3;
    parts.push({
      id: genId('pedestal'),
      name: 'Statue Pedestal',
      type: 'box',
      componentType: 'pedestal',
      dimensions: { x: width * 0.8, y: pedestalHeight, z: depth * 0.8 },
      position: { x: 0, y: pedestalHeight / 2, z: 0 },
      material: 'stone',
      detail: 'pedestal',
      parent: null,
      children: [],
      metadata: { landmarkType: 'statue' }
    });
    
    // Statue figure (simplified as tall tapered form)
    const figureHeight = height * 0.7;
    parts.push({
      id: genId('figure'),
      name: 'Statue Figure',
      type: 'box',
      componentType: 'statue_figure',
      dimensions: { x: width * 0.4, y: figureHeight, z: depth * 0.4 },
      position: { x: 0, y: pedestalHeight + figureHeight / 2, z: 0 },
      material: details.materials?.[0] || 'copper',
      detail: 'figure',
      parent: null,
      children: [],
      metadata: { landmarkType: 'statue', iconic: true }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Statue Landmark',
      metadata: { landmarkType: 'statue', realWorldReplica: true }
    };
  }
  
  /**
   * Generate generic landmark (fallback)
   */
  generateGenericLandmark(width, height, depth, name, details) {
    const parts = [];
    
    // Create a distinctive tall structure
    parts.push({
      id: 'landmark_main',
      name: name || 'Landmark',
      type: 'box',
      componentType: 'landmark_structure',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'concrete',
      detail: 'landmark',
      parent: null,
      children: [],
      metadata: { landmarkType: 'generic', realWorldReplica: true }
    });
    
    return {
      type: 'composite',
      parts,
      name: name || 'Landmark',
      metadata: { landmarkType: 'generic', realWorldReplica: true }
    };
  }

  /**
   * Generate windows for buildings
   */
  generateWindows(width, height, depth, floors) {
    const windows = [];
    const windowWidth = 1500;
    const windowHeight = 2000;
    const windowsPerFloor = Math.floor(width / 2500);
    
    for (let floor = 1; floor < floors; floor++) {
      for (let i = 0; i < windowsPerFloor; i++) {
        // Front windows
        windows.push({
          type: 'box',
          dimensions: { x: windowWidth, y: windowHeight, z: 100 },
          position: {
            x: (i - windowsPerFloor / 2 + 0.5) * 2500,
            y: floor * 3000 + 1500,
            z: depth / 2 + 100,
          },
          material: 'glass',
          detail: 'window',
        });
      }
    }
    
    return windows;
  }

  /**
   * Generate railings
   */
  generateRailings(width, height, depth, parentId = null, startId = 0) {
    const railings = [];
    const railHeight = 1000;
    const railRadius = 30;
    
    // Roof railing
    const posts = Math.floor(width / 2000);
    for (let i = 0; i <= posts; i++) {
      railings.push({
        type: 'cylinder',
        radius: railRadius,
        height: railHeight,
        position: {
          x: (i - posts / 2) * 2000,
          y: height + railHeight / 2,
          z: depth / 2,
        },
        material: 'metal',
        detail: 'railing_post',
      });
    }
    
    return railings;
  }

  /**
   * Generate pipes and cables
   */
  generatePipes(width, height, depth, parentId = null, startId = 0) {
    const pipes = [];
    const pipeRadius = 100;
    const pipeCount = 3;
    
    for (let i = 0; i < pipeCount; i++) {
      pipes.push({
        type: 'cylinder',
        radius: pipeRadius,
        height: height,
        position: {
          x: width / 2 + 200,
          y: height / 2,
          z: (i - pipeCount / 2) * 500,
        },
        material: 'metal',
        detail: 'pipe',
      });
    }
    
    return pipes;
  }

  /**
   * Generate structural beams
   */
  generateBeams(width, height, depth) {
    const beams = [];
    const beamWidth = 200;
    const beamHeight = 300;
    
    // Horizontal beams along width
    const beamCount = 3;
    for (let i = 0; i < beamCount; i++) {
      beams.push({
        type: 'box',
        dimensions: { x: width, y: beamHeight, z: beamWidth },
        position: {
          x: 0,
          y: 0,
          z: (i - beamCount / 2) * (depth / beamCount),
        },
        material: 'metal',
        detail: 'beam',
      });
    }
    
    return beams;
  }

  /**
   * Generate curtain wall facade (continuous glass)
   */
  generateCurtainWallFacade(width, height, depth, floors, parentId = null, startId = 0) {
    const panels = [];
    const panelHeight = height / floors;
    const panelWidth = 2000;
    const panelsPerSide = Math.ceil(width / panelWidth);
    let componentId = startId;
    
    // Generate unique ID for component
    const genId = (type) => `${type}_${componentId++}`;
    
    // Front and back glass walls
    for (let side = 0; side < 2; side++) {
      const zPos = side === 0 ? depth / 2 : -depth / 2;
      const sideName = side === 0 ? 'Front' : 'Back';
      
      for (let floor = 0; floor < floors; floor++) {
        for (let i = 0; i < panelsPerSide; i++) {
          const panelId = genId('curtain_panel');
          panels.push({
            id: panelId,
            name: `${sideName} Curtain Panel F${floor}P${i}`,
            type: 'box',
            componentType: 'curtain_wall_panel',
            dimensions: { x: panelWidth, y: panelHeight, z: 100 },
            position: {
              x: (i - panelsPerSide / 2 + 0.5) * panelWidth,
              y: floor * panelHeight + panelHeight / 2,
              z: zPos + (side === 0 ? 50 : -50),
            },
            material: 'glass',
            detail: 'curtain_wall_panel',
            parent: parentId,
            children: [],
            metadata: {
              editable: true,
              locked: false,
              aiGenerated: true,
              level: 2,
              floorNumber: floor,
              panelNumber: i,
              side: sideName,
              properties: {
                transparency: 0.7,
                reflective: true,
              }
            }
          });
        }
      }
    }
    
    return panels;
  }

  /**
   * Generate window grid with proper spacing and hierarchy
   */
  generateWindowGrid(width, height, depth, floors, parentId = null, startId = 0) {
    const windows = [];
    const windowWidth = 1500;
    const windowHeight = 2000;
    const windowSpacing = 2500;
    const windowsPerFloor = Math.floor(width / windowSpacing);
    const floorHeight = height / floors;
    let componentId = startId;
    
    // Generate unique ID for component
    const genId = (type) => `${type}_${componentId++}`;
    
    // Front facade windows
    for (let floor = 0; floor < floors; floor++) {
      for (let i = 0; i < windowsPerFloor; i++) {
        const windowId = genId('window');
        windows.push({
          id: windowId,
          name: `Window F${floor}W${i}`,
          type: 'box',
          componentType: 'window',
          dimensions: { x: windowWidth, y: windowHeight, z: 150 },
          position: {
            x: (i - windowsPerFloor / 2 + 0.5) * windowSpacing,
            y: floor * floorHeight + floorHeight / 2,
            z: depth / 2 + 75,
          },
          material: 'glass',
          detail: 'window',
          parent: parentId,
          children: [],
          metadata: {
            editable: true,
            locked: false,
            aiGenerated: true,
            level: 2,
            floorNumber: floor,
            windowNumber: i,
            properties: {
              openable: true,
              glazing: 'double',
            }
          }
        });
      }
    }
    
    return windows;
  }

  /**
   * Generate window frames and mullions
   */
  generateWindowFrames(width, height, depth, floors, parentId = null, startId = 0) {
    const frames = [];
    const frameThickness = 50;
    const frameDepth = 150;
    const windowSpacing = 2500;
    const windowsPerFloor = Math.floor(width / windowSpacing);
    const floorHeight = height / floors;
    let componentId = startId;
    
    const genId = (type) => `${type}_${componentId++}`;
    
    // Horizontal mullions between floors
    for (let floor = 1; floor < floors; floor++) {
      const frameId = genId('mullion');
      frames.push({
        id: frameId,
        name: `Horizontal Mullion F${floor}`,
        type: 'box',
        componentType: 'window_frame',
        dimensions: { x: width * 0.9, y: frameThickness * 2, z: frameDepth },
        position: {
          x: 0,
          y: floor * floorHeight,
          z: depth / 2 + frameDepth / 2,
        },
        material: 'metal',
        detail: 'horizontal_mullion',
        parent: parentId,
        children: [],
        metadata: {
          editable: true,
          locked: false,
          aiGenerated: true,
          level: 2,
          floorNumber: floor,
        }
      });
    }
    
    return frames;
  }

  /**
   * Generate balconies for residential/office buildings with hierarchy
   */
  generateBalconies(width, height, depth, floors, parentId = null, startId = 0) {
    const balconies = [];
    const balconyDepth = 1500;
    const balconyWidth = width * 0.8;
    const balconyHeight = 100;
    const floorHeight = height / floors;
    
    // Add balconies to upper floors
    const startFloor = Math.floor(floors * 0.3); // Start from 30% height
    for (let floor = startFloor; floor < floors; floor += 2) { // Every other floor
      balconies.push({
        type: 'box',
        dimensions: { x: balconyWidth, y: balconyHeight, z: balconyDepth },
        position: {
          x: 0,
          y: floor * floorHeight,
          z: depth / 2 + balconyDepth / 2,
        },
        material: 'concrete',
        detail: 'balcony',
      });
      
      // Balcony railing
      balconies.push({
        type: 'box',
        dimensions: { x: balconyWidth, y: 1000, z: 50 },
        position: {
          x: 0,
          y: floor * floorHeight + 500,
          z: depth / 2 + balconyDepth,
        },
        material: 'metal',
        detail: 'balcony_railing',
      });
    }
    
    return balconies;
  }

  /**
   * Generate entrance features (lobby, canopy, etc.)
   */
  generateEntranceFeatures(width, depth, parentId = null, startId = 0) {
    const features = [];
    const entranceWidth = width * 0.3;
    const entranceHeight = 6000; // Double height lobby
    
    // Entrance canopy
    features.push({
      type: 'box',
      dimensions: { x: entranceWidth, y: 200, z: 3000 },
      position: {
        x: 0,
        y: 4000,
        z: depth / 2 + 1500,
      },
      material: 'metal',
      detail: 'entrance_canopy',
    });
    
    // Entrance pillars
    for (let i = -1; i <= 1; i += 2) {
      features.push({
        type: 'cylinder',
        radius: 300,
        height: entranceHeight,
        position: {
          x: i * entranceWidth / 3,
          y: entranceHeight / 2,
          z: depth / 2 + 100,
        },
        material: 'concrete',
        detail: 'entrance_pillar',
      });
    }
    
    return features;
  }

  /**
   * Generate rooftop features (garden, terrace, mechanical)
   */
  generateRooftopFeatures(width, height, depth, parentId = null, startId = 0) {
    const features = [];
    
    // Rooftop parapet
    const parapetHeight = 1500;
    features.push({
      type: 'box',
      dimensions: { x: width + 200, y: parapetHeight, z: 200 },
      position: { x: 0, y: height + parapetHeight / 2, z: depth / 2 },
      material: 'concrete',
      detail: 'parapet',
    });
    features.push({
      type: 'box',
      dimensions: { x: width + 200, y: parapetHeight, z: 200 },
      position: { x: 0, y: height + parapetHeight / 2, z: -depth / 2 },
      material: 'concrete',
      detail: 'parapet',
    });
    
    // Mechanical penthouse
    const mechWidth = width * 0.3;
    const mechHeight = 3000;
    features.push({
      type: 'box',
      dimensions: { x: mechWidth, y: mechHeight, z: depth * 0.3 },
      position: {
        x: 0,
        y: height + mechHeight / 2,
        z: 0,
      },
      material: 'metal',
      detail: 'mechanical_penthouse',
    });
    
    return features;
  }

  /**
   * Generate structural columns (visible in modern buildings)
   */
  generateStructuralColumns(width, height, depth, parentId = null, startId = 0) {
    const columns = [];
    const columnRadius = 400;
    const columnsPerSide = 4;
    
    for (let i = 0; i < columnsPerSide; i++) {
      for (let j = 0; j < columnsPerSide; j++) {
        const x = (i - columnsPerSide / 2 + 0.5) * (width / columnsPerSide);
        const z = (j - columnsPerSide / 2 + 0.5) * (depth / columnsPerSide);
        
        columns.push({
          type: 'cylinder',
          radius: columnRadius,
          height: height,
          position: { x, y: height / 2, z },
          material: 'concrete',
          detail: 'structural_column',
        });
      }
    }
    
    return columns;
  }

  /**
   * Generate underground parking level indicator
   */
  generateUndergroundLevel(width, depth, parentId = null, startId = 0) {
    const features = [];
    const parkingHeight = 3000;
    
    // Underground slab
    features.push({
      type: 'box',
      dimensions: { x: width * 1.2, y: 200, z: depth * 1.2 },
      position: { x: 0, y: -parkingHeight, z: 0 },
      material: 'concrete',
      detail: 'underground_slab',
    });
    
    // Parking ramp entrance
    features.push({
      type: 'box',
      dimensions: { x: 5000, y: 300, z: 8000 },
      position: {
        x: width / 2 - 2500,
        y: -parkingHeight / 2,
        z: depth / 2 + 4000,
      },
      material: 'concrete',
      detail: 'parking_ramp',
    });
    
    return features;
  }

  /**
   * Calculate instance positions for repeated elements
   */
  calculateInstancePositions(count, element, index) {
    const positions = [];
    const gridSize = Math.ceil(Math.sqrt(count));
    const spacing = 3000;
    
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      positions.push({
        x: (col - gridSize / 2) * spacing,
        y: 0,
        z: (row - gridSize / 2) * spacing + index * 5000,
      });
    }
    
    return positions;
  }

  /**
   * Calculate position for object in scene
   */
  calculatePosition(index, total) {
    const spacing = 5000;
    return {
      x: (index - total / 2) * spacing,
      y: 0,
      z: 0,
    };
  }

  /**
   * Calculate scene bounds
   */
  calculateSceneBounds(meshes, instances) {
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    
    meshes.forEach(mesh => {
      const pos = mesh.position || { x: 0, y: 0, z: 0 };
      const dim = mesh.dimensions || { x: 1000, y: 1000, z: 1000 };
      minX = Math.min(minX, pos.x - dim.x / 2);
      maxX = Math.max(maxX, pos.x + dim.x / 2);
      minY = Math.min(minY, pos.y - dim.y / 2);
      maxY = Math.max(maxY, pos.y + dim.y / 2);
      minZ = Math.min(minZ, pos.z - dim.z / 2);
      maxZ = Math.max(maxZ, pos.z + dim.z / 2);
    });
    
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      center: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
      },
    };
  }
}

module.exports = new GeometryGenerator();
