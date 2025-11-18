const express = require('express');
const router = express.Router();
const materialLibraryService = require('../services/materialLibraryService');

/**
 * GET /api/materials/stats
 * Get material library statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = materialLibraryService.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching material stats:', error);
    res.status(500).json({ error: 'Failed to fetch material stats', message: error.message });
  }
});

/**
 * GET /api/materials/search
 * Search materials with optional filters
 */
router.get('/search', async (req, res) => {
  try {
    const { query = '', type, finish, resolution, limit = 50 } = req.query;
    
    const filters = {};
    if (type) filters.type = type;
    if (finish) filters.finish = finish;
    if (resolution) filters.resolution = resolution;
    
    let results = materialLibraryService.searchMaterials(query, filters);
    
    // Limit results
    if (limit) {
      results = results.slice(0, parseInt(limit));
    }
    
    res.json({
      success: true,
      count: results.length,
      materials: results,
    });
  } catch (error) {
    console.error('Error searching materials:', error);
    res.status(500).json({ error: 'Failed to search materials', message: error.message });
  }
});

/**
 * GET /api/materials/types
 * Get available material types
 */
router.get('/types', async (req, res) => {
  try {
    const types = materialLibraryService.getMaterialTypes();
    res.json({
      success: true,
      types,
    });
  } catch (error) {
    console.error('Error fetching material types:', error);
    res.status(500).json({ error: 'Failed to fetch material types', message: error.message });
  }
});

/**
 * GET /api/materials/:id
 * Get specific material by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const material = materialLibraryService.getMaterialById(id);
    
    if (!material) {
      return res.status(404).json({ error: 'Material not found' });
    }
    
    res.json({
      success: true,
      material,
    });
  } catch (error) {
    console.error('Error fetching material:', error);
    res.status(500).json({ error: 'Failed to fetch material', message: error.message });
  }
});

/**
 * POST /api/materials/refresh
 * Refresh materials from AmbientCG API
 */
router.post('/refresh', async (req, res) => {
  try {
    console.log('🔄 Manual material refresh requested');
    const result = await materialLibraryService.refreshFromAPI();
    
    if (result.success) {
      res.json({
        success: true,
        message: `Refreshed ${result.count} materials from API`,
        count: result.count,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to refresh materials',
        message: result.error,
      });
    }
  } catch (error) {
    console.error('Error refreshing materials:', error);
    res.status(500).json({ error: 'Failed to refresh materials', message: error.message });
  }
});

module.exports = router;
