/**
 * Main API Lambda Handler - Minimal Version
 * This version only includes essential routes to debug deployment issues
 */

const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.STAGE || 'dev',
        region: process.env.AWS_REGION || 'unknown',
        node_version: process.version
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API is working!',
        endpoints: [
            '/api/health',
            '/api/test'
        ]
    });
});

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
