/**
 * Assembly Design & Management Service
 * Top-down and bottom-up assembly workflows
 * Mate/constraint system, assembly solver, motion relationships, exploded views
 */

class AssemblyDesignService {
    constructor() {
        this.assemblies = new Map();
        this.mateTypes = this.initializeMateTypes();
        this.standardComponents = this.initializeStandardComponents();
    }

    /**
     * Create new assembly from design intent
     * Supports both top-down (design in context) and bottom-up (assemble parts)
     */
    async createAssembly(assemblySpec, workflow = 'bottom-up') {
        const {
            name,
            description,
            components = [],
            mates = [],
            designIntent,
            assemblyType = 'mechanical'  // 'mechanical', 'welded', 'fastened', 'snap-fit'
        } = assemblySpec;

        console.log(`🔧 Assembly Design: Creating ${workflow} assembly "${name}"...`);

        const assemblyId = `asm_${Date.now()}`;

        let assembly = {
            assemblyId,
            name,
            description,
            workflow,
            assemblyType,
            components: [],
            mates: [],
            subassemblies: [],
            tree: null,
            constraints: [],
            dof: null,  // Degrees of freedom
            explodedView: null,
            motionStudy: null,
            createdAt: Date.now()
        };

        if (workflow === 'top-down') {
            // Top-down: Design parts in context of assembly
            assembly = await this.createTopDownAssembly(assembly, designIntent);
        } else {
            // Bottom-up: Assemble existing parts
            assembly = await this.createBottomUpAssembly(assembly, components, mates);
        }

        // Build assembly tree
        assembly.tree = this.buildAssemblyTree(assembly);

        // Analyze degrees of freedom
        assembly.dof = this.analyzeDOF(assembly);

        // Store assembly
        this.assemblies.set(assemblyId, assembly);

        return {
            success: true,
            operation: 'create-assembly',
            assembly,
            summary: {
                totalComponents: assembly.components.length,
                totalMates: assembly.mates.length,
                subassemblies: assembly.subassemblies.length,
                degreesOfFreedom: assembly.dof.total,
                fullyConstrained: assembly.dof.total === 0
            },
            recommendations: this.generateAssemblyRecommendations(assembly)
        };
    }

    /**
     * Top-down assembly: Design parts in context
     */
    async createTopDownAssembly(assembly, designIntent) {
        console.log(`  📐 Top-down assembly design...`);

        // Create skeleton/layout first
        const skeleton = this.createAssemblySkeleton(designIntent);
        assembly.skeleton = skeleton;

        // Create parts in context of skeleton
        const contextParts = await this.createPartsInContext(skeleton, designIntent);
        assembly.components = contextParts;

        // Auto-generate mates based on design intent
        assembly.mates = this.inferMatesFromContext(contextParts, skeleton);

        return assembly;
    }

    /**
     * Bottom-up assembly: Assemble existing parts
     */
    async createBottomUpAssembly(assembly, components, mates) {
        console.log(`  🔩 Bottom-up assembly...`);

        // Add components to assembly
        assembly.components = components.map((comp, idx) => ({
            componentId: comp.id || `comp_${idx}`,
            name: comp.name,
            partNumber: comp.partNumber,
            type: comp.type || 'part',
            isFixed: comp.isFixed || false,
            position: comp.position || [0, 0, 0],
            rotation: comp.rotation || [0, 0, 0],
            suppressed: false,
            instance: idx + 1,
            quantity: comp.quantity || 1
        }));

        // Add mates
        assembly.mates = mates.map((mate, idx) => this.createMate(mate, idx));

        return assembly;
    }

    /**
     * Create assembly skeleton (layout/structure)
     */
    createAssemblySkeleton(designIntent) {
        return {
            skeletonId: 'skeleton_main',
            planes: [
                { name: 'Front', normal: [0, 0, 1], point: [0, 0, 0] },
                { name: 'Top', normal: [0, 1, 0], point: [0, 0, 0] },
                { name: 'Right', normal: [1, 0, 0], point: [0, 0, 0] }
            ],
            axes: [
                { name: 'Main Axis', direction: [1, 0, 0], point: [0, 0, 0] }
            ],
            referencePoints: [
                { name: 'Origin', position: [0, 0, 0] },
                { name: 'Mount Point 1', position: [50, 0, 0] },
                { name: 'Mount Point 2', position: [-50, 0, 0] }
            ],
            layoutDimensions: this.extractLayoutDimensions(designIntent)
        };
    }

    /**
     * Extract layout dimensions from design intent
     */
    extractLayoutDimensions(designIntent) {
        return {
            overallLength: 200,
            overallWidth: 150,
            overallHeight: 100,
            spacing: 25,
            clearance: 5
        };
    }

    /**
     * Create parts in context of assembly skeleton
     */
    async createPartsInContext(skeleton, designIntent) {
        const parts = [];

        // Create base part
        parts.push({
            componentId: 'base_part',
            name: 'Base',
            type: 'part',
            isFixed: true,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            createdInContext: true,
            references: ['skeleton_main']
        });

        // Create moving parts referenced to skeleton
        parts.push({
            componentId: 'moving_part_1',
            name: 'Moving Arm',
            type: 'part',
            isFixed: false,
            position: [50, 0, 25],
            rotation: [0, 0, 0],
            createdInContext: true,
            references: ['Main Axis', 'Mount Point 1']
        });

        return parts;
    }

    /**
     * Infer mates from context-based design
     */
    inferMatesFromContext(parts, skeleton) {
        const mates = [];

        // Fixed parts automatically get "Fixed" mate
        parts.forEach((part, idx) => {
            if (part.isFixed) {
                mates.push({
                    mateId: `mate_fixed_${idx}`,
                    type: 'fixed',
                    components: [part.componentId],
                    description: `${part.name} fixed to origin`
                });
            }
        });

        // Infer other mates based on proximity and geometry
        // (simplified - real implementation would analyze geometry)

        return mates;
    }

    /**
     * Create mate/constraint between components
     */
    createMate(mateSpec, index) {
        const {
            type,
            component1,
            component2,
            entity1,        // face, edge, axis, point
            entity2,
            parameters = {}
        } = mateSpec;

        const mate = {
            mateId: `mate_${index}`,
            type,
            components: [component1, component2],
            entities: {
                component1: entity1,
                component2: entity2
            },
            parameters,
            satisfied: false,
            dofRemoved: this.getMateDegreesRemoved(type),
            description: this.generateMateDescription(type, component1, component2)
        };

        return mate;
    }

    /**
     * Get degrees of freedom removed by mate type
     */
    getMateDegreesRemoved(mateType) {
        const dofMap = {
            'fixed': 6,              // Removes all 6 DOF
            'coincident': 5,         // Plane to plane
            'concentric': 4,         // Cylinder to cylinder
            'distance': 1,           // Sets distance between faces
            'angle': 1,              // Sets angle between faces
            'parallel': 2,           // Makes faces parallel
            'perpendicular': 2,      // Makes faces perpendicular
            'tangent': 1,            // Makes surfaces tangent
            'gear': 1,               // Links rotation
            'rack-pinion': 1,        // Links rotation to translation
            'cam': 1,                // Cam follower relationship
            'slot': 1,               // Allows sliding in slot
            'hinge': 4,              // Rotation about axis
            'slider': 4,             // Translation along axis
            'ball': 3                // Rotation about point
        };

        return dofMap[mateType] || 0;
    }

    /**
     * Generate mate description
     */
    generateMateDescription(type, comp1, comp2) {
        const descriptions = {
            'coincident': `${comp1} coincident with ${comp2}`,
            'concentric': `${comp1} concentric with ${comp2}`,
            'distance': `${comp1} distance from ${comp2}`,
            'angle': `${comp1} at angle to ${comp2}`,
            'parallel': `${comp1} parallel to ${comp2}`,
            'perpendicular': `${comp1} perpendicular to ${comp2}`,
            'gear': `${comp1} geared to ${comp2}`,
            'hinge': `${comp1} hinged to ${comp2}`
        };

        return descriptions[type] || `${comp1} mated to ${comp2}`;
    }

    /**
     * Build assembly tree (hierarchical structure)
     */
    buildAssemblyTree(assembly) {
        const tree = {
            root: {
                id: assembly.assemblyId,
                name: assembly.name,
                type: 'assembly',
                children: []
            }
        };

        // Add components as children
        assembly.components.forEach(comp => {
            tree.root.children.push({
                id: comp.componentId,
                name: comp.name,
                type: comp.type,
                suppressed: comp.suppressed,
                fixed: comp.isFixed,
                children: comp.type === 'subassembly' ? [] : null
            });
        });

        return tree;
    }

    /**
     * Analyze degrees of freedom in assembly
     */
    analyzeDOF(assembly) {
        console.log(`  🔍 Analyzing degrees of freedom...`);

        const totalComponents = assembly.components.length;
        const fixedComponents = assembly.components.filter(c => c.isFixed).length;
        const movingComponents = totalComponents - fixedComponents;

        // Each moving rigid body has 6 DOF (3 translation + 3 rotation)
        const initialDOF = movingComponents * 6;

        // Each mate removes DOF
        const dofRemoved = assembly.mates.reduce((sum, mate) => {
            return sum + mate.dofRemoved;
        }, 0);

        const remainingDOF = Math.max(0, initialDOF - dofRemoved);

        return {
            initial: initialDOF,
            removed: dofRemoved,
            total: remainingDOF,
            components: {
                total: totalComponents,
                fixed: fixedComponents,
                moving: movingComponents
            },
            status: this.classifyDOFStatus(remainingDOF, initialDOF),
            underconstrainedBy: remainingDOF > 0 ? remainingDOF : 0,
            overconstrainedBy: remainingDOF < 0 ? Math.abs(remainingDOF) : 0
        };
    }

    /**
     * Classify DOF status
     */
    classifyDOFStatus(remaining, initial) {
        if (remaining === 0) return 'fully-constrained';
        if (remaining > 0 && remaining < initial) return 'partially-constrained';
        if (remaining === initial) return 'unconstrained';
        if (remaining < 0) return 'over-constrained';
        return 'unknown';
    }

    /**
     * Add component to assembly
     */
    async addComponent(assemblyId, component, mate = null) {
        const assembly = this.assemblies.get(assemblyId);
        if (!assembly) {
            throw new Error(`Assembly ${assemblyId} not found`);
        }

        const componentId = `comp_${assembly.components.length}`;

        assembly.components.push({
            componentId,
            ...component,
            addedAt: Date.now()
        });

        // Add mate if provided
        if (mate) {
            const mateObj = this.createMate(mate, assembly.mates.length);
            assembly.mates.push(mateObj);
        }

        // Re-analyze DOF
        assembly.dof = this.analyzeDOF(assembly);

        return {
            success: true,
            componentId,
            assembly: assembly.name,
            dof: assembly.dof
        };
    }

    /**
     * Create exploded view
     */
    async createExplodedView(assemblyId, options = {}) {
        const {
            explosionDirection = [1, 1, 1],  // X, Y, Z
            explosionFactor = 2.0,
            autoSpacing = true,
            groupBySubassembly = true
        } = options;

        console.log(`💥 Creating exploded view for assembly ${assemblyId}...`);

        const assembly = this.assemblies.get(assemblyId);
        if (!assembly) {
            throw new Error(`Assembly ${assemblyId} not found`);
        }

        const explodedView = {
            viewId: `explode_${Date.now()}`,
            assemblyId,
            explosionFactor,
            explosionDirection,
            steps: []
        };

        // Calculate explosion steps
        assembly.components.forEach((comp, idx) => {
            if (!comp.isFixed) {
                const offset = [
                    explosionDirection[0] * explosionFactor * idx * 50,
                    explosionDirection[1] * explosionFactor * idx * 50,
                    explosionDirection[2] * explosionFactor * idx * 50
                ];

                explodedView.steps.push({
                    stepNumber: idx + 1,
                    componentId: comp.componentId,
                    componentName: comp.name,
                    originalPosition: comp.position,
                    explodedPosition: [
                        comp.position[0] + offset[0],
                        comp.position[1] + offset[1],
                        comp.position[2] + offset[2]
                    ],
                    offset
                });
            }
        });

        assembly.explodedView = explodedView;

        return {
            success: true,
            operation: 'create-exploded-view',
            explodedView,
            totalSteps: explodedView.steps.length
        };
    }

    /**
     * Define motion relationship (for mechanism simulation)
     */
    async defineMotionRelationship(assemblyId, motionSpec) {
        const {
            type,              // 'motor', 'spring', 'damper', 'contact', 'gear'
            component,
            parameters
        } = motionSpec;

        console.log(`⚙️ Defining motion: ${type} on ${component}...`);

        const assembly = this.assemblies.get(assemblyId);
        if (!assembly) {
            throw new Error(`Assembly ${assemblyId} not found`);
        }

        if (!assembly.motionStudy) {
            assembly.motionStudy = {
                studyId: `motion_${Date.now()}`,
                motors: [],
                springs: [],
                dampers: [],
                contacts: [],
                gears: [],
                results: null
            };
        }

        const motionElement = {
            id: `${type}_${Date.now()}`,
            type,
            component,
            parameters,
            active: true
        };

        // Add to appropriate array
        switch (type) {
            case 'motor':
                assembly.motionStudy.motors.push(motionElement);
                break;
            case 'spring':
                assembly.motionStudy.springs.push(motionElement);
                break;
            case 'damper':
                assembly.motionStudy.dampers.push(motionElement);
                break;
            case 'contact':
                assembly.motionStudy.contacts.push(motionElement);
                break;
            case 'gear':
                assembly.motionStudy.gears.push(motionElement);
                break;
        }

        return {
            success: true,
            motionElement,
            motionStudy: assembly.motionStudy
        };
    }

    /**
     * Run motion simulation
     */
    async runMotionSimulation(assemblyId, simulationTime = 10.0, timeStep = 0.01) {
        console.log(`🎬 Running motion simulation (${simulationTime}s)...`);

        const assembly = this.assemblies.get(assemblyId);
        if (!assembly || !assembly.motionStudy) {
            throw new Error('No motion study defined');
        }

        const results = {
            simulationTime,
            timeStep,
            frames: Math.floor(simulationTime / timeStep),
            componentTrajectories: [],
            collisions: [],
            forceReactions: []
        };

        // Simulate each component's motion
        assembly.components.forEach(comp => {
            if (!comp.isFixed) {
                const trajectory = this.simulateComponentMotion(
                    comp,
                    assembly.motionStudy,
                    simulationTime,
                    timeStep
                );
                results.componentTrajectories.push(trajectory);
            }
        });

        // Detect collisions
        results.collisions = this.detectCollisions(results.componentTrajectories);

        assembly.motionStudy.results = results;

        return {
            success: true,
            operation: 'motion-simulation',
            results,
            summary: {
                totalFrames: results.frames,
                collisionsDetected: results.collisions.length,
                componentsSimulated: results.componentTrajectories.length
            }
        };
    }

    /**
     * Simulate component motion over time
     */
    simulateComponentMotion(component, motionStudy, totalTime, timeStep) {
        const trajectory = {
            componentId: component.componentId,
            componentName: component.name,
            positions: [],
            rotations: [],
            velocities: [],
            accelerations: []
        };

        // Find motors affecting this component
        const motors = motionStudy.motors.filter(m => m.component === component.componentId);

        for (let t = 0; t <= totalTime; t += timeStep) {
            // Simple sinusoidal motion for demonstration
            const angle = motors.length > 0 ?
                (motors[0].parameters.speed || 60) * t * (Math.PI / 180) : 0;

            trajectory.positions.push([
                component.position[0] + Math.sin(angle) * 10,
                component.position[1],
                component.position[2]
            ]);

            trajectory.rotations.push([0, 0, angle]);
            trajectory.velocities.push([Math.cos(angle) * 10, 0, 0]);
            trajectory.accelerations.push([-Math.sin(angle) * 10, 0, 0]);
        }

        return trajectory;
    }

    /**
     * Detect collisions between moving components
     */
    detectCollisions(trajectories) {
        const collisions = [];

        // Simplified collision detection
        // Real implementation would use bounding boxes or precise geometry

        for (let i = 0; i < trajectories.length; i++) {
            for (let j = i + 1; j < trajectories.length; j++) {
                const traj1 = trajectories[i];
                const traj2 = trajectories[j];

                // Check each time step
                for (let frameIdx = 0; frameIdx < traj1.positions.length; frameIdx++) {
                    const pos1 = traj1.positions[frameIdx];
                    const pos2 = traj2.positions[frameIdx];

                    const distance = Math.sqrt(
                        Math.pow(pos1[0] - pos2[0], 2) +
                        Math.pow(pos1[1] - pos2[1], 2) +
                        Math.pow(pos1[2] - pos2[2], 2)
                    );

                    // If distance < threshold, collision detected
                    if (distance < 10) {
                        collisions.push({
                            time: frameIdx * 0.01,
                            component1: traj1.componentId,
                            component2: traj2.componentId,
                            distance,
                            position: pos1
                        });
                    }
                }
            }
        }

        return collisions;
    }

    /**
     * Detect interference between components
     */
    async detectInterference(assemblyId) {
        console.log(`🔍 Detecting interference...`);

        const assembly = this.assemblies.get(assemblyId);
        if (!assembly) {
            throw new Error(`Assembly ${assemblyId} not found`);
        }

        const interferences = [];

        // Check each pair of components
        for (let i = 0; i < assembly.components.length; i++) {
            for (let j = i + 1; j < assembly.components.length; j++) {
                const comp1 = assembly.components[i];
                const comp2 = assembly.components[j];

                // Simplified interference check
                const distance = this.calculateComponentDistance(comp1, comp2);

                if (distance < 1.0) {  // 1mm threshold
                    interferences.push({
                        component1: comp1.componentId,
                        component2: comp2.componentId,
                        penetrationDepth: 1.0 - distance,
                        severity: distance < 0 ? 'critical' : 'warning'
                    });
                }
            }
        }

        return {
            success: true,
            operation: 'interference-detection',
            interferences,
            totalChecks: (assembly.components.length * (assembly.components.length - 1)) / 2,
            interferenceCount: interferences.length,
            status: interferences.length === 0 ? 'no-interference' : 'interference-detected'
        };
    }

    /**
     * Calculate distance between two components
     */
    calculateComponentDistance(comp1, comp2) {
        // Simplified - use component positions
        const dist = Math.sqrt(
            Math.pow(comp1.position[0] - comp2.position[0], 2) +
            Math.pow(comp1.position[1] - comp2.position[1], 2) +
            Math.pow(comp1.position[2] - comp2.position[2], 2)
        );
        return dist;
    }

    /**
     * Generate assembly recommendations
     */
    generateAssemblyRecommendations(assembly) {
        const recs = [];

        if (assembly.dof.status === 'fully-constrained') {
            recs.push('✅ Assembly is fully constrained');
        } else if (assembly.dof.status === 'under-constrained') {
            recs.push(`⚠️ Assembly has ${assembly.dof.total} unconstrained DOF`);
            recs.push('💡 Add more mates to fully constrain the assembly');
        } else if (assembly.dof.status === 'over-constrained') {
            recs.push(`❌ Assembly is over-constrained by ${assembly.dof.overconstrainedBy} DOF`);
            recs.push('💡 Remove redundant mates to resolve conflicts');
        }

        if (assembly.components.length > 100) {
            recs.push('📊 Large assembly detected - consider using lightweight representations');
        }

        if (!assembly.components.some(c => c.isFixed)) {
            recs.push('⚠️ No fixed component - assembly will float in space');
        }

        return recs;
    }

    /**
     * Initialize mate types
     */
    initializeMateTypes() {
        return {
            'coincident': { name: 'Coincident', dofRemoved: 5, icon: '🔗' },
            'concentric': { name: 'Concentric', dofRemoved: 4, icon: '⭕' },
            'distance': { name: 'Distance', dofRemoved: 1, icon: '📏' },
            'angle': { name: 'Angle', dofRemoved: 1, icon: '📐' },
            'parallel': { name: 'Parallel', dofRemoved: 2, icon: '║' },
            'perpendicular': { name: 'Perpendicular', dofRemoved: 2, icon: '⊥' },
            'tangent': { name: 'Tangent', dofRemoved: 1, icon: '〰️' },
            'gear': { name: 'Gear', dofRemoved: 1, icon: '⚙️' },
            'rack-pinion': { name: 'Rack & Pinion', dofRemoved: 1, icon: '🦷' },
            'hinge': { name: 'Hinge', dofRemoved: 4, icon: '🚪' },
            'slider': { name: 'Slider', dofRemoved: 4, icon: '↔️' },
            'ball': { name: 'Ball Joint', dofRemoved: 3, icon: '⚽' }
        };
    }

    /**
     * Initialize standard components library
     */
    initializeStandardComponents() {
        return {
            fasteners: {
                'M6-hex-bolt': { name: 'M6 Hex Bolt', length: 20, standard: 'ISO 4014' },
                'M8-hex-bolt': { name: 'M8 Hex Bolt', length: 25, standard: 'ISO 4014' },
                'M10-hex-bolt': { name: 'M10 Hex Bolt', length: 30, standard: 'ISO 4014' }
            },
            bearings: {
                '6001': { name: 'Deep Groove Ball Bearing 6001', id: 12, od: 28, width: 8 },
                '6201': { name: 'Deep Groove Ball Bearing 6201', id: 12, od: 32, width: 10 }
            }
        };
    }
}

module.exports = new AssemblyDesignService();
