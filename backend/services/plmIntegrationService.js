/**
 * PLM Integration Service
 * Bridges the existing CAD API with the new multi-stage PLM system
 */

const multiStageOrchestrator = require('./multiStageOrchestrator');
const databaseService = require('./databaseService');
const mechanicalDomainOrchestrator = require('./mechanicalDomainOrchestrator');

class PLMIntegrationService {
    constructor() {
        this.useMultiStageWorkflow = process.env.USE_MULTISTAGE_PLM === 'true';
        console.log('🔗 PLM Integration Service initialized');
        console.log(`   Multi-stage workflow: ${this.useMultiStageWorkflow ? 'ENABLED' : 'DISABLED (using legacy)'}`);
    }

    /**
     * Main entry point for mechanical CAD generation
     * Routes to either multi-stage PLM system or legacy orchestrator
     */
    async generateMechanicalDesign(prompt, options = {}) {
        console.log('\n🚀 PLM Integration Service: Starting generation');
        console.log(`   Prompt: "${prompt}"`);
        console.log(`   Mode: ${this.useMultiStageWorkflow ? 'Multi-Stage PLM' : 'Legacy Orchestrator'}`);

        // Initialize database if needed
        await databaseService.initialize();

        // Decide which workflow to use
        if (this.useMultiStageWorkflow) {
            return await this.runMultiStageWorkflow(prompt, options);
        } else {
            return await this.runLegacyWorkflow(prompt, options);
        }
    }

    /**
     * Run the complete 5-phase PLM workflow
     */
    async runMultiStageWorkflow(prompt, options) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🏭 MULTI-STAGE PLM WORKFLOW (5 PHASES)');
        console.log('═══════════════════════════════════════════════════════════');

        try {
            const result = await multiStageOrchestrator.orchestrateCompleteWorkflow(prompt, {
                userId: options.userId || 'api-user',
                sessionId: options.sessionId
            });

            // Format response for API
            return {
                success: true,
                mode: 'multistage-plm',
                project: {
                    id: result.project.id,
                    name: result.project.name,
                    complexity_tier: result.project.complexity_tier,
                    phase: result.project.current_phase
                },
                design: result.design,
                validation: result.validation,
                manufacturing: result.manufacturing,
                metadata: {
                    total_iterations: result.totalIterations,
                    validation_passes: result.validationPasses,
                    validation_failures: result.validationFailures,
                    phases_completed: 5
                }
            };

        } catch (error) {
            console.error('❌ Multi-stage workflow failed:', error.message);

            // Record error in database
            await databaseService.recordError({
                errorType: error.name || 'WorkflowError',
                errorCategory: 'orchestration',
                errorMessage: error.message,
                orchestrationStage: 'multistage_workflow',
                severity: 'high'
            });

            throw error;
        }
    }

    /**
     * Run the legacy single-phase workflow (fallback)
     */
    async runLegacyWorkflow(prompt, options) {
        console.log('\n📐 LEGACY WORKFLOW (Single Phase CAD Generation)');

        try {
            const result = await mechanicalDomainOrchestrator.generateMechanicalDesign(prompt, {
                sessionId: options.sessionId
            });

            // Format response for API
            return {
                success: true,
                mode: 'legacy',
                design: result.design,
                validation: result.validation,
                context: result.context,
                metadata: result.metadata
            };

        } catch (error) {
            console.error('❌ Legacy workflow failed:', error.message);
            throw error;
        }
    }

    /**
     * Enable multi-stage workflow
     */
    enableMultiStageWorkflow() {
        this.useMultiStageWorkflow = true;
        console.log('✅ Multi-stage PLM workflow ENABLED');
    }

    /**
     * Disable multi-stage workflow (use legacy)
     */
    disableMultiStageWorkflow() {
        this.useMultiStageWorkflow = false;
        console.log('⚠️  Multi-stage PLM workflow DISABLED (using legacy)');
    }
}

// Export singleton
module.exports = new PLMIntegrationService();
