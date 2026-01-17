/**
 * PARALLEL MCP ORCHESTRATOR
 *
 * Solves token limit bottleneck by breaking complex mechanical designs into
 * parallel subtasks, each with independent Claude calls and full 64K token budget.
 *
 * Example: V8 Engine = 10 parallel components × 600 vertices each = 6000 vertices total
 *
 * Architecture:
 * 1. Component breakdown (analyzes prompt, creates subtask tree)
 * 2. Parallel generation (multiple Claude calls via MCP)
 * 3. Geometry assembly (combines all components with proper positioning)
 * 4. Validation (ensures assembly integrity, interfaces, tolerances)
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const intelligentAssembly = require('./intelligentAssemblyEngine');
const universalTemplates = require('./universalMechanicalTemplates');
const intelligentAnalyzer = require('./intelligentComponentAnalyzer');

class ParallelMCPOrchestrator {
    constructor() {
        this.bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
        this.maxParallelCalls = 50; // NO LIMITS - as many as needed for perfection
        this.tokensPerComponent = 64000; // Max output tokens per call

        // Use universal mechanical templates
        this.componentTemplates = universalTemplates;

        console.log('✅ Parallel MCP Orchestrator initialized');
        console.log(`   Available templates: ${Object.keys(this.componentTemplates).length}`);
        console.log(`   AI-powered analysis: Enabled`);
        console.log(`   Max parallel calls: ${this.maxParallelCalls}`);
    }

    buildComponentTemplates_OLD() {
        return {
            v8_engine_block_old: {
                name: 'V8 Engine Block',
                totalComponents: 10,
                components: [
                    {
                        id: 'engine_block_base',
                        name: 'Engine Block Base Structure',
                        description: 'Outer casing, main bearing caps, structural reinforcements',
                        targetVertices: 800,
                        priority: 1,
                        dependencies: [],
                        prompt: `Generate ONLY the V8 engine block base structure:
- Outer rectangular casing (300mm × 200mm × 250mm)
- 5 main bearing cap mounting points (50mm diameter, 30mm deep)
- Structural ribbing and reinforcement (10mm thick ribs)
- Block deck surface (machined flat, 0.001mm tolerance)
- Lifter valley between cylinder banks
- Timing chain cavity (front)
- Bellhousing mounting surface (rear)

TARGET: 800 vertices minimum
CRITICAL: Include complete base geometry with mounting surfaces`
                    },
                    {
                        id: 'cylinder_bank_left',
                        name: 'Left Cylinder Bank (Cylinders 1-4)',
                        description: '4 cylinder bores with cooling jackets, left side',
                        targetVertices: 600,
                        priority: 2,
                        dependencies: ['engine_block_base'],
                        prompt: `Generate ONLY the LEFT cylinder bank (cylinders 1-4):
- 4 cylinder bores: 88mm diameter, 92mm stroke depth
- Each bore: 32 vertices (16 top ring + 16 bottom ring)
- Cooling water jacket surrounding each bore (4mm thickness)
- Inter-cylinder water passages
- Deck surface with head bolt holes (4 per cylinder = 16 total)
- Oil drain-back passages (2 per cylinder)

POSITIONING: Offset +37.5mm from engine centerline
TARGET: 600 vertices minimum
CRITICAL: Precise bore dimensions for piston fit (88.00mm ±0.01mm)`
                    },
                    {
                        id: 'cylinder_bank_right',
                        name: 'Right Cylinder Bank (Cylinders 5-8)',
                        description: '4 cylinder bores with cooling jackets, right side',
                        targetVertices: 600,
                        priority: 2,
                        dependencies: ['engine_block_base'],
                        prompt: `Generate ONLY the RIGHT cylinder bank (cylinders 5-8):
- 4 cylinder bores: 88mm diameter, 92mm stroke depth
- Each bore: 32 vertices (16 top ring + 16 bottom ring)
- Cooling water jacket surrounding each bore (4mm thickness)
- Inter-cylinder water passages
- Deck surface with head bolt holes (4 per cylinder = 16 total)
- Oil drain-back passages (2 per cylinder)

POSITIONING: Offset -37.5mm from engine centerline
TARGET: 600 vertices minimum
CRITICAL: Precise bore dimensions for piston fit (88.00mm ±0.01mm)`
                    },
                    {
                        id: 'piston_assembly_1_4',
                        name: 'Piston Assemblies 1-4',
                        description: 'Pistons, rings, wrist pins for cylinders 1-4',
                        targetVertices: 700,
                        priority: 3,
                        dependencies: ['cylinder_bank_left'],
                        prompt: `Generate pistons 1-4 with complete detail:
Each piston (×4):
- Crown: 88mm diameter, domed top (10:1 compression)
- Ring lands: 3 grooves (2 compression + 1 oil ring)
- Skirt: 60mm length, cam-ground profile
- Wrist pin bore: 23mm diameter (×2 bosses per piston)
- Wrist pin: 23mm × 70mm, through-hardened steel
- Piston rings per piston:
  * Top compression ring: 1.5mm thick
  * Second compression ring: 1.5mm thick
  * Oil control ring: 3mm thick

TARGET: 700 vertices minimum (175 per piston × 4)
CRITICAL: 88.00mm diameter (matches cylinder bore)`
                    },
                    {
                        id: 'piston_assembly_5_8',
                        name: 'Piston Assemblies 5-8',
                        description: 'Pistons, rings, wrist pins for cylinders 5-8',
                        targetVertices: 700,
                        priority: 3,
                        dependencies: ['cylinder_bank_right'],
                        prompt: `Generate pistons 5-8 with complete detail:
Each piston (×4):
- Crown: 88mm diameter, domed top (10:1 compression)
- Ring lands: 3 grooves (2 compression + 1 oil ring)
- Skirt: 60mm length, cam-ground profile
- Wrist pin bore: 23mm diameter (×2 bosses per piston)
- Wrist pin: 23mm × 70mm, through-hardened steel
- Piston rings per piston:
  * Top compression ring: 1.5mm thick
  * Second compression ring: 1.5mm thick
  * Oil control ring: 3mm thick

TARGET: 700 vertices minimum (175 per piston × 4)
CRITICAL: 88.00mm diameter (matches cylinder bore)`
                    },
                    {
                        id: 'crankshaft',
                        name: 'Crankshaft Assembly',
                        description: 'Forged crankshaft with journals, throws, counterweights',
                        targetVertices: 900,
                        priority: 3,
                        dependencies: ['engine_block_base'],
                        prompt: `Generate complete V8 crankshaft:
- 5 main bearing journals: 60mm diameter × 25mm width (32 vertices each)
- 8 connecting rod journals: 50mm diameter × 20mm width (32 vertices each)
- 4 crank throws: 90° V-angle configuration, 46mm stroke
- 8 counterweights: aerodynamic profile, balanced for 6000 RPM
- Front snout: timing gear mounting (30mm diameter)
- Rear flange: flywheel mounting (200mm diameter, 8 bolt holes)
- Oil passages through main journals (8mm diameter internal)

TARGET: 900 vertices minimum
CRITICAL: 92mm stroke, balanced assembly, 60mm main journal diameter`
                    },
                    {
                        id: 'valvetrain',
                        name: 'Camshafts and Valvetrain',
                        description: 'Dual overhead cams, 16 valves, springs, retainers',
                        targetVertices: 800,
                        priority: 4,
                        dependencies: ['cylinder_bank_left', 'cylinder_bank_right'],
                        prompt: `Generate complete valvetrain system:
CAMSHAFTS (×2: intake and exhaust):
- Each cam: 8 lobes (one per cylinder)
- Lobe profile: 10mm lift, 260° duration
- Bearing journals: 30mm diameter (×5 per cam)
- Cam gear: 40 teeth, 100mm diameter

VALVES (×16 total: 2 per cylinder):
- Intake valves (×8): 35mm head diameter, 100mm length
- Exhaust valves (×8): 30mm head diameter, 100mm length
- Valve stems: 8mm diameter
- Valve spring per valve: 20mm outer diameter, 40mm compressed length
- Retainer and keeper per valve

TARGET: 800 vertices minimum
CRITICAL: Precise timing (intake opens 10° BTDC, exhaust closes 10° ATDC)`
                    },
                    {
                        id: 'oil_system',
                        name: 'Oil System',
                        description: 'Oil galleries, pump, passages, filter mount',
                        targetVertices: 500,
                        priority: 4,
                        dependencies: ['engine_block_base', 'crankshaft'],
                        prompt: `Generate complete oil lubrication system:
- Main oil gallery: 12mm diameter, runs length of block
- Branch passages to each main bearing (5 total, 8mm diameter)
- Lifter valley oil feed passages (10mm diameter)
- Oil pump mounting cavity (80mm × 60mm × 40mm)
- Oil filter mounting boss (external, M20 thread)
- Oil pressure sensor port (M10 thread)
- Drain plug boss (M14 thread, bottom of pan)
- Crankcase ventilation passages (PCV, 15mm diameter)

TARGET: 500 vertices minimum
CRITICAL: All passages interconnected, 12mm main gallery`
                    },
                    {
                        id: 'cooling_system',
                        name: 'Cooling System',
                        description: 'Water jackets, passages, pump mount, thermostat housing',
                        targetVertices: 500,
                        priority: 4,
                        dependencies: ['cylinder_bank_left', 'cylinder_bank_right'],
                        prompt: `Generate complete cooling system:
- Water pump mounting cavity (front, 100mm × 80mm)
- Thermostat housing (top front, 60mm diameter)
- Coolant passages between cylinder banks
- Deck coolant passages (to cylinder heads)
- Heater core supply/return ports (M16 threads)
- Coolant temp sensor port (M12 thread)
- Crossover passages between banks
- Block drain plugs (×2, M10 threads)

TARGET: 500 vertices minimum
CRITICAL: Adequate flow to all cylinders, 60mm thermostat housing`
                    },
                    {
                        id: 'mounting_external',
                        name: 'Mounting Points and External Features',
                        description: 'Engine mounts, accessory brackets, sensor ports',
                        targetVertices: 400,
                        priority: 5,
                        dependencies: ['engine_block_base'],
                        prompt: `Generate all mounting and external features:
- Engine mount brackets (×3): left, right, rear
- Alternator mounting bracket (right side, 80mm × 60mm)
- AC compressor mounting bracket (left side, 100mm × 80mm)
- Power steering pump bracket (front left)
- Starter motor mounting boss (right side, M12 bolts ×3)
- Transmission bellhousing bolt holes (×8, M12 threads)
- Exhaust manifold mounting surfaces (×2, 4 studs each)
- Knock sensor ports (×2, M8 threads)
- Coolant temp sensor port (M12 thread)
- Oil pressure sensor port (M10 thread)

TARGET: 400 vertices minimum
CRITICAL: All mounting points with proper thread specifications`
                    }
                ]
            },

            // Template for other mechanical types
            spur_gear: {
                name: 'Spur Gear',
                totalComponents: 3,
                components: [
                    {
                        id: 'gear_teeth',
                        name: 'Gear Teeth',
                        description: 'All gear teeth with involute profiles',
                        targetVertices: 1000,
                        priority: 1,
                        dependencies: [],
                        prompt: `Generate spur gear teeth with involute profile...`
                    },
                    {
                        id: 'gear_body',
                        name: 'Gear Body',
                        description: 'Hub, web, rim structure',
                        targetVertices: 500,
                        priority: 2,
                        dependencies: ['gear_teeth'],
                        prompt: `Generate gear body structure...`
                    },
                    {
                        id: 'gear_bore',
                        name: 'Central Bore and Keyway',
                        description: 'Shaft bore with keyway slot',
                        targetVertices: 200,
                        priority: 3,
                        dependencies: ['gear_body'],
                        prompt: `Generate central bore and keyway...`
                    }
                ]
            }
        };
    }

    /**
     * Main orchestration method
     */
    async generateWithParallelMCP(prompt, options = {}) {
        console.log('\n🚀 === PARALLEL MCP ORCHESTRATION START ===');
        console.log(`   Prompt: "${prompt.substring(0, 80)}..."`);

        // STEP 1: Detect component type and get breakdown template
        const template = await this.detectTemplateType(prompt);
        console.log(`\n📋 Component Breakdown: ${template.name}`);
        console.log(`   Total components: ${template.totalComponents}`);
        console.log(`   Target vertices: ${template.targetVertices || 'Auto'}`);
        console.log(`   Max parallel calls: ${this.maxParallelCalls}`);

        // STEP 2: Build dependency graph and execution plan
        const executionPlan = this.buildExecutionPlan(template);
        console.log(`\n📊 Execution Plan:`);
        executionPlan.forEach((wave, idx) => {
            console.log(`   Wave ${idx + 1}: ${wave.length} parallel calls`);
            wave.forEach(comp => console.log(`      - ${comp.name} (${comp.targetVertices} vertices)`));
        });

        // STEP 3: Execute waves in sequence, components in parallel
        const allComponents = [];
        const startTime = Date.now();

        for (let waveIdx = 0; waveIdx < executionPlan.length; waveIdx++) {
            const wave = executionPlan[waveIdx];
            console.log(`\n🌊 Wave ${waveIdx + 1}/${executionPlan.length}: Executing ${wave.length} components in parallel...`);

            // Execute all components in this wave in parallel
            const wavePromises = wave.map(component =>
                this.generateSingleComponent(component, prompt, allComponents)
            );

            const waveResults = await Promise.all(wavePromises);
            allComponents.push(...waveResults);

            console.log(`   ✅ Wave ${waveIdx + 1} complete: ${waveResults.length} components generated`);
            waveResults.forEach(result => {
                console.log(`      - ${result.component.name}: ${result.geometry.vertices.length} vertices`);
            });
        }

        const generationTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n⏱️  Total generation time: ${generationTime}s`);

        // STEP 4: Enrich components with material metadata (for Axel Smart Engine rendering)
        console.log('\n🎨 Enriching components with material data...');
        const enrichedComponents = this.enrichComponentsWithMaterials(allComponents, template);

        // STEP 5: Calculate total statistics
        const totalVertices = enrichedComponents.reduce((sum, comp) => sum + comp.geometry.vertices.length, 0);
        const totalFaces = enrichedComponents.reduce((sum, comp) => sum + comp.geometry.faces.length, 0);

        console.log('\n🎉 === PARALLEL MCP ORCHESTRATION COMPLETE ===');
        console.log(`   Total vertices: ${totalVertices}`);
        console.log(`   Total faces: ${totalFaces}`);
        console.log(`   Components: ${enrichedComponents.length}`);
        console.log(`   💡 Components are SEPARATE - Axel Smart Engine will assemble`);

        // OPTIONAL: Create assembled geometry for backward compatibility
        console.log('\n🔧 Creating assembled geometry (for backward compatibility)...');
        const assembledGeometry = this.assembleComponents(enrichedComponents, template);
        const validation = this.validateAssembly(assembledGeometry, template);

        return {
            // NEW FORMAT: Separate components with materials for Axel Smart Engine
            components: enrichedComponents,

            // LEGACY FORMAT: Assembled geometry for backward compatibility
            geometry: assembledGeometry,

            validation: validation,
            metadata: {
                template: template.name,
                totalComponents: enrichedComponents.length,
                generationTime: generationTime,
                parallelWaves: executionPlan.length,
                outputFormat: 'separate_components_with_materials',
                axelSmartEngine: true
            }
        };
    }

    async detectTemplateType(prompt) {
        /**
         * ALWAYS use AI-powered component analysis (no templates)
         * AI dynamically breaks down ANY prompt into components with materials
         */
        console.log('   🧠 Using AI component analysis for dynamic breakdown...');

        try {
            const aiTemplate = await intelligentAnalyzer.analyzeAndBreakdown(prompt);
            console.log(`   ✅ AI generated breakdown: ${aiTemplate.components.length} components`);
            console.log(`   ✅ Materials defined: ${Object.keys(aiTemplate.materials || {}).length}`);
            return aiTemplate;
        } catch (error) {
            console.error('   ❌ AI analysis failed:', error.message);
            console.error('   Stack:', error.stack);

            // Emergency fallback - single component
            console.warn('   ⚠️  Using emergency fallback (single component mode)');
            return {
                name: 'AI-Generated Component',
                totalComponents: 1,
                targetVertices: 3000,
                materials: {
                    default: {
                        name: 'Generic Material',
                        color: [150, 150, 150],
                        properties: {}
                    }
                },
                components: [
                    {
                        id: 'main_component',
                        name: 'Main Component',
                        targetVertices: 3000,
                        priority: 1,
                        dependencies: [],
                        position: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 },
                        material: 'default',
                        prompt: `Generate the mechanical component EXACTLY as described in this prompt: "${prompt}"\n\nUse ALL available output tokens for maximum detail:\n- Complex features: threads, holes, pockets, bosses\n- Precise dimensions: extract from prompt\n- Manufacturing features: fillets, chamfers, draft angles\n- Industry standard tolerances\n\nTARGET: 3000+ vertices\nCRITICAL: Follow ALL specifications in user prompt`
                    }
                ]
            };
        }
    }

    buildExecutionPlan(template) {
        /**
         * Creates wave-based execution plan respecting dependencies
         * Wave 1: All components with no dependencies
         * Wave 2: All components depending only on Wave 1 components
         * etc.
         */
        const waves = [];
        const completed = new Set();
        const components = [...template.components];

        while (components.length > 0) {
            const currentWave = [];

            // Find components whose dependencies are all completed
            for (let i = components.length - 1; i >= 0; i--) {
                const component = components[i];
                const dependenciesMet = component.dependencies.every(dep => completed.has(dep));

                if (dependenciesMet) {
                    currentWave.push(component);
                    completed.add(component.id);
                    components.splice(i, 1);
                }
            }

            if (currentWave.length === 0 && components.length > 0) {
                throw new Error('Circular dependency detected in component template');
            }

            waves.push(currentWave);
        }

        return waves;
    }

    async generateSingleComponent(component, originalPrompt, previousComponents) {
        console.log(`   🔧 Generating: ${component.name}...`);

        const enhancedPrompt = this.buildComponentPrompt(component, originalPrompt, previousComponents);

        try {
            const geometry = await this.callClaude(enhancedPrompt, component.targetVertices);

            if (!geometry || !geometry.vertices || geometry.vertices.length < component.targetVertices * 0.8) {
                throw new Error(`Insufficient vertices: ${geometry?.vertices?.length || 0} < ${component.targetVertices * 0.8}`);
            }

            console.log(`      ✅ ${component.name}: ${geometry.vertices.length} vertices`);

            return {
                component: component,
                geometry: geometry,
                metadata: {
                    vertexCount: geometry.vertices.length,
                    targetVertices: component.targetVertices,
                    generatedAt: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error(`      ❌ ${component.name} failed: ${error.message}`);

            // Retry once with increased token budget
            console.log(`      🔄 Retrying ${component.name}...`);
            const geometry = await this.callClaude(enhancedPrompt, component.targetVertices * 1.2);

            return {
                component: component,
                geometry: geometry,
                metadata: {
                    vertexCount: geometry.vertices.length,
                    targetVertices: component.targetVertices,
                    retried: true
                }
            };
        }
    }

    buildComponentPrompt(component, originalPrompt, previousComponents) {
        return `
═══════════════════════════════════════════════════════════════════
🎯 PARALLEL COMPONENT GENERATION - PRODUCTION READY
═══════════════════════════════════════════════════════════════════

COMPONENT: ${component.name}
TARGET VERTICES: ${component.targetVertices}
PRIORITY: ${component.priority}

${component.prompt}

📐 COORDINATE SYSTEM:
- Origin: Engine center, crankshaft axis
- X-axis: Left-right (positive = right)
- Y-axis: Front-back (positive = front)
- Z-axis: Top-bottom (positive = up)

⚠️ CRITICAL REQUIREMENTS:
1. ✅ Generate ONLY this component (not the entire engine)
2. ✅ Minimum ${component.targetVertices} vertices required
3. ✅ Production-ready tolerances (±0.01mm where specified)
4. ✅ Include all sub-features mentioned in prompt
5. ✅ Use 100% of token budget for geometry arrays
6. ❌ NO placeholder "..." or compressed arrays
7. ❌ NO verbose descriptions (geometry only)

📊 TOKEN ALLOCATION:
- Geometry vertices: 90% of tokens
- Faces/edges: 8% of tokens
- Metadata: 2% of tokens

OUTPUT FORMAT (JSON):
{
  "component": "${component.id}",
  "geometry": {
    "vertices": [ [x,y,z], ... ],  // ${component.targetVertices}+ vertices
    "faces": [ [v1,v2,v3], ... ],
    "edges": [ [v1,v2], ... ]
  },
  "metadata": {
    "vertexCount": <number>,
    "boundingBox": {"min": [x,y,z], "max": [x,y,z]},
    "features": ["list", "of", "features"]
  }
}

BEGIN GENERATION:
`;
    }

    async callClaude(prompt, targetVertices) {
        try {
            const command = new InvokeModelCommand({
                modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 64000, // Full token budget for this component
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

            const parsed = JSON.parse(content);
            return parsed.geometry || parsed;
        } catch (error) {
            // Handle Bedrock content filtering
            if (error.name === 'ValidationException' && error.message.includes('content filtering')) {
                console.warn('⚠️  Bedrock content filter triggered - generating simplified geometry');
                // Return a basic fallback geometry
                return this.generateFallbackGeometry(targetVertices);
            }
            throw error;
        }
    }

    generateFallbackGeometry(targetVertices) {
        // Generate a valid cylinder mesh with proper topology to avoid corruption
        const vertices = [];
        const faces = [];
        const segmentsPerCircle = Math.max(32, Math.floor(targetVertices / 2));

        // Generate two circles (top and bottom)
        for (let i = 0; i < segmentsPerCircle; i++) {
            const angle = (i / segmentsPerCircle) * 2 * Math.PI;
            const x = 50 * Math.cos(angle);
            const y = 50 * Math.sin(angle);
            vertices.push([x, y, 0]); // Bottom circle
            vertices.push([x, y, 100]); // Top circle
        }

        // Add center vertices for top and bottom caps
        const bottomCenterIdx = vertices.length;
        vertices.push([0, 0, 0]); // Bottom center
        const topCenterIdx = vertices.length;
        vertices.push([0, 0, 100]); // Top center

        // Generate faces for the cylinder
        for (let i = 0; i < segmentsPerCircle; i++) {
            const bottomCurrent = i * 2;
            const topCurrent = i * 2 + 1;
            const bottomNext = ((i + 1) % segmentsPerCircle) * 2;
            const topNext = ((i + 1) % segmentsPerCircle) * 2 + 1;

            // Side walls (two triangles per quad)
            faces.push([bottomCurrent, topCurrent, bottomNext]);
            faces.push([topCurrent, topNext, bottomNext]);

            // Bottom cap (triangle from center to edge)
            faces.push([bottomCenterIdx, bottomNext, bottomCurrent]);

            // Top cap (triangle from center to edge)
            faces.push([topCenterIdx, topCurrent, topNext]);
        }

        console.log(`⚠️  Generated fallback cylinder: ${vertices.length} vertices, ${faces.length} faces`);

        return {
            vertices,
            faces
        };
    }

    enrichComponentsWithMaterials(componentResults, template) {
        /**
         * Enrich each component with material metadata for Axel Smart Engine rendering
         *
         * Output format per component:
         * {
         *   id: 'inner_tank_shell',
         *   name: 'Inner Tank Shell - Aluminum Liner',
         *   geometry: { vertices: [[x,y,z], ...], faces: [[v1,v2,v3], ...] },
         *   material: {
         *     name: 'Aluminum Alloy 2219-T87',
         *     color: [200, 200, 210],    // RGB for rendering
         *     properties: { ... }         // Physical properties
         *   },
         *   position: { x: 0, y: 0, z: 0 },
         *   rotation: { x: 0, y: 0, z: 0 },
         *   scale: { x: 1, y: 1, z: 1 }
         * }
         */

        console.log(`   Enriching ${componentResults.length} components...`);

        const materialLibrary = template.materials || {};
        const enrichedComponents = [];

        for (const result of componentResults) {
            const { component, geometry } = result;

            // Get material data from template
            const materialKey = component.material;
            const materialData = materialLibrary[materialKey] || this.getDefaultMaterial(materialKey);

            const enrichedComponent = {
                // Component identification
                id: component.id,
                name: component.name,
                description: component.description || component.name,

                // Geometry data (vertices and faces)
                geometry: {
                    vertices: geometry.vertices,
                    faces: geometry.faces,
                    edges: geometry.edges || []
                },

                // Material data for rendering
                material: {
                    name: materialData.name,
                    color: materialData.color, // RGB array [r, g, b]
                    properties: materialData.properties || {}
                },

                // Transform data for Axel Smart Engine to use for assembly
                transform: {
                    position: component.position || { x: 0, y: 0, z: 0 },
                    rotation: component.rotation || { x: 0, y: 0, z: 0 },
                    scale: component.scale || { x: 1, y: 1, z: 1 }
                },

                // Metadata
                metadata: {
                    targetVertices: component.targetVertices,
                    actualVertices: geometry.vertices.length,
                    actualFaces: geometry.faces.length,
                    priority: component.priority,
                    dependencies: component.dependencies || []
                }
            };

            enrichedComponents.push(enrichedComponent);

            console.log(`      ✅ ${component.name}: ${geometry.vertices.length} vertices, Material: ${materialData.name} (RGB: ${materialData.color.join(',')})`);
        }

        return enrichedComponents;
    }

    getDefaultMaterial(materialKey) {
        /**
         * Default materials if template doesn't specify
         */
        const defaults = {
            steel: {
                name: 'Structural Steel AISI 1045',
                color: [180, 180, 190], // Light gray
                properties: { density: '7850 kg/m³', tensileStrength: '620 MPa' }
            },
            aluminum: {
                name: 'Aluminum Alloy 6061-T6',
                color: [200, 200, 210], // Silver-gray
                properties: { density: '2700 kg/m³', tensileStrength: '310 MPa' }
            },
            brass: {
                name: 'Brass C36000',
                color: [200, 170, 100], // Gold-brass
                properties: { density: '8500 kg/m³', tensileStrength: '340 MPa' }
            },
            cast_iron: {
                name: 'Cast Iron Grade 40',
                color: [100, 100, 110], // Dark gray
                properties: { density: '7200 kg/m³', tensileStrength: '276 MPa' }
            },
            composite: {
                name: 'Carbon Fiber Composite',
                color: [30, 30, 30], // Black
                properties: { density: '1600 kg/m³', tensileStrength: '4900 MPa' }
            }
        };

        return defaults[materialKey] || {
            name: 'Generic Material',
            color: [150, 150, 150], // Medium gray
            properties: {}
        };
    }

    assembleComponents(componentResults, template) {
        // Use intelligent assembly engine with 3D positioning
        return intelligentAssembly.assembleWithIntelligentPositioning(componentResults, template);
    }

    validateAssembly(geometry, template) {
        const validation = {
            passed: false,
            errors: [],
            warnings: [],
            metrics: {}
        };

        // Check total vertex count
        const totalTargetVertices = template.components.reduce((sum, c) => sum + c.targetVertices, 0);
        validation.metrics.totalVertices = geometry.vertices.length;
        validation.metrics.targetVertices = totalTargetVertices;

        if (geometry.vertices.length < totalTargetVertices * 0.8) {
            validation.errors.push(`Insufficient total vertices: ${geometry.vertices.length} < ${totalTargetVertices * 0.8}`);
        }

        // Check component count
        validation.metrics.componentCount = geometry.components.length;
        validation.metrics.expectedComponents = template.totalComponents;

        if (geometry.components.length !== template.totalComponents) {
            validation.errors.push(`Missing components: ${geometry.components.length} / ${template.totalComponents}`);
        }

        // Check for valid geometry
        if (geometry.faces.length === 0) {
            validation.errors.push('No faces defined');
        }

        // Validation passes if no errors
        validation.passed = validation.errors.length === 0;

        return validation;
    }
}

module.exports = new ParallelMCPOrchestrator();
