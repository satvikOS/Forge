/**
 * Database Service - PostgreSQL Connection and PLM Operations
 *
 * Manages:
 * - Project lifecycle tracking
 * - Model storage and versioning
 * - AI generation logging
 * - Error pattern learning
 * - Knowledge base extraction
 */

const { Pool } = require('pg');

class DatabaseService {
    constructor() {
        // PostgreSQL connection pool
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'archdiscv1_plm',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
            max: 20, // Maximum pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.initialized = false;
        console.log('📊 Database Service initialized');
    }

    /**
     * Initialize database connection and schema
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Test connection
            const client = await this.pool.connect();
            const result = await client.query('SELECT NOW()');
            client.release();

            console.log('✅ Database connected:', result.rows[0].now);
            this.initialized = true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            console.warn('⚠️  Running in NO-DATABASE mode (in-memory only)');
            this.initialized = false;
        }
    }

    // ================================================================
    // PROJECT MANAGEMENT
    // ================================================================

    /**
     * Create new engineering project
     */
    async createProject({
        name,
        description,
        complexityTier,
        userId
    }) {
        if (!this.initialized) {
            console.warn('⚠️  Database not available, returning mock project ID');
            return { id: `mock-${Date.now()}`, complexity_tier: complexityTier };
        }

        const query = `
            INSERT INTO projects (name, description, complexity_tier, user_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

        try {
            const result = await this.pool.query(query, [name, description, complexityTier, userId]);
            console.log(`✅ Project created: ${result.rows[0].id} (${complexityTier})`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Failed to create project:', error.message);
            throw error;
        }
    }

    /**
     * Update project phase
     */
    async updateProjectPhase(projectId, newPhase) {
        if (!this.initialized) return;

        const query = `
            UPDATE projects
            SET current_phase = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `;

        const result = await this.pool.query(query, [newPhase, projectId]);
        console.log(`📋 Project ${projectId} moved to phase: ${newPhase}`);
        return result.rows[0];
    }

    /**
     * Mark project as completed
     */
    async completeProject(projectId, metrics) {
        if (!this.initialized) return;

        const query = `
            UPDATE projects
            SET status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                total_generation_time_seconds = $1,
                ai_iterations_count = $2,
                validation_passes = $3,
                validation_failures = $4
            WHERE id = $5
            RETURNING *
        `;

        const result = await this.pool.query(query, [
            metrics.totalTime || 0,
            metrics.aiIterations || 0,
            metrics.validationPasses || 0,
            metrics.validationFailures || 0,
            projectId
        ]);

        console.log(`✅ Project ${projectId} completed`);

        // Extract knowledge from successful project
        await this.pool.query('SELECT extract_successful_pattern($1)', [projectId]);

        return result.rows[0];
    }

    // ================================================================
    // DESIGN MODEL STORAGE
    // ================================================================

    /**
     * Save design model with geometry and specifications
     */
    async saveDesignModel({
        projectId,
        modelName,
        modelType,
        geometry,
        materials,
        dimensions,
        manufacturing,
        validationResults,
        qualityScore,
        generationTime,
        aiModel
    }) {
        if (!this.initialized) {
            console.warn('⚠️  Database not available, model not persisted');
            return { id: `mock-model-${Date.now()}` };
        }

        const query = `
            INSERT INTO design_models (
                project_id,
                model_name,
                model_type,
                geometry,
                vertex_count,
                face_count,
                materials,
                dimensions,
                manufacturing_process,
                manufacturing_steps,
                validation_results,
                quality_score,
                production_ready,
                generation_time_seconds,
                created_by_ai_model
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (project_id, model_name, version)
            DO UPDATE SET version = design_models.version + 1
            RETURNING *
        `;

        const vertexCount = geometry.vertices ? geometry.vertices.length : 0;
        const faceCount = geometry.faces ? geometry.faces.length : 0;
        const productionReady = qualityScore >= 85;

        try {
            const result = await this.pool.query(query, [
                projectId,
                modelName,
                modelType,
                JSON.stringify(geometry),
                vertexCount,
                faceCount,
                JSON.stringify(materials),
                JSON.stringify(dimensions),
                manufacturing?.primary_process || null,
                JSON.stringify(manufacturing?.process_sequence || []),
                JSON.stringify(validationResults || {}),
                qualityScore,
                productionReady,
                generationTime,
                aiModel
            ]);

            console.log(`✅ Model saved: ${modelName} (${vertexCount} vertices, quality: ${qualityScore})`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Failed to save model:', error.message);
            throw error;
        }
    }

    /**
     * Get previous similar models for learning
     */
    async getSimilarModels(complexityTier, minQualityScore = 70, limit = 10) {
        if (!this.initialized) return [];

        const query = `
            SELECT dm.*, p.complexity_tier
            FROM design_models dm
            JOIN projects p ON dm.project_id = p.id
            WHERE p.complexity_tier = $1
              AND dm.quality_score >= $2
              AND dm.production_ready = true
            ORDER BY dm.quality_score DESC, dm.created_at DESC
            LIMIT $3
        `;

        try {
            const result = await this.pool.query(query, [complexityTier, minQualityScore, limit]);
            console.log(`📚 Found ${result.rows.length} similar successful models`);
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to query similar models:', error.message);
            return [];
        }
    }

    // ================================================================
    // AI GENERATION LOGGING
    // ================================================================

    /**
     * Log AI generation attempt with full details
     */
    async logAIGeneration({
        projectId,
        modelId,
        aiModel,
        orchestrationStage,
        promptTemplateVersion,
        promptTokensInput,
        promptTokensOutput,
        promptFullText,
        responseRaw,
        responseParsed,
        responseValid,
        responseError,
        executionTime,
        retryCount,
        geometryValidationPassed,
        complexityRequirementMet,
        vertexCountGenerated,
        vertexCountRequired
    }) {
        if (!this.initialized) return;

        const query = `
            INSERT INTO ai_generation_logs (
                project_id,
                model_id,
                ai_model,
                orchestration_stage,
                prompt_template_version,
                prompt_tokens_input,
                prompt_tokens_output,
                prompt_full_text,
                response_raw,
                response_parsed,
                response_valid,
                response_error,
                execution_time_seconds,
                retry_count,
                geometry_validation_passed,
                complexity_requirement_met,
                vertex_count_generated,
                vertex_count_required
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING id
        `;

        try {
            const result = await this.pool.query(query, [
                projectId,
                modelId,
                aiModel,
                orchestrationStage,
                promptTemplateVersion,
                promptTokensInput,
                promptTokensOutput,
                promptFullText,
                responseRaw,
                JSON.stringify(responseParsed),
                responseValid,
                responseError,
                executionTime,
                retryCount,
                geometryValidationPassed,
                complexityRequirementMet,
                vertexCountGenerated,
                vertexCountRequired
            ]);

            console.log(`📝 AI generation logged: ${orchestrationStage}`);
            return result.rows[0].id;
        } catch (error) {
            console.error('❌ Failed to log AI generation:', error.message);
        }
    }

    // ================================================================
    // ERROR PATTERN LEARNING
    // ================================================================

    /**
     * Record error pattern for learning
     */
    async recordError({
        errorType,
        errorCategory,
        errorMessage,
        complexityTier,
        orchestrationStage,
        severity = 'medium'
    }) {
        if (!this.initialized) return;

        try {
            const result = await this.pool.query(
                'SELECT record_error_pattern($1, $2, $3, $4, $5)',
                [errorType, errorCategory, errorMessage, complexityTier, orchestrationStage]
            );

            console.log(`🔴 Error pattern recorded: ${errorType}`);
            return result.rows[0].record_error_pattern;
        } catch (error) {
            console.error('❌ Failed to record error pattern:', error.message);
        }
    }

    /**
     * Get common error patterns for a complexity tier
     */
    async getCommonErrors(complexityTier, limit = 10) {
        if (!this.initialized) return [];

        const query = `
            SELECT *
            FROM error_patterns
            WHERE complexity_tier = $1
            ORDER BY error_frequency DESC
            LIMIT $2
        `;

        try {
            const result = await this.pool.query(query, [complexityTier, limit]);
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to query error patterns:', error.message);
            return [];
        }
    }

    // ================================================================
    // KNOWLEDGE BASE
    // ================================================================

    /**
     * Get relevant knowledge for current design
     */
    async getRelevantKnowledge({
        complexityTier,
        knowledgeType,
        minConfidence = 70
    }) {
        if (!this.initialized) return [];

        const query = `
            SELECT *
            FROM knowledge_base
            WHERE complexity_tier = $1
              AND knowledge_type = $2
              AND confidence_score >= $3
            ORDER BY confidence_score DESC, application_count DESC
            LIMIT 5
        `;

        try {
            const result = await this.pool.query(query, [complexityTier, knowledgeType, minConfidence]);
            console.log(`🧠 Retrieved ${result.rows.length} knowledge items`);
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to query knowledge base:', error.message);
            return [];
        }
    }

    /**
     * Add learned knowledge to database
     */
    async addKnowledge({
        knowledgeType,
        complexityTier,
        title,
        description,
        detailedExplanation,
        mathematicalModel,
        exampleProjectIds = [],
        confidenceScore
    }) {
        if (!this.initialized) return;

        const query = `
            INSERT INTO knowledge_base (
                knowledge_type,
                complexity_tier,
                title,
                description,
                detailed_explanation,
                mathematical_model,
                example_project_ids,
                confidence_score
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        try {
            const result = await this.pool.query(query, [
                knowledgeType,
                complexityTier,
                title,
                description,
                detailedExplanation,
                mathematicalModel,
                exampleProjectIds,
                confidenceScore
            ]);

            console.log(`🧠 Knowledge added: ${title}`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Failed to add knowledge:', error.message);
        }
    }

    // ================================================================
    // SIMULATION RESULTS
    // ================================================================

    /**
     * Save simulation results (FEA, CFD, etc.)
     */
    async saveSimulationResult({
        modelId,
        simulationType,
        solverSoftware,
        results,
        passed,
        safetyFactor,
        maxStressMpa,
        maxTemperatureC,
        computationTime
    }) {
        if (!this.initialized) return;

        const query = `
            INSERT INTO simulation_results (
                model_id,
                simulation_type,
                solver_software,
                results,
                passed,
                safety_factor,
                max_stress_mpa,
                max_temperature_c,
                computation_time_seconds
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;

        try {
            const result = await this.pool.query(query, [
                modelId,
                simulationType,
                solverSoftware,
                JSON.stringify(results),
                passed,
                safetyFactor,
                maxStressMpa,
                maxTemperatureC,
                computationTime
            ]);

            console.log(`🔬 Simulation saved: ${simulationType} - ${passed ? 'PASS' : 'FAIL'}`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Failed to save simulation:', error.message);
        }
    }

    // ================================================================
    // PHASE WORKFLOW TRACKING
    // ================================================================

    /**
     * Start new workflow phase
     */
    async startPhase(projectId, phaseNumber, phaseName) {
        if (!this.initialized) return { id: `mock-phase-${phaseNumber}` };

        const query = `
            INSERT INTO phase_workflows (project_id, phase_number, phase_name, status)
            VALUES ($1, $2, $3, 'in_progress')
            RETURNING *
        `;

        const result = await this.pool.query(query, [projectId, phaseNumber, phaseName]);
        console.log(`🚀 Phase ${phaseNumber} started: ${phaseName}`);
        return result.rows[0];
    }

    /**
     * Complete workflow phase
     */
    async completePhase(phaseId, deliverables, gateCriteriaMet = true) {
        if (!this.initialized) return;

        const query = `
            UPDATE phase_workflows
            SET status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                deliverables = $1,
                gate_criteria_met = $2,
                duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))
            WHERE id = $3
            RETURNING *
        `;

        const result = await this.pool.query(query, [
            JSON.stringify(deliverables),
            gateCriteriaMet,
            phaseId
        ]);

        console.log(`✅ Phase completed: ${result.rows[0].phase_name}`);
        return result.rows[0];
    }

    // ================================================================
    // STATISTICS & ANALYTICS
    // ================================================================

    /**
     * Get project statistics for optimization
     */
    async getProjectStatistics() {
        if (!this.initialized) return null;

        try {
            // Refresh materialized view
            await this.pool.query('REFRESH MATERIALIZED VIEW project_statistics');

            const result = await this.pool.query('SELECT * FROM project_statistics');
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to get statistics:', error.message);
            return null;
        }
    }

    /**
     * Cleanup and close pool
     */
    async shutdown() {
        if (this.pool) {
            await this.pool.end();
            console.log('📊 Database connection pool closed');
        }
    }
}

// Export singleton
module.exports = new DatabaseService();
