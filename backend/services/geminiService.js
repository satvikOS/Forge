const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Gemini Service - Handles AI interactions with Google Gemini API
 * Provides robust error handling, retry logic, and fallback mechanisms
 */
class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.isDemoMode = !this.apiKey;
    
    console.log('\n=== 🔧 Gemini Service Initialization ===');
    console.log('📋 Configuration:');
    console.log('  - API Key present:', !!this.apiKey);
    console.log('  - API Key (first 20 chars):', this.apiKey ? this.apiKey.substring(0, 20) + '...' : 'NOT SET');
    console.log('  - Demo Mode:', this.isDemoMode);
    
    if (!this.isDemoMode) {
      try {
        console.log('  - Initializing GoogleGenerativeAI SDK...');
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        // Use stable Gemini model for better reliability
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
        this.modelName = 'gemini-pro';
        console.log('  - Model initialized:', this.modelName);
        console.log('  - SDK Version:', require('@google/generative-ai/package.json').version);
        console.log('✅ Gemini Service ready to make API requests');
      } catch (error) {
        console.error('❌ Failed to initialize Gemini API:', error);
        console.error('  - Error details:', error.message);
        this.isDemoMode = true;
        console.log('⚠️  Falling back to demo mode');
      }
    } else {
      console.log('⚠️  Running in DEMO MODE - no API key provided');
      console.log('  - Set GEMINI_API_KEY environment variable to enable API');
    }
    console.log('=== End Gemini Service Initialization ===\n');
    
    this.maxRetries = 3;
    this.retryDelay = 1000; // ms
  }

  /**
   * Validate API key
   */
  isConfigured() {
    return !this.isDemoMode && this.genAI && this.model;
  }

  /**
   * Test API connection with a simple request
   */
  async testConnection() {
    console.log('\n=== 🧪 Testing Gemini API Connection ===');
    
    if (this.isDemoMode) {
      console.log('❌ Cannot test - running in demo mode');
      console.log('  - Set GEMINI_API_KEY to test connection');
      return { success: false, error: 'Demo mode - no API key' };
    }
    
    try {
      console.log('📡 Sending test request to Gemini API...');
      console.log('  - Model:', this.modelName);
      console.log('  - API Key (first 20 chars):', this.apiKey.substring(0, 20) + '...');
      
      const testPrompt = 'Respond with just the word "connected" if you can read this.';
      const result = await this.model.generateContent(testPrompt);
      const response = await result.response;
      const text = response.text();
      
      console.log('✅ API Connection Successful!');
      console.log('  - Response received:', text.substring(0, 100));
      console.log('  - This confirms the API key is valid and working');
      console.log('=== End Connection Test ===\n');
      
      return { success: true, response: text };
    } catch (error) {
      console.error('❌ API Connection Failed!');
      console.error('  - Error:', error.message);
      console.error('  - Status:', error.status);
      console.error('  - Full error:', error);
      console.log('\n🔍 Troubleshooting:');
      console.log('  1. Check API key is valid in Google AI Studio');
      console.log('  2. Verify API key has Gemini API enabled');
      console.log('  3. Check quota limits in your Google Cloud project');
      console.log('  4. Ensure network connectivity');
      console.log('=== End Connection Test ===\n');
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate content with retry logic
   */
  async generateContent(prompt, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    console.log('\n=== 🤖 Gemini API Request ===');
    console.log('📋 Request details:', {
      promptLength: prompt?.length,
      maxRetries,
      model: this.modelName,
      configured: this.isConfigured(),
      demoMode: this.isDemoMode,
    });
    
    // Check if API is properly configured
    if (this.isDemoMode) {
      console.error('❌ CRITICAL: Cannot make API request - running in DEMO MODE');
      console.error('  - No GEMINI_API_KEY environment variable set');
      console.error('  - This is why no requests appear in Google Studio!');
      throw new Error('Gemini API not configured - no API key provided');
    }
    
    if (!this.model) {
      console.error('❌ CRITICAL: Gemini model not initialized');
      throw new Error('Gemini model not initialized');
    }
    
    console.log('✅ API configured - proceeding with request');
    console.log('📡 Making API call to Google Gemini...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`⏳ Attempt ${attempt}/${maxRetries} - Calling Gemini API...`);
        console.log('  - Request timestamp:', new Date().toISOString());
        console.log('  - API endpoint: generativelanguage.googleapis.com');
        console.log('  - Model:', this.modelName);
        
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ Success on attempt ${attempt}!`);
        console.log('📊 Response details:');
        console.log('  - Response length:', text?.length);
        console.log('  - Response timestamp:', new Date().toISOString());
        console.log('  - First 100 chars:', text?.substring(0, 100));
        console.log('=== End Gemini API Request (SUCCESS) ===\n');
        
        return text;
      } catch (error) {
        lastError = error;
        console.error(`❌ Gemini API error (attempt ${attempt}/${maxRetries}):`, {
          message: error.message,
          status: error.status,
          statusText: error.statusText,
          code: error.code,
          details: error.details,
        });
        
        // Log the full error for debugging
        console.error('  - Full error object:', JSON.stringify(error, null, 2));
        
        // Don't retry on certain errors
        if (error.message?.includes('API key') || error.message?.includes('quota')) {
          console.error('🚫 Non-retryable error detected, throwing immediately');
          console.error('  - This means the API key is invalid or quota exceeded');
          throw error;
        }
        
        if (attempt < maxRetries) {
          const delayMs = this.retryDelay * attempt;
          console.log(`⏸️  Waiting ${delayMs}ms before retry...`);
          await this.delay(delayMs);
        }
      }
    }

    console.error('=== End Gemini API Request (FAILED) ===\n');
    console.error('⚠️  All retry attempts exhausted');
    console.error('  - Last error:', lastError?.message);
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Analyze a design prompt and extract structured information
   */
  async analyzePrompt(prompt) {
    const systemPrompt = `You are an expert AI assistant for ArchDisc, a 3D architectural design platform.
Analyze the user's design request and extract comprehensive 3D architectural information including wireframe, rig, geometry, environment, LOD, and PBR material specifications.

Return a JSON object with the following structure:
{
  "objectCount": <number of objects to generate>,
  "objectTypes": [<array of object types>],
  "scene": {
    "type": "<single_object|multiple_objects|environment|building|structure>",
    "complexity": "<low|medium|high|very_high>",
    "style": "<modern|industrial|futuristic|classical|minimalist|etc>",
    "environment": {
      "context": "<urban|rural|studio|interior|exterior>",
      "lighting": {
        "hdri": "<dawn|midday|sunset|night|studio>",
        "keyLights": [{"type": "<sun|spot|area>", "intensity": <0-1>, "color": "<hex>", "position": [x, y, z]}],
        "ambient": {"intensity": <0-1>, "color": "<hex>"}
      },
      "atmosphere": "<clear|foggy|rainy|cloudy|night>"
    }
  },
  "elements": [
    {
      "type": "<building|structure|prop|detail|terrain|vehicle|furniture|etc>",
      "name": "<descriptive name>",
      "quantity": <number>,
      "dimensions": {"width": <number>, "height": <number>, "depth": <number>},
      "materials": [<array of materials>],
      "details": [<array of detail requirements>],
      "wireframe": {
        "controlVertices": [{"id": <number>, "position": [x, y, z], "type": "<corner|edge|center|control>"}],
        "edges": [{"from": <vertex_id>, "to": <vertex_id>, "type": "<structural|decorative>"}],
        "structuralSkeleton": [{"name": "<element_name>", "vertices": [<vertex_ids>], "purpose": "<support|shape|detail>"}]
      },
      "geometry": {
        "meshTopology": {
          "vertexCount": <estimated_count>,
          "faceCount": <estimated_count>,
          "complexity": "<low|medium|high|very_high>"
        },
        "uvMapping": {
          "channels": <number>,
          "projection": "<planar|cylindrical|spherical|box|unwrap>"
        },
        "subdivisionLevels": <0-4>
      },
      "lod": {
        "720p": {"vertexReduction": 0.25, "simplify": true, "subdivisionLevel": 0},
        "1080p": {"vertexReduction": 0.5, "simplify": false, "subdivisionLevel": 1},
        "4K": {"vertexReduction": 0.75, "simplify": false, "subdivisionLevel": 2},
        "8K": {"vertexReduction": 1.0, "simplify": false, "subdivisionLevel": 3}
      },
      "pbr": {
        "baseColor": "<hex_or_texture>",
        "metallic": <0-1>,
        "roughness": <0-1>,
        "normalMap": "<optional_texture_name>",
        "aoMap": "<optional_texture_name>",
        "emissive": "<hex_color>",
        "emissiveIntensity": <0-10>
      }
    }
  ],
  "requirements": {
    "detailLevel": "<low|medium|high|very_high>",
    "materials": [<array of required materials>],
    "features": [<array of special features>],
    "targetResolution": "<720p|1080p|4K|8K>",
    "renderingQuality": "<low|medium|high|ultra>"
  }
}

User prompt: ${prompt}`;

    try {
      const response = await this.generateContent(systemPrompt);
      if (response) {
        return this.parseStructuredResponse(response);
      }
    } catch (error) {
      console.error('Error analyzing prompt with Gemini:', error);
    }

    return null;
  }

  /**
   * Parse structured response from Gemini
   */
  parseStructuredResponse(text) {
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : text;
      const parsed = JSON.parse(jsonText);
      
      // Validate 3D geometry data if present
      if (parsed.elements || parsed.wireframe || parsed.geometry) {
        this.validate3DGeometryData(parsed);
      }
      
      return parsed;
    } catch (error) {
      console.error('Failed to parse Gemini response as JSON:', error);
      return null;
    }
  }

  /**
   * Validate 3D geometry data structure
   */
  validate3DGeometryData(data) {
    console.log('🔍 Validating 3D geometry data...');
    
    // Validate elements if present
    if (data.elements && Array.isArray(data.elements)) {
      data.elements.forEach((element, index) => {
        // Validate wireframe data
        if (element.wireframe) {
          if (!element.wireframe.controlVertices || !Array.isArray(element.wireframe.controlVertices)) {
            console.warn(`⚠️  Element ${index}: Missing or invalid wireframe.controlVertices`);
          }
          if (!element.wireframe.edges || !Array.isArray(element.wireframe.edges)) {
            console.warn(`⚠️  Element ${index}: Missing or invalid wireframe.edges`);
          }
        }
        
        // Validate geometry data
        if (element.geometry) {
          if (!element.geometry.meshTopology) {
            console.warn(`⚠️  Element ${index}: Missing geometry.meshTopology`);
          }
          if (!element.geometry.uvMapping) {
            console.warn(`⚠️  Element ${index}: Missing geometry.uvMapping`);
          }
        }
        
        // Validate LOD data
        if (element.lod) {
          const requiredLODs = ['720p', '1080p', '4K', '8K'];
          const missingLODs = requiredLODs.filter(lod => !element.lod[lod]);
          if (missingLODs.length > 0) {
            console.warn(`⚠️  Element ${index}: Missing LOD levels: ${missingLODs.join(', ')}`);
          }
        }
        
        // Validate PBR materials
        if (element.pbr) {
          const requiredPBRFields = ['baseColor', 'metallic', 'roughness'];
          const missingPBR = requiredPBRFields.filter(field => element.pbr[field] === undefined);
          if (missingPBR.length > 0) {
            console.warn(`⚠️  Element ${index}: Missing PBR fields: ${missingPBR.join(', ')}`);
          }
        }
      });
    }
    
    // Validate top-level wireframe data
    if (data.wireframe) {
      if (!data.wireframe.controlVertices || !Array.isArray(data.wireframe.controlVertices)) {
        console.warn('⚠️  Missing or invalid top-level wireframe.controlVertices');
      }
      if (!data.wireframe.edges || !Array.isArray(data.wireframe.edges)) {
        console.warn('⚠️  Missing or invalid top-level wireframe.edges');
      }
    }
    
    // Validate scene environment
    if (data.sceneEnvironment) {
      if (!data.sceneEnvironment.lighting) {
        console.warn('⚠️  Missing sceneEnvironment.lighting');
      }
      if (!data.sceneEnvironment.context) {
        console.warn('⚠️  Missing sceneEnvironment.context');
      }
    }
    
    console.log('✅ 3D geometry data validation complete');
  }

  /**
   * Generate design specifications from prompt
   */
  async generateDesignSpecs(prompt) {
    const systemPrompt = `You are an expert 3D design assistant for ArchDisc.
Generate comprehensive 3D architectural design specifications for the following request, including wireframe/rig data, detailed geometry, scene environment, LOD specifications, and PBR materials.

Provide specifications in JSON format:
{
  "objectType": "<car|building|furniture|structure|environment|etc>",
  "name": "<descriptive name>",
  "description": "<detailed description>",
  "dimensions": {"width": <mm>, "height": <mm>, "depth": <mm>},
  "materials": [<array of materials: metal, concrete, glass, plastic, wood, etc>],
  "style": "<design style>",
  "features": [<array of key features>],
  "colors": [<array of colors>],
  "details": {
    "structural": "<structural details>",
    "aesthetic": "<aesthetic details>",
    "functional": "<functional details>"
  },
  "wireframe": {
    "controlVertices": [{"id": <number>, "position": [x, y, z], "type": "<corner|edge|center|control>"}],
    "edges": [{"from": <vertex_id>, "to": <vertex_id>, "type": "<structural|decorative>"}],
    "structuralSkeleton": [{"name": "<element_name>", "vertices": [<vertex_ids>], "purpose": "<support|shape|detail>"}],
    "pivotPoints": [{"name": "<name>", "position": [x, y, z], "parent": "<parent_name|null>"}],
    "transformHierarchy": [{"name": "<name>", "parent": "<parent_name|null>", "children": [<child_names>]}]
  },
  "geometry": {
    "meshTopology": {
      "vertices": <estimated_vertex_count>,
      "faces": <estimated_face_count>,
      "normals": "<smooth|flat|auto>",
      "complexity": "<low|medium|high|very_high>"
    },
    "uvMapping": {
      "channels": <1-4>,
      "projection": "<planar|cylindrical|spherical|box|unwrap>",
      "tiling": [<u_tiles>, <v_tiles>]
    },
    "subdivisionSurface": {
      "levels": <0-4>,
      "algorithm": "<catmull-clark|loop|simple>"
    }
  },
  "sceneEnvironment": {
    "context": "<urban|rural|studio|interior|exterior>",
    "lighting": {
      "hdri": "<dawn|midday|sunset|night|studio>",
      "keyLights": [
        {
          "type": "<sun|spot|area|point>",
          "intensity": <0-10>,
          "color": "<hex_color>",
          "position": [x, y, z],
          "target": [x, y, z],
          "castShadow": <true|false>
        }
      ],
      "ambient": {
        "intensity": <0-1>,
        "color": "<hex_color>"
      }
    },
    "atmosphere": "<clear|foggy|rainy|cloudy|night>",
    "renderingContext": "<architectural_visualization|product_render|game_asset|vr_ready>"
  },
  "lod": {
    "720p": {
      "vertexReduction": 0.25,
      "simplifyGeometry": true,
      "subdivisionLevel": 0,
      "textureResolution": 1024
    },
    "1080p": {
      "vertexReduction": 0.5,
      "simplifyGeometry": false,
      "subdivisionLevel": 1,
      "textureResolution": 2048
    },
    "4K": {
      "vertexReduction": 0.75,
      "simplifyGeometry": false,
      "subdivisionLevel": 2,
      "textureResolution": 4096
    },
    "8K": {
      "vertexReduction": 1.0,
      "simplifyGeometry": false,
      "subdivisionLevel": 3,
      "textureResolution": 8192
    }
  },
  "pbr": {
    "baseColor": "<hex_color_or_texture>",
    "metallic": <0-1>,
    "roughness": <0-1>,
    "normalMap": "<texture_name_or_null>",
    "aoMap": "<texture_name_or_null>",
    "displacementMap": "<texture_name_or_null>",
    "emissive": "<hex_color>",
    "emissiveIntensity": <0-10>,
    "opacity": <0-1>,
    "clearcoat": <0-1>,
    "clearcoatRoughness": <0-1>
  },
  "shaderParameters": {
    "renderMode": "<realistic|stylized|technical|artistic>",
    "materialType": "<standard|architectural|glass|metal|wood|concrete>",
    "detailLevel": "<low|medium|high|ultra>"
  }
}

User request: ${prompt}`;

    try {
      const response = await this.generateContent(systemPrompt);
      if (response) {
        return this.parseStructuredResponse(response);
      }
    } catch (error) {
      console.error('Error generating design specs with Gemini:', error);
    }

    return null;
  }

  /**
   * Delay helper for retry logic
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      mode: this.isDemoMode ? 'demo' : 'active',
      model: this.isDemoMode ? null : this.modelName || 'gemini-pro',
    };
  }
}

module.exports = new GeminiService();
