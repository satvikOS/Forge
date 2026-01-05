/**
 * CAD Integration Service
 * Unified abstraction layer for CAD engine operations
 * Coordinates parametric operations, feature translation, and constraint solving
 */

const parametricEngine = require('./parametricEngine');
const parametricSolver = require('./parametricSolver');
const configurationService = require('./configurationService');
const sketchEngine = require('./sketchEngine');
const assemblyEngine = require('./assemblyEngine');

class CADIntegrationService {
    constructor() {
        this.activeSession = null;
        this.featureHistory = [];
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Create a new CAD session
     * @param {object} options - Session options
     * @returns {object} - Session information
     */
    createSession(options = {}) {
        const {
            workbench = 'mechanical-cad',
            units = 'mm',
            precision = 6,
            template = null
        } = options;

        this.activeSession = {
            id: `session_${Date.now()}`,
            workbench,
            units,
            precision,
            createdAt: new Date().toISOString(),
            featureTree: { features: [], rootBodies: [] },
            sketches: [],
            configurations: [],
            parameters: {},
            metadata: {}
        };

        // Apply template if provided
        if (template) {
            this._applyTemplate(template);
        }

        console.log(`📐 CAD session created: ${this.activeSession.id}`);
        return this.activeSession;
    }

    /**
     * Execute a parametric operation
     * @param {string} operation - Operation type
     * @param {object} params - Operation parameters
     * @returns {object} - Operation result
     */
    async executeOperation(operation, params = {}) {
        if (!this.activeSession) {
            throw new Error('No active CAD session. Call createSession() first.');
        }

        console.log(`🔧 Executing: ${operation}`);

        // Save current state for undo
        this._saveToUndoStack();

        let result;
        try {
            switch (operation) {
                // Sketch operations
                case 'create_sketch':
                    result = await this._createSketch(params);
                    break;
                case 'add_sketch_entity':
                    result = await this._addSketchEntity(params);
                    break;
                case 'constrain_sketch':
                    result = await this._constrainSketch(params);
                    break;

                // Feature operations
                case 'extrude':
                    result = await this._extrude(params);
                    break;
                case 'revolve':
                    result = await this._revolve(params);
                    break;
                case 'sweep':
                    result = await this._sweep(params);
                    break;
                case 'loft':
                    result = await this._loft(params);
                    break;
                case 'fillet':
                    result = await this._fillet(params);
                    break;
                case 'chamfer':
                    result = await this._chamfer(params);
                    break;
                case 'hole':
                    result = await this._createHole(params);
                    break;
                case 'pattern':
                    result = await this._createPattern(params);
                    break;
                case 'shell':
                    result = await this._shell(params);
                    break;
                case 'draft':
                    result = await this._addDraft(params);
                    break;

                // Boolean operations
                case 'union':
                    result = await this._booleanUnion(params);
                    break;
                case 'subtract':
                    result = await this._booleanSubtract(params);
                    break;
                case 'intersect':
                    result = await this._booleanIntersect(params);
                    break;

                // Assembly operations
                case 'add_component':
                    result = await this._addComponent(params);
                    break;
                case 'add_constraint':
                    result = await this._addConstraint(params);
                    break;

                // Modification operations
                case 'modify_parameter':
                    result = await this._modifyParameter(params);
                    break;
                case 'suppress_feature':
                    result = await this._suppressFeature(params);
                    break;
                case 'unsuppress_feature':
                    result = await this._unsuppressFeature(params);
                    break;

                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            // Record in history
            this.featureHistory.push({
                operation,
                params,
                result,
                timestamp: new Date().toISOString()
            });

            // Clear redo stack on new operation
            this.redoStack = [];

            return {
                success: true,
                operation,
                ...result
            };

        } catch (error) {
            console.error(`Operation failed: ${error.message}`);
            // Restore from undo stack if operation failed
            this._undo();
            return {
                success: false,
                operation,
                error: error.message
            };
        }
    }

    /**
     * Execute multiple operations in sequence
     * @param {array} operations - Array of {operation, params}
     * @returns {array} - Results of all operations
     */
    async executeOperationBatch(operations) {
        const results = [];
        for (const op of operations) {
            const result = await this.executeOperation(op.operation, op.params);
            results.push(result);
            if (!result.success) {
                console.warn(`Batch stopped at operation: ${op.operation}`);
                break;
            }
        }
        return results;
    }

    /**
     * Parse natural language to CAD operations
     * @param {string} prompt - Natural language command
     * @returns {array} - Array of operations to execute
     */
    async parseNaturalLanguage(prompt) {
        // Import bedrock service dynamically to avoid circular dependency
        const bedrockService = require('../bedrockService');

        const parsePrompt = `Convert this CAD command to operations:

"${prompt}"

Return JSON array of operations:
[
    {
        "operation": "create_sketch|extrude|revolve|fillet|chamfer|hole|pattern|...",
        "params": { ... operation-specific parameters ... }
    }
]

Available operations:
- create_sketch: { plane: "XY|XZ|YZ", origin: [x,y,z] }
- add_sketch_entity: { sketchId, type: "line|circle|arc|rectangle", points/center/radius, etc }
- extrude: { sketchId, distance, direction: "up|down|both", draft: degrees }
- revolve: { sketchId, axis: {point, direction}, angle }
- fillet: { edges: [...], radius }
- chamfer: { edges: [...], distance }
- hole: { position: [x,y,z], diameter, depth, type: "simple|counterbore|countersink|threaded" }
- pattern: { featureId, type: "linear|circular", count, spacing/angle }
- shell: { thickness, openFaces: [...] }

Parameters should use mm for dimensions.`;

        try {
            const response = await bedrockService.generateContent(parsePrompt);
            const operations = JSON.parse(response);
            return operations;
        } catch (error) {
            console.error('NL parsing failed:', error.message);
            return [];
        }
    }

    // ==================== Sketch Operations ====================

    async _createSketch(params) {
        const { plane = 'XY', origin = [0, 0, 0], name } = params;

        const sketch = sketchEngine.createSketch({
            plane,
            origin,
            name: name || `Sketch_${this.activeSession.sketches.length + 1}`
        });

        this.activeSession.sketches.push(sketch);
        return { sketch };
    }

    async _addSketchEntity(params) {
        const { sketchId, type, ...entityParams } = params;
        const sketch = this._getSketch(sketchId);

        let entity;
        switch (type) {
            case 'line':
                entity = sketchEngine.createLine(sketch, entityParams.start, entityParams.end);
                break;
            case 'circle':
                entity = sketchEngine.createCircle(sketch, entityParams.center, entityParams.radius);
                break;
            case 'arc':
                entity = sketchEngine.createArc(sketch, entityParams.center, entityParams.radius,
                    entityParams.startAngle, entityParams.endAngle);
                break;
            case 'rectangle':
                entity = sketchEngine.createRectangle(sketch, entityParams.corner1, entityParams.corner2);
                break;
            case 'spline':
                entity = sketchEngine.createSpline(sketch, entityParams.points);
                break;
            default:
                throw new Error(`Unknown sketch entity type: ${type}`);
        }

        return { entity };
    }

    async _constrainSketch(params) {
        const { sketchId, constraintType, entities, value } = params;
        const sketch = this._getSketch(sketchId);

        const constraint = sketchEngine.addConstraint(sketch, {
            type: constraintType,
            entities,
            value
        });

        // Solve constraints
        await parametricSolver.solveSketch(sketch);

        return { constraint, solved: true };
    }

    // ==================== Feature Operations ====================

    async _extrude(params) {
        const { sketchId, distance, direction = 'up', draft = 0, operation = 'add' } = params;
        const sketch = this._getSketch(sketchId);

        const feature = parametricEngine.createExtrude(sketch, distance, {
            direction: direction === 'down' ? -1 : (direction === 'both' ? 0 : 1),
            draft,
            operation
        });

        this._addFeature(feature);
        return { feature };
    }

    async _revolve(params) {
        const { sketchId, axis, angle = 360 } = params;
        const sketch = this._getSketch(sketchId);

        const feature = parametricEngine.createRevolve(sketch, axis, angle);
        this._addFeature(feature);
        return { feature };
    }

    async _sweep(params) {
        const { profileSketchId, pathSketchId, twist = 0, scale = 1 } = params;
        const profile = this._getSketch(profileSketchId);
        const path = this._getSketch(pathSketchId);

        const feature = parametricEngine.createSweep(profile, path, { twist, scale });
        this._addFeature(feature);
        return { feature };
    }

    async _loft(params) {
        const { profileIds, guideCurves = [], closed = false } = params;
        const profiles = profileIds.map(id => this._getSketch(id));

        const feature = parametricEngine.createLoft(profiles, { guideCurves, closed });
        this._addFeature(feature);
        return { feature };
    }

    async _fillet(params) {
        const { edges, radius, variable = false } = params;

        const feature = parametricEngine.createFillet(edges, radius, { variable });
        this._addFeature(feature);
        return { feature };
    }

    async _chamfer(params) {
        const { edges, distance, angle = null } = params;

        const options = angle ? { angle } : {};
        const feature = parametricEngine.createChamfer(edges, distance, options);
        this._addFeature(feature);
        return { feature };
    }

    async _createHole(params) {
        const { position, diameter, depth, type = 'simple', threadSpec = null } = params;

        const feature = parametricEngine.createHole(position, diameter, depth, type);
        if (threadSpec) {
            feature.thread = threadSpec;
        }
        this._addFeature(feature);
        return { feature };
    }

    async _createPattern(params) {
        const { featureId, type, count, spacing, axis = null } = params;

        const sourceFeature = this._getFeature(featureId);
        const feature = parametricEngine.createPattern(sourceFeature, type, count,
            type === 'linear' ? spacing : { angle: spacing, axis });
        this._addFeature(feature);
        return { feature };
    }

    async _shell(params) {
        const { thickness, openFaces = [] } = params;

        const feature = {
            id: this._generateId('shell'),
            type: 'shell',
            thickness,
            openFaces,
            createdAt: new Date().toISOString()
        };
        this._addFeature(feature);
        return { feature };
    }

    async _addDraft(params) {
        const { angle, faces, neutralPlane } = params;

        const feature = {
            id: this._generateId('draft'),
            type: 'draft',
            angle,
            faces,
            neutralPlane,
            createdAt: new Date().toISOString()
        };
        this._addFeature(feature);
        return { feature };
    }

    // ==================== Boolean Operations ====================

    async _booleanUnion(params) {
        const { bodies } = params;
        const result = parametricEngine.union(bodies);
        return { result };
    }

    async _booleanSubtract(params) {
        const { baseBody, toolBodies } = params;
        const result = parametricEngine.subtract(baseBody, toolBodies);
        return { result };
    }

    async _booleanIntersect(params) {
        const { bodies } = params;
        const result = parametricEngine.intersect(bodies);
        return { result };
    }

    // ==================== Assembly Operations ====================

    async _addComponent(params) {
        const { partId, position = [0, 0, 0], rotation = [0, 0, 0], name } = params;

        const component = assemblyEngine.addComponent({
            partId,
            instanceName: name,
            transform: {
                position,
                rotation
            }
        });

        return { component };
    }

    async _addConstraint(params) {
        const { type, component1, component2, geometry1, geometry2, offset = 0 } = params;

        const constraint = assemblyEngine.addConstraint({
            type,
            components: [component1, component2],
            geometry: [geometry1, geometry2],
            offset
        });

        // Solve assembly
        await assemblyEngine.solve();

        return { constraint };
    }

    // ==================== Modification Operations ====================

    async _modifyParameter(params) {
        const { featureId, parameterName, value } = params;

        const updatedTree = parametricEngine.updateParameter(
            featureId,
            parameterName,
            value,
            this.activeSession.featureTree
        );

        this.activeSession.featureTree = updatedTree;

        // Regenerate model
        await this._regenerate();

        return { featureId, parameterName, value };
    }

    async _suppressFeature(params) {
        const { featureId } = params;

        const updatedTree = parametricEngine.suppressFeature(
            featureId,
            this.activeSession.featureTree
        );

        this.activeSession.featureTree = updatedTree;
        return { featureId, suppressed: true };
    }

    async _unsuppressFeature(params) {
        const { featureId } = params;

        const updatedTree = parametricEngine.unsuppressFeature(
            featureId,
            this.activeSession.featureTree
        );

        this.activeSession.featureTree = updatedTree;
        return { featureId, unsuppressed: true };
    }

    // ==================== Configuration Management ====================

    /**
     * Create a design configuration
     */
    async createConfiguration(name, parameterOverrides = {}) {
        const config = configurationService.createConfiguration({
            name,
            baseConfig: 'default',
            overrides: parameterOverrides
        });

        this.activeSession.configurations.push(config);
        return config;
    }

    /**
     * Switch to a configuration
     */
    async activateConfiguration(configName) {
        const config = this.activeSession.configurations.find(c => c.name === configName);
        if (!config) {
            throw new Error(`Configuration not found: ${configName}`);
        }

        // Apply configuration overrides
        for (const [param, value] of Object.entries(config.overrides || {})) {
            await this._modifyParameter({
                featureId: param.split('.')[0],
                parameterName: param.split('.')[1],
                value
            });
        }

        this.activeSession.activeConfiguration = configName;
        return config;
    }

    // ==================== Utility Methods ====================

    _getSketch(sketchId) {
        const sketch = this.activeSession.sketches.find(s => s.id === sketchId);
        if (!sketch) {
            throw new Error(`Sketch not found: ${sketchId}`);
        }
        return sketch;
    }

    _getFeature(featureId) {
        const feature = this.activeSession.featureTree.features.find(f => f.id === featureId);
        if (!feature) {
            throw new Error(`Feature not found: ${featureId}`);
        }
        return feature;
    }

    _addFeature(feature) {
        this.activeSession.featureTree.features.push(feature);
    }

    _generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async _regenerate() {
        const regenerated = parametricEngine.regenerate(this.activeSession.featureTree);
        this.activeSession.featureTree = regenerated;
        return regenerated;
    }

    _applyTemplate(template) {
        // Apply template parameters and features
        this.activeSession.parameters = { ...template.parameters };
        this.activeSession.metadata = { ...template.metadata };
    }

    _saveToUndoStack() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.activeSession)));
        // Limit undo history
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
    }

    _undo() {
        if (this.undoStack.length > 0) {
            this.redoStack.push(JSON.parse(JSON.stringify(this.activeSession)));
            this.activeSession = this.undoStack.pop();
            return true;
        }
        return false;
    }

    _redo() {
        if (this.redoStack.length > 0) {
            this.undoStack.push(JSON.parse(JSON.stringify(this.activeSession)));
            this.activeSession = this.redoStack.pop();
            return true;
        }
        return false;
    }

    /**
     * Undo last operation
     */
    undo() {
        return this._undo();
    }

    /**
     * Redo last undone operation
     */
    redo() {
        return this._redo();
    }

    /**
     * Get current session state
     */
    getSessionState() {
        return this.activeSession;
    }

    /**
     * Get feature history
     */
    getHistory() {
        return this.featureHistory;
    }

    /**
     * Export session to file format
     */
    async exportSession(format = 'json') {
        switch (format) {
            case 'json':
                return JSON.stringify(this.activeSession, null, 2);
            case 'step':
                // Would integrate with STEP export service
                return { format: 'STEP', data: this.activeSession.featureTree };
            case 'iges':
                return { format: 'IGES', data: this.activeSession.featureTree };
            default:
                return this.activeSession;
        }
    }

    /**
     * Close current session
     */
    closeSession() {
        const sessionId = this.activeSession?.id;
        this.activeSession = null;
        this.featureHistory = [];
        this.undoStack = [];
        this.redoStack = [];
        console.log(`📐 CAD session closed: ${sessionId}`);
        return { sessionId, closed: true };
    }
}

module.exports = new CADIntegrationService();
