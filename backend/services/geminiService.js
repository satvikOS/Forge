const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Gemini Service - Handles AI interactions with Google Gemini API
 * Provides robust error handling, retry logic, and fallback mechanisms
 */
class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.isDemoMode = !this.apiKey;
    
    if (!this.isDemoMode) {
      try {
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        // Use model from environment variable or default to gemini-2.5-pro (best for 3D design)
        this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
        
        // Configure API version based on model
        // Gemini 1.5 models require v1beta API, while 2.x models use stable v1 (default)
        const modelConfig = { model: this.modelName };
        const requestOptions = {};
        
        if (this.modelName.includes('1.5')) {
          // Gemini 1.5 models (like gemini-1.5-pro, gemini-1.5-flash) need beta API
          requestOptions.apiVersion = 'v1beta';
          console.log(`Using v1beta API for model: ${this.modelName}`);
        } else {
          console.log(`Using stable v1 API for model: ${this.modelName}`);
        }
        
        this.model = this.genAI.getGenerativeModel(modelConfig, requestOptions);
        console.log(`Gemini service initialized with model: ${this.modelName}`);
      } catch (error) {
        console.error('Failed to initialize Gemini API:', error);
        this.isDemoMode = true;
      }
    }
    
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
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`⏳ Attempt ${attempt}/${maxRetries} - Calling Gemini API...`);
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ Success on attempt ${attempt}!`);
        console.log('📊 Response length:', text?.length);
        console.log('=== End Gemini API Request ===\n');
        
        return text;
      } catch (error) {
        lastError = error;
        console.error(`❌ Gemini API error (attempt ${attempt}/${maxRetries}):`, {
          message: error.message,
          status: error.status,
          statusText: error.statusText,
          responseData: error.response?.data,
        });
        
        // Don't retry on certain errors
        if (error.message?.includes('API key') || error.message?.includes('quota')) {
          console.error('🚫 Non-retryable error detected, throwing immediately');
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
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Analyze a design prompt and extract structured information
   * Enhanced for complex architectural prompts with detailed features
   */
  async analyzePrompt(prompt) {
    const systemPrompt = `You are an expert AI assistant for ArchDisc, a professional 3D architectural design platform.
Analyze the user's design request and extract detailed structured information for 3D generation.

IMPORTANT: For architectural prompts, extract ALL specific details mentioned:
- Number of stories/floors
- Building types (office, retail, residential, etc.)
- Architectural features (curtain walls, atriums, gardens, etc.)
- Materials and facade details
- Structural elements (columns, beams, etc.)
- Windows, doors, balconies
- Special features (underground parking, rooftop elements, etc.)

For dimensions:
- Use realistic architectural scales (in millimeters)
- Standard floor height: 3000-4000mm per floor
- Typical building widths: 15000-50000mm
- Calculate total height: floors × floor_height

Return a JSON object with this structure:
{
  "objectCount": <total number of distinct building/structure elements>,
  "objectTypes": [<array of object types like "building", "structure", "landscape">],
  "scene": {
    "type": "<single_building|complex|campus|urban>",
    "complexity": "<low|medium|high|very_high>",
    "style": "<modern|contemporary|industrial|futuristic|classical|minimalist|brutalist|etc>",
    "scale": "<small|medium|large|massive>"
  },
  "elements": [
    {
      "type": "building",
      "name": "<descriptive name like 'Office Tower', 'Museum Wing'>",
      "quantity": <number if multiple similar buildings>,
      "dimensions": {
        "width": <number in mm>,
        "height": <number in mm, calculated as floors × floor_height>,
        "depth": <number in mm>
      },
      "floors": <number of stories>,
      "materials": [<"glass", "concrete", "metal", "stone", "brick", "wood">],
      "details": [
        <Include ALL mentioned features from the list:>
        "windows", "curtain_walls", "glass_facade",
        "doors", "entrances", "lobby",
        "balconies", "terraces", "outdoor_spaces",
        "roof_garden", "rooftop_terrace", "helipad",
        "columns", "structural_elements", "beams",
        "underground_parking", "basement_levels",
        "atrium", "courtyard", "plaza",
        "retail_ground_floor", "office_floors", "residential_units",
        "elevator_core", "stairwells",
        "mechanical_room", "utilities"
      ]
    }
  ],
  "requirements": {
    "detailLevel": "<high for complex buildings, very_high for landmark structures>",
    "materials": [<all materials mentioned>],
    "features": [<all special features and architectural elements mentioned>],
    "functionalSpaces": [<list of functional areas like "retail", "office", "parking">]
  }
}

EXAMPLES:

Prompt: "Create a 15-story contemporary office tower with glass curtain walls, ground floor retail, rooftop garden, and underground parking"
Response:
{
  "objectCount": 1,
  "objectTypes": ["building"],
  "scene": {
    "type": "single_building",
    "complexity": "high",
    "style": "contemporary",
    "scale": "large"
  },
  "elements": [{
    "type": "building",
    "name": "Office Tower",
    "quantity": 1,
    "dimensions": {
      "width": 30000,
      "height": 60000,
      "depth": 25000
    },
    "floors": 15,
    "materials": ["glass", "metal", "concrete"],
    "details": [
      "curtain_walls", "glass_facade", "windows",
      "retail_ground_floor", "office_floors",
      "rooftop_terrace", "roof_garden",
      "underground_parking", "basement_levels",
      "entrances", "lobby", "elevator_core",
      "columns", "structural_elements"
    ]
  }],
  "requirements": {
    "detailLevel": "very_high",
    "materials": ["glass", "metal", "concrete"],
    "features": ["curtain walls", "rooftop garden", "underground parking"],
    "functionalSpaces": ["retail", "office", "parking"]
  }
}

Prompt: "Design a modern museum with curved glass facade, multiple exhibition halls, central atrium, and outdoor sculpture garden"
Response:
{
  "objectCount": 1,
  "objectTypes": ["building"],
  "scene": {
    "type": "single_building",
    "complexity": "very_high",
    "style": "modern",
    "scale": "large"
  },
  "elements": [{
    "type": "building",
    "name": "Modern Museum",
    "quantity": 1,
    "dimensions": {
      "width": 50000,
      "height": 18000,
      "depth": 40000
    },
    "floors": 4,
    "materials": ["glass", "concrete", "metal"],
    "details": [
      "glass_facade", "curtain_walls", "windows",
      "atrium", "central_space",
      "entrances", "lobby",
      "exhibition_halls", "galleries",
      "outdoor_spaces", "sculpture_garden",
      "structural_elements", "columns"
    ]
  }],
  "requirements": {
    "detailLevel": "very_high",
    "materials": ["glass", "concrete", "metal"],
    "features": ["curved glass facade", "central atrium", "sculpture garden"],
    "functionalSpaces": ["exhibition", "atrium", "outdoor"]
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
      return JSON.parse(jsonText);
    } catch (error) {
      console.error('Failed to parse Gemini response as JSON:', error);
      return null;
    }
  }

  /**
   * Generate design specifications from prompt
   */
  async generateDesignSpecs(prompt) {
    const systemPrompt = `You are an expert 3D design assistant for ArchDisc.
Generate detailed design specifications for the following request.

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
