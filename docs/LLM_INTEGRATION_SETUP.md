# LLM Integration Setup Guide

## Overview

ArchDisc integrates with multiple LLM providers (Claude, GPT, Gemini) for autonomous CAD design generation. The system works like Claude Code for software, allowing natural language prompts to be transformed into complete production ready CAD models without human intervention (only when necessary).

## Supported LLM Providers

1. **Claude (Anthropic)** - Default, recommended
   - Model: claude-sonnet-4-5-20250929
   - Best for: Complex reasoning, design strategy, optimization analysis
   - Max tokens: 8192

2. **GPT (OpenAI)**
   - Model: gpt-4-turbo-preview
   - Best for: Quick responses, JSON structured output
   - Max tokens: 4096

3. **Gemini (Google)**
   - Model: gemini-pro
   - Best for: Alternative option, cost effective
   - Max tokens: 2048

## Environment Setup

### 1. Create `.env` file in backend directory

```bash
cd backend
cp .env.example .env
```

### 2. Add API Keys

```env
# Claude API (Recommended)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx

# OpenAI API (Optional)
OPENAI_API_KEY=sk-xxxxxxxxxxxxx

# Google Gemini API (Optional)
GOOGLE_API_KEY=xxxxxxxxxxxxx

# Feature Flags
LLM_ENABLED=true
DEFAULT_LLM_PROVIDER=claude
```

### 3. Get API Keys

**Claude API:**
1. Visit https://console.anthropic.com
2. Sign up or login
3. Go to API Keys section
4. Create new key
5. Copy key starting with `sk-ant-api03-`

**OpenAI API:**
1. Visit https://platform.openai.com/api-keys
2. Login to your account
3. Create new secret key
4. Copy key starting with `sk-`

**Google Gemini API:**
1. Visit https://makersuite.google.com/app/apikey
2. Login with Google account
3. Create API key
4. Copy the key

## Testing LLM Integration

### Test API Connection

```bash
# Test Claude
curl -X POST http://localhost:5000/api/mechanical/llm/test \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "prompt": "Hello, are you working?"
  }'

# Expected response:
{
  "success": true,
  "provider": "claude",
  "response": "Yes, I am working! How can I help you with CAD design today?",
  "usage": {...}
}
```

### Check Available Providers

```bash
curl http://localhost:5000/api/mechanical/llm/providers

# Expected response:
{
  "success": true,
  "providers": ["claude", "openai", "gemini"],
  "default": "claude"
}
```

### Change Default Provider

```bash
curl -X POST http://localhost:5000/api/mechanical/llm/provider \
  -H "Content-Type": application/json" \
  -d '{"provider": "openai"}'
```

## Using LLM Powered Orchestration

### Basic Usage

```javascript
// Frontend code
const response = await fetch('/api/mechanical/orchestrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Design a lightweight aluminum bracket with 4 mounting holes, 100mm x 50mm x 25mm, optimize for minimum mass while maintaining safety factor of 3.0'
  })
});

const result = await response.json();
```

### With LLM, the system will:

**Step 1: Intelligent Parsing**
- LLM extracts: part type, dimensions, material, features, constraints
- Asks clarification questions if requirements unclear
- Validates feasibility before proceeding

**Step 2: Design Strategy**
- LLM generates optimal design approach
- Selects features and operations
- Plans optimization strategy

**Step 3-9: Autonomous Execution**
- Creates sketch, 3D features, materials
- Runs analysis (FEA)
- LLM analyzes results and suggests optimizations
- Generates manufacturing data
- Creates documentation

**Step 10: Final Rendering**
- Produces photorealistic renders
- Returns complete design package

### Handling Clarification Questions

When LLM needs clarification:

```json
{
  "success": true,
  "workflowId": "workflow_1234567890",
  "status": "waiting-for-input",
  "questions": [
    "What is the maximum load this bracket needs to support?",
    "What is the operating environment temperature range?",
    "Are there any space constraints for mounting?"
  ]
}
```

Respond to questions:

```javascript
const response = await fetch('/api/mechanical/orchestrate/workflow_1234567890/respond', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    responses: [
      "Maximum load is 1000N vertical force",
      "Operating temperature, 20°C to 80°C",
      "Mounting area is 120mm x 60mm"
    ]
  })
});
```

Workflow will resume automatically.

## LLM Capabilities

### 1. Intelligent Prompt Parsing

```javascript
// Input
"Design a strong titanium gear housing for aerospace, 200mm diameter, must withstand 300°C"

// LLM Extracts
{
  "partType": "housing",
  "application": "aerospace",
  "dimensions": {"diameter": 200},
  "material": "Titanium Ti-6Al-4V",
  "constraints": [
    {"type": "strength", "target": "maximize"},
    {"type": "temperature", "max": 300}
  ],
  "features": ["gear-interface", "mounting-holes"],
  "standards": ["AS9100", "aerospace-grade"]
}
```

### 2. Design Decision Making

LLM autonomously decides:
- Which features to use (extrude vs revolve vs loft)
- Optimal sketch strategy
- Material selection from engineering database
- Analysis types needed (static, thermal, fatigue)
- Manufacturing method (CNC vs 3D printing vs casting)
- When to ask user vs make autonomous decision

### 3. Analysis and Optimization

```javascript
// LLM analyzes FEA results
{
  "assessment": "needs-optimization",
  "issues": [
    {
      "type": "stress",
      "severity": "warning",
      "description": "Peak stress of 380 MPa near corner radius exceeds 50% yield strength"
    }
  ],
  "optimizations": [
    {
      "type": "add-fillet",
      "location": "inner corner radius",
      "parameters": {"radius": 5},
      "expectedImprovement": "Reduce stress concentration by 35%"
    }
  ],
  "nextAction": "optimize-design"
}
```

### 4. Natural Language Progress Updates

```
✅ Parsed your design request. Creating a lightweight aluminum bracket with 4 M6 mounting holes.

✅ Generated optimized design strategy using weight minimization approach with topology optimization.

✅ Created parametric sketch with smart constraints. All dimensions fully defined.

✅ Built 3D model with extrude, fillets, and precision drilled holes.

✅ Assigned 6061-T6 aluminum properties. Estimated mass: 285g.

✅ Completed FEA analysis. Safety factor: 6.2 (excellent). Max stress: 42 MPa, well below yield.

✅ AI optimization reduced mass by 35% to 185g while maintaining strength requirements.

✅ Generated CNC toolpaths. Estimated machining time: 18 minutes, cost: $125.

✅ Created engineering drawing with GD&T annotations and BOM.

✅ Final rendering complete! Your design is ready for production.
```

## Advanced Configuration

### Customize LLM Behavior

```javascript
// In aiOrchestrationService.js

// Disable LLM (fallback to rule-based)
aiOrchestration.setLLMEnabled(false);

// Change temperature (0.0 = deterministic, 1.0 = creative)
llmService.callLLM({
  ...,
  temperature: 0.3  // More consistent for engineering
});
```

### Conversation History

LLM maintains conversation context:

```javascript
const conversationId = 'user_session_123';

// First call
await llmService.parseDesignPrompt("Design a bracket", conversationId);

// Follow-up (LLM remembers previous context)
await llmService.parseDesignPrompt("Make it stronger", conversationId);

// Clear history when done
llmService.clearConversation(conversationId);
```

## When LLM Asks for Input

LLM autonomously decides when to ask user:

**Will Ask User:**
- Critical design decisions affecting functionality
- Ambiguous requirements needing clarification
- Trade offs between conflicting requirements
- Safety critical specifications

**Makes Autonomous Decisions:**
- Technical implementation details
- Standard engineering practices
- Minor optimizations
- Tool selection
- Process parameters

## Performance and Costs

### Token Usage

Typical workflow:
- Prompt parsing: ~500 tokens
- Design strategy: ~1000 tokens
- Analysis/optimization: ~1500 tokens
- **Total per design: ~3000 tokens**

### API Costs (Approximate)

**Claude Sonnet:**
- Input: $3 per million tokens
- Output: $15 per million tokens
- **Cost per design: ~$0.05**

**GPT-4 Turbo:**
- Input: $10 per million tokens
- Output: $30 per million tokens
- **Cost per design: ~$0.12**

### Caching

LLM service includes conversation caching:
- Reduces redundant API calls
- Maintains context efficiently
- Automatic cleanup after 30 minutes

## Troubleshooting

### LLM not responding

```bash
# Check API keys
echo $ANTHROPIC_API_KEY

# Test connection
curl -X POST http://localhost:5000/api/mechanical/llm/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "claude"}'
```

### Rate Limits

If you hit rate limits:
1. Add delays between requests
2. Use lower tier provider (Gemini)
3. Implement request queuing
4. Cache common responses

### Fallback Mode

System automatically falls back to rule-based parsing if:
- LLM API unavailable
- API key invalid
- Rate limit exceeded
- Network timeout

## Production Deployment

### Environment Variables

```bash
# Production settings
LLM_ENABLED=true
DEFAULT_LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Optional: Rate limiting
LLM_MAX_REQUESTS_PER_MINUTE=60
LLM_TIMEOUT_MS=30000
```

### Monitoring

Log LLM usage:
```javascript
console.log(`LLM Call: ${provider}, Tokens: ${usage.total_tokens}, Cost: $${cost}`);
```

## Examples

### Example 1: Simple Bracket

```bash
curl -X POST http://localhost:5000/api/mechanical/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design an aluminum L-bracket, 100mm x 50mm, with 2 mounting holes"
  }'
```

LLM autonomously:
- Creates design without clarification
- Selects 6061-T6 aluminum
- Adds appropriate fillets
- Runs FEA analysis
- Generates manufacturing data

### Example 2: Complex Assembly

```bash
curl -X POST http://localhost:5000/api/mechanical/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design a compact gear reduction system, 10:1 ratio, input 1000 RPM, output torque 50 Nm, minimize size and noise"
  }'
```

LLM will:
- Ask clarification questions (space constraints, lubrication, etc.)
- Generate multiple gear configurations
- Run motion simulation
- Optimize for size and noise
- Provide complete assembly

## API Reference

### POST /api/mechanical/orchestrate
Start LLM powered autonomous design workflow

### GET /api/mechanical/orchestrate/:workflowId
Monitor workflow progress with LLM updates

### POST /api/mechanical/orchestrate/:workflowId/respond
Answer LLM clarification questions

### GET /api/mechanical/llm/providers
List available LLM providers

### POST /api/mechanical/llm/provider
Change default LLM provider

### POST /api/mechanical/llm/test
Test LLM API connection

## Best Practices

1. **Be Specific in Prompts**
   - Good: "Aluminum 6061-T6 bracket, 100x50x25mm, 4x M6 holes, load 500N"
   - Bad: "Make me a bracket"

2. **Include Constraints**
   - Mass limits
   - Safety factors
   - Budget constraints
   - Manufacturing method

3. **Respond to Questions Promptly**
   - LLM waits for clarification
   - Provides better results with complete info

4. **Monitor Token Usage**
   - Track costs
   - Use caching when possible
   - Clear old conversations

5. **Fallback Planning**
   - Test system without LLM
   - Have backup provider configured
   - Handle API failures gracefully

## Conclusion

The LLM integration transforms ArchDisc into an autonomous CAD assistant similar to how Claude Code works for software development. Natural language prompts are intelligently parsed, designs are generated autonomously, and the system only asks for human input when truly necessary.

Setup is simple: add API keys, test connection, and start designing with natural language!
