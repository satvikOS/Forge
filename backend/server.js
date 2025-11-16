require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy - required when behind Vercel/reverse proxy
// This allows Express to correctly identify client IPs from X-Forwarded-* headers
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration
const allowedOriginsSet = new Set();

// Add origins from environment variable
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(origin => {
    allowedOriginsSet.add(origin.trim());
  });
}

// Allow localhost during development
if (process.env.NODE_ENV === 'development') {
  allowedOriginsSet.add('http://localhost:3000');
  allowedOriginsSet.add('http://localhost:5173');
}

// Convert Set to Array for easier use
const allowedOrigins = Array.from(allowedOriginsSet);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('CORS: No origin in request (allowing)');
      return callback(null, true);
    }

    // Check if origin ends with .vercel.app
    if (origin.endsWith('.vercel.app')) {
      console.log(`CORS allowed for Vercel deployment: ${origin}`);
      return callback(null, true);
    }

    // Check if origin is in allowedOrigins list
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log(`CORS allowed for whitelisted origin: ${origin}`);
      return callback(null, true);
    }

    // Block all other origins in production
    console.log(`CORS blocked for origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Import routes
const designRoutes = require('./routes/design');
const analysisRoutes = require('./routes/analysis');
const legalityRoutes = require('./routes/legality');
const generateRoutes = require('./routes/generate');
const downloadRoutes = require('./routes/download');

// API routes
app.use('/api/design', designRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/legality', legalityRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/download', downloadRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  
  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS policy violation',
      message: 'Origin not allowed'
    });
  }

  // Generic error handling
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log('CORS: All *.vercel.app domains are allowed');
});
