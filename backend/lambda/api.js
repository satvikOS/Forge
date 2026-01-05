/**
 * Main API Lambda Handler
 * AWS Bedrock-powered autonomous CAD generation API
 */

const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');

const app = express();

// Request logging middleware (before body parsing)
app.use((req, res, next) => {
    console.log('\n📥 Incoming Request:');
    console.log('   Method:', req.method);
    console.log('   Path:', req.path);
    console.log('   Headers:', JSON.stringify(req.headers, null, 2));
    console.log('   Raw body (before parsing):', req.body);
    next();
});

// Middleware - IMPORTANT: Order matters!
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Body parsers with increased limits
app.use(express.json({
    limit: '50mb',
    strict: true,
    type: 'application/json'
}));
app.use(express.urlencoded({
    extended: true,
    limit: '50mb',
    parameterLimit: 50000
}));

// Log parsed body
app.use((req, res, next) => {
    console.log('   Parsed body:', JSON.stringify(req.body, null, 2));
    next();
});

// Import routes
const mechanicalRoutes = require('../routes/mechanical-simplified');

// Health check endpoint
app.get('/api/health', (req, res) => {
    try {
        const bedrockService = require('../services/bedrockService');
        const isConfigured = bedrockService.isConfigured();

        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            environment: process.env.STAGE || 'dev',
            region: process.env.AWS_REGION || 'unknown',
            node_version: process.version,
            bedrock_configured: isConfigured
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: 'Health check failed',
            message: error.message
        });
    }
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
            '/api/debug-echo - POST to test body parsing',
            '/api/mechanical/autonomous - FULLY AUTONOMOUS AI AGENT (Bedrock)',
            '/api/mechanical/autonomous/ui-control - UI CONTROLLED (Claude 4.5 + Gemini Vision + Playwright)',
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

// Debug endpoint - Echo everything received
app.post('/api/debug-echo', (req, res) => {
    res.json({
        success: true,
        received: {
            body: req.body,
            headers: req.headers,
            method: req.method,
            path: req.path,
            query: req.query
        }
    });
});

app.get('/api/debug-echo', (req, res) => {
    res.json({
        success: true,
        message: 'Send POST request to test body parsing',
        example: {
            url: '/api/debug-echo',
            method: 'POST',
            body: { prompt: 'test' }
        }
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

// Export handler for Lambda with proper configuration
module.exports.handler = serverless(app, {
    request: (request, event, context) => {
        // Log the raw Lambda event for debugging
        console.log('\n🔍 Lambda Event:', JSON.stringify({
            httpMethod: event.httpMethod,
            path: event.path,
            body: event.body,
            isBase64Encoded: event.isBase64Encoded,
            headers: event.headers
        }, null, 2));

        // Ensure body is properly decoded
        if (event.body && event.isBase64Encoded) {
            request.body = Buffer.from(event.body, 'base64').toString('utf-8');
        }
    }
});
