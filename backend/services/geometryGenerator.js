/**
 * Geometry Generator - Procedural 3D geometry generation
 * Handles generation of architectural elements, props, details, and environments
 */
const placementEngine = require('./placementEngine');

class GeometryGenerator {
  constructor() {
    // STANDARD 3D CONVENTION: 1 meter = 1 unit
    // No scaling factors! Real-world dimensions map directly to 3D space
    // Camera/viewport handles zoom, not geometry scaling
    // Eiffel Tower: 324 meters = 324 units
  }

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
    console.log(`📊 Elements to generate: ${elements.length}`);
    
    // SPECIAL CASE: Single landmark - no complex placement needed
    if (elements.length === 1 && elements[0].metadata?.realWorld) {
      console.log('🏛️  Single landmark detected - generating at center position');
      const element = elements[0];
      
      // Position at center
      element.position = { x: 0, y: 0, z: 0 };
      element.rotation = { x: 0, y: 0, z: 0 };
      element.instanceIndex = 0;
      
      try {
        const geometry = this.generateTaxonomyElement(element, realism);
        
        // For landmarks, the geometry is already complete (composite type)
        if (geometry.type === 'composite') {
          console.log(`✅ Generated single landmark: ${element.name} with ${geometry.parts.length} parts`);
          return {
            type: 'taxonomy_scene',
            meshes: geometry.parts.map((part, idx) => ({
              ...part,
              position: part.position || { x: 0, y: 0, z: 0 },
              rotation: part.rotation || { x: 0, y: 0, z: 0 },
              name: part.name || `${element.name}_part_${idx}`,
              taxonomyData: {
                category: element.category,
                subcategory: element.subcategory,
                isLandmark: true,
                landmarkName: element.name
              }
            })),
            instances: [],
            bounds: geometry.bounds,
            metadata: {
              taxonomyData,
              elementCount: 1,
              isLandmark: true,
              landmarkName: element.name
            }
          };
        }
      } catch (error) {
        console.error(`Error generating landmark ${element.name}:`, error);
      }
    }
    
    // Calculate realistic positions using placement engine for multiple elements
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
   * Enhanced to use real-world data when available (from Wikipedia/Wikidata/Geographic services)
   */
  generateTaxonomyElement(element, realism) {
    const { category, subcategory, dimensions, materials, features, metadata } = element;
    const detailLevel = realism?.detailLevel || 'high';
    
    // Check if element has real-world data from external sources
    const hasRealWorldData = metadata?.realWorld === true;
    const dataSource = metadata?.source;
    
    if (hasRealWorldData) {
      console.log(`📏 Using REAL-WORLD dimensions from ${dataSource} for ${element.name}`);
    }
    
    // STANDARD 3D CONVENTION: 1 meter = 1 unit
    // Get dimensions in meters (from Wikipedia/Wikidata or AI estimation)
    const dimsInMeters = {
      width: dimensions?.width || 10,
      height: dimensions?.height || 10,
      depth: dimensions?.depth || 10
    };
    
    // Log what we're generating
    if (hasRealWorldData && this.isKnownLandmark(element.name)) {
      console.log(`\n🏛️  LANDMARK DETECTED: ${element.name}`);
      console.log(`📐 Real-world dimensions: ${dimsInMeters.width}m × ${dimsInMeters.height}m × ${dimsInMeters.depth}m`);
      console.log(`📏 3D space: ${dimsInMeters.width} × ${dimsInMeters.height} × ${dimsInMeters.depth} units (1 meter = 1 unit)`);
      console.log(`   No scaling applied - camera will zoom to fit\n`);
    }
    
    // Use meters directly as units (standard 3D convention)
    const dims = { ...dimsInMeters };
    
    // CRITICAL: Check if this is a famous landmark with real-world data
    // Generate specialized unified geometry for landmarks
    if (hasRealWorldData && this.isKnownLandmark(element.name)) {
      console.log(`🗼 Generating highly detailed landmark geometry for ${element.name}`);
      return this.generateLandmarkGeometry(element, dims, materials);
    }
    
    // Map taxonomy categories to generation methods
    switch (category) {
      case 'Architecture':
      case 'residential':
      case 'commercial':
      case 'institutional':
      case 'industrial':
        return this.generateBuilding({
          ...element,
          type: 'building',
          dimensions: dims,
          details: features || [],
          materials: materials || ['concrete'],
          realWorldData: hasRealWorldData,
          dataSource: dataSource
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
    
    // Return as a single unified mesh, not as separate parts
    // This prevents the frontend from treating each part as a separate instance
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,  // Store parts as subcomponents, not as separate meshes
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'steel',
      name: name || 'Tower Landmark',
      metadata: {
        landmarkType: 'tower',
        heightMeters: height / 1000,
        realWorldReplica: true,
        aiGenerated: true,
        unifiedMesh: true,  // Flag to indicate this should render as one object
        partCount: parts.length
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'steel',
      name: name || 'Bridge Landmark',
      metadata: {
        landmarkType: 'bridge',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'steel',
      name: name || 'Arch Landmark',
      metadata: {
        landmarkType: 'arch',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'concrete',
      name: name || 'Dome Landmark',
      metadata: {
        landmarkType: 'dome',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'stone',
      name: name || 'Pyramid Landmark',
      metadata: {
        landmarkType: 'pyramid',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'bronze',
      name: name || 'Statue Landmark',
      metadata: {
        landmarkType: 'statue',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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
    
    // Return as a single unified mesh
    return {
      type: 'unified_landmark',
      componentType: 'landmark_structure',
      subcomponents: parts,
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: details.materials?.[0] || 'concrete',
      name: name || 'Landmark',
      metadata: {
        landmarkType: 'generic',
        realWorldReplica: true,
        unifiedMesh: true,
        partCount: parts.length
      }
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

  /**
   * Check if this is a known famous landmark
   */
  isKnownLandmark(name) {
    if (!name) return false;
    
    const lowerName = name.toLowerCase();
    const landmarks = [
      'eiffel tower', 'empire state', 'burj khalifa', 'taj mahal',
      'colosseum', 'big ben', 'sydney opera', 'statue of liberty',
      'golden gate', 'tower bridge', 'notre dame', 'sagrada familia',
      'willis tower', 'chrysler building', 'one world trade',
      'leaning tower', 'parthenon', 'sphinx', 'pyramid'
    ];
    
    return landmarks.some(landmark => lowerName.includes(landmark));
  }

  /**
   * Generate simplified unified geometry for famous landmarks
   * Creates a single cohesive structure instead of hundreds of parts
   * Dimensions are in meters (standard 3D: 1 meter = 1 unit)
   */
  generateLandmarkGeometry(element, dimensions, materials) {
    const { name } = element;
    const { width, height, depth } = dimensions;
    
    console.log(`\n🗼 GENERATING LANDMARK GEOMETRY: ${name}`);
    console.log(`   Dimensions: ${width.toFixed(1)}m × ${height.toFixed(1)}m × ${depth.toFixed(1)}m`);
    console.log(`   3D space: ${width.toFixed(1)} × ${height.toFixed(1)} × ${depth.toFixed(1)} units (1:1 ratio)\n`);
    
    // Create specialized landmark structure based on shape
    const lowerName = name.toLowerCase();
    
    // Eiffel Tower - iconic lattice structure
    if (lowerName.includes('eiffel')) {
      return this.generateEiffelTowerGeometry(width, height, depth, materials);
    }
    
    // Skyscrapers - simplified tower with taper
    if (lowerName.includes('empire state') || lowerName.includes('chrysler') || 
        lowerName.includes('burj') || lowerName.includes('willis')) {
      return this.generateSkyscraperGeometry(width, height, depth, materials, name);
    }
    
    // Pyramids - pyramid shape
    if (lowerName.includes('pyramid')) {
      return this.generatePyramidGeometry(width, height, depth, materials);
    }
    
    // Taj Mahal - dome structure
    if (lowerName.includes('taj mahal')) {
      return this.generateDomeStructureGeometry(width, height, depth, materials);
    }
    
    // Default: simplified tower structure (much simpler than generateBuilding)
    return this.generateSimpleTowerGeometry(width, height, depth, materials, name);
  }

  /**
   * Generate Eiffel Tower with HIGHLY DETAILED geometry
   * Uses map service insights and multi-angle analysis for realistic replication
   */
  generateEiffelTowerGeometry(width, height, depth, materials) {
    const parts = [];
    const material = materials?.[0] || 'iron';
    
    console.log('🗼 ENHANCED: Generating highly detailed Eiffel Tower with lattice structure');
    
    // Foundation and base (ground level - 0 to 57m scaled)
    const foundationHeight = height * 0.176; // 57m out of 324m
    
    // 1. Ground level base platform
    parts.push({
      id: 'eiffel_foundation',
      name: 'Foundation Platform',
      type: 'box',
      componentType: 'landmark_foundation',
      dimensions: { x: width * 1.1, y: height * 0.02, z: depth * 1.1 },
      position: { x: 0, y: height * 0.01, z: 0 },
      material: 'concrete',
      metadata: { isLandmark: true, landmarkPart: 'foundation', detail: 'high' }
    });
    
    // 2. Four corner legs (curved inward taper) - DETAILED
    const legWidth = width * 0.08;
    const legPositions = [
      { x: width * 0.35, z: depth * 0.35 },   // NE leg
      { x: -width * 0.35, z: depth * 0.35 },  // NW leg
      { x: width * 0.35, z: -depth * 0.35 },  // SE leg
      { x: -width * 0.35, z: -depth * 0.35 }  // SW leg
    ];
    
    // Generate each leg with multiple segments for realistic curve
    const legSegments = 8; // More segments = smoother curve
    for (let legIdx = 0; legIdx < 4; legIdx++) {
      for (let seg = 0; seg < legSegments; seg++) {
        const segHeight = foundationHeight / legSegments;
        const segYPos = height * 0.02 + (seg * segHeight) + (segHeight / 2);
        
        // Calculate inward taper (legs curve inward)
        const taperFactor = 1 - (seg / legSegments) * 0.65; // Taper to 35% at first platform
        const xPos = legPositions[legIdx].x * taperFactor;
        const zPos = legPositions[legIdx].z * taperFactor;
        
        parts.push({
          id: `eiffel_leg${legIdx}_seg${seg}`,
          name: `Leg ${legIdx + 1} Segment ${seg + 1}`,
          type: 'box',
          componentType: 'landmark_leg',
          dimensions: { x: legWidth, y: segHeight, z: legWidth },
          position: { x: xPos, y: segYPos, z: zPos },
          material,
          metadata: { isLandmark: true, landmarkPart: 'leg', legIndex: legIdx, segment: seg }
        });
      }
    }
    
    // 3. Cross-bracing between legs (X-pattern) - MULTIPLE LEVELS
    const braceLevels = 4;
    for (let level = 0; level < braceLevels; level++) {
      const braceY = height * 0.02 + (level / braceLevels) * foundationHeight;
      const braceTaper = 1 - (level / braceLevels) * 0.6;
      const braceWidth = width * 0.03;
      
      // Horizontal braces connecting legs
      for (let i = 0; i < 4; i++) {
        const nextI = (i + 1) % 4;
        const startPos = { x: legPositions[i].x * braceTaper, z: legPositions[i].z * braceTaper };
        const endPos = { x: legPositions[nextI].x * braceTaper, z: legPositions[nextI].z * braceTaper };
        const midX = (startPos.x + endPos.x) / 2;
        const midZ = (startPos.z + endPos.z) / 2;
        const braceLength = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.z - startPos.z, 2));
        const angle = Math.atan2(endPos.z - startPos.z, endPos.x - startPos.x);
        
        parts.push({
          id: `eiffel_brace_h${level}_${i}`,
          name: `Horizontal Brace L${level} Side${i}`,
          type: 'box',
          componentType: 'landmark_brace',
          dimensions: { x: braceLength, y: braceWidth, z: braceWidth },
          position: { x: midX, y: braceY, z: midZ },
          rotation: { x: 0, y: angle, z: 0 },
          material,
          metadata: { isLandmark: true, landmarkPart: 'brace', level, orientation: 'horizontal' }
        });
      }
      
      // Diagonal X-braces
      for (let i = 0; i < 4; i++) {
        const oppI = (i + 2) % 4;
        const startPos = { x: legPositions[i].x * braceTaper, z: legPositions[i].z * braceTaper };
        const endPos = { x: legPositions[oppI].x * braceTaper, z: legPositions[oppI].z * braceTaper };
        const midX = (startPos.x + endPos.x) / 2;
        const midZ = (startPos.z + endPos.z) / 2;
        const braceLength = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.z - startPos.z, 2));
        const angle = Math.atan2(endPos.z - startPos.z, endPos.x - startPos.x);
        
        if (i < 2) { // Only create 2 diagonal braces (forming X)
          parts.push({
            id: `eiffel_brace_d${level}_${i}`,
            name: `Diagonal Brace L${level} ${i}`,
            type: 'box',
            componentType: 'landmark_brace',
            dimensions: { x: braceLength, y: braceWidth * 0.7, z: braceWidth * 0.7 },
            position: { x: midX, y: braceY, z: midZ },
            rotation: { x: 0, y: angle, z: 0 },
            material,
            metadata: { isLandmark: true, landmarkPart: 'brace', level, orientation: 'diagonal' }
          });
        }
      }
    }
    
    // 4. FIRST PLATFORM (57m - 115m scaled)
    const firstPlatformY = foundationHeight;
    const firstPlatformHeight = height * 0.179; // 58m
    const firstPlatformWidth = width * 0.5;
    
    parts.push({
      id: 'eiffel_platform1_floor',
      name: 'First Platform Floor',
      type: 'box',
      componentType: 'landmark_platform',
      dimensions: { x: firstPlatformWidth, y: height * 0.015, z: firstPlatformWidth },
      position: { x: 0, y: firstPlatformY, z: 0 },
      material: 'iron',
      metadata: { isLandmark: true, landmarkPart: 'platform', platformNum: 1 }
    });
    
    // Platform railings
    const railingHeight = height * 0.003; // 1m scaled
    const railingPositions = [
      { x: 0, z: firstPlatformWidth / 2 },
      { x: 0, z: -firstPlatformWidth / 2 },
      { x: firstPlatformWidth / 2, z: 0 },
      { x: -firstPlatformWidth / 2, z: 0 }
    ];
    
    railingPositions.forEach((pos, idx) => {
      parts.push({
        id: `eiffel_platform1_railing_${idx}`,
        name: `First Platform Railing ${idx}`,
        type: 'box',
        componentType: 'landmark_railing',
        dimensions: { x: firstPlatformWidth * 0.9, y: railingHeight, z: height * 0.002 },
        position: { x: pos.x, y: firstPlatformY + railingHeight / 2, z: pos.z },
        rotation: { x: 0, y: idx > 1 ? Math.PI / 2 : 0, z: 0 },
        material,
        metadata: { isLandmark: true, landmarkPart: 'railing' }
      });
    });
    
    // 5. Middle tower section (first to second platform) - LATTICE STRUCTURE
    const middleTowerSegments = 12; // High detail
    const middleTowerHeight = firstPlatformHeight;
    
    for (let seg = 0; seg < middleTowerSegments; seg++) {
      const segHeight = middleTowerHeight / middleTowerSegments;
      const segYPos = firstPlatformY + (seg * segHeight) + (segHeight / 2);
      const taperFactor = 1 - (seg / middleTowerSegments) * 0.5; // Taper from 50% to 25%
      const segWidth = firstPlatformWidth * taperFactor;
      const wallThickness = width * 0.02;
      
      // Create hollow lattice structure (4 walls)
      for (let wall = 0; wall < 4; wall++) {
        const angle = (wall * Math.PI / 2);
        const xOffset = Math.cos(angle) * (segWidth / 2);
        const zOffset = Math.sin(angle) * (segWidth / 2);
        
        parts.push({
          id: `eiffel_middle_${seg}_wall${wall}`,
          name: `Middle Tower S${seg} Wall${wall}`,
          type: 'box',
          componentType: 'landmark_lattice',
          dimensions: { x: segWidth * 0.9, y: segHeight, z: wallThickness },
          position: { x: xOffset, y: segYPos, z: zOffset },
          rotation: { x: 0, y: angle, z: 0 },
          material,
          metadata: { isLandmark: true, landmarkPart: 'lattice', section: 'middle', segment: seg }
        });
      }
    }
    
    // 6. SECOND PLATFORM (115m - 276m scaled)
    const secondPlatformY = firstPlatformY + firstPlatformHeight;
    const secondPlatformWidth = width * 0.3;
    
    parts.push({
      id: 'eiffel_platform2_floor',
      name: 'Second Platform Floor',
      type: 'box',
      componentType: 'landmark_platform',
      dimensions: { x: secondPlatformWidth, y: height * 0.015, z: secondPlatformWidth },
      position: { x: 0, y: secondPlatformY, z: 0 },
      material: 'iron',
      metadata: { isLandmark: true, landmarkPart: 'platform', platformNum: 2 }
    });
    
    // 7. Upper tower section (second platform to third platform) - DETAILED TAPER
    const upperTowerHeight = height * 0.498; // 161m
    const upperTowerSegments = 16; // Very detailed
    
    for (let seg = 0; seg < upperTowerSegments; seg++) {
      const segHeight = upperTowerHeight / upperTowerSegments;
      const segYPos = secondPlatformY + (seg * segHeight) + (segHeight / 2);
      const taperFactor = 1 - (seg / upperTowerSegments) * 0.75; // Strong taper
      const segWidth = secondPlatformWidth * taperFactor;
      const wallThickness = width * 0.015;
      
      // Octagonal cross-section for upper section
      const sides = 8;
      for (let side = 0; side < sides; side++) {
        const angle = (side * 2 * Math.PI / sides);
        const xOffset = Math.cos(angle) * (segWidth / 2);
        const zOffset = Math.sin(angle) * (segWidth / 2);
        
        parts.push({
          id: `eiffel_upper_${seg}_side${side}`,
          name: `Upper Tower S${seg} Side${side}`,
          type: 'box',
          componentType: 'landmark_lattice',
          dimensions: { x: segWidth * 0.35, y: segHeight, z: wallThickness },
          position: { x: xOffset, y: segYPos, z: zOffset },
          rotation: { x: 0, y: angle, z: 0 },
          material,
          metadata: { isLandmark: true, landmarkPart: 'lattice', section: 'upper', segment: seg }
        });
      }
    }
    
    // 8. THIRD PLATFORM / TOP (276m - 300m scaled)
    const thirdPlatformY = secondPlatformY + upperTowerHeight;
    const thirdPlatformWidth = width * 0.12;
    
    parts.push({
      id: 'eiffel_platform3_floor',
      name: 'Third Platform Floor',
      type: 'box',
      componentType: 'landmark_platform',
      dimensions: { x: thirdPlatformWidth, y: height * 0.01, z: thirdPlatformWidth },
      position: { x: 0, y: thirdPlatformY, z: 0 },
      material: 'iron',
      metadata: { isLandmark: true, landmarkPart: 'platform', platformNum: 3 }
    });
    
    // 9. Top spire (300m - 324m scaled) - DETAILED ANTENNA
    const spireHeight = height * 0.074; // 24m
    const spireSegments = 6;
    
    for (let seg = 0; seg < spireSegments; seg++) {
      const segHeight = spireHeight / spireSegments;
      const segYPos = thirdPlatformY + (seg * segHeight) + (segHeight / 2);
      const taperFactor = 1 - (seg / spireSegments) * 0.9; // Strong taper to point
      const segRadius = thirdPlatformWidth * 0.15 * taperFactor;
      
      parts.push({
        id: `eiffel_spire_${seg}`,
        name: `Spire Segment ${seg + 1}`,
        type: 'cylinder',
        componentType: 'landmark_spire',
        dimensions: { x: segRadius * 2, y: segHeight, z: segRadius * 2 },
        position: { x: 0, y: segYPos, z: 0 },
        material,
        metadata: { isLandmark: true, landmarkPart: 'spire', segment: seg }
      });
    }
    
    // 10. Antenna beacon (very top)
    const beaconY = thirdPlatformY + spireHeight;
    parts.push({
      id: 'eiffel_beacon',
      name: 'Top Beacon',
      type: 'sphere',
      componentType: 'landmark_beacon',
      dimensions: { x: width * 0.01, y: width * 0.01, z: width * 0.01 },
      position: { x: 0, y: beaconY, z: 0 },
      material: 'light',
      metadata: { isLandmark: true, landmarkPart: 'beacon', emissive: true }
    });
    
    console.log(`✅ Generated HIGHLY DETAILED Eiffel Tower with ${parts.length} parts including:`);
    console.log(`   - 4 curved legs with ${legSegments} segments each`);
    console.log(`   - ${braceLevels} levels of cross-bracing`);
    console.log(`   - 3 observation platforms`);
    console.log(`   - ${middleTowerSegments + upperTowerSegments} lattice structure segments`);
    console.log(`   - ${spireSegments}-segment antenna spire`);
    
    return {
      type: 'composite',
      parts,
      bounds: this.calculateBounds(parts),
      metadata: {
        isLandmark: true,
        landmarkName: 'Eiffel Tower',
        detailLevel: 'high',
        partCount: parts.length,
        realWorldAccurate: true,
        dataSource: 'map-services-multi-angle-analysis'
      }
    };
  }

  /**
   * Generate skyscraper simplified geometry
   */
  generateSkyscraperGeometry(width, height, depth, materials, name) {
    const parts = [];
    
    // Main tower (single unified box)
    parts.push({
      id: 'skyscraper_main',
      name: `${name} - Main Tower`,
      type: 'box',
      componentType: 'landmark_structure',
      dimensions: { x: width, y: height * 0.85, z: depth },
      position: { x: 0, y: height * 0.425, z: 0 },
      material: materials?.[0] || 'glass',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'main_tower'
      }
    });
    
    // Spire/antenna (if tall building)
    if (height > 200000) { // Buildings over 200m typically have spires
      const spireHeight = height * 0.15;
      parts.push({
        id: 'skyscraper_spire',
        name: 'Spire',
        type: 'cone',
        componentType: 'landmark_spire',
        dimensions: { x: width * 0.2, y: spireHeight, z: depth * 0.2 },
        position: { x: 0, y: height * 0.85 + (spireHeight / 2), z: 0 },
        material: materials?.[0] || 'steel',
        metadata: {
          editable: false,
          locked: true,
          aiGenerated: true,
          isLandmark: true,
          landmarkPart: 'spire'
        }
      });
    }
    
    console.log(`✅ Generated ${name} with ${parts.length} unified parts (instead of 200+)`);
    
    return {
      type: 'composite',
      parts,
      bounds: this.calculateBounds(parts),
      metadata: {
        isLandmark: true,
        landmarkName: name,
        simplified: true,
        partCount: parts.length
      }
    };
  }

  /**
   * Generate pyramid simplified geometry
   */
  generatePyramidGeometry(width, height, depth, materials) {
    const parts = [];
    
    // Single pyramid shape
    parts.push({
      id: 'pyramid_main',
      name: 'Pyramid',
      type: 'pyramid',
      componentType: 'landmark_structure',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: materials?.[0] || 'stone',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'pyramid'
      }
    });
    
    console.log(`✅ Generated Pyramid with 1 unified part`);
    
    return {
      type: 'composite',
      parts,
      bounds: this.calculateBounds(parts),
      metadata: {
        isLandmark: true,
        landmarkName: 'Pyramid',
        simplified: true,
        partCount: 1
      }
    };
  }

  /**
   * Generate dome structure simplified geometry (Taj Mahal, etc.)
   */
  generateDomeStructureGeometry(width, height, depth, materials) {
    const parts = [];
    
    // Base structure
    const baseHeight = height * 0.5;
    parts.push({
      id: 'dome_base',
      name: 'Base Structure',
      type: 'box',
      componentType: 'landmark_base',
      dimensions: { x: width, y: baseHeight, z: depth },
      position: { x: 0, y: baseHeight / 2, z: 0 },
      material: materials?.[0] || 'marble',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'base'
      }
    });
    
    // Dome (sphere on top)
    const domeHeight = height * 0.4;
    const domeRadius = Math.min(width, depth) * 0.4;
    parts.push({
      id: 'dome_main',
      name: 'Dome',
      type: 'sphere',
      componentType: 'landmark_dome',
      dimensions: { x: domeRadius * 2, y: domeHeight, z: domeRadius * 2 },
      position: { x: 0, y: baseHeight + (domeHeight / 2), z: 0 },
      material: materials?.[0] || 'marble',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'dome'
      }
    });
    
    // Spire on top
    const spireHeight = height * 0.1;
    parts.push({
      id: 'dome_spire',
      name: 'Spire',
      type: 'cone',
      componentType: 'landmark_spire',
      dimensions: { x: width * 0.1, y: spireHeight, z: depth * 0.1 },
      position: { x: 0, y: baseHeight + domeHeight + (spireHeight / 2), z: 0 },
      material: materials?.[0] || 'gold',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'spire'
      }
    });
    
    console.log(`✅ Generated Dome Structure with ${parts.length} unified parts`);
    
    return {
      type: 'composite',
      parts,
      bounds: this.calculateBounds(parts),
      metadata: {
        isLandmark: true,
        landmarkName: 'Dome Structure',
        simplified: true,
        partCount: parts.length
      }
    };
  }

  /**
   * Generate simple tower geometry (default for unknown landmarks)
   */
  generateSimpleTowerGeometry(width, height, depth, materials, name) {
    const parts = [];
    
    // Single unified tower structure
    parts.push({
      id: 'tower_main',
      name: `${name} - Tower`,
      type: 'box',
      componentType: 'landmark_structure',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: materials?.[0] || 'concrete',
      metadata: {
        editable: false,
        locked: true,
        aiGenerated: true,
        isLandmark: true,
        landmarkPart: 'main_structure'
      }
    });
    
    console.log(`✅ Generated ${name} with simplified tower geometry (1 part instead of 200+)`);
    
    return {
      type: 'composite',
      parts,
      bounds: this.calculateBounds(parts),
      metadata: {
        isLandmark: true,
        landmarkName: name,
        simplified: true,
        partCount: 1
      }
    };
  }

  /**
   * Calculate bounds for parts array
   */
  calculateBounds(parts) {
    if (!parts || parts.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 } };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    parts.forEach(part => {
      const pos = part.position || { x: 0, y: 0, z: 0 };
      const dim = part.dimensions || { x: 0, y: 0, z: 0 };

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
