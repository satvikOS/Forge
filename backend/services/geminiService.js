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
        // Use stable Gemini model for better reliability
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
        this.modelName = 'gemini-pro';
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
   */
  async analyzePrompt(prompt) {
    const systemPrompt = `You are an expert AI assistant for ArchDisc, a 3D architectural design platform.
Analyze the user's design request and extract structured information.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanations, no code blocks.

Return a JSON object with this structure:
{
  "objectCount": <number>,
  "objectTypes": [<types>],
  "scene": {
    "type": "<single_object|multiple_objects|environment|building|structure>",
    "complexity": "<low|medium|high|very_high>",
    "style": "<modern|industrial|futuristic|classical|minimalist|etc>"
  },
  "elements": [
    {
      "type": "<building|structure|prop|detail|terrain|vehicle|furniture|etc>",
      "name": "<descriptive name>",
      "quantity": <number>,
      "dimensions": {"width": <number>, "height": <number>, "depth": <number>},
      "materials": [<materials array>],
      "details": [<details array>]
    }
  ],
  "requirements": {
    "detailLevel": "<low|medium|high|very_high>",
    "materials": [<materials>],
    "features": [<features>]
  }
}

User prompt: ${prompt}

Return only the JSON object, nothing else.`;

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
Generate detailed design specifications for the following request.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanations, no code blocks.

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

User request: ${prompt}

Return only the JSON object, nothing else.`;

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
