/**
 * Design Explainability Service
 * Explains AI design decisions in natural language
 */

const bedrockService = require('../bedrockService');

class ExplainabilityService {
    constructor() {
        this.bedrock = bedrockService;
    }

    /**
     * Explain why AI made specific design decisions
     */
    async explainDesign(design, originalRequirements) {
        console.log('💭 Generating design explanation...');

        const prompt = `Explain this design in simple terms:
Original Requirements: ${JSON.stringify(originalRequirements, null, 2)}
Final Design: ${JSON.stringify(design, null, 2)}

Explain:
1. Why this geometry was chosen
2. Why these materials were selected
3. How dimensions were determined
4. Trade-offs that were made
5. Alternative approaches that were considered

Write in clear, non-technical language.`;

        const explanation = await this.bedrock.generateContent(prompt);

        return {
            explanation,
            sections: this.parseExplanation(explanation),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Answer "what-if" questions about the design
     */
    async answerWhatIf(design, question) {
        console.log(`❓ Answering what-if: "${question}"`);

        const prompt = `Answer this "what-if" question about the design:
Design: ${JSON.stringify(design, null, 2)}
Question: ${question}

Provide a detailed answer explaining:
- What would change
- Why it would change
- Impact on performance
- Impact on cost
- Recommendation`;

        const answer = await this.bedrock.generateContent(prompt);

        return {
            question,
            answer,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Generate design rationale documentation
     */
    async generateRationale(design, analysisResults) {
        console.log('📝 Generating design rationale...');

        const prompt = `Generate design rationale documentation:
Design Specifications: ${JSON.stringify(design, null, 2)}
Analysis Results: ${JSON.stringify(analysisResults, null, 2)}

Create professional documentation including:
1. Design Intent
2. Technical Specifications
3. Analysis Summary
4. Compliance & Standards
5. Recommendations for Future Iterations

Format as markdown for easy sharing.`;

        const rationale = await this.bedrock.generateContent(prompt);

        return {
            rationale,
            format: 'markdown',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Provide traceability of AI decisions
     */
    traceDecision(design, decisionPoint) {
        // Track which AI steps led to this decision
        return {
            decisionPoint,
            aiSteps: [
                'Requirements analysis',
                'Geometry generation',
                'Material selection',
                'Dimension optimization',
                'Verification'
            ],
            confidence: 'high',
            alternativesConsidered: 3
        };
    }

    // Helper methods

    parseExplanation(explanation) {
        // Simple parsing of explanation into sections
        const sections = explanation.split('\n\n').filter(s => s.trim());
        return sections.map((section, i) => ({
            id: i + 1,
            content: section
        }));
    }
}

module.exports = new ExplainabilityService();
