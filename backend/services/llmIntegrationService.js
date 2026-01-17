/**
 * LLM Integration Service
 * Integrates multiple LLM providers (Claude, GPT, Gemini) for autonomous CAD generation
 * Similar to Claude Code autonomous workflow for software development
 */

class LLMIntegrationService {
    constructor() {
        this.providers = {
            claude: {
                apiKey: process.env.ANTHROPIC_API_KEY,
                endpoint: 'https://api.anthropic.com/v1/messages',
                model: 'claude-sonnet-4-5-20250929',
                maxTokens: 8192
            },
            openai: {
                apiKey: process.env.OPENAI_API_KEY,
                endpoint: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4-turbo-preview',
                maxTokens: 4096
            },
            gemini: {
                apiKey: process.env.GOOGLE_API_KEY,
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
                model: 'gemini-pro',
                maxTokens: 2048
            }
        };

        this.defaultProvider = 'claude';
        this.conversationHistory = new Map();
    }

    /**
     * Parse natural language prompt into structured CAD requirements
     */
    async parseDesignPrompt(prompt, conversationId = null) {
        const systemPrompt = `You are an expert mechanical engineer and CAD designer. Analyze the user's design request and extract structured requirements.

Return a JSON object with:
{
  "partType": "bracket | housing | shaft | gear | plate | custom",
  "dimensions": {
    "length": number (mm),
    "width": number (mm),
    "height": number (mm),
    "diameter": number (mm, if cylindrical)
  },
  "material": "Aluminum 6061-T6 | Steel 1045 | Stainless Steel 304 | Titanium Ti-6Al-4V | ABS Plastic",
  "features": ["extrude", "holes", "fillets", "chamfers", "patterns"],
  "constraints": [
    {"type": "mass", "target": "minimize | maximize", "value": number},
    {"type": "strength", "target": "maximize", "safetyFactor": number},
    {"type": "cost", "target": "minimize", "budget": number}
  ],
  "loadCases": [
    {"type": "force | pressure | torque", "magnitude": number, "direction": [x, y, z]}
  ],
  "manufacturingMethod": "cnc-milling | 3d-printing | sheet-metal | casting",
  "clarificationNeeded": boolean,
  "questions": ["question1", "question2"] (if clarification needed)
}

If critical information is missing, set clarificationNeeded to true and list questions.`;

        const userMessage = `Design request: ${prompt}`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage,
            conversationId,
            responseFormat: 'json'
        });

        try {
            const parsed = JSON.parse(response.content);

            if (parsed.clarificationNeeded) {
                return {
                    success: true,
                    needsClarification: true,
                    questions: parsed.questions,
                    partialRequirements: parsed
                };
            }

            return {
                success: true,
                needsClarification: false,
                requirements: parsed
            };
        } catch (error) {
            console.error('Error parsing LLM response:', error);
            return {
                success: false,
                error: 'Failed to parse design requirements'
            };
        }
    }

    /**
     * Generate design strategy and approach
     */
    async generateDesignStrategy(requirements) {
        const systemPrompt = `You are an expert CAD designer. Given structured design requirements, create a detailed design strategy.

Return JSON with:
{
  "approach": "lightweight | robust | cost-effective | high-performance",
  "designPhilosophy": "string describing the design approach",
  "sketchStrategy": {
    "baseProfile": "rectangle | circle | polygon | custom",
    "keyDimensions": {"width": number, "height": number}
  },
  "features": [
    {
      "type": "extrude | revolve | sweep | loft",
      "purpose": "create base body | add reinforcement | etc",
      "parameters": {}
    }
  ],
  "optimization": {
    "enabled": boolean,
    "method": "topology | parametric | generative",
    "targetReduction": number (0 to 1)
  },
  "analysisRequired": ["fea-static", "fea-thermal", "cfd"],
  "estimatedIterations": number
}`;

        const userMessage = `Design requirements:\n${JSON.stringify(requirements, null, 2)}\n\nGenerate optimal design strategy.`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage,
            responseFormat: 'json'
        });

        return JSON.parse(response.content);
    }

    /**
     * Generate parametric sketch from requirements
     */
    async generateSketchParameters(requirements, strategy) {
        const systemPrompt = `You are a parametric CAD expert. Generate precise sketch parameters.

Return JSON with:
{
  "plane": "XY | XZ | YZ",
  "entities": [
    {
      "type": "line | circle | arc | rectangle | polygon",
      "parameters": {
        "start": [x, y], "end": [x, y],  // for line
        "center": [x, y], "radius": r,    // for circle
        "width": w, "height": h            // for rectangle
      }
    }
  ],
  "constraints": [
    {"type": "horizontal | vertical | parallel | perpendicular | equal", "entities": [0, 1]},
    {"type": "dimension", "entity": 0, "value": number}
  ],
  "variables": {
    "length": {"value": number, "min": number, "max": number},
    "width": {"value": number, "min": number, "max": number}
  }
}`;

        const userMessage = `Requirements: ${JSON.stringify(requirements, null, 2)}\nStrategy: ${JSON.stringify(strategy, null, 2)}\n\nGenerate parametric sketch.`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage,
            responseFormat: 'json'
        });

        return JSON.parse(response.content);
    }

    /**
     * Analyze FEA results and suggest optimizations
     */
    async analyzeAndOptimize(feaResults, requirements) {
        const systemPrompt = `You are a structural analysis expert. Analyze FEA results and suggest design improvements.

Return JSON with:
{
  "assessment": "passed | needs-optimization | failed",
  "issues": [
    {"type": "stress | deflection | safety-factor", "severity": "critical | warning | info", "description": "string"}
  ],
  "optimizations": [
    {
      "type": "add-fillet | increase-thickness | add-rib | topology-optimization",
      "location": "description of where to apply",
      "parameters": {},
      "expectedImprovement": "string"
    }
  ],
  "nextAction": "proceed-to-manufacturing | optimize-design | redesign | ask-user"
}`;

        const userMessage = `FEA Results:\n${JSON.stringify(feaResults, null, 2)}\n\nRequirements:\n${JSON.stringify(requirements, null, 2)}\n\nAnalyze and suggest optimizations.`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage,
            responseFormat: 'json'
        });

        return JSON.parse(response.content);
    }

    /**
     * Generate natural language progress updates
     */
    async generateProgressUpdate(step, results) {
        const systemPrompt = `You are a helpful CAD assistant. Generate a concise, friendly progress update for the user.

Keep it brief (1-2 sentences), technical but understandable, and encouraging.`;

        const userMessage = `Step: ${step}\nResults: ${JSON.stringify(results, null, 2)}\n\nGenerate user-friendly progress update.`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage
        });

        return response.content;
    }

    /**
     * Determine if user input is needed
     */
    async shouldAskUser(currentState, issue) {
        const systemPrompt = `You are a decision-making assistant. Determine if we should ask the user for input or make an autonomous decision.

Return JSON with:
{
  "askUser": boolean,
  "reason": "string explaining why",
  "question": "string question to ask user" (if askUser is true),
  "autonomousDecision": "string describing what to do automatically" (if askUser is false)
}

Only ask user for:
- Critical design decisions affecting functionality
- Ambiguous requirements needing clarification
- Trade offs between conflicting requirements

Make autonomous decisions for:
- Technical implementation details
- Standard engineering practices
- Minor optimizations
- Tool selection
- Process parameters`;

        const userMessage = `Current state: ${JSON.stringify(currentState, null, 2)}\nIssue: ${issue}\n\nShould we ask user or decide autonomously?`;

        const response = await this.callLLM({
            provider: this.defaultProvider,
            systemPrompt,
            userMessage,
            responseFormat: 'json'
        });

        return JSON.parse(response.content);
    }

    /**
     * Core LLM API call with provider abstraction
     */
    async callLLM(options) {
        const {
            provider = this.defaultProvider,
            systemPrompt,
            userMessage,
            conversationId = null,
            responseFormat = 'text',
            temperature = 0.7
        } = options;

        const config = this.providers[provider];

        if (!config.apiKey) {
            throw new Error(`API key not configured for provider: ${provider}`);
        }

        let conversationHistory = [];
        if (conversationId && this.conversationHistory.has(conversationId)) {
            conversationHistory = this.conversationHistory.get(conversationId);
        }

        let requestBody, headers, response;

        if (provider === 'claude') {
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            };

            const messages = [
                ...conversationHistory,
                { role: 'user', content: userMessage }
            ];

            requestBody = {
                model: config.model,
                max_tokens: config.maxTokens,
                temperature,
                system: systemPrompt,
                messages
            };

            try {
                const res = await fetch(config.endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody)
                });

                if (!res.ok) {
                    throw new Error(`Claude API error: ${res.status} ${res.statusText}`);
                }

                const data = await res.json();
                response = {
                    content: data.content[0].text,
                    usage: data.usage
                };

                if (conversationId) {
                    conversationHistory.push(
                        { role: 'user', content: userMessage },
                        { role: 'assistant', content: response.content }
                    );
                    this.conversationHistory.set(conversationId, conversationHistory);
                }

            } catch (error) {
                console.error('Claude API call failed:', error);
                throw error;
            }

        } else if (provider === 'openai') {
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };

            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
                { role: 'user', content: userMessage }
            ];

            requestBody = {
                model: config.model,
                messages,
                temperature,
                max_tokens: config.maxTokens
            };

            if (responseFormat === 'json') {
                requestBody.response_format = { type: 'json_object' };
            }

            try {
                const res = await fetch(config.endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody)
                });

                if (!res.ok) {
                    throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
                }

                const data = await res.json();
                response = {
                    content: data.choices[0].message.content,
                    usage: data.usage
                };

                if (conversationId) {
                    conversationHistory.push(
                        { role: 'user', content: userMessage },
                        { role: 'assistant', content: response.content }
                    );
                    this.conversationHistory.set(conversationId, conversationHistory);
                }

            } catch (error) {
                console.error('OpenAI API call failed:', error);
                throw error;
            }

        } else if (provider === 'gemini') {
            headers = {
                'Content-Type': 'application/json'
            };

            const prompt = `${systemPrompt}\n\n${userMessage}`;

            requestBody = {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature,
                    maxOutputTokens: config.maxTokens
                }
            };

            try {
                const url = `${config.endpoint}?key=${config.apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody)
                });

                if (!res.ok) {
                    throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
                }

                const data = await res.json();
                response = {
                    content: data.candidates[0].content.parts[0].text,
                    usage: data.usageMetadata
                };

            } catch (error) {
                console.error('Gemini API call failed:', error);
                throw error;
            }
        }

        return response;
    }

    /**
     * Clear conversation history
     */
    clearConversation(conversationId) {
        this.conversationHistory.delete(conversationId);
    }

    /**
     * Set default LLM provider
     */
    setDefaultProvider(provider) {
        if (!this.providers[provider]) {
            throw new Error(`Unknown provider: ${provider}`);
        }
        this.defaultProvider = provider;
    }

    /**
     * Check if provider is configured
     */
    isProviderConfigured(provider) {
        return !!(this.providers[provider] && this.providers[provider].apiKey);
    }

    /**
     * Get available providers
     */
    getAvailableProviders() {
        return Object.keys(this.providers).filter(p => this.isProviderConfigured(p));
    }
}

module.exports = new LLMIntegrationService();
