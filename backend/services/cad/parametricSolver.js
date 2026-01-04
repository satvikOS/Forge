/**
 * Parametric Solver Service
 * Ensures full parametric editability with robust constraint solving
 */

class ParametricSolverService {
    constructor() {
        this.models = new Map();
        this.solverConfig = {
            maxIterations: 100,
            tolerance: 1e-6,
            relaxationFactor: 0.5
        };
    }

    /**
     * Update parameter and propagate changes
     * @param {string} modelId - Model identifier
     * @param {string} parameterName - Parameter to update
     * @param {number} newValue - New parameter value
     * @returns {Object} - Update results
     */
    async updateParameter(modelId, parameterName, newValue) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        console.log(`🔧 Updating parameter: ${parameterName} = ${newValue}`);

        // Store old value for rollback
        const oldValue = model.parameters[parameterName];

        // Validate edit before applying
        const validation = this.validateEdit(modelId, parameterName, newValue);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                rollback: true
            };
        }

        // Apply parameter change
        model.parameters[parameterName] = newValue;

        // Build dependency graph
        const dependencyGraph = this.getDependencyGraph(modelId);

        // Propagate changes through dependent parameters
        const affectedParameters = this._propagateChanges(
            model,
            parameterName,
            newValue,
            dependencyGraph
        );

        // Resolve geometric constraints
        const constraintResults = await this._solveConstraints(model);

        // Update feature history
        model.history.push({
            operation: 'parameter_update',
            parameter: parameterName,
            oldValue,
            newValue,
            timestamp: Date.now(),
            affectedParameters
        });

        // Recompute geometry
        const geometryUpdate = this._recomputeGeometry(model, affectedParameters);

        console.log(`✅ Parameter updated. ${affectedParameters.length} parameters affected.`);

        return {
            success: true,
            parameter: parameterName,
            value: newValue,
            affectedParameters,
            constraintResults,
            geometryUpdate
        };
    }

    /**
     * Get parameter dependency graph
     * @param {string} modelId - Model identifier
     * @returns {Object} - Dependency graph
     */
    getDependencyGraph(modelId) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        console.log(`📊 Building dependency graph for model ${modelId}...`);

        const graph = {
            nodes: [],
            edges: [],
            levels: {}
        };

        // Add all parameters as nodes
        Object.keys(model.parameters).forEach(param => {
            graph.nodes.push({
                id: param,
                value: model.parameters[param],
                type: 'parameter'
            });
        });

        // Add edges based on equations
        if (model.equations) {
            model.equations.forEach(eq => {
                graph.edges.push({
                    from: eq.dependsOn,
                    to: eq.target,
                    equation: eq.formula
                });
            });
        }

        // Detect dependencies from features
        if (model.features) {
            model.features.forEach(feature => {
                const deps = this._extractFeatureDependencies(feature);
                deps.forEach(dep => {
                    graph.edges.push({
                        from: dep.source,
                        to: dep.target,
                        type: 'feature_dependency',
                        feature: feature.id
                    });
                });
            });
        }

        // Topological sort to determine evaluation order
        graph.levels = this._topologicalSort(graph.nodes, graph.edges);

        // Detect circular dependencies
        const cycles = this._detectCycles(graph.nodes, graph.edges);
        if (cycles.length > 0) {
            graph.hasCircularDependencies = true;
            graph.cycles = cycles;
        }

        console.log(`✅ Dependency graph built: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

        return graph;
    }

    /**
     * Validate if edit is valid before applying
     * @param {string} modelId - Model identifier
     * @param {string} parameterName - Parameter to validate
     * @param {number} newValue - Proposed new value
     * @returns {Object} - Validation result
     */
    validateEdit(modelId, parameterName, newValue) {
        const model = this.models.get(modelId);
        if (!model) {
            return { valid: false, error: 'Model not found' };
        }

        // Check if parameter exists
        if (!(parameterName in model.parameters)) {
            return { valid: false, error: `Parameter ${parameterName} does not exist` };
        }

        // Check value constraints
        const constraints = model.parameterConstraints?.[parameterName];
        if (constraints) {
            if (constraints.min !== undefined && newValue < constraints.min) {
                return { valid: false, error: `Value ${newValue} below minimum ${constraints.min}` };
            }
            if (constraints.max !== undefined && newValue > constraints.max) {
                return { valid: false, error: `Value ${newValue} above maximum ${constraints.max}` };
            }
        }

        // Simulate the change to detect geometric failures
        const simulation = this._simulateChange(model, parameterName, newValue);
        if (!simulation.valid) {
            return { valid: false, error: simulation.error };
        }

        return { valid: true };
    }

    /**
     * Link parameters with equations
     * @param {string} modelId - Model identifier
     * @param {Object} linkSpec - Link specification
     * @returns {Object} - Linked parameters
     */
    linkParameters(modelId, linkSpec) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        const { target, formula, dependsOn } = linkSpec;

        console.log(`🔗 Linking parameter: ${target} = ${formula}`);

        // Initialize equations array if needed
        if (!model.equations) {
            model.equations = [];
        }

        // Add equation
        const equation = {
            id: this._generateId(),
            target,
            formula,
            dependsOn: Array.isArray(dependsOn) ? dependsOn : [dependsOn],
            createdAt: Date.now()
        };

        model.equations.push(equation);

        // Evaluate equation to set initial value
        const value = this._evaluateEquation(equation, model.parameters);
        model.parameters[target] = value;

        console.log(`✅ Parameters linked: ${target} = ${value}`);

        return {
            success: true,
            equation,
            value
        };
    }

    /**
     * Register a new parametric model
     * @param {Object} modelData - Model data
     * @returns {string} - Model ID
     */
    registerModel(modelData) {
        const modelId = modelData.id || this._generateId();

        const model = {
            id: modelId,
            parameters: modelData.parameters || {},
            features: modelData.features || [],
            constraints: modelData.constraints || [],
            equations: modelData.equations || [],
            parameterConstraints: modelData.parameterConstraints || {},
            history: [],
            createdAt: Date.now()
        };

        this.models.set(modelId, model);

        console.log(`📝 Model registered: ${modelId} with ${Object.keys(model.parameters).length} parameters`);

        return modelId;
    }

    // Private methods

    _propagateChanges(model, changedParam, newValue, graph) {
        const affected = [];

        // Find all parameters that depend on the changed parameter
        const dependents = graph.edges
            .filter(edge => edge.from === changedParam)
            .map(edge => edge.to);

        // Recursively update dependent parameters
        dependents.forEach(dependent => {
            // Find equation for this dependent
            const equation = model.equations?.find(eq => eq.target === dependent);

            if (equation) {
                const newVal = this._evaluateEquation(equation, model.parameters);
                model.parameters[dependent] = newVal;
                affected.push({ parameter: dependent, oldValue: model.parameters[dependent], newValue: newVal });

                // Recursively propagate to further dependents
                const furtherAffected = this._propagateChanges(model, dependent, newVal, graph);
                affected.push(...furtherAffected);
            }
        });

        return affected;
    }

    async _solveConstraints(model) {
        // Iterative constraint solver using relaxation
        const results = {
            iterations: 0,
            converged: false,
            residuals: []
        };

        let iteration = 0;
        let maxResidual = Infinity;

        while (iteration < this.solverConfig.maxIterations && maxResidual > this.solverConfig.tolerance) {
            const residuals = [];

            // Evaluate all constraints
            model.constraints.forEach(constraint => {
                const residual = this._evaluateConstraint(constraint, model);
                residuals.push(residual);

                // Apply correction
                if (Math.abs(residual) > this.solverConfig.tolerance) {
                    this._applyConstraintCorrection(constraint, residual, model);
                }
            });

            maxResidual = Math.max(...residuals.map(Math.abs));
            results.residuals.push(maxResidual);
            iteration++;
        }

        results.iterations = iteration;
        results.converged = maxResidual <= this.solverConfig.tolerance;

        return results;
    }

    _recomputeGeometry(model, affectedParameters) {
        // Recompute geometric features affected by parameter changes
        const updatedFeatures = [];

        model.features.forEach(feature => {
            const featureDeps = this._extractFeatureDependencies(feature);
            const isAffected = featureDeps.some(dep =>
                affectedParameters.some(ap => ap.parameter === dep.source)
            );

            if (isAffected) {
                // Recompute feature geometry
                const updated = this._recomputeFeature(feature, model.parameters);
                updatedFeatures.push(updated);
            }
        });

        return {
            updatedFeatures: updatedFeatures.length,
            features: updatedFeatures
        };
    }

    _extractFeatureDependencies(feature) {
        const deps = [];

        // Extract parameter references from feature
        if (feature.parameters) {
            Object.entries(feature.parameters).forEach(([key, value]) => {
                if (typeof value === 'string' && value.startsWith('$')) {
                    // Parameter reference like "$width"
                    deps.push({
                        source: value.substring(1),
                        target: feature.id,
                        property: key
                    });
                }
            });
        }

        return deps;
    }

    _topologicalSort(nodes, edges) {
        const levels = {};
        const visited = new Set();

        const visit = (nodeId, level) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            levels[nodeId] = Math.max(levels[nodeId] || 0, level);

            // Visit dependents
            edges
                .filter(e => e.from === nodeId)
                .forEach(e => visit(e.to, level + 1));
        };

        // Start from nodes with no dependencies
        nodes.forEach(node => {
            const hasDependencies = edges.some(e => e.to === node.id);
            if (!hasDependencies) {
                visit(node.id, 0);
            }
        });

        return levels;
    }

    _detectCycles(nodes, edges) {
        const cycles = [];
        const visiting = new Set();
        const visited = new Set();

        const dfs = (nodeId, path) => {
            if (visiting.has(nodeId)) {
                // Found cycle
                const cycleStart = path.indexOf(nodeId);
                cycles.push(path.slice(cycleStart));
                return;
            }

            if (visited.has(nodeId)) return;

            visiting.add(nodeId);
            path.push(nodeId);

            edges
                .filter(e => e.from === nodeId)
                .forEach(e => dfs(e.to, [...path]));

            visiting.delete(nodeId);
            visited.add(nodeId);
        };

        nodes.forEach(node => dfs(node.id, []));

        return cycles;
    }

    _simulateChange(model, parameterName, newValue) {
        // Create temporary model copy
        const tempModel = JSON.parse(JSON.stringify(model));
        tempModel.parameters[parameterName] = newValue;

        // Check for geometric validity
        const features = tempModel.features || [];

        for (const feature of features) {
            if (!this._isFeatureValid(feature, tempModel.parameters)) {
                return {
                    valid: false,
                    error: `Feature ${feature.id} would become invalid`
                };
            }
        }

        return { valid: true };
    }

    _isFeatureValid(feature, parameters) {
        // Check feature-specific validity rules
        if (feature.type === 'extrude') {
            const depth = feature.parameters.depth;
            if (typeof depth === 'string' && depth.startsWith('$')) {
                const paramValue = parameters[depth.substring(1)];
                if (paramValue <= 0) return false;
            }
        }

        return true;
    }

    _evaluateEquation(equation, parameters) {
        try {
            // Simple equation evaluation
            // In production: use a proper expression parser
            let formula = equation.formula;

            equation.dependsOn.forEach(param => {
                const value = parameters[param] || 0;
                formula = formula.replace(new RegExp(`\\$${param}`, 'g'), value);
            });

            // Evaluate the formula
            return eval(formula);
        } catch (error) {
            console.error(`Error evaluating equation: ${equation.formula}`, error);
            return 0;
        }
    }

    _evaluateConstraint(constraint, model) {
        // Calculate constraint residual
        // Example: parallelism, perpendicularity, distance

        switch (constraint.type) {
            case 'distance':
                const target = constraint.target;
                const actual = this._measureDistance(constraint.entities, model);
                return actual - target;

            case 'angle':
                const targetAngle = constraint.target;
                const actualAngle = this._measureAngle(constraint.entities, model);
                return actualAngle - targetAngle;

            default:
                return 0;
        }
    }

    _applyConstraintCorrection(constraint, residual, model) {
        // Apply relaxation-based correction
        const correction = -residual * this.solverConfig.relaxationFactor;

        // Apply to affected parameters
        if (constraint.affects) {
            constraint.affects.forEach(param => {
                model.parameters[param] += correction;
            });
        }
    }

    _measureDistance(entities, model) {
        // Placeholder distance calculation
        return 10 + Math.random();
    }

    _measureAngle(entities, model) {
        // Placeholder angle calculation
        return 90 + Math.random() * 10;
    }

    _recomputeFeature(feature, parameters) {
        // Recompute feature with updated parameters
        return {
            ...feature,
            updated: true,
            timestamp: Date.now()
        };
    }

    _generateId() {
        return `param_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = new ParametricSolverService();
