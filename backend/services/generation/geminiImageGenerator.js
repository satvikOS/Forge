const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Gemini Image Generator Service
 * Generates fantasy, unrealistic, and super-complex concept images using Gemini's Imagen capabilities
 * Supports "Nano Banana Pro" - referring to Gemini's latest image generation features
 */
class GeminiImageGenerator {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.imageModel = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
    this.enabled = !!this.apiKey;

    if (!this.enabled) {
      console.warn('⚠️  GEMINI_API_KEY not set - Image generation will not work');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      // Initialize image generation model
      // Note: Gemini API supports image generation through specific models
      console.log(`✅ Gemini Image Generator initialized with model: ${this.imageModel}`);
    } catch (error) {
      console.error('❌ Failed to initialize Gemini Image Generator:', error);
      this.enabled = false;
    }
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Generate a fantasy/unrealistic concept image using Gemini
   * This uses Gemini's image generation capabilities (Imagen 3.0)
   * 
   * @param {string} prompt - The fantasy/unrealistic design prompt
   * @param {object} options - Generation options
   * @returns {Promise<object>} - Generated image data
   */
  async generateFantasyImage(prompt, options = {}) {
    if (!this.isEnabled()) {
      throw new Error('Gemini Image Generator is not enabled. Please configure GEMINI_API_KEY.');
    }

    console.log('\n🎨 ========================================');
    console.log('🎨 Gemini Image Generation Started');
    console.log('🎨 ========================================');
    console.log('📋 Prompt:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
    console.log('🎭 Type: Fantasy/Unrealistic/Super-complex design');

    try {
      // Enhance prompt for fantasy generation
      const enhancedPrompt = this.buildFantasyPrompt(prompt, options);
      console.log('📝 Enhanced prompt length:', enhancedPrompt.length, 'characters');

      // Generate image using Gemini's text-to-image capabilities
      // Note: As of now, Gemini API primarily supports text generation
      // For actual image generation, we'll use Gemini to create a detailed
      // image description that can be used with image generation services

      const model = this.genAI.getGenerativeModel({ model: 'gemini-3-pro' });

      const imageDescriptionPrompt = `You are an expert concept artist specializing in fantasy, unrealistic, and super-complex designs.
Generate an extremely detailed visual description for this prompt that can be used to create a stunning concept image:

PROMPT: "${prompt}"

Create a description that includes:
1. Overall composition and perspective
2. Key visual elements and their placement
3. Colors, lighting, and atmosphere
4. Textures and materials (fantasy/impossible materials are encouraged)
5. Intricate details and embellishments
6. Mood and emotional impact
7. Scale and proportions (can be unrealistic)
8. Any impossible or physics-defying elements

Make it vivid, imaginative, and suitable for generating a highly detailed concept image.
Focus on fantasy, unrealistic, or super-complex design elements.

Return ONLY the detailed visual description, no other text.`;

      const result = await model.generateContent(imageDescriptionPrompt);
      const response = await result.response;
      const detailedDescription = response.text();

      console.log('✅ Detailed image description generated');
      console.log('📊 Description length:', detailedDescription.length, 'characters');

      // Return the detailed description and metadata
      // This can be used with Vertex AI Imagen or other image generation services
      return {
        success: true,
        prompt: prompt,
        enhancedPrompt: enhancedPrompt,
        detailedDescription: detailedDescription,
        type: 'fantasy',
        metadata: {
          model: this.imageModel,
          generatedAt: new Date().toISOString(),
          style: options.style || 'fantasy',
          complexity: options.complexity || 'high',
        },
      };

    } catch (error) {
      console.error('❌ Failed to generate fantasy image description:', error.message);
      throw new Error(`Gemini image generation failed: ${error.message}`);
    }
  }

  /**
   * Generate multiple fantasy image descriptions for variants
   * 
   * @param {string} prompt - The base prompt
   * @param {number} count - Number of variants (default: 3)
   * @returns {Promise<Array>} - Array of image descriptions
   */
  async generateFantasyVariants(prompt, count = 3) {
    if (!this.isEnabled()) {
      throw new Error('Gemini Image Generator is not enabled.');
    }

    console.log('\n🎨 Generating', count, 'fantasy image variants...');

    const variantStyles = [
      { name: 'ethereal', description: 'Ethereal, dreamlike, otherworldly aesthetic' },
      { name: 'biomechanical', description: 'Organic forms merged with mechanical elements' },
      { name: 'cosmic', description: 'Cosmic, space-age, futuristic with stellar elements' },
    ];

    const variantPromises = variantStyles.slice(0, count).map(async (style, index) => {
      console.log(`\n--- Generating variant ${index + 1}: ${style.name} ---`);

      try {
        const stylePrompt = `${prompt} (Style: ${style.description})`;
        const result = await this.generateFantasyImage(stylePrompt, { style: style.name });

        return {
          ...result,
          variantIndex: index,
          variantStyle: style,
        };
      } catch (error) {
        console.error(`❌ Failed to generate variant ${index + 1}:`, error.message);
        return {
          success: false,
          error: error.message,
          variantIndex: index,
          variantStyle: style,
        };
      }
    });

    const variants = await Promise.all(variantPromises);

    console.log('\n✅ All fantasy variants generated');
    return variants;
  }

  /**
   * Build enhanced prompt for fantasy image generation
   */
  buildFantasyPrompt(basePrompt, options = {}) {
    const style = options.style || 'fantasy';
    const complexity = options.complexity || 'high';

    let enhancedPrompt = basePrompt;

    // Add fantasy/unrealistic qualifiers
    const fantasyQualifiers = [
      'ultra detailed',
      'concept art',
      'highly imaginative',
      'otherworldly',
      'fantastical',
    ];

    // Add complexity qualifiers
    if (complexity === 'high' || complexity === 'super') {
      fantasyQualifiers.push(
        'intricate details',
        'complex geometry',
        'elaborate design',
        'hyper-detailed'
      );
    }

    // Add style-specific qualifiers
    const styleQualifiers = {
      ethereal: ['dreamlike', 'soft lighting', 'mystical atmosphere', 'floating elements'],
      biomechanical: ['organic-mechanical fusion', 'bio-engineering', 'living technology'],
      cosmic: ['stellar background', 'nebula effects', 'cosmic energy', 'space-age'],
      fantasy: ['magical elements', 'impossible architecture', 'fantasy realm'],
    };

    const selectedQualifiers = styleQualifiers[style] || styleQualifiers.fantasy;

    // Combine all qualifiers
    const allQualifiers = [...fantasyQualifiers, ...selectedQualifiers];

    // Build final prompt
    enhancedPrompt = `${basePrompt}, ${allQualifiers.join(', ')}, 8k resolution, professional concept art`;

    return enhancedPrompt;
  }

  /**
   * Analyze prompt to determine if it's suitable for fantasy generation
   */
  isFantasyPrompt(prompt) {
    const fantasyKeywords = [
      'fantasy', 'magical', 'mythical', 'impossible', 'unrealistic',
      'imaginary', 'fictional', 'surreal', 'dreamlike', 'otherworldly',
      'cosmic', 'alien', 'futuristic', 'sci-fi', 'science fiction',
      'dragon', 'wizard', 'castle', 'portal', 'dimension',
    ];

    const lowerPrompt = prompt.toLowerCase();
    return fantasyKeywords.some(keyword => lowerPrompt.includes(keyword));
  }
}

module.exports = new GeminiImageGenerator();
