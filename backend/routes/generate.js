const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const exportService = require('../services/exportService');
const jobQueue = require('../services/jobQueue');
const materialMappingService = require('../services/materialMappingService');
const ai3DOrchestrator = require('../services/ai3DOrchestrator');
const creditManager = require('../services/creditManager');
const apiOrchestrator = require('../services/apiOrchestrator');

/**
 * POST /api/generate
 * Main generation endpoint - creates a job and processes async
 */
router.post('/', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Validate prompt length
    if (prompt.length < 2) {
      return res.status(400).json({ error: 'Prompt too short. Please provide a more detailed description.' });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({ error: 'Prompt too long. Please keep it under 2000 characters.' });
    }

    // Extract position and keepPrevious parameters (Issue #27)
    const { position, relativePosition, keepPrevious = true } = options;

    // Create job with options
    const jobId = jobQueue.createJob(prompt, { 
      ...options, 
      position, 
      relativePosition, 
      keepPrevious 
    });

    // Start processing async
    processGenerationJob(jobId, prompt, options).catch(error => {
      console.error(`Error processing job ${jobId}:`, error);
      jobQueue.failJob(jobId, error);
    });

    res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Generation job created',
    });
  } catch (error) {
    console.error('Error creating generation job:', error);
    res.status(500).json({ 
      error: 'Failed to create generation job', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/generate/:jobId
 * Status checking endpoint
 */
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        stages: job.stages,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        result: job.status === 'completed' ? {
          design: job.result?.design,
          modelData: job.result?.modelData, // Include modelData for frontend
          designId: job.result?.designId, // Include designId for multi-design tracking
          availableFormats: ['obj', 'gltf', 'fbx'],
        } : null,
        error: job.error,
      },
    });
  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: 'Failed to fetch job status', message: error.message });
  }
});

/**
 * GET /api/generate/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', async (req, res) => {
  try {
    const stats = jobQueue.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    res.status(500).json({ error: 'Failed to fetch queue stats', message: error.message });
  }
});

/**
 * DELETE /api/generate/:jobId
 * Cancel/delete a job
 */
router.delete('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const deleted = jobQueue.deleteJob(jobId);

    if (!deleted) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      message: 'Job deleted',
    });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ error: 'Failed to delete job', message: error.message });
  }
});

/**
 * Process generation job async
 */
async function processGenerationJob(jobId, prompt, options) {
  console.log('\n========================================');
  console.log('🚀 Starting Generation Job');
  console.log('========================================');
  console.log('📋 Job Details:', {
    jobId,
    prompt: prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''),
    options: JSON.stringify(options, null, 2),
  });
  console.log('========================================\n');

  try {
    // Stage 0.5: Check for real-world data orchestration
    console.log('--- 🌍 Stage 0.5: Real-World Data Detection ---');
    let orchestrationData = null;
    
    if (apiOrchestrator.isEnabled()) {
      try {
        // Use orchestrator to check if this needs real-world data
        console.log('🔍 Checking if prompt requires real-world data...');
        orchestrationData = await apiOrchestrator.orchestrate(prompt, options);
        
        if (orchestrationData && orchestrationData.phases?.intentUnderstanding?.needsRealData) {
          console.log('✅ Real-world data orchestration successful');
          console.log('   📍 Location:', orchestrationData.phases.intentUnderstanding.location);
          console.log('   🏛️  Landmark:', orchestrationData.phases.intentUnderstanding.landmark);
          console.log('   🎯 Confidence:', (orchestrationData.confidence * 100).toFixed(1) + '%');
          console.log('   📊 Data Sources:', orchestrationData.phases.dataFusion?.validations?.length || 0);
        } else {
          console.log('ℹ️  No real-world data needed for this prompt');
          orchestrationData = null;
        }
      } catch (error) {
        console.warn('⚠️  Real-world data orchestration failed, continuing with standard generation:', error.message);
        orchestrationData = null;
      }
    } else {
      console.log('ℹ️  API Orchestrator disabled, skipping real-world data detection');
    }
    console.log('✅ Stage 0.5 complete\n');
    
    // Stage 1: Analyzing prompt
    console.log('--- 📊 Stage 1: Analyzing Prompt ---');
    jobQueue.updateProgress(jobId, 'analyzing', 10);
    
    // Validate AI service is available
    if (!aiService) {
      throw new Error('AI service not initialized');
    }
    
    // If we have orchestration data, enhance the prompt with real-world context
    let enhancedPrompt = prompt;
    if (orchestrationData) {
      enhancedPrompt = enhancePromptWithOrchestrationData(prompt, orchestrationData);
      console.log('🎨 Enhanced prompt with real-world data:', enhancedPrompt.substring(0, 150) + '...');
    }
    
    const specifications = await aiService.processPrompt(enhancedPrompt);
    console.log('✅ Specifications generated:', JSON.stringify(specifications, null, 2));
    
    // Inject real-world data into specifications if available
    if (orchestrationData) {
      specifications.realWorldData = orchestrationData;
      specifications.isRealWorldReplica = true;
      
      // Check if we have landmark dimensions from Wikipedia/Wikidata (specific landmark)
      let hasLandmarkDimensions = false;
      if (orchestrationData.phases?.knowledgeGathering?.wikidata?.dimensions) {
        const dims = orchestrationData.phases.knowledgeGathering.wikidata.dimensions;
        if (dims.height) {
          console.log('📏 Using real dimensions from Wikidata:', dims);
          specifications.realDimensions = dims;
          hasLandmarkDimensions = true;
        }
      }
      
      // Only use OSM buildings if we DON'T have landmark dimensions
      // This prevents landmarks from being rendered as scattered OSM buildings
      if (!hasLandmarkDimensions && orchestrationData.phases?.geographicData?.osm_buildings?.length > 0) {
        const buildings = orchestrationData.phases.geographicData.osm_buildings;
        console.log(`📦 Found ${buildings.length} real-world buildings from OSM (city scene mode)`);
        specifications.realBuildings = buildings;
        specifications.objectCount = buildings.length;
      } else if (hasLandmarkDimensions) {
        console.log('🏛️  Landmark mode: Using Wikidata dimensions, ignoring OSM buildings');
        specifications.objectCount = 1;
      }
    }
    
    // VERIFY AI was used (not fallback)
    if (!specifications || (!specifications.taxonomyData && !specifications.elements)) {
      console.warn('⚠️  WARNING: Specifications lack AI taxonomy data - may be using fallback');
    }
    
    jobQueue.updateProgress(jobId, 'analyzing', 50);
    
    // Add complexity analysis
    specifications.objectCount = specifications.objectCount || 1;
    specifications.complexity = specifications.complexity || 'medium';
    console.log('📈 Complexity analysis added:', {
      objectCount: specifications.objectCount,
      complexity: specifications.complexity,
    });
    
    jobQueue.completeStage(jobId, 'analyzing');
    console.log('✅ Stage 1 complete\n');

    // Stage 2: Generating geometry
    console.log('--- 🏗️  Stage 2: Generating Geometry ---');
    jobQueue.updateProgress(jobId, 'generating', 20);
    const modelData = await aiService.generateModelData(specifications);
    console.log('✅ Model data generated:', JSON.stringify({
      geometry: modelData.geometry?.type,
      materials: modelData.materials,
      stats: modelData.stats,
    }, null, 2));
    jobQueue.updateProgress(jobId, 'generating', 60);
    
    // Stage 2.5: Applying realistic materials and environment
    console.log('--- 🎨 Stage 2.5: Applying Realistic Materials ---');
    const { modelData: enhancedModel, environmentConfig } = await materialMappingService.assignRealisticMaterials(
      modelData,
      specifications
    );
    console.log('✅ PBR materials and environment applied:', JSON.stringify({
      hasPBRMaterials: true,
      environmentConfig: {
        location: environmentConfig.location,
        timeOfDay: environmentConfig.timeOfDay,
        weather: environmentConfig.weather,
        hdri: environmentConfig.hdri?.name,
      },
    }, null, 2));
    jobQueue.updateProgress(jobId, 'generating', 80);
    jobQueue.completeStage(jobId, 'generating');
    console.log('✅ Stage 2 complete\n');

    // Stage 3: Refining (apply LOD, optimize)
    console.log('--- ✨ Stage 3: Refining Model ---');
    jobQueue.updateProgress(jobId, 'refining', 30);
    const refined = await refineModel(enhancedModel, specifications);
    console.log('✅ Model refined:', JSON.stringify({
      lod: refined.lod,
      optimized: refined.optimized,
      instancedRendering: refined.instancedRendering,
    }, null, 2));
    jobQueue.updateProgress(jobId, 'refining', 90);
    jobQueue.completeStage(jobId, 'refining');
    console.log('✅ Stage 3 complete\n');

    // Stage 4: Preparing exports
    console.log('--- 📦 Stage 4: Preparing Exports ---');
    jobQueue.updateProgress(jobId, 'exporting', 50);
    
    // Generate unique design ID for frontend tracking (Issue #27)
    const designId = `design_${jobId}_${Date.now()}`;
    
    const result = {
      design: {
        specifications,
        model: refined,
        id: jobId,
        designId, // Unique ID for multi-design tracking
        createdAt: new Date().toISOString(),
      },
      modelData: refined, // Include modelData for frontend compatibility
      environmentConfig, // Include environment configuration
      designId, // Also at root level for easy access
      exports: {
        prepared: true,
        formats: ['obj', 'gltf', 'fbx'],
      },
    };
    
    jobQueue.completeStage(jobId, 'exporting');
    jobQueue.completeJob(jobId, result);
    console.log('✅ Stage 4 complete\n');

    console.log('========================================');
    console.log('✅ Generation Job Completed Successfully');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n========================================');
    console.error('❌ Generation Job Failed');
    console.error('========================================');
    console.error('💥 Error details:', {
      message: error.message,
      stack: error.stack,
    });
    console.error('========================================\n');
    jobQueue.failJob(jobId, error);
    throw error;
  }
}

/**
 * Refine model with LOD and optimizations
 */
async function refineModel(modelData, specifications) {
  const { objectCount = 1, complexity = 'medium' } = specifications;
  
  // Apply LOD based on object count
  let lod = 'high';
  if (objectCount > 100) {
    lod = 'low';
  } else if (objectCount > 10) {
    lod = 'medium';
  }
  
  return {
    ...modelData,
    lod,
    optimized: true,
    instancedRendering: objectCount > 10,
  };
}

/**
 * Enhance prompt with real-world orchestration data
 */
function enhancePromptWithOrchestrationData(prompt, orchestrationData) {
  if (!orchestrationData || !orchestrationData.phases) {
    return prompt;
  }

  const enhancements = [];
  const intent = orchestrationData.phases.intentUnderstanding || {};

  // Add landmark/location information
  if (intent.landmark) {
    enhancements.push(`Landmark: ${intent.landmark}`);
  }
  if (intent.location) {
    enhancements.push(`Location: ${intent.location}`);
  }

  // Add architectural style
  if (intent.style) {
    enhancements.push(`Architectural style: ${intent.style}`);
  }

  // Add real dimensions from Wikidata
  if (orchestrationData.phases.knowledgeGathering?.wikidata?.dimensions) {
    const dims = orchestrationData.phases.knowledgeGathering.wikidata.dimensions;
    if (dims.height) {
      enhancements.push(`Height: ${dims.height}m`);
    }
    if (dims.width) {
      enhancements.push(`Width: ${dims.width}m`);
    }
    if (dims.length) {
      enhancements.push(`Length: ${dims.length}m`);
    }
  }

  // Add scale information
  if (intent.scale) {
    enhancements.push(`Scale: ${intent.scale}`);
  }

  // Add building count from OSM
  if (orchestrationData.phases.geographicData?.osm_buildings?.length > 0) {
    const buildingCount = orchestrationData.phases.geographicData.osm_buildings.length;
    enhancements.push(`${buildingCount} real buildings from OpenStreetMap`);
  }

  // Add materials if specified
  if (intent.materials && intent.materials.length > 0) {
    enhancements.push(`Materials: ${intent.materials.join(', ')}`);
  }

  // Add environmental context
  if (orchestrationData.phases.environmentalContext?.weather) {
    const weather = orchestrationData.phases.environmentalContext.weather;
    if (weather.conditions) {
      enhancements.push(`Weather: ${weather.conditions}`);
    }
  }

  if (enhancements.length > 0) {
    return `${prompt}. Real-world context: ${enhancements.join(', ')}.`;
  }

  return prompt;
}

/**
 * POST /api/generate/preview
 * Preview generation (ultra-cheap, FREE tier)
 */
router.post('/preview', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Check if AI 3D orchestrator is enabled
    if (!ai3DOrchestrator.isEnabled()) {
      return res.status(503).json({ 
        error: 'AI 3D generation is not enabled',
        message: 'Please configure TRIPO_API_KEY, MESHY_API_KEY, or GOOGLE_CLOUD_PROJECT_ID'
      });
    }

    console.log('🎨 Starting preview generation:', prompt.substring(0, 50));

    // Generate with ultra_cheap mode
    const result = await ai3DOrchestrator.generate(prompt, {
      ...options,
      mode: 'ultra_cheap',
    });

    res.json({
      success: result.success,
      result,
      message: result.success ? 'Preview generation completed' : 'Preview generation failed',
    });
  } catch (error) {
    console.error('Error in preview generation:', error);
    res.status(500).json({
      error: 'Failed to generate preview',
      message: error.message,
    });
  }
});

/**
 * POST /api/generate/:jobId/upgrade
 * Upgrade existing generation to higher quality
 */
router.post('/:jobId/upgrade', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { quality = 'high' } = req.body;

    if (!ai3DOrchestrator.isEnabled()) {
      return res.status(503).json({ 
        error: 'AI 3D generation is not enabled'
      });
    }

    // Get original job
    const job = jobQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // TODO: Implement upgrade logic
    res.status(501).json({
      error: 'Quality upgrade not yet implemented',
      message: 'This feature will be available in a future update',
    });
  } catch (error) {
    console.error('Error upgrading generation:', error);
    res.status(500).json({
      error: 'Failed to upgrade generation',
      message: error.message,
    });
  }
});

/**
 * POST /api/generate/batch
 * Batch generation (maximize free tier)
 */
router.post('/batch', async (req, res) => {
  try {
    const { prompts, mode = 'ultra_cheap' } = req.body;

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ 
        error: 'Prompts array is required',
        message: 'Please provide an array of prompts to generate'
      });
    }

    if (prompts.length > 10) {
      return res.status(400).json({ 
        error: 'Too many prompts',
        message: 'Maximum 10 prompts per batch'
      });
    }

    if (!ai3DOrchestrator.isEnabled()) {
      return res.status(503).json({ 
        error: 'AI 3D generation is not enabled'
      });
    }

    console.log(`🎨 Starting batch generation: ${prompts.length} prompts`);

    // Process all prompts in parallel
    const results = await Promise.allSettled(
      prompts.map(prompt => ai3DOrchestrator.generate(prompt, { mode }))
    );

    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);

    res.json({
      success: true,
      results: {
        total: prompts.length,
        successful: successful.length,
        failed: failed.length,
        generations: successful,
        errors: failed.map(e => e.message),
      },
    });
  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({
      error: 'Failed to process batch generation',
      message: error.message,
    });
  }
});

/**
 * GET /api/generate/estimate/:mode
 * Estimate cost for a generation
 */
router.post('/estimate', async (req, res) => {
  try {
    const { prompt, mode = 'ultra_cheap' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!ai3DOrchestrator.isEnabled()) {
      return res.status(503).json({ 
        error: 'AI 3D generation is not enabled'
      });
    }

    const estimate = await ai3DOrchestrator.estimateCost(prompt, mode);

    res.json({
      success: true,
      estimate,
    });
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({
      error: 'Failed to estimate cost',
      message: error.message,
    });
  }
});

module.exports = router;
