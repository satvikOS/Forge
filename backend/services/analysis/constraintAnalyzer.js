/**
 * Constraint & DOF Explorer
 * Analyzes sketch constraints, assembly degrees of freedom, and FEA boundary conditions
 */

class ConstraintAnalyzer {
    constructor() {
        this.constraintTypes = {
            // Sketch constraints
            COINCIDENT: 'coincident',
            PARALLEL: 'parallel',
            PERPENDICULAR: 'perpendicular',
            TANGENT: 'tangent',
            CONCENTRIC: 'concentric',
            HORIZONTAL: 'horizontal',
            VERTICAL: 'vertical',
            EQUAL: 'equal',
            DISTANCE: 'distance',
            ANGLE: 'angle',

            // Assembly mates
            FIXED: 'fixed',
            HINGE: 'hinge',
            SLIDER: 'slider',
            CYLINDRICAL: 'cylindrical',
            PLANAR: 'planar',
            SPHERICAL: 'spherical'
        };
    }

    /**
     * Analyze sketch constraints
     * @param {Object} sketch - Sketch data
     * @returns {Object} - Constraint analysis
     */
    analyzeSketchConstraints(sketch) {
        const { entities, constraints } = sketch;

        const analysis = {
            status: 'unknown',
            degreesOfFreedom: 0,
            constraintCount: constraints.length,
            redundantConstraints: [],
            missingConstraints: [],
            conflictingConstraints: [],
            suggestions: []
        };

        // Calculate expected DOF
        const totalDOF = this._calculateSketchDOF(entities);

        // Count constrained DOF
        const constrainedDOF = this._countConstrainedDOF(constraints);

        analysis.degreesOfFreedom = totalDOF - constrainedDOF;

        // Determine status
        if (analysis.degreesOfFreedom === 0) {
            analysis.status = 'fully-defined';
        } else if (analysis.degreesOfFreedom > 0) {
            analysis.status = 'under-defined';
            analysis.suggestions.push(
                `Add ${analysis.degreesOfFreedom} more constraint(s) to fully define the sketch`
            );
        } else {
            analysis.status = 'over-defined';
            analysis.redundantConstraints = this._identifyRedundantConstraints(constraints);
        }

        // Detect conflicts
        analysis.conflictingConstraints = this._detectConflicts(constraints);

        // Suggest missing constraints
        if (analysis.status === 'under-defined') {
            analysis.missingConstraints = this._suggestMissingConstraints(
                entities,
                constraints,
                analysis.degreesOfFreedom
            );
        }

        return analysis;
    }

    /**
     * Analyze assembly degrees of freedom
     * @param {Object} assembly - Assembly data
     * @returns {Object} - DOF analysis
     */
    analyzeAssemblyDOF(assembly) {
        const { components, mates } = assembly;

        const analysis = {
            totalDOF: 0,
            componentDOF: [],
            motionType: 'unknown',
            mechanismType: null,
            warnings: [],
            suggestions: []
        };

        // Calculate DOF using Gruebler's equation: DOF = 6(n-1) - 5j1 - 4j2 - 3j3 - 2j4 - j5
        // where n = number of links, ji = number of joints with i degrees of freedom

        const numLinks = components.length;
        const jointCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        // Classify mates by constrained DOF
        mates.forEach(mate => {
            const freedomRemoved = this._getConstrainedDOF(mate.type);
            const freedomRemaining = 6 - freedomRemoved;

            if (freedomRemaining >= 1 && freedomRemaining <= 5) {
                jointCounts[freedomRemaining]++;
            }
        });

        // Apply Gruebler's equation
        analysis.totalDOF = 6 * (numLinks - 1) -
            5 * jointCounts[1] -
            4 * jointCounts[2] -
            3 * jointCounts[3] -
            2 * jointCounts[4] -
            jointCounts[5];

        // Analyze each component
        components.forEach(comp => {
            const compDOF = this._calculateComponentDOF(comp, mates);
            analysis.componentDOF.push({
                componentId: comp.id,
                name: comp.name,
                dof: compDOF,
                mobilityType: this._getMobilityType(compDOF)
            });
        });

        // Determine motion type
        if (analysis.totalDOF === 0) {
            analysis.motionType = 'rigid';
            analysis.mechanismType = null;
        } else if (analysis.totalDOF === 1) {
            analysis.motionType = 'single-dof';
            analysis.mechanismType = this._identifyMechanism(assembly, mates);
        } else if (analysis.totalDOF > 1) {
            analysis.motionType = 'multi-dof';
            analysis.mechanismType = 'complex';
        } else {
            analysis.motionType = 'over-constrained';
            analysis.warnings.push('Assembly is over-constrained. Remove redundant mates.');
        }

        // Generate suggestions
        if (analysis.totalDOF < 0) {
            analysis.suggestions.push('Remove redundant mates to resolve over-constraint');
        } else if (analysis.totalDOF > 6) {
            analysis.suggestions.push('Add mates to reduce excessive degrees of freedom');
        }

        return analysis;
    }

    /**
     * Verify FEA boundary conditions and supports
     * @param {Object} feaModel - FEA model data
     * @returns {Object} - Verification results
     */
    verifyFEASupports(feaModel) {
        const { mesh, loads, supports } = feaModel;

        const verification = {
            isValid: true,
            hasSufficientSupports: false,
            hasLoads: false,
            rigidBodyModes: 0,
            warnings: [],
            errors: [],
            suggestions: []
        };

        // Check for loads
        verification.hasLoads = loads && loads.length > 0;
        if (!verification.hasLoads) {
            verification.warnings.push('No loads defined. Analysis may not be meaningful.');
        }

        // Check for supports
        const hasSupports = supports && supports.length > 0;
        if (!hasSupports) {
            verification.errors.push('No supports defined. Model is unconstrained.');
            verification.isValid = false;
            return verification;
        }

        // Count constrained DOF from supports
        let constrainedDOF = { tx: false, ty: false, tz: false, rx: false, ry: false, rz: false };

        supports.forEach(support => {
            if (support.type === 'fixed') {
                constrainedDOF = { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true };
            } else {
                if (support.constraints) {
                    if (support.constraints.tx) constrainedDOF.tx = true;
                    if (support.constraints.ty) constrainedDOF.ty = true;
                    if (support.constraints.tz) constrainedDOF.tz = true;
                    if (support.constraints.rx) constrainedDOF.rx = true;
                    if (support.constraints.ry) constrainedDOF.ry = true;
                    if (support.constraints.rz) constrainedDOF.rz = true;
                }
            }
        });

        // Count rigid body modes (unconstrained DOF)
        const dofArray = Object.values(constrainedDOF);
        verification.rigidBodyModes = dofArray.filter(v => !v).length;
        verification.hasSufficientSupports = verification.rigidBodyModes === 0;

        // Generate warnings and suggestions
        if (verification.rigidBodyModes > 0) {
            const unconstrained = Object.keys(constrainedDOF).filter(
                key => !constrainedDOF[key]
            );
            verification.warnings.push(
                `${verification.rigidBodyModes} rigid body mode(s) detected. Unconstrained: ${unconstrained.join(', ')}`
            );
            verification.suggestions.push(
                `Add supports to constrain: ${unconstrained.join(', ')}`
            );

            // For static analysis, this is usually an error
            verification.errors.push('Insufficient supports for static analysis');
            verification.isValid = false;
        }

        // Check for support locations
        const supportedNodes = new Set();
        supports.forEach(support => {
            if (support.nodes) {
                support.nodes.forEach(node => supportedNodes.add(node));
            }
        });

        if (supportedNodes.size === 0) {
            verification.errors.push('No nodes are actually supported');
            verification.isValid = false;
        }

        // Check mesh quality at supports
        const supportQuality = this._checkSupportMeshQuality(mesh, supports);
        if (supportQuality.warnings.length > 0) {
            verification.warnings.push(...supportQuality.warnings);
        }

        return verification;
    }

    /**
     * Identify mobility patterns in assembly
     * @param {Object} assembly - Assembly data
     * @returns {Object} - Mobility analysis
     */
    identifyMobilityPatterns(assembly) {
        const { components, mates } = assembly;

        const patterns = {
            kinematicChains: [],
            loops: [],
            grounded: [],
            floating: []
        };

        // Build connection graph
        const graph = this._buildMateGraph(components, mates);

        // Identify grounded (fixed) components
        components.forEach(comp => {
            const isGrounded = mates.some(
                mate => mate.type === this.constraintTypes.FIXED &&
                    (mate.component1 === comp.id || mate.component2 === comp.id)
            );
            if (isGrounded) {
                patterns.grounded.push(comp.id);
            }
        });

        // Identify kinematic chains
        patterns.kinematicChains = this._findKinematicChains(graph, patterns.grounded);

        // Identify loops
        patterns.loops = this._findLoops(graph);

        // Identify floating components
        patterns.floating = components
            .filter(comp => !this._isConnected(comp.id, graph, patterns.grounded))
            .map(comp => comp.id);

        return patterns;
    }

    // Helper methods
    _calculateSketchDOF(entities) {
        // Each point has 2 DOF, each line has 4 DOF (2 endpoints), etc.
        let totalDOF = 0;

        entities.forEach(entity => {
            switch (entity.type) {
                case 'point':
                    totalDOF += 2;
                    break;
                case 'line':
                    totalDOF += 4;
                    break;
                case 'circle':
                    totalDOF += 3; // center (2) + radius (1)
                    break;
                case 'arc':
                    totalDOF += 5; // center (2) + radius (1) + 2 angles
                    break;
            }
        });

        return totalDOF;
    }

    _countConstrainedDOF(constraints) {
        let constrained = 0;

        constraints.forEach(constraint => {
            switch (constraint.type) {
                case this.constraintTypes.COINCIDENT:
                    constrained += 2;
                    break;
                case this.constraintTypes.DISTANCE:
                case this.constraintTypes.ANGLE:
                    constrained += 1;
                    break;
                case this.constraintTypes.PARALLEL:
                case this.constraintTypes.PERPENDICULAR:
                    constrained += 1;
                    break;
                case this.constraintTypes.HORIZONTAL:
                case this.constraintTypes.VERTICAL:
                    constrained += 1;
                    break;
                case this.constraintTypes.TANGENT:
                    constrained += 1;
                    break;
                case this.constraintTypes.CONCENTRIC:
                    constrained += 2;
                    break;
                case this.constraintTypes.EQUAL:
                    constrained += 1;
                    break;
            }
        });

        return constrained;
    }

    _identifyRedundantConstraints(constraints) {
        // Simplified: check for duplicate constraints
        const redundant = [];
        const seen = new Set();

        constraints.forEach((constraint, idx) => {
            const key = `${constraint.type}_${constraint.entity1}_${constraint.entity2}`;
            if (seen.has(key)) {
                redundant.push(idx);
            }
            seen.add(key);
        });

        return redundant;
    }

    _detectConflicts(constraints) {
        // Simplified: check for directly conflicting constraints
        const conflicts = [];

        for (let i = 0; i < constraints.length; i++) {
            for (let j = i + 1; j < constraints.length; j++) {
                const c1 = constraints[i];
                const c2 = constraints[j];

                // Example: parallel and perpendicular on same entities
                if (c1.entity1 === c2.entity1 && c1.entity2 === c2.entity2) {
                    if (c1.type === this.constraintTypes.PARALLEL &&
                        c2.type === this.constraintTypes.PERPENDICULAR) {
                        conflicts.push([i, j]);
                    }
                }
            }
        }

        return conflicts;
    }

    _suggestMissingConstraints(entities, constraints, numMissing) {
        const suggestions = [];

        // Simple heuristics
        if (numMissing >= 2) {
            suggestions.push({
                type: this.constraintTypes.COINCIDENT,
                reason: 'Fix position in 2D space'
            });
        }
        if (numMissing >= 1) {
            suggestions.push({
                type: this.constraintTypes.HORIZONTAL,
                reason: 'Define orientation'
            });
        }

        return suggestions.slice(0, numMissing);
    }

    _getConstrainedDOF(mateType) {
        // Returns how many DOF are removed by this mate type
        const dofMap = {
            [this.constraintTypes.FIXED]: 6,
            [this.constraintTypes.HINGE]: 5,
            [this.constraintTypes.SLIDER]: 5,
            [this.constraintTypes.CYLINDRICAL]: 4,
            [this.constraintTypes.PLANAR]: 3,
            [this.constraintTypes.SPHERICAL]: 3
        };

        return dofMap[mateType] || 0;
    }

    _calculateComponentDOF(component, mates) {
        let dof = 6; // Start with full 6 DOF

        mates.forEach(mate => {
            if (mate.component1 === component.id || mate.component2 === component.id) {
                dof -= this._getConstrainedDOF(mate.type);
            }
        });

        return Math.max(0, dof);
    }

    _getMobilityType(dof) {
        if (dof === 0) return 'fixed';
        if (dof === 1) return 'rotation or translation';
        if (dof === 2) return 'planar';
        if (dof === 3) return 'spatial';
        if (dof === 6) return 'free';
        return 'partial';
    }

    _identifyMechanism(assembly, mates) {
        // Simplified mechanism identification
        const hingeCount = mates.filter(m => m.type === this.constraintTypes.HINGE).length;
        const sliderCount = mates.filter(m => m.type === this.constraintTypes.SLIDER).length;

        if (hingeCount >= 3) return 'linkage';
        if (sliderCount >= 1 && hingeCount >= 1) return 'slider-crank';
        if (hingeCount === 1) return 'simple-hinge';
        if (sliderCount === 1) return 'linear-actuator';

        return 'unknown';
    }

    _buildMateGraph(components, mates) {
        const graph = {};

        components.forEach(comp => {
            graph[comp.id] = [];
        });

        mates.forEach(mate => {
            if (!graph[mate.component1]) graph[mate.component1] = [];
            if (!graph[mate.component2]) graph[mate.component2] = [];

            graph[mate.component1].push({ to: mate.component2, mate });
            graph[mate.component2].push({ to: mate.component1, mate });
        });

        return graph;
    }

    _findKinematicChains(graph, groundedComponents) {
        const chains = [];
        const visited = new Set(groundedComponents);

        const dfs = (node, chain) => {
            visited.add(node);
            chain.push(node);

            const neighbors = graph[node] || [];
            let hasUnvisited = false;

            neighbors.forEach(edge => {
                if (!visited.has(edge.to)) {
                    hasUnvisited = true;
                    dfs(edge.to, [...chain]);
                }
            });

            if (!hasUnvisited && chain.length > 1) {
                chains.push(chain);
            }
        };

        groundedComponents.forEach(ground => {
            dfs(ground, []);
        });

        return chains;
    }

    _findLoops(graph) {
        const loops = [];
        const visited = new Set();
        const recStack = new Set();

        const dfs = (node, path) => {
            visited.add(node);
            recStack.add(node);
            path.push(node);

            const neighbors = graph[node] || [];
            neighbors.forEach(edge => {
                if (!visited.has(edge.to)) {
                    dfs(edge.to, [...path]);
                } else if (recStack.has(edge.to)) {
                    // Found a loop
                    const loopStart = path.indexOf(edge.to);
                    loops.push(path.slice(loopStart));
                }
            });

            recStack.delete(node);
        };

        Object.keys(graph).forEach(node => {
            if (!visited.has(node)) {
                dfs(node, []);
            }
        });

        return loops;
    }

    _isConnected(componentId, graph, groundedComponents) {
        const visited = new Set();
        const queue = [...groundedComponents];

        while (queue.length > 0) {
            const current = queue.shift();
            if (current === componentId) return true;
            if (visited.has(current)) continue;

            visited.add(current);
            const neighbors = graph[current] || [];
            neighbors.forEach(edge => {
                if (!visited.has(edge.to)) {
                    queue.push(edge.to);
                }
            });
        }

        return false;
    }

    _checkSupportMeshQuality(mesh, supports) {
        const warnings = [];

        supports.forEach((support, idx) => {
            // Check if support is on a fine enough mesh
            const avgElementSize = mesh.averageElementSize || 1;
            const supportArea = support.area || 1;

            if (supportArea < avgElementSize * 0.1) {
                warnings.push(
                    `Support #${idx}: Area is very small compared to mesh size. Consider refining mesh or enlarging support area.`
                );
            }
        });

        return { warnings };
    }
}

module.exports = new ConstraintAnalyzer();
