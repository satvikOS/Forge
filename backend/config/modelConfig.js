/**
 * Multi-Model Configuration for AWS Bedrock
 * 4 AI agents running in PARALLEL for best output:
 *
 * AGENT ROLES:
 *   Geometry Agent  (DeepSeek R1)   - Primary 3D geometry, feature trees, precision dimensions
 *   Analysis Agent  (Kimi K2)       - Design review, DFM/DFA, structural analysis, compatibility
 *   Materials Agent (Llama 3.3 70B) - Material selection, GD&T, standards, fast chat
 *   Orchestrator    (Claude Sonnet) - Merges parallel results, fallback, final quality gate
 *
 * All agents receive the same prompt simultaneously.
 * Orchestrator merges the best elements from each into the final output.
 */

const MODEL_CATALOG = {
    'deepseek-r1': {
        id: process.env.BEDROCK_DEEPSEEK_MODEL || 'us.deepseek.r1-v1:0',
        name: 'DeepSeek R1',
        role: 'geometry',
        agentName: 'Geometry Agent',
        maxTokens: 64000,
        temperature: 0.6,
        format: 'converse',
        strengths: ['3D geometry generation', 'complex reasoning', 'multi-step CAD planning', 'mathematical precision'],
        description: 'Generates precise 3D geometry, feature trees, and parametric dimensions. Best for complex mechanical designs.',
    },
    'kimi-k2': {
        id: process.env.BEDROCK_KIMI_MODEL || 'moonshot.kimi-k2-thinking',
        name: 'Kimi K2',
        role: 'analysis',
        agentName: 'Analysis Agent',
        maxTokens: 32000,
        temperature: 0.5,
        format: 'converse',
        strengths: ['design review', 'DFM/DFA analysis', 'structural analysis', 'compatibility checking', 'error detection'],
        description: 'Reviews designs for manufacturability, structural integrity, and component compatibility. Catches errors other agents miss.',
    },
    'llama-3.3-70b': {
        id: process.env.BEDROCK_LLAMA_MODEL || 'us.meta.llama3-3-70b-instruct-v1:0',
        name: 'Llama 3.3 70B',
        role: 'materials',
        agentName: 'Materials Agent',
        maxTokens: 8192,
        temperature: 0.7,
        format: 'converse',
        strengths: ['material selection', 'GD&T', 'standards compliance', 'fast chat', 'clarification questions'],
        description: 'Fast material selection, tolerance specifications, and standards compliance. Also handles quick chat and clarification.',
    },
    'claude-sonnet': {
        id: process.env.BEDROCK_CLAUDE_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        name: 'Claude Sonnet 4.5',
        role: 'orchestrator',
        agentName: 'Orchestrator',
        maxTokens: 64000,
        temperature: 0.7,
        format: 'claude',
        strengths: ['result merging', 'instruction following', 'structured output', 'quality gate', 'reliable fallback'],
        description: 'Merges outputs from parallel agents into best final result. Acts as quality gate and reliable fallback.',
    },
};

// ─── Parallel Agent Groups ────────────────────────────────────────────────────
// Defines which agents run in parallel for each task type
const PARALLEL_AGENTS = {
    // Full design generation — ALL agents in parallel, orchestrator merges
    'design-generation': {
        parallel: ['deepseek-r1', 'kimi-k2', 'llama-3.3-70b'],
        merger: 'claude-sonnet',
        strategy: 'merge-best',  // Take best geometry from deepseek, best analysis from kimi, best materials from llama
    },
    // Taxonomy/scene analysis
    'taxonomy-analysis': {
        parallel: ['deepseek-r1', 'kimi-k2'],
        merger: 'claude-sonnet',
        strategy: 'merge-best',
    },
    // Chat — fast response + deeper backup
    'chat': {
        parallel: ['llama-3.3-70b'],
        merger: null,  // No merge needed, just use fast model
        strategy: 'fastest',
    },
    // Clarification questions — fast + smart
    'clarification': {
        parallel: ['llama-3.3-70b', 'kimi-k2'],
        merger: null,
        strategy: 'best-questions',
    },
    // Design optimization — needs deep reasoning + analysis
    'optimization': {
        parallel: ['deepseek-r1', 'kimi-k2'],
        merger: 'claude-sonnet',
        strategy: 'merge-best',
    },
    // Component compatibility check
    'compatibility-check': {
        parallel: ['kimi-k2', 'llama-3.3-70b'],
        merger: null,
        strategy: 'strictest',  // Use the most conservative/strict result
    },
    // Vagueness detection — fast check
    'vagueness-detection': {
        parallel: ['llama-3.3-70b'],
        merger: null,
        strategy: 'fastest',
    },
};

// ─── Sequential Fallback (when parallel fails) ───────────────────────────────
const FALLBACK_CHAIN = ['deepseek-r1', 'kimi-k2', 'llama-3.3-70b', 'claude-sonnet'];

function getParallelConfig(taskType) {
    return PARALLEL_AGENTS[taskType] || PARALLEL_AGENTS['chat'];
}

function getModelsForTask(taskType) {
    const config = PARALLEL_AGENTS[taskType];
    if (!config) return [MODEL_CATALOG['llama-3.3-70b']];
    const allKeys = [...config.parallel, ...(config.merger ? [config.merger] : [])];
    return allKeys.map(key => MODEL_CATALOG[key]).filter(Boolean);
}

function getPrimaryModel(taskType) {
    const config = PARALLEL_AGENTS[taskType];
    if (!config || !config.parallel.length) return MODEL_CATALOG['claude-sonnet'];
    return MODEL_CATALOG[config.parallel[0]];
}

function getFallbackChain() {
    return FALLBACK_CHAIN.map(key => MODEL_CATALOG[key]).filter(Boolean);
}

function getAllModels() {
    return { ...MODEL_CATALOG };
}

function getModelById(key) {
    return MODEL_CATALOG[key] || null;
}

module.exports = {
    MODEL_CATALOG,
    PARALLEL_AGENTS,
    FALLBACK_CHAIN,
    getParallelConfig,
    getModelsForTask,
    getPrimaryModel,
    getFallbackChain,
    getAllModels,
    getModelById,
};
