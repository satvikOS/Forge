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
        // Use the best experimental model for 3D design generation
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro-exp' });
        this.modelName = 'gemini-2.5-pro-exp';
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } catch (error) {
        lastError = error;
        console.error(`Gemini API error (attempt ${attempt}/${maxRetries}):`, error.message);
        
        // Don't retry on certain errors
        if (error.message?.includes('API key') || error.message?.includes('quota')) {
          throw error;
        }
        
        if (attempt < maxRetries) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }

    throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Analyze a design prompt and extract structured information
   */
  async analyzePrompt(prompt) {
    const systemPrompt = `You are an expert AI assistant for ArchDisc, a 3D architectural design platform.
Analyze the user's design request and extract structured information.

Return a JSON object with the following structure:
{
  "objectCount": <number of objects to generate>,
  "objectTypes": [<array of object types>],
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
      "materials": [<array of materials>],
      "details": [<array of detail requirements>]
    }
  ],
  "requirements": {
    "detailLevel": "<low|medium|high|very_high>",
    "materials": [<array of required materials>],
    "features": [<array of special features>]
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
      model: this.isDemoMode ? null : this.modelName || 'gemini-2.5-pro-exp',
    };
  }
}

module.exports = new GeminiService();
