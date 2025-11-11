const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || 'demo-mode';
    this.isDemoMode = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'demo-mode';
    
    if (!this.isDemoMode) {
      this.client = new GoogleGenerativeAI(apiKey);
      this.model = this.client.getGenerativeModel({ model: 'gemini-pro' });
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
Your task is to interpret user prompts and generate structured design specifications including:
- Object type (car, building, furniture, etc.)
- Key dimensions and measurements
- Materials and textures
- Design style and aesthetic
- Functional requirements
Respond in JSON format with these fields.`;

      const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;
      
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const content = response.text();
      
      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return this.generateDemoResponse(prompt);
    }
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Remove markdown code blocks if present
      let cleanedContent = content.trim();
      
      // Check for markdown code blocks with json
      if (cleanedContent.startsWith('```json')) {
        cleanedContent = cleanedContent.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
      } else if (cleanedContent.startsWith('```')) {
        // Handle generic code blocks
        cleanedContent = cleanedContent.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
      }
      
      // Try to parse as JSON
      return JSON.parse(cleanedContent);
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
