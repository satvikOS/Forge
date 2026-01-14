/**
 * Mechanical Domain Orchestrator
 *
 * Specialized orchestrator for mechanical CAD design with:
 * - Domain-specific RAG (Retrieval Augmented Generation)
 * - Rich mechanical engineering context
 * - Standards & specifications knowledge
 * - Materials database integration
 * - Manufacturing constraints
 * - Structural analysis integration
 */

const bedrockService = require('./bedrockService');
const geminiVision = require('./geminiVisionService');
const AxelEngine = require('../engines/axel/axelEngine');
const strictEnforcer = require('./strictGeometryEnforcer');
const parallelMCPOrchestrator = require('./parallelMCPOrchestrator');

class MechanicalDomainOrchestrator {
    constructor() {
        this.domain = 'mechanical_engineering';
        this.bedrockService = bedrockService;
        this.geminiVision = geminiVision;
        this.axelEngine = new AxelEngine({ resolution: 2.0 }); // 2mm voxel resolution

        // Mechanical engineering knowledge base
        this.knowledgeBase = this.initializeKnowledgeBase();

        // Context management
        this.contextHistory = new Map();
        this.maxContextDepth = 10;

        console.log('✅ Mechanical Domain Orchestrator initialized');
        console.log(`   Domain: Mechanical Engineering`);
        console.log(`   Knowledge Base: Loaded`);
        console.log(`   RAG: Enabled`);
    }

    /**
     * Initialize mechanical engineering knowledge base
     */
    initializeKnowledgeBase() {
        return {
            // Material properties and specifications
            materials: {
                metals: {
                    steel: {
                        types: ['AISI 1020', 'AISI 4140', 'Stainless 304', 'Stainless 316'],
                        properties: {
                            'AISI 1020': { yield: 295, tensile: 380, density: 7850, elastic: 200000 },
                            'AISI 4140': { yield: 655, tensile: 855, density: 7850, elastic: 205000 },
                            'SS 304': { yield: 215, tensile: 505, density: 8000, elastic: 193000 },
                            'SS 316': { yield: 290, tensile: 580, density: 8000, elastic: 193000 }
                        },
                        applications: ['Structural', 'Automotive', 'Machinery', 'Pressure vessels']
                    },
                    aluminum: {
                        types: ['6061-T6', '7075-T6', '2024-T3', '5052-H32'],
                        properties: {
                            '6061-T6': { yield: 276, tensile: 310, density: 2700, elastic: 68900 },
                            '7075-T6': { yield: 503, tensile: 572, density: 2810, elastic: 71700 },
                            '2024-T3': { yield: 345, tensile: 483, density: 2780, elastic: 73100 },
                            '5052-H32': { yield: 193, tensile: 228, density: 2680, elastic: 70300 }
                        },
                        applications: ['Aerospace', 'Automotive', 'Marine', 'Consumer products']
                    }
                },
                plastics: {
                    abs: { yield: 40, tensile: 45, density: 1050, elastic: 2300 },
                    nylon: { yield: 85, tensile: 90, density: 1140, elastic: 2900 },
                    polycarbonate: { yield: 62, tensile: 65, density: 1200, elastic: 2400 }
                }
            },

            // Manufacturing processes and constraints
            manufacturing: {
                machining: {
                    tolerance_ranges: {
                        'standard': '±0.1mm',
                        'precision': '±0.01mm',
                        'ultra_precision': '±0.001mm'
                    },
                    min_wall_thickness: {
                        'aluminum': 1.5,
                        'steel': 2.0,
                        'plastic': 1.0
                    }
                },
                casting: {
                    draft_angle: '1-3 degrees',
                    min_wall_thickness: 3.0,
                    surface_finish: 'Ra 6.3-12.5'
                },
                '3d_printing': {
                    fdm: { min_feature: 0.4, layer_height: '0.1-0.3mm' },
                    sla: { min_feature: 0.1, layer_height: '0.025-0.1mm' },
                    sls: { min_feature: 0.3, layer_height: '0.1mm' }
                },
                sheet_metal: {
                    min_bend_radius: 'thickness * 1.0',
                    hole_to_edge_distance: 'diameter * 2.0',
                    standard_thicknesses: [0.5, 0.8, 1.0, 1.5, 2.0, 3.0]
                }
            },

            // Engineering standards
            standards: {
                iso: {
                    'ISO 2768': 'General tolerances',
                    'ISO 286': 'Limits and fits',
                    'ISO 1101': 'GD&T symbols',
                    'ISO 4287': 'Surface texture'
                },
                asme: {
                    'ASME Y14.5': 'GD&T standard',
                    'ASME B1.1': 'Screw threads',
                    'ASME B18.2.1': 'Fasteners'
                },
                din: {
                    'DIN 912': 'Socket head cap screws',
                    'DIN 125': 'Washers',
                    'DIN 471': 'Retaining rings'
                }
            },

            // Common mechanical components
            standardParts: {
                fasteners: {
                    bolts: ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20'],
                    nuts: ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'],
                    washers: ['M3', 'M4', 'M5', 'M6', 'M8', 'M10']
                },
                bearings: {
                    ball_bearings: ['6000', '6200', '6300', '6800'],
                    roller_bearings: ['NU2', 'NJ2', 'NUP2']
                },
                seals: ['O-rings', 'Shaft seals', 'Gaskets']
            },

            // Design principles
            designPrinciples: {
                safety_factors: {
                    'static_load': 1.5,
                    'dynamic_load': 2.0,
                    'shock_load': 3.0,
                    'fatigue': 4.0
                },
                stress_analysis: {
                    'tensile': 'σ = F/A',
                    'shear': 'τ = V/A',
                    'bending': 'σ = M*y/I',
                    'torsion': 'τ = T*r/J'
                },
                failure_modes: [
                    'Yielding', 'Fracture', 'Fatigue', 'Buckling',
                    'Creep', 'Wear', 'Corrosion'
                ]
            },

            // Common design patterns
            designPatterns: {
                structural: [
                    'I-beam', 'Box section', 'Truss', 'Frame',
                    'Ribbed structure', 'Honeycomb core'
                ],
                mechanical: [
                    'Four-bar linkage', 'Slider-crank', 'Cam-follower',
                    'Gear train', 'Belt drive', 'Chain drive'
                ],
                joints: [
                    'Bolted joint', 'Welded joint', 'Riveted joint',
                    'Pin joint', 'Snap fit', 'Press fit'
                ]
            }
        };
    }

    /**
     * RAG: Retrieve relevant knowledge for a design prompt
     */
    async retrieveRelevantKnowledge(prompt) {
        console.log('🔍 RAG: Retrieving relevant mechanical knowledge...');

        const keywords = this.extractKeywords(prompt);
        const relevantKnowledge = {
            materials: [],
            processes: [],
            standards: [],
            components: [],
            principles: []
        };

        // Material retrieval
        if (keywords.materials.length > 0) {
            keywords.materials.forEach(mat => {
                const matData = this.findMaterialData(mat);
                if (matData) relevantKnowledge.materials.push(matData);
            });
        }

        // Manufacturing process retrieval
        if (keywords.processes.length > 0) {
            keywords.processes.forEach(proc => {
                const procData = this.findProcessData(proc);
                if (procData) relevantKnowledge.processes.push(procData);
            });
        }

        // Standards retrieval
        const applicableStandards = this.findApplicableStandards(prompt);
        relevantKnowledge.standards = applicableStandards;

        // Component retrieval
        const standardComponents = this.findStandardComponents(prompt);
        relevantKnowledge.components = standardComponents;

        // Design principles
        const designPrinciples = this.findDesignPrinciples(prompt);
        relevantKnowledge.principles = designPrinciples;

        console.log(`   Materials found: ${relevantKnowledge.materials.length}`);
        console.log(`   Processes found: ${relevantKnowledge.processes.length}`);
        console.log(`   Standards found: ${relevantKnowledge.standards.length}`);

        return relevantKnowledge;
    }

    /**
     * Extract keywords from prompt
     */
    extractKeywords(prompt) {
        const lowerPrompt = prompt.toLowerCase();

        return {
            materials: this.extractMaterialKeywords(lowerPrompt),
            processes: this.extractProcessKeywords(lowerPrompt),
            components: this.extractComponentKeywords(lowerPrompt),
            loads: this.extractLoadKeywords(lowerPrompt)
        };
    }

    extractMaterialKeywords(prompt) {
        const materials = [];
        const materialKeywords = [
            'steel', 'aluminum', 'aluminium', 'plastic', 'abs', 'nylon',
            'stainless', 'carbon fiber', 'titanium', 'brass', 'copper'
        ];

        materialKeywords.forEach(keyword => {
            if (prompt.includes(keyword)) {
                materials.push(keyword);
            }
        });

        return materials;
    }

    extractProcessKeywords(prompt) {
        const processes = [];
        const processKeywords = [
            'machining', 'milling', 'turning', 'drilling', 'casting',
            '3d print', 'additive', 'sheet metal', 'welding', 'forging'
        ];

        processKeywords.forEach(keyword => {
            if (prompt.includes(keyword)) {
                processes.push(keyword);
            }
        });

        return processes;
    }

    extractComponentKeywords(prompt) {
        const components = [];
        const componentKeywords = [
            'bolt', 'screw', 'nut', 'washer', 'bearing', 'shaft',
            'gear', 'spring', 'seal', 'gasket', 'pin', 'key'
        ];

        componentKeywords.forEach(keyword => {
            if (prompt.includes(keyword)) {
                components.push(keyword);
            }
        });

        return components;
    }

    extractLoadKeywords(prompt) {
        const loads = [];
        const loadKeywords = [
            'static', 'dynamic', 'cyclic', 'impact', 'shock',
            'tension', 'compression', 'bending', 'torsion', 'shear'
        ];

        loadKeywords.forEach(keyword => {
            if (prompt.includes(keyword)) {
                loads.push(keyword);
            }
        });

        return loads;
    }

    /**
     * Find material data from knowledge base
     */
    findMaterialData(materialKeyword) {
        // Search in metals
        for (const [metalType, metalData] of Object.entries(this.knowledgeBase.materials.metals)) {
            if (materialKeyword.includes(metalType)) {
                return {
                    category: 'metal',
                    type: metalType,
                    data: metalData
                };
            }
        }

        // Search in plastics
        for (const [plasticType, plasticData] of Object.entries(this.knowledgeBase.materials.plastics)) {
            if (materialKeyword.includes(plasticType)) {
                return {
                    category: 'plastic',
                    type: plasticType,
                    data: plasticData
                };
            }
        }

        return null;
    }

    /**
     * Find manufacturing process data
     */
    findProcessData(processKeyword) {
        for (const [processName, processData] of Object.entries(this.knowledgeBase.manufacturing)) {
            if (processKeyword.includes(processName)) {
                return {
                    process: processName,
                    data: processData
                };
            }
        }
        return null;
    }

    /**
     * Find applicable standards
     */
    findApplicableStandards(prompt) {
        const standards = [];
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('tolerance') || lowerPrompt.includes('dimension')) {
            standards.push({ standard: 'ISO 2768', description: 'General tolerances' });
            standards.push({ standard: 'ISO 286', description: 'Limits and fits' });
        }

        if (lowerPrompt.includes('gd&t') || lowerPrompt.includes('geometric')) {
            standards.push({ standard: 'ISO 1101', description: 'GD&T symbols' });
            standards.push({ standard: 'ASME Y14.5', description: 'GD&T standard' });
        }

        if (lowerPrompt.includes('thread') || lowerPrompt.includes('screw')) {
            standards.push({ standard: 'ASME B1.1', description: 'Screw threads' });
        }

        return standards;
    }

    /**
     * Find standard components
     */
    findStandardComponents(prompt) {
        const components = [];
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('bolt') || lowerPrompt.includes('screw')) {
            components.push({
                type: 'fastener',
                name: 'Socket head cap screw',
                standard: 'DIN 912',
                sizes: this.knowledgeBase.standardParts.fasteners.bolts
            });
        }

        if (lowerPrompt.includes('bearing')) {
            components.push({
                type: 'bearing',
                name: 'Ball bearing',
                types: this.knowledgeBase.standardParts.bearings.ball_bearings
            });
        }

        return components;
    }

    /**
     * Find relevant design principles
     */
    findDesignPrinciples(prompt) {
        const principles = [];
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('load') || lowerPrompt.includes('stress') || lowerPrompt.includes('strength')) {
            principles.push({
                principle: 'Safety factors',
                data: this.knowledgeBase.designPrinciples.safety_factors
            });
            principles.push({
                principle: 'Stress analysis',
                data: this.knowledgeBase.designPrinciples.stress_analysis
            });
        }

        if (lowerPrompt.includes('fail') || lowerPrompt.includes('break')) {
            principles.push({
                principle: 'Failure modes',
                data: this.knowledgeBase.designPrinciples.failure_modes
            });
        }

        return principles;
    }

    /**
     * Build rich context for design generation
     */
    async buildMechanicalContext(prompt, sessionId = null) {
        console.log('\n🔧 Building mechanical engineering context...');

        // Retrieve relevant knowledge via RAG
        const knowledge = await this.retrieveRelevantKnowledge(prompt);

        // Build context history
        const history = sessionId ? this.getContextHistory(sessionId) : [];

        // Construct rich context
        const context = {
            domain: 'mechanical_engineering',
            prompt,
            sessionId,
            timestamp: new Date().toISOString(),

            // RAG retrieved knowledge
            knowledge: {
                materials: knowledge.materials,
                processes: knowledge.processes,
                standards: knowledge.standards,
                components: knowledge.components,
                principles: knowledge.principles
            },

            // Conversation history
            history,

            // Domain-specific guidelines
            guidelines: {
                designForManufacturing: true,
                applyStandards: true,
                considerSafety: true,
                optimizeForCost: false,
                validateStructure: true
            },

            // Constraints
            constraints: {
                materialConstraints: knowledge.materials.length > 0,
                processConstraints: knowledge.processes.length > 0,
                standardsCompliance: knowledge.standards.length > 0
            }
        };

        // Store context
        if (sessionId) {
            this.storeContext(sessionId, context);
        }

        console.log('✅ Mechanical context built');
        console.log(`   Knowledge items: ${Object.values(knowledge).flat().length}`);
        console.log(`   History depth: ${history.length}`);

        return context;
    }

    /**
     * Generate design with mechanical domain expertise
     */
    async generateMechanicalDesign(prompt, options = {}) {
        // ALWAYS use parallel MCP for production-ready detail (default mode)
        // Only disable if explicitly set to false
        const disableParallelMCP = process.env.USE_PARALLEL_MCP === 'false' || options.useParallelMCP === false;
        const useParallelMCP = !disableParallelMCP;

        if (useParallelMCP) {
            console.log('\n🚀 === PARALLEL MCP MODE: PRODUCTION-READY GENERATION (DEFAULT) ===');
            console.log(`   Full Request: "${prompt}"`);
            console.log(`   Mode: Multi-component parallel generation`);
            console.log(`   Token budget: 64K per component (unlimited total)`);
            console.log(`   Environment: USE_PARALLEL_MCP=${process.env.USE_PARALLEL_MCP || 'not set (using default: true)'}`);

            try {
                // Use parallel MCP orchestrator
                const result = await parallelMCPOrchestrator.generateWithParallelMCP(prompt, options);

                // Build mechanical validation context
                const context = await this.buildMechanicalContext(prompt, options.sessionId);
                const mechValidation = this.validateMechanicalDesign(result.geometry, context);

                return {
                    design: {
                        geometry: result.geometry,
                        components: result.components,
                        specifications: this.extractSpecifications(context),
                        materials: this.selectMaterials(prompt),
                        manufacturing: this.suggestManufacturing(prompt)
                    },
                    validation: {
                        ...mechValidation,
                        parallel_mcp: result.validation
                    },
                    metadata: {
                        ...result.metadata,
                        mode: 'parallel_mcp',
                        domain: 'mechanical_engineering'
                    }
                };
            } catch (error) {
                console.error('❌ Parallel MCP generation failed:', error);
                console.error('   Error details:', error.stack);
                console.log('⚠️  Falling back to single-call mode...');
                // Fall through to single-call mode below
            }
        } else {
            console.log('\n⚠️  === LEGACY MODE: Parallel MCP explicitly disabled ===');
        }

        console.log('\n⚙️  === MECHANICAL DOMAIN GENERATION WITH STRICT ENFORCEMENT ===');
        console.log(`   Full Request: "${prompt}"`);

        // STEP 1: Analyze prompt and calculate exact requirements
        const analysis = strictEnforcer.analyzeAndPlan(prompt);
        analysis.attempt = 1;

        // Build rich context
        const context = await this.buildMechanicalContext(prompt, options.sessionId);

        // STEP 2: Retry loop with escalating strictness
        let design = null;
        let validation = null;
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`\n🔄 ATTEMPT ${attempt}/${maxAttempts}`);
            analysis.attempt = attempt;

            try {
                // Create base enhanced prompt
                const basePrompt = this.createEnhancedPrompt(prompt, context);

                // ENFORCE with strict requirements and examples
                const enforcedPrompt = strictEnforcer.buildEnforcedPrompt(prompt, basePrompt, analysis);

                // Generate design using Claude Sonnet 4.5
                console.log(`🤖 Generating with Claude Sonnet 4.5 (Attempt ${attempt})...`);
                const designSpec = await this.bedrockService.generateContent(enforcedPrompt, {
                    modelId: process.env.BEDROCK_TEXT_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
                });

                design = this.bedrockService.parseJSON(designSpec);

                if (!design) {
                    console.error(`❌ Attempt ${attempt}: Failed to parse JSON`);
                    if (attempt < maxAttempts) {
                        console.log('   Retrying with increased strictness...');
                        continue;
                    } else {
                        throw new Error('Failed to parse JSON after 3 attempts');
                    }
                }

                // STRICT VALIDATION
                validation = strictEnforcer.validateResponse(design, analysis);

                if (validation.passed) {
                    console.log(`✅ Attempt ${attempt}: VALIDATION PASSED`);
                    console.log(`   Vertices: ${validation.vertexCount} (required: ${validation.required}+)`);
                    break; // Success!
                } else {
                    console.error(`❌ Attempt ${attempt}: VALIDATION FAILED`);
                    console.error(`   Reason: ${validation.reason}`);
                    console.error(`   Issues:`, validation.issues);

                    if (attempt < maxAttempts) {
                        console.log(`   Retrying (${attempt + 1}/${maxAttempts}) with MAXIMUM strictness...`);
                        // Increase required vertices by 20% for next attempt
                        analysis.requiredVertices = Math.floor(analysis.requiredVertices * 1.2);
                        continue;
                    } else {
                        throw new Error(`Validation failed after ${maxAttempts} attempts: ${validation.reason}`);
                    }
                }

            } catch (error) {
                console.error(`❌ Attempt ${attempt} error:`, error.message);
                if (attempt < maxAttempts) {
                    console.log(`   Retrying...`);
                    continue;
                } else {
                    throw error;
                }
            }
        }

        if (!design || !validation || !validation.passed) {
            throw new Error('Failed to generate valid geometry after all retry attempts');
        }

        // Validate design against mechanical engineering principles
        const mechValidation = await this.validateMechanicalDesign(design, context);

        // Generate 3D geometry from design specification
        const baseGeometry = this.generateGeometryFromDesign(design);

        // Process through AXEL voxel engine for advanced topology
        const geometry = this.axelEngine.processMesh(baseGeometry);

        console.log('\n✅ === MECHANICAL DESIGN GENERATION COMPLETE ===');
        console.log(`   Attempts required: ${analysis.attempt}`);
        console.log(`   Final vertex count: ${geometry.vertices.length}`);
        console.log(`   Required minimum: ${analysis.requiredVertices}`);
        console.log(`   Mechanical validation: ${mechValidation.valid ? 'PASS' : 'FAIL'}`);
        console.log(`   Geometry: ${geometry.vertices.length} vertices, ${geometry.faces.length} faces`);
        console.log(`   Engine: AXEL (voxel-based)`);

        return {
            design: {
                ...design,
                geometry  // Add AXEL-processed 3D geometry to the design
            },
            validation: {
                ...mechValidation,
                strict_enforcement: {
                    passed: validation.passed,
                    attempts: analysis.attempt,
                    vertex_count: validation.vertexCount,
                    required_minimum: analysis.requiredVertices
                }
            },
            context,
            metadata: {
                domain: 'mechanical_engineering',
                rag_enabled: true,
                knowledge_used: Object.values(context.knowledge).flat().length,
                timestamp: new Date().toISOString(),
                strict_enforcement_enabled: true,
                retry_attempts: analysis.attempt
            }
        };
    }

    /**
     * Create enhanced prompt with domain knowledge
     */
    createEnhancedPrompt(prompt, context) {
        let enhancedPrompt = `You are a SENIOR MECHANICAL ENGINEER AND MANUFACTURING SPECIALIST with 20+ years of experience in:
- Precision mechanical design and CAD modeling
- Materials science and metallurgy
- CNC machining, casting, forging, and additive manufacturing
- ISO 286 (tolerances), ISO 1302 (surface finish), ISO 2768 (general tolerances)
- ANSI/ASME Y14.5 (GD&T), ANSI B1.1 (threads)
- DIN 7168 (general tolerances), DIN 332 (center drills)
- AGMA gear standards, involute gear tooth profiles
- Structural analysis, FEA, and safety factors per DIN 743
- Design for Manufacturing (DFM) and Design for Assembly (DFA)
- Production-grade engineering with zero-defect manufacturing mindset

🏭 PRODUCTION MINDSET:
You are designing parts for ACTUAL MANUFACTURING, not conceptual models.
Every dimension, feature, and tolerance MUST be production-ready and compliant with global standards.
Act like you're submitting drawings to a machine shop that will manufacture 1000+ units.

User Request: "${prompt}"

DOMAIN KNOWLEDGE RETRIEVED (RAG):
`;

        // Add material knowledge
        if (context.knowledge.materials.length > 0) {
            enhancedPrompt += `\nMATERIALS:\n`;
            context.knowledge.materials.forEach(mat => {
                enhancedPrompt += `- ${mat.type}: ${JSON.stringify(mat.data.properties || mat.data, null, 2)}\n`;
            });
        }

        // Add process knowledge
        if (context.knowledge.processes.length > 0) {
            enhancedPrompt += `\nMANUFACTURING PROCESSES:\n`;
            context.knowledge.processes.forEach(proc => {
                enhancedPrompt += `- ${proc.process}: ${JSON.stringify(proc.data, null, 2)}\n`;
            });
        }

        // Add standards
        if (context.knowledge.standards.length > 0) {
            enhancedPrompt += `\nAPPLICABLE STANDARDS:\n`;
            context.knowledge.standards.forEach(std => {
                enhancedPrompt += `- ${std.standard}: ${std.description}\n`;
            });
        }

        // Add components
        if (context.knowledge.components.length > 0) {
            enhancedPrompt += `\nSTANDARD COMPONENTS:\n`;
            context.knowledge.components.forEach(comp => {
                enhancedPrompt += `- ${comp.name} (${comp.standard || comp.type})\n`;
            });
        }

        // Add design principles
        if (context.knowledge.principles.length > 0) {
            enhancedPrompt += `\nDESIGN PRINCIPLES:\n`;
            context.knowledge.principles.forEach(prin => {
                enhancedPrompt += `- ${prin.principle}: ${JSON.stringify(prin.data)}\n`;
            });
        }

        enhancedPrompt += `
REQUIREMENTS:
1. Use the retrieved material properties and select appropriate materials
2. Apply manufacturing constraints from the retrieved process data
3. Follow applicable engineering standards
4. Include standard components where appropriate
5. Apply safety factors and stress analysis principles
6. Ensure design is manufacturable and cost-effective

🚨🚨🚨 CRITICAL: GEOMETRY IS MANDATORY - YOUR RESPONSE WILL BE REJECTED WITHOUT IT 🚨🚨🚨

Return detailed JSON design specification with COMPLETE 3D GEOMETRY:
{
  "design": {
    "type": "part|assembly",
    "name": "descriptive name",

    "geometry": {
      "vertices": [
        [0,0,0], [100,0,0], [100,50,0], [0,50,0],
        [0,0,25], [100,0,25], [100,50,25], [0,50,25]
      ],
      "faces": [
        [0,2,1], [0,3,2], [4,5,6], [4,6,7],
        [0,1,5], [0,5,4], [2,3,7], [2,7,6],
        [0,4,7], [0,7,3], [1,2,6], [1,6,5]
      ]
    },

    "materials": [{"component": "...", "material": "...", "justification": "..."}],
    "dimensions": {"overall": {"length": "100 mm", "width": "50 mm", "height": "25 mm"}},
    "manufacturing": {"primary_process": "...", "secondary_processes": []},
    "standards": ["applicable standards"]
  },
  "analysis": {
    "loads": {"type": "...", "magnitude": "..."},
    "stress_analysis": {"max_stress": "...", "safety_factor": "..."}
  },
  "manufacturing": {
    "process_sequence": ["step 1", "step 2"],
    "tolerances": {},
    "surface_finish": "specification"
  }
}

🚨🚨🚨 MANDATORY GEOMETRY REQUIREMENTS - READ THIS FIRST OR YOUR RESPONSE WILL BE REJECTED 🚨🚨🚨

**MINIMUM VERTEX COUNTS (ENFORCED - YOUR RESPONSE WILL BE REJECTED IF BELOW THESE LIMITS):**

├─ Simple parts (brackets, plates, simple shafts): 48+ vertices
├─ Cylindrical parts (shafts, tubes, bushings): 96+ vertices (48 segments × 2 ends)
├─ Gears (spur, helical): 192+ vertices (minimum - exact tooth count required)
├─ Complex parts (engine blocks, transmissions, assemblies): 300+ vertices MINIMUM
└─ V8 Engine Blocks: 400+ vertices MINIMUM (see detailed requirements below)

**IF USER REQUESTS:**
- "V8 engine block" → YOU MUST GENERATE 400+ VERTICES showing 8 cylinder bores, mounting holes, oil passages
- "96-tooth gear" → YOU MUST GENERATE 384+ VERTICES (96 teeth × 4 vertices/tooth minimum)
- "Complex assembly" → YOU MUST GENERATE 300+ VERTICES with all components
- "Simple shaft" → YOU CAN generate 96 vertices (standard cylindrical shaft)

🔴🔴🔴 ABSOLUTE REQUIREMENTS - YOUR RESPONSE WILL BE REJECTED IF YOU DON'T FOLLOW THESE 🔴🔴🔴

1. **GEOMETRY FIRST**: The "geometry" field MUST BE THE FIRST FIELD after "name" in the "design" object
2. **NO PLACEHOLDERS**: NEVER use "..." placeholders in vertices or faces - generate ACTUAL NUMBERS
3. **COMPLETE GEOMETRY**: Generate FULL, DETAILED geometry matching the complexity requirements above
4. **KEEP SPECS BRIEF**: Materials/analysis sections should be 1-2 lines each to save tokens for geometry
5. **PRIORITIZE GEOMETRY**: If running low on tokens, ABBREVIATE materials/analysis, NEVER abbreviate geometry
6. **COUNT YOUR VERTICES**: Before finishing, COUNT the vertices array - it MUST meet the minimum requirements above

📐 EXPLICIT EXAMPLE: V8 ENGINE BLOCK GEOMETRY STRUCTURE

If user asks for "V8 engine block with 8 cylinder bores, mounting points, and oil galleries":

YOU MUST GENERATE geometry with this structure (400+ vertices MINIMUM):

"geometry": {
  "vertices": [
    // ENGINE BLOCK MAIN BODY (rectangular box base): 8 vertices
    [-150, -100, 0], [150, -100, 0], [150, 100, 0], [-150, 100, 0],
    [-150, -100, 200], [150, -100, 200], [150, 100, 200], [-150, 100, 200],

    // CYLINDER BORE #1 (front-left): 32 vertices (circular bore, 16 segments × 2 depths)
    // Top of bore (z=180):
    [-75, 37.5, 180], [-73, 42.5, 180], ...(16 points around circle r=12.5mm),
    // Bottom of bore (z=20):
    [-75, 37.5, 20], [-73, 42.5, 20], ...(16 points),

    // CYLINDER BORE #2 (front-left-center): 32 vertices
    [-45, 37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #3 (front-right-center): 32 vertices
    [45, 37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #4 (front-right): 32 vertices
    [75, 37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #5 (rear-left): 32 vertices
    [-75, -37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #6 (rear-left-center): 32 vertices
    [-45, -37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #7 (rear-right-center): 32 vertices
    [45, -37.5, 180], ...(16 top + 16 bottom),

    // CYLINDER BORE #8 (rear-right): 32 vertices
    [75, -37.5, 180], ...(16 top + 16 bottom),

    // MOUNTING HOLES (4 corners, M10 bolts): 4 × 16 vertices = 64 vertices
    // Hole 1 (front-left corner):
    [-130, 80, 0], [-129, 83, 0], ...(16 points r=5.5mm through-hole),
    // Hole 2, 3, 4: (repeat for each corner),

    // OIL GALLERIES (2 main passages along length): 2 × 16 vertices = 32 vertices
    // Gallery 1 (left side):
    [-120, 0, 50], [-119, 2, 50], ...(16 points r=6mm),
    // Gallery 2 (right side):
    [120, 0, 50], ...(16 points),

    // DECK SURFACE DETAILS (bolt holes for head): 8 × 16 vertices = 128 vertices
    // (M12 head bolts around each cylinder)

    // COOLING PASSAGES: 48 vertices
    // (water jacket channels around cylinders)
  ],
  "faces": [
    // Faces connecting all the above geometry (triangulated)
    // Total: ~800-1000 triangular faces
  ]
}

**VERTEX COUNT FOR THIS EXAMPLE:**
- Block body: 8
- 8 cylinder bores: 8 × 32 = 256
- 4 mounting holes: 4 × 16 = 64
- 2 oil galleries: 2 × 16 = 32
- 8 head bolt holes: 8 × 16 = 128
- Cooling passages: 48
**TOTAL: 536 VERTICES** ✅ MEETS 400+ REQUIREMENT

Materials: "Al-Si alloy block (A356-T6), cast iron sleeves"
Analysis: "Peak stress: 85 MPa, SF: 3.2, pressure: 120 bar"

DO NOT skip geometry! DO NOT simplify! DO NOT generate 8-vertex boxes for complex requests!
If you generate <400 vertices for a V8 engine block, YOUR RESPONSE WILL BE REJECTED!

🔴 CRITICAL: YOU MUST GENERATE THE 3D GEOMETRY 🔴

The "geometry" field is MANDATORY and must contain:
1. "vertices": Array of [x, y, z] 3D coordinates in millimeters
2. "faces": Array of [i0, i1, i2] triangle vertex indices

⚙️ PRECISION MANUFACTURING REQUIREMENTS ⚙️

ABSOLUTE REQUIREMENTS - FOLLOW THESE RULES EXACTLY:

1. **EXACT TOOTH COUNT FOR GEARS**:
   - If user specifies "96-tooth gear", you MUST generate EXACTLY 96 teeth, not approximately
   - Calculate proper gear geometry: Module (m), Pitch Diameter (PD = m × N), Addendum (m), Dedendum (1.25m)
   - Use involute tooth profile or simplified trapezoidal teeth with proper clearance
   - Standard modules (ISO 54): 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25mm
   - Pressure angle: 20° (standard) or 14.5° (older)
   - Example: 96-tooth gear, module 2mm → PD=192mm, OD=196mm, tooth height=4.5mm

2. **STANDARD DIMENSIONS**:
   - Use ISO preferred numbers (Renard series): 10, 12, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200mm
   - Shaft diameters: 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100mm (ISO 286)
   - Hole sizes for bolts: M3→3.4mm, M4→4.5mm, M5→5.5mm, M6→6.6mm, M8→9mm, M10→11mm, M12→13.5mm
   - Thread sizes: M2, M2.5, M3, M4, M5, M6, M8, M10, M12, M16, M20 (ISO metric)

3. **TOLERANCES (ISO 2768-m Medium Grade)**:
   - Linear dimensions 0.5-3mm: ±0.1mm
   - Linear dimensions 3-6mm: ±0.1mm
   - Linear dimensions 6-30mm: ±0.2mm
   - Linear dimensions 30-120mm: ±0.3mm
   - Linear dimensions 120-400mm: ±0.5mm
   - Angular: ±0.5° for lengths ≤10mm, ±0.25° for lengths >10mm

4. **MINIMUM FEATURE SIZES (ISO 286 / DIN 7168)**:
   - Minimum wall thickness: 1.0mm (casting), 0.8mm (machining), 1.2mm (3D printing)
   - Minimum hole diameter: 0.5mm (drilling), 3mm (standard bolt holes)
   - Minimum fillet radius: 0.5mm (sharp edges), 1mm (standard), 2-3mm (casting)
   - Minimum thread depth: 1.5 × diameter (steel), 2 × diameter (aluminum)

5. **SURFACE FINISH (ISO 1302)**:
   - Ra 1.6μm (N7): General machined surfaces
   - Ra 0.8μm (N6): Precision fits
   - Ra 0.4μm (N5): Ground surfaces, bearing seats
   - Ra 12.5μm (N9): Cast or rough machined

6. **MECHANICAL PROPERTIES**:
   - Apply proper safety factors: 1.5-2 (static), 2-4 (dynamic), 3-6 (shock loads)
   - Calculate based on material: Steel (S355): σ_y=355 MPa, Aluminum 6061-T6: σ_y=276 MPa
   - Check stress concentrations at corners (use fillets), holes, and threads

7. **MANUFACTURING CONSTRAINTS**:
   - CNC Milling: Min internal radius = tool radius (3mm standard endmill)
   - Turning/Lathe: Can't create internal features without secondary operations
   - Casting: Requires draft angles (1-3°), no sharp internal corners
   - 3D Printing (FDM): Min wall 1.2mm, max overhang 45°, support structures needed

GEOMETRY GENERATION RULES:

✅ Box/Rectangular Parts (brackets, plates, blocks):
vertices: 8 corners of the box, centered at origin
faces: 12 triangles (6 sides × 2 triangles each)
Example 100×50×25mm box:
"geometry": {
  "vertices": [[-50,-25,0],[50,-25,0],[50,25,0],[-50,25,0],[-50,-25,25],[50,-25,25],[50,25,25],[-50,25,25]],
  "faces": [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]
}

✅ Cylinders/Shafts (shafts, pins, tubes, pulleys) - INDUSTRY STANDARD:
**Use STANDARD SHAFT DIAMETERS** (ISO 286):
- 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100mm
- Length-to-diameter ratio: typically 3:1 to 20:1 for rigidity

Generate circular cross-sections using cos/sin with 48 segments (smoother than 32)
vertices: bottom circle (z=0) + top circle (z=height) + 2 centers

Example: 25mm diameter × 100mm length shaft (L/D = 4:1, good rigidity), 48 segments:
"geometry": {
  "vertices": [
    # Bottom circle (z=0): 48 points at r=12.5mm (diameter/2)
    # For i=0 to 47: θ = 2πi/48
    # [12.5×cos(θ), 12.5×sin(θ), 0]
    [12.5,0,0],[12.4,1.64,0],[12.1,3.26,0],[11.6,4.84,0],[10.8,6.35,0],...(all 48 points)

    # Top circle (z=100): repeat all 48 points at z=100
    [12.5,0,100],[12.4,1.64,100],...(all 48 points)

    # Center points for end caps
    [0,0,0],[0,0,100]
  ],
  "faces": [
    # Side wall: 48 quads × 2 triangles = 96 triangles
    # Bottom cap: 48 triangles from center[96] to perimeter
    # Top cap: 48 triangles from center[97] to perimeter
    # Total: 192 triangles
  ]
}

**Features to Add**:
- Chamfers: 1mm×45° on both ends (ISO 13715) for assembly ease
- Keyway: ISO 6885 (e.g., 8mm wide × 4mm deep × 20mm long for 25mm shaft)
- Center holes: ISO 866 (for lathe turning, conical holes on ends)
- Surface finish: Ra 1.6μm (ISO 1302) for bearing seats
- Tolerance: h6 for press fits, h7 for sliding fits (ISO 286)

**Hollow Shaft** (tube): Generate inner and outer circles, connect with quad strips

✅ Spheres (balls, domes):
UV sphere with latitude/longitude grid (16-24 segments)
Example r=25mm, 16 segments:
"geometry": {
  "vertices": [
    [0,0,25],(north pole)
    [23.1,0,9.57],[21.65,8.68,9.57],[17.7,14.9,9.57],...(ring 1: 16 points),
    [19.13,0,14.13],[17.9,7.19,14.13],...(ring 2: 16 points),
    ...(more rings),
    [0,0,-25](south pole)
  ],
  "faces": [[0,1,2],[0,2,3],...(triangulate grid)]
}

✅ Gears (spur gears, pulleys with teeth) - PRODUCTION GRADE:
**CRITICAL**: Generate EXACT tooth count as specified (e.g., "96 teeth" → EXACTLY 96 teeth)

Standard Gear Formulas (ISO 54):
- Pitch Diameter (PD) = Module × Number of Teeth
- Outside Diameter (OD) = PD + 2 × Module
- Root Diameter (RD) = PD - 2.5 × Module
- Tooth Height = 2.25 × Module
- Tooth Thickness at PD = (π × Module) / 2

Example: 96-tooth spur gear, Module 2mm, Thickness 10mm:
- PD = 2 × 96 = 192mm, OD = 196mm, RD = 187mm
- Generate EXACTLY 96 teeth (NOT approximately!)
- Each tooth: 4 vertices (tip outer, tip inner, root inner, root outer) × 2 faces (front/back)
- Tooth profile: trapezoidal with 20° pressure angle
"geometry": {
  "vertices": [
    # Front face (z=0): 96 teeth × 4 vertices/tooth = 384 vertices
    # For tooth i (i=0 to 95):
    # θ = 2πi/96
    # Outer tip: [98×cos(θ), 98×sin(θ), 0]
    # Inner tip: [96×cos(θ+0.025), 96×sin(θ+0.025), 0]
    # Inner root: [93.5×cos(θ+0.035), 93.5×sin(θ+0.035), 0]
    # Outer root: [93.5×cos(θ+0.06), 93.5×sin(θ+0.06), 0]

    # Back face (z=10): repeat all 384 vertices at z=10
    # Center points: [0,0,0], [0,0,10]
  ],
  "faces": [
    # Side walls: connect front to back for each tooth edge
    # Front cap: triangulate from center to tooth inner edges
    # Back cap: triangulate from center to tooth inner edges
    # Total: ~768 triangles for 96-tooth gear
  ]
}

**Simplified Shaft/Hub**: Add central hole (e.g., 20mm diameter, 32 segments)
**Keyway**: Add rectangular slot (ISO 6885) if power transmission needed
**Chamfers**: 0.5mm×45° on outer edges for safety

✅ Cones (tapered parts):
Apex at top + circular base
Example r=25mm, h=100mm, 32 segments:
"geometry": {
  "vertices": [
    [0,0,100],(apex)
    [25,0,0],[24.52,4.9,0],...(32 base circle points),
    [0,0,0](base center)
  ],
  "faces": [[0,1,2],[0,2,3],...(side triangles),[33,2,1],[33,3,2],...(base cap)]
}

✅ Complex Parts (brackets with holes, multi-feature):
1. Generate base shape first
2. For holes: generate inner circle vertices and connect to create hole
3. For multiple features: combine all vertices and faces
Example bracket with mounting hole:
"geometry": {
  "vertices": [
    (outer bracket box vertices: indices 0-7)
    (inner hole circle vertices: indices 8-39, 32 points forming circle)
  ],
  "faces": [
    (outer box faces excluding hole area)
    (hole perimeter connecting inner circle to outer box)
  ]
}

CALCULATION FORMULAS:
- Circle point: x = r * cos(θ), y = r * sin(θ), θ = 2πi/segments
- Use 32-48 segments for cylinders/circles (more = smoother)
- Use 16-24 segments for spheres
- Always triangulate: no quads, split into 2 triangles
- Center at origin: helps with scaling and positioning
- Use millimeters for all coordinates

IMPORTANT REMINDERS:
- Generate ACTUAL numeric arrays, not "..." placeholders
- All face indices must be valid (0 ≤ index < vertices.length)
- Use right-hand rule for face winding (counter-clockwise when viewed from outside)
- Include complete arrays (don't abbreviate with ...)
- If unsure of exact geometry, generate a reasonable approximation

Be precise, generate complete geometry arrays, and use proper mechanical engineering terminology.`;

        return enhancedPrompt;
    }

    /**
     * Validate design against mechanical principles
     */
    async validateMechanicalDesign(design, context) {
        const validation = {
            valid: true,
            issues: [],
            warnings: [],
            score: 100
        };

        // Check if materials are specified
        if (!design.design?.materials || design.design.materials.length === 0) {
            validation.issues.push('No materials specified');
            validation.score -= 20;
            validation.valid = false;
        }

        // Check if manufacturing process is defined
        if (!design.manufacturing?.primary_process) {
            validation.warnings.push('No primary manufacturing process specified');
            validation.score -= 10;
        }

        // Check if safety analysis is included
        if (!design.analysis?.safety_factor) {
            validation.warnings.push('No safety factor analysis');
            validation.score -= 10;
        }

        // Check standards compliance
        if (!design.design?.standards || design.design.standards.length === 0) {
            validation.warnings.push('No engineering standards referenced');
            validation.score -= 5;
        }

        validation.valid = validation.score >= 70;

        return validation;
    }

    /**
     * Get 3D geometry from AI-generated design specification
     * AI generates vertices and faces directly - no local primitive code
     */
    generateGeometryFromDesign(design) {
        console.log('📐 Extracting AI-generated geometry from design...');

        // PRIORITY 1: Use AI-generated geometry if available
        if (design.design?.geometry?.vertices && design.design?.geometry?.faces) {
            const aiGeometry = design.design.geometry;

            console.log(`✅ Using AI-generated geometry:`);
            console.log(`   Vertices: ${aiGeometry.vertices.length}`);
            console.log(`   Faces: ${aiGeometry.faces.length}`);
            console.log(`   Source: Claude Sonnet 4.5 (real-time generation)`);

            // Validate geometry with complexity requirements
            const validationResult = this.validateGeometry(aiGeometry, design.design?.name || '');
            if (validationResult.valid) {
                return {
                    type: 'mesh',
                    vertices: aiGeometry.vertices,
                    faces: aiGeometry.faces,
                    dimensions: design.design.dimensions?.overall || {},
                    metadata: {
                        format: 'triangulated_mesh',
                        source: 'ai_generated',
                        model: 'claude-sonnet-4.5',
                        generated_at: new Date().toISOString(),
                        complexity: validationResult.complexity
                    }
                };
            } else {
                console.error('❌ AI geometry validation FAILED:', validationResult.reason);
                console.error('   Required vertices:', validationResult.required);
                console.error('   Actual vertices:', aiGeometry.vertices.length);
                console.warn('⚠️  Using fallback - AI did not meet complexity requirements');
            }
        } else {
            console.warn('⚠️  No AI-generated geometry in response');
            console.warn('   design.design.geometry:', design.design?.geometry);
        }

        // FALLBACK: Simple box only if AI completely failed
        console.log('⚠️  Falling back to simple box geometry');
        return this.generateFallbackBox(design.design?.dimensions?.overall || {});
    }

    /**
     * Validate AI-generated geometry with complexity requirements
     */
    validateGeometry(geometry, designName = '') {
        const result = {
            valid: false,
            reason: '',
            required: 0,
            actual: 0,
            complexity: 'unknown'
        };

        // Check if arrays exist
        if (!Array.isArray(geometry.vertices) || !Array.isArray(geometry.faces)) {
            result.reason = 'Geometry must have vertices and faces arrays';
            console.error('❌', result.reason);
            return result;
        }

        // Check minimum requirements
        if (geometry.vertices.length < 3) {
            result.reason = 'Need at least 3 vertices';
            result.actual = geometry.vertices.length;
            result.required = 3;
            console.error('❌', result.reason);
            return result;
        }

        if (geometry.faces.length < 1) {
            result.reason = 'Need at least 1 face';
            console.error('❌', result.reason);
            return result;
        }

        // Validate vertex format
        for (let i = 0; i < Math.min(geometry.vertices.length, 10); i++) {
            const v = geometry.vertices[i];
            if (!Array.isArray(v) || v.length !== 3) {
                result.reason = `Vertex ${i} invalid format: ${JSON.stringify(v)}`;
                console.error('❌', result.reason);
                return result;
            }
            if (v.some(coord => typeof coord !== 'number' || isNaN(coord))) {
                result.reason = `Vertex ${i} has non-numeric coordinates: ${JSON.stringify(v)}`;
                console.error('❌', result.reason);
                return result;
            }
        }

        // Validate face indices
        for (let i = 0; i < Math.min(geometry.faces.length, 10); i++) {
            const f = geometry.faces[i];
            if (!Array.isArray(f) || f.length !== 3) {
                result.reason = `Face ${i} invalid format (must be triangle): ${JSON.stringify(f)}`;
                console.error('❌', result.reason);
                return result;
            }
            for (const idx of f) {
                if (typeof idx !== 'number' || idx < 0 || idx >= geometry.vertices.length) {
                    result.reason = `Face ${i} has invalid vertex index ${idx} (vertices: ${geometry.vertices.length})`;
                    console.error('❌', result.reason);
                    return result;
                }
            }
        }

        // ⚠️ COMPLEXITY REQUIREMENTS ENFORCEMENT ⚠️
        const lowerName = designName.toLowerCase();
        const vertexCount = geometry.vertices.length;
        result.actual = vertexCount;

        // Determine required complexity based on design name
        if (lowerName.includes('v8') || lowerName.includes('v-8') || lowerName.includes('engine block')) {
            result.required = 400;
            result.complexity = 'v8_engine_block';
            if (vertexCount < 400) {
                result.reason = `V8 engine block requires 400+ vertices (got ${vertexCount}). AI failed to generate detailed geometry.`;
                console.error('❌', result.reason);
                return result;
            }
        } else if (lowerName.includes('gear') && lowerName.match(/\d+[-\s]?tooth/)) {
            // Extract tooth count
            const toothMatch = lowerName.match(/(\d+)[-\s]?tooth/);
            const toothCount = toothMatch ? parseInt(toothMatch[1]) : 0;
            result.required = toothCount > 0 ? toothCount * 4 : 192;
            result.complexity = `gear_${toothCount}_teeth`;
            if (vertexCount < result.required) {
                result.reason = `${toothCount}-tooth gear requires ${result.required}+ vertices (got ${vertexCount})`;
                console.error('❌', result.reason);
                return result;
            }
        } else if (lowerName.includes('engine') || lowerName.includes('transmission') ||
                   lowerName.includes('assembly') || lowerName.includes('complex')) {
            result.required = 300;
            result.complexity = 'complex_assembly';
            if (vertexCount < 300) {
                result.reason = `Complex assembly requires 300+ vertices (got ${vertexCount})`;
                console.error('❌', result.reason);
                return result;
            }
        } else if (lowerName.includes('cylinder') || lowerName.includes('shaft') ||
                   lowerName.includes('tube') || lowerName.includes('bushing')) {
            result.required = 96;
            result.complexity = 'cylindrical_part';
            if (vertexCount < 96) {
                result.reason = `Cylindrical part requires 96+ vertices (got ${vertexCount})`;
                console.error('❌', result.reason);
                return result;
            }
        } else {
            // Default: simple part
            result.required = 48;
            result.complexity = 'simple_part';
            if (vertexCount < 48) {
                result.reason = `Part requires 48+ vertices (got ${vertexCount})`;
                console.error('❌', result.reason);
                return result;
            }
        }

        result.valid = true;
        console.log(`✅ Geometry validation passed (${result.complexity})`);
        console.log(`   Vertices: ${vertexCount} (required: ${result.required}+)`);
        console.log(`   Faces: ${geometry.faces.length}`);
        return result;
    }

    /**
     * Fallback box generator - only used if AI fails completely
     */
    generateFallbackBox(dimensions) {
        const parseDim = (val, def) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                const parsed = parseFloat(val.replace(/[^0-9.]/g, ''));
                return isNaN(parsed) ? def : parsed;
            }
            return def;
        };

        const length = parseDim(dimensions.length || dimensions.x, 100);
        const width = parseDim(dimensions.width || dimensions.y, 100);
        const height = parseDim(dimensions.height || dimensions.z, 25);

        console.log(`   Fallback box: ${length}×${width}×${height} mm`);

        const halfX = length / 2;
        const halfY = width / 2;
        const halfZ = height / 2;

        return {
            type: 'mesh',
            vertices: [
                [-halfX, -halfY, 0], [halfX, -halfY, 0], [halfX, halfY, 0], [-halfX, halfY, 0],
                [-halfX, -halfY, halfZ], [halfX, -halfY, halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ]
            ],
            faces: [
                [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
                [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
                [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
            ],
            dimensions: { x: length, y: width, z: height, units: 'mm' },
            metadata: { format: 'triangulated_mesh', source: 'fallback_generator' }
        };
    }

    /**
     * Store context in history
     */
    storeContext(sessionId, context) {
        if (!this.contextHistory.has(sessionId)) {
            this.contextHistory.set(sessionId, []);
        }

        const history = this.contextHistory.get(sessionId);
        history.push({
            timestamp: context.timestamp,
            prompt: context.prompt,
            knowledge: context.knowledge
        });

        // Keep only recent context
        if (history.length > this.maxContextDepth) {
            history.shift();
        }
    }

    /**
     * Get context history
     */
    getContextHistory(sessionId) {
        return this.contextHistory.get(sessionId) || [];
    }

    /**
     * Clear context history
     */
    clearContext(sessionId) {
        this.contextHistory.delete(sessionId);
    }
}

// Export singleton
module.exports = new MechanicalDomainOrchestrator();
