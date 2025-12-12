/**
 * Motion Capture API Routes
 * Handles video-based motion analysis using Gemini multimodal AI
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure multer for video uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/motion-capture');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'motion-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|mov|avi|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only video files are allowed (MP4, MOV, AVI, WEBM)'));
        }
    }
});

/**
 * POST /api/motion-capture/analyze
 * Analyze video for motion data using Gemini multimodal
 */
router.post('/analyze', upload.single('video'), async (req, res) => {
    let videoPath = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No video file uploaded'
            });
        }

        videoPath = req.file.path;
        const { fps = 30, analysisType = 'motion_capture' } = req.body;

        console.log(`🎬 Analyzing motion capture video: ${req.file.originalname}`);
        console.log(`   Size: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);

        // Initialize Gemini API
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

        // Read video file as base64
        const videoBuffer = fs.readFileSync(videoPath);
        const videoBase64 = videoBuffer.toString('base64');
        const mimeType = req.file.mimetype;

        // Create prompt for motion analysis
        const prompt = `Analyze this video for motion capture data. Extract the following information:

1. Character/Subject Motion:
   - Primary movements detected (walking, running, jumping, etc.)
   - Body parts involved
   - Movement patterns and timing

2. Key Poses/Keyframes:
   - Identify major pose changes
   - Approximate frame numbers for key poses
   - Joint positions and angles at key moments

3. Animation Data:
   - Duration of movement
   - Movement speed and rhythm
   - Looping potential

Return the analysis as JSON with this structure:
{
  "motion": {
    "type": "walk|run|jump|dance|custom",
    "description": "detailed description of motion",
    "duration": duration_in_seconds,
    "fps": ${fps},
    "keyframes": [
      {
        "frame": frame_number,
        "time": time_in_seconds,
        "pose": "description",
        "joints": {
          "pelvis": {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}},
          "spine": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "leftShoulder": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "rightShoulder": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "leftElbow": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "rightElbow": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "leftHip": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "rightHip": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "leftKnee": {"rotation": {"x": 0, "y": 0, "z": 0}},
          "rightKnee": {"rotation": {"x": 0, "y": 0, "z": 0}}
        }
      }
    ],
    "loops": true_or_false,
    "recommendations": "animation tips"
  }
}`;

        console.log('🤖 Sending video to Gemini for analysis...');

        // Send to Gemini for analysis
        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType,
                    data: videoBase64
                }
            },
            prompt
        ]);

        const response = await result.response;
        const text = response.text();

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Failed to extract motion data from AI response');
        }

        const motionData = JSON.parse(jsonMatch[0]);

        // Clean up uploaded file
        fs.unlinkSync(videoPath);

        console.log(`✅ Motion analysis complete: ${motionData.motion.type}`);

        res.json({
            success: true,
            motion: motionData.motion,
            videoInfo: {
                originalName: req.file.originalname,
                size: req.file.size,
                mimeType: req.file.mimetype
            },
            analyzedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error analyzing motion capture:', error);

        // Clean up file on error
        if (videoPath && fs.existsSync(videoPath)) {
            try {
                fs.unlinkSync(videoPath);
            } catch (unlinkError) {
                console.error('Failed to clean up video file:', unlinkError);
            }
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/motion-capture/supported-formats
 * Get list of supported video formats
 */
router.get('/supported-formats', (req, res) => {
    res.json({
        success: true,
        formats: [
            { extension: 'mp4', mimeType: 'video/mp4', description: 'MPEG-4 Video' },
            { extension: 'mov', mimeType: 'video/quicktime', description: 'QuickTime Video' },
            { extension: 'avi', mimeType: 'video/x-msvideo', description: 'AVI Video' },
            { extension: 'webm', mimeType: 'video/webm', description: 'WebM Video' }
        ],
        maxFileSize: '100MB',
        recommendedFps: [24, 30, 60]
    });
});

module.exports = router;
