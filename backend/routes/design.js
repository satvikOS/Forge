const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const projectService = require('../services/projectService');

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

    // Process prompt to get design specifications
    const specifications = await aiService.processPrompt(prompt);

    // Generate 3D model data
    const modelData = await aiService.generateModelData(specifications);

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
 * POST /api/design/proposals
 * Generate 3 design proposal variations from prompt
 */
router.post('/proposals', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Generate 3 proposal variations
    const proposalsData = await aiService.generateProposals(prompt);

    res.json({
      success: true,
      ...proposalsData,
    });
  } catch (error) {
    console.error('Error generating proposals:', error);
    res.status(500).json({ error: 'Failed to generate proposals', message: error.message });
  }
});

/**
 * POST /api/design/project-info
 * Generate comprehensive project information (BOM, budget, regulations, blueprint)
 */
router.post('/project-info', async (req, res) => {
  try {
    const { specifications } = req.body;

    if (!specifications) {
      return res.status(400).json({ error: 'Design specifications are required' });
    }

    // Generate project information
    const projectInfo = await projectService.generateProjectInfo(specifications);

    res.json({
      success: true,
      projectInfo,
    });
  } catch (error) {
    console.error('Error generating project info:', error);
    res.status(500).json({ error: 'Failed to generate project info', message: error.message });
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
