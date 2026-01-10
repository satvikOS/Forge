const { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const taxonomySystem = require('./taxonomySystem');

/**
 * AWS Bedrock Service - Handles AI interactions with AWS Bedrock multimodal API
 * Replaces geminiService.js with support for Claude 3.5, Stable Diffusion, and other foundation models
 * Designed for particle-level, super realistic 3D design generation
 */
class BedrockService {
    constructor() {
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.taxonomySystem = taxonomySystem;

        try {
            // Initialize Bedrock Runtime Client with explicit credential chain
            console.log('🔧 Initializing Bedrock client...');
            console.log('   Region:', this.region);
            console.log('   Environment:', process.env.AWS_EXECUTION_ENV || 'local');

            const clientConfig = {
                region: this.region,
                // Explicitly use credential provider chain (Lambda role -> env vars -> instance metadata)
                credentials: fromNodeProviderChain()
            };

            // Override with explicit credentials if provided
            if (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY) {
                console.log('📋 Overriding with BEDROCK_* credentials');
                clientConfig.credentials = {
                    accessKeyId: process.env.BEDROCK_ACCESS_KEY_ID,
                    secretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY
                };
            }

            this.client = new BedrockRuntimeClient(clientConfig);

            // Test credential resolution
            console.log('🔍 Credential provider configured successfully');

            // Model configuration - Use Claude Sonnet 4.5 via inference profile (required for on-demand)
            this.textModel = process.env.BEDROCK_TEXT_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
            this.fallbackModels = [
                'us.anthropic.claude-sonnet-4-5-20250929-v1:0'   // Claude Sonnet 4.5 via US inference profile (ONLY)
            ];
            this.imageModel = process.env.BEDROCK_IMAGE_MODEL || 'stability.stable-diffusion-xl-v1';
            this.videoModel = process.env.BEDROCK_VIDEO_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

            // Generation parameters
            // Increased to 8192 for complex CAD geometry generation (gears with many teeth, etc.)
            this.maxTokens = parseInt(process.env.BEDROCK_MAX_TOKENS || '8192');
            this.temperature = parseFloat(process.env.BEDROCK_TEMPERATURE || '0.7');

            console.log(`✅ AWS Bedrock service initialized`);
            console.log(`   Region: ${this.region}`);
            console.log(`   Text Model: ${this.textModel}`);
            console.log(`   Image Model: ${this.imageModel}`);
            this.configured = true;
        } catch (error) {
            console.error('❌ Failed to initialize AWS Bedrock:', error);
            console.error('   Error details:', error.message);
            this.configured = false;
        }

        this.maxRetries = 3;
        this.retryDelay = 1000; // ms
    }

    /**
     * Check if service is properly configured
     */
    isConfigured() {
        return Boolean(this.configured && this.client);
    }

    /**
     * Generate content using AWS Bedrock with retry logic
     * Primary method for text generation using Claude models
     */
    async generateContent(prompt, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('AWS Bedrock is not configured. Please set AWS credentials in environment variables.');
        }

        const maxRetries = options.maxRetries || this.maxRetries;
        const requestedModel = options.modelId || this.textModel;
        let lastError = null;

        // Try requested model first, then fallback models if access denied
        const modelsToTry = [requestedModel, ...this.fallbackModels.filter(m => m !== requestedModel)];

        console.log('\n=== 🤖 AWS Bedrock Request ===');
        console.log('📋 Request details:', {
            promptLength: prompt?.length,
            maxRetries,
            requestedModel,
            fallbackModels: modelsToTry.length - 1,
            region: this.region
        });

        // Try each model in order
        for (const modelId of modelsToTry) {
            console.log(`\n🔄 Trying model: ${modelId}`);

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`⏳ Attempt ${attempt}/${maxRetries} - Calling Bedrock API...`);

                    // Prepare request based on model type
                    let requestBody;
                    if (modelId.includes('anthropic.claude')) {
                        // Claude format
                        requestBody = {
                            anthropic_version: "bedrock-2023-05-31",
                            max_tokens: this.maxTokens,
                            temperature: this.temperature,
                            messages: [
                                {
                                    role: "user",
                                    content: prompt
                                }
                            ]
                        };
                    } else if (modelId.includes('amazon.titan')) {
                        // Titan format
                        requestBody = {
                            inputText: prompt,
                            textGenerationConfig: {
                                maxTokenCount: this.maxTokens,
                                temperature: this.temperature,
                                topP: 0.9
                            }
                        };
                    } else {
                        throw new Error(`Unsupported model type: ${modelId}`);
                    }

                    const command = new InvokeModelCommand({
                        modelId: modelId,
                        contentType: 'application/json',
                        accept: 'application/json',
                        body: JSON.stringify(requestBody)
                    });

                    const response = await this.client.send(command);
                    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

                    // Extract text based on model type
                    let text;
                    if (modelId.includes('anthropic.claude')) {
                        text = responseBody.content[0].text;
                    } else if (modelId.includes('amazon.titan')) {
                        text = responseBody.results[0].outputText;
                    }

                    console.log(`✅ SUCCESS with model ${modelId} on attempt ${attempt}!`);
                    console.log('📊 Response length:', text?.length);
                    console.log('=== End Bedrock Request ===\n');

                    return text;
                } catch (error) {
                    lastError = error;
                    console.error(`❌ Bedrock API error (model: ${modelId}, attempt ${attempt}/${maxRetries}):`, {
                        message: error.message,
                        code: error.code || error.name,
                        statusCode: error.$metadata?.httpStatusCode
                    });

                    // If access denied or model not found, try next model immediately
                    if (error.code === 'AccessDeniedException' ||
                        error.code === 'ResourceNotFoundException' ||
                        error.message?.includes('Could not resolve the foundation model')) {
                        console.warn(`⚠️  Model ${modelId} not accessible, trying next model...`);
                        break; // Break retry loop, try next model
                    }

                    // Don't retry on certain errors
                    if (error.code === 'ValidationException' ||
                        error.message?.includes('credentials') ||
                        error.message?.includes('quota')) {
                        console.error('🚫 Non-retryable error detected, throwing immediately');
                        throw error;
                    }

                    if (attempt < maxRetries) {
                        const delayMs = this.retryDelay * Math.pow(2, attempt - 1);
                        console.log(`⏸️  Waiting ${delayMs}ms before retry...`);
                        await this.delay(delayMs);
                    }
                }
            }
        }

        console.error('=== End Bedrock Request (FAILED) ===\n');
        console.error('❌ All models failed. Please enable Bedrock model access in AWS Console:');
        console.error('   https://console.aws.amazon.com/bedrock/');
        console.error('   Region: us-east-1');
        console.error('   Enable: Claude 3.5 Sonnet, Claude 3 Sonnet, or Claude Instant');
        throw new Error(`AWS Bedrock failed after trying ${modelsToTry.length} models: ${lastError?.message}`);
    }

    /**
     * Analyze a design prompt with full taxonomy support
     * This is the primary method for intelligent scene analysis
     * Preserves exact prompt engineering from geminiService.js
     */
    async analyzeTaxonomyPrompt(prompt) {
        // Build comprehensive system prompt with full taxonomy
        const taxonomyJSON = this.taxonomySystem.getTaxonomyForAI();

        const systemPrompt = `You are an EXPERT 3D architect and urban designer for ArchDisc, a professional 3D architectural and environmental design platform.

Your task is to analyze the user's prompt and extract structured information for ULTRA-REALISTIC, INDUSTRIAL-GRADE 3D scene generation with PARTICLE-LEVEL DETAIL.

For prompts like "recreate downtown manhattan":
- Analyze REAL-WORLD data (street layout, building types, landmarks)
- Generate detailed building specifications (heights, materials, architectural styles)
- Include infrastructure (roads, sidewalks, traffic lights, street furniture)
- Add environmental context (time of day, weather, lighting)
- Provide precise spatial coordinates and relationships

AVAILABLE TAXONOMY (Use this to classify and understand the prompt):
${taxonomyJSON}

CLASSIFICATION PRIORITIES:
1. Identify the primary category: settlement, environment, building, infrastructure, vehicle, or mixed scene
2. Determine the scale (from isolated dwelling to megalopolis, or object-specific scales)
3. Extract all specific elements mentioned
4. Identify architectural style/period if applicable
5. Note environmental context (terrain, water, vegetation)
6. Consider demographics if people/activity is mentioned

REALISTIC PLACEMENT RULES (CRITICAL):
- Buildings MUST be placed on flat ground or appropriate terrain
- Roads MUST connect buildings and follow logical paths
- Vehicles MUST be on roads, parking lots, or driveways
- Water features MUST be at appropriate elevations (rivers flow downhill)
- Trees and vegetation MUST be clustered naturally, not in perfect grids
- Objects MUST have realistic spacing based on their function
- Scale MUST be architecturally accurate (use taxonomy dimensions)
- Buildings in cities are closer together; rural buildings are spread out

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no code blocks) with this exact structure:
{
  "primaryCategory": "<settlement|landform|water_body|building|infrastructure|vehicle|vegetation|mixed>",
  "secondaryCategories": [<additional categories if it's a mixed scene>],
  "scale": {
    "type": "<micro|tiny|small|medium|large|very_large|massive>",
    "settlement": "<isolated_dwelling|hamlet|village|town|city|metropolis|megalopolis|conurbation|null>",
    "dimension": "<approximate overall size in meters>"
  },
  "style": {
    "architectural": "<modern|contemporary|futuristic|medieval|industrial|minimalist|classical|traditional|null>",
    "period": "<ancient|medieval|renaissance|industrial|modern|contemporary|futuristic|null>",
    "theme": "<urban|rural|coastal|desert|mountain|forest|space|null>"
  },
  "elements": [
    {
      "category": "<from taxonomy: settlements, landforms, water_bodies, residential, commercial, etc>",
      "subcategory": "<specific type from taxonomy>",
      "name": "<descriptive name>",
      "quantity": <number of instances>,
      "placement": {
        "priority": "primary|secondary|tertiary",
        "surface": "ground|water|air|elevated|underground",
        "clustering": "dense|moderate|sparse|scattered|linear",
        "spacing": <minimum distance between instances in meters>
      },
      "dimensions": {
        "width": <in meters>,
        "height": <in meters>,
        "depth": <in meters>,
        "calculated": "<how dimensions were determined>"
      },
      "materials": [<list of materials>],
      "features": [<specific features mentioned>]
    }
  ],
  "environmentalContext": {
    "terrain": "<flat|hilly|mountainous|varied|null>",
    "groundCover": "<grass|sand|concrete|asphalt|dirt|rock|null>",
    "waterPresence": "<none|pond|lake|river|ocean|wetland>",
    "vegetation": "<none|sparse|moderate|dense|forest>",
    "climate": "<tropical|temperate|arid|arctic|null>",
    "timeOfDay": "<dawn|day|dusk|night|unspecified>"
  },
  "spatialComposition": {
    "layout": "<grid|organic|linear|clustered|radial|scattered>",
    "centerPoint": "<what should be at the center>",
    "zones": [
      {
        "name": "<zone name like 'residential area', 'downtown'>",
        "elements": [<element indices that belong here>],
        "position": "<center|north|south|east|west|perimeter>"
      }
    ]
  },
  "realism": {
    "requiresRoads": <boolean>,
    "requiresTerrain": <boolean>,
    "requiresVegetation": <boolean>,
    "requiresLighting": <boolean>,
    "requiresWater": <boolean>,
    "detailLevel": "<low|medium|high|very_high|photorealistic>"
  },
  "demographics": {
    "applicable": <boolean>,
    "diversity": "<if applicable, note inclusive representation requirements>"
  }
}

For each building surface and element, specify:
- Material type: (concrete, glass, wood, metal, stone, brick, asphalt, etc.)
- Finish: (polished, rough, weathered, new)
- Context: (exterior, interior, ground-level, elevated)

Determine scene environment for realistic lighting and materials:
- Location: (urban, suburban, rural, nature, indoor, coastal, industrial)
- Time of day: (sunrise, morning, noon, afternoon, sunset, dusk, night)
- Weather: (clear, cloudy, overcast, rainy, foggy, snowy)
- Season: (spring, summer, fall, winter)

User prompt: ${prompt}

IMPORTANT: Ensure all dimensions are realistic and placement rules ensure proper spatial relationships. Every element must have clear placement instructions.`;

        try {
            console.log('🔍 Analyzing prompt with full taxonomy support...');
            const response = await this.generateContent(systemPrompt);
            if (response) {
                const parsed = this.parseStructuredResponse(response);
                if (parsed) {
                    console.log('✅ Taxonomy analysis successful');
                    return parsed;
                }
            }
        } catch (error) {
            console.error('Error analyzing prompt with taxonomy:', error);
        }

        console.log('⚠️  Falling back to basic analysis...');
        return this.analyzePrompt(prompt); // Fallback to existing method
    }

    /**
     * Analyze a taxonomy prompt WITH real-world data from Wikipedia/Wikidata/Geographic services
     * This method enhances AI analysis by incorporating actual building dimensions, materials, and environmental data
     */
    async analyzeTaxonomyPromptWithRealData(prompt, realWorldData) {
        console.log('🤖 Bedrock: Analyzing prompt WITH real-world data integration...');

        // Build comprehensive system prompt with taxonomy AND real-world data
        const taxonomyJSON = this.taxonomySystem.getTaxonomyForAI();

        let realDataContext = '';
        if (realWorldData) {
            realDataContext = `\n\nREAL-WORLD DATA PROVIDED (USE THIS FOR ACCURATE GENERATION):
${JSON.stringify(realWorldData, null, 2)}

CRITICAL INSTRUCTIONS FOR REAL-WORLD LANDMARK GENERATION:
**YOU MUST RETRIEVE AND PROVIDE COMPLETE STRUCTURAL DETAILS FOR LANDMARKS**

When a famous landmark is mentioned (Eiffel Tower, Empire State Building, Burj Khalifa, etc.):
1. **USE EXACT LANDMARK NAME**: Element "name" field MUST be the exact full landmark name
   - ✅ CORRECT: "Eiffel Tower", "Burj Khalifa", "Taj Mahal"
   - ❌ WRONG: "Tower", "Building", "Monument", "Structure"
2. **USE EXACT DIMENSIONS**: Height, width, base dimensions from Wikipedia/Wikidata (IN METERS!)
   - Eiffel Tower: width=125, height=324, depth=125
   - Empire State Building: width=129, height=443, depth=61
   - Burj Khalifa: width=250, height=828, depth=250
3. **STRUCTURAL DETAILS**: Describe the building's construction method (brick-by-brick, smallest unit)
   - For Eiffel Tower: Iron lattice framework with 4 curved legs, 3 platforms at 57m/115m/276m, cross-bracing pattern
   - For skyscrapers: Floor-by-floor structure, setbacks at specific floors, facade material, window patterns
   - For historical: Construction materials (stone, brick, wood), architectural style details
4. **MATERIAL SPECIFICATIONS**: Exact materials used in real construction
   - Eiffel Tower: wrought_iron, steel
   - Empire State Building: limestone, granite, aluminum, glass
   - Taj Mahal: white_marble, red_sandstone
5. **ARCHITECTURAL FEATURES**: ALL key structural elements that make it INSTANTLY recognizable
   - Eiffel Tower: four_curved_legs, lattice_framework, three_observation_platforms, tapered_structure, antenna_spire
   - Burj Khalifa: Y_shaped_floor_plan, setback_at_each_tier, spire, aluminum_and_glass_facade
   - Sydney Opera House: shell_like_roof_structures, podium_base, harbor_location
6. **BUILD FROM BOTTOM-UP**: Describe construction sequence starting from foundation
7. **SET detailLevel to "photorealistic"**: This ensures maximum quality generation

If Wikipedia/Wikidata dimensions are provided, USE THEM EXACTLY (don't estimate)
If geographic/map data provided, INCORPORATE ALL buildings, roads, environmental features
Maintain realistic proportions relative to provided real-world data
`;
        }

        const systemPrompt = `You are an EXPERT 3D architect and urban designer for ArchDisc, a professional 3D architectural and environmental design platform.

Your task is to analyze the user's prompt and extract structured information for ULTRA-REALISTIC, INDUSTRIAL-GRADE, PARTICLE-LEVEL 3D scene generation.

${realDataContext}

AVAILABLE TAXONOMY (Use this to classify and understand the prompt):
${taxonomyJSON}

CLASSIFICATION PRIORITIES:
1. Identify the primary category: settlement, environment, building, infrastructure, vehicle, or mixed scene
2. Determine the scale (from isolated dwelling to megalopolis, or object-specific scales)
3. Extract all specific elements mentioned
4. Identify architectural style/period if applicable
5. Note environmental context (terrain, water, vegetation)
6. Consider demographics if people/activity is mentioned

REALISTIC PLACEMENT RULES (CRITICAL):
- Buildings MUST be placed on flat ground or appropriate terrain
- Roads MUST connect buildings and follow logical paths
- Vehicles MUST be on roads, parking lots, or driveways
- Water features MUST be at appropriate elevations (rivers flow downhill)
- Trees and vegetation MUST be clustered naturally, not in perfect grids
- Objects MUST have realistic spacing based on their function
- Scale MUST be architecturally accurate (use taxonomy dimensions OR real-world data)
- Buildings in cities are closer together; rural buildings are spread out

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no code blocks) with this exact structure:
{
  "primaryCategory": "<settlement|landform|water_body|building|infrastructure|vehicle|vegetation|mixed>",
  "secondaryCategories": [<additional categories if it's a mixed scene>],
  "scale": {
    "type": "<micro|tiny|small|medium|large|very_large|massive>",
    "settlement": "<isolated_dwelling|hamlet|village|town|city|metropolis|megalopolis|conurbation|null>",
    "dimension": "<approximate overall size in meters>"
  },
  "style": {
    "architectural": "<modern|contemporary|futuristic|medieval|industrial|minimalist|classical|traditional|null>",
    "period": "<ancient|medieval|renaissance|industrial|modern|contemporary|futuristic|null>",
    "theme": "<urban|rural|coastal|desert|mountain|forest|space|null>"
  },
  "elements": [
    {
      "category": "<from taxonomy>",
      "subcategory": "<specific type>",
      "name": "<descriptive name - MUST be exact landmark name if famous landmark>",
      "quantity": <number of instances>,
      "placement": {
        "priority": "primary|secondary|tertiary",
        "surface": "ground|water|air|underground",
        "clustering": "none|scattered|moderate|dense",
        "spacing": <meters between instances>
      },
      "dimensions": {
        "width": <meters>,
        "height": <meters>,
        "depth": <meters>,
        "calculated": "<explanation of dimension source>"
      },
      "materials": [<exact material names from real construction>],
      "features": [<ALL architectural/structural features that make it recognizable>],
      "structuralDetails": {
        "constructionMethod": "<how it was built: brick-by-brick, prefabricated, etc.>",
        "foundationType": "<foundation details>",
        "primaryStructure": "<main structural elements>",
        "supportElements": "<beams, columns, bracing, etc.>",
        "platforms": "<observation decks, floors, etc.>",
        "decorativeElements": "<unique identifying features>"
      }
    }
  ],
  "environmentalContext": {
    "terrain": "<flat|hilly|mountainous|coastal|valley>",
    "groundCover": "<grass|sand|dirt|concrete|asphalt|water>",
    "timeOfDay": "<dawn|day|dusk|night>",
    "weather": "<clear|cloudy|rainy|snowy|foggy>",
    "season": "<spring|summer|fall|winter>"
  },
  "spatialComposition": {
    "layout": "<grid|organic|linear|radial|cluster|scattered>",
    "density": "<sparse|low|medium|high|very_high>",
    "zones": [
      {
        "name": "<zone name>",
        "elements": [<element indices>],
        "position": "<center|north|south|east|west|perimeter>"
      }
    ]
  },
  "realism": {
    "requiresRoads": <boolean>,
    "requiresTerrain": <boolean>,
    "requiresVegetation": <boolean>,
    "requiresLighting": <boolean>,
    "requiresWater": <boolean>,
    "detailLevel": "<low|medium|high|very_high|photorealistic>"
  }
}

Remember: If real-world data is provided, YOUR PRIMARY DUTY is to incorporate it accurately with PARTICLE-LEVEL DETAIL!

User prompt: ${prompt}`;

        try {
            const result = await this.generateContent(systemPrompt);
            if (!result) return null;

            let parsed = this.parseJSON(result);

            if (parsed && parsed.primaryCategory) {
                console.log(`✅ Bedrock taxonomy analysis with real-world data complete: ${parsed.primaryCategory}`);

                // Log if real-world data was incorporated
                if (realWorldData) {
                    console.log('✅ Real-world data successfully incorporated into analysis');
                    parsed.realWorldDataSource = realWorldData.source || 'unknown';
                }

                return parsed;
            }

            console.warn('⚠️  Parsed result missing primaryCategory');
            return null;
        } catch (error) {
            console.error('Error analyzing prompt with real-world data:', error);
            // Fallback to standard taxonomy analysis
            console.log('⚠️  Falling back to standard taxonomy analysis...');
            return this.analyzeTaxonomyPrompt(prompt);
        }
    }

    /**
     * Analyze a design prompt and extract structured information
     * Enhanced for complex architectural prompts with detailed features
     */
    async analyzePrompt(prompt) {
        const systemPrompt = `You are an expert AI assistant for ArchDisc, a professional 3D architectural design platform.
Analyze the user's design request and extract detailed structured information for PARTICLE-LEVEL 3D generation.

IMPORTANT: For architectural prompts, extract ALL specific details mentioned:
- Number of stories/floors
- Building types (office, retail, residential, etc.)
- Architectural features (curtain walls, atriums, gardens, etc.)
- Materials and facade details
- Structural elements (columns, beams, etc.)
- Windows, doors, balconies
- Special features (underground parking, rooftop elements, etc.)

For dimensions:
- Use realistic architectural scales (in millimeters)
- Standard floor height: 3000-4000mm per floor
- Typical building widths: 15000-50000mm
- Calculate total height: floors × floor_height

Return a JSON object with this structure:
{
  "objectCount": <total number of distinct building/structure elements>,
  "objectTypes": [<array of object types like "building", "structure", "landscape">],
  "scene": {
    "type": "<single_building|complex|campus|urban>",
    "complexity": "<low|medium|high|very_high>",
    "style": "<modern|contemporary|industrial|futuristic|classical|minimalist|brutalist|etc>",
    "scale": "<small|medium|large|massive>"
  },
  "elements": [
    {
      "type": "building",
      "name": "<descriptive name like 'Office Tower', 'Museum Wing'>",
      "quantity": <number if multiple similar buildings>,
      "dimensions": {
        "width": <number in mm>,
        "height": <number in mm, calculated as floors × floor_height>,
        "depth": <number in mm>
      },
      "floors": <number of stories>,
      "materials": [<"glass", "concrete", "metal", "stone", "brick", "wood">],
      "details": [<ALL mentioned features>]
    }
  ],
  "requirements": {
    "detailLevel": "<high for complex buildings, very_high for landmark structures, photorealistic for ultra-realism>",
    "materials": [<all materials mentioned>],
    "features": [<all special features and architectural elements mentioned>],
    "functionalSpaces": [<list of functional areas like "retail", "office", "parking">]
  }
}

User prompt: ${prompt}

CRITICAL: Return ONLY valid JSON. Set detailLevel to "photorealistic" for maximum quality.`;

        try {
            const response = await this.generateContent(systemPrompt);
            if (response) {
                const parsed = this.parseStructuredResponse(response);
                if (parsed) {
                    console.log('✅ Basic prompt analysis successful');
                    return parsed;
                }
            }
        } catch (error) {
            console.error('Error with basic prompt analysis:', error);
        }

        return null;
    }

    /**
     * Generate an image using Stable Diffusion on Bedrock
     */
    async generateImage(prompt, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('AWS Bedrock is not configured');
        }

        console.log('🎨 Generating image with Stable Diffusion...');

        const requestBody = {
            text_prompts: [
                {
                    text: prompt,
                    weight: 1.0
                }
            ],
            cfg_scale: options.cfg_scale || 7,
            steps: options.steps || 50,
            seed: options.seed || Math.floor(Math.random() * 1000000),
            width: options.width || 1024,
            height: options.height || 1024
        };

        try {
            const command = new InvokeModelCommand({
                modelId: this.imageModel,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(requestBody)
            });

            const response = await this.client.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            console.log('✅ Image generation successful');
            return responseBody.artifacts[0].base64;
        } catch (error) {
            console.error('❌ Image generation failed:', error);
            throw error;
        }
    }

    /**
     * Parse JSON from AI response (handles markdown code blocks)
     */
    parseJSON(text) {
        // VERSION STAMP - DO NOT REMOVE
        console.log('🔥🔥🔥 parseJSON VERSION 2.1.0-json-fix-DEPLOYED-JAN9-2026 🔥🔥🔥');

        try {
            // Validate input
            if (!text || typeof text !== 'string') {
                console.error('❌ Invalid input to parseJSON:', typeof text);
                return null;
            }

            // Try direct JSON parse first
            try {
                return JSON.parse(text);
            } catch (directParseError) {
                console.log('📝 Direct JSON parse failed, trying alternative extraction methods...');
            }

            // Try to extract JSON from markdown code blocks
            // Look for ```json or ``` followed by JSON
            try {
                console.log('🔍 Checking for markdown code blocks...');
                console.log('   Text starts with:', text.substring(0, 50));
                console.log('   Text length:', text.length);
                console.log('   Contains backticks:', text.includes('```'));

                // Try multiple regex patterns to detect markdown
                const patterns = [
                    /```json\s*([\s\S]*?)```/,     // ```json ... ```
                    /```\s*([\s\S]*?)```/,          // ``` ... ```
                    /```json\s*([\s\S]*)/,          // ```json ... (no closing)
                ];

                let extracted = null;
                let patternUsed = -1;

                for (let i = 0; i < patterns.length; i++) {
                    const match = text.match(patterns[i]);
                    if (match && match[1]) {
                        console.log(`✅ Pattern ${i} matched! Extracting content...`);
                        patternUsed = i;
                        extracted = match[1].trim();
                        break;
                    }
                }

                if (extracted) {
                    console.log('📦 Extracted content length:', extracted.length);
                    console.log('   First 100 chars:', extracted.substring(0, 100));

                    // Try direct parse first (extracted content should be clean JSON)
                    try {
                        console.log('🎯 Attempting direct JSON.parse on extracted content...');
                        const parsed = JSON.parse(extracted);
                        console.log('✅ Successfully parsed JSON directly from markdown (pattern ' + patternUsed + ')');
                        return parsed;
                    } catch (directParseError) {
                        console.log('   Direct parse failed:', directParseError.message);
                        console.log('   Falling back to balanced extraction...');
                    }

                    // Fallback: Use balanced JSON extraction on the code block content
                    const balancedJSON = this.extractBalancedJSON(extracted);
                    if (balancedJSON) {
                        try {
                            const parsed = JSON.parse(balancedJSON);
                            console.log('✅ Successfully parsed JSON from markdown code block after balanced extraction (pattern ' + patternUsed + ')');
                            return parsed;
                        } catch (e2) {
                            console.error('Failed to parse extracted JSON from code block:', e2.message);
                        }
                    } else {
                        console.error('❌ extractBalancedJSON returned null');
                    }
                } else {
                    console.log('❌ No markdown code block patterns matched');
                }
            } catch (codeBlockError) {
                console.error('💥 Error during markdown extraction:', codeBlockError.message);
            }

            // Try to find balanced JSON object by parsing character by character
            try {
                console.log('Attempting balanced JSON extraction from full text...');
                const extracted = this.extractBalancedJSON(text);
                if (extracted) {
                    try {
                        const parsed = JSON.parse(extracted);
                        console.log('✅ Successfully parsed JSON using balanced extraction');
                        return parsed;
                    } catch (e3) {
                        console.error('Failed to parse extracted JSON:', e3.message);
                        console.error('Extracted text (first 500 chars):', extracted.substring(0, 500));
                    }
                }
            } catch (balancedError) {
                console.error('Error during balanced extraction:', balancedError.message);
            }

            console.error('Could not extract valid JSON from response');
            console.error('Response text (first 500 chars):', text.substring(0, 500));
            return null;

        } catch (outerError) {
            console.error('💥 Critical error in parseJSON:', outerError.message);
            console.error('Stack:', outerError.stack);
            return null;
        }
    }

    /**
     * Extract balanced JSON object from text (handles nested braces correctly)
     */
    extractBalancedJSON(text) {
        try {
            console.log('🔧 extractBalancedJSON called');

            // Validate input
            if (!text || typeof text !== 'string') {
                console.error('   ❌ Invalid input type:', typeof text);
                return null;
            }

            console.log('   Text length:', text.length);
            console.log('   First 50 chars:', text.substring(0, 50));

            // Find the first opening brace
            const startIndex = text.indexOf('{');
            if (startIndex === -1) {
                console.error('   ❌ No opening brace found');
                return null;
            }

            console.log('   Start index:', startIndex);

            let braceCount = 0;
            let inString = false;
            let escapeNext = false;

            // Limit iteration to prevent infinite loops
            const maxLength = Math.min(text.length, 500000); // 500KB max
            console.log('   Max length for parsing:', maxLength);

            for (let i = startIndex; i < maxLength; i++) {
                const char = text[i];

                // Handle escape sequences
                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }
                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }

                // Handle strings
                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                // Only count braces outside of strings
                if (!inString) {
                    if (char === '{') {
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        // When braces are balanced, we found the complete JSON
                        if (braceCount === 0) {
                            const extracted = text.substring(startIndex, i + 1);
                            console.log('   ✅ Found balanced JSON at position', i);
                            console.log('   Extracted length:', extracted.length);
                            return extracted;
                        }
                    }
                }
            }

            console.error('   ❌ Loop completed without finding balanced JSON');
            console.error('   Final braceCount:', braceCount);
            return null; // No balanced JSON found
        } catch (error) {
            console.error('💥 Error in extractBalancedJSON:', error.message);
            return null;
        }
    }

    /**
     * Parse structured response with validation
     */
    parseStructuredResponse(response) {
        const parsed = this.parseJSON(response);
        if (!parsed) return null;

        // Validate required fields
        if (!parsed.primaryCategory && !parsed.objectTypes && !parsed.scene) {
            console.warn('Response missing required structure');
            return null;
        }

        return parsed;
    }

    /**
     * Utility: Delay for retry logic
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new BedrockService();
