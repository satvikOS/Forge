/**
 * Gemini Vision Service
 * Uses Google's Gemini Pro Vision for screenshot analysis and visual validation
 * Complements Claude for cost-effective visual understanding
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiVisionService {
    constructor() {
        this.apiKey = process.env.GOOGLE_API_KEY;
        this.model = 'gemini-2.0-flash-exp'; // Latest Gemini with vision

        if (!this.apiKey) {
            console.warn('⚠️  GOOGLE_API_KEY not configured - Gemini Vision disabled');
            this.configured = false;
            return;
        }

        try {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.visionModel = this.genAI.getGenerativeModel({ model: this.model });
            this.configured = true;

            console.log('✅ Gemini Vision service initialized');
            console.log(`   Model: ${this.model}`);
        } catch (error) {
            console.error('❌ Failed to initialize Gemini Vision:', error);
            this.configured = false;
        }
    }

    /**
     * Check if service is configured
     */
    isConfigured() {
        return this.configured && this.visionModel;
    }

    /**
     * Analyze screenshot with prompt
     */
    async analyzeScreenshot(imageBuffer, prompt) {
        if (!this.isConfigured()) {
            throw new Error('Gemini Vision is not configured. Please set GOOGLE_API_KEY.');
        }

        try {
            console.log('👁️  Gemini Vision: Analyzing screenshot...');

            // Convert buffer to base64
            const base64Image = imageBuffer.toString('base64');

            // Prepare image part
            const imagePart = {
                inlineData: {
                    data: base64Image,
                    mimeType: 'image/png'
                }
            };

            // Generate content with vision
            const result = await this.visionModel.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();

            console.log('✅ Gemini Vision: Analysis complete');
            return text;
        } catch (error) {
            console.error('❌ Gemini Vision analysis failed:', error);
            throw error;
        }
    }

    /**
     * Validate CAD UI state from screenshot
     */
    async validateUIState(screenshot, expectedState) {
        const prompt = `Analyze this CAD software UI screenshot and validate the current state.

Expected State:
${JSON.stringify(expectedState, null, 2)}

Check:
1. Are the expected tools/buttons visible?
2. Is the viewport showing the correct view?
3. Are any error messages or warnings visible?
4. Does the current state match expectations?

Return JSON:
{
  "matches": true|false,
  "issues": ["list any discrepancies"],
  "currentState": "description of what you see",
  "confidence": 0-100
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Validate design output visually
     */
    async validateDesign(screenshot, requirements) {
        const prompt = `Analyze this 3D CAD design and validate against requirements.

Requirements:
${JSON.stringify(requirements, null, 2)}

Check:
1. Does the geometry match the requirements?
2. Are dimensions approximately correct?
3. Does it look structurally sound?
4. Are there any obvious defects or issues?

Return JSON:
{
  "valid": true|false,
  "issues": ["list any problems found"],
  "strengths": ["what looks good"],
  "recommendations": ["suggested improvements"],
  "confidence": 0-100
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Detect UI elements in screenshot
     */
    async detectUIElements(screenshot) {
        const prompt = `Analyze this CAD software UI and identify all visible UI elements.

List:
1. Toolbars and their buttons
2. Sidebar tools
3. Viewport content
4. Status messages
5. Modal dialogs or dropdowns
6. Input fields

Return JSON:
{
  "toolbars": ["list of visible toolbar buttons"],
  "sidebar": ["list of sidebar tools"],
  "viewport": "description of 3D view",
  "modals": ["any open dialogs"],
  "inputs": ["visible input fields"],
  "messages": ["status or error messages"]
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Find element location in screenshot
     */
    async findElement(screenshot, elementDescription) {
        const prompt = `Find the location of this UI element in the screenshot: "${elementDescription}"

Estimate the position as a percentage of screen width and height.

Return JSON:
{
  "found": true|false,
  "x": <percentage 0-100>,
  "y": <percentage 0-100>,
  "description": "what the element looks like",
  "confidence": 0-100
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Compare before/after screenshots
     */
    async compareScreenshots(beforeBuffer, afterBuffer, expectedChange) {
        const prompt = `Compare these two screenshots of a CAD application.

Expected Change: ${expectedChange}

Analyze what changed between the images and verify if the expected change occurred.

Return JSON:
{
  "changeDetected": true|false,
  "changesObserved": ["list of changes seen"],
  "matchesExpectation": true|false,
  "unexpectedChanges": ["any unexpected changes"],
  "confidence": 0-100
}`;

        try {
            const base64Before = beforeBuffer.toString('base64');
            const base64After = afterBuffer.toString('base64');

            const result = await this.visionModel.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Before,
                        mimeType: 'image/png'
                    }
                },
                'After:',
                {
                    inlineData: {
                        data: base64After,
                        mimeType: 'image/png'
                    }
                }
            ]);

            const response = await result.response;
            const text = response.text();
            return this.parseJSON(text);
        } catch (error) {
            console.error('Screenshot comparison failed:', error);
            throw error;
        }
    }

    /**
     * Measure features in design visually
     */
    async measureFeatures(screenshot, features) {
        const prompt = `Analyze this CAD design screenshot and estimate measurements for these features:

Features to measure:
${JSON.stringify(features, null, 2)}

Return JSON with estimated measurements:
{
  "measurements": [
    {
      "feature": "feature name",
      "estimated_value": number,
      "unit": "mm|cm|m",
      "confidence": 0-100,
      "notes": "any observations"
    }
  ]
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Detect errors or warnings in UI
     */
    async detectErrors(screenshot) {
        const prompt = `Analyze this CAD software UI for any errors, warnings, or issues.

Look for:
- Error messages or dialogs
- Warning icons
- Red highlighting
- Failed operations
- Validation errors

Return JSON:
{
  "hasErrors": true|false,
  "errors": ["list of errors found"],
  "warnings": ["list of warnings"],
  "severity": "none|low|medium|high|critical"
}`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return this.parseJSON(result);
    }

    /**
     * Parse JSON from response (handles markdown code blocks)
     */
    parseJSON(text) {
        try {
            // Try direct parse
            return JSON.parse(text);
        } catch (e) {
            // Try to extract from markdown
            const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1]);
                } catch (e2) {
                    console.error('Failed to parse JSON from markdown:', e2);
                }
            }

            // Try to find JSON object
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]);
                } catch (e3) {
                    console.error('Failed to parse JSON object:', e3);
                }
            }

            console.error('Could not extract JSON from Gemini response');
            return null;
        }
    }

    /**
     * Generate detailed description of CAD scene
     */
    async describeScene(screenshot) {
        const prompt = `Provide a detailed description of this CAD design.

Describe:
1. Overall shape and structure
2. Key features and components
3. Materials (if visible)
4. Dimensions (approximate)
5. Purpose or function (if identifiable)
6. Quality and completeness

Be thorough and technical.`;

        const result = await this.analyzeScreenshot(screenshot, prompt);
        return result;
    }
}

// Export singleton
module.exports = new GeminiVisionService();
