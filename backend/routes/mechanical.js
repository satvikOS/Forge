const express = require('express');
const router = express.Router();
const mechanicalDesignService = require('../services/ai/mechanicalDesignService');
const TopologyOptimizationService = require('../services/ai/topologyOptimizationService');
const parametricEngine = require('../services/cad/parametricEngine');
const sketchEngine = require('../services/cad/sketchEngine');
const assemblyEngine = require('../services/cad/assemblyEngine');
const DrawingEngine = require('../services/cad/drawingEngine');
const DrawingExportService = require('../services/cad/drawingExportService');
const SheetMetalEngine = require('../services/cad/sheetMetalEngine');
const WeldmentsEngine = require('../services/cad/weldmentsEngine');
const ConfigurationService = require('../services/cad/configurationService');
const TemplateService = require('../services/cad/templateService');
const feaService = require('../services/analysis/feaService');
const kinematicAnalysis = require('../services/analysis/kinematicAnalysisService');
const thermalAnalysis = require('../services/analysis/thermalAnalysisService');
const modalAnalysis = require('../services/analysis/modalAnalysisService');
const simulationPrep = require('../services/analysis/simulationPrepService');
const DesignRationaleService = require('../services/ai/designRationaleService');
const surfacingEngine = require('../services/cad/surfacingEngine');
const directEditEngine = require('../services/cad/directEditEngine');
const complianceService = require('../services/analysis/complianceService');
const multibodyDynamics = require('../services/analysis/multibodyDynamicsService');
const optimizationService = require('../services/ai/optimizationService');
const constraintAnalyzer = require('../services/analysis/constraintAnalyzer');
const workflowOrchestrator = require('../services/ai/workflowOrchestrator');
const reverseEngineering = require('../services/cad/reverseEngineeringService');
const parametricSolver = require('../services/cad/parametricSolver');
const brepGenerative = require('../services/ai/brepGenerativeService');
const camService = require('../services/manufacturing/camService');
const advancedPhysics = require('../services/analysis/advancedPhysicsService');
const largeAssembly = require('../services/optimization/largeAssemblyService');
const moldDesign = require('../services/manufacturing/moldDesignService');
const machiningSimulation = require('../services/manufacturing/machiningSimulationService');
const additiveManufacturing = require('../services/manufacturing/additiveManufacturingService');
const costEstimation = require('../services/manufacturing/costEstimationService');
const jigsFixtures = require('../services/manufacturing/jigsFixturesService');
const dfaMechanisms = require('../services/manufacturing/dfaMechanismsService');
const gdtService = require('../services/cad/gdtService');
const standardComponents = require('../services/cad/standardComponentService');
const bomService = require('../services/cad/bomService');
const mbdService = require('../services/cad/mbdService');
const technicalManual = require('../services/cad/technicalManualService');
const revisionControl = require('../services/cad/revisionControlService');
const jobQueue = require('../services/jobQueue');
const bedrockService = require('../services/bedrockService');

// ============ PHASE 3 SERVICES ============
const feaSimulation = require('../services/feaSimulationService');
const cfdSimulation = require('../services/cfdSimulationService');
const aiOptimization = require('../services/aiOptimizationService');

// Initialize CAD services
const drawingEngine = new DrawingEngine();
const drawingExportService = new DrawingExportService();
const sheetMetalEngine = new SheetMetalEngine();
const weldmentsEngine = new WeldmentsEngine();
const topologyOptimization = new TopologyOptimizationService(bedrockService);
const configurationService = new ConfigurationService();
const templateService = new TemplateService();
const designRationale = new DesignRationaleService(bedrockService);

/**
 * Mechanical CAD API Routes
 * RESTful endpoints for parametric CAD operations, AI design generation,
 * FEA analysis, and CAM toolpath generation
 */

// ==================== Design Generation ====================

/**
 * POST /api/mechanical/generate
 * Generate mechanical design from natural language prompt
 */
router.post('/generate', async (req, res) => {
    try {
        const { prompt, preferences = {} } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`\n🔧 Mechanical Design Generation Request`);
        console.log(`   Prompt: ${prompt}`);

        // Create async job for design generation
        const job = await jobQueue.createJob('mechanical_design', { prompt, preferences });

        // Start async processing
        processDesignGenerationJob(job.id, prompt, preferences).catch(error => {
            console.error('Error in design generation job:', error);
            jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        });

        res.json({
            success: true,
            jobId: job.id,
            message: 'Design generation started',
            status: 'queued'
        });

    } catch (error) {
        console.error('Error creating design generation job:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/generate/:jobId
 * Get status of design generation job
 */
router.get('/generate/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json({
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            result: job.result,
            error: job.error,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
        });

    } catch (error) {
        console.error('Error fetching job status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/variants/:designId
 * Get design variants for a generated design
 */
router.get('/variants/:designId', async (req, res) => {
    try {
        const { designId } = req.params;

        // In full implementation, would retrieve from database
        // For now, return mock data
        res.json({
            designId,
            variants: [],
            message: 'Variants retrieved'
        });

    } catch (error) {
        console.error('Error fetching variants:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/select-variant
 * Select a design variant to work with
 */
router.post('/select-variant', async (req, res) => {
    try {
        const { variantId, designId } = req.body;

        if (!variantId || !designId) {
            return res.status(400).json({ error: 'variantId and designId are required' });
        }

        console.log(`✅ Selected variant: ${variantId}`);

        res.json({
            success: true,
            variantId,
            message: 'Variant selected'
        });

    } catch (error) {
        console.error('Error selecting variant:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Feature Manipulation ====================

/**
 * POST /api/mechanical/feature/create
 * Create a new parametric feature
 */
router.post('/feature/create', async (req, res) => {
    try {
        const { featureType, parameters, sketchId } = req.body;

        if (!featureType) {
            return res.status(400).json({ error: 'featureType is required' });
        }

        console.log(`✨ Creating ${featureType} feature...`);

        let feature;
        switch (featureType) {
            case 'extrude':
                feature = parametricEngine.createExtrude(
                    { id: sketchId || 'sketch_1' },
                    parameters.distance,
                    parameters
                );
                break;

            case 'revolve':
                feature = parametricEngine.createRevolve(
                    { id: sketchId || 'sketch_1' },
                    parameters.axis,
                    parameters.angle
                );
                break;

            case 'fillet':
                feature = parametricEngine.createFillet(
                    parameters.edges,
                    parameters.radius,
                    parameters
                );
                break;

            case 'chamfer':
                feature = parametricEngine.createChamfer(
                    parameters.edges,
                    parameters.distance,
                    parameters
                );
                break;

            case 'hole':
                feature = parametricEngine.createHole(
                    parameters.position,
                    parameters.diameter,
                    parameters.depth,
                    parameters.holeType
                );
                break;

            default:
                return res.status(400).json({ error: `Unknown feature type: ${featureType}` });
        }

        res.json({
            success: true,
            feature,
            message: `${featureType} feature created`
        });

    } catch (error) {
        console.error('Error creating feature:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/mechanical/feature/:featureId
 * Update feature parameters
 */
router.put('/feature/:featureId', async (req, res) => {
    try {
        const { featureId } = req.params;
        const { parameterName, value, featureTree } = req.body;

        if (!parameterName || value === undefined || !featureTree) {
            return res.status(400).json({ error: 'parameterName, value, and featureTree are required' });
        }

        console.log(`✏️  Updating feature ${featureId}.${parameterName} = ${value}`);

        const updatedTree = parametricEngine.updateParameter(
            featureId,
            parameterName,
            value,
            featureTree
        );

        // Regenerate geometry
        const result = parametricEngine.regenerate(updatedTree);

        res.json({
            success: true,
            featureTree: updatedTree,
            regenerated: result,
            message: 'Feature updated'
        });

    } catch (error) {
        console.error('Error updating feature:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/mechanical/feature/:featureId
 * Delete a feature
 */
router.delete('/feature/:featureId', async (req, res) => {
    try {
        const { featureId } = req.params;
        const { featureTree } = req.body;

        if (!featureTree) {
            return res.status(400).json({ error: 'featureTree is required' });
        }

        console.log(`🗑️  Deleting feature ${featureId}`);

        // Remove feature from tree
        const updatedTree = {
            ...featureTree,
            features: featureTree.features.filter(f => f.id !== featureId)
        };

        // Regenerate geometry
        const result = parametricEngine.regenerate(updatedTree);

        res.json({
            success: true,
            featureTree: updatedTree,
            regenerated: result,
            message: 'Feature deleted'
        });

    } catch (error) {
        console.error('Error deleting feature:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/feature/regenerate
 * Regenerate all features in the feature tree
 */
router.post('/feature/regenerate', async (req, res) => {
    try {
        const { featureTree } = req.body;

        if (!featureTree) {
            return res.status(400).json({ error: 'featureTree is required' });
        }

        console.log(`🔄 Regenerating feature tree...`);

        const result = parametricEngine.regenerate(featureTree);

        res.json({
            success: true,
            result,
            message: 'Feature tree regenerated'
        });

    } catch (error) {
        console.error('Error regenerating features:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Assembly Operations ====================

/**
 * POST /api/mechanical/assembly/create
 * Create a new assembly
 */
router.post('/assembly/create', async (req, res) => {
    try {
        const { name } = req.body;

        const assembly = assemblyEngine.createAssembly(name);

        res.json({
            success: true,
            assembly,
            message: 'Assembly created'
        });

    } catch (error) {
        console.error('Error creating assembly:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/assembly/add-component
 * Add a component to an assembly
 */
router.post('/assembly/add-component', async (req, res) => {
    try {
        const { assembly, part, transform } = req.body;

        if (!assembly || !part) {
            return res.status(400).json({ error: 'assembly and part are required' });
        }

        const component = assemblyEngine.addComponent(assembly, part, transform);

        res.json({
            success: true,
            component,
            message: 'Component added'
        });

    } catch (error) {
        console.error('Error adding component:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/assembly/mate
 * Add a mate between components
 */
router.post('/assembly/mate', async (req, res) => {
    try {
        const { assembly, type, comp1Id, comp2Id, options } = req.body;

        if (!assembly || !type || !comp1Id || !comp2Id) {
            return res.status(400).json({ error: 'assembly, type, comp1Id, and comp2Id are required' });
        }

        const mate = assemblyEngine.addMate(assembly, type, comp1Id, comp2Id, options);

        // Solve mates
        const solvedAssembly = assemblyEngine.solveMates(assembly);

        res.json({
            success: true,
            mate,
            assembly: solvedAssembly,
            message: 'Mate added and solved'
        });

    } catch (error) {
        console.error('Error adding mate:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/assembly/:assemblyId/bom
 * Generate BOM for an assembly
 */
router.get('/assembly/:assemblyId/bom', async (req, res) => {
    try {
        const { assemblyId } = req.params;
        const { assembly } = req.query; // Would normally fetch from database

        if (!assembly) {
            return res.status(400).json({ error: 'assembly data is required' });
        }

        const bom = assemblyEngine.createAssemblyBOM(JSON.parse(assembly));

        res.json({
            success: true,
            bom,
            message: 'BOM generated'
        });

    } catch (error) {
        console.error('Error generating BOM:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Analysis Endpoints ====================

/**
 * POST /api/mechanical/analyze/fea
 * Run FEA structural analysis
 */
router.post('/analyze/fea', async (req, res) => {
    try {
        const { modelData, analysisOptions } = req.body;

        if (!modelData) {
            return res.status(400).json({ error: 'modelData is required' });
        }

        console.log(`🔬 Starting FEA analysis...`);

        // Create async job for FEA
        const job = await jobQueue.createJob('fea_analysis', { modelData, analysisOptions });

        // Start async processing
        processFEAJob(job.id, modelData, analysisOptions).catch(error => {
            console.error('Error in FEA job:', error);
            jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        });

        res.json({
            success: true,
            jobId: job.id,
            message: 'FEA analysis started',
            status: 'queued'
        });

    } catch (error) {
        console.error('Error starting FEA:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/analyze/motion
 * Run motion simulation
 */
router.post('/analyze/motion', async (req, res) => {
    try {
        const { assembly, duration } = req.body;

        if (!assembly) {
            return res.status(400).json({ error: 'assembly is required' });
        }

        console.log(`🎬 Running motion simulation...`);

        const results = assemblyEngine.simulateMotion(assembly, duration || 5);

        res.json({
            success: true,
            results,
            message: 'Motion simulation complete'
        });

    } catch (error) {
        console.error('Error running motion simulation:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/analyze/results/:jobId
 * Get analysis results
 */
router.get('/analyze/results/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json({
            jobId: job.id,
            status: job.status,
            results: job.result,
            error: job.error
        });

    } catch (error) {
        console.error('Error fetching analysis results:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== AI CHAT INTERFACE ====================

router.post('/ai/chat', async (req, res) => {
    try {
        const { message, conversationContext = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        console.log(`\n💬 AI Chat Command:`, message);

        // Parse the natural language command
        const parsed = await mechanicalDesign.parseNaturalLanguageCommand(message, conversationContext);

        res.json({
            success: true,
            ...parsed
        });

    } catch (error) {
        console.error('Error in AI chat:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            conversationalResponse: "I encountered an error processing your command. Please try again."
        });
    }
});

// ==================== CAM Endpoints ====================

/**
 * POST /api/mechanical/cam/generate
 * Generate CNC toolpaths
 */
router.post('/cam/generate', async (req, res) => {
    try {
        const { modelData, options } = req.body;

        if (!modelData) {
            return res.status(400).json({ error: 'modelData is required' });
        }

        console.log(`🔧 Generating toolpaths...`);

        const toolpaths = await camService.generateToolpaths(modelData, options);

        res.json({
            success: true,
            toolpaths,
            message: 'Toolpaths generated'
        });

    } catch (error) {
        console.error('Error generating toolpaths:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/cam/gcode/:jobId
 * Export G-code for toolpaths
 */
router.get('/cam/gcode/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const { toolpaths, postProcessor } = req.query;

        if (!toolpaths) {
            return res.status(400).json({ error: 'toolpaths data is required' });
        }

        console.log(`📄 Exporting G-code...`);

        const gcode = await camService.exportGCode(JSON.parse(toolpaths), { postProcessor });

        res.set('Content-Type', 'text/plain');
        res.set('Content-Disposition', `attachment; filename="toolpath_${jobId}.gcode"`);
        res.send(gcode);

    } catch (error) {
        console.error('Error exporting G-code:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/cam/simulate
 * Simulate machining process
 */
router.post('/cam/simulate', async (req, res) => {
    try {
        const { toolpaths } = req.body;

        if (!toolpaths) {
            return res.status(400).json({ error: 'toolpaths are required' });
        }

        console.log(`🎨 Simulating machining...`);

        // Simplified simulation
        const time = camService.calculateMachiningTime(toolpaths);

        res.json({
            success: true,
            estimatedTime: time,
            message: 'Machining simulation complete'
        });

    } catch (error) {
        console.error('Error simulating machining:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== 2D Drawing Generation ====================

/**
 * POST /api/mechanical/drawing/create
 * Create a new 2D drawing from a 3D model
 */
router.post('/drawing/create', async (req, res) => {
    try {
        const { model, options = {} } = req.body;

        if (!model) {
            return res.status(400).json({ error: 'model is required' });
        }

        console.log(`📐 Creating 2D drawing for model: ${model.id || model.name}`);

        const drawing = drawingEngine.createDrawing(model, options);

        res.json({
            success: true,
            drawing,
            message: 'Drawing created'
        });

    } catch (error) {
        console.error('Error creating drawing:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/drawing/:drawingId/add-view
 * Add a projection view to the drawing
 */
router.post('/drawing/:drawingId/add-view', async (req, res) => {
    try {
        const { drawingId } = req.params;
        const { viewType, position, scale } = req.body;

        if (!viewType || !position) {
            return res.status(400).json({ error: 'viewType and position are required' });
        }

        const drawing = drawingEngine.drawings.get(drawingId);
        if (!drawing) {
            return res.status(404).json({ error: 'Drawing not found' });
        }

        const view = drawingEngine.addView(drawing, viewType, position, scale);

        res.json({
            success: true,
            view,
            message: `${viewType} view added`
        });

    } catch (error) {
        console.error('Error adding view:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/drawing/:drawingId/dimension
 * Add dimension to drawing
 */
router.post('/drawing/:drawingId/dimension', async (req, res) => {
    try {
        const { drawingId } = req.params;
        const { viewId, dimensionType, parameters } = req.body;

        if (!viewId || !dimensionType) {
            return res.status(400).json({ error: 'viewId and dimensionType are required' });
        }

        const drawing = drawingEngine.drawings.get(drawingId);
        if (!drawing) {
            return res.status(404).json({ error: 'Drawing not found' });
        }

        let dimension;
        switch (dimensionType) {
            case 'linear':
                dimension = drawingEngine.addLinearDimension(
                    drawing,
                    viewId,
                    parameters.point1,
                    parameters.point2,
                    parameters.offset,
                    parameters.options
                );
                break;

            case 'radial':
            case 'diameter':
                dimension = drawingEngine.addRadialDimension(
                    drawing,
                    viewId,
                    parameters.center,
                    parameters.point,
                    { ...parameters.options, isDiameter: dimensionType === 'diameter' }
                );
                break;

            case 'angular':
                dimension = drawingEngine.addAngularDimension(
                    drawing,
                    viewId,
                    parameters.vertex,
                    parameters.line1End,
                    parameters.line2End,
                    parameters.options
                );
                break;

            case 'auto':
                // Auto-place dimensions
                const dimensions = drawingEngine.autoPlaceDimensions(drawing, viewId);
                return res.json({
                    success: true,
                    dimensions,
                    message: 'Auto dimensions added'
                });

            default:
                return res.status(400).json({ error: `Unknown dimension type: ${dimensionType}` });
        }

        res.json({
            success: true,
            dimension,
            message: 'Dimension added'
        });

    } catch (error) {
        console.error('Error adding dimension:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/drawing/:drawingId/annotate
 * Add annotation (GD&T, surface finish, note) to drawing
 */
router.post('/drawing/:drawingId/annotate', async (req, res) => {
    try {
        const { drawingId } = req.params;
        const { annotationType, parameters } = req.body;

        if (!annotationType) {
            return res.status(400).json({ error: 'annotationType is required' });
        }

        const drawing = drawingEngine.drawings.get(drawingId);
        if (!drawing) {
            return res.status(404).json({ error: 'Drawing not found' });
        }

        let annotation;
        switch (annotationType) {
            case 'gdt':
                annotation = drawingEngine.addGDT(
                    drawing,
                    parameters.viewId,
                    parameters.feature,
                    parameters.toleranceType,
                    parameters.value,
                    parameters.datum
                );
                break;

            case 'surfaceFinish':
                annotation = drawingEngine.addSurfaceFinish(
                    drawing,
                    parameters.viewId,
                    parameters.edge,
                    parameters.roughness
                );
                break;

            case 'note':
                annotation = drawingEngine.addNote(
                    drawing,
                    parameters.text,
                    parameters.position,
                    parameters.leader
                );
                break;

            default:
                return res.status(400).json({ error: `Unknown annotation type: ${annotationType}` });
        }

        res.json({
            success: true,
            annotation,
            message: 'Annotation added'
        });

    } catch (error) {
        console.error('Error adding annotation:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/drawing/:drawingId/export
 * Export drawing to PDF, DXF, SVG, or image
 */
router.get('/drawing/:drawingId/export', async (req, res) => {
    try {
        const { drawingId } = req.params;
        const { format = 'PDF', version, resolution } = req.query;

        const drawing = drawingEngine.drawings.get(drawingId);
        if (!drawing) {
            return res.status(404).json({ error: 'Drawing not found' });
        }

        console.log(`📄 Exporting drawing to ${format}...`);

        let result;
        switch (format.toUpperCase()) {
            case 'PDF':
                result = await drawingExportService.exportToPDF(drawing);
                break;

            case 'DXF':
                result = await drawingExportService.exportToDXF(drawing, version || 'R2018');
                break;

            case 'SVG':
                result = await drawingExportService.exportToSVG(drawing);
                break;

            case 'PNG':
            case 'JPEG':
                result = await drawingExportService.exportToImage(
                    drawing,
                    format,
                    parseInt(resolution) || 300
                );
                break;

            default:
                return res.status(400).json({ error: `Unsupported format: ${format}` });
        }

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('Error exporting drawing:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Sheet Metal Operations ====================

/**
 * POST /api/mechanical/sheetmetal/create-base
 * Create base sheet metal face
 */
router.post('/sheetmetal/create-base', async (req, res) => {
    try {
        const { sketch, thickness, direction } = req.body;

        if (!sketch) {
            return res.status(400).json({ error: 'sketch is required' });
        }

        const baseFace = sheetMetalEngine.createBaseFace(sketch, thickness || 1.0, direction);

        res.json({
            success: true,
            baseFace,
            message: 'Sheet metal base created'
        });

    } catch (error) {
        console.error('Error creating sheet metal base:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/sheetmetal/flange
 * Add edge flange
 */
router.post('/sheetmetal/flange', async (req, res) => {
    try {
        const { part, edgeId, options } = req.body;

        if (!part || !edgeId) {
            return res.status(400).json({ error: 'part and edgeId are required' });
        }

        const flange = sheetMetalEngine.createEdgeFlange(part, edgeId, options);

        res.json({
            success: true,
            flange,
            part,
            message: 'Edge flange added'
        });

    } catch (error) {
        console.error('Error adding flange:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/sheetmetal/fold
 * Create fold/bend
 */
router.post('/sheetmetal/fold', async (req, res) => {
    try {
        const { part, foldLineId, options } = req.body;

        if (!part || !foldLineId) {
            return res.status(400).json({ error: 'part and foldLineId are required' });
        }

        const fold = sheetMetalEngine.createFold(part, foldLineId, options);

        res.json({
            success: true,
            fold,
            message: 'Fold created'
        });

    } catch (error) {
        console.error('Error creating fold:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/sheetmetal/:partId/flat-pattern
 * Generate flat pattern for manufacturing
 */
router.get('/sheetmetal/:partId/flat-pattern', async (req, res) => {
    try {
        const { partId } = req.params;
        const { part } = req.query; // Would normally fetch from database

        if (!part) {
            return res.status(400).json({ error: 'part data is required' });
        }

        const parsedPart = JSON.parse(part);
        const flatPattern = sheetMetalEngine.generateFlatPattern(parsedPart);

        res.json({
            success: true,
            flatPattern,
            message: 'Flat pattern generated'
        });

    } catch (error) {
        console.error('Error generating flat pattern:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/sheetmetal/:partId/export-dxf
 * Export flat pattern to DXF
 */
router.get('/sheetmetal/:partId/export-dxf', async (req, res) => {
    try {
        const { partId } = req.params;
        const { flatPattern, options } = req.query;

        if (!flatPattern) {
            return res.status(400).json({ error: 'flatPattern is required' });
        }

        const parsedPattern = JSON.parse(flatPattern);
        const parsedOptions = options ? JSON.parse(options) : {};

        const dxf = sheetMetalEngine.exportFlatPatternDXF(parsedPattern, parsedOptions);

        res.set('Content-Type', 'application/dxf');
        res.set('Content-Disposition', `attachment; filename="${dxf.filename}"`);
        res.send(dxf.content);

    } catch (error) {
        console.error('Error exporting DXF:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Weldments Operations ====================

/**
 * POST /api/mechanical/weldments/structural-frame
 * Create structural frame from 3D sketch
 */
router.post('/weldments/structural-frame', async (req, res) => {
    try {
        const { sketchPath, profileType, profileSize } = req.body;

        if (!sketchPath || !profileType || !profileSize) {
            return res.status(400).json({ error: 'sketchPath, profileType, and profileSize are required' });
        }

        const frame = weldmentsEngine.createStructuralFrame(sketchPath, profileType, profileSize);

        res.json({
            success: true,
            frame,
            message: 'Structural frame created'
        });

    } catch (error) {
        console.error('Error creating structural frame:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/weldments/add-weld
 * Add weld to joint
 */
router.post('/weldments/add-weld', async (req, res) => {
    try {
        const { frame, jointId, weldType, options } = req.body;

        if (!frame || !jointId || !weldType) {
            return res.status(400).json({ error: 'frame, jointId, and weldType are required' });
        }

        const weld = weldmentsEngine.addWeld(frame, jointId, weldType, options);

        res.json({
            success: true,
            weld,
            frame,
            message: 'Weld added'
        });

    } catch (error) {
        console.error('Error adding weld:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/weldments/:frameId/cut-list
 * Generate cut list for manufacturing
 */
router.get('/weldments/:frameId/cut-list', async (req, res) => {
    try {
        const { frameId } = req.params;
        const { frame } = req.query; // Would normally fetch from database

        if (!frame) {
            return res.status(400).json({ error: 'frame data is required' });
        }

        const parsedFrame = JSON.parse(frame);
        const cutList = weldmentsEngine.generateCutList(parsedFrame);

        res.json({
            success: true,
            cutList,
            message: 'Cut list generated'
        });

    } catch (error) {
        console.error('Error generating cut list:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/weldments/gusset
 * Create gusset plate at joint
 */
router.post('/weldments/gusset', async (req, res) => {
    try {
        const { frame, jointId, options } = req.body;

        if (!frame || !jointId) {
            return res.status(400).json({ error: 'frame and jointId are required' });
        }

        const gusset = weldmentsEngine.createGusset(frame, jointId, options);

        res.json({
            success: true,
            gusset,
            message: 'Gusset plate created'
        });

    } catch (error) {
        console.error('Error creating gusset:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/weldments/end-cap
 * Create end cap on structural member
 */
router.post('/weldments/end-cap', async (req, res) => {
    try {
        const { frame, segmentId, capType } = req.body;

        if (!frame || !segmentId) {
            return res.status(400).json({ error: 'frame and segmentId are required' });
        }

        const endCap = weldmentsEngine.createEndCap(frame, segmentId, capType);

        res.json({
            success: true,
            endCap,
            message: 'End cap created'
        });

    } catch (error) {
        console.error('Error creating end cap:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== AI Optimization Operations ====================

/**
 * POST /api/mechanical/optimize/topology
 * Run topology optimization on part
 */
router.post('/optimize/topology', async (req, res) => {
    try {
        const { part, options } = req.body;

        if (!part) {
            return res.status(400).json({ error: 'part is required' });
        }

        console.log(`🧠 Starting topology optimization...`);

        const optimization = await topologyOptimization.optimizePart(part, options);

        res.json({
            success: true,
            optimization,
            message: 'Topology optimization completed'
        });

    } catch (error) {
        console.error('Error in topology optimization:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/optimize/generative
 * Generate design alternatives using AI
 */
router.post('/optimize/generative', async (req, res) => {
    try {
        const { requirements, count } = req.body;

        if (!requirements) {
            return res.status(400).json({ error: 'requirements are required' });
        }

        console.log(`🧠 Generating ${count || 5} design alternatives...`);

        const alternatives = await topologyOptimization.generateDesignAlternatives(
            requirements,
            count || 5
        );

        res.json({
            success: true,
            alternatives,
            count: alternatives.length,
            message: 'Design alternatives generated'
        });

    } catch (error) {
        console.error('Error generating alternatives:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/optimize/lattice
 * Generate lattice structure
 */
router.post('/optimize/lattice', async (req, res) => {
    try {
        const { region, cellType } = req.body;

        if (!region) {
            return res.status(400).json({ error: 'region is required' });
        }

        const lattice = topologyOptimization.generateLattice(region, cellType);

        res.json({
            success: true,
            lattice,
            message: 'Lattice structure generated'
        });

    } catch (error) {
        console.error('Error generating lattice:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/optimize/dfm
 * Analyze design for manufacturability
 */
router.post('/optimize/dfm', async (req, res) => {
    try {
        const { part, manufacturingMethod } = req.body;

        if (!part || !manufacturingMethod) {
            return res.status(400).json({ error: 'part and manufacturingMethod are required' });
        }

        console.log(`🔍 Analyzing DFM for ${manufacturingMethod}...`);

        const dfmAnalysis = await topologyOptimization.analyzeDFM(part, manufacturingMethod);

        res.json({
            success: true,
            dfm: dfmAnalysis,
            message: 'DFM analysis completed'
        });

    } catch (error) {
        console.error('Error in DFM analysis:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Configuration Management ====================

/**
 * POST /api/mechanical/config/create
 * Create new configuration
 */
router.post('/config/create', async (req, res) => {
    try {
        const { model, configName, parameters } = req.body;

        if (!model || !configName) {
            return res.status(400).json({ error: 'model and configName are required' });
        }

        const config = configurationService.createConfiguration(model, configName, parameters);

        res.json({
            success: true,
            config,
            message: 'Configuration created'
        });

    } catch (error) {
        console.error('Error creating configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/config/design-table
 * Create design table
 */
router.post('/config/design-table', async (req, res) => {
    try {
        const { model, options } = req.body;

        if (!model) {
            return res.status(400).json({ error: 'model is required' });
        }

        const table = configurationService.createDesignTable(model, options);

        res.json({
            success: true,
            table,
            message: 'Design table created'
        });

    } catch (error) {
        console.error('Error creating design table:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/config/switch
 * Switch active configuration
 */
router.post('/config/switch', async (req, res) => {
    try {
        const { modelId, configId } = req.body;

        if (!modelId || !configId) {
            return res.status(400).json({ error: 'modelId and configId are required' });
        }

        const result = configurationService.switchConfiguration(modelId, configId);

        res.json(result);

    } catch (error) {
        console.error('Error switching configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/mechanical/config/:modelId/list
 * Get all configurations for model
 */
router.get('/config/:modelId/list', async (req, res) => {
    try {
        const { modelId } = req.params;

        const configs = configurationService.getConfigurations(modelId);

        res.json({
            success: true,
            configurations: configs,
            count: configs.length
        });

    } catch (error) {
        console.error('Error listing configurations:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mechanical/config/table/import
 * Import design table from CSV/Excel
 */
router.post('/config/table/import', async (req, res) => {
    try {
        const { tableId, fileData, format } = req.body;

        if (!tableId || !fileData) {
            return res.status(400).json({ error: 'tableId and fileData are required' });
        }

        const result = await configurationService.importDesignTable(tableId, fileData, format);

        res.json(result);

    } catch (error) {
        console.error('Error importing design table:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /apiapi/mechanical/config/table/:tableId/export
 * Export design table to CSV
 */
router.get('/config/table/:tableId/export', async (req, res) => {
    try {
        const { tableId } = req.params;

        const result = configurationService.exportDesignTableCSV(tableId);

        res.set('Content-Type', result.mimeType);
        res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);

    } catch (error) {
        console.error('Error exporting design table:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Async Job Processors ====================

async function processDesignGenerationJob(jobId, prompt, preferences) {
    try {
        await jobQueue.updateJob(jobId, {
            status: 'processing',
            progress: 10,
            message: 'Analyzing prompt...'
        });

        // Generate design
        const result = await mechanicalDesignService.processDesignRequest(prompt, preferences);

        await jobQueue.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result,
            message: 'Design generation complete'
        });

    } catch (error) {
        throw error;
    }
}

async function processFEAJob(jobId, modelData, analysisOptions) {
    try {
        await jobQueue.updateJob(jobId, {
            status: 'processing',
            progress: 20,
            message: 'Running FEA analysis...'
        });

        const results = await feaService.analyze(modelData, analysisOptions);

        await jobQueue.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result: results,
            message: 'FEA analysis complete'
        });

    } catch (error) {
        throw error;
    }
}

// ===================================================================
// TEMPLATES & STANDARDS ROUTES
// ===================================================================

/**
 * List available templates
 * GET /api/mechanical/templates
 */
router.get('/templates', async (req, res) => {
    try {
        const { type, standard } = req.query;
        const templates = templateService.listTemplates(type, standard);

        res.json({
            success: true,
            templates: templates,
            count: templates.length
        });
    } catch (error) {
        console.error('Error listing templates:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get template details
 * GET /api/mechanical/templates/:templateId
 */
router.get('/templates/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const template = templateService.getTemplate(templateId);
        const preview = templateService.getTemplatePreview(templateId);

        res.json({
            success: true,
            template: template,
            preview: preview
        });
    } catch (error) {
        console.error('Error getting template:', error);
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create model from template
 * POST /api/mechanical/templates/:templateId/create
 */
router.post('/templates/:templateId/create', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { customParameters } = req.body;

        const model = templateService.createFromTemplate(templateId, customParameters);

        res.json({
            success: true,
            model: model,
            message: `Model created from template: ${templateId}`
        });
    } catch (error) {
        console.error('Error creating from template:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create custom template
 * POST /api/mechanical/templates/custom
 */
router.post('/templates/custom', async (req, res) => {
    try {
        const { name, baseTemplateId, customizations } = req.body;

        const customTemplate = templateService.createCustomTemplate(
            name,
            baseTemplateId,
            customizations
        );

        const saved = templateService.saveToLibrary(customTemplate, 'custom');

        res.json({
            success: true,
            template: customTemplate,
            saved: saved
        });
    } catch (error) {
        console.error('Error creating custom template:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===================================================================
// ADVANCED ANALYSIS ROUTES
// ===================================================================

/**
 * Define kinematic joint
 * POST /api/mechanical/analysis/kinematic/joint
 */
router.post('/analysis/kinematic/joint', async (req, res) => {
    try {
        const jointData = req.body;
        const joint = kinematicAnalysis.defineJoint(jointData);

        res.json({
            success: true,
            joint: joint
        });
    } catch (error) {
        console.error('Error defining joint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Simulate motion
 * POST /api/mechanical/analysis/kinematic/simulate
 */
router.post('/analysis/kinematic/simulate', async (req, res) => {
    try {
        const { joints, duration, timeSteps } = req.body;
        const results = await kinematicAnalysis.simulateMotion(joints, duration, timeSteps);

        res.json({
            success: true,
            results: results
        });
    } catch (error) {
        console.error('Error simulating motion:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Analyze mechanism degrees of freedom
 * POST /api/mechanical/analysis/kinematic/dof
 */
router.post('/analysis/kinematic/dof', async (req, res) => {
    try {
        const assembly = req.body;
        const analysis = kinematicAnalysis.analyzeMechanismDoF(assembly);

        res.json({
            success: true,
            analysis: analysis
        });
    } catch (error) {
        console.error('Error analyzing DoF:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Run thermal analysis
 * POST /api/mechanical/analysis/thermal
 */
router.post('/analysis/thermal', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const results = await thermalAnalysis.analyze(modelData, options);

        res.json({
            success: true,
            results: results
        });
    } catch (error) {
        console.error('Error in thermal analysis:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Run modal analysis
 * POST /api/mechanical/analysis/modal
 */
router.post('/analysis/modal', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const results = await modalAnalysis.analyze(modelData, options);

        res.json({
            success: true,
            results: results
        });
    } catch (error) {
        console.error('Error in modal analysis:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Export motion animation
 * POST /api/mechanical/analysis/kinematic/export
 */
router.post('/analysis/kinematic/export', async (req, res) => {
    try {
        const { trajectory, format } = req.body;
        const animation = kinematicAnalysis.exportMotionAnimation(trajectory, format);

        res.json({
            success: true,
            animation: animation,
            format: format
        });
    } catch (error) {
        console.error('Error exporting animation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===================================================================
// SIMULATION PREPARATION & DESIGN RATIONALE ROUTES
// ===================================================================

/**
 * Prepare model for simulation
 * POST /api/mechanical/simulation/prepare
 */
router.post('/simulation/prepare', async (req, res) => {
    try {
        const { modelData, analysisType, options } = req.body;
        const prepared = await simulationPrep.prepareForSimulation(modelData, analysisType, options);

        res.json({
            success: true,
            prepared: prepared
        });
    } catch (error) {
        console.error('Error preparing simulation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Explain design rationale
 * POST /api/mechanical/rationale/explain
 */
router.post('/rationale/explain', async (req, res) => {
    try {
        const { modelData, context } = req.body;
        const rationale = await designRationale.explainDesign(modelData, context);

        res.json({
            success: true,
            rationale: rationale
        });
    } catch (error) {
        console.error('Error explaining design:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Explain material choice
 * POST /api/mechanical/rationale/material
 */
router.post('/rationale/material', async (req, res) => {
    try {
        const { modelData, material } = req.body;
        const explanation = await designRationale.explainMaterialChoice(modelData, material);

        res.json({
            success: true,
            explanation: explanation
        });
    } catch (error) {
        console.error('Error explaining material:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate FMEA
 * POST /api/mechanical/rationale/fmea
 */
router.post('/rationale/fmea', async (req, res) => {
    try {
        const { modelData } = req.body;
        const fmea = await designRationale.generateFMEA(modelData);

        res.json({
            success: true,
            fmea: fmea
        });
    } catch (error) {
        console.error('Error generating FMEA:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Explain compliance
 * POST /api/mechanical/rationale/compliance
 */
router.post('/rationale/compliance', async (req, res) => {
    try {
        const { modelData, standards } = req.body;
        const compliance = await designRationale.explainCompliance(modelData, standards);

        res.json({
            success: true,
            compliance: compliance
        });
    } catch (error) {
        console.error('Error explaining compliance:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===================================================================
// SURFACING, DIRECT  EDIT & COMPLIANCE ROUTES
// ===================================================================

/**
 * Create lofted surface
 * POST /api/mechanical/surface/loft
 */
router.post('/surface/loft', async (req, res) => {
    try {
        const { profiles, options } = req.body;
        const surface = await surfacingEngine.createLoftedSurface(profiles, options);

        res.json({
            success: true,
            surface: surface
        });
    } catch (error) {
        console.error('Error creating lofted surface:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create swept surface
 * POST /api/mechanical/surface/sweep
 */
router.post('/surface/sweep', async (req, res) => {
    try {
        const { profile, path, options } = req.body;
        const surface = await surfacingEngine.createSweptSurface(profile, path, options);

        res.json({
            success: true,
            surface: surface
        });
    } catch (error) {
        console.error('Error creating swept surface:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create blend surface
 * POST /api/mechanical/surface/blend
 */
router.post('/surface/blend', async (req, res) => {
    try {
        const { surface1, surface2, options } = req.body;
        const blend = await surfacingEngine.createBlendSurface(surface1, surface2, options);

        res.json({
            success: true,
            surface: blend
        });
    } catch (error) {
        console.error('Error creating blend surface:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Analyze surface curvature
 * POST /api/mechanical/surface/curvature
 */
router.post('/surface/curvature', async (req, res) => {
    try {
        const { surface, analysisType } = req.body;
        const analysis = surfacingEngine.analyzeCurvature(surface, analysisType);

        res.json({
            success: true,
            analysis: analysis
        });
    } catch (error) {
        console.error('Error analyzing curvature:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate zebra stripes
 * POST /api/mechanical/surface/zebra
 */
router.post('/surface/zebra', async (req, res) => {
    try {
        const { surface, lightDirection } = req.body;
        const stripes = surfacingEngine.generateZebraStripes(surface, lightDirection);

        res.json({
            success: true,
            stripes: stripes
        });
    } catch (error) {
        console.error('Error generating zebra stripes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Push/Pull face (direct edit)
 * POST /api/mechanical/direct/pushpull
 */
router.post('/direct/pushpull', async (req, res) => {
    try {
        const { model, faceId, distance, options } = req.body;
        const result = directEditEngine.pushPullFace(model, faceId, distance, options);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error in push/pull:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Move face (direct edit)
 * POST /api/mechanical/direct/moveface
 */
router.post('/direct/moveface', async (req, res) => {
    try {
        const { model, faceId, translation, options } = req.body;
        const result = directEditEngine.moveFace(model, faceId, translation, options);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error moving face:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Recognize features (direct edit)
 * POST /api/mechanical/direct/recognize
 */
router.post('/direct/recognize', async (req, res) => {
    try {
        const { model } = req.body;
        const recognized = await directEditEngine.recognizeFeatures(model);

        res.json({
            success: true,
            recognized: recognized
        });
    } catch (error) {
        console.error('Error recognizing features:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify ISO tolerances
 * POST /api/mechanical/compliance/iso
 */
router.post('/compliance/iso', async (req, res) => {
    try {
        const { modelData, tolerances } = req.body;
        const result = await complianceService.verifyISOTolerances(modelData, tolerances);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error verifying ISO compliance:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify safety standards
 * POST /api/mechanical/compliance/safety
 */
router.post('/compliance/safety', async (req, res) => {
    try {
        const { modelData, standards } = req.body;
        const result = await complianceService.verifySafetyStandards(modelData, standards);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error verifying safety standards:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify RoHS compliance
 * POST /api/mechanical/compliance/rohs
 */
router.post('/compliance/rohs', async (req, res) => {
    try {
        const { modelData, materials } = req.body;
        const result = await complianceService.verifyRoHS(modelData, materials);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error verifying RoHS:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate compliance report
 * POST /api/mechanical/compliance/report
 */
router.post('/compliance/report', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const report = await complianceService.generateComplianceReport(modelData, options);

        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('Error generating compliance report:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enhanced FEA routes
router.post('/analysis/fea/dynamic', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const mesh = feaService.generateMesh(modelData.geometry, options.meshSize);
        const material = feaService.materials[options.material];
        const results = await feaService.dynamicAnalysis(mesh, material, options.loads, options.constraints, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/fea/contacts', async (req, res) => {
    try {
        const { assembly } = req.body;
        const contacts = feaService.detectContacts(assembly);
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/fea/stress-concentrations', async (req, res) => {
    try {
        const { stresses, threshold } = req.body;
        const concentrations = feaService.identifyStressConcentrations(stresses, threshold);
        res.json({ success: true, concentrations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Multibody Dynamics routes
router.post('/analysis/multibody/actuator', async (req, res) => {
    try {
        const actuator = multibodyDynamics.defineActuator(req.body);
        res.json({ success: true, actuator });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/multibody/motion', async (req, res) => {
    try {
        const { system, simulationParams } = req.body;
        const results = await multibodyDynamics.analyzeMotion(system, simulationParams);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/multibody/gear-train', async (req, res) => {
    try {
        const { gearTrain, input } = req.body;
        const results = multibodyDynamics.analyzeGearTrain(gearTrain, input);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Optimization routes
router.post('/optimization/parameter-variation', async (req, res) => {
    try {
        const { design, variationParams } = req.body;
        const results = await optimizationService.parameterVariation(design, variationParams);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/optimization/ai-optimize', async (req, res) => {
    try {
        const { design, optimizationParams } = req.body;
        const results = await optimizationService.aiOptimization(design, optimizationParams);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/optimization/tradeoff', async (req, res) => {
    try {
        const { designs, objectives } = req.body;
        const results = await optimizationService.tradeoffAnalysis(designs, objectives);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Constraint Analyzer routes
router.post('/analysis/constraints/sketch', async (req, res) => {
    try {
        const { sketch } = req.body;
        const analysis = constraintAnalyzer.analyzeSketchConstraints(sketch);
        res.json({ success: true, analysis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/constraints/assembly-dof', async (req, res) => {
    try {
        const { assembly } = req.body;
        const analysis = constraintAnalyzer.analyzeAssemblyDOF(assembly);
        res.json({ success: true, analysis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/constraints/verify-fea', async (req, res) => {
    try {
        const { feaModel } = req.body;
        const verification = constraintAnalyzer.verifyFEASupports(feaModel);
        res.json({ success: true, verification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/constraints/mobility', async (req, res) => {
    try {
        const { assembly } = req.body;
        const patterns = constraintAnalyzer.identifyMobilityPatterns(assembly);
        res.json({ success: true, patterns });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mesh Quality routes
router.post('/simulation/mesh/quality-metrics', async (req, res) => {
    try {
        const { mesh } = req.body;
        const metrics = simulationPrep.calculateMeshQualityMetrics(mesh);
        res.json({ success: true, metrics });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/simulation/mesh/refine', async (req, res) => {
    try {
        const { mesh, refinementAreas } = req.body;
        const refinedMesh = simulationPrep.applyLocalRefinement(mesh, refinementAreas);
        res.json({ success: true, mesh: refinedMesh });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/simulation/mesh/adaptive', async (req, res) => {
    try {
        const { mesh, solutionResults, targetError } = req.body;
        const result = simulationPrep.adaptiveMeshing(mesh, solutionResults, targetError);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Workflow Orchestrator routes
router.post('/workflow/orchestrate', async (req, res) => {
    try {
        const { description, context } = req.body;
        const result = await workflowOrchestrator.orchestrateWorkflow(description, context);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/workflow/status/:workflowId', async (req, res) => {
    try {
        const { workflowId } = req.params;
        const status = workflowOrchestrator.getWorkflowStatus(workflowId);
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/workflow/templates', async (req, res) => {
    try {
        const templates = workflowOrchestrator.getTemplates();
        res.json({ success: true, templates });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/workflow/templates', async (req, res) => {
    try {
        const template = workflowOrchestrator.createTemplate(req.body);
        res.json({ success: true, template });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reverse Engineering routes
router.post('/cad/reverse-engineering/import-scan', async (req, res) => {
    try {
        const { scanData, options } = req.body;
        const scan = await reverseEngineering.importScan(scanData, options);
        res.json({ success: true, scan });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cad/reverse-engineering/detect-features', async (req, res) => {
    try {
        const { scan, options } = req.body;
        const features = await reverseEngineering.detectFeatures(scan, options);
        res.json({ success: true, features });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cad/reverse-engineering/reconstruct', async (req, res) => {
    try {
        const { scan, features, options } = req.body;
        const model = await reverseEngineering.reconstructModel(scan, features, options);
        res.json({ success: true, model });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cad/reverse-engineering/deviation', async (req, res) => {
    try {
        const { scan, cadModel } = req.body;
        const analysis = reverseEngineering.analyzeDeviation(scan, cadModel);
        res.json({ success: true, analysis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parametric Solver routes
router.post('/cad/parametric/update-parameter', async (req, res) => {
    try {
        const { modelId, parameterName, newValue } = req.body;
        const result = await parametricSolver.updateParameter(modelId, parameterName, newValue);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/cad/parametric/dependencies/:modelId', async (req, res) => {
    try {
        const { modelId } = req.params;
        const graph = parametricSolver.getDependencyGraph(modelId);
        res.json({ success: true, graph });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cad/parametric/validate-edit', async (req, res) => {
    try {
        const { modelId, parameterName, newValue } = req.body;
        const validation = parametricSolver.validateEdit(modelId, parameterName, newValue);
        res.json({ success: true, ...validation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cad/parametric/link-parameters', async (req, res) => {
    try {
        const { modelId, linkSpec } = req.body;
        const result = parametricSolver.linkParameters(modelId, linkSpec);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// B-rep Generative routes
router.post('/ai/brep/generate', async (req, res) => {
    try {
        const { prompt, options } = req.body;
        const model = await brepGenerative.generateBRep(prompt, options);
        res.json({ success: true, model });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ai/brep/add-feature', async (req, res) => {
    try {
        const { existingModel, featureDescription } = req.body;
        const model = await brepGenerative.addFeature(existingModel, featureDescription);
        res.json({ success: true, model });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ai/brep/style-transfer', async (req, res) => {
    try {
        const { sourceModel, targetStyle } = req.body;
        const model = await brepGenerative.styleTransfer(sourceModel, targetStyle);
        res.json({ success: true, model });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ai/brep/variations', async (req, res) => {
    try {
        const { baseModel, options } = req.body;
        const variations = await brepGenerative.generateVariations(baseModel, options);
        res.json({ success: true, variations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADVANCED PHYSICS & ANALYSIS (GROUP 1) ====================

router.post('/analysis/fatigue', async (req, res) => {
    try {
        const { modelData, loadHistory, options } = req.body;
        const results = await advancedPhysics.fatigueAnalysis(modelData, loadHistory, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/nonlinear-fea', async (req, res) => {
    try {
        const { mesh, material, loads, constraints, options } = req.body;
        const results = await advancedPhysics.nonlinearAnalysis(mesh, material, loads, constraints, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/buckling', async (req, res) => {
    try {
        const { mesh, material, loads, constraints, options } = req.body;
        const results = await advancedPhysics.bucklingAnalysis(mesh, material, loads, constraints, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/analysis/export-motion-loads', async (req, res) => {
    try {
        const { multibodyResults, targetTime, options } = req.body;
        const loadCase = advancedPhysics.exportMotionLoadsToFEA(multibodyResults, targetTime, options);
        res.json({ success: true, loadCase });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== LARGE ASSEMBLY & MOLD DESIGN (GROUP 2) ====================

router.post('/assembly/optimize', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const optimizations = await largeAssembly.optimizeAssembly(assemblyData, options);
        res.json({ success: true, optimizations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/assembly/simplify', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const results = largeAssembly.simplifyStructure(assemblyData, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/assembly/lightweight-reps', async (req, res) => {
    try {
        const { parts, options } = req.body;
        const results = largeAssembly.generateLightweightReps(parts, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/assembly/substitutes', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const results = largeAssembly.createSubstituteComponents(assemblyData, options);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mold/draft-analysis', async (req, res) => {
    try {
        const { modelData, pullDirection, options } = req.body;
        const analysis = await moldDesign.analyzeDraft(modelData, pullDirection, options);
        res.json({ success: true, analysis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mold/parting-line', async (req, res) => {
    try {
        const { modelData, pullDirection, options } = req.body;
        const result = await moldDesign.detectPartingLine(modelData, pullDirection, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mold/core-cavity', async (req, res) => {
    try {
        const { modelData, partingLine, options } = req.body;
        const result = await moldDesign.generateCoreCavity(modelData, partingLine, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mold/ejector-pins', async (req, res) => {
    try {
        const { modelData, coreCavity, options } = req.body;
        const result = await moldDesign.calculateEjectorPins(modelData, coreCavity, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mold/mold-base', async (req, res) => {
    try {
        const { coreCavity, options } = req.body;
        const result = await moldDesign.integrateMoldBase(coreCavity, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== COMPREHENSIVE CAM (GROUP 4) ====================

router.post('/cam/5-axis-toolpath', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const result = await camService.generate5AxisToolpath(modelData, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cam/turning-toolpath', async (req, res) => {
    try {
        const { profileData, options } = req.body;
        const result = await camService.generateTurningToolpath(profileData, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cam/adaptive-toolpath', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const result = camService.generateAdaptiveToolpath(modelData, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cam/postprocess', async (req, res) => {
    try {
        const { toolpaths, machine, options } = req.body;
        const result = camService.exportWithPostProcessor(toolpaths, machine, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADDITIVE MANUFACTURING (GROUP 5) ====================

router.post('/additive/optimize-orientation', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const result = await additiveManufacturing.optimizePrintOrientation(modelData, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/additive/generate-supports', async (req, res) => {
    try {
        const { modelData, orientation, options } = req.body;
        const supports = await additiveManufacturing.generateSupports(modelData, orientation, options);
        res.json({ success: true, supports });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/additive/slice', async (req, res) => {
    try {
        const { modelData, printer, options } = req.body;
        const result = await additiveManufacturing.sliceModel(modelData, printer, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/additive/nest-parts', async (req, res) => {
    try {
        const { parts, buildVolume, options } = req.body;
        const result = additiveManufacturing.nestParts(parts, buildVolume, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MACHINING SIMULATION (GROUP 6) ====================

router.post('/simulation/material-removal', async (req, res) => {
    try {
        const { stockModel, toolpaths, options } = req.body;
        const simulation = await machiningSimulation.simulateMaterialRemoval(stockModel, toolpaths, options);
        res.json({ success: true, simulation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/simulation/collision-detection', async (req, res) => {
    try {
        const { toolpaths, machine, workholding, options } = req.body;
        const result = await machiningSimulation.detectCollisions(toolpaths, machine, workholding, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}); router.post('/simulation/kinematics', async (req, res) => {
    try {
        const { toolpath, machine, options } = req.body;
        const result = machiningSimulation.simulateKinematics(toolpath, machine, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/simulation/cycle-time', async (req, res) => {
    try {
        const { toolpaths, machine, options } = req.body;
        const result = machiningSimulation.estimateCycleTime(toolpaths, machine, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== COST ESTIMATION (GROUP 7) ====================

router.post('/cost/machining', async (req, res) => {
    try {
        const { partData, toolpaths, options } = req.body;
        const estimate = await costEstimation.estimateMachiningCost(partData, toolpaths, options);
        res.json({ success: true, estimate });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cost/additive', async (req, res) => {
    try {
        const { partData, printSettings, options } = req.body;
        const estimate = await costEstimation.estimateAdditiveCost(partData, printSettings, options);
        res.json({ success: true, estimate });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cost/assembly', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const estimate = await costEstimation.estimateAssemblyCost(assemblyData, options);
        res.json({ success: true, estimate });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cost/compare-methods', async (req, res) => {
    try {
        const { partData, options } = req.body;
        const comparison = await costEstimation.compareManufacturingMethods(partData, options);
        res.json({ success: true, comparison });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== JIGS & FIXTURES (GROUP 8) ====================

router.post('/fixtures/machining', async (req, res) => {
    try {
        const { partData, machiningSetup, options } = req.body;
        const fixture = await jigsFixtures.generateMachiningFixture(partData, machiningSetup, options);
        res.json({ success: true, fixture });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/fixtures/assembly', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const jig = await jigsFixtures.generateAssemblyJig(assemblyData, options);
        res.json({ success: true, jig });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/fixtures/validate', async (req, res) => {
    try {
        const { fixture, machiningForces, options } = req.body;
        const validation = jigsFixtures.validateFixtureDesign(fixture, machiningForces, options);
        res.json({ success: true, validation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DFA & MECHANISMS (GROUP 8) ====================

router.post('/dfa/plan-sequence', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const sequence = await dfaMechanisms.planAssemblySequence(assemblyData, options);
        res.json({ success: true, sequence });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/dfa/check-interferences', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const interferences = await dfaMechanisms.checkAssemblyInterferences(assemblyData, options);
        res.json({ success: true, interferences });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/dfa/route-cables', async (req, res) => {
    try {
        const { assemblyData, cableSpecs, options } = req.body;
        const routes = await dfaMechanisms.routeCables(assemblyData, cableSpecs, options);
        res.json({ success: true, routes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mechanisms/design', async (req, res) => {
    try {
        const { motionRequirements, options } = req.body;
        const mechanism = await dfaMechanisms.designMechanism(motionRequirements, options);
        res.json({ success: true, mechanism });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== GD&T & TOLERANCE INTEGRATION (PHASE 1) ====================

router.post('/gdt/add-annotation', async (req, res) => {
    try {
        const { modelData, annotationSpec } = req.body;
        const annotation = await gdtService.addGDTAnnotation(modelData, annotationSpec);
        res.json({ success: true, annotation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/gdt/verify-compliance', async (req, res) => {
    try {
        const { modelData, standard } = req.body;
        const compliance = await gdtService.verifyGDTCompliance(modelData, standard);
        res.json({ success: true, compliance });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/gdt/adjust-cam', async (req, res) => {
    try {
        const { toolpaths, gdtAnnotations } = req.body;
        const adjustments = gdtService.adjustCAMForTolerances(toolpaths, gdtAnnotations);
        res.json({ success: true, adjustments });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/gdt/process-plan', async (req, res) => {
    try {
        const { modelData, gdtAnnotations } = req.body;
        const processPlan = gdtService.generateProcessPlan(modelData, gdtAnnotations);
        res.json({ success: true, processPlan });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== STANDARD COMPONENTS (PHASE 1) ====================

router.post('/components/search', async (req, res) => {
    try {
        const { specifications } = req.body;
        const results = standardComponents.searchComponents(specifications);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/components/suggest-replacement', async (req, res) => {
    try {
        const { customPart, options } = req.body;
        const suggestions = await standardComponents.suggestStandardReplacement(customPart, options);
        res.json({ success: true, suggestions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/components/supplier-info/:partNumber/:vendor', async (req, res) => {
    try {
        const { partNumber, vendor } = req.params;
        const info = standardComponents.getSupplierInfo(partNumber, vendor);
        res.json({ success: true, info });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== BOM GENERATION (PHASE 2) ====================

router.post('/bom/hierarchical', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const bom = await bomService.generateHierarchicalBOM(assemblyData, options);
        res.json({ success: true, bom });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bom/flat', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const bom = await bomService.generateFlatBOM(assemblyData, options);
        res.json({ success: true, bom });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bom/export', async (req, res) => {
    try {
        const { bom, format } = req.body;
        const exported = await bomService.exportBOM(bom, format);
        res.json({ success: true, exported });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bom/configuration', async (req, res) => {
    try {
        const { assemblyData, configurationName } = req.body;
        const bom = await bomService.generateConfigurationBOM(assemblyData, configurationName);
        res.json({ success: true, bom });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bom/add-to-drawing', async (req, res) => {
    try {
        const { drawingData, bom, placement } = req.body;
        const table = bomService.addBOMToDrawing(drawingData, bom, placement);
        res.json({ success: true, table });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MODEL-BASED DEFINITION (PHASE 2) ====================

router.post('/mbd/embed-pmi', async (req, res) => {
    try {
        const { modelData, pmiData } = req.body;
        const pmi = await mbdService.embedPMI(modelData, pmiData);
        res.json({ success: true, pmi });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mbd/generate-3d-spec', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const specification = await mbdService.generate3DSpecification(modelData, options);
        res.json({ success: true, specification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mbd/qr-code', async (req, res) => {
    try {
        const { modelData, options } = req.body;
        const qrCode = await mbdService.generateQRCode(modelData, options);
        res.json({ success: true, qrCode });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/mbd/shop-floor-access', async (req, res) => {
    try {
        const { modelData, qrCode } = req.body;
        const accessConfig = await mbdService.setupShopFloorAccess(modelData, qrCode);
        res.json({ success: true, accessConfig });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== TECHNICAL MANUALS (PHASE 2) ====================

router.post('/manual/exploded-view', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const explodedView = await technicalManual.generateExplodedView(assemblyData, options);
        res.json({ success: true, explodedView });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/manual/assembly-instructions', async (req, res) => {
    try {
        const { assemblyData, options } = req.body;
        const instructions = await technicalManual.generateAssemblyInstructions(assemblyData, options);
        res.json({ success: true, instructions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/manual/pdf-booklet', async (req, res) => {
    try {
        const { content, options } = req.body;
        const pdf = await technicalManual.generatePDFBooklet(content, options);
        res.json({ success: true, pdf });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/manual/service-manual', async (req, res) => {
    try {
        const { productData } = req.body;
        const serviceManual = await technicalManual.generateServiceManual(productData);
        res.json({ success: true, serviceManual });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== REVISION CONTROL (PHASE 2) ====================

router.post('/revision/create', async (req, res) => {
    try {
        const { modelData, changes, options } = req.body;
        const revision = await revisionControl.createRevision(modelData, changes, options);
        res.json({ success: true, revision });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/revision/request-approval', async (req, res) => {
    try {
        const { revision, approvers } = req.body;
        const approvalRequest = await revisionControl.requestApproval(revision, approvers);
        res.json({ success: true, approvalRequest });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/revision/approve', async (req, res) => {
    try {
        const { revision, approverName, decision, options } = req.body;
        const result = await revisionControl.processApproval(revision, approverName, decision, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/revision/release', async (req, res) => {
    try {
        const { modelData, releaseOptions } = req.body;
        const release = await revisionControl.releaseModel(modelData, releaseOptions);
        res.json({ success: true, release });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/revision/audit-trail/:modelId', async (req, res) => {
    try {
        const { modelId } = req.params;
        // Would fetch modelData by ID
        const modelData = { id: modelId }; // Placeholder
        const trail = revisionControl.getAuditTrail(modelData);
        res.json({ success: true, trail });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==================== PHASE 3: FEA/CFD/AI ANALYSIS ROUTES ====================

/**
 * PHASE 3 - FEA SIMULATION ROUTES
 */

// Linear Static FEA
router.post('/analysis/fea-linear', async (req, res) => {
    try {
        const results = await feaSimulation.runLinearStaticFEA(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Nonlinear FEA
router.post('/analysis/fea-nonlinear', async (req, res) => {
    try {
        const results = await feaSimulation.runNonlinearFEA(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Modal/Frequency Analysis
router.post('/analysis/modal', async (req, res) => {
    try {
        const results = await feaSimulation.runModalAnalysis(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buckling Analysis
router.post('/analysis/buckling', async (req, res) => {
    try {
        const results = await feaSimulation.runBucklingAnalysis(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fatigue Analysis
router.post('/analysis/fatigue', async (req, res) => {
    try {
        const results = await feaSimulation.runFatigueAnalysis(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Contact Analysis
router.post('/analysis/contact', async (req, res) => {
    try {
        const results = await feaSimulation.runContactAnalysis(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PHASE 3 - CFD SIMULATION ROUTES
 */

// Internal Flow CFD
router.post('/analysis/cfd-internal', async (req, res) => {
    try {
        const results = await cfdSimulation.runInternalFlow(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// External Flow CFD
router.post('/analysis/cfd-external', async (req, res) => {
    try {
        const results = await cfdSimulation.runExternalFlow(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Conjugate Heat Transfer CFD
router.post('/analysis/cfd-heat-transfer', async (req, res) => {
    try {
        const results = await cfdSimulation.runConjugateHeatTransfer(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Turbulence Analysis
router.post('/analysis/cfd-turbulence', async (req, res) => {
    try {
        const results = await cfdSimulation.runTurbulenceAnalysis(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Multiphase Flow CFD
router.post('/analysis/cfd-multiphase', async (req, res) => {
    try {
        const results = await cfdSimulation.runMultiphaseFlow(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Thermal Steady-State
router.post('/analysis/thermal-steady', async (req, res) => {
    try {
        const results = await cfdSimulation.runConjugateHeatTransfer({ ...req.body, type: 'steady' });
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Thermal Transient
router.post('/analysis/thermal-transient', async (req, res) => {
    try {
        const results = await cfdSimulation.runConjugateHeatTransfer({ ...req.body, type: 'transient' });
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PHASE 3 - ADVANCED PHYSICS ROUTES
 */

// Vibration Analysis
router.post('/analysis/vibration', async (req, res) => {
    try {
        const results = await feaSimulation.runModalAnalysis({ ...req.body, analysisType: 'vibration' });
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rigid Body Dynamics
router.post('/analysis/rigid-body', async (req, res) => {
    try {
        const results = { success: true, simulationType: 'rigid-body-dynamics', results: {} };
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Flexible Body Dynamics
router.post('/analysis/flexible-body', async (req, res) => {
    try {
        const results = { success: true, simulationType: 'flexible-body-dynamics', results: {} };
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PHASE 3 - AI OPTIMIZATION ROUTES
 */

// Generative Design
router.post('/ai-optimization/generative-design', async (req, res) => {
    try {
        const results = await aiOptimization.runGenerativeDesign(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Topology Optimization
router.post('/ai-optimization/topology', async (req, res) => {
    try {
        const results = await aiOptimization.runTopologyOptimization(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parametric Optimization
router.post('/ai-optimization/parametric-opt', async (req, res) => {
    try {
        const results = await aiOptimization.runParametricOptimization(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Shape Optimization
router.post('/ai-optimization/shape-opt', async (req, res) => {
    try {
        const results = await aiOptimization.runShapeOptimization(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Design from Requirements (AI Agent)
router.post('/ai-optimization/design-from-requirements', async (req, res) => {
    try {
        const results = await aiOptimization.designFromRequirements(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Auto-Apply Constraints (AI Agent)
router.post('/ai-optimization/auto-constraints', async (req, res) => {
    try {
        const results = await aiOptimization.autoApplyConstraints(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate Design Variants (AI Agent)
router.post('/ai-optimization/design-variants', async (req, res) => {
    try {
        const results = await aiOptimization.generateDesignVariants(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Find Similar Parts (AI Agent)
router.post('/ai-optimization/similar-parts', async (req, res) => {
    try {
        const results = await aiOptimization.findSimilarParts(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DFM Check (AI Agent)
router.post('/ai-optimization/dfm-check', async (req, res) => {
    try {
        const results = await aiOptimization.runDFMCheck(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DFA Check (AI Agent)
router.post('/ai-optimization/dfa-check', async (req, res) => {
    try {
        const results = await aiOptimization.runDFMCheck({ ...req.body, type: 'dfa' });
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Manufacturability Score (AI Agent)
router.post('/ai-optimization/manufacturability', async (req, res) => {
    try {
        const results = await aiOptimization.calculateManufacturabilityScore(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// AI Cost Prediction (AI Agent)
router.post('/ai-optimization/cost-predict', async (req, res) => {
    try {
        const results = await aiOptimization.predictCost(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Lattice Structures (AI Agent)
router.post('/ai-optimization/lattice', async (req, res) => {
    try {
        const results = await aiOptimization.generateLattice(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Smart Support Generation (AI Agent)
router.post('/ai-optimization/support-generation', async (req, res) => {
    try {
        const results = await aiOptimization.generateSmartSupports(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Material Suggestions (AI Agent)
router.post('/ai-optimization/material-suggest', async (req, res) => {
    try {
        const results = await aiOptimization.suggestMaterials(req.body);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== END PHASE 3 ROUTES ====================

// ============ PEAK DESIGN SERVICES ============
const generativeDesign = require('../services/generativeDesignService');
const advancedSurfacing = require('../services/advancedSurfacingService');
const synchronousModeling = require('../services/synchronousModelingService');
const aiDesignOrchestrator = require('../services/aiDesignOrchestrator');

// ==================== PEAK: GENERATIVE DESIGN & TOPOLOGY OPTIMIZATION ====================

/**
 * POST /api/mechanical/peak/generative-design
 * Run generative design with topology optimization and multi-objective optimization
 * Returns 5 Pareto-optimal design variants
 */
router.post('/peak/generative-design', async (req, res) => {
    try {
        console.log('🧬 Peak: Running generative design with topology optimization...');
        const results = await generativeDesign.runGenerativeDesign(req.body);
        res.json(results);
    } catch (error) {
        console.error('Error in generative design:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PEAK: ADVANCED NURBS SURFACING ====================

/**
 * POST /api/mechanical/peak/class-a-surface
 * Create Class-A NURBS surface with G2/G3 continuity
 * Includes curvature analysis (Gaussian, mean, principal, zebra stripes, reflection lines)
 */
router.post('/peak/class-a-surface', async (req, res) => {
    try {
        console.log('✨ Peak: Creating Class-A NURBS surface...');
        const results = await advancedSurfacing.createClassASurface(req.body);
        res.json(results);
    } catch (error) {
        console.error('Error in Class-A surfacing:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/mechanical/peak/loft-surface
 * Advanced lofting with Class-A quality
 */
router.post('/peak/loft-surface', async (req, res) => {
    try {
        console.log('🎨 Peak: Lofting Class-A surface...');
        const results = await advancedSurfacing.loftSurface(req.body.profiles, req.body.options);
        res.json({ success: true, surface: results });
    } catch (error) {
        console.error('Error in loft surface:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PEAK: SYNCHRONOUS MODELING ====================

/**
 * POST /api/mechanical/peak/direct-edit
 * Synchronous modeling - direct editing with parametric intelligence
 * Push/pull faces while maintaining relationships (parallel, perpendicular, coaxial, etc.)
 */
router.post('/peak/direct-edit', async (req, res) => {
    try {
        console.log('🔧 Peak: Synchronous direct editing...');
        const results = await synchronousModeling.directEdit(req.body);
        res.json(results);
    } catch (error) {
        console.error('Error in synchronous edit:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PEAK: AI DESIGN ORCHESTRATOR ====================

/**
 * POST /api/mechanical/peak/autonomous-design
 * Autonomous AI-driven design workflow
 * AI makes all design decisions iteratively to achieve high-level goals
 * Multi-step reasoning, topology optimization, surface refinement, validation
 */
router.post('/peak/autonomous-design', async (req, res) => {
    try {
        console.log('🤖 Peak: Starting autonomous AI design workflow...');

        // Create async job for long-running autonomous design
        const job = await jobQueue.createJob('autonomous_design', req.body);

        // Start async processing
        processAutonomousDesignJob(job.id, req.body).catch(error => {
            console.error('Error in autonomous design job:', error);
            jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        });

        res.json({
            success: true,
            jobId: job.id,
            message: 'Autonomous design workflow started',
            status: 'queued'
        });
    } catch (error) {
        console.error('Error starting autonomous design:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/mechanical/peak/autonomous-design/:jobId
 * Get status of autonomous design workflow
 */
router.get('/peak/autonomous-design/:jobId', async (req, res) => {
    try {
        const job = await jobQueue.getJob(req.params.jobId);

        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        res.json({
            success: true,
            job: {
                id: job.id,
                status: job.status,
                progress: job.progress || 0,
                result: job.result,
                error: job.error,
                createdAt: job.createdAt,
                completedAt: job.completedAt
            }
        });
    } catch (error) {
        console.error('Error getting job status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Process autonomous design job asynchronously
 */
async function processAutonomousDesignJob(jobId, requirements) {
    try {
        await jobQueue.updateJob(jobId, {
            status: 'processing',
            progress: 10,
            message: 'Decomposing requirements...'
        });

        // Run autonomous design orchestrator
        const results = await aiDesignOrchestrator.autonomousDesign(requirements);

        await jobQueue.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result: results,
            completedAt: Date.now()
        });

        console.log(`✅ Autonomous design job ${jobId} completed successfully`);
    } catch (error) {
        console.error(`❌ Autonomous design job ${jobId} failed:`, error);
        throw error;
    }
}

// ==================== END PEAK DESIGN ROUTES ====================

// ============ PARAMETRIC DESIGN SERVICES ============
const aiParametricDesignEngine = require('../services/aiParametricDesignEngine');
const designVariantGenerator = require('../services/designVariantGenerator');
const bomAndSimulationPrep = require('../services/bomAndSimulationPrepService');

// ==================== AI PARAMETRIC DESIGN (NL → CAD) ====================

/**
 * POST /api/mechanical/parametric/generate-from-prompt
 * Generate parametric CAD model from natural language prompt
 * Returns 3-5 fully editable design variants
 */
router.post('/parametric/generate-from-prompt', async (req, res) => {
    try {
        console.log('🤖 Parametric Design: Generating from natural language...');
        const { prompt, options } = req.body;

        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required'
            });
        }

        const results = await aiParametricDesignEngine.generateFromPrompt(prompt, options);
        res.json(results);
    } catch (error) {
        console.error('Error in parametric design generation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DESIGN VARIANT GENERATION ====================

/**
 * POST /api/mechanical/variants/generate-conceptual
 * Generate conceptually different design variants
 * Traditional, Topology-Optimized, Lattice, Biomimetic, Modular approaches
 */
router.post('/variants/generate-conceptual', async (req, res) => {
    try {
        console.log('🎨 Variant Generator: Creating conceptual variants...');
        const { requirements, count } = req.body;

        const results = await designVariantGenerator.generateConceptualVariants(requirements, count);
        res.json(results);
    } catch (error) {
        console.error('Error in variant generation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== BOM AUTO-GENERATION ====================

/**
 * POST /api/mechanical/bom/generate
 * Auto-generate Bill of Materials from CAD model
 * Hierarchical or flat BOM with costs and vendor info
 */
router.post('/bom/generate', async (req, res) => {
    try {
        console.log('📋 BOM Generator: Generating BOM from CAD model...');
        const { cadModel, options } = req.body;

        const results = await bomAndSimulationPrep.generateBOM(cadModel, options);
        res.json(results);
    } catch (error) {
        console.error('Error in BOM generation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SIMULATION PREPARATION ====================

/**
 * POST /api/mechanical/simulation/prepare
 * Prepare CAD model for FEA/CFD simulation
 * Auto-assign materials, contacts, mesh, boundary conditions
 */
router.post('/simulation/prepare', async (req, res) => {
    try {
        console.log('🔬 Simulation Prep: Preparing model for simulation...');
        const { cadModel, simulationType, options } = req.body;

        const results = await bomAndSimulationPrep.prepareForSimulation(cadModel, simulationType, options);
        res.json(results);
    } catch (error) {
        console.error('Error in simulation preparation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== END PARAMETRIC DESIGN ROUTES ====================

module.exports = router;
