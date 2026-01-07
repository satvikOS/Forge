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
        console.log('\n⚙️  === MECHANICAL DOMAIN GENERATION ===');

        // Build rich context
        const context = await this.buildMechanicalContext(prompt, options.sessionId);

        // Create enhanced prompt with domain knowledge
        const enhancedPrompt = this.createEnhancedPrompt(prompt, context);

        // Generate design using Claude Sonnet 4.5 with mechanical expertise
        console.log('🤖 Generating with Claude Sonnet 4.5 (Mechanical Domain Expert)...');
        const designSpec = await this.bedrockService.generateContent(enhancedPrompt, {
            modelId: process.env.BEDROCK_TEXT_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
        });

        const design = this.bedrockService.parseJSON(designSpec);

        // Check if JSON parsing failed
        if (!design) {
            console.error('❌ Failed to parse design specification from AI response');
            throw new Error('Failed to parse JSON from AI response. The AI may have returned malformed data.');
        }

        // Validate design against mechanical engineering principles
        const validation = await this.validateMechanicalDesign(design, context);

        // Generate 3D geometry from design specification
        const baseGeometry = this.generateGeometryFromDesign(design);

        // Process through AXEL voxel engine for advanced topology
        const geometry = this.axelEngine.processMesh(baseGeometry);

        console.log('✅ Mechanical design generated');
        console.log(`   Validation: ${validation.valid ? 'PASS' : 'FAIL'}`);
        console.log(`   Geometry: ${geometry.vertices.length} vertices, ${geometry.faces.length} faces`);
        console.log(`   Engine: AXEL (voxel-based)`);

        return {
            design: {
                ...design,
                geometry  // Add AXEL-processed 3D geometry to the design
            },
            validation,
            context,
            metadata: {
                domain: 'mechanical_engineering',
                rag_enabled: true,
                knowledge_used: Object.values(context.knowledge).flat().length,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Create enhanced prompt with domain knowledge
     */
    createEnhancedPrompt(prompt, context) {
        let enhancedPrompt = `You are an EXPERT MECHANICAL ENGINEER with deep knowledge of:
- Materials science and properties
- Manufacturing processes and constraints
- Engineering standards (ISO, ASME, DIN)
- Structural analysis and stress calculations
- Design for manufacturing (DFM)
- Failure modes and safety factors

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

Return detailed JSON design specification with COMPLETE 3D GEOMETRY:
{
  "design": {
    "type": "part|assembly",
    "name": "descriptive name",
    "materials": [{"component": "...", "material": "...", "justification": "..."}],
    "dimensions": {"overall": {"length": "100 mm", "width": "50 mm", "height": "25 mm"}},
    "geometry": {
      "vertices": [[x,y,z], [x,y,z], ...],
      "faces": [[i0,i1,i2], [i0,i1,i2], ...]
    },
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

🔴 CRITICAL: YOU MUST GENERATE THE 3D GEOMETRY 🔴

The "geometry" field is MANDATORY and must contain:
1. "vertices": Array of [x, y, z] 3D coordinates in millimeters
2. "faces": Array of [i0, i1, i2] triangle vertex indices

GEOMETRY GENERATION RULES:

✅ Box/Rectangular Parts (brackets, plates, blocks):
vertices: 8 corners of the box, centered at origin
faces: 12 triangles (6 sides × 2 triangles each)
Example 100×50×25mm box:
"geometry": {
  "vertices": [[-50,-25,0],[50,-25,0],[50,25,0],[-50,25,0],[-50,-25,25],[50,-25,25],[50,25,25],[-50,25,25]],
  "faces": [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]
}

✅ Cylinders (shafts, pins, tubes, pulleys):
Generate circular cross-sections using cos/sin with 32-48 segments
vertices: bottom circle (z=0) + top circle (z=height) + 2 centers
Example r=25mm, h=100mm, 32 segments (generate ALL 32 points):
"geometry": {
  "vertices": [
    [25,0,0],[24.52,4.9,0],[23.1,9.57,0],[21,14,0],[18.3,17.7,0],[14.9,20.6,0],[10.9,22.7,0],[6.5,24,0],
    [1.9,24.5,0],[-2.7,24,-0],[-7.1,22.7,0],[-11.3,20.6,0],[-14.9,17.7,0],[-17.9,14,0],[-20.2,9.57,0],[-21.7,4.9,0],
    [-22.2,0,0],[-21.7,-4.9,0],[-20.2,-9.57,0],[-17.9,-14,0],[-14.9,-17.7,0],[-11.3,-20.6,0],[-7.1,-22.7,0],[-2.7,-24,0],
    [1.9,-24.5,0],[6.5,-24,0],[10.9,-22.7,0],[14.9,-20.6,0],[18.3,-17.7,0],[21,-14,0],[23.1,-9.57,0],[24.52,-4.9,0],
    [25,0,100],[24.52,4.9,100],...(repeat for top circle at z=100),[0,0,0],[0,0,100]
  ],
  "faces": [[0,1,33],[33,1,34],[1,2,34],...(side quads as 2 triangles),[64,1,0],[64,2,1],...(caps)]
}

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

✅ Gears (spur gears, pulleys with teeth):
Generate tooth profile using proper involute curve or simplified rectangular teeth
Example 16-tooth gear, 50mm diameter:
"geometry": {
  "vertices": [
    (for each tooth: outer tip, valley, repeat 16 times around circle)
    (use r_outer=25mm for tips, r_inner=22mm for valleys)
    [25,0,0],[24,2.5,0],[22,2.5,0],[24,5,0],[25,7.1,0],...(tooth profile),
    (extrude to thickness: repeat all vertices at z=10mm)
  ],
  "faces": [(connect teeth profiles, add top/bottom caps, side walls)]
}

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
     * Generate 3D geometry from design specification
     * Creates a procedural mesh that can be rendered in Three.js
     */
    generateGeometryFromDesign(design) {
        const geometryType = design.design?.geometry_type || 'box';
        const dimensions = design.design?.dimensions || {};
        const specific = dimensions.specific || {};
        const overall = dimensions.overall || {};

        console.log(`📐 Generating ${geometryType} geometry...`);

        // Route to appropriate geometry generator
        switch (geometryType.toLowerCase()) {
            case 'cylinder':
                return this.generateCylinder(overall, specific);
            case 'sphere':
                return this.generateSphere(overall, specific);
            case 'cone':
                return this.generateCone(overall, specific);
            case 'box':
            default:
                return this.generateBox(overall, specific);
        }
    }

    /**
     * Helper function to parse dimension strings like "100 mm" or numbers
     */
    parseDimension(value, defaultValue) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
            return isNaN(parsed) ? defaultValue : parsed;
        }
        return defaultValue;
    }

    /**
     * Generate box geometry
     */
    generateBox(overall, specific) {
        const length = this.parseDimension(overall.length || overall.x || overall.depth, 100);
        const width = this.parseDimension(overall.width || overall.y, 100);
        const height = this.parseDimension(overall.height || overall.z || overall.thickness, 25);

        console.log(`   Box: ${length}×${width}×${height} mm`);

        const halfX = length / 2;
        const halfY = width / 2;
        const halfZ = height / 2;

        const vertices = [
            [-halfX, -halfY, -halfZ], [halfX, -halfY, -halfZ], [halfX, halfY, -halfZ], [-halfX, halfY, -halfZ],
            [-halfX, -halfY, halfZ], [halfX, -halfY, halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ]
        ];

        const faces = [
            [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
            [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
        ];

        return {
            type: 'mesh',
            vertices, faces,
            dimensions: { x: length, y: width, z: height, units: 'mm' },
            metadata: { format: 'triangulated_mesh', shape: 'box' }
        };
    }

    /**
     * Generate cylinder geometry
     */
    generateCylinder(overall, specific) {
        const radius = this.parseDimension(specific.radius || overall.radius || overall.diameter / 2, 25);
        const height = this.parseDimension(overall.height || overall.length, 100);
        const segments = this.parseDimension(specific.segments, 32);

        console.log(`   Cylinder: r=${radius}mm, h=${height}mm, segments=${segments}`);

        const vertices = [];
        const faces = [];

        // Generate vertices for top and bottom circles
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            vertices.push([x, y, 0]);           // Bottom circle
            vertices.push([x, y, height]);       // Top circle
        }

        // Center vertices for caps
        const bottomCenter = vertices.length;
        vertices.push([0, 0, 0]);               // Bottom center
        const topCenter = vertices.length;
        vertices.push([0, 0, height]);          // Top center

        // Generate side faces
        for (let i = 0; i < segments; i++) {
            const b1 = i * 2;
            const b2 = (i * 2 + 2) % (segments * 2);
            const t1 = i * 2 + 1;
            const t2 = (i * 2 + 3) % (segments * 2);

            faces.push([b1, t1, b2]);
            faces.push([b2, t1, t2]);
        }

        // Generate cap faces
        for (let i = 0; i < segments; i++) {
            const b1 = i * 2;
            const b2 = (i * 2 + 2) % (segments * 2);
            const t1 = i * 2 + 1;
            const t2 = (i * 2 + 3) % (segments * 2);

            faces.push([bottomCenter, b2, b1]);  // Bottom cap
            faces.push([topCenter, t1, t2]);     // Top cap
        }

        return {
            type: 'mesh',
            vertices, faces,
            dimensions: { radius, height, units: 'mm' },
            metadata: { format: 'triangulated_mesh', shape: 'cylinder', segments }
        };
    }

    /**
     * Generate sphere geometry
     */
    generateSphere(overall, specific) {
        const radius = this.parseDimension(specific.radius || overall.radius || overall.diameter / 2, 25);
        const segments = this.parseDimension(specific.segments, 16);

        console.log(`   Sphere: r=${radius}mm, segments=${segments}`);

        const vertices = [];
        const faces = [];

        // Generate vertices using spherical coordinates
        for (let lat = 0; lat <= segments; lat++) {
            const theta = (lat * Math.PI) / segments;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= segments; lon++) {
                const phi = (lon * 2 * Math.PI) / segments;
                const x = Math.cos(phi) * sinTheta * radius;
                const y = Math.sin(phi) * sinTheta * radius;
                const z = cosTheta * radius;
                vertices.push([x, y, z]);
            }
        }

        // Generate faces
        for (let lat = 0; lat < segments; lat++) {
            for (let lon = 0; lon < segments; lon++) {
                const first = lat * (segments + 1) + lon;
                const second = first + segments + 1;

                faces.push([first, second, first + 1]);
                faces.push([second, second + 1, first + 1]);
            }
        }

        return {
            type: 'mesh',
            vertices, faces,
            dimensions: { radius, units: 'mm' },
            metadata: { format: 'triangulated_mesh', shape: 'sphere', segments }
        };
    }

    /**
     * Generate cone geometry
     */
    generateCone(overall, specific) {
        const radius = this.parseDimension(specific.radius || overall.radius || overall.diameter / 2, 25);
        const height = this.parseDimension(overall.height || overall.length, 100);
        const segments = this.parseDimension(specific.segments, 32);

        console.log(`   Cone: r=${radius}mm, h=${height}mm, segments=${segments}`);

        const vertices = [];
        const faces = [];

        // Apex vertex
        vertices.push([0, 0, height]);
        const apexIndex = 0;

        // Base circle vertices
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            vertices.push([x, y, 0]);
        }

        // Base center
        const baseCenter = vertices.length;
        vertices.push([0, 0, 0]);

        // Side faces (triangles from apex to base)
        for (let i = 0; i < segments; i++) {
            const b1 = i + 1;
            const b2 = i + 2;
            faces.push([apexIndex, b1, b2]);
        }

        // Base faces
        for (let i = 0; i < segments; i++) {
            const b1 = i + 1;
            const b2 = i + 2;
            faces.push([baseCenter, b2, b1]);
        }

        return {
            type: 'mesh',
            vertices, faces,
            dimensions: { radius, height, units: 'mm' },
            metadata: { format: 'triangulated_mesh', shape: 'cone', segments }
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
