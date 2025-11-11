const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
  constructor() {
    // Initialize Gemini API client
    this.apiKey = process.env.GEMINI_API_KEY || 'demo-mode';
    this.isDemoMode = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'demo-mode';
    
    if (!this.isDemoMode) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      // Use the latest and most capable Gemini model
      this.model = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          topP: 0.95,
          topK: 40,
        },
      });
    }
  }

  /**
   * Process natural language prompt to generate design specifications
   */
  async processPrompt(prompt) {
    if (this.isDemoMode) {
      return this.generateDemoResponse(prompt);
    }

    try {
      const systemPrompt = `You are an expert AI design assistant for ArchDisc, a platform that helps users create 3D designs from natural language. 
Your task is to interpret user prompts and generate structured design specifications.

IMPORTANT: You must respond with ONLY valid JSON in this exact format (no markdown, no code blocks, no additional text):
{
  "objectType": "car|building|furniture|object",
  "description": "detailed description of the design",
  "dimensions": {
    "length": number,
    "width": number,
    "height": number,
    "depth": number
  },
  "materials": ["material1", "material2"],
  "style": "design style",
  "features": ["feature1", "feature2"]
}

User prompt: ${prompt}

Respond with JSON only:`;

      const result = await this.model.generateContent(systemPrompt);
      const response = await result.response;
      const content = response.text();
      
      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      // Fallback to demo mode on error
      return this.generateDemoResponse(prompt);
    }
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\n?/g, '');
      }
      
      // Try to parse as JSON
      const parsed = JSON.parse(cleanContent.trim());
      
      // Ensure all required fields are present
      return {
        objectType: parsed.objectType || this.extractObjectType(content),
        description: parsed.description || 'AI-generated design',
        dimensions: parsed.dimensions || { width: 10, height: 10, depth: 10 },
        materials: parsed.materials || ['default'],
        style: parsed.style || 'modern',
        features: parsed.features || [],
      };
    } catch (error) {
      console.warn('Failed to parse AI response as JSON:', error.message);
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
