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
const feaService = require('../services/analysis/feaService');
const camService = require('../services/manufacturing/camService');
const jobQueue = require('../services/jobQueue');
const bedrockService = require('../services/bedrockService');

// Initialize CAD services
const drawingEngine = new DrawingEngine();
const drawingExportService = new DrawingExportService();
const sheetMetalEngine = new SheetMetalEngine();
const weldmentsEngine = new WeldmentsEngine();
const topologyOptimization = new TopologyOptimizationService(bedrockService);
const configurationService = new ConfigurationService();

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

module.exports = router;
