/**
 * Crowd Service
 * AI-powered NPC crowd generation and behavior simulation
 * Generates crowd distributions, behaviors, and character variations
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const euphoriaService = require('./euphoriaService');

class CrowdService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-3-pro' });
    }

    /**
     * Generate NPC crowd with AI-driven placement and behavior
     * @param {Object} options - Crowd generation options
     * @returns {Object} Crowd data with NPCs and behaviors
     */
    async generateCrowd(options = {}) {
        const {
            count = 10,
            area = { width: 50, depth: 50 }, // meters
            behavior = 'mixed', // walking, standing, sitting, mixed
            density = 'medium', // low, medium, high
            characterTypes = ['adult', 'child', 'elderly'],
            scenario = 'urban street',
        } = options;

        const prompt = `Generate an NPC crowd for a 3D scene with realistic placement and behavior.

Crowd Parameters:
- Number of NPCs: ${count}
- Area: ${area.width}m × ${area.depth}m
- Behavior Type: ${behavior}
- Density: ${density}
- Character Types: ${characterTypes.join(', ')}
- Scenario: ${scenario}

Generate a realistic crowd distribution with:
1. NPC positions (avoid overlap, maintain personal space)
2. Character variations (height, build, clothing)
3. Individual behaviors (walking path, standing, interacting)
4. Animation states
5. Facing directions

Return as JSON:
{
  "crowd": {
    "npcs": [
      {
        "id": "npc_001",
        "position": {"x": 5.2, "y": 0, "z": 8.3},
        "rotation": {"x": 0, "y": 45, "z": 0},
        "character": {
          "type": "adult",
          "height": 1.75,
          "build": "average",
          "gender": "male",
          "age": 32
        },
        "behavior": {
          "state": "walking",
          "path": [
            {"x": 5.2, "y": 0, "z": 8.3},
            {"x": 12.5, "y": 0, "z": 15.7}
          ],
          "speed": 1.4,
          "animation": "walk_casual"
        }
      }
    ],
    "metadata": {
      "totalNPCs": ${count},
      "averageDensity": "calculated",
      "scenario": "${scenario}"
    }
  }
}

Ensure realistic spacing (0.5-2m between NPCs depending on density) and logical behavior patterns.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract crowd JSON');
            }

            const crowdData = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated crowd with ${crowdData.crowd.npcs.length} NPCs`);
            return {
                success: true,
                crowd: crowdData.crowd,
                options,
                generatedAt: new Date().toISOString(),
            };

        } catch (error) {
            console.error('❌ Error generating crowd:', error);
            return {
                success: false,
                error: error.message,
                fallback: this.generateSimpleCrowd(options),
            };
        }
    }

    /**
     * Generate AI-driven crowd behavior patterns
     * @param {Object} options - Behavior options
     * @returns {Object} Behavior rules and patterns
     */
    async generateCrowdBehavior(options = {}) {
        const {
            scenario = 'busy street',
            timeOfDay = 'afternoon',
            event = null,
            weatherConditions = 'clear',
        } = options;

        const prompt = `Generate realistic crowd behavior patterns for a ${scenario} scene.

Context:
- Scenario: ${scenario}
- Time of Day: ${timeOfDay}
- Event: ${event || 'none'}
- Weather: ${weatherConditions}

Generate behavior rules including:
1. Movement patterns (flow direction, speed variations)
2. Social interactions (groups, personal space)
3. Activity distributions (% walking, standing, sitting)
4. Path-finding rules (avoid collisions, natural paths)
5. Reaction behaviors (to events, obstacles)

Return as JSON with behavior parameters and rules.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const behaviorRules = JSON.parse(jsonMatch[0]);

            return {
                success: true,
                rules: behaviorRules,
            };

        } catch (error) {
            console.error('❌ Error generating crowd behavior:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Generate character variations for crowd diversity
     * @param {number} count - Number of character variations to generate
     * @returns {Object} Character variation templates
     */
    async generateCharacterVariations(count = 10) {
        const prompt = `Generate ${count} diverse character variations for an NPC crowd.

For each character, provide:
- Physical attributes (height, build, age)
- Appearance (clothing style, colors)
- Walk cycle parameters (step length, frequency, sway)
- Personality hints (affects animation style)

Return as JSON array of character templates that can be applied to 3D rigs.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            const variations = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated ${variations.length} character variations`);
            return {
                success: true,
                variations,
            };

        } catch (error) {
            console.error('❌ Error generating character variations:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Apply Euphoria physics to crowd NPCs
     * @param {Array} npcs - NPC data from crowd generation
     * @returns {Array} NPCs with Euphoria physics applied
     */
    async applyEuphoriaToNPCs(npcs) {
        const npcsWithPhysics = await Promise.all(
            npcs.map(async (npc) => {
                // Generate ragdoll physics for this character type
                const physicsResult = await euphoriaService.generateRagdollPhysics({
                    characterType: npc.character.type,
                    mass: this.estimateMass(npc.character),
                    height: npc.character.height,
                    behavior: 'balanced',
                    strength: 'normal',
                });

                return {
                    ...npc,
                    physics: physicsResult.success ? physicsResult.config : null,
                };
            })
        );

        return npcsWithPhysics;
    }

    /**
     * Estimate character mass from physical attributes
     * @param {Object} character - Character data
     * @returns {number} Estimated mass in kg
     */
    estimateMass(character) {
        const { type, height, build } = character;

        // Base mass estimation
        let baseMass = 70; // average adult

        if (type === 'child') baseMass = 30;
        if (type === 'elderly') baseMass = 65;

        // Adjust for build
        const buildMultiplier = {
            slim: 0.85,
            average: 1.0,
            athletic: 1.1,
            heavy: 1.3,
        };

        // Adjust for height
        const heightFactor = height / 1.75; // normalize to average height

        return baseMass * (buildMultiplier[build] || 1.0) * heightFactor;
    }

    /**
     * Simple fallback crowd generation (non-AI)
     * Used only if AI generation fails
     */
    generateSimpleCrowd(options) {
        const { count, area } = options;
        const npcs = [];

        for (let i = 0; i < count; i++) {
            npcs.push({
                id: `npc_${String(i).padStart(3, '0')}`,
                position: {
                    x: (Math.random() - 0.5) * area.width,
                    y: 0,
                    z: (Math.random() - 0.5) * area.depth,
                },
                rotation: { x: 0, y: Math.random() * 360, z: 0 },
                character: {
                    type: 'adult',
                    height: 1.6 + Math.random() * 0.4,
                    build: 'average',
                    gender: Math.random() > 0.5 ? 'male' : 'female',
                    age: 20 + Math.floor(Math.random() * 40),
                },
                behavior: {
                    state: 'standing',
                    path: [],
                    speed: 0,
                    animation: 'idle',
                },
            });
        }

        return {
            npcs,
            metadata: {
                totalNPCs: count,
                averageDensity: count / (area.width * area.depth),
                scenario: 'default',
            },
        };
    }
}

module.exports = new CrowdService();
