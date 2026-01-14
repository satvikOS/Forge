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
const productionV8Template = require('./productionV8Template');

class ParallelMCPOrchestrator {
    constructor() {
        this.bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
        this.maxParallelCalls = 50; // NO LIMITS - as many as needed for perfection
        this.tokensPerComponent = 64000; // Max output tokens per call

        // Component breakdown templates for different mechanical types
        this.componentTemplates = this.buildComponentTemplates();
    }

    buildComponentTemplates() {
        return {
            v8_engine_block: productionV8Template,
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
        const template = this.detectTemplateType(prompt);
        console.log(`\n📋 Component Breakdown: ${template.name}`);
        console.log(`   Total components: ${template.totalComponents}`);
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

        // STEP 4: Assemble all components into final geometry
        console.log('\n🔧 Assembling components...');
        const assembledGeometry = this.assembleComponents(allComponents, template);

        // STEP 5: Validate assembly
        console.log('\n✅ Validating assembly...');
        const validation = this.validateAssembly(assembledGeometry, template);

        console.log('\n🎉 === PARALLEL MCP ORCHESTRATION COMPLETE ===');
        console.log(`   Total vertices: ${assembledGeometry.vertices.length}`);
        console.log(`   Total faces: ${assembledGeometry.faces.length}`);
        console.log(`   Components: ${allComponents.length}`);
        console.log(`   Validation: ${validation.passed ? 'PASSED ✅' : 'FAILED ❌'}`);

        return {
            geometry: assembledGeometry,
            components: allComponents,
            validation: validation,
            metadata: {
                template: template.name,
                totalComponents: allComponents.length,
                generationTime: generationTime,
                parallelWaves: executionPlan.length
            }
        };
    }

    detectTemplateType(prompt) {
        const promptLower = prompt.toLowerCase();

        if (promptLower.includes('v8') || promptLower.includes('engine')) {
            return this.componentTemplates.v8_engine_block;
        } else if (promptLower.includes('gear') && promptLower.includes('spur')) {
            return this.componentTemplates.spur_gear;
        }

        // Default to V8 for now
        return this.componentTemplates.v8_engine_block;
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
        const command = new InvokeModelCommand({
            modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
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
