// Serverless function entry point for all backend API routes
// This creates an Express app instance with all routes configured for Vercel deployment

// Load environment configuration
require('dotenv').config({ path: '../backend/.env' });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Create Express app
const app = express();

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration
const allowedOriginsSet = new Set();

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(origin => {
    allowedOriginsSet.add(origin.trim());
  });
}

if (process.env.NODE_ENV === 'development') {
  allowedOriginsSet.add('http://localhost:3000');
  allowedOriginsSet.add('http://localhost:5173');
}

const allowedOrigins = Array.from(allowedOriginsSet);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Import and mount routes from backend
const designRoutes = require('../backend/routes/design');
const analysisRoutes = require('../backend/routes/analysis');
const legalityRoutes = require('../backend/routes/legality');
const generateRoutes = require('../backend/routes/generate');
const downloadRoutes = require('../backend/routes/download');
const materialsRoutes = require('../backend/routes/materials');
const sketchfabRoutes = require('../backend/routes/sketchfab');
const orchestratorRoutes = require('../backend/routes/orchestrator');

// Mount routes (note: routes already have /api prefix from vercel.json rewrite)
app.use('/api/design', designRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/legality', legalityRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/sketchfab', sketchfabRoutes);
app.use('/api/orchestrate', orchestratorRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS policy violation',
      message: 'Origin not allowed'
    });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Export for Vercel serverless
module.exports = app;
