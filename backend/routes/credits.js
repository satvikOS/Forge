const express = require('express');
const router = express.Router();
const creditManager = require('../services/creditManager');

/**
 * GET /api/credits/status
 * Get remaining free credits for all providers
 */
router.get('/status', async (req, res) => {
  try {
    const status = await creditManager.getCreditStatus();

    res.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error('Error fetching credit status:', error);
    res.status(500).json({
      error: 'Failed to fetch credit status',
      message: error.message,
    });
  }
});

/**
 * GET /api/credits/usage
 * Get monthly usage statistics
 */
router.get('/usage', async (req, res) => {
  try {
    const stats = await creditManager.getUsageStats();

    res.json({
      success: true,
      usage: stats,
    });
  } catch (error) {
    console.error('Error fetching usage stats:', error);
    res.status(500).json({
      error: 'Failed to fetch usage stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/credits/forecast
 * Get cost forecast based on current usage
 */
router.get('/forecast', async (req, res) => {
  try {
    const forecast = await creditManager.getForecast();

    res.json({
      success: true,
      forecast,
    });
  } catch (error) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({
      error: 'Failed to fetch forecast',
      message: error.message,
    });
  }
});

/**
 * POST /api/credits/reset
 * Manually trigger credit reset (admin only - for testing)
 */
router.post('/reset', async (req, res) => {
  try {
    // In production, you'd want to add authentication here
    const reset = await creditManager.checkMonthlyReset();

    res.json({
      success: true,
      reset,
      message: reset ? 'Credits reset successfully' : 'No reset needed',
    });
  } catch (error) {
    console.error('Error resetting credits:', error);
    res.status(500).json({
      error: 'Failed to reset credits',
      message: error.message,
    });
  }
});

module.exports = router;
