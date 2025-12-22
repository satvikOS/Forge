/**
 * Design Rationale Service
 * AI-powered explanations of design decisions, tolerances, and failure modes
 */

const bedrockService = require('../bedrockService');

class DesignRationaleService {
    constructor(bedrock) {
        this.bedrock = bedrock || bedrockService;
    }

    /**
     * Generate design rationale explanation
     */
    async explainDesign(modelData, context = {}) {
        const {
            focusAreas = ['overall', 'materials', 'tolerances', 'safety'],
            includeAlternatives = true,
            includeFMEA = true
        } = context;

        console.log('🧠 Generating design rationale explanation...');

        const prompt = this.buildRationalePrompt(modelData, focusAreas);

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 2000,
            temperature: 0.3
        });

        const rationale = {
            overall: this.extractSection(response, 'Overall Design'),
            materials: this.extractSection(response, 'Material Selection'),
            tolerances: this.extractSection(response, 'Tolerance Strategy'),
            safety: this.extractSection(response, 'Safety Considerations'),
            alternatives: includeAlternatives ? await this.explainAlternatives(modelData) : null,
            fmea: includeFMEA ? await this.generateFMEA(modelData) : null
        };

        return {
            success: true,
            rationale: rationale,
            fullExplanation: response
        };
    }

    /**
     * Build AI prompt for design rationale
     */
    buildRationalePrompt(modelData, focusAreas) {
        const { name, type, materials, dimensions, features, purpose } = modelData;

        return `You are a senior mechanical engineer explaining design decisions.

Part: ${name || 'Mechanical Component'}
Type: ${type || 'Part'}
Purpose: ${purpose || 'General mechanical component'}

${materials ? `Materials: ${JSON.stringify(materials)}` : ''}
${dimensions ? `Key Dimensions: ${JSON.stringify(dimensions)}` : ''}
${features ? `Features: ${features.join(', ')}` : ''}

Provide a professional design rationale covering:
${focusAreas.map(area => `- ${area.charAt(0).toUpperCase() + area.slice(1)}`).join('\n')}

Format your response with clear sections. Explain WHY each decision was made, not just WHAT was decided.
Include technical justifications and industry best practices.`;
    }

    /**
     * Extract section from AI response
     */
    extractSection(text, sectionName) {
        // Simple regex to extract section
        const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n\\n[A-Z]|$)`, 'i');
        const match = text.match(regex);

        return match ? match[1].trim() : `${sectionName} rationale not provided.`;
    }

    /**
     * Explain tolerance justifications
     */
    async explainTolerances(modelData, tolerance) {
        const prompt = `As a manufacturing engineer, explain why this tolerance is appropriate:

Component: ${modelData.name}
Feature: ${tolerance.feature}
Tolerance: ${tolerance.value} ${tolerance.unit}
Manufacturing Process: ${tolerance.process || 'CNC machining'}

Explain:
1. Why this tolerance level is necessary
2. How it affects manufacturing cost
3. Alternatives and trade-offs
4. Industry standards reference (ISO 286, etc.)`;

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 500,
            temperature: 0.3
        });

        return {
            feature: tolerance.feature,
            tolerance: tolerance.value,
            justification: response,
            costImpact: this.estimateToleranceCost(tolerance.value),
            standard: 'ISO 286-2'
        };
    }

    /**
     * Explain material selection
     */
    async explainMaterialChoice(modelData, material) {
        const prompt = `As a materials engineer, explain why this material was selected:

Component: ${modelData.name}
Application: ${modelData.purpose || 'General use'}
Material: ${material.name}
Properties:
- Elastic Modulus: ${material.elasticModulus || 'N/A'}
- Yield Strength: ${material.yieldStrength || 'N/A'}
- Density: ${material.density || 'N/A'}

Explain:
1. Why this material is suitable for the application
2. Advantages over alternatives (steel, aluminum, plastic, etc.)
3. Cost vs. performance trade-off
4. Manufacturing considerations`;

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 500,
            temperature: 0.3
        });

        return {
            material: material.name,
            rationale: response,
            alternatives: ['Steel 1045', 'Aluminum 6061', 'Stainless Steel 304'],
            costRating: this.rateMaterialCost(material.name)
        };
    }

    /**
     * Generate FMEA (Failure Mode and Effects Analysis)
     */
    async generateFMEA(modelData) {
        console.log('📋 Generating FMEA...');

        const prompt = `Perform a Failure Mode and Effects Analysis (FMEA) for:

Component: ${modelData.name}
Type: ${modelData.type}
Application: ${modelData.purpose || 'Mechanical component'}

Identify at least 3 potential failure modes and for each provide:
1. Failure Mode: How it could fail
2. Effects: What happens when it fails
3. Severity (1-10): How bad is the failure
4. Cause: Why it might fail
5. Occurrence (1-10): How likely to occur
6. Detection (1-10): How easy to detect before failure
7. RPN: Risk Priority Number (Severity × Occurrence × Detection)
8. Recommended Actions: How to mitigate

Format as a structured table.`;

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 1500,
            temperature: 0.4
        });

        return {
            component: modelData.name,
            failureModes: this.parseFMEA(response),
            generatedAt: new Date().toISOString(),
            fullReport: response
        };
    }

    /**
     * Parse FMEA from AI response
     */
    parseFMEA(text) {
        // Simplified parsing - in production use proper NLP
        const modes = [];

        // Extract common failure types as defaults
        modes.push({
            id: 1,
            mode: 'Fatigue Failure',
            effect: 'Component fracture under cyclic loading',
            severity: 9,
            cause: 'Repeated stress cycles, stress concentrations',
            occurrence: 5,
            detection: 4,
            rpn: 180,
            actions: ['Add fillets to reduce stress concentration', 'Specify fatigue-resistant material', 'Perform fatigue testing']
        });

        modes.push({
            id: 2,
            mode: 'Yielding/Plastic Deformation',
            effect: 'Permanent deformation under load',
            severity: 7,
            cause: 'Overload, inadequate safety factor',
            occurrence: 3,
            detection: 6,
            rpn: 126,
            actions: ['Increase material thickness', 'Use higher strength material', 'Add load limiters']
        });

        modes.push({
            id: 3,
            mode: 'Corrosion',
            effect: 'Material degradation, reduced strength',
            severity: 6,
            cause: 'Environmental exposure, moisture, chemicals',
            occurrence: 4,
            detection: 5,
            rpn: 120,
            actions: ['Apply protective coating', 'Use corrosion-resistant material', 'Design for drainage']
        });

        return modes;
    }

    /**
     * Explain design alternatives
     */
    async explainAlternatives(modelData) {
        const prompt = `For this component: ${modelData.name}

Current Design Approach: ${modelData.approach || 'Feature-based parametric design'}

Suggest 3 alternative design approaches and explain:
1. Alternative approach description
2. Advantages over current design
3. Disadvantages
4. When to use this alternative

Be specific and technical.`;

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 1000,
            temperature: 0.5
        });

        return {
            currentApproach: modelData.approach || 'Current design',
            alternatives: this.parseAlternatives(response),
            fullAnalysis: response
        };
    }

    /**
     * Parse alternatives from response
     */
    parseAlternatives(text) {
        // Simplified - return generic alternatives
        return [
            {
                approach: 'Topology Optimized Design',
                advantages: 'Optimal material distribution, weight reduction',
                disadvantages: 'Complex geometry, higher manufacturing cost',
                whenToUse: 'Weight-critical applications, high-performance requirements'
            },
            {
                approach: 'Sheet Metal Fabrication',
                advantages: 'Lower cost for large quantities, faster production',
                disadvantages: 'Limited geometric complexity, requires tooling',
                whenToUse: 'High-volume production, simple geometries'
            },
            {
                approach: 'Additive Manufacturing (3D Printing)',
                advantages: 'Complex geometries, no tooling, rapid prototyping',
                disadvantages: 'Slower production, material limitations',
                whenToUse: 'Prototypes, low-volume production, complex internal features'
            }
        ];
    }

    /**
     * Generate regulatory compliance explanation
     */
    async explainCompliance(modelData, standards = []) {
        const prompt = `Explain how this design complies with relevant standards:

Component: ${modelData.name}
Industry: ${modelData.industry || 'General mechanical'}
Standards: ${standards.join(', ') || 'ISO, ASME, CE'}

Provide:
1. Applicable standards and why they apply
2. Key requirements from each standard
3. How the design meets these requirements
4. Any potential compliance issues
5. Recommended testing/certification`;

        const response = await this.bedrock.generateText({
            prompt: prompt,
            maxTokens: 1000,
            temperature: 0.3
        });

        return {
            standards: standards,
            complianceAnalysis: response,
            certificationRequired: true,
            estimatedComplianceCost: this.estimateComplianceCost(standards.length)
        };
    }

    // Helper methods

    estimateToleranceCost(toleranceValue) {
        // Tighter tolerance = higher cost
        if (toleranceValue < 0.01) return 'Very High';
        if (toleranceValue < 0.05) return 'High';
        if (toleranceValue < 0.1) return 'Medium';
        return 'Low';
    }

    rateMaterialCost(materialName) {
        const costs = {
            'Steel': 'Low',
            'Aluminum': 'Medium',
            'Stainless Steel': 'Medium-High',
            'Titanium': 'Very High',
            'Carbon Fiber': 'Very High'
        };

        for (const [key, value] of Object.entries(costs)) {
            if (materialName.includes(key)) return value;
        }

        return 'Medium';
    }

    estimateComplianceCost(standardCount) {
        return `$${standardCount * 5000} - $${standardCount * 15000}`;
    }
}

module.exports = DesignRationaleService;
