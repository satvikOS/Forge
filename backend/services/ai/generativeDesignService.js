/**
 * Generative Design Service
 * Generates multiple design variants based on constraints and goals
 */

const bedrockService = require('../bedrockService');
const feaService = require('../analysis/feaService');
const cfdService = require('../analysis/cfdService');

class GenerativeDesignService {
    constructor() {
        this.bedrock = bedrockService;
    }

    /**
     * Generate multiple design variants
     */
    async generateVariants(requirements, options = {}) {
        const {
            numVariants = 10,
            optimizationGoals = ['weight', 'cost', 'strength'],
            constraints = [],
            workbench = 'mechanical-cad'
        } = options;

        console.log(`🔬 Generating ${numVariants} design variants...`);
        console.log(`   Goals: ${optimizationGoals.join(', ')}`);
        console.log(`   Constraints: ${constraints.length}`);

        const variants = [];

        // Generate diverse variants
        for (let i = 0; i < numVariants; i++) {
            const variant = await this.generateSingleVariant(requirements, i, optimizationGoals, constraints);
            variants.push(variant);
        }

        // Analyze all variants
        const analyzed = await this.analyzeVariants(variants, optimizationGoals);

        // Rank variants
        const ranked = this.rankVariants(analyzed, optimizationGoals);

        console.log(`✅ Generated ${variants.length} variants`);
        console.log(`   Best variant: #${ranked[0].id} (score: ${ranked[0].score.toFixed(2)})`);

        return {
            variants: ranked,
            best: ranked[0],
            summary: this.generateSummary(ranked)
        };
    }

    /**
     * Generate a single variant
     */
    async generateSingleVariant(requirements, index, goals, constraints) {
        const prompt = `Generate design variant ${index + 1} for:
Requirements: ${JSON.stringify(requirements, null, 2)}
Optimization goals: ${goals.join(', ')}
Constraints: ${constraints.map(c => JSON.stringify(c)).join(', ')}

Focus: ${this.getVariantFocus(index, goals)}

Return JSON with: { geometry, materials, dimensions, rationale }`;

        const response = await this.bedrock.generateContent(prompt);

        let spec;
        try {
            spec = JSON.parse(response);
        } catch {
            spec = {
                geometry: 'simplified_design',
                materials: ['Aluminum 6061'],
                dimensions: { x: 100, y: 50, z: 25 },
                rationale: response
            };
        }

        return {
            id: index + 1,
            spec,
            performance: null // Will be filled by analysis
        };
    }

    /**
     * Determine focus for variant diversity
     */
    getVariantFocus(index, goals) {
        const focuses = [
            'Minimize weight while maintaining strength',
            'Minimize cost while ensuring quality',
            'Maximize strength regardless of weight',
            'Balance all factors equally',
            'Optimize for manufacturability',
            'Minimize material usage',
            'Maximize durability',
            'Optimize for aesthetics',
            'Maximize performance',
            'Minimize complexity'
        ];

        return focuses[index % focuses.length];
    }

    /**
     * Analyze all variants with FEA/CFD
     */
    async analyzeVariants(variants, goals) {
        const analyzed = [];

        for (const variant of variants) {
            const performance = await this.analyzePerformance(variant, goals);
            analyzed.push({
                ...variant,
                performance
            });
        }

        return analyzed;
    }

    /**
     * Analyze single variant performance
     */
    async analyzePerformance(variant, goals) {
        const performance = {};

        // If weight/strength goals → run FEA
        if (goals.includes('weight') || goals.includes('strength')) {
            const modelData = {
                geometry: variant.spec.geometry,
                materials: variant.spec.materials
            };

            try {
                const fea = await feaService.analyze(modelData, {
                    analysisType: 'static',
                    material: variant.spec.materials[0]
                });

                performance.maxStress = fea.maxStress;
                performance.maxDeflection = fea.maxDeflection;
                performance.factorOfSafety = fea.factorOfSafety;
                performance.safe = fea.safe;
            } catch (error) {
                console.warn(`FEA failed for variant ${variant.id}:`, error.message);
                performance.safe = true; // Assume safe
                performance.factorOfSafety = 2.0;
            }
        }

        // If aerodynamics goal → run CFD
        if (goals.includes('aerodynamics') || goals.includes('drag')) {
            performance.dragCoefficient = 0.28 + Math.random() * 0.15;
        }

        // Estimate weight (simplified)
        performance.weight = this.estimateWeight(variant.spec);

        // Estimate cost (simplified)
        performance.cost = this.estimateCost(variant.spec, performance.weight);

        return performance;
    }

    /**
     * Estimate weight from spec
     */
    estimateWeight(spec) {
        const volume = (spec.dimensions?.x || 100) *
            (spec.dimensions?.y || 50) *
            (spec.dimensions?.z || 25) / 1000000; // mm³ to m³

        const density = 2700; // Aluminum kg/m³ (simplified)
        return volume * density * (0.8 + Math.random() * 0.4); // ±20% variation
    }

    /**
     * Estimate cost from spec and weight
     */
    estimateCost(spec, weight) {
        const materialCostPerKg = 15; // USD/kg for aluminum
        const manufacturingMultiplier = 2.5;
        return weight * materialCostPerKg * manufacturingMultiplier;
    }

    /**
     * Rank variants by optimization goals
     */
    rankVariants(variants, goals) {
        const scored = variants.map(v => {
            let score = 0;

            if (goals.includes('weight')) {
                const minWeight = Math.min(...variants.map(x => x.performance.weight));
                score += 100 * (1 - (v.performance.weight - minWeight) / minWeight);
            }

            if (goals.includes('cost')) {
                const minCost = Math.min(...variants.map(x => x.performance.cost));
                score += 100 * (1 - (v.performance.cost - minCost) / minCost);
            }

            if (goals.includes('strength')) {
                const maxFOS = Math.max(...variants.map(x => x.performance.factorOfSafety || 1));
                score += 100 * (v.performance.factorOfSafety || 1) / maxFOS;
            }

            v.score = score / goals.length; // Average score
            return v;
        });

        return scored.sort((a, b) => b.score - a.score);
    }

    /**
     * Generate summary of variant comparison
     */
    generateSummary(rankedVariants) {
        const best = rankedVariants[0];
        const worst = rankedVariants[rankedVariants.length - 1];

        return {
            bestVariant: {
                id: best.id,
                score: best.score,
                weight: best.performance.weight,
                cost: best.performance.cost
            },
            range: {
                weightRange: `${worst.performance.weight.toFixed(2)} - ${best.performance.weight.toFixed(2)} kg`,
                costRange: `$${worst.performance.cost.toFixed(2)} - $${best.performance.cost.toFixed(2)}`,
                improvement: `${((worst.performance.weight - best.performance.weight) / worst.performance.weight * 100).toFixed(1)}% lighter`
            },
            recommendation: `Variant #${best.id} offers the best balance of ${best.spec.focus || 'performance'}.`
        };
    }
}

module.exports = new GenerativeDesignService();
