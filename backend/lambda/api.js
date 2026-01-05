/**
 * Main API Lambda Handler
 * Routes all API requests to appropriate Express routes
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
const mechanicalRoutes = require('../routes/mechanical');

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.STAGE || 'dev',
        region: process.env.AWS_REGION
    });
});

// Mount routes
app.use('/api/mechanical', mechanicalRoutes);

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
