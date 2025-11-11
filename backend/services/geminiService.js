const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || 'demo-mode';
    this.isDemoMode = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'demo-mode';
    
    if (!this.isDemoMode) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
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
      const systemPrompt = `You are an expert AI design assistant for ArchDisc, a platform that helps users create 3D architectural and product designs from natural language. 
Your task is to interpret user prompts and generate structured design specifications including:
- Object type (car, building, furniture, etc.)
- Key dimensions and measurements in millimeters
- Materials and textures
- Design style and aesthetic
- Functional requirements and features

Respond ONLY with valid JSON in this exact format:
{
  "objectType": "string (car|building|furniture|object)",
  "description": "string",
  "dimensions": {
    "length": number,
    "width": number,
    "height": number
  },
  "materials": ["string"],
  "style": "string",
  "features": ["string"]
}`;

      const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;
      
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();
      
      return this.parseAIResponse(text);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return this.generateDemoResponse(prompt);
    }
  }

  /**
   * Generate multiple design proposals (for ArchPro feature)
   */
  async generateProposals(prompt, count = 3) {
    if (this.isDemoMode) {
      return this.generateDemoProposals(prompt, count);
    }

    try {
      const systemPrompt = `You are an expert AI design assistant for ArchDisc. Generate ${count} different creative design proposals based on the user's request.
Each design should be unique with different approaches, styles, or interpretations.

Respond ONLY with valid JSON in this exact format:
{
  "proposals": [
    {
      "name": "Proposal name",
      "objectType": "string (car|building|furniture|object)",
      "description": "string",
      "dimensions": {
        "length": number,
        "width": number,
        "height": number
      },
      "materials": ["string"],
      "style": "string",
      "features": ["string"]
    }
  ]
}`;

      const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;
      
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();
      
      const parsed = this.parseAIResponse(text);
      return parsed.proposals || [parsed];
    } catch (error) {
      console.error('Error calling Gemini API for proposals:', error);
      return this.generateDemoProposals(prompt, count);
    }
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Remove markdown code blocks if present
      let cleaned = content.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
      }
      
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      // If not JSON, extract information from text
      return {
        objectType: this.extractObjectType(content),
        description: content,
        dimensions: { length: 1000, width: 1000, height: 1000 },
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
   * Generate demo proposals for ArchPro feature
   */
  generateDemoProposals(prompt, count = 3) {
    const objectType = this.extractObjectType(prompt);
    const baseResponse = this.generateDemoResponse(prompt);
    
    const proposals = [];
    const styles = ['modern', 'minimalist', 'futuristic', 'industrial', 'organic'];
    
    for (let i = 0; i < count; i++) {
      proposals.push({
        name: `Proposal ${i + 1}: ${styles[i % styles.length]} design`,
        ...baseResponse,
        style: styles[i % styles.length],
        description: `${styles[i % styles.length]} variation: ${baseResponse.description}`,
        dimensions: {
          ...baseResponse.dimensions,
          length: baseResponse.dimensions.length * (0.9 + i * 0.1),
          width: baseResponse.dimensions.width * (0.9 + i * 0.1),
          height: baseResponse.dimensions.height * (0.9 + i * 0.1),
        },
      });
    }
    
    return proposals;
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
            { type: 'box', dimensions: { x: dimensions.width, y: dimensions.height * 0.1, z: dimensions.depth || dimensions.width }, position: { x: 0, y: dimensions.height * 0.5, z: 0 } },
            { type: 'cylinder', radius: dimensions.width * 0.05, height: dimensions.height * 0.4, position: { x: 0, y: 0, z: 0 } },
          ],
        };
      default:
        return {
          type: 'box',
          dimensions: { x: dimensions.width || dimensions.length || 1000, y: dimensions.height || 1000, z: dimensions.depth || dimensions.width || dimensions.length || 1000 },
        };
    }
  }
}

module.exports = new GeminiService();
