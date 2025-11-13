const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Environment variable validation
const requiredEnvVars = ['PORT', 'GEMINI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  console.warn(`⚠️  Missing environment variables: ${missingEnvVars.join(', ')}`);
  console.warn('⚠️  Running in demo mode');
} else if (process.env.GEMINI_API_KEY === 'demo-mode') {
  console.log('ℹ️  Running in demo mode - set GEMINI_API_KEY for AI features');
}

// Security middleware - helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for iframe scenarios
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'];
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));

// Rate limiting - protect API endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all API routes
app.use('/api/', limiter);

// Body parsing middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Import routes
const designRoutes = require('./routes/design');
const analysisRoutes = require('./routes/analysis');
const legalityRoutes = require('./routes/legality');
const generateRoutes = require('./routes/generate');
const downloadRoutes = require('./routes/download');

// Use routes
app.use('/api/design', designRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/legality', legalityRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/download', downloadRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  const geminiService = require('./services/geminiService');
  res.json({ 
    status: 'ok', 
    message: 'ArchDisc API is running',
    mode: geminiService.getStatus().mode,
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  
  // Don't expose internal errors in production
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'An error occurred processing your request' 
    : err.message;
  
  res.status(err.status || 500).json({ 
    error: 'Something went wrong!', 
    message: errorMessage,
  });
});

app.listen(PORT, () => {
  console.log(`\n✨ ArchDisc Backend Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 AI Mode: ${process.env.GEMINI_API_KEY === 'demo-mode' ? 'Demo' : 'Google Gemini'}`);
  console.log(`🌐 CORS Origins: ${allowedOrigins.join(', ')}\n`);
});

module.exports = app;
