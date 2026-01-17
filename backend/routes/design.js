const express = require('express');
const router = express.Router();
const geminiService = require('../services/geminiService');

/**
 * POST /api/design/generate
 * Generate design from natural language prompt
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Process prompt to get design specifications using Gemini
    const specifications = await geminiService.processPrompt(prompt);

    // Generate 3D model data
    const modelData = await geminiService.generateModelData(specifications);

    res.json({
      success: true,
      design: {
        specifications,
        model: modelData,
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error generating design:', error);
    res.status(500).json({ error: 'Failed to generate design', message: error.message });
  }
});

/**
 * POST /api/design/generate-stream
 * Generate design with streaming updates for large scenes
 */
router.post('/generate-stream', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Set headers for SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial status
    res.write(`data: ${JSON.stringify({ status: 'processing', message: 'Processing prompt...' })}\n\n`);

    // Process prompt to get design specifications
    const specifications = await aiService.processPrompt(prompt);
    
    res.write(`data: ${JSON.stringify({ status: 'generating', message: 'Generating geometry...', progress: 30 })}\n\n`);

    // Generate 3D model data
    const modelData = await aiService.generateModelData(specifications);

    res.write(`data: ${JSON.stringify({ status: 'complete', message: 'Design complete!', progress: 100 })}\n\n`);

    // Send final result
    res.write(`data: ${JSON.stringify({
      status: 'done',
      design: {
        specifications,
        model: modelData,
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
      }
    })}\n\n`);

    res.end();
  } catch (error) {
    console.error('Error generating design stream:', error);
    res.write(`data: ${JSON.stringify({ status: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/design/sketch
 * Generate design from sketch upload (placeholder for future implementation)
 */
router.post('/sketch', async (req, res) => {
  try {
    // Placeholder for sketch-to-design functionality
    res.json({
      success: true,
      message: 'Sketch upload feature coming soon',
      design: {
        specifications: {
          objectType: 'object',
          description: 'Design from sketch',
          dimensions: { width: 10, height: 10, depth: 10 },
        },
      },
    });
  } catch (error) {
    console.error('Error processing sketch:', error);
    res.status(500).json({ error: 'Failed to process sketch', message: error.message });
  }
});

/**
 * POST /api/design/proposals
 * Generate multiple design proposals (ArchPro feature)
 */
router.post('/proposals', async (req, res) => {
  try {
    const { prompt, count = 3 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Generate multiple proposals using Gemini
    const proposals = await geminiService.generateProposals(prompt, count);

    // Generate 3D model data for each proposal
    const designs = await Promise.all(
      proposals.map(async (spec) => {
        const modelData = await geminiService.generateModelData(spec);
        return {
          specifications: spec,
          model: modelData,
          id: Date.now().toString() + Math.random(),
          createdAt: new Date().toISOString(),
        };
      })
    );

    res.json({
      success: true,
      proposals: designs,
    });
  } catch (error) {
    console.error('Error generating proposals:', error);
    res.status(500).json({ error: 'Failed to generate proposals', message: error.message });
  }
});

/**
 * GET /api/design/:id
 * Get design by ID (placeholder)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // In a real application, this would fetch from a database
    res.json({
      success: true,
      design: {
        id,
        specifications: {
          objectType: 'object',
          description: 'Sample design',
        },
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching design:', error);
    res.status(500).json({ error: 'Failed to fetch design', message: error.message });
  }
});

module.exports = router;
