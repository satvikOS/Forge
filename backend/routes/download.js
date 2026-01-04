const express = require('express');
const router = express.Router();
const exportService = require('../services/exportService');
const jobQueue = require('../services/jobQueue');

/**
 * GET /api/download/:jobId/:format
 * Download 3D model in specified format
 */
router.get('/:jobId/:format', async (req, res) => {
  try {
    const { jobId, format } = req.params;

    // Check if job exists and is completed
    if (!jobQueue.isJobReady(jobId)) {
      const job = jobQueue.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (job.status !== 'completed') {
        return res.status(400).json({ 
          error: 'Job not ready', 
          status: job.status,
          progress: job.progress,
        });
      }
    }

    // Get job result
    const job = jobQueue.getJob(jobId);
    const geometryData = job.result?.design?.model?.geometry;

    if (!geometryData) {
      return res.status(500).json({ error: 'No geometry data available' });
    }

    // Export to requested format
    const normalizedFormat = format.toLowerCase();
    const exportData = exportService.exportGeometry(geometryData, normalizedFormat);

    // Set appropriate headers based on format
    switch (normalizedFormat) {
      case 'obj':
        // Return both OBJ and MTL files as JSON
        res.setHeader('Content-Type', 'application/json');
        res.json({
          success: true,
          files: {
            obj: {
              filename: exportData.filename,
              content: exportData.obj,
            },
            mtl: {
              filename: exportData.mtlFilename,
              content: exportData.mtl,
            },
          },
        });
        break;

      case 'gltf':
      case 'glb':
        res.setHeader('Content-Type', 'application/json');
        res.json({
          success: true,
          file: {
            filename: exportData.filename,
            content: exportData.gltf,
          },
        });
        break;

      case 'fbx':
        res.setHeader('Content-Type', 'application/json');
        res.json({
          success: true,
          file: {
            filename: exportData.filename,
            content: exportData.fbx,
          },
          note: exportData.note,
        });
        break;

      default:
        return res.status(400).json({ 
          error: 'Unsupported format',
          supportedFormats: ['obj', 'gltf', 'fbx'],
        });
    }
  } catch (error) {
    console.error('Error exporting model:', error);
    res.status(500).json({ error: 'Failed to export model', message: error.message });
  }
});

/**
 * GET /api/download/:jobId/formats
 * Get available formats for a job
 */
router.get('/:jobId/formats', async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobQueue.isJobReady(jobId)) {
      return res.status(404).json({ error: 'Job not found or not ready' });
    }

    res.json({
      success: true,
      formats: [
        { format: 'obj', name: 'Wavefront OBJ', extension: '.obj', description: 'Industry standard 3D format with materials' },
        { format: 'gltf', name: 'glTF 2.0', extension: '.gltf', description: 'Modern 3D format optimized for web' },
        { format: 'fbx', name: 'Autodesk FBX', extension: '.fbx.json', description: 'Professional 3D interchange format (JSON representation)' },
      ],
    });
  } catch (error) {
    console.error('Error fetching formats:', error);
    res.status(500).json({ error: 'Failed to fetch formats', message: error.message });
  }
});

module.exports = router;
