/**
 * Orchestration Lambda Handler
 * Handles long-running AI orchestration workflows
 */

const aiOrchestration = require('../services/aiOrchestrationService');

module.exports.handler = async (event) => {
    console.log('Orchestration request:', JSON.stringify(event, null, 2));

    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;
    const body = event.body ? JSON.parse(event.body) : {};
    const pathParams = event.pathParameters || {};

    try {
        let result;

        // POST /orchestrate - Start workflow
        if (method === 'POST' && path === '/orchestrate') {
            result = await aiOrchestration.orchestrateFromPrompt(body);
        }

        // GET /orchestrate/{workflowId} - Get status
        else if (method === 'GET' && pathParams.workflowId) {
            result = await aiOrchestration.getWorkflowStatus(pathParams.workflowId);
        }

        // POST /orchestrate/{workflowId}/respond - User response
        else if (method === 'POST' && pathParams.workflowId && path.includes('/respond')) {
            result = await aiOrchestration.handleUserResponse(pathParams.workflowId, body.responses);
        }

        else {
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Not found' })
            };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('Orchestration error:', error);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                stack: process.env.STAGE === 'dev' ? error.stack : undefined
            })
        };
    }
};
