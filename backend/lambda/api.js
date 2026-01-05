/**
 * Main API Lambda Handler
 * AWS Bedrock-powered autonomous CAD generation API
 */

const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Import routes
const mechanicalRoutes = require('../routes/mechanical-simplified');

// Health check endpoint
app.get('/api/health', (req, res) => {
    const bedrockService = require('../services/bedrockService');
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.STAGE || 'dev',
        region: process.env.AWS_REGION || 'unknown',
        node_version: process.version,
        bedrock_configured: bedrockService.isConfigured()
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'ArchDisc API is working!',
        version: '2.0.0',
        features: ['autonomous_ai_agent', 'bedrock_integration', 'job_queue'],
        endpoints: [
            '/api/health',
            '/api/test',
            '/api/mechanical/autonomous - FULLY AUTONOMOUS AI AGENT',
            '/api/mechanical/generate',
            '/api/mechanical/generate/:jobId',
            '/api/mechanical/generate/variants',
            '/api/mechanical/generate/fantasy-variants',
            '/api/mechanical/analysis/analyze',
            '/api/mechanical/legality/check',
            '/api/mechanical/materials/*',
            '/api/mechanical/credits/*'
        ]
    });
});

// Mount mechanical routes
app.use('/api/mechanical', mechanicalRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        method: req.method
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('API Error:', err);
    res.status(500).json({
        success: false,
        error: err.message,
        stack: process.env.STAGE === 'dev' ? err.stack : undefined
    });
});

// Export handler for Lambda
module.exports.handler = serverless(app);
