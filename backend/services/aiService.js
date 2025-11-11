const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.isDemoMode = !this.apiKey || this.apiKey === 'demo-mode';
    
    if (!this.isDemoMode) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro' 
      });
    }
  }

  /**
   * Validate API key on startup
   */
  async validateApiKey() {
    if (this.isDemoMode) {
      console.log('⚠️  Running in DEMO mode - using pre-configured responses');
      return true;
    }

    try {
      // Test API key with a simple request
      const result = await this.model.generateContent('Hello');
      const response = await result.response;
      console.log('✓ Gemini API key validated successfully');
      return true;
    } catch (error) {
      console.error('✗ Gemini API key validation failed:', error.message);
      console.warn('⚠️  Falling back to DEMO mode');
      this.isDemoMode = true; // Fallback to demo mode
      return false;
    }
  }

  /**
   * Process natural language prompt to generate design specifications
   */
  async processPrompt(prompt, retries = 3) {
    if (this.isDemoMode) {
      return this.generateDemoResponse(prompt);
    }

    const systemPrompt = `You are an expert AI design assistant for ArchDisc, a platform that helps users create 3D designs from natural language. 
Your task is to interpret user prompts and generate structured design specifications.
Respond ONLY with valid JSON (no markdown, no code blocks) with these exact fields:
{
  "objectType": "car|building|furniture|object",
  "description": "detailed description",
  "dimensions": {"length": number, "width": number, "height": number},
  "materials": ["material1", "material2"],
  "style": "modern|contemporary|futuristic|minimalist",
  "features": ["feature1", "feature2"]
}`;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await Promise.race([
          this.model.generateContent(`${systemPrompt}\n\nUser prompt: ${prompt}`),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 30000)
          )
        ]);

        const response = await result.response;
        const content = response.text();
        return this.parseAIResponse(content);
      } catch (error) {
        console.error(`Error calling Gemini API (attempt ${attempt + 1}/${retries}):`, error.message);
        
        if (attempt === retries - 1) {
          // Last attempt failed, fall back to demo mode
          console.warn('All retries exhausted, falling back to demo response');
          return this.generateDemoResponse(prompt);
        }
        
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  /**
   * Generate 3 design proposal variations
   */
  async generateProposals(prompt, retries = 3) {
    if (this.isDemoMode) {
      return this.generateDemoProposals(prompt);
    }

    const systemPrompt = `You are an expert AI design assistant for ArchDisc. Generate 3 DIFFERENT design variations for the user's prompt.
Each variation should be distinctly different in style, materials, or approach.
Respond ONLY with valid JSON (no markdown, no code blocks) in this exact format:
{
  "proposals": [
    {
      "id": 1,
      "title": "Variation 1 Name",
      "objectType": "type",
      "description": "description",
      "dimensions": {"length": number, "width": number, "height": number},
      "materials": ["material1"],
      "style": "style1",
      "features": ["feature1"]
    },
    {
      "id": 2,
      "title": "Variation 2 Name",
      "objectType": "type",
      "description": "description",
      "dimensions": {"length": number, "width": number, "height": number},
      "materials": ["material2"],
      "style": "style2",
      "features": ["feature2"]
    },
    {
      "id": 3,
      "title": "Variation 3 Name",
      "objectType": "type",
      "description": "description",
      "dimensions": {"length": number, "width": number, "height": number},
      "materials": ["material3"],
      "style": "style3",
      "features": ["feature3"]
    }
  ]
}`;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await Promise.race([
          this.model.generateContent(`${systemPrompt}\n\nUser prompt: ${prompt}`),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 30000)
          )
        ]);

        const response = await result.response;
        const content = response.text();
        return this.parseProposalsResponse(content);
      } catch (error) {
        console.error(`Error generating proposals (attempt ${attempt + 1}/${retries}):`, error.message);
        
        if (attempt === retries - 1) {
          console.warn('All retries exhausted, falling back to demo proposals');
          return this.generateDemoProposals(prompt);
        }
        
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Clean up markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\n?/g, '');
      }
      
      const parsed = JSON.parse(cleanContent);
      
      // Ensure required fields exist
      return {
        objectType: parsed.objectType || 'object',
        description: parsed.description || 'Design specification',
        dimensions: parsed.dimensions || { width: 10, height: 10, depth: 10 },
        materials: parsed.materials || ['default'],
        style: parsed.style || 'modern',
        features: parsed.features || [],
      };
    } catch (e) {
      console.error('Error parsing AI response:', e.message);
      // If not JSON, extract information from text
      return {
        objectType: this.extractObjectType(content),
        description: content,
        dimensions: { width: 10, height: 10, depth: 10 },
        materials: ['default'],
        style: 'modern',
        features: [],
      };
    }
  }

  /**
   * Parse proposals response
   */
  parseProposalsResponse(content) {
    try {
      // Clean up markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\n?/g, '');
      }
      
      const parsed = JSON.parse(cleanContent);
      
      if (!parsed.proposals || !Array.isArray(parsed.proposals)) {
        throw new Error('Invalid proposals format');
      }
      
      return parsed;
    } catch (e) {
      console.error('Error parsing proposals response:', e.message);
      throw new Error('Failed to parse proposals response');
    }
  }

  /**
   * Generate demo response for testing without API key
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
   * Generate demo proposals
   */
  generateDemoProposals(prompt) {
    const objectType = this.extractObjectType(prompt);
    
    const proposals = {
      car: {
        proposals: [
          {
            id: 1,
            title: 'Luxury Electric Sedan',
            objectType: 'car',
            description: 'High-end electric sedan with premium materials and advanced technology',
            dimensions: { length: 5000, width: 1900, height: 1450 },
            materials: ['carbon fiber', 'leather', 'aluminum', 'glass'],
            style: 'luxury',
            features: ['autonomous driving', 'premium sound system', 'heated seats', 'panoramic roof'],
          },
          {
            id: 2,
            title: 'Sport Performance Coupe',
            objectType: 'car',
            description: 'Aerodynamic sports coupe focused on performance and handling',
            dimensions: { length: 4300, width: 1850, height: 1300 },
            materials: ['carbon fiber', 'titanium', 'alcantara'],
            style: 'sporty',
            features: ['turbo engine', 'carbon ceramic brakes', 'active suspension', 'rear spoiler'],
          },
          {
            id: 3,
            title: 'Eco-Friendly Hybrid',
            objectType: 'car',
            description: 'Environmentally conscious hybrid with sustainable materials',
            dimensions: { length: 4400, width: 1800, height: 1500 },
            materials: ['recycled aluminum', 'bamboo', 'hemp fiber', 'recycled glass'],
            style: 'eco-friendly',
            features: ['hybrid powertrain', 'solar roof panels', 'regenerative braking', 'eco mode'],
          },
        ],
      },
      building: {
        proposals: [
          {
            id: 1,
            title: 'Modern Glass Tower',
            objectType: 'building',
            description: 'Contemporary high-rise with floor-to-ceiling glass facade',
            dimensions: { length: 40000, width: 25000, height: 80000 },
            materials: ['steel', 'glass', 'concrete', 'marble'],
            style: 'modern',
            features: ['smart building systems', 'rooftop garden', 'LEED certified', 'underground parking'],
          },
          {
            id: 2,
            title: 'Sustainable Green Building',
            objectType: 'building',
            description: 'Eco-friendly structure with living walls and natural ventilation',
            dimensions: { length: 35000, width: 22000, height: 45000 },
            materials: ['reclaimed wood', 'recycled steel', 'green concrete', 'living plants'],
            style: 'sustainable',
            features: ['vertical gardens', 'rainwater harvesting', 'solar panels', 'natural lighting'],
          },
          {
            id: 3,
            title: 'Industrial Loft Complex',
            objectType: 'building',
            description: 'Converted warehouse with exposed structure and open spaces',
            dimensions: { length: 50000, width: 30000, height: 25000 },
            materials: ['exposed brick', 'steel beams', 'polished concrete', 'reclaimed wood'],
            style: 'industrial',
            features: ['open floor plans', 'mezzanine levels', 'large windows', 'exposed utilities'],
          },
        ],
      },
      furniture: {
        proposals: [
          {
            id: 1,
            title: 'Executive Leather Chair',
            objectType: 'furniture',
            description: 'Premium leather office chair with advanced ergonomics',
            dimensions: { width: 700, height: 1300, depth: 700 },
            materials: ['genuine leather', 'steel', 'memory foam'],
            style: 'executive',
            features: ['adjustable lumbar', '4D armrests', 'tilt mechanism', 'headrest'],
          },
          {
            id: 2,
            title: 'Mesh Gaming Chair',
            objectType: 'furniture',
            description: 'High-performance gaming chair with breathable mesh',
            dimensions: { width: 680, height: 1250, depth: 680 },
            materials: ['breathable mesh', 'aluminum', 'high-density foam'],
            style: 'gaming',
            features: ['full recline', 'RGB lighting', 'cooling gel pads', 'racing design'],
          },
          {
            id: 3,
            title: 'Minimalist Work Stool',
            objectType: 'furniture',
            description: 'Simple and elegant work stool for modern spaces',
            dimensions: { width: 450, height: 800, depth: 450 },
            materials: ['molded plywood', 'powder-coated steel'],
            style: 'minimalist',
            features: ['height adjustable', 'swivel base', 'footrest ring', 'compact design'],
          },
        ],
      },
    };

    return proposals[objectType] || proposals.furniture;
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
    const { objectType, dimensions, materials } = specifications;

    // Generate basic geometric primitives based on object type
    const geometry = this.generateGeometry(objectType, dimensions);
    
    return {
      geometry,
      materials: materials || ['default'],
      metadata: specifications,
    };
  }

  /**
   * Generate basic geometry for different object types
   */
  generateGeometry(objectType, dimensions) {
    switch (objectType) {
      case 'car':
        return {
          type: 'composite',
          parts: [
            { type: 'box', dimensions: { x: dimensions.length * 0.8, y: dimensions.height * 0.5, z: dimensions.width }, position: { x: 0, y: 0, z: 0 } },
            { type: 'box', dimensions: { x: dimensions.length * 0.4, y: dimensions.height * 0.3, z: dimensions.width * 0.9 }, position: { x: dimensions.length * 0.1, y: dimensions.height * 0.5, z: 0 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: dimensions.length * 0.3, y: -dimensions.height * 0.3, z: dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: dimensions.length * 0.3, y: -dimensions.height * 0.3, z: -dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: -dimensions.length * 0.3, y: -dimensions.height * 0.3, z: dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: -dimensions.length * 0.3, y: -dimensions.height * 0.3, z: -dimensions.width * 0.4 } },
          ],
        };
      case 'building':
        return {
          type: 'composite',
          parts: [
            { type: 'box', dimensions: { x: dimensions.length, y: dimensions.height, z: dimensions.width }, position: { x: 0, y: dimensions.height / 2, z: 0 } },
          ],
        };
      case 'furniture':
        return {
          type: 'composite',
          parts: [
            { type: 'box', dimensions: { x: dimensions.width, y: dimensions.height * 0.1, z: dimensions.depth }, position: { x: 0, y: dimensions.height * 0.5, z: 0 } },
            { type: 'cylinder', radius: dimensions.width * 0.05, height: dimensions.height * 0.4, position: { x: 0, y: 0, z: 0 } },
          ],
        };
      default:
        return {
          type: 'box',
          dimensions: { x: dimensions.width || 10, y: dimensions.height || 10, z: dimensions.depth || 10 },
        };
    }
  }
}

module.exports = new AIService();
