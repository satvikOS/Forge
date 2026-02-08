/**
 * Parallel Agent Service
 * Dispatches prompts to multiple AI models simultaneously via AWS Bedrock.
 * Each agent has a role (geometry, analysis, materials, orchestrator).
 * Results are merged by the orchestrator agent or by strategy.
 */
const { getParallelConfig, getModelById, getFallbackChain } = require('../config/modelConfig');
const bedrockService = require('./bedrockService');

class ParallelAgentService {
    constructor() {
        this.activeRuns = new Map();
    }

    /**
     * Run agents in parallel for a given task
     * @param {string} taskType - Task type from modelConfig (e.g., 'design-generation')
     * @param {string} prompt - The prompt to send to all agents
     * @param {object} options - Additional options (systemPrompt, onProgress, etc.)
     * @returns {object} Merged result from all agents
     */
    async runParallel(taskType, prompt, options = {}) {
        const config = getParallelConfig(taskType);
        const runId = `run_${Date.now()}`;

        console.log(`\n🚀 PARALLEL AGENT RUN [${runId}]`);
        console.log(`   Task: ${taskType}`);
        console.log(`   Agents: ${config.parallel.join(', ')}`);
        console.log(`   Merger: ${config.merger || 'none'}`);
        console.log(`   Strategy: ${config.strategy}`);

        const run = {
            id: runId,
            taskType,
            startTime: Date.now(),
            agents: {},
            status: 'running',
        };
        this.activeRuns.set(runId, run);

        try {
            // ─── Step 1: Dispatch to all parallel agents simultaneously ────
            const agentPromises = config.parallel.map(async (modelKey) => {
                const model = getModelById(modelKey);
                if (!model) {
                    console.warn(`   ⚠️  Model ${modelKey} not found in catalog`);
                    return { modelKey, success: false, error: 'Model not found' };
                }

                const agentStart = Date.now();
                console.log(`   🤖 [${model.agentName}] Starting (${model.name})...`);

                try {
                    // Build agent-specific prompt with role context
                    const agentPrompt = this._buildAgentPrompt(model, prompt, options);

                    const result = await bedrockService.generateContent(agentPrompt, {
                        modelId: model.id,
                        maxTokens: model.maxTokens,
                        temperature: model.temperature,
                    });

                    const duration = Date.now() - agentStart;
                    console.log(`   ✅ [${model.agentName}] Completed in ${duration}ms (${result?.length || 0} chars)`);

                    // Try to parse as JSON
                    let parsed = null;
                    try {
                        parsed = bedrockService.parseJSON(result);
                    } catch (e) {
                        // Not JSON — that's ok for some tasks
                    }

                    return {
                        modelKey,
                        model,
                        success: true,
                        raw: result,
                        parsed,
                        duration,
                    };
                } catch (error) {
                    const duration = Date.now() - agentStart;
                    console.error(`   ❌ [${model.agentName}] Failed in ${duration}ms: ${error.message}`);
                    return {
                        modelKey,
                        model,
                        success: false,
                        error: error.message,
                        duration,
                    };
                }
            });

            // Wait for ALL agents to complete
            const agentResults = await Promise.allSettled(agentPromises);
            const results = agentResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });

            // Store results
            for (const r of results) {
                run.agents[r.modelKey || 'unknown'] = r;
            }

            const successfulResults = results.filter(r => r.success);
            console.log(`   📊 ${successfulResults.length}/${results.length} agents succeeded`);

            if (successfulResults.length === 0) {
                // All agents failed — try sequential fallback
                console.log('   ⚠️  All parallel agents failed, trying sequential fallback...');
                const fallbackResult = await this._runFallback(prompt, options);
                run.status = 'completed-fallback';
                run.endTime = Date.now();
                return fallbackResult;
            }

            // ─── Step 2: Apply merge strategy ──────────────────────────────
            let mergedResult;

            switch (config.strategy) {
                case 'merge-best':
                    mergedResult = await this._mergeBest(successfulResults, config, prompt, options);
                    break;
                case 'fastest':
                    mergedResult = this._selectFastest(successfulResults);
                    break;
                case 'best-questions':
                    mergedResult = this._selectBestQuestions(successfulResults);
                    break;
                case 'strictest':
                    mergedResult = this._selectStrictest(successfulResults);
                    break;
                default:
                    mergedResult = successfulResults[0];
            }

            run.status = 'completed';
            run.endTime = Date.now();
            console.log(`   ✅ PARALLEL RUN COMPLETE in ${run.endTime - run.startTime}ms\n`);

            return {
                success: true,
                result: mergedResult?.parsed || mergedResult?.raw,
                raw: mergedResult?.raw,
                agentResults: results.map(r => ({
                    agent: r.model?.agentName || 'Unknown',
                    model: r.model?.name || 'Unknown',
                    success: r.success,
                    duration: r.duration,
                })),
                totalDuration: run.endTime - run.startTime,
                strategy: config.strategy,
            };

        } catch (error) {
            run.status = 'failed';
            run.endTime = Date.now();
            console.error(`   ❌ PARALLEL RUN FAILED: ${error.message}`);
            throw error;
        }
    }

    /**
     * Build agent-specific prompt with role context
     */
    _buildAgentPrompt(model, userPrompt, options) {
        const systemPrompt = options.systemPrompt || '';
        const roleInstructions = this._getRoleInstructions(model.role);

        return `${roleInstructions}

${systemPrompt}

${userPrompt}`;
    }

    _getRoleInstructions(role) {
        switch (role) {
            case 'geometry':
                return `ROLE: You are the Geometry Agent. Your PRIMARY responsibility is generating precise 3D geometry.
Focus on: vertices, faces, dimensions, feature trees, parametric construction sequences.
Output: Valid JSON with detailed geometry data (vertices arrays, face indices, positions).
Prioritize: Mathematical precision, correct topology, manufacturing-feasible geometry.`;

            case 'analysis':
                return `ROLE: You are the Analysis Agent. Your PRIMARY responsibility is design review and validation.
Focus on: manufacturability (DFM), structural integrity, compatibility between components, error detection.
Output: Valid JSON with analysis results, issues found, severity ratings, and fix suggestions.
Prioritize: Catching errors, safety concerns, manufacturing constraints, tolerance issues.`;

            case 'materials':
                return `ROLE: You are the Materials Agent. Your PRIMARY responsibility is material and standards specification.
Focus on: material selection, GD&T specifications, standards compliance (ISO/ASME), tolerance analysis.
Output: Valid JSON with material properties, tolerance callouts, surface finish specs, and standard references.
Prioritize: Correct material for application, proper tolerances, standards compliance.`;

            case 'orchestrator':
                return `ROLE: You are the Orchestrator Agent. Your PRIMARY responsibility is merging results from multiple AI agents into the best possible output.
You will receive outputs from: Geometry Agent, Analysis Agent, and Materials Agent.
Merge strategy: Take the best geometry from Geometry Agent, incorporate analysis findings, and apply materials specifications.
Output: A single unified JSON combining the best elements from all agents.
Prioritize: Consistency, completeness, and resolving conflicts between agent outputs.`;

            default:
                return '';
        }
    }

    /**
     * Merge strategy: Take best elements from each agent's output
     */
    async _mergeBest(results, config, prompt, options) {
        // If we have a merger model, use it to intelligently merge
        if (config.merger) {
            const mergerModel = getModelById(config.merger);
            if (mergerModel) {
                try {
                    const agentOutputs = results.map(r =>
                        `=== ${r.model?.agentName || 'Agent'} (${r.model?.name || 'Unknown'}) ===\n${r.raw || JSON.stringify(r.parsed)}`
                    ).join('\n\n');

                    const mergePrompt = `${this._getRoleInstructions('orchestrator')}

ORIGINAL USER REQUEST:
${prompt}

AGENT OUTPUTS TO MERGE:
${agentOutputs}

Merge these agent outputs into a single, optimal result. Take the best elements from each:
- Geometry/dimensions from the Geometry Agent
- Analysis/validation from the Analysis Agent
- Materials/tolerances from the Materials Agent

Return ONLY valid JSON — the merged final output.`;

                    console.log(`   🔄 [Orchestrator] Merging ${results.length} agent outputs...`);
                    const merged = await bedrockService.generateContent(mergePrompt, {
                        modelId: mergerModel.id,
                        maxTokens: mergerModel.maxTokens,
                        temperature: mergerModel.temperature,
                    });

                    const parsed = bedrockService.parseJSON(merged);
                    if (parsed) {
                        console.log('   ✅ [Orchestrator] Merge complete');
                        return { raw: merged, parsed, model: mergerModel };
                    }
                } catch (error) {
                    console.error(`   ⚠️  Orchestrator merge failed: ${error.message}, using best single result`);
                }
            }
        }

        // Fallback: return the result with the most complete parsed JSON
        return this._selectMostComplete(results);
    }

    _selectFastest(results) {
        return results.reduce((best, r) => (!best || r.duration < best.duration) ? r : best, null);
    }

    _selectBestQuestions(results) {
        // Select the result with the most clarification questions
        return results.reduce((best, r) => {
            const qCount = r.parsed?.questions?.length || 0;
            const bestCount = best?.parsed?.questions?.length || 0;
            return qCount > bestCount ? r : best;
        }, results[0]);
    }

    _selectStrictest(results) {
        // Select the result that flags the most issues (most conservative)
        return results.reduce((best, r) => {
            const issues = r.parsed?.issues?.length || 0;
            const bestIssues = best?.parsed?.issues?.length || 0;
            return issues > bestIssues ? r : best;
        }, results[0]);
    }

    _selectMostComplete(results) {
        return results.reduce((best, r) => {
            const keys = r.parsed ? Object.keys(r.parsed).length : 0;
            const bestKeys = best?.parsed ? Object.keys(best.parsed).length : 0;
            return keys > bestKeys ? r : best;
        }, results[0]);
    }

    /**
     * Sequential fallback when all parallel agents fail
     */
    async _runFallback(prompt, options) {
        const chain = getFallbackChain();
        for (const model of chain) {
            try {
                console.log(`   🔄 Fallback: Trying ${model.name}...`);
                const result = await bedrockService.generateContent(
                    (options.systemPrompt || '') + '\n\n' + prompt,
                    { modelId: model.id, maxTokens: model.maxTokens, temperature: model.temperature }
                );
                const parsed = bedrockService.parseJSON(result);
                return { success: true, result: parsed || result, raw: result, fallback: true, model: model.name };
            } catch (error) {
                console.error(`   ❌ Fallback ${model.name} failed: ${error.message}`);
            }
        }
        throw new Error('All models failed including fallback chain');
    }

    /**
     * Get status of an active run
     */
    getRunStatus(runId) {
        return this.activeRuns.get(runId) || null;
    }
}

module.exports = new ParallelAgentService();
