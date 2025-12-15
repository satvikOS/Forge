/**
 * Parametric CAD Engine
 * Core geometric modeling engine for creating parametric 3D features
 * Supports feature-based modeling with full parameter control
 */
class ParametricEngine {
    constructor() {
        this.featureIdCounter = 0;
    }

    /**
     * Create an extrude feature from a 2D sketch
     * @param {object} sketch - 2D sketch profile
     * @param {number} distance - Extrusion distance in mm
     * @param {object} options - Additional options (direction, draft, etc.)
     * @returns {object} - Extrude feature specification
     */
    createExtrude(sketch, distance, options = {}) {
        const feature = {
            id: this.generateFeatureId(),
            type: 'extrude',
            name: options.name || `Extrude_${this.featureIdCounter}`,
            sketch: sketch,
            parameters: {
                distance: { value: distance, unit: 'mm', editable: true },
                direction: options.direction || 'normal', // normal, reverse, both
                draftAngle: { value: options.draftAngle || 0, unit: 'deg', editable: true },
                merge: options.merge !== false // Merge with existing body by default
            },
            createdAt: new Date().toISOString(),
            dependencies: [sketch.id]
        };

        return feature;
    }

    /**
     * Create a revolve feature from a 2D profile
     * @param {object} sketch - 2D sketch profile
     * @param {object} axis - Axis of revolution {point, direction}
     * @param {number} angle - Angle of revolution in degrees (360 for full revolution)
     * @returns {object} - Revolve feature specification
     */
    createRevolve(sketch, axis, angle = 360) {
        const feature = {
            id: this.generateFeatureId(),
            type: 'revolve',
            name: `Revolve_${this.featureIdCounter}`,
            sketch: sketch,
            parameters: {
                axis: axis,
                angle: { value: angle, unit: 'deg', editable: true },
                merge: true
            },
            createdAt: new Date().toISOString(),
            dependencies: [sketch.id]
        };

        return feature;
    }

    /**
     * Create a sweep feature along a path
     * @param {object} profile - 2D profile sketch
     * @param {object} path - 3D path curve
     * @param {object} options - Guide curves, twist, scale
     * @returns {object} - Sweep feature specification
     */
    createSweep(profile, path, options = {}) {
        const feature = {
            id: this.generateFeatureId(),
            type: 'sweep',
            name: `Sweep_${this.featureIdCounter}`,
            profile: profile,
            path: path,
            parameters: {
                twist: { value: options.twist || 0, unit: 'deg', editable: true },
                scale: { value: options.scale || 1.0, editable: true },
                keepNormalConstant: options.keepNormalConstant || false,
                guideCurves: options.guideCurves || []
            },
            createdAt: new Date().toISOString(),
            dependencies: [profile.id, path.id]
        };

        return feature;
    }

    /**
     * Create a loft feature between multiple profiles
     * @param {array} profiles - Array of 2D profile sketches
     * @param {object} options - Guide curves, start/end constraints
     * @returns {object} - Loft feature specification
     */
    createLoft(profiles, options = {}) {
        if (profiles.length < 2) {
            throw new Error('Loft requires at least 2 profiles');
        }

        const feature = {
            id: this.generateFeatureId(),
            type: 'loft',
            name: `Loft_${this.featureIdCounter}`,
            profiles: profiles,
            parameters: {
                guideCurves: options.guideCurves || [],
                startTangent: options.startTangent || null,
                endTangent: options.endTangent || null,
                closedBlend: options.closedBlend || false
            },
            createdAt: new Date().toISOString(),
            dependencies: profiles.map(p => p.id)
        };

        return feature;
    }

    /**
     * Create a fillet feature (rounded edge)
     * @param {array} edges - Array of edge IDs to fillet
     * @param {number} radius - Fillet radius in mm
     * @param {object} options - Additional options (setback, asymmetric, etc.)
     * @returns {object} - Fillet feature specification
     */
    createFillet(edges, radius, options = {}) {
        const feature = {
            id: this.generateFeatureId(),
            type: 'fillet',
            name: `Fillet_${this.featureIdCounter}`,
            edges: edges,
            parameters: {
                radius: { value: radius, unit: 'mm', editable: true },
                type: options.type || 'constant', // constant, variable, chord
                setback: options.setback || null,
                propagate: options.propagate !== false // Propagate to tangent edges
            },
            createdAt: new Date().toISOString(),
            dependencies: edges
        };

        return feature;
    }

    /**
     * Create a chamfer feature (beveled edge)
     * @param {array} edges - Array of edge IDs to chamfer
     * @param {number} distance - Chamfer distance in mm
     * @param {object} options - Additional options (angle, offset, etc.)
     * @returns {object} - Chamfer feature specification
     */
    createChamfer(edges, distance, options = {}) {
        const feature = {
            id: this.generateFeatureId(),
            type: 'chamfer',
            name: `Chamfer_${this.featureIdCounter}`,
            edges: edges,
            parameters: {
                distance: { value: distance, unit: 'mm', editable: true },
                angle: { value: options.angle || 45, unit: 'deg', editable: true },
                offsetDistance: options.offsetDistance || null,
                type: options.type || 'distance_distance' // distance_distance, distance_angle
            },
            createdAt: new Date().toISOString(),
            dependencies: edges
        };

        return feature;
    }

    /**
     * Create a hole feature
     * @param {object} position - {x, y, z} or face + sketch point
     * @param {number} diameter - Hole diameter in mm
     * @param {number} depth - Hole depth in mm (null for through-all)
     * @param {string} type - 'simple', 'counterbore', 'countersink', 'threaded'
     * @returns {object} - Hole feature specification
     */
    createHole(position, diameter, depth, type = 'simple') {
        const feature = {
            id: this.generateFeatureId(),
            type: 'hole',
            name: `Hole_${this.featureIdCounter}`,
            position: position,
            parameters: {
                diameter: { value: diameter, unit: 'mm', editable: true },
                depth: depth ? { value: depth, unit: 'mm', editable: true } : 'through_all',
                holeType: type,
                threadSize: type === 'threaded' ? this.suggestThreadSize(diameter) : null,
                counterboreDiameter: type === 'counterbore' ? diameter * 1.8 : null,
                counterboreDepth: type === 'counterbore' ? diameter * 0.5 : null,
                countersinkAngle: type === 'countersink' ? 90 : null
            },
            createdAt: new Date().toISOString()
        };

        return feature;
    }

    /**
     * Create a pattern feature (linear or circular)
     * @param {object} feature - Feature to pattern
     * @param {string} type - 'linear' or 'circular'
     * @param {number} count - Number of instances
     * @param {object} spacing - Spacing/angle parameters
     * @returns {object} - Pattern feature specification
     */
    createPattern(feature, type, count, spacing) {
        const patternFeature = {
            id: this.generateFeatureId(),
            type: 'pattern',
            name: `Pattern_${this.featureIdCounter}`,
            seedFeature: feature,
            parameters: {
                patternType: type, // linear, circular
                count: { value: count, editable: true },
                spacing: type === 'linear'
                    ? { value: spacing, unit: 'mm', editable: true }
                    : { value: spacing, unit: 'deg', editable: true },
                direction: type === 'linear' ? spacing.direction : null,
                centerPoint: type === 'circular' ? spacing.center : null,
                axis: type === 'circular' ? spacing.axis : null
            },
            createdAt: new Date().toISOString(),
            dependencies: [feature.id]
        };

        return patternFeature;
    }

    /**
     * Boolean union operation
     * @param {array} bodies - Array of body IDs to combine
     * @returns {object} - Union operation specification
     */
    union(bodies) {
        return {
            id: this.generateFeatureId(),
            type: 'boolean_union',
            name: `Union_${this.featureIdCounter}`,
            bodies: bodies,
            keepOriginals: false,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Boolean subtract operation
     * @param {string} basebody - Base body ID
     * @param {array} toolBodies - Array of tool body IDs to subtract
     * @returns {object} - Subtract operation specification
     */
    subtract(baseBody, toolBodies) {
        return {
            id: this.generateFeatureId(),
            type: 'boolean_subtract',
            name: `Subtract_${this.featureIdCounter}`,
            baseBody: baseBody,
            toolBodies: toolBodies,
            keepTools: false,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Boolean intersect operation
     * @param {array} bodies - Array of body IDs
     * @returns {object} - Intersect operation specification
     */
    intersect(bodies) {
        return {
            id: this.generateFeatureId(),
            type: 'boolean_intersect',
            name: `Intersect_${this.featureIdCounter}`,
            bodies: bodies,
            keepOriginals: false,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Create a feature tree from specifications
     * @param {array} features - Array of feature specifications
     * @returns {object} - Feature tree with dependencies
     */
    createFeatureTree(features) {
        const tree = {
            features: features,
            rootFeatures: [],
            dependencies: this.buildDependencyGraph(features)
        };

        // Identify root features (no dependencies)
        features.forEach(feature => {
            if (!feature.dependencies || feature.dependencies.length === 0) {
                tree.rootFeatures.push(feature.id);
            }
        });

        return tree;
    }

    /**
     * Regenerate geometry from feature tree
     * @param {object} featureTree - Feature tree to regenerate
     * @returns {object} - Regenerated geometry data
     */
    regenerate(featureTree) {
        console.log('🔄 Regenerating parametric model...');

        // In a full implementation, this would:
        // 1. Traverse feature tree in dependency order
        // 2. Execute each feature operation
        // 3. Update dependent features
        // 4. Return final B-rep geometry

        // For now, return a simplified representation
        return {
            success: true,
            featureCount: featureTree.features.length,
            geometry: {
                type: 'solid',
                features: featureTree.features.map(f => f.id)
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Suppress a feature (temporarily disable)
     * @param {string} featureId - Feature ID to suppress
     * @param {object} featureTree - Feature tree
     * @returns {object} - Updated feature tree
     */
    suppressFeature(featureId, featureTree) {
        const feature = featureTree.features.find(f => f.id === featureId);
        if (feature) {
            feature.suppressed = true;
            // In full implementation, would regenerate dependent features
        }
        return featureTree;
    }

    /**
     * Unsuppress a feature
     * @param {string} featureId - Feature ID to unsuppress
     * @param {object} featureTree - Feature tree
     * @returns {object} - Updated feature tree
     */
    unsuppressFeature(featureId, featureTree) {
        const feature = featureTree.features.find(f => f.id === featureId);
        if (feature) {
            feature.suppressed = false;
            // In full implementation, would regenerate
        }
        return featureTree;
    }

    /**
     * Update feature parameter
     * @param {string} featureId - Feature ID
     * @param {string} paramName - Parameter name
     * @param {any} newValue - New parameter value
     * @param {object} featureTree - Feature tree
     * @returns {object} - Updated feature tree
     */
    updateParameter(featureId, paramName, newValue, featureTree) {
        const feature = featureTree.features.find(f => f.id === featureId);
        if (feature && feature.parameters[paramName]) {
            if (feature.parameters[paramName].editable) {
                feature.parameters[paramName].value = newValue;
                feature.modified = new Date().toISOString();
                // In full implementation, would trigger regenerate
                console.log(`✏️  Updated ${feature.name}.${paramName} = ${newValue}`);
            } else {
                throw new Error(`Parameter ${paramName} is not editable`);
            }
        }
        return featureTree;
    }

    // ==================== Helper Methods ====================

    generateFeatureId() {
        this.featureIdCounter++;
        return `feature_${this.featureIdCounter}_${Date.now()}`;
    }

    buildDependencyGraph(features) {
        const graph = {};
        features.forEach(feature => {
            graph[feature.id] = feature.dependencies || [];
        });
        return graph;
    }

    suggestThreadSize(diameter) {
        // Suggest standard metric thread for given diameter
        const threadSizes = {
            3: 'M3x0.5',
            4: 'M4x0.7',
            5: 'M5x0.8',
            6: 'M6x1.0',
            8: 'M8x1.25',
            10: 'M10x1.5',
            12: 'M12x1.75'
        };

        // Find closest standard size
        const closestDiameter = Object.keys(threadSizes)
            .map(d => parseInt(d))
            .reduce((prev, curr) =>
                Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev
            );

        return threadSizes[closestDiameter] || `M${diameter}`;
    }

    /**
     * Validate feature dependencies
     * Ensures no circular dependencies
     */
    validateDependencies(featureTree) {
        const visited = new Set();
        const recursionStack = new Set();

        const hasCycle = (featureId) => {
            visited.add(featureId);
            recursionStack.add(featureId);

            const dependencies = featureTree.dependencies[featureId] || [];
            for (const depId of dependencies) {
                if (!visited.has(depId)) {
                    if (hasCycle(depId)) {
                        return true;
                    }
                } else if (recursionStack.has(depId)) {
                    return true; // Cycle detected
                }
            }

            recursionStack.delete(featureId);
            return false;
        };

        for (const feature of featureTree.features) {
            if (!visited.has(feature.id)) {
                if (hasCycle(feature.id)) {
                    throw new Error('Circular dependency detected in feature tree');
                }
            }
        }

        return true;
    }
}

module.exports = new ParametricEngine();
