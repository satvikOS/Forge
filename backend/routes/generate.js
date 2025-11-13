const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const exportService = require('../services/exportService');
const jobQueue = require('../services/jobQueue');

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

    // Create job
    const jobId = jobQueue.createJob(prompt, options);

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
  try {
    // Stage 1: Analyzing prompt
    jobQueue.updateProgress(jobId, 'analyzing', 10);
    const specifications = await aiService.processPrompt(prompt);
    jobQueue.updateProgress(jobId, 'analyzing', 50);
    
    // Add complexity analysis
    specifications.objectCount = specifications.objectCount || 1;
    specifications.complexity = specifications.complexity || 'medium';
    
    jobQueue.completeStage(jobId, 'analyzing');

    // Stage 2: Generating geometry
    jobQueue.updateProgress(jobId, 'generating', 20);
    const modelData = await aiService.generateModelData(specifications);
    jobQueue.updateProgress(jobId, 'generating', 80);
    jobQueue.completeStage(jobId, 'generating');

    // Stage 3: Refining (apply LOD, optimize)
    jobQueue.updateProgress(jobId, 'refining', 30);
    const refined = await refineModel(modelData, specifications);
    jobQueue.updateProgress(jobId, 'refining', 90);
    jobQueue.completeStage(jobId, 'refining');

    // Stage 4: Preparing exports
    jobQueue.updateProgress(jobId, 'exporting', 50);
    
    const result = {
      design: {
        specifications,
        model: refined,
        id: jobId,
        createdAt: new Date().toISOString(),
      },
      exports: {
        prepared: true,
        formats: ['obj', 'gltf', 'fbx'],
      },
    };
    
    jobQueue.completeStage(jobId, 'exporting');
    jobQueue.completeJob(jobId, result);
  } catch (error) {
    console.error('Error in generation job:', error);
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
