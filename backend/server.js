const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const multer = require('multer');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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
