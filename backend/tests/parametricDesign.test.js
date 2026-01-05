/**
 * Parametric Design Pipeline Tests
 * Tests design variant generation, BOM auto-generation, and CAD integration
 */

const designVariantGenerator = require('../services/ai/designVariantGenerator');
const bomAutoGenerator = require('../services/cad/bomAutoGenerator');
const cadIntegrationService = require('../services/cad/cadIntegrationService');
const simulationPrepService = require('../services/analysis/simulationPrepService');

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds for AI calls

describe('Parametric Design Pipeline Tests', () => {

    describe('Design Variant Generator', () => {

        test('should have initialized variant strategies', () => {
            const strategies = designVariantGenerator.variantStrategies;
            expect(strategies).toBeTruthy();
            expect(Object.keys(strategies).length).toBeGreaterThanOrEqual(10);
            expect(strategies.lightweight).toBeTruthy();
            expect(strategies.costOptimized).toBeTruthy();
            expect(strategies.highStrength).toBeTruthy();
        });

        test('should generate variants from prompt', async () => {
            const result = await designVariantGenerator.generateVariants(
                'Create a mounting bracket with 4 holes',
                { numVariants: 3 }
            );

            expect(result).toBeTruthy();
            expect(result.variants).toBeTruthy();
            expect(result.variants.length).toBe(3);
            expect(result.bestVariant).toBeTruthy();
            expect(result.comparison).toBeTruthy();
        }, TEST_TIMEOUT);

        test('should parse design intent from NL', async () => {
            const intent = await designVariantGenerator._parseDesignIntent(
                'Create a lightweight aluminum bracket for mounting a sensor'
            );

            expect(intent).toBeTruthy();
            expect(intent.primaryFunction).toBeTruthy();
            expect(intent.dimensions).toBeTruthy();
            expect(intent.optimizationGoals).toBeTruthy();
        }, TEST_TIMEOUT);

        test('should rank variants by goals', () => {
            const mockVariants = [
                { id: 1, metrics: { weight: 100, totalCost: 50, strength: { factorOfSafety: 2 }, manufacturability: 80 }, score: 0 },
                { id: 2, metrics: { weight: 80, totalCost: 60, strength: { factorOfSafety: 1.5 }, manufacturability: 90 }, score: 0 },
                { id: 3, metrics: { weight: 120, totalCost: 40, strength: { factorOfSafety: 3 }, manufacturability: 70 }, score: 0 }
            ];

            const ranked = designVariantGenerator._rankVariants(mockVariants, ['weight', 'cost']);

            expect(ranked[0].id).toBe(2); // Lightest with reasonable cost
        });

    });

    describe('BOM Auto-Generator', () => {

        test('should have initialized standard parts library', () => {
            const library = bomAutoGenerator.standardPartsLibrary;
            expect(library).toBeTruthy();
            expect(library.fasteners).toBeTruthy();
            expect(library.bearings).toBeTruthy();
            expect(library.washers).toBeTruthy();
        });

        test('should have initialized material pricing', () => {
            const pricing = bomAutoGenerator.materialPricing;
            expect(pricing).toBeTruthy();
            expect(pricing['Aluminum 6061-T6']).toBeTruthy();
            expect(pricing['Steel 1018']).toBeTruthy();
        });

        test('should generate BOM from design data', async () => {
            const mockDesign = {
                id: 'test_design',
                name: 'Test Bracket',
                specification: {
                    dimensions: { x: 100, y: 50, z: 10 },
                    material: { name: 'Aluminum 6061-T6' },
                    features: [
                        { type: 'hole', diameter: 6.4, depth: null, quantity: 4 }
                    ]
                }
            };

            const bom = await bomAutoGenerator.generateBOM(mockDesign);

            expect(bom).toBeTruthy();
            expect(bom.items).toBeTruthy();
            expect(bom.items.length).toBeGreaterThan(0);
            expect(bom.costs).toBeTruthy();
            expect(bom.costs.grandTotal).toBeGreaterThan(0);
        });

        test('should match fastener sizes from holes', () => {
            const size = bomAutoGenerator._matchFastenerSize(6.4);
            expect(size).toBe('M6');

            const size2 = bomAutoGenerator._matchFastenerSize(4.3);
            expect(size2).toBe('M4');
        });

        test('should export BOM to CSV', async () => {
            const mockBOM = {
                items: [
                    { itemNumber: 1, partNumber: 'P001', name: 'Part 1', description: 'Test', material: 'Aluminum', quantity: 1, unitCost: 10, isStandard: false }
                ],
                costs: { subtotal: 10, overhead: 3.5, grandTotal: 13.5 }
            };

            const csv = await bomAutoGenerator.exportBOM(mockBOM, 'csv');
            expect(csv).toContain('Part Number');
            expect(csv).toContain('P001');
        });

    });

    describe('CAD Integration Service', () => {

        test('should create a session', () => {
            const session = cadIntegrationService.createSession({
                workbench: 'mechanical-cad',
                units: 'mm'
            });

            expect(session).toBeTruthy();
            expect(session.id).toBeTruthy();
            expect(session.workbench).toBe('mechanical-cad');
            expect(session.units).toBe('mm');
        });

        test('should get session state', () => {
            cadIntegrationService.createSession();
            const state = cadIntegrationService.getSessionState();

            expect(state).toBeTruthy();
            expect(state.featureTree).toBeTruthy();
            expect(state.sketches).toBeTruthy();
        });

        test('should parse NL to operations', async () => {
            cadIntegrationService.createSession();
            const operations = await cadIntegrationService.parseNaturalLanguage(
                'Create a 50mm cube'
            );

            // May return empty if API unavailable
            expect(Array.isArray(operations)).toBe(true);
        }, TEST_TIMEOUT);

        test('should support undo/redo', () => {
            cadIntegrationService.createSession();

            // Initially nothing to undo
            const cantUndo = cadIntegrationService.undo();
            expect(cantUndo).toBe(false);

            // Close session
            cadIntegrationService.closeSession();
        });

        test('should close session cleanly', () => {
            cadIntegrationService.createSession();
            const result = cadIntegrationService.closeSession();

            expect(result.closed).toBe(true);
            expect(cadIntegrationService.getSessionState()).toBeNull();
        });

    });

    describe('Simulation Prep Service', () => {

        test('should have mesh presets', () => {
            const presets = simulationPrepService.meshPresets;
            expect(presets).toBeTruthy();
            expect(presets.coarse).toBeTruthy();
            expect(presets.standard).toBeTruthy();
            expect(presets.fine).toBeTruthy();
        });

        test('should have load case templates', () => {
            const templates = simulationPrepService.loadCaseTemplates;
            expect(templates).toBeTruthy();
            expect(templates.staticLoad).toBeTruthy();
            expect(templates.thermal).toBeTruthy();
            expect(templates.modal).toBeTruthy();
        });

        test('should have material properties', () => {
            const materials = simulationPrepService.materialPropertiesDB;
            expect(materials).toBeTruthy();
            expect(materials['Aluminum 6061-T6']).toBeTruthy();
            expect(materials['Aluminum 6061-T6'].elasticModulus).toBeTruthy();
        });

        test('should prepare design for simulation', async () => {
            const mockDesign = {
                id: 'test_design',
                specification: {
                    dimensions: { x: 100, y: 50, z: 25 },
                    material: { name: 'Aluminum 6061-T6' },
                    features: [
                        { type: 'fillet', radius: 2, edges: ['all'] }
                    ]
                }
            };

            const setup = await simulationPrepService.prepareForSimulation(mockDesign, {
                analysisType: 'static',
                meshQuality: 'standard'
            });

            expect(setup).toBeTruthy();
            expect(setup.analysisType).toBe('static');
            expect(setup.mesh).toBeTruthy();
            expect(setup.material).toBeTruthy();
            expect(setup.loadCases).toBeTruthy();
        });

    });

});

// Run tests if this file is executed directly
if (require.main === module) {
    console.log('🧪 Running Parametric Design Pipeline Tests...\n');

    // Simple test runner
    const tests = [
        {
            name: 'Variant Strategies Initialized',
            fn: () => {
                const strategies = designVariantGenerator.variantStrategies;
                console.assert(Object.keys(strategies).length >= 10, 'Should have at least 10 strategies');
                console.log('✅ Variant strategies initialized');
            }
        },
        {
            name: 'Standard Parts Library',
            fn: () => {
                const library = bomAutoGenerator.standardPartsLibrary;
                console.assert(library.fasteners, 'Should have fasteners');
                console.log('✅ Standard parts library initialized');
            }
        },
        {
            name: 'CAD Session Creation',
            fn: () => {
                const session = cadIntegrationService.createSession();
                console.assert(session.id, 'Session should have ID');
                cadIntegrationService.closeSession();
                console.log('✅ CAD session creation works');
            }
        },
        {
            name: 'Simulation Prep Materials',
            fn: () => {
                const materials = simulationPrepService.materialPropertiesDB;
                console.assert(materials['Aluminum 6061-T6'], 'Should have aluminum');
                console.log('✅ Simulation prep materials loaded');
            }
        },
        {
            name: 'Fastener Matching',
            fn: () => {
                const size = bomAutoGenerator._matchFastenerSize(6.4);
                console.assert(size === 'M6', 'Should match M6');
                console.log('✅ Fastener matching works');
            }
        }
    ];

    tests.forEach(test => {
        try {
            test.fn();
        } catch (error) {
            console.error(`❌ ${test.name} failed:`, error.message);
        }
    });

    console.log('\n✅ Basic tests completed. Run with Jest for full test suite.');
}
