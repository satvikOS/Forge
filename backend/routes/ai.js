const express = require('express');
const router = express.Router();

/**
 * AI Chat & Code Execution Routes
 * Handles natural language CAD commands and code execution
 */

// In-memory chat history (replace with database in production)
const chatSessions = new Map();

/**
 * POST /api/ai/chat
 * Handle natural language chat messages and convert to CAD commands
 */
router.post('/chat', async (req, res) => {
    try {
        const { message, sessionId = 'default' } = req.body;

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

        // Parse natural language to CAD actions using AI
        const cadActions = await parseMessageToCADActions(message);

        // Generate AI response
        const response = await generateAIResponse(message, cadActions, history);

        history.push({ role: 'assistant', content: response });

        res.json({
            success: true,
            response,
            actions: cadActions,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process chat message'
        });
    }
});

/**
 * POST /api/ai/execute-code
 * Execute JavaScript code in sandboxed environment
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

        // Execute code in safe sandbox
        const result = await executeCodeSafely(code);

        res.json({
            success: true,
            output: result.output,
            result: result.value,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString()
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

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse natural language message into CAD actions
 */
async function parseMessageToCADActions(message) {
    const actions = [];
    const lowerMessage = message.toLowerCase();

    // Simple pattern matching (replace with actual AI/NLP in production)

    // Create primitives
    if (lowerMessage.includes('cube') || lowerMessage.includes('box')) {
        const size = extractNumber(message) || 50;
        actions.push({
            type: 'create-primitive',
            primitive: 'cube',
            parameters: { size }
        });
    }

    if (lowerMessage.includes('sphere') || lowerMessage.includes('ball')) {
        const radius = extractNumber(message) || 25;
        actions.push({
            type: 'create-primitive',
            primitive: 'sphere',
            parameters: { radius }
        });
    }

    if (lowerMessage.includes('cylinder')) {
        const radius = extractNumber(message) || 20;
        const height = extractNumber(message, 1) || 50;
        actions.push({
            type: 'create-primitive',
            primitive: 'cylinder',
            parameters: { radius, height }
        });
    }

    // Modifications
    if (lowerMessage.includes('fillet') || lowerMessage.includes('round')) {
        const radius = extractNumber(message) || 5;
        actions.push({
            type: 'modify',
            operation: 'fillet',
            parameters: { radius }
        });
    }

    if (lowerMessage.includes('extrude')) {
        const distance = extractNumber(message) || 10;
        actions.push({
            type: 'feature',
            operation: 'extrude',
            parameters: { distance }
        });
    }

    // Material
    if (lowerMessage.includes('material')) {
        if (lowerMessage.includes('steel')) {
            actions.push({ type: 'set-material', material: 'steel' });
        } else if (lowerMessage.includes('aluminum')) {
            actions.push({ type: 'set-material', material: 'aluminum' });
        }
    }

    return actions;
}

/**
 * Extract number from text
 */
function extractNumber(text, occurrence = 0) {
    const numbers = text.match(/\d+(\.\d+)?/g);
    return numbers && numbers[occurrence] ? parseFloat(numbers[occurrence]) : null;
}

/**
 * Generate AI response based on message and actions
 */
async function generateAIResponse(message, actions, history) {
    if (actions.length === 0) {
        return "I understand you want to create something, but I need more specific details. Try saying something like 'Create a 50mm cube' or 'Add a sphere with 25mm radius'.";
    }

    // Generate friendly response based on actions
    const actionDescriptions = actions.map(action => {
        switch (action.type) {
            case 'create-primitive':
                return `Creating a ${action.primitive} with ${JSON.stringify(action.parameters)}`;
            case 'modify':
                return `Applying ${action.operation} with ${JSON.stringify(action.parameters)}`;
            case 'feature':
                return `Adding ${action.operation} feature`;
            case 'set-material':
                return `Setting material to ${action.material}`;
            default:
                return `Executing ${action.type}`;
        }
    });

    return `Got it! ${actionDescriptions.join('. ')}. Check the viewport to see the results.`;
}

/**
 * Execute JavaScript code in a safe sandbox
 */
async function executeCodeSafely(code) {
    const startTime = Date.now();

    try {
        // Create a sandbox context
        const sandbox = {
            console: {
                log: (...args) => args.join(' ')
            },
            Math,
            Date,
            // Add CAD-specific APIs here
            sketch: {
                circle: (center, radius) => ({ type: 'circle', center, radius }),
                rectangle: (corner, width, height) => ({ type: 'rectangle', corner, width, height }),
                line: (start, end) => ({ type: 'line', start, end })
            },
            extrude: (sketch, distance) => ({ type: 'extrude', sketch, distance })
        };

        // Simple eval in context (replace with vm2 or isolated-vm in production)
        const func = new Function(...Object.keys(sandbox), `return ${code}`);
        const value = func(...Object.values(sandbox));

        const executionTime = Date.now() - startTime;

        return {
            output: value !== undefined ? String(value) : 'Code executed successfully',
            value,
            executionTime
        };

    } catch (error) {
        throw new Error(`Execution error: ${error.message}`);
    }
}

module.exports = router;
