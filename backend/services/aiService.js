const geminiService = require('./geminiService');
const geometryGenerator = require('./geometryGenerator');
const materialSystem = require('./materialSystem');

class AIService {
  constructor() {
    this.gemini = geminiService;
  }

  /**
   * Process natural language prompt to generate design specifications
   */
  async processPrompt(prompt) {
    console.log('\n=== 🎨 AI Service Processing Prompt ===');
    console.log('📝 Prompt:', prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''));
    
    // Try AI analysis first
    try {
      console.log('🔍 Attempting Gemini analyzePrompt...');
      const aiAnalysis = await this.gemini.analyzePrompt(prompt);
      if (aiAnalysis) {
        console.log('✅ AI analysis successful:', JSON.stringify(aiAnalysis, null, 2));
        const specs = this.convertAIAnalysisToSpecs(aiAnalysis);
        console.log('=== End AI Service Processing ===\n');
        return specs;
      }
      console.log('⚠️  AI analysis returned null, trying fallback...');
    } catch (error) {
      console.error('❌ Error with Gemini analyzePrompt:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    // Try design specs generation as fallback
    try {
      console.log('🔄 Falling back to generateDesignSpecs...');
      const designSpecs = await this.gemini.generateDesignSpecs(prompt);
      if (designSpecs) {
        console.log('✅ Design specs generation successful:', JSON.stringify(designSpecs, null, 2));
        console.log('=== End AI Service Processing ===\n');
        return designSpecs;
      }
      console.log('⚠️  Design specs generation returned null');
    } catch (error) {
      console.error('❌ Error with generateDesignSpecs:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    console.error('=== End AI Service Processing (FAILED) ===\n');
    throw new Error('Failed to generate design from AI. Both analyzePrompt and generateDesignSpecs failed. Please check API configuration and try again.');
  }
  
  /**
   * Convert AI analysis to design specifications
   */
  convertAIAnalysisToSpecs(analysis) {
    const firstElement = analysis.elements?.[0] || {};
    const scene = analysis.scene || {};
    
    // Extract any enhanced 3D data if provided by AI (optional)
    const wireframe = firstElement.wireframe || analysis.wireframe || null;
    const geometry = firstElement.geometry || analysis.geometry || null;
    const lod = firstElement.lod || analysis.lod || null;
    const pbr = firstElement.pbr || analysis.pbr || null;
    const sceneEnvironment = analysis.sceneEnvironment || scene.environment || null;
    const shaderParameters = analysis.shaderParameters || null;
    
    const specs = {
      objectType: firstElement.type || scene.type || 'object',
      objectCount: analysis.objectCount || 1,
      name: firstElement.name || 'Generated Object',
      description: `${scene.style || 'Modern'} ${firstElement.type || 'object'}`,
      dimensions: firstElement.dimensions || { width: 1000, height: 1000, depth: 1000 },
      materials: firstElement.materials || analysis.requirements?.materials || ['default'],
      style: scene.style || 'modern',
      features: analysis.requirements?.features || [],
      elements: analysis.elements || [],
      scene: scene,
      complexity: scene.complexity || 'medium',
      detailLevel: analysis.requirements?.detailLevel || 'medium',
      
      // Enhanced 3D data (optional, may be null)
      wireframe: wireframe,
      geometry: geometry,
      lod: lod,
      pbr: pbr,
      sceneEnvironment: sceneEnvironment,
      shaderParameters: shaderParameters,
      
      // Metadata for tracking
      has3DData: !!(wireframe || geometry || lod || pbr),
      targetResolution: analysis.requirements?.targetResolution || '1080p',
      renderingQuality: analysis.requirements?.renderingQuality || 'high',
    };
    
    // Generate enhanced 3D data if not provided by AI
    if (!specs.has3DData) {
      console.log('⚡ Generating enhanced 3D data programmatically...');
      this.addEnhanced3DData(specs);
    }
    
    return specs;
  }

  /**
   * Add enhanced 3D data programmatically when AI doesn't provide it
   */
  addEnhanced3DData(specs) {
    const { objectType, dimensions, materials, style } = specs;
    
    // Generate default LOD specifications
    specs.lod = {
      '720p': { vertexReduction: 0.25, simplifyGeometry: true, subdivisionLevel: 0, textureResolution: 1024 },
      '1080p': { vertexReduction: 0.5, simplifyGeometry: false, subdivisionLevel: 1, textureResolution: 2048 },
      '4K': { vertexReduction: 0.75, simplifyGeometry: false, subdivisionLevel: 2, textureResolution: 4096 },
      '8K': { vertexReduction: 1.0, simplifyGeometry: false, subdivisionLevel: 3, textureResolution: 8192 }
    };
    
    // Generate default PBR materials based on primary material
    const primaryMaterial = materials?.[0] || 'default';
    specs.pbr = this.getDefaultPBRForMaterial(primaryMaterial);
    
    // Generate default scene environment based on object type
    specs.sceneEnvironment = {
      context: objectType === 'building' || objectType === 'structure' ? 'urban' : 'studio',
      lighting: {
        hdri: 'midday',
        keyLights: [
          {
            type: 'sun',
            intensity: 5,
            color: '#ffffff',
            position: [100, 200, 100],
            castShadow: true
          }
        ],
        ambient: { intensity: 0.5, color: '#87ceeb' }
      },
      atmosphere: 'clear',
      renderingContext: objectType === 'building' ? 'architectural_visualization' : 'product_render'
    };
    
    // Generate basic wireframe structure
    const w = dimensions.width || 1000;
    const h = dimensions.height || 1000;
    const d = dimensions.depth || 1000;
    
    specs.wireframe = {
      controlVertices: [
        { id: 0, position: [-w/2, 0, -d/2], type: 'corner' },
        { id: 1, position: [w/2, 0, -d/2], type: 'corner' },
        { id: 2, position: [w/2, 0, d/2], type: 'corner' },
        { id: 3, position: [-w/2, 0, d/2], type: 'corner' },
        { id: 4, position: [-w/2, h, -d/2], type: 'corner' },
        { id: 5, position: [w/2, h, -d/2], type: 'corner' },
        { id: 6, position: [w/2, h, d/2], type: 'corner' },
        { id: 7, position: [-w/2, h, d/2], type: 'corner' }
      ],
      edges: [
        { from: 0, to: 1, type: 'structural' },
        { from: 1, to: 2, type: 'structural' },
        { from: 2, to: 3, type: 'structural' },
        { from: 3, to: 0, type: 'structural' },
        { from: 4, to: 5, type: 'structural' },
        { from: 5, to: 6, type: 'structural' },
        { from: 6, to: 7, type: 'structural' },
        { from: 7, to: 4, type: 'structural' },
        { from: 0, to: 4, type: 'structural' },
        { from: 1, to: 5, type: 'structural' },
        { from: 2, to: 6, type: 'structural' },
        { from: 3, to: 7, type: 'structural' }
      ],
      structuralSkeleton: [
        { name: 'main_frame', vertices: [0, 1, 2, 3, 4, 5, 6, 7], purpose: 'support' }
      ]
    };
    
    // Generate basic geometry specs
    specs.geometry = {
      meshTopology: {
        vertexCount: 8,
        faceCount: 6,
        complexity: specs.complexity || 'medium'
      },
      uvMapping: {
        channels: 1,
        projection: 'box'
      },
      subdivisionLevels: specs.complexity === 'high' || specs.complexity === 'very_high' ? 2 : 1
    };
    
    specs.has3DData = true;
    console.log('✅ Enhanced 3D data generated programmatically');
  }

  /**
   * Get default PBR properties for common materials
   */
  getDefaultPBRForMaterial(material) {
    const pbrDefaults = {
      glass: { baseColor: '#ffffff', metallic: 0.0, roughness: 0.1, opacity: 0.3, clearcoat: 1.0 },
      metal: { baseColor: '#808080', metallic: 0.9, roughness: 0.3, opacity: 1.0, clearcoat: 0.0 },
      steel: { baseColor: '#505050', metallic: 0.9, roughness: 0.4, opacity: 1.0, clearcoat: 0.0 },
      concrete: { baseColor: '#a0a0a0', metallic: 0.0, roughness: 0.9, opacity: 1.0, clearcoat: 0.0 },
      wood: { baseColor: '#8b5a3c', metallic: 0.0, roughness: 0.7, opacity: 1.0, clearcoat: 0.2 },
      plastic: { baseColor: '#ffffff', metallic: 0.0, roughness: 0.5, opacity: 1.0, clearcoat: 0.3 },
      default: { baseColor: '#808080', metallic: 0.5, roughness: 0.5, opacity: 1.0, clearcoat: 0.0 }
    };
    
    return pbrDefaults[material.toLowerCase()] || pbrDefaults.default;
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Try to parse as JSON
      return JSON.parse(content);
    } catch (e) {
      // If not JSON, extract information from text
      return {
        objectType: this.extractObjectType(content),
        description: content,
        dimensions: { width: 10, height: 10, depth: 10 },
        materials: ['default'],
        style: 'modern',
      };
    }
  }

  /**
   * Generate demo response for testing without API key
   * Emergency fallback only - should rarely be used
   */
  generateDemoResponse(prompt) {
    const objectType = this.extractObjectType(prompt);
    
    const responses = {
      car: {
        objectType: 'car',
        description: 'Modern electric sedan with aerodynamic design',
        dimensions: { length: 4500, width: 1850, height: 1450 },
        materials: ['aluminum', 'carbon fiber', 'glass'],
        style: 'futuristic',
        features: ['electric powertrain', 'autonomous driving', 'panoramic roof'],
      },
      building: {
        objectType: 'building',
        description: 'Contemporary office building with glass facade',
        dimensions: { length: 30000, width: 20000, height: 50000 },
        materials: ['concrete', 'steel', 'glass', 'wood'],
        style: 'contemporary',
        features: ['green roof', 'solar panels', 'open floor plan'],
      },
      furniture: {
        objectType: 'furniture',
        description: 'Ergonomic office chair with modern aesthetics',
        dimensions: { width: 650, height: 1200, depth: 650 },
        materials: ['mesh', 'aluminum', 'foam'],
        style: 'minimalist',
        features: ['adjustable height', 'lumbar support', 'swivel base'],
      },
    };

    return responses[objectType] || responses.furniture;
  }

  /**
   * Extract object type from prompt
   */
  extractObjectType(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes('car') || lower.includes('vehicle') || lower.includes('automobile')) {
      return 'car';
    }
    if (lower.includes('building') || lower.includes('house') || lower.includes('structure')) {
      return 'building';
    }
    if (lower.includes('chair') || lower.includes('desk') || lower.includes('furniture')) {
      return 'furniture';
    }
    return 'object';
  }

  /**
   * Generate 3D model data from specifications
   */
  async generateModelData(specifications) {
    const { objectType, dimensions, materials, elements, scene, objectCount, wireframe, geometry, lod, pbr, sceneEnvironment } = specifications;

    console.log('🏗️  Generating model data with enhanced 3D specifications...');
    
    // Log enhanced data availability
    if (wireframe) {
      console.log('✅ Wireframe data available:', {
        vertices: wireframe.controlVertices?.length || 0,
        edges: wireframe.edges?.length || 0,
        skeleton: wireframe.structuralSkeleton?.length || 0,
      });
    }
    
    if (lod) {
      console.log('✅ LOD specifications available:', Object.keys(lod));
    }
    
    if (sceneEnvironment) {
      console.log('✅ Scene environment data available:', {
        context: sceneEnvironment.context,
        lighting: sceneEnvironment.lighting?.hdri,
      });
    }

    // Create specification object for geometry generator
    const geometrySpec = {
      objectCount: objectCount || 1,
      elements: elements && elements.length > 0 ? elements : [
        {
          type: objectType || 'object',
          name: specifications.name || 'Object',
          dimensions: dimensions || { width: 1000, height: 1000, depth: 1000 },
          materials: materials || ['default'],
          details: specifications.features || [],
          wireframe: wireframe,
          geometry: geometry,
          lod: lod,
          pbr: pbr,
        }
      ],
      scene: scene || {},
      sceneEnvironment: sceneEnvironment,
    };

    // Generate geometry with enhanced 3D data
    const generatedGeometry = geometryGenerator.generateFromSpec(geometrySpec);
    
    // Apply wireframe data if available
    if (wireframe) {
      this.applyWireframeData(generatedGeometry, wireframe);
    }
    
    // Apply LOD specifications if available
    if (lod) {
      this.applyLODSpecs(generatedGeometry, lod);
    }
    
    // Apply scene environment if available
    if (sceneEnvironment) {
      this.applySceneEnvironment(generatedGeometry, sceneEnvironment);
    }
    
    // Apply PBR materials to geometry parts
    if (generatedGeometry.type === 'composite' && generatedGeometry.parts) {
      generatedGeometry.parts = generatedGeometry.parts.map((part, index) => {
        const partMaterial = part.material || materials?.[0] || 'default';
        const materializedPart = materialSystem.applyMaterial(part, partMaterial);
        
        // Apply PBR properties if available
        if (pbr) {
          materializedPart.pbr = pbr;
        }
        
        return materializedPart;
      });
    }
    
    return {
      geometry: generatedGeometry,
      materials: materials || ['default'],
      metadata: specifications,
      stats: this.calculateStats(generatedGeometry),
      wireframe: wireframe,
      lod: lod,
      sceneEnvironment: sceneEnvironment,
      pbr: pbr,
    };
  }
  
  /**
   * Apply wireframe data to geometry
   */
  applyWireframeData(geometry, wireframe) {
    console.log('🔗 Applying wireframe data to geometry...');
    
    if (!wireframe) return;
    
    geometry.wireframe = {
      controlVertices: wireframe.controlVertices || [],
      edges: wireframe.edges || [],
      structuralSkeleton: wireframe.structuralSkeleton || [],
      pivotPoints: wireframe.pivotPoints || [],
      transformHierarchy: wireframe.transformHierarchy || [],
    };
    
    console.log('✅ Wireframe data applied:', {
      vertices: geometry.wireframe.controlVertices.length,
      edges: geometry.wireframe.edges.length,
    });
  }
  
  /**
   * Apply LOD specifications to geometry
   */
  applyLODSpecs(geometry, lod) {
    console.log('📊 Applying LOD specifications...');
    
    if (!lod) return;
    
    geometry.lod = {
      levels: {},
    };
    
    // Process each LOD level
    Object.entries(lod).forEach(([resolution, specs]) => {
      geometry.lod.levels[resolution] = {
        vertexReduction: specs.vertexReduction || 1.0,
        simplifyGeometry: specs.simplifyGeometry !== undefined ? specs.simplifyGeometry : false,
        subdivisionLevel: specs.subdivisionLevel || 0,
        textureResolution: specs.textureResolution || 2048,
      };
    });
    
    console.log('✅ LOD specifications applied for resolutions:', Object.keys(geometry.lod.levels));
  }
  
  /**
   * Apply scene environment to geometry
   */
  applySceneEnvironment(geometry, environment) {
    console.log('🌍 Applying scene environment...');
    
    if (!environment) return;
    
    geometry.environment = {
      context: environment.context || 'studio',
      lighting: environment.lighting || {
        hdri: 'studio',
        ambient: { intensity: 0.5, color: '#ffffff' },
      },
      atmosphere: environment.atmosphere || 'clear',
      renderingContext: environment.renderingContext || 'architectural_visualization',
    };
    
    console.log('✅ Scene environment applied:', {
      context: geometry.environment.context,
      hdri: geometry.environment.lighting.hdri,
    });
  }
  
  /**
   * Calculate model statistics
   */
  calculateStats(geometry) {
    let partCount = 0;
    let totalVertices = 0;
    
    if (geometry.type === 'scene') {
      partCount = (geometry.meshes?.length || 0);
      if (geometry.instances) {
        geometry.instances.forEach(inst => {
          partCount += inst.count;
        });
      }
    } else if (geometry.type === 'composite') {
      partCount = geometry.parts?.length || 1;
    } else {
      partCount = 1;
    }
    
    // Rough estimate of vertices based on part count
    totalVertices = partCount * 24; // Average vertices per part
    
    return {
      partCount,
      estimatedVertices: totalVertices,
      estimatedFaces: totalVertices / 3,
    };
  }
}

module.exports = new AIService();
