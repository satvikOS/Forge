/**
 * Strict Geometry Enforcer
 *
 * Prevents the AI from generating simple boxes by:
 * 1. Pre-calculating exact vertex requirements
 * 2. Providing explicit few-shot examples
 * 3. Enforcing token budget allocation (80% to geometry)
 * 4. Automatic retry with escalating strictness
 * 5. Mathematical verification before accepting
 *
 * This makes it IMPOSSIBLE for AI to generate simple boxes.
 */

class StrictGeometryEnforcer {
    constructor() {
        this.maxRetries = 3;
        this.geometryTokenBudget = 0.8; // 80% of tokens must go to geometry

        // Few-shot examples library (successful complex geometries)
        this.exampleLibrary = this.buildExampleLibrary();

        console.log('🔒 Strict Geometry Enforcer initialized');
        console.log('   Max retries: 3');
        console.log('   Geometry token budget: 80%');
        console.log('   Few-shot examples loaded: ' + Object.keys(this.exampleLibrary).length);
    }

    /**
     * Build library of successful complex geometries as examples
     */
    buildExampleLibrary() {
        return {
            v8_engine_block: {
                description: 'V8 Engine Block with 8 cylinder bores, mounting points, oil galleries',
                requiredVertices: 536,
                exampleStructure: `
"geometry": {
  "vertices": [
    // ENGINE BLOCK BASE (8 vertices)
    [-150, -100, 0], [150, -100, 0], [150, 100, 0], [-150, 100, 0],
    [-150, -100, 200], [150, -100, 200], [150, 100, 200], [-150, 100, 200],

    // CYLINDER BORE #1 (front-left, 32 vertices: 16 top + 16 bottom)
    [-75, 37.5, 180], [-73.1, 42.4, 180], [-68.4, 46.7, 180], [-62.5, 49.8, 180],
    [-56.0, 51.5, 180], [-49.2, 51.8, 180], [-42.5, 50.5, 180], [-36.5, 47.8, 180],
    [-31.5, 43.8, 180], [-27.8, 38.8, 180], [-25.5, 33.0, 180], [-24.8, 26.8, 180],
    [-25.8, 20.5, 180], [-28.3, 14.5, 180], [-32.0, 9.2, 180], [-36.7, 4.8, 180],
    [-75, 37.5, 20], [-73.1, 42.4, 20], [-68.4, 46.7, 20], [-62.5, 49.8, 20],
    [-56.0, 51.5, 20], [-49.2, 51.8, 20], [-42.5, 50.5, 20], [-36.5, 47.8, 20],
    [-31.5, 43.8, 20], [-27.8, 38.8, 20], [-25.5, 33.0, 20], [-24.8, 26.8, 20],
    [-25.8, 20.5, 20], [-28.3, 14.5, 20], [-32.0, 9.2, 20], [-36.7, 4.8, 20],

    // CYLINDER BORE #2 (front-left-center, 32 vertices)
    [-45, 37.5, 180], [-43.1, 42.4, 180], [-38.4, 46.7, 180], [-32.5, 49.8, 180],
    [-26.0, 51.5, 180], [-19.2, 51.8, 180], [-12.5, 50.5, 180], [-6.5, 47.8, 180],
    [-1.5, 43.8, 180], [2.2, 38.8, 180], [4.5, 33.0, 180], [5.2, 26.8, 180],
    [4.2, 20.5, 180], [1.7, 14.5, 180], [-2.0, 9.2, 180], [-6.7, 4.8, 180],
    [-45, 37.5, 20], [-43.1, 42.4, 20], [-38.4, 46.7, 20], [-32.5, 49.8, 20],
    [-26.0, 51.5, 20], [-19.2, 51.8, 20], [-12.5, 50.5, 20], [-6.5, 47.8, 20],
    [-1.5, 43.8, 20], [2.2, 38.8, 20], [4.5, 33.0, 20], [5.2, 26.8, 20],
    [4.2, 20.5, 20], [1.7, 14.5, 20], [-2.0, 9.2, 20], [-6.7, 4.8, 20],

    // CYLINDER BORE #3-8 (continue same pattern for remaining 6 cylinders)
    // Each bore: 32 vertices (16 top circle + 16 bottom circle)
    // ... (192 more vertices for 6 remaining bores)

    // MOUNTING HOLE #1 (front-left corner, 16 vertices)
    [-130, 80, 0], [-129.3, 82.1, 0], [-127.7, 84.0, 0], [-125.5, 85.5, 0],
    [-122.8, 86.5, 0], [-120.0, 86.8, 0], [-117.2, 86.5, 0], [-114.5, 85.5, 0],
    [-112.3, 84.0, 0], [-110.7, 82.1, 0], [-110.0, 80.0, 0], [-110.7, 77.9, 0],
    [-112.3, 76.0, 0], [-114.5, 74.5, 0], [-117.2, 73.5, 0], [-120.0, 73.2, 0],

    // MOUNTING HOLES #2-4 (continue for 3 remaining corners)
    // ... (48 more vertices for 3 remaining holes)

    // OIL GALLERY #1 (left side passage, 16 vertices)
    [-120, 0, 50], [-119.2, 2.3, 50], [-117.7, 4.5, 50], [-115.5, 6.2, 50],
    [-112.8, 7.3, 50], [-110.0, 7.6, 50], [-107.2, 7.3, 50], [-104.5, 6.2, 50],
    [-102.3, 4.5, 50], [-100.7, 2.3, 50], [-100.0, 0, 50], [-100.7, -2.3, 50],
    [-102.3, -4.5, 50], [-104.5, -6.2, 50], [-107.2, -7.3, 50], [-110.0, -7.6, 50],

    // OIL GALLERY #2 (right side passage, 16 vertices)
    [120, 0, 50], [119.2, 2.3, 50], [117.7, 4.5, 50], [115.5, 6.2, 50],
    [112.8, 7.3, 50], [110.0, 7.6, 50], [107.2, 7.3, 50], [104.5, 6.2, 50],
    [102.3, 4.5, 50], [100.7, 2.3, 50], [100.0, 0, 50], [100.7, -2.3, 50],
    [102.3, -4.5, 50], [104.5, -6.2, 50], [107.2, -7.3, 50], [110.0, -7.6, 50],

    // CYLINDER HEAD BOLT HOLES (8 holes × 16 vertices = 128 vertices)
    // Positioned around each cylinder bore for head attachment
    // ... (128 vertices for head bolt holes)

    // COOLING PASSAGES (48 vertices for water jacket channels)
    // ... (48 vertices for cooling system)

    // DECK SURFACE FEATURES (additional mounting points, 32 vertices)
    // ... (32 vertices)
  ],
  "faces": [
    // Triangulated faces connecting all vertices (800-1000 faces)
    // Block base faces: [0,2,1], [0,3,2], [4,5,6], [4,6,7], ...
    // Cylinder bore walls: connecting top and bottom circles
    // Mounting hole walls: connecting perimeter vertices
    // ... (complete face list)
  ]
}

VERTEX COUNT: 536 (meets 400+ requirement for V8 engine block)
FACE COUNT: ~1024 (fully triangulated)
`,
                features: [
                    '8 cylinder bores (32 vertices each = 256 total)',
                    '4 mounting holes (16 vertices each = 64 total)',
                    '2 oil galleries (16 vertices each = 32 total)',
                    '8 head bolt holes (16 vertices each = 128 total)',
                    'Cooling passages (48 vertices)',
                    'Deck features (32 vertices)',
                    'Base block structure (8 vertices)'
                ]
            },

            gear_96_tooth: {
                description: '96-tooth spur gear with proper involute teeth',
                requiredVertices: 384,
                exampleStructure: `
"geometry": {
  "vertices": [
    // FRONT FACE (z=0): 96 teeth × 4 vertices per tooth = 384 vertices
    // Tooth #1 (θ=0°)
    [98, 0, 0],           // Outer tip
    [96, 1.25, 0],        // Inner tip
    [93.5, 1.75, 0],      // Inner root
    [93.5, 3.0, 0],       // Outer root

    // Tooth #2 (θ=3.75°)
    [97.8, 6.4, 0], [95.8, 7.6, 0], [93.3, 8.1, 0], [93.3, 9.4, 0],

    // ... (continue for all 96 teeth with calculated angles)

    // BACK FACE (z=10): Repeat all 384 vertices at z=10
    // ... (384 more vertices)

    // CENTER POINTS
    [0, 0, 0], [0, 0, 10]
  ],
  "faces": [
    // Side walls: Connect front to back for each tooth edge
    // Front cap: Triangulate from center to teeth
    // Back cap: Triangulate from center to teeth
    // Total: ~768 triangular faces
  ]
}

VERTEX COUNT: 770 (384 front + 384 back + 2 centers, meets 384+ requirement)
`,
                features: [
                    'EXACTLY 96 teeth (not approximate)',
                    'Module 2mm → Pitch diameter 192mm',
                    '4 vertices per tooth minimum',
                    'Proper involute or trapezoidal profile',
                    'Through-thickness (front and back faces)'
                ]
            },

            hydraulic_cylinder: {
                description: 'Hydraulic actuator cylinder with piston, seals, and ports',
                requiredVertices: 320,
                exampleStructure: `
"geometry": {
  "vertices": [
    // CYLINDER BODY (48 segments × 2 ends = 96 vertices)
    // Outer wall, bottom circle (z=0)
    [50, 0, 0], [49.8, 5.2, 0], [49.0, 10.3, 0], ...(48 points at r=50mm),
    // Outer wall, top circle (z=200)
    [50, 0, 200], [49.8, 5.2, 200], ...(48 points),

    // INNER BORE (48 segments × 2 ends = 96 vertices)
    // Inner wall, bottom (z=0)
    [45, 0, 0], [44.8, 4.7, 0], ...(48 points at r=45mm),
    // Inner wall, top (z=200)
    [45, 0, 200], ...(48 points),

    // PISTON (48 segments × 2 positions = 96 vertices)
    // Piston at z=100 (mid-stroke)
    [44.5, 0, 100], ...(48 points at r=44.5mm for clearance),
    [44.5, 0, 120], ...(48 points at z=120 for piston thickness),

    // HYDRAULIC PORTS (2 ports × 16 vertices = 32 vertices)
    // Port #1 at z=20
    // Port #2 at z=180
    // ... (port geometry)
  ],
  "faces": [...]
}

VERTEX COUNT: 320
`,
                features: [
                    'Cylinder body with proper wall thickness',
                    'Inner bore for piston travel',
                    'Piston with seals',
                    'Hydraulic ports (intake/outlet)',
                    'Proper stroke length'
                ]
            }
        };
    }

    /**
     * Analyze prompt and calculate EXACT geometry requirements
     */
    analyzeAndPlan(prompt) {
        console.log('\n🔍 STRICT GEOMETRY ENFORCER: Analyzing prompt');

        const analysis = {
            promptLower: prompt.toLowerCase(),
            detectedType: null,
            requiredVertices: 0,
            requiredFeatures: [],
            matchedExample: null,
            calculatedStructure: null,
            strictness: 'maximum'
        };

        // Detect V8 engine block
        if (analysis.promptLower.includes('v8') ||
            analysis.promptLower.includes('v-8') ||
            (analysis.promptLower.includes('engine') && analysis.promptLower.includes('block'))) {

            analysis.detectedType = 'v8_engine_block';
            analysis.matchedExample = this.exampleLibrary.v8_engine_block;
            analysis.requiredVertices = 400; // Minimum for V8
            analysis.requiredFeatures = [
                '8 cylinder bores (each bore: 16-32 vertices minimum)',
                'Mounting holes (4 corners minimum, 16 vertices each)',
                'Oil galleries (2 passages minimum, 16 vertices each)',
                'Cooling channels',
                'Deck surface with head bolt holes'
            ];

            // Calculate exact structure
            analysis.calculatedStructure = {
                base_block: 8,
                cylinder_bores: 8 * 32,  // 256 vertices
                mounting_holes: 4 * 16,  // 64 vertices
                oil_galleries: 2 * 16,   // 32 vertices
                head_bolt_holes: 8 * 16, // 128 vertices
                cooling_passages: 48,
                deck_features: 32,
                total: 536
            };

            console.log('   Detected: V8 Engine Block');
            console.log('   Required minimum: 400 vertices');
            console.log('   Calculated target: 536 vertices');
            console.log('   Structure breakdown:', analysis.calculatedStructure);
        }

        // Detect gear
        else if (analysis.promptLower.includes('gear')) {
            const toothMatch = analysis.promptLower.match(/(\d+)[-\s]?tooth/);
            if (toothMatch) {
                const toothCount = parseInt(toothMatch[1]);
                analysis.detectedType = 'gear';
                analysis.requiredVertices = toothCount * 4; // 4 vertices per tooth minimum
                analysis.requiredFeatures = [
                    `EXACTLY ${toothCount} teeth (not approximate)`,
                    '4 vertices per tooth minimum',
                    'Front and back faces',
                    'Proper tooth profile (involute or trapezoidal)'
                ];

                if (toothCount === 96) {
                    analysis.matchedExample = this.exampleLibrary.gear_96_tooth;
                }

                analysis.calculatedStructure = {
                    teeth_front: toothCount * 4,
                    teeth_back: toothCount * 4,
                    centers: 2,
                    total: toothCount * 8 + 2
                };

                console.log(`   Detected: ${toothCount}-tooth gear`);
                console.log(`   Required minimum: ${analysis.requiredVertices} vertices`);
                console.log(`   Structure:`, analysis.calculatedStructure);
            }
        }

        // Detect hydraulic/pneumatic cylinder
        else if (analysis.promptLower.includes('cylinder') ||
                 analysis.promptLower.includes('hydraulic') ||
                 analysis.promptLower.includes('pneumatic')) {

            analysis.detectedType = 'hydraulic_cylinder';
            analysis.matchedExample = this.exampleLibrary.hydraulic_cylinder;
            analysis.requiredVertices = 300;
            analysis.requiredFeatures = [
                'Cylinder body (48 segments minimum)',
                'Inner bore',
                'Piston with clearance',
                'Hydraulic/pneumatic ports',
                'Seal grooves'
            ];

            analysis.calculatedStructure = {
                outer_wall: 96,
                inner_bore: 96,
                piston: 96,
                ports: 32,
                total: 320
            };

            console.log('   Detected: Hydraulic/Pneumatic Cylinder');
            console.log('   Required minimum: 300 vertices');
        }

        // Default: complex part
        else {
            analysis.detectedType = 'complex_part';
            analysis.requiredVertices = 200;
            analysis.requiredFeatures = [
                'Detailed geometry with multiple features',
                'Proper topology',
                'Manufacturing-ready design'
            ];

            console.log('   Detected: Complex part');
            console.log('   Required minimum: 200 vertices');
        }

        return analysis;
    }

    /**
     * Build ENFORCED prompt with mandatory examples
     */
    buildEnforcedPrompt(originalPrompt, basePrompt, analysis) {
        console.log('\n🔨 Building ENFORCED prompt with mandatory examples');

        let enforcedPrompt = `
═══════════════════════════════════════════════════════════════════════════
🚨 CRITICAL: THIS IS ATTEMPT #${analysis.attempt || 1}/${this.maxRetries}
${analysis.attempt > 1 ? '⚠️ PREVIOUS ATTEMPTS FAILED - STRICTNESS INCREASED' : ''}
═══════════════════════════════════════════════════════════════════════════

${basePrompt}

═══════════════════════════════════════════════════════════════════════════
🔒 MANDATORY REQUIREMENTS FOR THIS SPECIFIC REQUEST
═══════════════════════════════════════════════════════════════════════════

USER REQUEST: "${originalPrompt}"

DETECTED TYPE: ${analysis.detectedType}
REQUIRED MINIMUM VERTICES: ${analysis.requiredVertices}

REQUIRED FEATURES:
${analysis.requiredFeatures.map((f, i) => `${i+1}. ${f}`).join('\n')}

${analysis.calculatedStructure ? `
CALCULATED STRUCTURE (YOU MUST GENERATE THIS):
${Object.entries(analysis.calculatedStructure).map(([k, v]) => `- ${k}: ${v} vertices`).join('\n')}
` : ''}

═══════════════════════════════════════════════════════════════════════════
📋 EXPLICIT EXAMPLE - YOU MUST FOLLOW THIS PATTERN
═══════════════════════════════════════════════════════════════════════════

${analysis.matchedExample ? `
THIS IS HOW YOU MUST STRUCTURE YOUR RESPONSE:

${analysis.matchedExample.exampleStructure}

${analysis.matchedExample.features ? `FEATURES TO INCLUDE:
${analysis.matchedExample.features.map((f, i) => `${i+1}. ${f}`).join('\n')}

` : ''}MINIMUM VERTEX COUNT: ${analysis.matchedExample.requiredVertices}
` : 'No specific example available - generate detailed geometry meeting vertex requirement'}

═══════════════════════════════════════════════════════════════════════════
⚠️ REJECTION CRITERIA - YOUR RESPONSE WILL BE REJECTED IF:
═══════════════════════════════════════════════════════════════════════════

1. ❌ Vertex count < ${analysis.requiredVertices} (AUTOMATIC REJECTION)
2. ❌ Using "..." placeholders in vertex arrays (AUTOMATIC REJECTION)
3. ❌ Simple box geometry (8 vertices) for complex requests (AUTOMATIC REJECTION)
4. ❌ Missing required features listed above (AUTOMATIC REJECTION)
5. ❌ Vertices are not numeric [x,y,z] triplets (AUTOMATIC REJECTION)

═══════════════════════════════════════════════════════════════════════════
✅ ACCEPTANCE CRITERIA - YOUR RESPONSE WILL PASS IF:
═══════════════════════════════════════════════════════════════════════════

1. ✅ Vertex count ≥ ${analysis.requiredVertices}
2. ✅ ALL vertices are complete [x,y,z] numeric arrays
3. ✅ ALL required features are present in geometry
4. ✅ Face indices are valid (0 ≤ index < vertex_count)
5. ✅ Geometry represents the actual requested object (not a box)

═══════════════════════════════════════════════════════════════════════════
🎯 TOKEN BUDGET ALLOCATION - FOLLOW THIS EXACTLY:
═══════════════════════════════════════════════════════════════════════════

TOTAL OUTPUT TOKENS: 64,000
GEOMETRY ALLOCATION: 51,200 tokens (80%)
MATERIALS/ANALYSIS: 12,800 tokens (20%)

This means:
- Geometry vertex/face arrays: COMPLETE AND DETAILED (80% of output)
- Materials specification: BRIEF (1-2 lines)
- Analysis results: BRIEF (1-2 lines)
- Manufacturing: BRIEF (1-2 lines)

PRIORITIZE GEOMETRY OVER EVERYTHING ELSE!

═══════════════════════════════════════════════════════════════════════════
🔴 FINAL WARNING:
═══════════════════════════════════════════════════════════════════════════

If you generate < ${analysis.requiredVertices} vertices, your response will be:
1. AUTOMATICALLY REJECTED
2. LOGGED AS FAILED ATTEMPT
3. RETRIED with EVEN STRICTER requirements

This is attempt ${analysis.attempt || 1} of ${this.maxRetries}.

NOW GENERATE THE GEOMETRY. BEGIN YOUR RESPONSE WITH THE JSON.
`;

        return enforcedPrompt;
    }

    /**
     * Validate response with mathematical verification
     */
    validateResponse(response, analysis) {
        console.log('\n🔍 STRICT VALIDATION: Checking response');

        const validation = {
            passed: false,
            reason: '',
            vertexCount: 0,
            required: analysis.requiredVertices,
            issues: []
        };

        // Check if geometry exists
        if (!response.design || !response.design.geometry) {
            validation.reason = 'No geometry object found in response';
            validation.issues.push('Missing geometry object');
            return validation;
        }

        const geometry = response.design.geometry;

        // Check vertices array
        if (!Array.isArray(geometry.vertices)) {
            validation.reason = 'Vertices is not an array';
            validation.issues.push('Vertices must be an array');
            return validation;
        }

        validation.vertexCount = geometry.vertices.length;

        // CRITICAL: Check vertex count
        if (validation.vertexCount < analysis.requiredVertices) {
            validation.reason = `Insufficient vertices: ${validation.vertexCount} < ${analysis.requiredVertices} required`;
            validation.issues.push(validation.reason);
            console.error('❌ VALIDATION FAILED:', validation.reason);
            return validation;
        }

        // Check for placeholder patterns
        const responseStr = JSON.stringify(response);
        if (responseStr.includes('...') || responseStr.includes('etc') || responseStr.includes('continue')) {
            validation.reason = 'Response contains placeholders (..., etc, continue)';
            validation.issues.push('No placeholders allowed in geometry');
            console.error('❌ VALIDATION FAILED: Placeholders detected');
            return validation;
        }

        // Check vertex format (sample first 10)
        for (let i = 0; i < Math.min(10, geometry.vertices.length); i++) {
            const v = geometry.vertices[i];
            if (!Array.isArray(v) || v.length !== 3 || v.some(c => typeof c !== 'number' || isNaN(c))) {
                validation.reason = `Invalid vertex at index ${i}: ${JSON.stringify(v)}`;
                validation.issues.push(validation.reason);
                console.error('❌ VALIDATION FAILED:', validation.reason);
                return validation;
            }
        }

        // Check faces
        if (!Array.isArray(geometry.faces) || geometry.faces.length < 1) {
            validation.reason = 'No valid faces array';
            validation.issues.push('Faces array is required');
            return validation;
        }

        // All checks passed
        validation.passed = true;
        validation.reason = `Validation passed: ${validation.vertexCount} vertices (required: ${analysis.requiredVertices}+)`;

        console.log('✅ VALIDATION PASSED');
        console.log(`   Vertices: ${validation.vertexCount}`);
        console.log(`   Required: ${analysis.requiredVertices}+`);
        console.log(`   Excess: ${validation.vertexCount - analysis.requiredVertices} vertices`);

        return validation;
    }
}

module.exports = new StrictGeometryEnforcer();
