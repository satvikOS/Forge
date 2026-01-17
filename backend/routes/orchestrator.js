const express = require('express');
const router = express.Router();
const apiOrchestrator = require('../services/apiOrchestrator');
const analyticsService = require('../services/analyticsService');
const cacheService = require('../services/cacheService');
const jobQueue = require('../services/jobQueue');

/**
 * POST /api/orchestrate/generate
 * Main orchestration endpoint - creates a job and triggers full orchestration pipeline
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!apiOrchestrator.isEnabled()) {
      return res.status(503).json({ 
        error: 'API Orchestrator is not enabled',
        message: 'Set ENABLE_ORCHESTRATOR=true in environment variables',
      });
    }

    // Create job
    const jobId = jobQueue.createJob(prompt, {
      ...options,
      useOrchestrator: true,
    });

    // Start orchestration async
    processOrchestrationJob(jobId, prompt, options).catch(error => {
      console.error(`Error processing orchestration job ${jobId}:`, error);
      jobQueue.failJob(jobId, error);
    });

    res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Orchestration job created - gathering data from multiple sources',
    });

  } catch (error) {
    console.error('Error creating orchestration job:', error);
    res.status(500).json({
      error: 'Failed to create orchestration job',
      message: error.message,
    });
  }
});

/**
 * Process orchestration job
 */
async function processOrchestrationJob(jobId, prompt, options) {
  try {
    // Update job status
    jobQueue.updateJob(jobId, {
      status: 'processing',
      stages: {
        orchestration: 'in_progress',
      },
    });

    // Run full orchestration
    const orchestrationResult = await apiOrchestrator.orchestrate(prompt, options);

    if (!orchestrationResult || orchestrationResult.error) {
      throw new Error(orchestrationResult?.error || 'Orchestration failed');
    }

    // Update job with orchestration result
    jobQueue.updateJob(jobId, {
      stages: {
        orchestration: 'completed',
        rendering: 'in_progress',
      },
    });

    // Build enhanced scene data using orchestration results
    const sceneData = buildEnhancedSceneData(orchestrationResult);

    // Complete job
    jobQueue.completeJob(jobId, {
      orchestrationResult,
      sceneData,
      confidence: orchestrationResult.confidence,
      dataQuality: orchestrationResult.dataQuality,
      realisticEnhancement: orchestrationResult.realisticEnhancement,
    });

  } catch (error) {
    jobQueue.failJob(jobId, error);
  }
}

/**
 * Build enhanced scene data from orchestration results
 */
function buildEnhancedSceneData(orchestrationResult) {
  const sceneData = orchestrationResult.phases?.sceneGeneration?.sceneData;
  
  if (!sceneData) {
    return null;
  }

  return {
    metadata: sceneData.metadata,
    objects: transformToSceneObjects(sceneData),
    environment: sceneData.environment,
    lighting: sceneData.lighting,
    materials: sceneData.materials,
    realWorldEnhancements: sceneData.realWorldData,
    confidence: orchestrationResult.confidence,
  };
}

/**
 * Transform orchestrated data to scene objects
 */
function transformToSceneObjects(sceneData) {
  const objects = [];

  // Add buildings
  if (sceneData.geometry?.buildings) {
    sceneData.geometry.buildings.forEach(building => {
      objects.push({
        type: 'building',
        name: building.name,
        position: building.position,
        dimensions: {
          width: 10, // Use actual dimensions if available
          height: building.height,
          depth: 10,
        },
        style: building.style,
        material: 'brick', // Determine from materials data
        realWorldData: building.realWorldData,
      });
    });
  }

  // Add vegetation
  if (sceneData.vegetation?.trees) {
    sceneData.vegetation.trees.slice(0, 50).forEach(tree => { // Limit for performance
      objects.push({
        type: 'tree',
        species: tree.species,
        position: tree.position,
        dimensions: {
          height: tree.height,
          crownDiameter: tree.crownDiameter,
        },
        properties: {
          age: tree.age,
          health: tree.health,
          leafType: tree.leafType,
        },
      });
    });
  }

  // Add POIs as markers
  if (sceneData.geometry?.pois) {
    sceneData.geometry.pois.slice(0, 20).forEach(poi => {
      objects.push({
        type: 'poi',
        name: poi.name,
        poiType: poi.type,
        position: poi.location,
      });
    });
  }

  return objects;
}

/**
 * GET /api/orchestrate/status/:jobId
 * Get orchestration job status and progress
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await jobQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Calculate detailed progress
    const progress = calculateOrchestrationProgress(job);

    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: progress.overall,
        phases: progress.phases,
        stages: job.stages,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        result: job.status === 'completed' ? {
          sceneData: job.result?.sceneData,
          confidence: job.result?.confidence,
          dataQuality: job.result?.dataQuality,
          realisticEnhancement: job.result?.realisticEnhancement,
          orchestrationSummary: summarizeOrchestration(job.result?.orchestrationResult),
        } : null,
        error: job.error,
      },
    });

  } catch (error) {
    console.error('Error getting orchestration status:', error);
    res.status(500).json({
      error: 'Failed to get orchestration status',
      message: error.message,
    });
  }
});

/**
 * Calculate orchestration progress
 */
function calculateOrchestrationProgress(job) {
  const phases = {
    intentUnderstanding: 0,
    knowledgeGathering: 0,
    geographicData: 0,
    environmentalContext: 0,
    assets3D: 0,
    dataFusion: 0,
    sceneGeneration: 0,
  };

  let completedPhases = 0;
  const totalPhases = Object.keys(phases).length;

  // Simplified progress tracking
  if (job.stages?.orchestration === 'in_progress') {
    completedPhases = 3; // Assume mid-way through
  } else if (job.stages?.orchestration === 'completed') {
    completedPhases = totalPhases;
  }

  const overall = (completedPhases / totalPhases) * 100;

  return {
    overall: Math.round(overall),
    phases,
    currentPhase: job.stages?.orchestration || 'pending',
  };
}

/**
 * Summarize orchestration results
 */
function summarizeOrchestration(orchestrationResult) {
  if (!orchestrationResult) {
    return null;
  }

  return {
    dataSources: orchestrationResult.phases?.sceneGeneration?.sceneData?.realWorldData?.dataSourceCount || 0,
    hasRealBuildings: orchestrationResult.phases?.geographicData?.osm_buildings?.length > 0,
    hasWeatherData: !!orchestrationResult.phases?.environmentalContext?.weather,
    hasKnowledge: !!orchestrationResult.phases?.knowledgeGathering?.wikipedia,
    confidence: orchestrationResult.confidence,
    enhancementLevel: orchestrationResult.realisticEnhancement?.enhancementLevel,
  };
}

/**
 * POST /api/orchestrate/preview
 * Quick preview using cached data (faster response)
 */
router.post('/preview', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Run lightweight orchestration (skip slow APIs)
    const previewOptions = {
      ...options,
      skipAPIs: ['mapillary', 'wikimedia'], // Skip image-heavy APIs
      quickMode: true,
    };

    const orchestrationResult = await apiOrchestrator.orchestrate(prompt, previewOptions);

    res.json({
      success: true,
      preview: {
        intent: orchestrationResult.phases?.intentUnderstanding,
        confidence: orchestrationResult.confidence,
        dataQuality: orchestrationResult.dataQuality,
        availableData: {
          knowledge: !!orchestrationResult.phases?.knowledgeGathering,
          geographic: !!orchestrationResult.phases?.geographicData,
          environmental: !!orchestrationResult.phases?.environmentalContext,
        },
      },
    });

  } catch (error) {
    console.error('Error creating preview:', error);
    res.status(500).json({
      error: 'Failed to create preview',
      message: error.message,
    });
  }
});

/**
 * GET /api/orchestrate/capabilities
 * Get available APIs and their status
 */
router.get('/capabilities', async (req, res) => {
  try {
    const capabilities = {
      orchestrator: apiOrchestrator.isEnabled(),
      apis: {
        // Geographic
        mapbox: require('../services/mapboxService').isEnabled(),
        overpass: require('../services/overpassService').isEnabled(),
        elevation: require('../services/elevationService').isEnabled(),
        
        // Knowledge
        // Wikipedia removed
        // Wikidata removed
        wikimedia: require('../services/wikimediaService').isEnabled(),
        
        // Environmental
        weather: require('../services/weatherService').isEnabled(),
        treeMap: require('../services/treeMapService').isEnabled(),
        
        // Visual
        mapillary: require('../services/mapillaryService').isEnabled(),
        
        // 3D Assets
        sketchfab: require('../services/sketchfabService').isEnabled(),
      },
      health: analyticsService.getAPIHealth(),
      metrics: analyticsService.generateReport(),
    };

    res.json({
      success: true,
      capabilities,
    });

  } catch (error) {
    console.error('Error getting capabilities:', error);
    res.status(500).json({
      error: 'Failed to get capabilities',
      message: error.message,
    });
  }
});

/**
 * GET /api/orchestrate/metrics
 * Get analytics and performance metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const report = analyticsService.generateReport();
    const cacheMetrics = cacheService.getMetrics();

    res.json({
      success: true,
      metrics: {
        apis: report.apis,
        cache: cacheMetrics,
        summary: report.summary,
        topErrors: report.topErrors,
        popularPatterns: analyticsService.getPopularPatterns(),
      },
    });

  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({
      error: 'Failed to get metrics',
      message: error.message,
    });
  }
});

/**
 * POST /api/orchestrate/cache/clear
 * Clear cache (admin endpoint)
 */
router.post('/cache/clear', async (req, res) => {
  try {
    const { cacheType } = req.body;
    
    cacheService.clear(cacheType);

    res.json({
      success: true,
      message: `Cache cleared: ${cacheType || 'all'}`,
    });

  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message,
    });
  }
});

module.exports = router;
