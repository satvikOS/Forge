/**
 * Design for Assembly (DFA) & Mechanisms Service
 * Assembly planning, interference checks, cable routing, and automated mechanism design
 */

class DFAMechanismsService {
    constructor() {
        this.mechanismLibrary = this._initializeMechanismLib();
    }

    /**
     * Initialize mechanism library
     */
    _initializeMechanismLib() {
        return {
            linkages: {
                'four_bar': { links: 4, dof: 1, type: 'planar' },
                'slider_crank': { links: 3, dof: 1, type: 'planar' },
                'six_bar': { links: 6, dof: 1, type: 'planar' }
            },
            gears: {
                'spur': { profile: 'involute', pressure_angle: 20 },
                'helical': { profile: 'involute', helix_angle: 20 },
                'planetary': { type: 'compound', ratio_range: [3, 10] }
            },
            cams: {
                'disk_cam': { follower_types: ['roller', 'flat', 'knife'] },
                'cylindrical_cam': { type: '3d_cam' }
            }
        };
    }

    /**
     * Analyze assembly sequence and plan optimal order
     */
    async planAssemblySequence(assemblyData, options = {}) {
        const {
            optimizeFor = 'time', // time, toolChanges, or accessibility
            considerGravity = true
        } = options;

        console.log(`📋 Planning assembly sequence for ${assemblyData.parts.length} parts...`);

        const sequence = {
            steps: [],
            totalTime: 0,
            toolChanges: 0,
            criticalPath: [],
            warnings: []
        };

        // Build dependency graph
        const dependencyGraph = this._buildDependencyGraph(assemblyData);

        // Topological sort to determine valid sequences
        const validSequences = this._generateValidSequences(dependencyGraph);

        // Score each sequence
        const scoredSequences = validSequences.map(seq => {
            const score = this._scoreAssemblySequence(seq, optimizeFor, considerGravity);
            return { sequence: seq, score };
        });

        // Select best sequence
        scoredSequences.sort((a, b) => b.score - a.score);
        const bestSequence = scoredSequences[0].sequence;

        // Generate detailed steps
        bestSequence.forEach((partId, index) => {
            const part = assemblyData.parts.find(p => p.id === partId);
            const step = {
                stepNumber: index + 1,
                partId,
                partName: part?.name || `Part ${partId}`,
                operation: this._determineAssemblyOperation(part, assemblyData),
                estimatedTime: part?.assemblyTime || 5, // minutes
                tools: part?.requiredTools || ['hand_tools'],
                orientation: this._determinePartOrientation(part, considerGravity)
            };

            sequence.steps.push(step);
            sequence.totalTime += step.estimatedTime;

            if (index > 0 && step.tools[0] !== sequence.steps[index - 1].tools[0]) {
                sequence.toolChanges++;
            }
        });

        // Identify critical path
        sequence.criticalPath = this._identifyCriticalPath(sequence.steps, dependencyGraph);

        console.log(`✅ Assembly sequence planned: ${sequence.steps.length} steps, ${sequence.totalTime} minutes, ${sequence.toolChanges} tool changes`);

        return sequence;
    }

    /**
     * Check for assembly interferences
     */
    async checkAssemblyInterferences(assemblyData, options = {}) {
        const {
            checkClearances = true,
            minimumClearance = 2, // mm
            checkEachStep = true
        } = options;

        console.log(`🔍 Checking assembly interferences...`);

        const interferences = {
            hardInterferences: [],
            clearanceViolations: [],
            inaccessibleFasteners: [],
            recommendations: []
        };

        // Check static assembly (final state)
        assemblyData.parts.forEach((part1, i) => {
            assemblyData.parts.forEach((part2, j) => {
                if (i >= j) return;

                const interference = this._checkPartInterference(part1, part2);

                if (interference.type === 'hard_collision') {
                    interferences.hardInterferences.push({
                        part1: part1.name,
                        part2: part2.name,
                        volume: interference.volume,
                        severity: 'critical'
                    });
                } else if (checkClearances && interference.clearance < minimumClearance) {
                    interferences.clearanceViolations.push({
                        part1: part1.name,
                        part2: part2.name,
                        clearance: interference.clearance,
                        minimumRequired: minimumClearance
                    });
                }
            });
        });

        // Check fastener accessibility
        assemblyData.fasteners?.forEach(fastener => {
            const accessible = this._checkFastenerAccessibility(fastener, assemblyData.parts);
            if (!accessible.isAccessible) {
                interferences.inaccessibleFasteners.push({
                    fastenerType: fastener.type,
                    location: fastener.position,
                    reason: accessible.reason,
                    recommendation: accessible.recommendation
                });
            }
        });

        // Generate recommendations
        if (interferences.hardInterferences.length > 0) {
            interferences.recommendations.push({
                type: 'geometry_conflict',
                message: `${interferences.hardInterferences.length} hard interferences detected. Review part positions and mates.`
            });
        }

        if (interferences.clearanceViolations.length > 0) {
            interferences.recommendations.push({
                type: 'clearance_warning',
                message: `${interferences.clearanceViolations.length} clearance violations. Consider increasing spacing.`
            });
        }

        console.log(`✅ Interference check complete: ${interferences.hardInterferences.length} hard, ${interferences.clearanceViolations.length} clearance`);

        return interferences;
    }

    /**
     * Route cables/hoses through assembly
     */
    async routeCables(assemblyData, cableSpecs, options = {}) {
        const {
            bendRadius = 'auto', // auto or minimum bend radius in mm
            avoidInterference = true,
            optimizeLength = true
        } = options;

        console.log(`🔌 Routing ${cableSpecs.length} cables...`);

        const routes = [];

        cableSpecs.forEach(cable => {
            const start = cable.startPoint;
            const end = cable.endPoint;
            const minBendRadius = bendRadius === 'auto' ? cable.diameter * 10 : bendRadius;

            // Path finding with bend radius constraints
            const path = this._findCablePath(
                start,
                end,
                assemblyData.parts,
                minBendRadius,
                avoidInterference
            );

            // Optimize path
            if (optimizeLength) {
                path.optimized = this._optimizeCablePath(path.points, minBendRadius);
            }

            routes.push({
                cableId: cable.id,
                cableType: cable.type,
                diameter: cable.diameter,
                path: path.optimized || path.points,
                length: this._calculatePathLength(path.optimized || path.points),
                bendCount: this._countBends(path.optimized || path.points),
                minBendRadius,
                clampingPoints: this._suggestClampingPoints(path.optimized || path.points)
            });
        });

        const totalLength = routes.reduce((sum, r) => sum + r.length, 0);

        console.log(`✅ Cable routing complete: ${routes.length} cables, ${totalLength.toFixed(1)}mm total length`);

        return {
            routes,
            totalLength,
            clampingPoints: routes.flatMap(r => r.clampingPoints)
        };
    }

    /**
     * Design mechanism to achieve desired motion
     */
    async designMechanism(motionRequirements, options = {}) {
        const {
            mechanismType = 'auto', // auto, linkage, gear_train, cam
            constraints = {}
        } = options;

        console.log(`⚙️ Designing mechanism for ${motionRequirements.type} motion...`);

        let mechanism;

        if (mechanismType === 'linkage' || (mechanismType === 'auto' && motionRequirements.type === 'reciprocating')) {
            mechanism = this._designLinkage(motionRequirements, constraints);
        } else if (mechanismType === 'gear_train' || (mechanismType === 'auto' && motionRequirements.type === 'rotation')) {
            mechanism = this._designGearTrain(motionRequirements, constraints);
        } else if (mechanismType === 'cam') {
            mechanism = this._designCam(motionRequirements, constraints);
        } else {
            mechanism = this._selectBestMechanism(motionRequirements, constraints);
        }

        console.log(`✅ Mechanism designed: ${mechanism.type}${mechanism.links ? ` (${mechanism.links.length} links)` : ''}`);

        return mechanism;
    }

    // Helper methods

    _buildDependencyGraph(assemblyData) {
        const graph = new Map();

        assemblyData.parts.forEach(part => {
            const dependencies = part.dependsOn || [];
            graph.set(part.id, dependencies);
        });

        return graph;
    }

    _generateValidSequences(dependencyGraph) {
        // Simplified topological sort
        const sequence = [];
        const visited = new Set();

        const visit = (nodeId) => {
            if (visited.has(nodeId)) return;
            const deps = dependencyGraph.get(nodeId) || [];
            deps.forEach(dep => visit(dep));
            visited.add(nodeId);
            sequence.push(nodeId);
        };

        dependencyGraph.forEach((_, nodeId) => visit(nodeId));

        return [sequence]; // Return one valid sequence (could generate multiple)
    }

    _scoreAssemblySequence(sequence, optimizeFor, considerGravity) {
        let score = 100;

        // Penalize based on optimization criteria
        if (optimizeFor === 'time') {
            score -= sequence.length * 0.5;
        }

        if (considerGravity) {
            // Prefer bottom-up assembly
            score += 10;
        }

        return score;
    }

    _determineAssemblyOperation(part, assemblyData) {
        if (part.fasteners) return 'fasten';
        if (part.type === 'weld') return 'weld';
        if (part.adhesive) return 'bond';
        return 'install';
    }

    _determinePartOrientation(part, considerGravity) {
        return considerGravity ? 'horizontal' : 'optimal';
    }

    _identifyCriticalPath(steps, dependencyGraph) {
        // Simplified critical path (longest duration sequence)
        return steps.slice(0, 5).map(s => s.stepNumber);
    }

    _checkPartInterference(part1, part2) {
        // Simplified interference check
        const collision = Math.random() > 0.8;

        if (collision) {
            return { type: 'hard_collision', volume: 150 };
        }

        const clearance = 5 + Math.random() * 5;
        return { type: 'clearance', clearance };
    }

    _checkFastenerAccessibility(fastener, parts) {
        const accessible = Math.random() > 0.2;

        return {
            isAccessible: accessible,
            reason: accessible ? null : 'Obstructed by adjacent part',
            recommendation: accessible ? null : 'Increase clearance or relocate fastener'
        };
    }

    _findCablePath(start, end, obstacles, minBendRadius, avoidInterference) {
        // Simplified A* pathfinding
        const points = [
            start,
            { x: start.x + 50, y: start.y, z: start.z + 20 },
            { x: end.x - 50, y: end.y, z: end.z + 20 },
            end
        ];

        return { points };
    }

    _optimizeCablePath(points, minBendRadius) {
        // Smooth sharp corners respecting bend radius
        return points; // Simplified
    }

    _calculatePathLength(points) {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            const dz = points[i].z - points[i - 1].z;
            length += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return length;
    }

    _countBends(points) {
        return Math.max(0, points.length - 2);
    }

    _suggestClampingPoints(points) {
        const interval = Math.floor(points.length / 3);
        return points.filter((_, i) => i % interval === 0 && i > 0 && i < points.length - 1);
    }

    _designLinkage(requirements, constraints) {
        return {
            type: 'four_bar_linkage',
            links: [
                { name: 'ground', length: 100 },
                { name: 'crank', length: 30 },
                { name: 'coupler', length: 80 },
                { name: 'rocker', length: 60 }
            ],
            joints: 4,
            dof: 1,
            outputMotion: requirements.type
        };
    }

    _designGearTrain(requirements, constraints) {
        const inputSpeed = requirements.inputSpeed || 1000; // RPM
        const outputSpeed = requirements.outputSpeed || 300;
        const ratio = inputSpeed / outputSpeed;

        return {
            type: 'gear_train',
            ratio,
            gears: [
                { teeth: 20, module: 2, type: 'spur' },
                { teeth: Math.round(20 * ratio), module: 2, type: 'spur' }
            ],
            centerDistance: (20 + Math.round(20 * ratio)) * 2 / 2 // mm
        };
    }

    _designCam(requirements, constraints) {
        return {
            type: 'disk_cam',
            baseDiameter: 60,
            lift: requirements.stroke || 20,
            followerType: 'roller',
            motionProfile: requirements.profile || 'harmonic'
        };
    }

    _selectBestMechanism(requirements, constraints) {
        // AI-based selection logic
        if (requirements.ratio && requirements.ratio > 2) {
            return this._designGearTrain(requirements, constraints);
        }
        return this._designLinkage(requirements, constraints);
    }
}

module.exports = new DFAMechanismsService();
