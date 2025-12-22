/**
 * Cost Estimation Service
 * Real-time manufacturing cost analysis for machining, additive, and assembly
 */

const bedrockService = require('../bedrockService');

class CostEstimationService {
    constructor() {
        this.materialCosts = this._initializeMaterialCosts();
        this.machineCosts = this._initializeMachineCosts();
        this.laborRates = this._initializeLaborRates();
    }

    /**
     * Initialize material cost database
     */
    _initializeMaterialCosts() {
        return {
            // Metals (per kg)
            'aluminum_6061': { cost: 3.5, density: 2.70 },
            'steel_1045': { cost: 1.2, density: 7.85 },
            'stainless_316': { cost: 5.8, density: 8.00 },
            'titanium_grade5': { cost: 35.0, density: 4.43 },
            'brass': { cost: 6.5, density: 8.50 },
            // Plastics (per kg)
            'ABS': { cost: 2.5, density: 1.05 },
            'PLA': { cost: 2.0, density: 1.24 },
            'nylon_pa12': { cost: 8.5, density: 1.01 },
            'polycarbonate': { cost: 4.5, density: 1.20 },
            // Additive (per kg)
            'sls_nylon': { cost: 85.0, density: 1.01 },
            'dmls_steel': { cost: 150.0, density: 7.85 }
        };
    }

    /**
     * Initialize machine hourly rates
     */
    _initializeMachineCosts() {
        return {
            '3axis_mill': { hourlyRate: 75, setupTime: 30 },
            '5axis_mill': { hourlyRate: 150, setupTime: 60 },
            'lathe': { hourlyRate: 65, setupTime: 25 },
            'fdm_printer': { hourlyRate: 5, setupTime: 10 },
            'sls_printer': { hourlyRate: 25, setupTime: 30 },
            'dmls_printer': { hourlyRate: 95, setupTime: 90 },
            'manual_assembly': { hourlyRate: 45, setupTime: 15 }
        };
    }

    /**
     * Initialize labor rates by skill level
     */
    _initializeLaborRates() {
        return {
            'machinist': 55, // USD/hr
            'programmer': 75,
            'engineer': 95,
            'assembler': 35,
            'inspector': 50
        };
    }

    /**
     * Estimate machining costs
     */
    async estimateMachiningCost(partData, toolpaths, options = {}) {
        const {
            machine = '3axis_mill',
            material = 'aluminum_6061',
            quantity = 1,
            includeSetup = true,
            includeTooling = true
        } = options;

        console.log(`💰 Estimating machining cost for ${quantity} parts...`);

        const materialData = this.materialCosts[material];
        const machineData = this.machineCosts[machine];

        const estimate = {
            material: 0,
            machining: 0,
            tooling: 0,
            setup: 0,
            labor: 0,
            overhead: 0,
            total: 0,
            perUnit: 0,
            breakdown: []
        };

        // Material cost
        const stockVolume = this._calculateStockVolume(partData);
        const partVolume = partData.volume || (stockVolume * 0.6);
        const wasteVolume = stockVolume - partVolume;

        const stockWeight = (stockVolume / 1000000) * materialData.density; // kg
        const wasteWeight = (wasteVolume / 1000000) * materialData.density;

        estimate.material = stockWeight * materialData.cost;
        estimate.breakdown.push({
            category: 'Material',
            description: `${stockWeight.toFixed(2)}kg @ $${materialData.cost}/kg`,
            cost: estimate.material
        });

        // Machining time cost
        const machiningTimeMinutes = this._estimateMachiningTime(toolpaths);
        const machiningHours = machiningTimeMinutes / 60;

        estimate.machining = machiningHours * machineData.hourlyRate * quantity;
        estimate.breakdown.push({
            category: 'Machining',
            description: `${machiningTimeMinutes.toFixed(1)} min/part × ${quantity} parts @ $${machineData.hourlyRate}/hr`,
            cost: estimate.machining
        });

        // Setup cost (amortized across quantity)
        if (includeSetup) {
            const setupHours = machineData.setupTime / 60;
            estimate.setup = (setupHours * machineData.hourlyRate) + (1.5 * this.laborRates.programmer);
            estimate.breakdown.push({
                category: 'Setup',
                description: `${machineData.setupTime} min setup + programming`,
                cost: estimate.setup
            });
        }

        // Tooling cost
        if (includeTooling) {
            const toolCount = toolpaths.length;
            estimate.tooling = toolCount * 25 * (machiningHours / 10); // Tool wear
            estimate.breakdown.push({
                category: 'Tooling',
                description: `${toolCount} tools, ${machiningHours.toFixed(1)}hrs wear`,
                cost: estimate.tooling
            });
        }

        // Labor (inspection, deburring)
        estimate.labor = quantity * 0.25 * this.laborRates.inspector;
        estimate.breakdown.push({
            category: 'Labor',
            description: `Inspection & finishing (${(0.25 * quantity).toFixed(1)}hrs)`,
            cost: estimate.labor
        });

        // Overhead (20%)
        const subtotal = estimate.material + estimate.machining + estimate.setup + estimate.tooling + estimate.labor;
        estimate.overhead = subtotal * 0.20;
        estimate.breakdown.push({
            category: 'Overhead',
            description: '20% overhead',
            cost: estimate.overhead
        });

        estimate.total = subtotal + estimate.overhead;
        estimate.perUnit = estimate.total / quantity;

        console.log(`✅ Cost estimate: $${estimate.total.toFixed(2)} total, $${estimate.perUnit.toFixed(2)} per unit`);

        return estimate;
    }

    /**
     * Estimate additive manufacturing costs
     */
    async estimateAdditiveCost(partData, printSettings, options = {}) {
        const {
            printer = 'fdm_printer',
            material = 'PLA',
            quantity = 1,
            includePostProcessing = true
        } = options;

        console.log(`💰 Estimating additive cost for ${quantity} parts...`);

        const materialData = this.materialCosts[material];
        const printerData = this.machineCosts[printer];

        const estimate = {
            material: 0,
            printing: 0,
            support: 0,
            postProcessing: 0,
            setup: 0,
            total: 0,
            perUnit: 0,
            breakdown: []
        };

        // Material cost
        const partVolume = partData.volume || 50000; // mm³
        const partWeight = (partVolume / 1000000) * materialData.density; // kg

        estimate.material = partWeight * materialData.cost * quantity;
        estimate.breakdown.push({
            category: 'Material',
            description: `${(partWeight * quantity).toFixed(3)}kg @ $${materialData.cost}/kg`,
            cost: estimate.material
        });

        // Support material cost
        if (printSettings.supportVolume) {
            const supportWeight = (printSettings.supportVolume / 1000000) * materialData.density;
            estimate.support = supportWeight * materialData.cost * quantity;
            estimate.breakdown.push({
                category: 'Support Material',
                description: `${(supportWeight * quantity).toFixed(3)}kg supports`,
                cost: estimate.support
            });
        }

        // Print time cost
        const printHours = (printSettings.printTimeMinutes || 120) / 60;
        estimate.printing = printHours * printerData.hourlyRate * quantity;
        estimate.breakdown.push({
            category: 'Print Time',
            description: `${printHours.toFixed(1)}hrs × ${quantity} @ $${printerData.hourlyRate}/hr`,
            cost: estimate.printing
        });

        // Setup cost
        const setupHours = printerData.setupTime / 60;
        estimate.setup = setupHours * printerData.hourlyRate + (0.5 * this.laborRates.assembler);
        estimate.breakdown.push({
            category: 'Setup',
            description: `${printerData.setupTime} min setup`,
            cost: estimate.setup
        });

        // Post-processing (support removal, surface finish)
        if (includePostProcessing) {
            estimate.postProcessing = quantity * 0.5 * this.laborRates.assembler;
            if (printer.includes('sla') || printer.includes('dmls')) {
                estimate.postProcessing += quantity * 15; // Washing, curing, heat treatment
            }
            estimate.breakdown.push({
                category: 'Post-Processing',
                description: 'Support removal, finishing',
                cost: estimate.postProcessing
            });
        }

        estimate.total = estimate.material + estimate.support + estimate.printing + estimate.setup + estimate.postProcessing;
        estimate.perUnit = estimate.total / quantity;

        console.log(`✅ Additive cost: $${estimate.total.toFixed(2)} total, $${estimate.perUnit.toFixed(2)} per unit`);

        return estimate;
    }

    /**
     * Estimate assembly costs
     */
    async estimateAssemblyCost(assemblyData, options = {}) {
        const {
            quantity = 1,
            includeFixtures = true,
            automationLevel = 'manual' // manual, semi-automated, automated
        } = options;

        console.log(`💰 Estimating assembly cost for ${quantity} assemblies...`);

        const estimate = {
            parts: 0,
            labor: 0,
            fixtures: 0,
            testing: 0,
            total: 0,
            perUnit: 0,
            breakdown: []
        };

        // Parts cost (sum of individual part costs)
        const partsCost = assemblyData.parts.reduce((sum, part) => {
            return sum + (part.unitCost || 10);
        }, 0);

        estimate.parts = partsCost * quantity;
        estimate.breakdown.push({
            category: 'Parts',
            description: `${assemblyData.parts.length} components × ${quantity}`,
            cost: estimate.parts
        });

        // Assembly labor
        const partsCount = assemblyData.parts.length;
        let assemblyTimeMinutes = partsCount * 3; // 3 min per part

        if (automationLevel === 'semi-automated') {
            assemblyTimeMinutes *= 0.5;
        } else if (automationLevel === 'automated') {
            assemblyTimeMinutes *= 0.2;
        }

        const laborHours = (assemblyTimeMinutes / 60) * quantity;
        estimate.labor = laborHours * this.laborRates.assembler;
        estimate.breakdown.push({
            category: 'Assembly Labor',
            description: `${laborHours.toFixed(1)}hrs @ $${this.laborRates.assembler}/hr (${automationLevel})`,
            cost: estimate.labor
        });

        // Fixtures and tooling
        if (includeFixtures && quantity > 10) {
            estimate.fixtures = 500 + (partsCount * 25);
            estimate.breakdown.push({
                category: 'Fixtures',
                description: 'Assembly fixtures and tooling',
                cost: estimate.fixtures
            });
        }

        // Testing and QC
        estimate.testing = quantity * 0.25 * this.laborRates.inspector;
        estimate.breakdown.push({
            category: 'Testing',
            description: `QC inspection (${(0.25 * quantity).toFixed(1)}hrs)`,
            cost: estimate.testing
        });

        estimate.total = estimate.parts + estimate.labor + estimate.fixtures + estimate.testing;
        estimate.perUnit = estimate.total / quantity;

        console.log(`✅ Assembly cost: $${estimate.total.toFixed(2)} total, $${estimate.perUnit.toFixed(2)} per unit`);

        return estimate;
    }

    /**
     * Compare manufacturing methods with AI recommendations
     */
    async compareManufacturingMethods(partData, options = {}) {
        const { quantity = 1, requiredLeadTime = 14 } = options;

        console.log(`🤖 Comparing manufacturing methods with AI...`);

        const methods = [];

        // CNC Machining
        const machiningEstimate = await this.estimateMachiningCost(partData, partData.toolpaths || [], {
            machine: '3axis_mill',
            material: partData.material || 'aluminum_6061',
            quantity
        });
        methods.push({
            method: 'CNC Machining',
            cost: machiningEstimate.total,
            perUnit: machiningEstimate.perUnit,
            leadTimeDays: 7 + Math.ceil(quantity / 50),
            pros: ['High precision', 'Wide material selection', 'Good surface finish'],
            cons: ['Setup costs', 'Waste material']
        });

        // FDM 3D Printing
        const fdmEstimate = await this.estimateAdditiveCost(partData, { printTimeMinutes: 180 }, {
            printer: 'fdm_printer',
            material: 'PLA',
            quantity
        });
        methods.push({
            method: 'FDM 3D Printing',
            cost: fdmEstimate.total,
            perUnit: fdmEstimate.perUnit,
            leadTimeDays: 2 + Math.ceil(quantity / 10),
            pros: ['Low setup cost', 'Complex geometries', 'No tooling'],
            cons: ['Lower strength', 'Visible layer lines', 'Material limitations']
        });

        // SLS 3D Printing
        const slsEstimate = await this.estimateAdditiveCost(partData, { printTimeMinutes: 240 }, {
            printer: 'sls_printer',
            material: 'sls_nylon',
            quantity
        });
        methods.push({
            method: 'SLS 3D Printing',
            cost: slsEstimate.total,
            perUnit: slsEstimate.perUnit,
            leadTimeDays: 5 + Math.ceil(quantity / 20),
            pros: ['No supports needed', 'Good strength', 'Complex geometries'],
            cons: ['Higher cost', 'Rough surface finish']
        });

        // Sort by cost
        methods.sort((a, b) => a.perUnit - b.perUnit);

        // Get AI recommendation
        const aiPrompt = `Given a part with volume ${partData.volume}mm³, quantity ${quantity}, required in ${requiredLeadTime} days, recommend the best manufacturing method. Consider: ${JSON.stringify(methods.map(m => ({ method: m.method, cost: m.perUnit, leadTime: m.leadTimeDays })))}`;

        let aiRecommendation = null;
        try {
            aiRecommendation = await bedrockService.generateText(aiPrompt, { maxTokens: 200 });
        } catch (error) {
            console.warn('AI recommendation unavailable');
        }

        console.log(`✅ Method comparison complete`);

        return {
            methods,
            lowestCost: methods[0],
            fastestLeadTime: methods.sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0],
            aiRecommendation: aiRecommendation || 'AI recommendation unavailable',
            feasibleMethods: methods.filter(m => m.leadTimeDays <= requiredLeadTime)
        };
    }

    // Helper methods

    _calculateStockVolume(partData) {
        const bbox = partData.boundingBox || { x: 100, y: 100, z: 50 };
        return bbox.x * bbox.y * bbox.z; // mm³
    }

    _estimateMachiningTime(toolpaths) {
        if (!toolpaths || toolpaths.length === 0) return 60; // Default 60 min

        let totalTime = 0;
        toolpaths.forEach(tp => {
            const pathCount = tp.paths?.length || 10;
            totalTime += pathCount * 0.5; // 0.5 min per path segment
        });
        return totalTime + (toolpaths.length * 2); // Add tool change time
    }
}

module.exports = new CostEstimationService();
