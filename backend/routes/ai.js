const express = require('express');
const router = express.Router();
const parallelAgentService = require('../services/parallelAgentService');
const {
    MECHANICAL_SYSTEM_PROMPT,
    CLARIFICATION_PROMPT,
    VAGUENESS_DETECTION_PROMPT,
    CHAT_RESPONSE_PROMPT,
    COMPATIBILITY_CHECK_PROMPT,
} = require('../config/systemPrompts');

/**
 * AI Chat & Code Execution Routes
 * Real AI via parallel multi-agent service (DeepSeek R1, Kimi K2, Llama 3.3, Claude)
 * Includes vagueness detection and clarification flow
 */

// In-memory chat history (replace with database in production)
const chatSessions = new Map();

/**
 * POST /api/ai/chat
 * Handle natural language chat messages
 * Flow: vagueness check → clarify OR respond with real AI
 */
router.post('/chat', async (req, res) => {
    try {
        const { message, sessionId = 'default', clarificationAnswers, projectId } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        // Get or create chat session
        if (!chatSessions.has(sessionId)) {
            chatSessions.set(sessionId, []);
        }
        const history = chatSessions.get(sessionId);
        history.push({ role: 'user', content: message });

        // If this is a clarification response, skip vagueness check
        if (clarificationAnswers) {
            const enrichedPrompt = buildEnrichedPrompt(message, clarificationAnswers);
            const chatResult = await parallelAgentService.runParallel('chat', enrichedPrompt, {
                systemPrompt: CHAT_RESPONSE_PROMPT,
            });

            const response = extractChatResponse(chatResult);
            history.push({ role: 'assistant', content: response.text });

            return res.json({
                success: true,
                response: response.text,
                actions: response.actions || [],
                suggestedNextSteps: response.suggestedNextSteps || [],
                agentInfo: chatResult.agentResults,
                projectId,
                timestamp: new Date().toISOString(),
            });
        }

        // ─── Step 1: Vagueness Detection ─────────────────────────────
        const isGenerationRequest = detectGenerationIntent(message);

        if (isGenerationRequest) {
            try {
                const vaguenessResult = await parallelAgentService.runParallel(
                    'vagueness-detection',
                    VAGUENESS_DETECTION_PROMPT + message,
                    {}
                );

                const vagueness = parseVaguenessResult(vaguenessResult);

                if (vagueness.isVague || vagueness.score < 0.4) {
                    // ─── Step 2: Generate clarification questions ─────
                    const clarificationResult = await parallelAgentService.runParallel(
                        'clarification',
                        `${CLARIFICATION_PROMPT}\n\nUser prompt: "${message}"`,
                        {}
                    );

                    const clarification = parseClarificationResult(clarificationResult);

                    history.push({
                        role: 'assistant',
                        content: `I need a few details to create the best design for you.`,
                    });

                    return res.json({
                        success: true,
                        needsClarification: true,
                        response: clarification.understood || 'I need more details to generate a precise design.',
                        questions: clarification.questions || [],
                        vaguenessScore: vagueness.score,
                        missingInfo: vagueness.missingInfo || [],
                        projectId,
                        timestamp: new Date().toISOString(),
                    });
                }
            } catch (vaguenessError) {
                // If vagueness check fails, proceed without it
                console.warn('Vagueness detection failed, proceeding:', vaguenessError.message);
            }
        }

        // ─── Step 3: Generate AI response ────────────────────────────
        const chatPrompt = `${CHAT_RESPONSE_PROMPT}\n\nChat history (last ${Math.min(history.length, 10)} messages):\n${
            history.slice(-10).map(h => `${h.role}: ${h.content}`).join('\n')
        }\n\nCurrent user message: ${message}`;

        const chatResult = await parallelAgentService.runParallel('chat', chatPrompt, {
            systemPrompt: MECHANICAL_SYSTEM_PROMPT,
        });

        const response = extractChatResponse(chatResult);
        history.push({ role: 'assistant', content: response.text });

        // Trim session history to prevent memory bloat
        if (history.length > 50) {
            chatSessions.set(sessionId, history.slice(-30));
        }

        res.json({
            success: true,
            response: response.text,
            actions: response.actions || [],
            suggestedNextSteps: response.suggestedNextSteps || [],
            isGenerationRequest,
            agentInfo: chatResult.agentResults,
            projectId,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process chat message: ' + error.message,
        });
    }
});

/**
 * POST /api/ai/execute-code
 * Execute CAD scripting code safely (no arbitrary JS)
 * Returns structured CAD operations for the frontend to execute
 */
router.post('/execute-code', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code || !code.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Code is required'
            });
        }

        // Parse CAD scripting commands (safe, no eval)
        const result = parseCADScript(code.trim());

        res.json({
            success: true,
            output: result.output,
            result: result.value,
            operations: result.operations,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('Code execution error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Code execution failed'
        });
    }
});

/**
 * POST /api/ai/check-compatibility
 * Check component compatibility using parallel agents
 */
router.post('/check-compatibility', async (req, res) => {
    try {
        const { component, adjacentComponents, modification } = req.body;

        if (!component) {
            return res.status(400).json({ success: false, error: 'Component data required' });
        }

        const prompt = `${COMPATIBILITY_CHECK_PROMPT}\n\nComponent being modified:\n${JSON.stringify(component, null, 2)}\n\nAdjacent components:\n${JSON.stringify(adjacentComponents || [], null, 2)}\n\nProposed modification:\n${JSON.stringify(modification || {}, null, 2)}`;

        const result = await parallelAgentService.runParallel('compatibility-check', prompt, {});
        const compatibility = result.result || { compatible: true, severity: 'none', issues: [] };

        res.json({
            success: true,
            ...compatibility,
            agentInfo: result.agentResults,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('Compatibility check error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/ai/chat/:sessionId
 * Clear chat history for a session
 */
router.delete('/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    if (chatSessions.has(sessionId)) {
        chatSessions.delete(sessionId);
    }

    res.json({
        success: true,
        message: 'Chat history cleared'
    });
});

/**
 * GET /api/ai/agents
 * Get info about available AI agents
 */
router.get('/agents', (req, res) => {
    const { getAllModels, PARALLEL_AGENTS } = require('../config/modelConfig');
    res.json({
        success: true,
        models: getAllModels(),
        taskConfigs: PARALLEL_AGENTS,
    });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Detect if message is asking to create/generate something
 */
function detectGenerationIntent(message) {
    const genKeywords = [
        'create', 'make', 'build', 'generate', 'design', 'model',
        'draw', 'construct', 'fabricate', 'engineer', 'draft',
        'sketch', 'produce', 'develop', 'assemble'
    ];
    const lower = message.toLowerCase();
    return genKeywords.some(kw => lower.includes(kw));
}

/**
 * Build enriched prompt from original message + clarification answers
 */
function buildEnrichedPrompt(originalMessage, answers) {
    let enriched = `Original request: ${originalMessage}\n\nClarification details:\n`;
    if (Array.isArray(answers)) {
        answers.forEach(a => {
            enriched += `- ${a.question}: ${a.answer}\n`;
        });
    } else if (typeof answers === 'object') {
        for (const [key, value] of Object.entries(answers)) {
            enriched += `- ${key}: ${value}\n`;
        }
    }
    return enriched;
}

/**
 * Extract chat response from parallel agent result
 */
function extractChatResponse(agentResult) {
    if (!agentResult || !agentResult.success) {
        return { text: 'I encountered an error processing your request. Please try again.', actions: [] };
    }

    const raw = agentResult.result;

    // If result is already parsed JSON with response field
    if (raw && typeof raw === 'object' && raw.response) {
        return {
            text: raw.response,
            actions: raw.actions || [],
            suggestedNextSteps: raw.suggestedNextSteps || [],
        };
    }

    // If it's a string, try to parse as JSON
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.response) {
                return {
                    text: parsed.response,
                    actions: parsed.actions || [],
                    suggestedNextSteps: parsed.suggestedNextSteps || [],
                };
            }
        } catch (e) {
            // Not JSON, return as plain text
        }
        // Return raw string as response
        return { text: raw, actions: [] };
    }

    return { text: 'Response processed successfully.', actions: [] };
}

/**
 * Parse vagueness detection result
 */
function parseVaguenessResult(agentResult) {
    const defaults = { score: 0.5, isVague: false, missingInfo: [], recommendation: 'proceed' };

    if (!agentResult?.success || !agentResult.result) return defaults;

    const result = agentResult.result;
    if (typeof result === 'object') {
        return {
            score: result.score ?? defaults.score,
            isVague: result.isVague ?? (result.score < 0.4),
            missingInfo: result.missingInfo || [],
            extractedInfo: result.extractedInfo || {},
            recommendation: result.recommendation || defaults.recommendation,
        };
    }

    return defaults;
}

/**
 * Parse clarification result
 */
function parseClarificationResult(agentResult) {
    const defaults = {
        needsClarification: true,
        understood: '',
        questions: [
            { id: 'q1', question: 'What are the overall dimensions?', category: 'dimensions', options: ['Small (< 100mm)', 'Medium (100-500mm)', 'Large (> 500mm)'], allowFreeform: true },
            { id: 'q2', question: 'What material do you prefer?', category: 'material', options: ['Aluminum', 'Steel', 'Plastic', 'Other'], allowFreeform: true },
            { id: 'q3', question: 'What is the primary function?', category: 'function', options: [], allowFreeform: true },
        ]
    };

    if (!agentResult?.success || !agentResult.result) return defaults;

    const result = agentResult.result;
    if (typeof result === 'object' && result.questions) {
        return {
            needsClarification: true,
            understood: result.understood || '',
            questions: result.questions,
            confidence: result.confidence || 0.3,
        };
    }

    return defaults;
}

/**
 * Parse CAD scripting commands safely (no eval/Function constructor)
 */
function parseCADScript(code) {
    const startTime = Date.now();
    const operations = [];
    const output = [];

    // Split into lines and parse each command
    const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));

    for (const line of lines) {
        const trimmed = line.trim();

        // sketch.circle([x, y], radius)
        const circleMatch = trimmed.match(/sketch\.circle\(\[([^,]+),\s*([^\]]+)\],\s*([^)]+)\)/);
        if (circleMatch) {
            operations.push({
                type: 'sketch-circle',
                center: [parseFloat(circleMatch[1]), parseFloat(circleMatch[2])],
                radius: parseFloat(circleMatch[3]),
            });
            output.push(`Circle at [${circleMatch[1]}, ${circleMatch[2]}] r=${circleMatch[3]}`);
            continue;
        }

        // sketch.rectangle([x, y], w, h)
        const rectMatch = trimmed.match(/sketch\.rectangle\(\[([^,]+),\s*([^\]]+)\],\s*([^,]+),\s*([^)]+)\)/);
        if (rectMatch) {
            operations.push({
                type: 'sketch-rectangle',
                corner: [parseFloat(rectMatch[1]), parseFloat(rectMatch[2])],
                width: parseFloat(rectMatch[3]),
                height: parseFloat(rectMatch[4]),
            });
            output.push(`Rectangle at [${rectMatch[1]}, ${rectMatch[2]}] ${rectMatch[3]}x${rectMatch[4]}`);
            continue;
        }

        // sketch.line([x1, y1], [x2, y2])
        const lineMatch = trimmed.match(/sketch\.line\(\[([^,]+),\s*([^\]]+)\],\s*\[([^,]+),\s*([^\]]+)\]\)/);
        if (lineMatch) {
            operations.push({
                type: 'sketch-line',
                start: [parseFloat(lineMatch[1]), parseFloat(lineMatch[2])],
                end: [parseFloat(lineMatch[3]), parseFloat(lineMatch[4])],
            });
            output.push(`Line from [${lineMatch[1]}, ${lineMatch[2]}] to [${lineMatch[3]}, ${lineMatch[4]}]`);
            continue;
        }

        // extrude(sketch, distance)
        const extrudeMatch = trimmed.match(/extrude\(([^,]+),\s*([^)]+)\)/);
        if (extrudeMatch) {
            operations.push({
                type: 'extrude',
                target: extrudeMatch[1].trim(),
                distance: parseFloat(extrudeMatch[2]),
            });
            output.push(`Extrude ${extrudeMatch[1]} by ${extrudeMatch[2]}`);
            continue;
        }

        // fillet(target, radius)
        const filletMatch = trimmed.match(/fillet\(([^,]+),\s*([^)]+)\)/);
        if (filletMatch) {
            operations.push({
                type: 'fillet',
                target: filletMatch[1].trim(),
                radius: parseFloat(filletMatch[2]),
            });
            output.push(`Fillet ${filletMatch[1]} r=${filletMatch[2]}`);
            continue;
        }

        // chamfer(target, distance)
        const chamferMatch = trimmed.match(/chamfer\(([^,]+),\s*([^)]+)\)/);
        if (chamferMatch) {
            operations.push({
                type: 'chamfer',
                target: chamferMatch[1].trim(),
                distance: parseFloat(chamferMatch[2]),
            });
            output.push(`Chamfer ${chamferMatch[1]} d=${chamferMatch[2]}`);
            continue;
        }

        // revolve(sketch, angle)
        const revolveMatch = trimmed.match(/revolve\(([^,]+),\s*([^)]+)\)/);
        if (revolveMatch) {
            operations.push({
                type: 'revolve',
                target: revolveMatch[1].trim(),
                angle: parseFloat(revolveMatch[2]),
            });
            output.push(`Revolve ${revolveMatch[1]} by ${revolveMatch[2]}deg`);
            continue;
        }

        // box(w, h, d) or cube(size)
        const boxMatch = trimmed.match(/(?:box|cube)\(([^,)]+)(?:,\s*([^,)]+))?(?:,\s*([^)]+))?\)/);
        if (boxMatch) {
            const w = parseFloat(boxMatch[1]);
            operations.push({
                type: 'create-box',
                width: w,
                height: boxMatch[2] ? parseFloat(boxMatch[2]) : w,
                depth: boxMatch[3] ? parseFloat(boxMatch[3]) : w,
            });
            output.push(`Box ${w}x${boxMatch[2] || w}x${boxMatch[3] || w}`);
            continue;
        }

        // sphere(radius)
        const sphereMatch = trimmed.match(/sphere\(([^)]+)\)/);
        if (sphereMatch) {
            operations.push({
                type: 'create-sphere',
                radius: parseFloat(sphereMatch[1]),
            });
            output.push(`Sphere r=${sphereMatch[1]}`);
            continue;
        }

        // cylinder(radius, height)
        const cylMatch = trimmed.match(/cylinder\(([^,]+),\s*([^)]+)\)/);
        if (cylMatch) {
            operations.push({
                type: 'create-cylinder',
                radius: parseFloat(cylMatch[1]),
                height: parseFloat(cylMatch[2]),
            });
            output.push(`Cylinder r=${cylMatch[1]} h=${cylMatch[2]}`);
            continue;
        }

        // Unrecognized command
        output.push(`? Unknown: ${trimmed}`);
    }

    return {
        output: output.join('\n') || 'No operations recognized',
        value: { operations },
        operations,
        executionTime: Date.now() - startTime,
    };
}

module.exports = router;
