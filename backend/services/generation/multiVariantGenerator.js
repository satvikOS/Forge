const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Multi-Variant Generator Service
 * Generates 3 ultra-realistic design variants per prompt using Gemini 2.0 Flash Experimental
 * Each variant emphasizes different aspects: Photorealistic, Engineering Detail, and Artistic Quality
 */
class MultiVariantGenerator {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    this.variantCount = parseInt(process.env.VARIANT_COUNT) || 3;
    
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

    const variants = [];
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

    for (const style of styles) {
      console.log(`\n--- Generating ${style.title} variant ---`);
      try {
        const variantPrompt = this.buildVariantPrompt(prompt, style, context);
        console.log(`📝 Prompt length: ${variantPrompt.length} characters`);
        
        const result = await this.model.generateContent(variantPrompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ ${style.title} variant generated (${text.length} characters)`);
        
        const parsed = this.parseVariantResponse(text, style);
        variants.push(parsed);
      } catch (error) {
        console.error(`❌ Failed to generate ${style.title} variant:`, error.message);
        // Add fallback variant
        variants.push(this.createFallbackVariant(prompt, style, context));
      }
    }

    console.log('\n========================================');
    console.log('✅ Multi-Variant Generation Complete');
    console.log(`📊 Generated ${variants.length} variants`);
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
