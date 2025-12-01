const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiImageGenerator = require('./geminiImageGenerator');

/**
 * Multi-Variant Generator Service
 * Generates 3 ultra-realistic design variants per prompt using Gemini 2.0 Flash Experimental
 * Each variant emphasizes different aspects: Photorealistic, Engineering Detail, and Artistic Quality
 * Now supports fantasy/unrealistic designs with Gemini Image Generation (Nano Banana Pro)
 */
class MultiVariantGenerator {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    this.variantCount = parseInt(process.env.VARIANT_COUNT, 10) || 3;
    this.geminiImageGenerator = geminiImageGenerator;
    
    if (!this.apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set - Multi-variant generation will not work');
      this.enabled = false;
      return;
    }
    
    try {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: this.modelName });
      this.enabled = true;
      console.log(`✅ Multi-Variant Generator initialized with model: ${this.modelName}`);
    } catch (error) {
      console.error('❌ Failed to initialize Multi-Variant Generator:', error);
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
   * Generate 3 ultra-realistic variants for a given prompt
   * @param {string} prompt - User's prompt
   * @param {object} context - Additional context (real-world data, dimensions, etc.)
   * @returns {Promise<Array>} - Array of 3 variant designs
   */
  async generateVariants(prompt, context = {}) {
    if (!this.isEnabled()) {
      throw new Error('Multi-Variant Generator is not enabled. Please configure GEMINI_API_KEY.');
    }

    console.log('\n========================================');
    console.log('🎨 Multi-Variant Generation Started');
    console.log('========================================');
    console.log('📋 Input:', {
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      hasRealWorldData: !!context.realWorldData,
      hasCoordinates: !!(context.coordinates),
    });

    const styles = [
      {
        name: 'photorealistic',
        title: 'Photorealistic',
        description: 'Emphasizes visual accuracy and real-world appearance',
      },
      {
        name: 'engineering-detail',
        title: 'Engineering Detail',
        description: 'Focuses on structural accuracy and technical specifications',
      },
      {
        name: 'artistic-quality',
        title: 'Artistic Quality',
        description: 'Optimizes for aesthetics and presentation',
      },
    ];

    // Generate all variants in parallel for faster results
    const variantPromises = styles.map(async (style) => {
      console.log(`\n--- Generating ${style.title} variant ---`);
      try {
        const variantPrompt = this.buildVariantPrompt(prompt, style, context);
        console.log(`📝 Prompt length: ${variantPrompt.length} characters`);
        
        const result = await this.model.generateContent(variantPrompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ ${style.title} variant generated (${text.length} characters)`);
        
        return this.parseVariantResponse(text, style);
      } catch (error) {
        console.error(`❌ Failed to generate ${style.title} variant:`, error.message);
        // Return fallback variant
        return this.createFallbackVariant(prompt, style, context);
      }
    });

    // Wait for all variants to complete
    const variants = await Promise.all(variantPromises);

    console.log('\n========================================');
    console.log('✅ Multi-Variant Generation Complete');
    console.log(`📊 Generated ${variants.length} variants`);
    console.log('========================================\n');

    return variants;
  }

  /**
   * Generate fantasy/unrealistic variants with image generation support
   * Uses Gemini Image Generation (Nano Banana Pro) for concept images
   * Then provides detailed specifications for 3D conversion
   * 
   * @param {string} prompt - Fantasy/unrealistic design prompt
   * @param {object} context - Additional context
   * @returns {Promise<Array>} - Array of fantasy variant designs with image descriptions
   */
  async generateFantasyVariants(prompt, context = {}) {
    if (!this.isEnabled()) {
      throw new Error('Multi-Variant Generator is not enabled. Please configure GEMINI_API_KEY.');
    }

    console.log('\n========================================');
    console.log('🎨 Fantasy/Unrealistic Multi-Variant Generation Started');
    console.log('🎭 Using Nano Banana Pro (Gemini Image Generation)');
    console.log('========================================');
    console.log('📋 Input:', {
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      type: 'fantasy/unrealistic',
    });

    // Step 1: Generate fantasy image descriptions using Gemini
    let fantasyImages = [];
    if (this.geminiImageGenerator.isEnabled()) {
      try {
        console.log('\n🎨 Step 1: Generating fantasy concept images...');
        fantasyImages = await this.geminiImageGenerator.generateFantasyVariants(prompt, 3);
        console.log('✅ Fantasy image descriptions generated');
      } catch (error) {
        console.warn('⚠️  Fantasy image generation failed, continuing with text-only variants:', error.message);
      }
    }

    // Step 2: Generate 3D specifications for each fantasy variant
    const styles = [
      {
        name: 'ethereal-fantasy',
        title: 'Ethereal Fantasy',
        description: 'Dreamlike, otherworldly design with impossible geometry',
      },
      {
        name: 'biomechanical-complex',
        title: 'Biomechanical Complex',
        description: 'Organic forms merged with intricate mechanical elements',
      },
      {
        name: 'cosmic-surreal',
        title: 'Cosmic Surreal',
        description: 'Space-age futuristic with surreal stellar elements',
      },
    ];

    console.log('\n🏗️  Step 2: Generating 3D specifications for fantasy variants...');

    const variantPromises = styles.map(async (style, index) => {
      console.log(`\n--- Generating ${style.title} variant ---`);
      try {
        // Use fantasy image description if available
        const imageContext = fantasyImages[index] && fantasyImages[index].success
          ? {
              imageDescription: fantasyImages[index].detailedDescription,
              enhancedPrompt: fantasyImages[index].enhancedPrompt,
            }
          : null;

        const variantPrompt = this.buildFantasyVariantPrompt(prompt, style, context, imageContext);
        console.log(`📝 Prompt length: ${variantPrompt.length} characters`);
        
        const result = await this.model.generateContent(variantPrompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ ${style.title} variant generated (${text.length} characters)`);
        
        const parsed = this.parseVariantResponse(text, style);
        
        // Add fantasy-specific metadata
        return {
          ...parsed,
          fantasyMode: true,
          imageDescription: imageContext?.imageDescription,
          conceptImage: fantasyImages[index] || null,
        };
      } catch (error) {
        console.error(`❌ Failed to generate ${style.title} variant:`, error.message);
        return this.createFallbackVariant(prompt, style, { ...context, fantasyMode: true });
      }
    });

    const variants = await Promise.all(variantPromises);

    console.log('\n========================================');
    console.log('✅ Fantasy Multi-Variant Generation Complete');
    console.log(`📊 Generated ${variants.length} fantasy variants`);
    console.log(`🎨 With ${fantasyImages.filter(img => img.success).length} concept images`);
    console.log('========================================\n');

    return variants;
  }

  /**
   * Build detailed prompt for a specific variant style
   */
  buildVariantPrompt(basePrompt, style, context) {
    const { realWorldData, coordinates } = context;

    let prompt = `You are an expert 3D architect and designer creating ultra-realistic 3D models for the ArchDisc platform.

TASK: Generate a detailed 3D model specification for: "${basePrompt}"

VARIANT STYLE: ${style.title}
EMPHASIS: ${style.description}

`;

    // Add real-world reference data if available
    if (realWorldData) {
      prompt += `\nREAL-WORLD REFERENCE DATA:\n`;
      
      if (realWorldData.wikipedia) {
        prompt += `- Wikipedia: ${realWorldData.wikipedia.summary || 'N/A'}\n`;
      }
      
      if (realWorldData.wikidata) {
        const wd = realWorldData.wikidata;
        prompt += `- Dimensions:\n`;
        if (wd.dimensions) {
          if (wd.dimensions.height) prompt += `  * Height: ${wd.dimensions.height}m\n`;
          if (wd.dimensions.width) prompt += `  * Width: ${wd.dimensions.width}m\n`;
          if (wd.dimensions.length) prompt += `  * Length: ${wd.dimensions.length}m\n`;
        }
        if (wd.materials && wd.materials.length > 0) {
          prompt += `- Materials: ${wd.materials.join(', ')}\n`;
        }
        if (wd.architect) {
          prompt += `- Architect: ${wd.architect}\n`;
        }
        if (wd.inceptionDate) {
          prompt += `- Built: ${wd.inceptionDate}\n`;
        }
      }
    }

    // Add location context if coordinates provided
    if (coordinates) {
      prompt += `\nLOCATION CONTEXT:\n`;
      prompt += `- Coordinates: ${coordinates.latitude}, ${coordinates.longitude}\n`;
      if (coordinates.address) {
        prompt += `- Address: ${coordinates.address}\n`;
      }
    }

    // Style-specific instructions
    if (style.name === 'photorealistic') {
      prompt += `\nPHOTOREALISTIC REQUIREMENTS:
- Use exact real-world dimensions and proportions
- Include accurate material textures (weathering, patina, wear)
- Add environmental context (lighting, atmosphere, surroundings)
- Consider time of day and weather effects
- Include fine details visible in photographs
`;
    } else if (style.name === 'engineering-detail') {
      prompt += `\nENGINEERING REQUIREMENTS:
- Provide precise structural specifications
- Include component count and assembly details
- Specify load-bearing elements and supports
- Detail connection points and joints
- Include technical measurements in meters
- Specify material properties (density, strength, composition)
`;
    } else if (style.name === 'artistic-quality') {
      prompt += `\nARTISTIC REQUIREMENTS:
- Optimize visual composition and balance
- Enhance aesthetic appeal while maintaining accuracy
- Consider ideal lighting and presentation angles
- Add artistic interpretation of materials and surfaces
- Focus on dramatic features and visual impact
`;
    }

    prompt += `\nOUTPUT FORMAT (STRICT JSON):
{
  "name": "descriptive name",
  "style": "${style.name}",
  "description": "2-3 sentence description",
  "dimensions": {
    "width": <number in meters>,
    "height": <number in meters>,
    "depth": <number in meters>
  },
  "materials": ["material1", "material2", ...],
  "elements": [
    {
      "type": "element type",
      "name": "element name",
      "dimensions": {"width": <meters>, "height": <meters>, "depth": <meters>},
      "position": {"x": <meters>, "y": <meters>, "z": <meters>},
      "material": "material name"
    }
  ],
  "details": {
    "structuralFeatures": ["feature1", "feature2", ...],
    "visualCharacteristics": ["char1", "char2", ...],
    "technicalSpecs": ["spec1", "spec2", ...]
  },
  "metadata": {
    "complexity": "low|medium|high",
    "realism": "high",
    "historicalAccuracy": "high|medium|low"
  }
}

CRITICAL: Return ONLY valid JSON, no markdown, no explanations, no code blocks.`;

    return prompt;
  }

  /**
   * Build detailed prompt for fantasy/unrealistic variant style
   * Incorporates image descriptions from Gemini Image Generator
   */
  buildFantasyVariantPrompt(basePrompt, style, context, imageContext) {
    let prompt = `You are an expert fantasy 3D designer creating imaginative, unrealistic, and super-complex 3D models for the ArchDisc platform.

TASK: Generate a detailed 3D model specification for: "${basePrompt}"

VARIANT STYLE: ${style.title}
EMPHASIS: ${style.description}

DESIGN TYPE: Fantasy/Unrealistic/Super-Complex
- Embrace impossible geometry and physics-defying elements
- Use fantastical and imaginary materials
- Create intricate, elaborate, and hyper-detailed designs
- Incorporate surreal and otherworldly aesthetics

`;

    // Add image description if available
    if (imageContext && imageContext.imageDescription) {
      prompt += `\nCONCEPT IMAGE DESCRIPTION:\n`;
      prompt += `${imageContext.imageDescription}\n\n`;
      prompt += `Use this visual description as inspiration for the 3D model design.\n`;
    }

    // Add context from real-world pipeline if available (for hybrid designs)
    if (context.realWorldData) {
      prompt += `\nREAL-WORLD REFERENCE (for hybrid fantasy-realism):\n`;
      prompt += `Use these as inspiration but feel free to transform them into fantasy elements:\n`;
      
      if (context.realWorldData.wikipedia) {
        prompt += `- Base concept: ${context.realWorldData.wikipedia.summary?.substring(0, 200) || 'N/A'}\n`;
      }
    }

    // Fantasy-specific instructions
    prompt += `\nFANTASY DESIGN REQUIREMENTS:
- Materials can be impossible/magical (e.g., "crystallized starlight", "living metal", "ethereal glass")
- Dimensions can defy physics (floating elements, infinite loops, impossible proportions)
- Include fantastical elements (glowing runes, energy fields, morphing geometry)
- Embrace complexity and intricate details
- Think beyond real-world constraints

`;

    prompt += `\nOUTPUT FORMAT (STRICT JSON):
{
  "name": "descriptive fantasy name",
  "style": "${style.name}",
  "description": "2-3 sentence description emphasizing fantasy elements",
  "dimensions": {
    "width": <number in meters, can be unrealistic>,
    "height": <number in meters, can be unrealistic>,
    "depth": <number in meters, can be unrealistic>
  },
  "materials": ["fantasy material 1", "fantasy material 2", ...],
  "elements": [
    {
      "type": "fantasy element type",
      "name": "element name",
      "dimensions": {"width": <meters>, "height": <meters>, "depth": <meters>},
      "position": {"x": <meters>, "y": <meters>, "z": <meters>},
      "material": "fantasy material",
      "fantasyProperties": {
        "glowing": true|false,
        "animated": true|false,
        "magical": true|false,
        "defiesGravity": true|false
      }
    }
  ],
  "details": {
    "fantasyFeatures": ["feature1", "feature2", ...],
    "visualEffects": ["effect1", "effect2", ...],
    "impossibleElements": ["element1", "element2", ...]
  },
  "metadata": {
    "complexity": "high|super|extreme",
    "fantasyLevel": "high",
    "realism": "low|fantasy",
    "imaginationScore": "high"
  }
}

CRITICAL: Return ONLY valid JSON, no markdown, no explanations, no code blocks.`;

    return prompt;
  }

  /**
   * Parse AI response into structured variant object
   */
  parseVariantResponse(text, style) {
    try {
      // Remove markdown code blocks if present
      let cleanText = text.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(cleanText);
      
      // Ensure required fields
      return {
        style: style.name,
        title: style.title,
        name: parsed.name || 'Unnamed Design',
        description: parsed.description || style.description,
        dimensions: parsed.dimensions || { width: 10, height: 10, depth: 10 },
        materials: parsed.materials || ['concrete', 'steel'],
        elements: parsed.elements || [],
        details: parsed.details || {},
        metadata: {
          ...parsed.metadata,
          style: style.name,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error('❌ Failed to parse variant response:', error.message);
      console.log('Raw response:', text.substring(0, 500));
      throw new Error(`Failed to parse ${style.title} variant: ${error.message}`);
    }
  }

  /**
   * Create fallback variant if AI generation fails
   */
  createFallbackVariant(prompt, style, context) {
    console.warn(`⚠️  Creating fallback variant for ${style.title}`);
    
    return {
      style: style.name,
      title: style.title,
      name: prompt.substring(0, 50),
      description: `${style.title} design generated with fallback mode`,
      dimensions: { width: 10, height: 10, depth: 10 },
      materials: ['concrete', 'steel'],
      elements: [],
      details: {
        structuralFeatures: ['Basic structure'],
        visualCharacteristics: ['Standard appearance'],
        technicalSpecs: ['Standard specifications'],
      },
      metadata: {
        complexity: 'medium',
        realism: 'medium',
        historicalAccuracy: 'low',
        style: style.name,
        generatedAt: new Date().toISOString(),
        fallback: true,
      },
    };
  }
}

module.exports = new MultiVariantGenerator();
