const express = require('express');
const router = express.Router();
const legalityService = require('../services/legalityService');

/**
 * POST /api/legality/check
 * Check design compliance with regulations
 */
router.post('/check', async (req, res) => {
  try {
    const { design } = req.body;

    if (!design) {
      return res.status(400).json({ error: 'Design data is required' });
    }

    // Check compliance
    const compliance = await legalityService.checkCompliance(design);

    res.json({
      success: true,
      compliance,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error checking compliance:', error);
    res.status(500).json({ error: 'Failed to check compliance', message: error.message });
  }
});

/**
 * GET /api/legality/standards/:objectType
 * Get applicable standards for an object type
 */
router.get('/standards/:objectType', async (req, res) => {
  try {
    const { objectType } = req.params;

    const standards = {
      car: [
        'ISO 26262 - Automotive Safety',
        'FMVSS - Federal Motor Vehicle Safety Standards',
        'Euro NCAP - Safety Assessment',
      ],
      building: [
        'IBC - International Building Code',
        'ASHRAE 90.1 - Energy Standard',
        'ADA - Accessibility Standards',
      ],
      furniture: [
        'ANSI/BIFMA - Furniture Safety',
        'ISO 9001 - Quality Management',
        'FSC - Sustainable Materials',
      ],
    };

    res.json({
      success: true,
      objectType,
      standards: standards[objectType] || ['ISO 9001 - Quality Management'],
    });
  } catch (error) {
    console.error('Error fetching standards:', error);
    res.status(500).json({ error: 'Failed to fetch standards', message: error.message });
  }
});

module.exports = router;
