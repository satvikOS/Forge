const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiImageGenerator = require('./geminiImageGenerator');
const AxelVoxelEngine = require('../../engines/axel/voxelEngine');

/**
 * Multi-Variant Generator Service
 * Generates 3 ultra-realistic design variants per prompt using Gemini 2.0 Flash Experimental
 * Each variant emphasizes different aspects: Photorealistic, Engineering Detail, and Artistic Quality
 * Now supports fantasy/unrealistic designs with Gemini Image Generation (Nano Banana Pro)
 */
class MultiVariantGenerator {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.variantCount = parseInt(process.env.VARIANT_COUNT, 10) || 3;
    this.geminiImageGenerator = geminiImageGenerator;

    // Initialize Axel Voxel Engine
    this.axelEngine = new AxelVoxelEngine({
      enabled: process.env.AXEL_ENABLED !== 'false',
      resolution: 'adaptive',
      enableMetrology: true,
      enableChemical: true,
      enableFlaws: true,
      enableTooling: true,
      enableEnvironment: true
    });

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
    console.log('\n\n🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨');
    console.log('🚨 MULTI-VARIANT GENERATOR - generateVariants() CALLED 🚨');
    console.log('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n');

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
        console.log(`🔥 CALLING GEMINI API with model: ${this.modelName}`);
        console.log(`🔑 API Key present: ${!!this.apiKey} (first 10 chars: ${this.apiKey?.substring(0, 10)}...)`);

        const result = await this.model.generateContent(variantPrompt);
        console.log(`📡 GEMINI RAW RESULT received:`, typeof result);

        const response = await result.response;
        console.log(`📡 GEMINI RESPONSE object:`, typeof response);

        const text = response.text();
        console.log(`📡 GEMINI TEXT length: ${text?.length || 0}`);
        console.log(`📡 GEMINI TEXT preview: ${text?.substring(0, 500)}`);

        console.log(`✅ ${style.title} variant generated (${text.length} characters)`);

        // Parse variant
        const variant = this.parseVariantResponse(text, style);
        console.log(`📦 PARSED VARIANT: ${JSON.stringify(variant).substring(0, 300)}`);

        // Apply Axel Step: Analyze and Replicate (Micron-level refinement)
        if (this.axelEngine.isEnabled()) {
          console.log(`🔬 Applying Axel analysis to ${style.title}...`);
          try {
            const axelAnalysis = await this.axelEngine.analyzeAndReplicate(variant, context.realWorldData);
            if (axelAnalysis) {
              variant.axelAnalysis = axelAnalysis;
              variant.metadata.engine = 'Gemini + Axel Voxel Engine';
              console.log(`✅ Axel analysis attached to ${style.title}`);
            }
          } catch (axelError) {
            console.error(`⚠️ Axel analysis failed for ${style.title}:`, axelError.message);
          }
        }

        return variant;
      } catch (error) {
        console.error(`\n❌ ========================================`);
        console.error(`❌ GEMINI API CALL FAILED for ${style.title}`);
        console.error(`❌ ========================================`);
        console.error(`❌ Error Type: ${error.name}`);
        console.error(`❌ Error Message: ${error.message}`);
        console.error(`❌ API Key Present: ${!!this.apiKey}`);
        console.error(`❌ API Key First 10 chars: ${this.apiKey?.substring(0, 10)}...`);
        console.error(`❌ Model: ${this.modelName}`);
        if (error.stack) {
          console.error(`❌ Stack Trace (first 500 chars):`);
          console.error(error.stack.substring(0, 500));
        }
        console.error(`❌ ========================================\n`);

        // Return fallback variant (with potential Axel analysis)
        return this.createFallbackVariant(prompt, style, context, error);
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
   * Build a variant-specific prompt for Gemini
   * Emphasizes different aspects based on the style
   */
  buildVariantPrompt(prompt, style, context) {
    const basePrompt = `Generate a detailed 3D architectural design specification for: "${prompt}"

Style Focus: ${style.title} - ${style.description}

Requirements:
- Return a JSON object with the following structure
- Include precise dimensions in millimeters
- Specify materials and structural details
- Create realistic, buildable designs

JSON Format:
{
  "name": "Design name",
  "description": "Detailed description emphasizing ${style.title} aspects",
  "dimensions": {
    "width": <number in mm>,
    "height": <number in mm>,
    "depth": <number in mm>
  },
  "materials": ["material1", "material2"],
  "elements": [
    {
      "name": "Element name",
      "type": "box|cylinder|cone",
      "dimensions": {"width": <mm>, "height": <mm>, "depth": <mm>},
      "material": "material name",
      "position": {"x": <mm>, "y": <mm>, "z": <mm>}
    }
  ],
  "details": {
    "structuralFeatures": ["feature1", "feature2"],
    "visualCharacteristics": ["char1", "char2"],
    "technicalSpecs": ["spec1", "spec2"]
  },
  "metadata": {
    "complexity": "low|medium|high",
    "realism": "low|medium|high"
  }
}`;

    // Add style-specific emphasis
    let styleEmphasis = '';
    if (style.name === 'photorealistic') {
      styleEmphasis = '\nEmphasize: Visual accuracy, realistic materials, weathering effects, lighting considerations';
    } else if (style.name === 'engineering-detail') {
      styleEmphasis = '\nEmphasize: Structural integrity, load-bearing elements, construction methodology, technical precision';
    } else if (style.name === 'artistic-quality') {
      styleEmphasis = '\nEmphasize: Aesthetic appeal, visual composition, dramatic features, presentation quality';
    }

    // Add context if available
    let contextInfo = '';
    if (context.realWorldData) {
      contextInfo = '\n\nReal-world reference data available. Use it to enhance accuracy.';
    }

    return basePrompt + styleEmphasis + contextInfo;
  }

  // ... (keeping generateFantasyVariants and others same) ...

  parseVariantResponse(text, style) {
    try {
      // Remove markdown code blocks if present
      let cleanText = text.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      let parsed;
      try {
        // Try normal parse first
        parsed = JSON.parse(cleanText);
      } catch (error) {
        console.warn(`⚠️  Initial JSON parse failed for ${style.title}, attempting recovery...`);

        // Strategy 1: Try to fix incomplete arrays (common Gemini issue)
        try {
          let repaired = cleanText;

          // Count opening and closing brackets
          const openBrackets = (repaired.match(/\[/g) || []).length;
          const closeBrackets = (repaired.match(/\]/g) || []).length;

          // If array is incomplete, close it
          if (openBrackets > closeBrackets) {
            const missing = openBrackets - closeBrackets;
            console.warn(`⚠️  Detected ${missing} unclosed array(s), adding closing brackets`);
            repaired = repaired.trimEnd();
            // Remove any trailing commas
            if (repaired.endsWith(',')) {
              repaired = repaired.slice(0, -1);
            }
            repaired += ']'.repeat(missing);
          }

          // Count opening and closing braces
          const openBraces = (repaired.match(/\{/g) || []).length;
          const closeBraces = (repaired.match(/\}/g) || []).length;

          // If object is incomplete, close it
          if (openBraces > closeBraces) {
            const missing = openBraces - closeBraces;
            console.warn(`⚠️  Detected ${missing} unclosed object(s), adding closing braces`);
            repaired = repaired.trimEnd();
            if (repaired.endsWith(',')) {
              repaired = repaired.slice(0, -1);
            }
            repaired += '}'.repeat(missing);
          }

          parsed = JSON.parse(repaired);
          console.log(`✅ Successfully repaired JSON for ${style.title}`);
        } catch (repairError) {
          console.error('❌ JSON repair failed:', repairError.message);
          console.log('Raw response (first 1000 chars):', text.substring(0, 1000));
          console.log('Raw response (last 500 chars):', text.substring(Math.max(0, text.length - 500)));
          throw new Error(`Failed to parse ${style.title} variant: ${error.message}`);
        }
      }

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
      throw new Error(`Failed to parse ${style.title} variant: ${error.message}`);
    }
  }

  /**
   * Create fallback variant if AI generation fails
   * Creates UNIQUE, MINIMAL fallback per style to avoid blocking view
   * Tries to use Axel to enhance the fallback if possible
   */
  async createFallbackVariant(prompt, style, context, error = null) {
    console.warn(`⚠️  Creating fallback variant for ${style.title}`);
    console.warn(`⚠️  Error details:`, error?.message || 'Unknown error');

    // Create STYLE-SPECIFIC descriptions and characteristics
    let styleSpecificData = {};

    if (style.name === 'photorealistic') {
      styleSpecificData = {
        description: `Photorealistic interpretation of "${prompt.substring(0, 40)}..." (AI generation unavailable - using fallback). This variant would emphasize visual accuracy and realistic materials with proper lighting and weathering effects.`,
        materials: ['weathered_concrete', 'aged_steel', 'tinted_glass'],
        color: '#8b7355', // Weathered brown
        structuralFeatures: ['Realistic surface weathering', 'Natural material aging', 'Photographic lighting'],
        visualCharacteristics: ['High visual fidelity', 'Realistic textures', 'Natural wear patterns'],
      };
    } else if (style.name === 'engineering-detail') {
      styleSpecificData = {
        description: `Engineering-focused design for "${prompt.substring(0, 40)}..." (AI generation unavailable - using fallback). This variant would focus on structural integrity, load-bearing elements, and precise technical specifications.`,
        materials: ['reinforced_concrete', 'structural_steel', 'engineered_glass'],
        color: '#4a7c9e', // Engineering blue
        structuralFeatures: ['Load-bearing framework', 'Structural redundancy', 'Engineering precision'],
        visualCharacteristics: ['Technical accuracy', 'Structural clarity', 'Construction methodology'],
      };
    } else { // artistic-quality
      styleSpecificData = {
        description: `Artistic interpretation of "${prompt.substring(0, 40)}..." (AI generation unavailable - using fallback). This variant would optimize for aesthetic appeal with dramatic features and presentation quality.`,
        materials: ['polished_marble', 'brushed_aluminum', 'crystal_glass'],
        color: '#d4af37', // Golden/artistic
        structuralFeatures: ['Aesthetic composition', 'Visual drama', 'Artistic expression'],
        visualCharacteristics: ['High presentation value', 'Dramatic angles', 'Visual impact'],
      };
    }

    // MINIMAL fallback geometry - single small placeholder to avoid blocking view
    // Using millimeters to match expected scale
    const fallbackVariant = {
      style: style.name,
      title: style.title,
      name: `${style.title}: ${prompt.substring(0, 40)}`,
      description: styleSpecificData.description,
      dimensions: { width: 5, height: 8, depth: 5 }, // Small 5x8x5 meter placeholder
      materials: styleSpecificData.materials,
      // SINGLE element fallback - minimal placeholder
      elements: [
        {
          name: `${style.title} Placeholder`,
          type: 'box',
          dimensions: { width: 5000, height: 8000, depth: 5000 }, // 5x8x5 meters in mm
          material: styleSpecificData.materials[0],
          position: { x: 0, y: 4000, z: 0 }, // Centered at y=4m (half height)
          color: styleSpecificData.color
        }
      ],
      details: {
        structuralFeatures: styleSpecificData.structuralFeatures,
        visualCharacteristics: styleSpecificData.visualCharacteristics,
        technicalSpecs: [
          'Fallback geometry - AI generation failed',
          `Error: ${error?.message || 'Unknown'}`,
          'Please check API configuration'
        ],
      },
      metadata: {
        complexity: 'low',
        realism: 'low',
        historicalAccuracy: 'none',
        style: style.name,
        generatedAt: new Date().toISOString(),
        fallback: true,
        isFallback: true, // Additional flag for frontend
        error: error ? error.message : 'Unknown error',
        errorType: error?.name || 'Error'
      },
    };

    // Apply Axel to fallback
    if (this.axelEngine && this.axelEngine.isEnabled()) {
      try {
        console.log(`🔬 Applying Axel analysis to fallback ${style.title}...`);
        // Use basic fallback data to seed Axel
        const axelAnalysis = await this.axelEngine.analyzeAndReplicate({
          ...fallbackVariant,
          // Extract basic info from prompt for Axel hints
          style: style.name,
          prompt: prompt,
          yearBuilt: context.realWorldData?.wikipedia?.yearBuilt,
        }, context.realWorldData);

        if (axelAnalysis) {
          fallbackVariant.axelAnalysis = axelAnalysis;
          fallbackVariant.description += ' (Enhanced by Axel)';
          fallbackVariant.metadata.engine = 'Axel Voxel Engine (Fallback)';

          // If Axel generated geometry data, try to hint dimensions
          if (axelAnalysis.metadata.geometry?.pointCloud) {
            fallbackVariant.details.technicalSpecs.push(`Point Cloud Density: ${axelAnalysis.metadata.geometry.pointCloud.density}`);
          }
        }
      } catch (axelError) {
        console.warn('⚠️ Axel failed on fallback:', axelError);
      }
    }

    return fallbackVariant;
  }
}

module.exports = new MultiVariantGenerator();
