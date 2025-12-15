/**
 * Assembly Engine
 * Manages multi-part assemblies with mates, constraints, and motion relationships
 */
class AssemblyEngine {
    constructor() {
        this.assemblyIdCounter = 0;
        this.instanceIdCounter = 0;
        this.mateIdCounter = 0;
    }

    /**
     * Create a new assembly
     * @param {string} name - Assembly name
     * @returns {object} - Assembly container
     */
    createAssembly(name) {
        const assembly = {
            id: this.generateAssemblyId(),
            name: name || `Assembly_${this.assemblyIdCounter}`,
            components: [], // Part instances
            mates: [], // Assembly constraints
            subassemblies: [],
            bom: null,
            motionStudy: null,
            created: new Date().toISOString()
        };

        return assembly;
    }

    /**
     * Add a component (part instance) to the assembly
     * @param {object} assembly - Assembly object
     * @param {object} part - Part definition
     * @param {object} transform - Initial transform {position, rotation}
     * @returns {object} - Component instance
     */
    addComponent(assembly, part, transform = {}) {
        const component = {
            id: this.generateInstanceId(),
            partId: part.id,
            partName: part.name,
            instanceName: `${part.name}_${this.instanceIdCounter}`,
            transform: {
                position: transform.position || { x: 0, y: 0, z: 0 },
                rotation: transform.rotation || { x: 0, y: 0, z: 0 },
                scale: transform.scale || { x: 1, y: 1, z: 1 }
            },
            visible: true,
            suppressed: false,
            properties: part.properties || {},
            addedAt: new Date().toISOString()
        };

        assembly.components.push(component);
        console.log(`➕ Added component: ${component.instanceName}`);

        return component;
    }

    /**
     * Create a subassembly within an assembly
     * @param {object} parentAssembly - Parent assembly
     * @param {string} name - Subassembly name
     * @returns {object} - Subassembly
     */
    createSubassembly(parentAssembly, name) {
        const subassembly = this.createAssembly(name);
        subassembly.isSubassembly = true;
        subassembly.parentId = parentAssembly.id;

        parentAssembly.subassemblies.push(subassembly);

        return subassembly;
    }

    /**
     * Add a mate (assembly constraint) between components
     * @param {object} assembly - Assembly object
     * @param {string} type - Mate type
     * @param {string} comp1Id - First component ID
     * @param {string} comp2Id - Second component ID
     * @param {object} options - Mate-specific parameters
     * @returns {object} - Mate object
     */
    addMate(assembly, type, comp1Id, comp2Id, options = {}) {
        const mate = {
            id: this.generateMateId(),
            type: type,
            component1: comp1Id,
            component2: comp2Id,
            parameters: options,
            solved: false,
            createdAt: new Date().toISOString()
        };

        assembly.mates.push(mate);
        console.log(`🔗 Added ${type} mate between components`);

        return mate;
    }

    /**
     * Solve all mates in the assembly
     * Positions components to satisfy mate constraints
     * @param {object} assembly - Assembly object
     * @returns {object} - Solved assembly
     */
    solveMates(assembly) {
        console.log(`🧩 Solving mates for ${assembly.name}...`);

        const maxIterations = 100;
        const tolerance = 0.01; // mm

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            let maxError = 0;

            // Apply each mate
            for (const mate of assembly.mates) {
                const error = this.applyMate(assembly, mate);
                maxError = Math.max(maxError, error);
            }

            // Check convergence
            if (maxError < tolerance) {
                console.log(`✅ Mates solved in ${iteration + 1} iterations`);
                assembly.mates.forEach(m => m.solved = true);
                return assembly;
            }
        }

        console.warn(`⚠️  Mate solver did not converge`);
        return assembly;
    }

    /**
     * Check degrees of freedom for assembly
     * @param {object} assembly - Assembly object
     * @returns {object} - DOF analysis
     */
    checkDOF(assembly) {
        // Each component has 6 DOF (3 translation, 3 rotation)
        const componentCount = assembly.components.length;
        const totalDOF = componentCount * 6;

        // Fixed components (grounded) have 0 DOF
        const fixedCount = assembly.components.filter(c => c.fixed).length;
        const fixedDOF = fixedCount * 6;

        // Each mate removes certain DOF depending on type
        let constrainedDOF = 0;
        assembly.mates.forEach(mate => {
            switch (mate.type) {
                case 'fixed':
                    constrainedDOF += 6; // Removes all DOF
                    break;
                case 'coincident':
                case 'planar':
                    constrainedDOF += 3; // Removes 3 DOF
                    break;
                case 'concentric':
                    constrainedDOF += 4; // Removes 4 DOF (2 translation + 2 rotation)
                    break;
                case 'parallel':
                case 'perpendicular':
                    constrainedDOF += 2; // Removes 2 rotational DOF
                    break;
                case 'distance':
                case 'angle':
                    constrainedDOF += 1; // Removes 1 DOF
                    break;
                case 'gear':
                case 'rack_pinion':
                    constrainedDOF += 5; // Coupled motion, removes 5 DOF
                    break;
            }
        });

        const remainingDOF = totalDOF - fixedDOF - constrainedDOF;

        return {
            totalDOF,
            fixedDOF,
            constrainedDOF,
            remainingDOF,
            status: remainingDOF === 0 ? 'fully_constrained' :
                remainingDOF < 0 ? 'over_constrained' : 'under_constrained',
            mobilityDOF: Math.max(0, remainingDOF) // DOF for motion
        };
    }

    /**
     * Define a motor to drive component motion
     * @param {object} assembly - Assembly object
     * @param {string} componentId - Component to drive
     * @param {object} axis - Rotation axis or translation direction
     * @param {number} speed - Speed (rpm for rotation, mm/s for translation)
     * @returns {object} - Motor definition
     */
    defineMotor(assembly, componentId, axis, speed) {
        if (!assembly.motionStudy) {
            assembly.motionStudy = {
                motors: [],
                time: 0,
                timeStep: 0.01 // seconds
            };
        }

        const motor = {
            id: `motor_${assembly.motionStudy.motors.length + 1}`,
            componentId,
            type: axis.type || 'rotational', // rotational, linear
            axis: axis.vector || { x: 0, y: 1, z: 0 },
            speed: speed,
            active: true
        };

        assembly.motionStudy.motors.push(motor);
        console.log(`⚙️  Added motor to component ${componentId}`);

        return motor;
    }

    /**
     * Simulate assembly motion
     * @param {object} assembly - Assembly object
     * @param {number} duration - Simulation duration in seconds
     * @returns {object} - Motion simulation results
     */
    simulateMotion(assembly, duration) {
        console.log(`🎬 Simulating motion for ${duration} seconds...`);

        if (!assembly.motionStudy) {
            throw new Error('No motion study defined for this assembly');
        }

        const results = {
            duration,
            frames: [],
            collisions: [],
            velocities: [],
            accelerations: []
        };

        const timeStep = assembly.motionStudy.timeStep;
        const steps = Math.ceil(duration / timeStep);

        for (let step = 0; step < steps; step++) {
            const time = step * timeStep;

            //Apply motor movements
            assembly.motionStudy.motors.forEach(motor => {
                if (motor.active) {
                    const component = assembly.components.find(c => c.id === motor.componentId);
                    if (component && motor.type === 'rotational') {
                        // Rotate component
                        const angleIncrement = (motor.speed / 60) * 360 * timeStep; // degrees
                        // Update component rotation (simplified)
                        component.transform.rotation.y += angleIncrement;
                    }
                }
            });

            // Solve mates to propagate motion
            this.solveMates(assembly);

            // Check for collisions
            const collisions = this.detectCollisions(assembly, time);
            if (collisions.length > 0) {
                results.collisions.push(...collisions);
            }

            // Record frame
            results.frames.push({
                time,
                components: assembly.components.map(c => ({
                    id: c.id,
                    position: { ...c.transform.position },
                    rotation: { ...c.transform.rotation }
                }))
            });
        }

        console.log(`✅ Motion simulation complete: ${results.frames.length} frames`);
        if (results.collisions.length > 0) {
            console.warn(`⚠️  ${results.collisions.length} collisions detected`);
        }

        return results;
    }

    /**
     * Detect collisions between components
     * @param {object} assembly - Assembly object
     * @param {number} time - Current simulation time
     * @returns {array} - Array of collision events
     */
    detectCollisions(assembly, time) {
        const collisions = [];

        // Simplified bounding box collision detection
        for (let i = 0; i < assembly.components.length; i++) {
            for (let j = i + 1; j < assembly.components.length; j++) {
                const comp1 = assembly.components[i];
                const comp2 = assembly.components[j];

                // Skip if either is suppressed
                if (comp1.suppressed || comp2.suppressed) continue;

                // Check bounding box overlap (simplified)
                const overlaps = this.checkBoundingBoxOverlap(comp1, comp2);

                if (overlaps) {
                    collisions.push({
                        time,
                        component1: comp1.id,
                        component2: comp2.id,
                        severity: 'interference'
                    });
                }
            }
        }

        return collisions;
    }

    /**
     * Create an exploded view of the assembly
     * @param {object} assembly - Assembly object
     * @param {object} direction - Explosion direction {x, y, z}
     * @param {number} spacing - Spacing multiplier
     * @returns {object} - Exploded view configuration
     */
    createExplodedView(assembly, direction = { x: 1, y: 1, z: 1 }, spacing = 100) {
        console.log(`💥 Creating exploded view...`);

        const explodedView = {
            name: `${assembly.name}_Exploded`,
            explosionFactor: spacing,
            components: []
        };

        assembly.components.forEach((component, index) => {
            // Calculate explosion offset based on component position and direction
            const offset = {
                x: direction.x * index * spacing,
                y: direction.y * index * spacing,
                z: direction.z * index * spacing
            };

            explodedView.components.push({
                componentId: component.id,
                originalPosition: { ...component.transform.position },
                explodedPosition: {
                    x: component.transform.position.x + offset.x,
                    y: component.transform.position.y + offset.y,
                    z: component.transform.position.z + offset.z
                },
                offset: offset
            });
        });

        return explodedView;
    }

    /**
     * Generate BOM from assembly
     * @param {object} assembly - Assembly object
     * @returns {object} - Bill of Materials
     */
    createAssemblyBOM(assembly) {
        console.log(`📋 Generating BOM for ${assembly.name}...`);

        const bom = {
            assemblyName: assembly.name,
            items: [],
            totalWeight: 0,
            totalCost: 0,
            generatedAt: new Date().toISOString()
        };

        // Count unique parts
        const partCounts = {};
        assembly.components.forEach(component => {
            const partId = component.partId;
            if (!partCounts[partId]) {
                partCounts[partId] = {
                    partId,
                    partName: component.partName,
                    quantity: 0,
                    instances: []
                };
            }
            partCounts[partId].quantity++;
            partCounts[partId].instances.push(component.instanceName);
        });

        // Create BOM items
        Object.values(partCounts).forEach(item => {
            bom.items.push({
                itemNumber: bom.items.length + 1,
                partNumber: item.partId,
                description: item.partName,
                quantity: item.quantity,
                material: 'TBD', // Would come from part properties
                weight: 0, // Would come from part properties
                unitCost: 0,
                totalCost: 0,
                instances: item.instances
            });
        });

        // Add subassembly BOMs recursively
        assembly.subassemblies.forEach(subassembly => {
            const subBOM = this.createAssemblyBOM(subassembly);
            bom.items.push({
                itemNumber: bom.items.length + 1,
                partNumber: subassembly.id,
                description: `${subassembly.name} (Subassembly)`,
                quantity: 1,
                subBOM: subBOM
            });
        });

        return bom;
    }

    // ==================== Helper Methods ====================

    generateAssemblyId() {
        this.assemblyIdCounter++;
        return `assembly_${this.assemblyIdCounter}_${Date.now()}`;
    }

    generateInstanceId() {
        this.instanceIdCounter++;
        return `instance_${this.instanceIdCounter}`;
    }

    generateMateId() {
        this.mateIdCounter++;
        return `mate_${this.mateIdCounter}`;
    }

    /**
     * Apply a single mate constraint (simplified)
     */
    applyMate(assembly, mate) {
        const comp1 = assembly.components.find(c => c.id === mate.component1);
        const comp2 = assembly.components.find(c => c.id === mate.component2);

        if (!comp1 || !comp2) return 0;

        switch (mate.type) {
            case 'coincident':
                return this.applyCoincidentMate(comp1, comp2, mate.parameters);

            case 'concentric':
                return this.applyConcentricMate(comp1, comp2, mate.parameters);

            case 'parallel':
                return this.applyParallelMate(comp1, comp2, mate.parameters);

            case 'perpendicular':
                return this.applyPerpendicularMate(comp1, comp2, mate.parameters);

            case 'distance':
                return this.applyDistanceMate(comp1, comp2, mate.parameters);

            case 'angle':
                return this.applyAngleMate(comp1, comp2, mate.parameters);

            case 'gear':
                return this.applyGearMate(comp1, comp2, mate.parameters);

            default:
                return 0;
        }
    }

    applyCoincidentMate(comp1, comp2, params) {
        // Align two planar faces or points
        // Simplified: move comp2 to align with comp1
        return 0;
    }

    applyConcentricMate(comp1, comp2, params) {
        // Align cylindrical or circular features
        return 0;
    }

    applyParallelMate(comp1, comp2, params) {
        // Make two faces or axes parallel
        return 0;
    }

    applyPerpendicularMate(comp1, comp2, params) {
        // Make two faces or axes perpendicular
        return 0;
    }

    applyDistanceMate(comp1, comp2, params) {
        // Maintain a specific distance between features
        const targetDistance = params.distance || 0;
        return 0;
    }

    applyAngleMate(comp1, comp2, params) {
        // Maintain a specific angle between features
        const targetAngle = params.angle || 90;
        return 0;
    }

    applyGearMate(comp1, comp2, params) {
        // Couple rotational motion of two gears
        const ratio = params.ratio || 1.0;
        // comp2.rotation = comp1.rotation * ratio
        return 0;
    }

    checkBoundingBoxOverlap(comp1, comp2) {
        // Simplified bounding box check
        // In full implementation, would use actual geometry

        const box1 = this.getComponentBoundingBox(comp1);
        const box2 = this.getComponentBoundingBox(comp2);

        const overlapX = box1.max.x > box2.min.x && box1.min.x < box2.max.x;
        const overlapY = box1.max.y > box2.min.y && box1.min.y < box2.max.y;
        const overlapZ = box1.max.z > box2.min.z && box1.min.z < box2.max.z;

        return overlapX && overlapY && overlapZ;
    }

    getComponentBoundingBox(component) {
        // Simplified: return a default box around component position
        const pos = component.transform.position;
        const size = 50; // mm, default size

        return {
            min: {
                x: pos.x - size / 2,
                y: pos.y - size / 2,
                z: pos.z - size / 2
            },
            max: {
                x: pos.x + size / 2,
                y: pos.y + size / 2,
                z: pos.z + size / 2
            }
        };
    }
}

module.exports = new AssemblyEngine();
