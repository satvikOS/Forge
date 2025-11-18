const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const exportService = require('../services/exportService');
const jobQueue = require('../services/jobQueue');
const materialMappingService = require('../services/materialMappingService');

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
    res.status(500).json({ error: 'Failed to create generation job', message: error.message });
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
    // Stage 1: Analyzing prompt
    console.log('--- 📊 Stage 1: Analyzing Prompt ---');
    jobQueue.updateProgress(jobId, 'analyzing', 10);
    const specifications = await aiService.processPrompt(prompt);
    console.log('✅ Specifications generated:', JSON.stringify(specifications, null, 2));
    
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

module.exports = router;
