const express = require('express');
const router = express.Router();
const sketchfabService = require('../services/sketchfabService');

/**
 * GET /api/sketchfab/status
 * Check if Sketchfab integration is enabled
 */
router.get('/status', (req, res) => {
  try {
    const enabled = sketchfabService.isEnabled();
    res.json({
      success: true,
      enabled,
      message: enabled
        ? 'Sketchfab integration is enabled'
        : 'Sketchfab integration is disabled. Configure SKETCHFAB_API_TOKEN or OAuth credentials in .env',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status', message: error.message });
  }
});

/**
 * GET /api/sketchfab/search
 * Search for Sketchfab models
 * Query params:
 *   - q: Search query (default: 'architecture')
 *   - categories: Category filter (e.g., 'architecture', 'cultural-heritage-history')
 *   - sort_by: Sort option (relevance, likes, views, recent)
 *   - count: Results per page (max 100)
 *   - cursor: Pagination cursor
 *   - licenses: License filter
 */
router.get('/search', async (req, res) => {
  try {
    const { q, categories, sort_by, count, cursor, licenses } = req.query;

    const result = await sketchfabService.searchModels({
      q: q || 'architecture',
      categories,
      sort_by: sort_by || 'relevance',
      count: count ? parseInt(count, 10) : 24,
      cursor,
      licenses,
    });

    res.json(result);
  } catch (error) {
    console.error('Error in search endpoint:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to search models',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/models/:uid
 * Get model details by UID
 */
router.get('/models/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ error: 'Model UID is required' });
    }

    const result = await sketchfabService.getModel(uid);
    res.json(result);
  } catch (error) {
    console.error('Error in get model endpoint:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to fetch model',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/users/:username/models
 * Get user's models
 */
router.get('/users/:username/models', async (req, res) => {
  try {
    const { username } = req.params;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = await sketchfabService.getUserModels(username, accessToken);
    res.json(result);
  } catch (error) {
    console.error('Error in get user models endpoint:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to fetch user models',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/users/:username/collections
 * Get user's collections
 */
router.get('/users/:username/collections', async (req, res) => {
  try {
    const { username } = req.params;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = await sketchfabService.getUserCollections(username, accessToken);
    res.json(result);
  } catch (error) {
    console.error('Error in get user collections endpoint:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to fetch collections',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/collections/:uid/models
 * Get models from a collection
 */
router.get('/collections/:uid/models', async (req, res) => {
  try {
    const { uid } = req.params;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!uid) {
      return res.status(400).json({ error: 'Collection UID is required' });
    }

    const result = await sketchfabService.getCollectionModels(uid, accessToken);
    res.json(result);
  } catch (error) {
    console.error('Error in get collection models endpoint:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to fetch collection models',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/oauth/authorize
 * Get OAuth authorization URL
 */
router.get('/oauth/authorize', (req, res) => {
  try {
    const { redirect_uri, state } = req.query;

    if (!redirect_uri) {
      return res.status(400).json({ error: 'redirect_uri is required' });
    }

    const authUrl = sketchfabService.getAuthorizationUrl(redirect_uri, state || 'random_state');
    res.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    console.error('Error generating OAuth URL:', error);
    res.status(500).json({
      error: 'Failed to generate authorization URL',
      message: error.message,
    });
  }
});

/**
 * POST /api/sketchfab/oauth/token
 * Exchange OAuth code for access token
 */
router.post('/oauth/token', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;

    if (!code || !redirect_uri) {
      return res.status(400).json({ error: 'code and redirect_uri are required' });
    }

    const result = await sketchfabService.exchangeCodeForToken(code, redirect_uri);
    res.json(result);
  } catch (error) {
    console.error('Error exchanging OAuth token:', error);
    res.status(500).json({
      error: 'Failed to exchange token',
      message: error.message,
    });
  }
});

/**
 * POST /api/sketchfab/oauth/refresh
 * Refresh OAuth access token
 */
router.post('/oauth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    const result = await sketchfabService.refreshAccessToken(refresh_token);
    res.json(result);
  } catch (error) {
    console.error('Error refreshing OAuth token:', error);
    res.status(500).json({
      error: 'Failed to refresh token',
      message: error.message,
    });
  }
});

/**
 * GET /api/sketchfab/me
 * Get current user info (requires OAuth)
 */
router.get('/me', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token is required' });
    }

    const result = await sketchfabService.getCurrentUser(accessToken);
    res.json(result);
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(error.message.includes('not enabled') ? 503 : 500).json({
      error: 'Failed to fetch user info',
      message: error.message,
    });
  }
});

/**
 * POST /api/sketchfab/cache/clear
 * Clear the API cache (for testing/debugging)
 */
router.post('/cache/clear', (req, res) => {
  try {
    sketchfabService.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared successfully',
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
