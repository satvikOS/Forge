/**
 * Parametric Design API Routes
 * Endpoints for NL to CAD, variant generation, BOM, and simulation prep
 */

const express = require('express');
const router = express.Router();

const designVariantGenerator = require('../services/ai/designVariantGenerator');
const bomAutoGenerator = require('../services/cad/bomAutoGenerator');
const simulationPrepService = require('../services/analysis/simulationPrepService');
const cadIntegrationService = require('../services/cad/cadIntegrationService');

// ==================== Session Management ====================

/**
 * POST /api/parametric/session
 * Create a new CAD session
 */
router.post('/session', (req, res) => {
    try {
        const { workbench, units, template } = req.body;

        const session = cadIntegrationService.createSession({
            workbench: workbench || 'mechanical-cad',
            units: units || 'mm',
            template
        });

        res.json({
            success: true,
            session
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/parametric/session
 * Close current CAD session
 */
router.delete('/session', (req, res) => {
    try {
        const result = cadIntegrationService.closeSession();
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Error closing session:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parametric/session
 * Get current session state
 */
router.get('/session', (req, res) => {
    try {
        const session = cadIntegrationService.getSessionState();
        res.json({
            success: true,
            session
        });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Natural Language to CAD ====================

/**
 * POST /api/parametric/nl-command
 * Execute natural language CAD command
 */
router.post('/nl-command', async (req, res) => {
    try {
        const { command } = req.body;

        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        console.log(`📝 Processing NL command: "${command.substring(0, 50)}..."`);

        // Parse natural language to operations
        const operations = await cadIntegrationService.parseNaturalLanguage(command);

        if (operations.length === 0) {
            return res.json({
                success: false,
                message: 'Could not parse command into CAD operations',
                command
            });
        }

        // Execute operations
        const results = await cadIntegrationService.executeOperationBatch(operations);

        res.json({
            success: true,
            command,
            operations: operations.length,
            results,
            session: cadIntegrationService.getSessionState()
        });

    } catch (error) {
        console.error('Error processing NL command:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/execute
 * Execute a single CAD operation
 */
router.post('/execute', async (req, res) => {
    try {
        const { operation, params } = req.body;

        if (!operation) {
            return res.status(400).json({ error: 'Operation is required' });
        }

        const result = await cadIntegrationService.executeOperation(operation, params);

        res.json({
            success: result.success,
            ...result
        });

    } catch (error) {
        console.error('Error executing operation:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Design Variant Generation ====================

/**
 * POST /api/parametric/generate-variants
 * Generate design variants from natural language prompt
 */
router.post('/generate-variants', async (req, res) => {
    try {
        const {
            prompt,
            numVariants = 6,
            strategies,
            constraints,
            materials
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`🎨 Generating variants for: "${prompt.substring(0, 50)}..."`);

        const result = await designVariantGenerator.generateVariants(prompt, {
            numVariants,
            strategies,
            constraints,
            materials
        });

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('Error generating variants:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parametric/strategies
 * Get available variant generation strategies
 */
router.get('/strategies', (req, res) => {
    try {
        const strategies = designVariantGenerator.variantStrategies;

        res.json({
            success: true,
            strategies: Object.entries(strategies).map(([key, value]) => ({
                key,
                name: value.name,
                description: value.description,
                focus: value.focus
            }))
        });
    } catch (error) {
        console.error('Error getting strategies:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/select-variant
 * Select a variant to work with
 */
router.post('/select-variant', async (req, res) => {
    try {
        const { variantId, variants } = req.body;

        if (!variantId) {
            return res.status(400).json({ error: 'variantId is required' });
        }

        const variant = designVariantGenerator.getVariant(variants, variantId);

        if (!variant) {
            return res.status(404).json({ error: 'Variant not found' });
        }

        // Create a session for the selected variant
        const session = cadIntegrationService.createSession({
            workbench: 'mechanical-cad',
            units: 'mm'
        });

        res.json({
            success: true,
            selectedVariant: variant,
            session
        });

    } catch (error) {
        console.error('Error selecting variant:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== BOM Generation ====================

/**
 * POST /api/parametric/auto-bom
 * Generate BOM from design
 */
router.post('/auto-bom', async (req, res) => {
    try {
        const {
            designData,
            includeHardware = true,
            includeLabor = true,
            laborRate = 75,
            quantity = 1
        } = req.body;

        if (!designData) {
            return res.status(400).json({ error: 'designData is required' });
        }

        console.log(`📋 Generating BOM...`);

        const bom = await bomAutoGenerator.generateBOM(designData, {
            includeHardware,
            includeLabor,
            laborRate,
            quantity
        });

        res.json({
            success: true,
            bom
        });

    } catch (error) {
        console.error('Error generating BOM:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/export-bom
 * Export BOM to various formats
 */
router.post('/export-bom', async (req, res) => {
    try {
        const { bom, format = 'csv' } = req.body;

        if (!bom) {
            return res.status(400).json({ error: 'BOM data is required' });
        }

        const exported = await bomAutoGenerator.exportBOM(bom, format);

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="bom_${Date.now()}.csv"`);
            return res.send(exported);
        }

        res.json({
            success: true,
            format,
            data: exported
        });

    } catch (error) {
        console.error('Error exporting BOM:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/compare-boms
 * Compare BOMs between variants
 */
router.post('/compare-boms', async (req, res) => {
    try {
        const { boms } = req.body;

        if (!boms || !Array.isArray(boms)) {
            return res.status(400).json({ error: 'Array of BOMs is required' });
        }

        const comparison = bomAutoGenerator.compareBOMs(boms);

        res.json({
            success: true,
            comparison
        });

    } catch (error) {
        console.error('Error comparing BOMs:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Simulation Preparation ====================

/**
 * POST /api/parametric/prep-simulation
 * Prepare design for simulation
 */
router.post('/prep-simulation', async (req, res) => {
    try {
        const {
            designData,
            analysisType = 'static',
            meshQuality = 'standard',
            autoDetectLoadCases = true
        } = req.body;

        if (!designData) {
            return res.status(400).json({ error: 'designData is required' });
        }

        console.log(`🔬 Preparing for ${analysisType} simulation...`);

        const setup = await simulationPrepService.prepareForSimulation(designData, {
            analysisType,
            meshQuality,
            autoDetectLoadCases
        });

        res.json({
            success: true,
            simulationSetup: setup
        });

    } catch (error) {
        console.error('Error preparing simulation:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parametric/simulation-types
 * Get available simulation types
 */
router.get('/simulation-types', (req, res) => {
    try {
        res.json({
            success: true,
            types: [
                { key: 'static', name: 'Static Structural', description: 'Constant load analysis' },
                { key: 'modal', name: 'Modal/Vibration', description: 'Natural frequency analysis' },
                { key: 'thermal', name: 'Thermal Stress', description: 'Temperature-induced stress' },
                { key: 'fatigue', name: 'Fatigue Life', description: 'Cyclic loading assessment' },
                { key: 'buckling', name: 'Buckling', description: 'Structural stability' },
                { key: 'cfd', name: 'CFD Flow', description: 'Fluid flow analysis' }
            ],
            meshQualities: ['coarse', 'standard', 'fine', 'ultrafine']
        });
    } catch (error) {
        console.error('Error getting simulation types:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== CAD Integration ====================

/**
 * POST /api/parametric/integrate-cad
 * Execute CAD engine operations
 */
router.post('/integrate-cad', async (req, res) => {
    try {
        const { operations } = req.body;

        if (!operations || !Array.isArray(operations)) {
            return res.status(400).json({ error: 'Array of operations is required' });
        }

        const results = await cadIntegrationService.executeOperationBatch(operations);

        res.json({
            success: true,
            results,
            session: cadIntegrationService.getSessionState()
        });

    } catch (error) {
        console.error('Error with CAD integration:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/undo
 * Undo last operation
 */
router.post('/undo', (req, res) => {
    try {
        const success = cadIntegrationService.undo();
        res.json({
            success,
            message: success ? 'Undo successful' : 'Nothing to undo',
            session: cadIntegrationService.getSessionState()
        });
    } catch (error) {
        console.error('Error with undo:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/redo
 * Redo last undone operation
 */
router.post('/redo', (req, res) => {
    try {
        const success = cadIntegrationService.redo();
        res.json({
            success,
            message: success ? 'Redo successful' : 'Nothing to redo',
            session: cadIntegrationService.getSessionState()
        });
    } catch (error) {
        console.error('Error with redo:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parametric/history
 * Get operation history
 */
router.get('/history', (req, res) => {
    try {
        const history = cadIntegrationService.getHistory();
        res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Error getting history:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/export
 * Export current session
 */
router.post('/export', async (req, res) => {
    try {
        const { format = 'json' } = req.body;

        const exported = await cadIntegrationService.exportSession(format);

        res.json({
            success: true,
            format,
            data: exported
        });

    } catch (error) {
        console.error('Error exporting session:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Configuration Management ====================

/**
 * POST /api/parametric/configuration
 * Create a design configuration
 */
router.post('/configuration', async (req, res) => {
    try {
        const { name, parameterOverrides } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Configuration name is required' });
        }

        const config = await cadIntegrationService.createConfiguration(name, parameterOverrides);

        res.json({
            success: true,
            configuration: config
        });

    } catch (error) {
        console.error('Error creating configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/parametric/configuration/activate
 * Activate a configuration
 */
router.post('/configuration/activate', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Configuration name is required' });
        }

        const config = await cadIntegrationService.activateConfiguration(name);

        res.json({
            success: true,
            activeConfiguration: config,
            session: cadIntegrationService.getSessionState()
        });

    } catch (error) {
        console.error('Error activating configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Full Pipeline ====================

/**
 * POST /api/parametric/full-pipeline
 * Run the complete NL to CAD pipeline
 */
router.post('/full-pipeline', async (req, res) => {
    try {
        const {
            prompt,
            generateBOM = true,
            prepareSimulation = false,
            analysisType = 'static'
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`🚀 Running full pipeline for: "${prompt.substring(0, 50)}..."`);

        // Step 1: Generate variants
        const variants = await designVariantGenerator.generateVariants(prompt, {
            numVariants: 4,
            strategies: ['lightweight', 'costOptimized', 'highStrength', 'manufacturable']
        });

        // Step 2: Generate BOMs for each variant
        let boms = [];
        if (generateBOM) {
            for (const variant of variants.variants) {
                const bom = await bomAutoGenerator.generateBOM(variant, { quantity: 1 });
                boms.push(bom);
            }
        }

        // Step 3: Prepare best variant for simulation
        let simulationSetup = null;
        if (prepareSimulation && variants.bestVariant) {
            simulationSetup = await simulationPrepService.prepareForSimulation(
                variants.bestVariant,
                { analysisType }
            );
        }

        // Step 4: Compare BOMs
        const bomComparison = boms.length > 0 ? bomAutoGenerator.compareBOMs(boms) : null;

        res.json({
            success: true,
            prompt,
            variants: variants.variants,
            bestVariant: variants.bestVariant,
            comparison: variants.comparison,
            boms: boms.map(b => ({
                designId: b.designId,
                totalCost: b.costs.grandTotal,
                itemCount: b.items.length
            })),
            bomComparison,
            simulationSetup: simulationSetup ? {
                id: simulationSetup.id,
                analysisType: simulationSetup.analysisType,
                estimatedRuntime: simulationSetup.estimatedRuntime
            } : null
        });

    } catch (error) {
        console.error('Error running full pipeline:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
