const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const multer = require('multer');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Import AI service for validation
const aiService = require('./services/aiService');

// Validate API key on startup
(async () => {
  try {
    await aiService.validateApiKey();
  } catch (error) {
    console.error('⚠️  Startup validation warning:', error.message);
    console.error('⚠️  Server will continue but API functionality may be limited');
  }
})();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Import routes
const designRoutes = require('./routes/design');
const analysisRoutes = require('./routes/analysis');
const legalityRoutes = require('./routes/legality');

// Use routes
app.use('/api/design', designRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/legality', legalityRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'ArchDisc API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

app.listen(PORT, () => {
  console.log(`ArchDisc Backend Server running on port ${PORT}`);
});

module.exports = app;
