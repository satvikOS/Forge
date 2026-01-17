const bedrockService = require('../bedrockService');
const materialLibrary = require('../materialLibraryService');

/**
 * Mechanical Design Service
 * AI-powered mechanical CAD design generation using AWS Bedrock
 * Transforms natural language prompts into parametric mechanical designs
 */
class MechanicalDesignService {
    constructor() {
        this.standardParts = this.initializeStandardParts();
        this.toleranceStandards = this.initializeToleranceStandards();
    }

    /**
     * Main entry point: Process a mechanical design request
     * @param {string} prompt - Natural language design description
     * @param {object} preferences - User preferences (units, standards, etc.)
     * @returns {object} - Design specification with variants
     */
    async processDesignRequest(prompt, preferences = {}) {
        console.log('🔧 Mechanical Design Service: Processing design request...');
        console.log(`📝 Prompt: ${prompt}`);

        try {
            // Step 1: Analyze the prompt using AI
            const analysis = await this.analyzeMechanicalPrompt(prompt, preferences);

            if (!analysis) {
                throw new Error('Failed to analyze mechanical design prompt');
            }

            // Step 2: Generate base specification
            const baseSpec = await this.createBaseSpecification(analysis, preferences);

            // Step 3: Generate multiple design variants (3-5 options)
            const variants = await this.generateDesignVariants(baseSpec, preferences.variantCount || 3);

            // Step 4: For each variant, generate BOM and check manufacturability
            const enrichedVariants = await Promise.all(
                variants.map(async (variant) => {
                    const bom = await this.generateBOM(variant);
                    const manufacturability = await this.checkManufacturability(variant);
                    const rationale = await this.explainDesignRationale(variant, analysis);

                    return {
                        ...variant,
                        bom,
                        manufacturability,
                        rationale,
                        estimatedCost: this.calculateTotalCost(bom)
                    };
                })
            );

            return {
                success: true,
                originalPrompt: prompt,
                analysis,
                variants: enrichedVariants,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Error processing mechanical design request:', error);
            return {
                success: false,
                error: error.message,
                prompt
            };
        }
    }

    /**
     * Analyze mechanical design prompt using AWS Bedrock
     */
    async analyzeMechanicalPrompt(prompt, preferences = {}) {
        const systemPrompt = `You are an expert mechanical engineer and CAD designer. Analyze the following mechanical design request and extract detailed specifications.

DESIGN REQUEST: ${prompt}

Extract the following information:

1. **Component Type**: What is being designed? (e.g., gear, bracket, housing, shaft, assembly)
2. **Primary Function**: What does this component do?
3. **Key Dimensions**: Estimate realistic dimensions based on the description
4. **Materials**: Suggested materials (default to aluminum 6061, steel 1045, or as specified)
5. **Tolerances**: Required tolerances (default to ±0.1mm for general, ±0.01mm for critical fits)
6. **Manufacturing Method**: Suggested manufacturing process (CNC machining, casting, 3D printing, etc.)
7. **Operating Conditions**: Environment, loads, speeds, temperatures
8. **Special Features**: Holes, threads, ribs, pockets, fillets, chamfers, etc.
9. **Quantity**: Production quantity (affects manufacturing method and cost)
10. **Standards**: Any applicable standards (ISO, DIN, ANSI, etc.)

Return ONLY valid JSON with this structure:
{
  "componentType": "bracket|gear|shaft|housing|assembly|other",
  "componentName": "descriptive name",
  "primaryFunction": "description of purpose",
  "dimensions": {
    "length": <mm>,
    "width": <mm>,
    "height": <mm>,
    "additionalDimensions": {}
  },
  "materials": ["aluminum_6061", "steel_1045"],
  "tolerances": {
    "general": "±0.1",
    "critical": "±0.01",
    "fits": ["H7/g6"]
  },
  "manufacturingMethod": "cnc_milling|turning|casting|3d_printing|sheet_metal",
  "operatingConditions": {
    "maxLoad": <N>,
    "maxSpeed": <rpm>,
    "temperature": <C>,
    "environment": "indoor|outdoor|harsh"
  },
  "features": ["holes", "threads", "fillets", "chamfers", "pockets", "ribs"],
  "quantity": <number>,
  "standards": ["ISO_1234", "DIN_567"],
  "complexity": "simple|moderate|complex",
  "designPriority": "strength|weight|cost|manufacturability"
}`;

        try {
            const response = await bedrockService.generateContent(systemPrompt);
            const analysis = bedrockService.parseJSON(response);

            if (analysis && analysis.componentType) {
                console.log('✅ Mechanical prompt analysis successful');
                console.log(`   Component: ${analysis.componentName}`);
                console.log(`   Type: ${analysis.componentType}`);
                console.log(`   Manufacturing: ${analysis.manufacturingMethod}`);
                return analysis;
            }

            throw new Error('Invalid analysis response from AI');
        } catch (error) {
            console.error('Error analyzing mechanical prompt:', error);
            // Fallback to basic analysis
            return this.createFallbackAnalysis(prompt);
        }
    }

    /**
     * Create base parametric specification from analysis
     */
    async createBaseSpecification(analysis, preferences) {
        console.log('📐 Creating base parametric specification...');

        // Map analysis to parametric features
        const spec = {
            name: analysis.componentName,
            type: analysis.componentType,
            units: preferences.units || 'mm',

            // Parametric dimensions (can be edited by user)
            parameters: {
                length: { value: analysis.dimensions.length, unit: 'mm', editable: true },
                width: { value: analysis.dimensions.width, unit: 'mm', editable: true },
                height: { value: analysis.dimensions.height, unit: 'mm', editable: true },
                ...analysis.dimensions.additionalDimensions
            },

            // Material specification
            material: {
                primary: analysis.materials[0] || 'aluminum_6061',
                alternatives: analysis.materials.slice(1),
                properties: await this.getMaterialProperties(analysis.materials[0])
            },

            // Tolerances and fits
            tolerances: analysis.tolerances,

            // Feature list (will become parametric features)
            features: this.extractFeatures(analysis),

            // Manufacturing constraints
            manufacturing: {
                method: analysis.manufacturingMethod,
                quantity: analysis.quantity,
                constraints: this.getManufacturingConstraints(analysis.manufacturingMethod)
            },

            // Design requirements
            requirements: {
                operatingConditions: analysis.operatingConditions,
                designPriority: analysis.designPriority,
                standards: analysis.standards
            }
        };

        return spec;
    }

    /**
     * Generate multiple design variants (3-5 options)
     */
    async generateDesignVariants(baseSpec, count = 3) {
        console.log(`🎨 Generating ${count} design variants...`);

        const variants = [];

        for (let i = 0; i < count; i++) {
            const variant = {
                id: `variant_${i + 1}`,
                name: `${baseSpec.name} - Variant ${i + 1}`,
                baseSpec: JSON.parse(JSON.stringify(baseSpec)), // Deep copy
                differentiator: '',
                geometry: null
            };

            // Apply variations based on variant index
            switch (i) {
                case 0:
                    // Conservative design - stronger, heavier, easier to manufacture
                    variant.differentiator = 'Conservative (Stronger, Easier Manufacturing)';
                    variant.baseSpec.parameters.thickness = { value: baseSpec.parameters.height.value * 1.2, unit: 'mm' };
                    variant.baseSpec.manufacturing.method = 'cnc_milling'; // Most reliable
                    variant.baseSpec.features = variant.baseSpec.features.filter(f => f.complexity !== 'high');
                    break;

                case 1:
                    // Optimized design - balanced strength/weight
                    variant.differentiator = 'Optimized (Balanced Strength/Weight)';
                    variant.baseSpec.features.push({ type: 'pocket', purpose: 'weight_reduction' });
                    variant.baseSpec.features.push({ type: 'rib', purpose: 'stiffness' });
                    break;

                case 2:
                    // Lightweight design - minimum weight, advanced manufacturing
                    variant.differentiator = 'Lightweight (Minimum Weight, Advanced Manufacturing)';
                    variant.baseSpec.parameters.thickness = { value: baseSpec.parameters.height.value * 0.7, unit: 'mm' };
                    variant.baseSpec.manufacturing.method = '3d_printing'; // Allows complex geometries
                    variant.baseSpec.features.push({ type: 'lattice', purpose: 'weight_reduction' });
                    variant.baseSpec.material.primary = 'titanium_ti6al4v'; // Lightweight, strong
                    break;

                case 3:
                    // Cost-optimized design
                    variant.differentiator = 'Cost-Optimized (Lowest Manufacturing Cost)';
                    variant.baseSpec.manufacturing.method = 'sheet_metal'; // Cheapest for thin parts
                    variant.baseSpec.material.primary = 'steel_1045'; // Lower cost material
                    variant.baseSpec.tolerances.general = '±0.5'; // Relaxed tolerances
                    break;

                case 4:
                    // High-precision design
                    variant.differentiator = 'High-Precision (Tightest Tolerances)';
                    variant.baseSpec.tolerances.general = '±0.01';
                    variant.baseSpec.tolerances.critical = '±0.005';
                    variant.baseSpec.manufacturing.method = 'precision_grinding';
                    variant.baseSpec.features.push({ type: 'ground_surface', purpose: 'precision_fit' });
                    break;
            }

            // Generate simplified geometry representation
            variant.geometry = this.generateSimplifiedGeometry(variant.baseSpec);

            variants.push(variant);
        }

        return variants;
    }

    /**
     * Generate Bill of Materials from design specification
     */
    async generateBOM(variant) {
        console.log(`📋 Generating BOM for ${variant.name}...`);

        const bom = {
            items: [],
            totalCost: 0,
            totalWeight: 0
        };

        // Main component
        const mainComponent = {
            partNumber: `CUSTOM-${variant.id.toUpperCase()}`,
            description: variant.name,
            quantity: 1,
            material: variant.baseSpec.material.primary,
            weight: this.calculateWeight(variant.geometry, variant.baseSpec.material.primary),
            unitCost: 0, // Calculated based on manufacturing
            totalCost: 0,
            supplier: 'In-house manufacturing',
            manufacturingMethod: variant.baseSpec.manufacturing.method
        };

        // Estimate manufacturing cost
        mainComponent.unitCost = this.estimateManufacturingCost(
            variant.geometry,
            variant.baseSpec.manufacturing.method,
            variant.baseSpec.material.primary,
            variant.baseSpec.manufacturing.quantity
        );
        mainComponent.totalCost = mainComponent.unitCost * mainComponent.quantity;

        bom.items.push(mainComponent);

        // Add standard parts (fasteners, bearings, etc.) if mentioned in features
        const standardParts = await this.identifyStandardParts(variant.baseSpec.features);
        standardParts.forEach(part => {
            bom.items.push(part);
            bom.totalCost += part.totalCost;
        });

        bom.totalCost = bom.items.reduce((sum, item) => sum + item.totalCost, 0);
        bom.totalWeight = bom.items.reduce((sum, item) => sum + (item.weight * item.quantity), 0);

        return bom;
    }

    /**
     * Check manufacturability of design
     */
    async checkManufacturability(variant) {
        console.log(`🏭 Checking manufacturability for ${variant.name}...`);

        const checks = {
            overall: 'pass',
            issues: [],
            warnings: [],
            suggestions: []
        };

        const spec = variant.baseSpec;

        // Check 1: Tolerance achievability
        const generalTol = parseFloat(spec.tolerances.general.replace('±', ''));
        if (spec.manufacturing.method === '3d_printing' && generalTol < 0.1) {
            checks.warnings.push('3D printing may not achieve ±0.1mm tolerances reliably. Consider CNC for critical dimensions.');
        }
        if (spec.manufacturing.method === 'sheet_metal' && generalTol < 0.5) {
            checks.warnings.push('Sheet metal forming typically has ±0.5mm tolerances. Critical features may need secondary machining.');
        }

        // Check 2: Feature accessibility for machining
        if (spec.manufacturing.method === 'cnc_milling') {
            const hasDeepPockets = spec.features.some(f => f.type === 'pocket' && f.depth > spec.parameters.width.value);
            if (hasDeepPockets) {
                checks.issues.push('Deep pockets detected - ensure tool can reach. May require long reach tooling or multiple setups.');
            }
        }

        // Check 3: Undercuts
        const hasUndercuts = spec.features.some(f => f.type === 'undercut');
        if (hasUndercuts && spec.manufacturing.method !== '3d_printing') {
            checks.issues.push('Undercuts detected - not manufacturable with standard CNC. Consider split mold or 3D printing.');
            checks.overall = 'warning';
        }

        // Check 4: Wall thickness
        const minWallThickness = 1.5; // mm, typical minimum for casting/3D printing
        if (spec.parameters.thickness && spec.parameters.thickness.value < minWallThickness) {
            checks.warnings.push(`Wall thickness ${spec.parameters.thickness.value}mm is below recommended minimum. May be fragile.`);
        }

        // Check 5: Material suitability
        if (spec.material.primary === 'titanium_ti6al4v' && spec.manufacturing.method === 'cnc_milling') {
            checks.suggestions.push('Titanium is difficult to machine. Consider carbide tooling and reduced cutting speeds. Cost will be high.');
        }

        // Check 6: Quantity vs method
        if (spec.manufacturing.quantity > 1000 && spec.manufacturing.method === 'cnc_milling') {
            checks.suggestions.push('High quantity detected. Consider casting or injection molding for better unit economics.');
        }

        return checks;
    }

    /**
     * Explain design rationale in natural language
     */
    async explainDesignRationale(variant, originalAnalysis) {
        console.log(`💭 Generating design rationale for ${variant.name}...`);

        const systemPrompt = `You are explaining the design rationale for a mechanical component to an engineer.

COMPONENT: ${variant.name}
TYPE: ${variant.baseSpec.type}
DIFFERENTIATOR: ${variant.differentiator}

ORIGINAL REQUIREMENTS:
${JSON.stringify(originalAnalysis.requirements || {}, null, 2)}

DESIGN CHOICES:
- Material: ${variant.baseSpec.material.primary}
- Manufacturing: ${variant.baseSpec.manufacturing.method}
- Dimensions: ${JSON.stringify(variant.baseSpec.parameters, null, 2)}
- Tolerances: ${JSON.stringify(variant.baseSpec.tolerances, null, 2)}

Explain in 3-4 sentences:
1. Why these specific dimensions were chosen
2. Why this material and manufacturing method
3. How the tolerances were determined
4. What failure modes were considered

Be technical but concise. Focus on engineering reasoning.`;

        try {
            const explanation = await bedrockService.generateContent(systemPrompt);
            return explanation;
        } catch (error) {
            console.error('Error generating rationale:', error);
            return `This ${variant.differentiator.toLowerCase()} variant uses ${variant.baseSpec.material.primary} manufactured via ${variant.baseSpec.manufacturing.method}. The design balances ${originalAnalysis.designPriority} requirements with manufacturing constraints.`;
        }
    }

    // ==================== Helper Methods ====================

    /**
     * Extract features from analysis
     */
    extractFeatures(analysis) {
        const features = [];

        analysis.features.forEach(featureName => {
            switch (featureName) {
                case 'holes':
                    features.push({ type: 'hole', diameter: 6, depth: 20, purpose: 'fastening' });
                    break;
                case 'threads':
                    features.push({ type: 'thread', size: 'M6', depth: 15, purpose: 'fastening' });
                    break;
                case 'fillets':
                    features.push({ type: 'fillet', radius: 2, purpose: 'stress_relief' });
                    break;
                case 'chamfers':
                    features.push({ type: 'chamfer', distance: 1, purpose: 'ease_assembly' });
                    break;
                case 'pockets':
                    features.push({ type: 'pocket', depth: 10, purpose: 'weight_reduction' });
                    break;
                case 'ribs':
                    features.push({ type: 'rib', thickness: 3, purpose: 'stiffness' });
                    break;
            }
        });

        return features;
    }

    /**
     * Get manufacturing constraints for a method
     */
    getManufacturingConstraints(method) {
        const constraints = {
            'cnc_milling': {
                minWallThickness: 1.0,
                minFeatureSize: 0.5,
                maxDepthToWidth: 5,
                typicalTolerance: '±0.05'
            },
            'cnc_turning': {
                minWallThickness: 0.8,
                minFeatureSize: 0.3,
                typicalTolerance: '±0.02'
            },
            '3d_printing': {
                minWallThickness: 0.8,
                minFeatureSize: 0.4,
                typicalTolerance: '±0.2',
                supportRequired: true
            },
            'casting': {
                minWallThickness: 3.0,
                draftAngle: 2, // degrees
                typicalTolerance: '±0.5'
            },
            'sheet_metal': {
                minBendRadius: 1.5,
                typicalTolerance: '±0.5',
                maxThickness: 6.0
            }
        };

        return constraints[method] || {};
    }

    /**
     * Get material properties
     */
    async getMaterialProperties(materialName) {
        try {
            const material = await materialLibrary.getMaterial(materialName);
            return material;
        } catch (error) {
            // Fallback to basic properties
            return {
                name: materialName,
                density: 2700, // kg/m³ (aluminum default)
                youngsModulus: 69e9, // Pa
                yieldStrength: 276e6, // Pa
                cost: 5 // $/kg (estimate)
            };
        }
    }

    /**
     * Generate 3D mesh geometry from specification
     * Creates a procedural box mesh that can be rendered in Three.js
     */
    generateSimplifiedGeometry(spec) {
        const length = spec.parameters.length?.value || 100;
        const width = spec.parameters.width?.value || 50;
        const height = spec.parameters.height?.value || 25;

        // Generate box mesh vertices (8 corners)
        const halfX = length / 2;
        const halfY = width / 2;
        const halfZ = height / 2;

        const vertices = [
            // Bottom face (y = -halfY)
            [-halfX, -halfY, -halfZ], [halfX, -halfY, -halfZ], [halfX, -halfY, halfZ], [-halfX, -halfY, halfZ],
            // Top face (y = halfY)
            [-halfX, halfY, -halfZ], [halfX, halfY, -halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ]
        ];

        // Generate box faces (12 triangles = 6 quad faces * 2 triangles each)
        // Each face is defined by vertex indices
        const faces = [
            // Bottom face
            [0, 1, 2], [0, 2, 3],
            // Top face
            [4, 6, 5], [4, 7, 6],
            // Front face
            [0, 3, 7], [0, 7, 4],
            // Back face
            [1, 5, 6], [1, 6, 2],
            // Left face
            [0, 4, 5], [0, 5, 1],
            // Right face
            [3, 2, 6], [3, 6, 7]
        ];

        // Generate normals for each vertex
        const normals = [
            [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0], // Bottom
            [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]      // Top
        ];

        return {
            type: 'mesh',
            vertices: vertices,
            faces: faces,
            normals: normals,
            dimensions: {
                x: length,
                y: width,
                z: height
            },
            features: spec.features.length,
            volume: this.calculateVolume(spec.parameters),
            // Metadata for Three.js
            metadata: {
                format: 'triangulated_mesh',
                vertexCount: vertices.length,
                faceCount: faces.length,
                units: 'mm'
            }
        };
    }

    /**
     * Calculate volume from parameters
     */
    calculateVolume(params) {
        const length = params.length?.value || 100;
        const width = params.width?.value || 50;
        const height = params.height?.value || 25;
        return length * width * height; // mm³
    }

    /**
     * Calculate weight
     */
    calculateWeight(geometry, materialName) {
        const volumeMM3 = geometry.volume;
        const volumeM3 = volumeMM3 * 1e-9; // Convert mm³ to m³

        const densities = {
            'aluminum_6061': 2700,
            'steel_1045': 7850,
            'titanium_ti6al4v': 4430,
            'plastic_abs': 1050
        };

        const density = densities[materialName] || 2700; // kg/m³
        return volumeM3 * density; // kg
    }

    /**
     * Estimate manufacturing cost
     */
    estimateManufacturingCost(geometry, method, material, quantity) {
        const materialCost = this.calculateMaterialCost(geometry, material);
        const setupCost = this.getSetupCost(method);
        const perPartCost = this.getPerPartCost(geometry, method);

        // Total cost = material + setup/quantity + per-part processing
        const totalCost = materialCost + (setupCost / quantity) + perPartCost;

        return Math.round(totalCost * 100) / 100; // Round to 2 decimals
    }

    calculateMaterialCost(geometry, materialName) {
        const weight = this.calculateWeight(geometry, materialName);

        const materialCosts = {
            'aluminum_6061': 5, // $/kg
            'steel_1045': 1.5,
            'titanium_ti6al4v': 35,
            'plastic_abs': 3
        };

        const costPerKg = materialCosts[materialName] || 5;
        return weight * costPerKg;
    }

    getSetupCost(method) {
        const setupCosts = {
            'cnc_milling': 200,
            'cnc_turning': 150,
            '3d_printing': 50,
            'casting': 1000,
            'sheet_metal': 100
        };
        return setupCosts[method] || 100;
    }

    getPerPartCost(geometry, method) {
        const volume = geometry.volume;
        const baseCosts = {
            'cnc_milling': 0.05, // $/mm³
            'cnc_turning': 0.03,
            '3d_printing': 0.02,
            'casting': 0.01,
            'sheet_metal': 0.01
        };

        const costPerVolume = baseCosts[method] || 0.03;
        return volume * costPerVolume;
    }

    calculateTotalCost(bom) {
        return bom.totalCost;
    }

    /**
     * Identify standard parts from features
     */
    async identifyStandardParts(features) {
        const parts = [];

        features.forEach(feature => {
            if (feature.type === 'hole' && feature.purpose === 'fastening') {
                // Suggest bolt and nut
                parts.push({
                    partNumber: 'ISO4762-M6x20',
                    description: 'Socket Head Cap Screw M6 x 20mm',
                    quantity: 4,
                    material: 'steel',
                    weight: 0.008, // kg
                    unitCost: 0.15,
                    totalCost: 0.60,
                    supplier: 'McMaster-Carr',
                    manufacturingMethod: 'standard_part'
                });
            }
        });

        return parts;
    }

    /**
     * Initialize standard parts library
     */
    initializeStandardParts() {
        return {
            fasteners: {
                'M6': { diameter: 6, pitches: [1.0], standard: 'ISO' },
                'M8': { diameter: 8, pitches: [1.25], standard: 'ISO' },
                'M10': { diameter: 10, pitches: [1.5], standard: 'ISO' }
            },
            bearings: {
                '6001': { bore: 12, OD: 28, width: 8, type: 'ball_bearing' },
                '6201': { bore: 12, OD: 32, width: 10, type: 'ball_bearing' }
            }
        };
    }

    /**
     * Initialize tolerance standards
     */
    initializeToleranceStandards() {
        return {
            ISO_286: {
                holes: ['H6', 'H7', 'H8', 'H9'],
                shafts: ['f6', 'g6', 'h6', 'js6']
            },
            ANSI_B4_1: {
                fits: ['RC1', 'LC1', 'FN1']
            }
        };
    }

    /**
     * Fallback analysis when AI fails
     */
    createFallbackAnalysis(prompt) {
        console.log('⚠️  Using fallback analysis');
        return {
            componentType: 'other',
            componentName: 'Generic Component',
            primaryFunction: 'As described in prompt',
            dimensions: { length: 100, width: 50, height: 25 },
            materials: ['aluminum_6061'],
            tolerances: { general: '±0.1', critical: '±0.05', fits: [] },
            manufacturingMethod: 'cnc_milling',
            operatingConditions: { maxLoad: 1000, maxSpeed: 0, temperature: 25, environment: 'indoor' },
            features: ['fillets', 'chamfers'],
            quantity: 1,
            standards: [],
            complexity: 'moderate',
            designPriority: 'balanced'
        };
    }

    /**
     * Parse natural language commands for CAD operations
     * Maps conversational input to structured API calls
     */
    async parseNaturalLanguageCommand(userMessage, conversationContext = []) {
        console.log('💬 Parsing natural language command:', userMessage);

        const systemPrompt = `You are an AI assistant for a professional CAD software. Parse the user's command and determine which API endpoint to call.

USER COMMAND: "${userMessage}"

AVAILABLE API ENDPOINTS AND THEIR PARAMETERS:

**Geometry Creation:**
- /api/mechanical/features/extrude: {sketchId, distance, direction}
- /api/mechanical/features/revolve: {sketchId, axis, angle}
- /api/mechanical/sketch/rectangle: {width, height, center}
- /api/mechanical/sketch/circle: {radius, center}

**Analysis:**
- /api/mechanical/analysis/fea-linear: {modelId, loads, constraints}
- /api/mechanical/analysis/modal: {modelId, numModes}
- /api/mechanical/analysis/thermal-steady: {modelId, temperature}
- /api/mechanical/analysis/mass-properties: {modelId}

**Manufacturing:**
- /api/mechanical/cam/generate-toolpath: {type, modelId, stock}
- /api/mechanical/bom/hierarchical: {assemblyId}
- /api/mechanical/bom/flat: {assemblyId}
- /api/mechanical/cost/machining-cost: {modelId}

**Documentation:**
- /api/mechanical/mbd/embed-pmi: {modelId, annotations}
- /api/mechanical/revision/create: {modelId, notes}

**Examples:**
- "Create a 50mm cube" → {endpoint: "/api/mechanical/features/extrude", params: {distance: 50}, intent: "create_cube"}
- "Run FEA analysis" → {endpoint: "/api/mechanical/analysis/fea-linear", params: {}, intent: "run_fea"}
- "Generate BOM" → {endpoint: "/api/mechanical/bom/hierarchical", params: {}, intent: "generate_bom"}
- "Export to STL" → {endpoint: "/api/mechanical/additive/export-stl", params: {}, intent: "export_stl"}

Return ONLY valid JSON with this structure:
{
  "intent": "create_geometry|run_analysis|generate_doc|manufacturing|conversational",
  "confidence": 0.0-1.0,
  "endpoint": "/api/mechanical/...",
  "method": "POST",
  "params": {...},
  "conversationalResponse": "Brief confirmation message",
  "suggestedFollowUps": ["Next step 1", "Next step 2"]
}

If the command is conversational (e.g., "hello", "what can you do?"), return intent="conversational" with no endpoint.`;

        try {
            const response = await bedrockService.generateContent(systemPrompt);
            const parsed = bedrockService.parseJSON(response);

            if (!parsed || !parsed.intent) {
                throw new Error('Invalid parse response');
            }

            console.log(`✅ Command parsed: ${parsed.intent} → ${parsed.endpoint || 'conversational'}`);

            return {
                success: true,
                ...parsed,
                originalCommand: userMessage,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Error parsing NL command:', error);

            // Fallback: simple pattern matching
            return this.fallbackCommandParse(userMessage);
        }
    }

    /**
     * Fallback command parser using simple pattern matching
     */
    fallbackCommandParse(message) {
        const lowerMsg = message.toLowerCase();

        // Geometry creation patterns
        if (lowerMsg.includes('cube') || lowerMsg.includes('box')) {
            const size = this.extractNumber(lowerMsg) || 50;
            return {
                success: true,
                intent: 'create_geometry',
                confidence: 0.7,
                endpoint: '/api/mechanical/features/extrude',
                method: 'POST',
                params: { distance: size },
                conversationalResponse: `Creating a ${size}mm cube.`,
                suggestedFollowUps: ['Add fillets', 'Run FEA analysis', 'Generate BOM']
            };
        }

        // Analysis patterns
        if (lowerMsg.includes('fea') || lowerMsg.includes('analysis') || lowerMsg.includes('stress')) {
            return {
                success: true,
                intent: 'run_analysis',
                confidence: 0.8,
                endpoint: '/api/mechanical/analysis/fea-linear',
                method: 'POST',
                params: {},
                conversationalResponse: 'Running linear FEA analysis...',
                suggestedFollowUps: ['View results', 'Export report', 'Modify design']
            };
        }

        // BOM patterns
        if (lowerMsg.includes('bom') || lowerMsg.includes('bill of materials')) {
            const type = lowerMsg.includes('flat') ? 'flat' : 'hierarchical';
            return {
                success: true,
                intent: 'generate_doc',
                confidence: 0.9,
                endpoint: `/api/mechanical/bom/${type}`,
                method: 'POST',
                params: {},
                conversationalResponse: `Generating ${type} BOM...`,
                suggestedFollowUps: ['Export to Excel', 'Export to CSV', 'Add to drawing']
            };
        }

        // Cost estimation patterns
        if (lowerMsg.includes('cost') || lowerMsg.includes('estimate')) {
            return {
                success: true,
                intent: 'manufacturing',
                confidence: 0.75,
                endpoint: '/api/mechanical/cost/machining-cost',
                method: 'POST',
                params: {},
                conversationalResponse: 'Estimating manufacturing cost...',
                suggestedFollowUps: ['Compare methods', 'Generate cost breakdown']
            };
        }

        // Default conversational response
        return {
            success: true,
            intent: 'conversational',
            confidence: 0.5,
            conversationalResponse: "I can help you with CAD design, analysis, manufacturing, and documentation. Try commands like 'Create a 50mm cube', 'Run FEA analysis', or 'Generate BOM'.",
            suggestedFollowUps: [
                'Create geometry',
                'Run analysis',
                'Generate documentation'
            ]
        };
    }

    /**
     * Extract first number from string
     */
    extractNumber(str) {
        const match = str.match(/\d+\.?\d*/);
        return match ? parseFloat(match[0]) : null;
    }
}

module.exports = new MechanicalDesignService();
