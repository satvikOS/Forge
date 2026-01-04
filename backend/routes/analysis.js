const express = require('express');
const router = express.Router();
const analysisService = require('../services/analysisService');

/**
 * POST /api/analysis/analyze
 * Perform comprehensive analysis on a design
 */
router.post('/analyze', async (req, res) => {
  try {
    const { design } = req.body;

    if (!design) {
      return res.status(400).json({ error: 'Design data is required' });
    }

    // Perform analysis
    const analysis = await analysisService.analyzeDesign(design);

    res.json({
      success: true,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error analyzing design:', error);
    res.status(500).json({ error: 'Failed to analyze design', message: error.message });
  }
});

/**
 * POST /api/analysis/structural
 * Perform structural analysis only
 */
router.post('/structural', async (req, res) => {
  try {
    const { objectType, dimensions, materials } = req.body;

    if (!objectType || !dimensions) {
      return res.status(400).json({ error: 'Object type and dimensions are required' });
    }

    const structural = analysisService.performStructuralAnalysis(objectType, dimensions, materials || []);

    res.json({
      success: true,
      structural,
    });
  } catch (error) {
    console.error('Error in structural analysis:', error);
    res.status(500).json({ error: 'Failed to perform structural analysis', message: error.message });
  }
});

/**
 * POST /api/analysis/cost
 * Estimate manufacturing/construction cost
 */
router.post('/cost', async (req, res) => {
  try {
    const { objectType, dimensions, materials } = req.body;

    if (!objectType || !dimensions) {
      return res.status(400).json({ error: 'Object type and dimensions are required' });
    }

    const cost = analysisService.estimateCost(objectType, dimensions, materials || []);

    res.json({
      success: true,
      cost,
    });
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost', message: error.message });
  }
});

module.exports = router;
