const config = require('../config/ai3d-providers');
const tripoService = require('./tripoService');
const meshyService = require('./meshyService');
const vertexImageService = require('./vertexImageService');
const modelCache = require('./modelCache');
const creditManager = require('./creditManager');
const apiOrchestrator = require('./apiOrchestrator');
const bedrockService = require('./bedrockService');

/**
 * AI 3D Orchestrator Service
 * Smart routing and generation using AI 3D providers
 * Integrates with existing real-world data pipeline (apiOrchestrator)
 * Three generation modes: ultra_cheap (FREE), balanced, high_quality
 */
class AI3DOrchestrator {
  constructor() {
    this.enabled = config.features.ai3DGeneration;
    this.config = config;
  }

  /**
   * Check if orchestrator is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Main orchestration method - intelligently route based on prompt
   * NEW REQUIREMENT: Prompts asking for real-world replication use real data sources
   */
  async generate(prompt, options = {}) {
    if (!this.enabled) {
      console.log('⚠️  AI 3D Generation is disabled');
      return null;
    }

    console.log('\n🎭 ═══════════════════════════════════════════════════════════');
    console.log('🎭 AI 3D ORCHESTRATOR: SMART GENERATION STARTED');
    console.log('🎭 ═══════════════════════════════════════════════════════════\n');
    console.log(`📝 Prompt: "${prompt}"`);
    console.log(`⚙️  Options:`, options);

    const startTime = Date.now();
    const mode = options.mode || config.defaultMode;

    try {
      // PHASE 1: Analyze prompt to determine if it needs real-world data
      console.log('\n🧠 PHASE 1: Intent Analysis');
      const intent = await this.analyzePromptIntent(prompt);
      console.log('   Intent:', {
        needsRealWorldData: intent.needsRealWorldData,
        isRealLocation: intent.isRealLocation,
        landmark: intent.landmark,
        location: intent.location,
      });

      // PHASE 2: Check cache first
      console.log('\n📦 PHASE 2: Cache Check');
      const cached = await modelCache.get(prompt, mode);
      if (cached) {
        await creditManager.recordCacheHit();
        console.log('✅ Cache HIT - returning cached model');
        return {
          success: true,
          source: 'cache',
          model: cached,
          prompt,
          mode,
          duration: Date.now() - startTime,
        };
      }
      console.log('   Cache MISS - proceeding with generation');

      // PHASE 3: Real-world data gathering (NEW REQUIREMENT)
      let realWorldData = null;
      if (intent.needsRealWorldData) {
        console.log('\n🌍 PHASE 3: Real-World Data Gathering');
        console.log('   Prompt requires real-world data - using API Orchestrator');
        realWorldData = await this.gatherRealWorldData(prompt, intent);
        console.log('   Real-world data gathered:', {
          hasBuildings: realWorldData?.phases?.geographicData?.osm_buildings?.length > 0,
          hasElevation: !!realWorldData?.phases?.geographicData?.elevation,
          hasWeather: !!realWorldData?.phases?.environmentalContext?.weather,
          confidence: realWorldData?.confidence,
        });
      } else {
        console.log('\n⏭️  PHASE 3: Skipped (fantasy/imaginary generation)');
      }

      // PHASE 4: Select generation strategy
      console.log('\n🎯 PHASE 4: Generation Strategy Selection');
      const strategy = await this.selectGenerationStrategy(mode, intent, realWorldData);
      console.log('   Strategy:', strategy);

      // PHASE 5: Generate 3D model
      console.log('\n🎨 PHASE 5: 3D Model Generation');
      const model = await this.executeGeneration(prompt, strategy, intent, realWorldData);

      // PHASE 6: Cache the result
      console.log('\n💾 PHASE 6: Caching Result');
      await modelCache.set(prompt, mode, model, {
        strategy,
        intent,
        hasRealWorldData: !!realWorldData,
      });

      const duration = Date.now() - startTime;
      console.log(`\n✅ Generation completed in ${duration}ms`);
      console.log('🎭 ═══════════════════════════════════════════════════════════\n');

      return {
        success: true,
        source: 'generated',
        model,
        strategy,
        intent,
        realWorldData: realWorldData ? {
          confidence: realWorldData.confidence,
          dataQuality: realWorldData.dataQuality,
          dataSourceCount: realWorldData.phases?.dataFusion?.validations?.length || 0,
        } : null,
        prompt,
        mode,
        duration,
      };

    } catch (error) {
      console.error('❌ AI 3D Orchestrator failed:', error);
      return {
        success: false,
        error: error.message,
        prompt,
        mode,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Analyze prompt intent using Gemini AI
   * Determine if prompt needs real-world data
   */
  async analyzePromptIntent(prompt) {
    try {
      // Use Gemini to analyze the prompt
      const analysisPrompt = `Analyze this 3D generation prompt and determine if it requires real-world data.

PROMPT: "${prompt}"

Return JSON with:
{
  "needsRealWorldData": true/false,
  "isRealLocation": true/false,
  "landmark": "name if recognized, or null",
  "location": "city/country if mentioned, or null",
  "type": "real_building|fantasy|generic",
  "detailLevel": "low|medium|high|exact_replication",
  "reasoning": "why real-world data is needed"
}

Real-world data is needed if:
- Specific landmark/building mentioned (Eiffel Tower, Empire State Building, etc.)
- Specific city/location mentioned (New York, Paris, Tokyo, etc.)
- Request for "exact replication" or "accurate" version
- Request for real infrastructure, streets, terrain

Return ONLY valid JSON.`;

      const response = await bedrockService.generateContent(analysisPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback to keyword-based analysis
      return this.fallbackIntentAnalysis(prompt);

    } catch (error) {
      console.warn('Intent analysis failed, using fallback:', error.message);
      return this.fallbackIntentAnalysis(prompt);
    }
  }

  /**
   * Fallback intent analysis using keywords
   */
  fallbackIntentAnalysis(prompt) {
    const lower = prompt.toLowerCase();

    // Check for real-world indicators
    const realWorldKeywords = ['city', 'building', 'landmark', 'street', 'road', 'bridge', 'tower', 'exact', 'accurate', 'real', 'actual'];
    const hasRealWorldKeywords = realWorldKeywords.some(kw => lower.includes(kw));

    // Check for fantasy indicators
    const fantasyKeywords = ['fantasy', 'imaginary', 'fictional', 'creative', 'concept', 'futuristic'];
    const hasFantasyKeywords = fantasyKeywords.some(kw => lower.includes(kw));

    return {
      needsRealWorldData: hasRealWorldKeywords && !hasFantasyKeywords,
      isRealLocation: hasRealWorldKeywords,
      landmark: null,
      location: null,
      type: hasRealWorldKeywords ? 'real_building' : 'generic',
      detailLevel: lower.includes('exact') || lower.includes('accurate') ? 'exact_replication' : 'medium',
      reasoning: hasRealWorldKeywords ? 'Keywords suggest real-world location' : 'Generic or fantasy generation',
    };
  }

  /**
   * Gather real-world data using existing API Orchestrator
   * This leverages Mapbox, OSM, Wikipedia, Wikidata, Mapillary, etc.
   */
  async gatherRealWorldData(prompt, intent) {
    try {
      if (!apiOrchestrator.isEnabled()) {
        console.warn('⚠️  API Orchestrator is disabled - skipping real-world data');
        return null;
      }

      // Use the existing comprehensive orchestrator
      const orchestrationResult = await apiOrchestrator.orchestrate(prompt, {
        intent,
        forceRealData: true,
      });

      return orchestrationResult;

    } catch (error) {
      console.error('❌ Real-world data gathering failed:', error.message);
      return null;
    }
  }

  /**
   * Select generation strategy based on mode and available data
   */
  async selectGenerationStrategy(mode, intent, realWorldData) {
    const modeConfig = config.generationModes[mode];

    if (!modeConfig) {
      throw new Error(`Invalid generation mode: ${mode}`);
    }

    // Get best provider based on free tier availability
    const providerInfo = await creditManager.getBestProvider(mode);

    // Determine if we should use image-to-3D pipeline
    const useImagePipeline = config.features.imageTo3D &&
      (realWorldData?.phases?.knowledgeGathering?.wikimedia?.length > 0 ||
        realWorldData?.phases?.environmentalContext?.streetLevel?.length > 0);

    return {
      mode,
      ...modeConfig,
      provider: providerInfo.provider,
      useFreeTier: providerInfo.useFreeTier,
      useImagePipeline,
      hasRealWorldData: !!realWorldData,
      estimatedCost: providerInfo.estimatedCost,
    };
  }

  /**
   * Execute the actual 3D generation
   */
  async executeGeneration(prompt, strategy, intent, realWorldData) {
    // Enhance prompt with real-world data if available
    const enhancedPrompt = this.enhancePromptWithRealData(prompt, realWorldData);

    console.log('   Enhanced prompt:', enhancedPrompt.substring(0, 100) + '...');
    console.log('   Using provider:', strategy.provider);
    console.log('   Quality:', strategy.quality);

    // Ultra-cheap mode: Imagen → Tripo (image-to-3D)
    if (strategy.mode === 'ultra_cheap') {
      return await this.generateUltraCheap(enhancedPrompt, realWorldData);
    }

    // Balanced mode: Multi-view Imagen → Tripo/Meshy
    if (strategy.mode === 'balanced') {
      return await this.generateBalanced(enhancedPrompt, realWorldData);
    }

    // High quality mode: Direct Meshy text-to-3D with PBR
    if (strategy.mode === 'high_quality') {
      return await this.generateHighQuality(enhancedPrompt, realWorldData);
    }

    throw new Error('Invalid generation mode');
  }

  /**
   * Enhance prompt with real-world data context
   */
  enhancePromptWithRealData(prompt, realWorldData) {
    if (!realWorldData) {
      return prompt;
    }

    const enhancements = [];

    // Add location context
    if (realWorldData.phases?.intentUnderstanding?.location) {
      enhancements.push(`Location: ${realWorldData.phases.intentUnderstanding.location}`);
    }

    // Add architectural style
    if (realWorldData.phases?.intentUnderstanding?.style) {
      enhancements.push(`Style: ${realWorldData.phases.intentUnderstanding.style}`);
    }

    // Add scale information
    if (realWorldData.phases?.intentUnderstanding?.scale) {
      enhancements.push(`Scale: ${realWorldData.phases.intentUnderstanding.scale}`);
    }

    // Add environmental context
    if (realWorldData.phases?.environmentalContext?.weather) {
      const weather = realWorldData.phases.environmentalContext.weather;
      enhancements.push(`Weather: ${weather.conditions}, ${weather.temperature}°C`);
    }

    // Add building count for urban scenes
    if (realWorldData.phases?.geographicData?.osm_buildings?.length > 0) {
      enhancements.push(`${realWorldData.phases.geographicData.osm_buildings.length} real buildings`);
    }

    if (enhancements.length > 0) {
      return `${prompt}. Real-world context: ${enhancements.join(', ')}`;
    }

    return prompt;
  }

  /**
   * Ultra-cheap generation: FREE tier only
   */
  async generateUltraCheap(prompt, realWorldData) {
    console.log('   Mode: Ultra Cheap (FREE tier)');

    // Option 1: Use Tripo directly if available in free tier
    if (tripoService.isEnabled()) {
      const canUseTripoFree = await creditManager.canUseFreeTier('tripo', 10);
      if (canUseTripoFree) {
        return await tripoService.textTo3D(prompt, 'preview');
      }
    }

    // Option 2: Imagen → Tripo (image-to-3D is cheaper)
    if (vertexImageService.isEnabled() && tripoService.isEnabled()) {
      const canUseImagen = await creditManager.canUseFreeTier('vertexImagen', 1);
      const canUseTripo = await creditManager.canUseFreeTier('tripo', 10);

      if (canUseImagen && canUseTripo) {
        // Generate concept image
        const imageResult = await vertexImageService.generateConceptArt(prompt);

        // Convert to 3D
        if (imageResult.imageUrl) {
          return await tripoService.imageTo3D(imageResult.imageUrl, 'preview');
        }
      }
    }

    throw new Error('No free tier credits available for ultra-cheap generation');
  }

  /**
   * Balanced generation: Multi-view → 3D
   */
  async generateBalanced(prompt, realWorldData) {
    console.log('   Mode: Balanced');

    // Use reference images from real-world data if available
    if (realWorldData?.phases?.knowledgeGathering?.wikimedia?.length > 0) {
      const refImages = realWorldData.phases.knowledgeGathering.wikimedia.slice(0, 4);

      if (tripoService.isEnabled()) {
        const imageUrls = refImages.map(img => img.url);
        return await tripoService.multiImageTo3D(imageUrls, 'standard');
      }
    }

    // Otherwise, generate multi-view images and convert
    if (vertexImageService.isEnabled() && tripoService.isEnabled()) {
      const multiView = await vertexImageService.generateMultiViewImages(prompt);
      const imageUrls = multiView.images.map(img => img.imageUrl).filter(Boolean);

      if (imageUrls.length > 0) {
        return await tripoService.multiImageTo3D(imageUrls, 'standard');
      }
    }

    // Fallback to single image
    if (tripoService.isEnabled()) {
      return await tripoService.textTo3D(prompt, 'standard');
    }

    throw new Error('No providers available for balanced generation');
  }

  /**
   * High quality generation: AAA-grade with PBR
   */
  async generateHighQuality(prompt, realWorldData) {
    console.log('   Mode: High Quality (PBR)');

    // Prefer Meshy for high quality with PBR materials
    if (meshyService.isEnabled()) {
      return await meshyService.textTo3D(prompt, 'high');
    }

    // Fallback to Tripo high quality
    if (tripoService.isEnabled()) {
      return await tripoService.textTo3D(prompt, 'high');
    }

    throw new Error('No providers available for high quality generation');
  }

  /**
   * Upgrade existing generation to higher quality
   */
  async upgradeQuality(jobId, targetQuality) {
    // TODO: Implement upgrade logic
    // This would retrieve the original prompt and regenerate with higher quality
    throw new Error('Quality upgrade not yet implemented');
  }

  /**
   * Estimate cost for a generation
   */
  async estimateCost(prompt, mode = 'ultra_cheap') {
    const intent = await this.analyzePromptIntent(prompt);
    const strategy = await this.selectGenerationStrategy(mode, intent, null);

    return {
      mode,
      provider: strategy.provider,
      estimatedCostUSD: strategy.estimatedCost,
      estimatedTime: strategy.estimatedTime,
      quality: strategy.quality,
      useFreeTier: strategy.useFreeTier,
    };
  }
}

module.exports = new AI3DOrchestrator();
