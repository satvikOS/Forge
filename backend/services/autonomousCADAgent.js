/**
 * Autonomous CAD Agent with UI Control
 *
 * Uses Claude Sonnet 4.5 for reasoning and Gemini Vision for visual validation
 * Controls the CAD UI through browser automation (Playwright)
 * Operates autonomously like Claude Code but for CAD design
 */

const Anthropic = require('@anthropic-ai/sdk');
const geminiVision = require('./geminiVisionService');
const playwright = require('playwright');

class AutonomousCADAgent {
    constructor() {
        // Claude Sonnet 4.5 for reasoning
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.model = 'claude-sonnet-4-5-20250929'; // Latest Claude with computer use

        if (!this.apiKey) {
            console.warn('⚠️  ANTHROPIC_API_KEY not configured');
            this.configured = false;
            return;
        }

        try {
            this.anthropic = new Anthropic({
                apiKey: this.apiKey
            });
            this.configured = true;
            console.log('✅ Autonomous CAD Agent initialized');
            console.log(`   Model: ${this.model}`);
        } catch (error) {
            console.error('❌ Failed to initialize agent:', error);
            this.configured = false;
        }

        // Browser automation
        this.browser = null;
        this.page = null;
        this.context = null;

        // Agent state
        this.currentTask = null;
        this.screenshots = [];
        this.actions = [];
        this.decisions = [];
        this.errors = [];

        // Configuration
        this.headless = process.env.BROWSER_HEADLESS !== 'false';
        this.screenshotInterval = parseInt(process.env.SCREENSHOT_INTERVAL || '2000');
        this.maxRetries = parseInt(process.env.MAX_RETRIES || '3');
        this.autoValidate = process.env.AUTO_VALIDATE !== 'false';
    }

    /**
     * Initialize browser for UI control
     */
    async initializeBrowser(frontendUrl = 'http://localhost:3000') {
        console.log('🌐 Initializing browser automation...');

        try {
            // Launch browser (use chromium for headless support in Lambda)
            this.browser = await playwright.chromium.launch({
                headless: this.headless,
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // For Lambda
            });

            // Create context with viewport
            this.context = await this.browser.newContext({
                viewport: { width: 1920, height: 1080 },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            });

            // Create page
            this.page = await this.context.newPage();

            // Navigate to frontend
            console.log(`   Navigating to: ${frontendUrl}`);
            await this.page.goto(frontendUrl, { waitUntil: 'networkidle' });

            console.log('✅ Browser initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Browser initialization failed:', error);
            throw error;
        }
    }

    /**
     * Main entry point: Autonomous design from prompt
     */
    async autonomousDesign(prompt, options = {}) {
        console.log('\n🤖 ===============================================');
        console.log('🤖 AUTONOMOUS CAD AGENT WITH UI CONTROL');
        console.log('🤖 ===============================================\n');
        console.log(`📋 User Prompt: "${prompt}"`);

        try {
            // Initialize browser if not already done
            if (!this.page) {
                await this.initializeBrowser(options.frontendUrl);
            }

            // Reset state
            this.currentTask = prompt;
            this.screenshots = [];
            this.actions = [];
            this.decisions = [];
            this.errors = [];

            // PHASE 1: Analyze requirements
            const requirements = await this.analyzeRequirements(prompt);

            // PHASE 2: Create execution plan
            const plan = await this.createExecutionPlan(requirements);

            // PHASE 3: Execute plan with UI control
            const result = await this.executeWithUIControl(plan);

            // PHASE 4: Final validation
            const validation = await this.performFinalValidation(result, requirements);

            console.log('\n✅ Autonomous design completed!');
            return {
                success: true,
                design: result.design,
                validation,
                process: {
                    requirements,
                    plan,
                    actions: this.actions,
                    decisions: this.decisions,
                    screenshots: this.screenshots.length,
                    errors: this.errors
                }
            };

        } catch (error) {
            console.error('\n❌ Autonomous design failed:', error);
            this.errors.push({
                phase: 'execution',
                error: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * PHASE 1: Analyze requirements using Claude
     */
    async analyzeRequirements(prompt) {
        console.log('\n🧠 PHASE 1: Analyzing requirements with Claude...');

        const message = await this.anthropic.messages.create({
            model: this.model,
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `You are an expert CAD designer. Analyze this design request and extract detailed requirements.

User Request: "${prompt}"

Provide a comprehensive analysis in JSON format:
{
  "intent": "what the user wants to design",
  "type": "part|assembly|building|structure",
  "complexity": "simple|moderate|complex|very_complex",
  "keyFeatures": ["list of key features required"],
  "dimensions": {
    "estimated": true,
    "width": <number in mm>,
    "height": <number in mm>,
    "depth": <number in mm>
  },
  "materials": ["suggested materials"],
  "constraints": ["any constraints or requirements"],
  "successCriteria": ["how to validate the design is correct"]
}

Think step by step and be thorough.`
            }]
        });

        const response = message.content[0].text;
        const requirements = this.parseJSON(response);

        console.log('✅ Requirements analyzed');
        console.log(`   Type: ${requirements.type}`);
        console.log(`   Complexity: ${requirements.complexity}`);

        return requirements;
    }

    /**
     * PHASE 2: Create execution plan with UI steps
     */
    async createExecutionPlan(requirements) {
        console.log('\n📋 PHASE 2: Creating UI execution plan...');

        const message = await this.anthropic.messages.create({
            model: this.model,
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `You are planning how to use a CAD software UI to create a design.

Requirements:
${JSON.stringify(requirements, null, 2)}

Create a step-by-step plan of UI interactions needed to create this design.

Available UI elements:
- Sidebar tools: Sketch, Extrude, Revolve, Loft, Assembly, Analysis
- Sketch tools: Rectangle, Circle, Line, Arc, Spline, Dimension
- 3D operations: Extrude, Revolve, Sweep, Loft, Shell, Fillet, Chamfer
- View controls: Zoom, Pan, Rotate, Fit
- Properties panel: Material, Color, Dimensions

Return JSON:
{
  "steps": [
    {
      "number": 1,
      "action": "click_tool",
      "tool": "Sketch",
      "purpose": "Start sketch for base geometry",
      "expectedResult": "Sketch mode activated"
    },
    {
      "number": 2,
      "action": "select_sketch_tool",
      "tool": "Rectangle",
      "purpose": "Create base rectangle",
      "expectedResult": "Rectangle tool active"
    },
    {
      "number": 3,
      "action": "enter_dimensions",
      "values": {"width": 100, "height": 50},
      "purpose": "Set rectangle dimensions",
      "expectedResult": "Rectangle sized correctly"
    }
  ],
  "estimatedDuration": "2-5 minutes",
  "complexity": "simple|moderate|complex"
}

Be specific and thorough.`
            }]
        });

        const response = message.content[0].text;
        const plan = this.parseJSON(response);

        console.log(`✅ Execution plan created with ${plan.steps?.length || 0} steps`);
        this.decisions.push({
            phase: 'planning',
            decision: 'Created UI execution plan',
            steps: plan.steps?.length || 0
        });

        return plan;
    }

    /**
     * PHASE 3: Execute plan with UI control
     */
    async executeWithUIControl(plan) {
        console.log('\n⚙️  PHASE 3: Executing with UI control...\n');

        const results = [];

        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            console.log(`🔧 Step ${step.number}/${plan.steps.length}: ${step.purpose}`);

            let retries = 0;
            let stepResult = null;

            while (retries <= this.maxRetries) {
                try {
                    // Take screenshot before action
                    const beforeScreenshot = await this.takeScreenshot(`step_${step.number}_before`);

                    // Execute the UI action
                    stepResult = await this.executeUIAction(step);

                    // Wait for UI to update
                    await this.page.waitForTimeout(this.screenshotInterval);

                    // Take screenshot after action
                    const afterScreenshot = await this.takeScreenshot(`step_${step.number}_after`);

                    // Validate action succeeded (if auto-validate enabled)
                    if (this.autoValidate) {
                        const validation = await this.validateStep(
                            step,
                            beforeScreenshot,
                            afterScreenshot
                        );

                        if (!validation.success) {
                            throw new Error(`Step validation failed: ${validation.issue}`);
                        }
                    }

                    // Success!
                    this.actions.push({
                        step: step.number,
                        action: step.action,
                        success: true,
                        timestamp: new Date().toISOString()
                    });

                    results.push(stepResult);
                    break;

                } catch (error) {
                    retries++;
                    console.error(`   ⚠️  Attempt ${retries} failed: ${error.message}`);

                    if (retries > this.maxRetries) {
                        console.error(`   ❌ Max retries reached for step ${step.number}`);
                        this.errors.push({
                            step: step.number,
                            error: error.message,
                            retries
                        });
                        throw error;
                    }

                    console.log(`   🔄 Retrying step ${step.number}...`);
                    await this.page.waitForTimeout(1000);
                }
            }
        }

        console.log('\n✅ All UI steps executed successfully');

        // Take final screenshot
        const finalScreenshot = await this.takeScreenshot('final_design');

        return {
            design: {
                screenshot: finalScreenshot,
                steps: results
            },
            metadata: {
                totalSteps: plan.steps.length,
                screenshots: this.screenshots.length,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Execute a single UI action
     */
    async executeUIAction(step) {
        switch (step.action) {
            case 'click_tool':
                return await this.clickTool(step.tool);

            case 'select_sketch_tool':
                return await this.selectSketchTool(step.tool);

            case 'enter_dimensions':
                return await this.enterDimensions(step.values);

            case 'click_button':
                return await this.clickButton(step.button);

            case 'select_dropdown':
                return await this.selectDropdown(step.dropdown, step.value);

            case 'wait':
                await this.page.waitForTimeout(step.duration || 1000);
                return { action: 'wait', duration: step.duration };

            default:
                console.warn(`⚠️  Unknown action: ${step.action}`);
                return { action: step.action, status: 'skipped' };
        }
    }

    /**
     * Click a sidebar tool
     */
    async clickTool(toolName) {
        console.log(`   🖱️  Clicking tool: ${toolName}`);

        try {
            // Try common selectors for CAD tool buttons
            const selectors = [
                `.tool-icon-button[title="${toolName}"]`,
                `.sidebar-tool[data-tool="${toolName.toLowerCase()}"]`,
                `button:has-text("${toolName}")`,
                `[aria-label="${toolName}"]`
            ];

            for (const selector of selectors) {
                try {
                    await this.page.click(selector, { timeout: 2000 });
                    return { action: 'click_tool', tool: toolName, selector };
                } catch (e) {
                    // Try next selector
                }
            }

            throw new Error(`Tool "${toolName}" not found`);
        } catch (error) {
            console.error(`   ❌ Failed to click tool: ${error.message}`);
            throw error;
        }
    }

    /**
     * Select a sketch tool
     */
    async selectSketchTool(toolName) {
        console.log(`   ✏️  Selecting sketch tool: ${toolName}`);

        try {
            const selectors = [
                `.sketch-tool[data-tool="${toolName.toLowerCase()}"]`,
                `.dropdown-item:has-text("${toolName}")`,
                `button[title="${toolName}"]`
            ];

            for (const selector of selectors) {
                try {
                    await this.page.click(selector, { timeout: 2000 });
                    return { action: 'select_sketch_tool', tool: toolName };
                } catch (e) {
                    // Try next
                }
            }

            throw new Error(`Sketch tool "${toolName}" not found`);
        } catch (error) {
            console.error(`   ❌ Failed to select sketch tool: ${error.message}`);
            throw error;
        }
    }

    /**
     * Enter dimensions
     */
    async enterDimensions(values) {
        console.log(`   📏 Entering dimensions:`, values);

        try {
            for (const [key, value] of Object.entries(values)) {
                const selectors = [
                    `input[name="${key}"]`,
                    `input[placeholder*="${key}"]`,
                    `.dimension-input.${key}`
                ];

                for (const selector of selectors) {
                    try {
                        await this.page.fill(selector, value.toString(), { timeout: 2000 });
                        break;
                    } catch (e) {
                        // Try next
                    }
                }
            }

            return { action: 'enter_dimensions', values };
        } catch (error) {
            console.error(`   ❌ Failed to enter dimensions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Click a button
     */
    async clickButton(buttonText) {
        console.log(`   🖱️  Clicking button: ${buttonText}`);

        try {
            await this.page.click(`button:has-text("${buttonText}")`);
            return { action: 'click_button', button: buttonText };
        } catch (error) {
            console.error(`   ❌ Failed to click button: ${error.message}`);
            throw error;
        }
    }

    /**
     * Select dropdown value
     */
    async selectDropdown(dropdownLabel, value) {
        console.log(`   📋 Selecting "${value}" from ${dropdownLabel}`);

        try {
            await this.page.selectOption(`select[aria-label="${dropdownLabel}"]`, value);
            return { action: 'select_dropdown', dropdown: dropdownLabel, value };
        } catch (error) {
            console.error(`   ❌ Failed to select dropdown: ${error.message}`);
            throw error;
        }
    }

    /**
     * Take screenshot for validation
     */
    async takeScreenshot(label) {
        try {
            const screenshot = await this.page.screenshot({ fullPage: false });

            this.screenshots.push({
                label,
                timestamp: new Date().toISOString(),
                size: screenshot.length
            });

            return screenshot;
        } catch (error) {
            console.error('Screenshot failed:', error);
            return null;
        }
    }

    /**
     * Validate step using Gemini Vision
     */
    async validateStep(step, beforeScreenshot, afterScreenshot) {
        console.log(`   👁️  Validating with Gemini Vision...`);

        try {
            if (!geminiVision.isConfigured()) {
                console.warn('   ⚠️  Gemini Vision not configured, skipping validation');
                return { success: true, validated: false };
            }

            const comparison = await geminiVision.compareScreenshots(
                beforeScreenshot,
                afterScreenshot,
                step.expectedResult
            );

            const success = comparison.matchesExpectation && !comparison.unexpectedChanges?.length;

            if (!success) {
                console.log(`   ⚠️  Validation issue: ${comparison.changesObserved.join(', ')}`);
            } else {
                console.log(`   ✅ Step validated (confidence: ${comparison.confidence}%)`);
            }

            return {
                success,
                validated: true,
                details: comparison,
                issue: success ? null : comparison.unexpectedChanges?.join(', ')
            };

        } catch (error) {
            console.error('   ⚠️  Validation error:', error.message);
            return { success: true, validated: false, error: error.message };
        }
    }

    /**
     * PHASE 4: Final validation
     */
    async performFinalValidation(result, requirements) {
        console.log('\n🔍 PHASE 4: Final validation...');

        try {
            if (!result.design.screenshot || !geminiVision.isConfigured()) {
                console.warn('   ⚠️  Skipping visual validation');
                return { validated: false, reason: 'Vision not available' };
            }

            const validation = await geminiVision.validateDesign(
                result.design.screenshot,
                requirements
            );

            console.log(`   Overall validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
            if (validation.issues?.length) {
                console.log(`   Issues found: ${validation.issues.join(', ')}`);
            }

            return validation;

        } catch (error) {
            console.error('   ❌ Validation failed:', error);
            return { validated: false, error: error.message };
        }
    }

    /**
     * Cleanup browser resources
     */
    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.context = null;
        }
    }

    /**
     * Parse JSON from response
     */
    parseJSON(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1]);
                } catch (e2) {
                    console.error('Failed to parse JSON from markdown');
                }
            }

            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]);
                } catch (e3) {
                    console.error('Failed to parse JSON object');
                }
            }

            throw new Error('Could not parse JSON from response');
        }
    }
}

// Export class (not singleton, create instance per session)
module.exports = AutonomousCADAgent;
