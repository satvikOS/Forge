/**
 * INTELLIGENT COMPONENT ANALYZER
 *
 * AI-powered system that analyzes ANY mechanical prompt and automatically
 * breaks it down into parallel components for production-ready generation.
 *
 * Handles cases where no template exists by using AI to understand the
 * mechanical system and create an optimal component breakdown.
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

class IntelligentComponentAnalyzer {
    constructor() {
        this.bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
        console.log('🧠 Intelligent Component Analyzer initialized');
    }

    /**
     * Analyze any mechanical prompt and create component breakdown
     *
     * @param {string} prompt - User's mechanical design request
     * @returns {Object} Component template with breakdown and positioning
     */
    async analyzeAndBreakdown(prompt) {
        console.log('\n🧠 === INTELLIGENT COMPONENT ANALYSIS ===');
        console.log(`   Analyzing: "${prompt.substring(0, 100)}..."`);

        try {
            // Call Claude to analyze the mechanical system
            const analysisPrompt = this.buildAnalysisPrompt(prompt);
            const analysis = await this.callClaude(analysisPrompt);

            console.log(`   ✅ Analysis complete:`);
            console.log(`      Component type: ${analysis.componentType}`);
            console.log(`      Complexity: ${analysis.complexity}`);
            console.log(`      Suggested components: ${analysis.components.length}`);
            console.log(`      Target vertices: ${analysis.targetVertices}`);

            // Convert analysis to template format
            const template = this.convertToTemplate(analysis, prompt);

            return template;

        } catch (error) {
            console.error('❌ Component analysis failed:', error.message);
            // Fallback to single-component mode
            return this.createFallbackTemplate(prompt);
        }
    }

    buildAnalysisPrompt(userPrompt) {
        return `You are a mechanical engineering expert. Analyze this CAD design request and break it down into parallel components for production-ready 3D modeling.

USER REQUEST: "${userPrompt}"

Your task: Create a detailed component breakdown for parallel generation.

ANALYSIS REQUIREMENTS:

1. IDENTIFY the mechanical system type:
   - Engine, transmission, pump, valve, gear, bearing, cylinder, motor, etc.
   - Complexity level: Simple (1-5 components), Medium (6-15), Complex (16-30), Very Complex (30+)

2. BREAK DOWN into logical components that can be generated in parallel:
   - Each component should be independently generatable
   - Components should have clear interfaces/connections
   - Consider manufacturing and assembly sequence
   - Aim for 500-800 vertices per component (max detail)

3. ASSIGN dependencies:
   - Base components have no dependencies
   - Dependent components reference their required predecessors
   - Create wave-based execution plan

4. DETERMINE 3D positioning:
   - Define coordinate system origin
   - Calculate exact position {x, y, z} for each component in millimeters
   - Determine rotation {x, y, z} in degrees if needed
   - Ensure no overlapping components (unless intentional like piston in cylinder)

5. WRITE detailed generation prompts:
   - Each component needs a specific prompt describing ONLY that component
   - Include dimensions, tolerances, features, materials
   - Reference industry standards where applicable

OUTPUT FORMAT (JSON):
{
  "componentType": "string (e.g., 'centrifugal_pump', 'spur_gear', 'ball_valve')",
  "complexity": "simple|medium|complex|very_complex",
  "targetVertices": <number (total across all components)>,
  "estimatedTime": "string (e.g., '3-5 minutes')",
  "coordinateSystem": {
    "origin": "string (describe origin point)",
    "xAxis": "string (describe positive X direction)",
    "yAxis": "string (describe positive Y direction)",
    "zAxis": "string (describe positive Z direction)",
    "units": "millimeters"
  },
  "components": [
    {
      "id": "string (lowercase_with_underscores)",
      "name": "string (Human-readable name)",
      "description": "string (What this component includes)",
      "targetVertices": <number (500-800 recommended)>,
      "priority": <number (wave number, starts at 1)>,
      "dependencies": ["array", "of", "component", "ids"],
      "position": {"x": <mm>, "y": <mm>, "z": <mm>},
      "rotation": {"x": <deg>, "y": <deg>, "z": <deg>},
      "scale": {"x": 1, "y": 1, "z": 1},
      "prompt": "string (Detailed generation prompt for THIS component only, 200-400 words)"
    }
  ]
}

GUIDELINES:
- For simple components (< 6 parts): Focus on detail within fewer components
- For complex assemblies (> 15 parts): Break into many parallel components
- Always include: Base structure, moving parts, fasteners, seals, bearings
- Position components in proper 3D space relative to coordinate origin
- Each prompt should result in 500-800 vertices of detailed geometry

CRITICAL: Generate a COMPLETE breakdown that enables production-ready detail.

BEGIN ANALYSIS:`;
    }

    async callClaude(prompt) {
        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 16000,
                temperature: 0.7,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        const response = await this.bedrock.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        let content = responseBody.content[0].text;

        // Parse JSON from response
        if (content.includes('```json')) {
            const match = content.match(/```json\n([\s\S]*?)\n```/);
            if (match) content = match[1];
        }

        return JSON.parse(content);
    }

    convertToTemplate(analysis, originalPrompt) {
        return {
            name: `${analysis.componentType} - AI Generated`,
            totalComponents: analysis.components.length,
            targetVertices: analysis.targetVertices,
            estimatedTime: analysis.estimatedTime,
            coordinateSystem: analysis.coordinateSystem,
            originalPrompt: originalPrompt,
            aiGenerated: true,
            components: analysis.components
        };
    }

    createFallbackTemplate(prompt) {
        console.warn('⚠️  Using fallback single-component template');

        return {
            name: 'Custom Component - Fallback Mode',
            totalComponents: 1,
            targetVertices: 2000,
            estimatedTime: '1-2 minutes',
            components: [
                {
                    id: 'full_component',
                    name: 'Complete Component',
                    description: 'Full component in single generation',
                    targetVertices: 2000,
                    priority: 1,
                    dependencies: [],
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                    prompt: `Generate the complete mechanical component as described:

"${prompt}"

Use ALL available output tokens for maximum geometry detail:
- Include all features, dimensions, and specifications mentioned
- Add manufacturing details: threads, chamfers, fillets, tolerances
- Generate 2000+ vertices for production-ready detail
- Follow industry standards for the component type

TARGET: 2000+ vertices
CRITICAL: Production-ready quality, complete detail`
                }
            ]
        };
    }

    /**
     * Quick check if we should use AI analysis or existing template
     */
    shouldUseAIAnalysis(prompt, existingTemplate) {
        // Use AI analysis if:
        // 1. No existing template found
        // 2. User specifically asks for custom/unique design
        // 3. Prompt contains dimensions/specifications not in template

        if (!existingTemplate) {
            return true;
        }

        const customKeywords = [
            'custom', 'special', 'unique', 'specific',
            'modified', 'variant', 'adaptation'
        ];

        const hasCustomRequest = customKeywords.some(keyword =>
            prompt.toLowerCase().includes(keyword)
        );

        return hasCustomRequest;
    }
}

module.exports = new IntelligentComponentAnalyzer();
