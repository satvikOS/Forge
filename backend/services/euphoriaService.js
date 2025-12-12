/**
 * Euphoria Physics Service
 * AI-powered Natural Motion Euphoria-style physics generation
 * Generates procedural animation parameters using Gemini API
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class EuphoriaService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    }

    /**
     * Generate Euphoria ragdoll physics parameters for a character
     * @param {Object} options - Character and physics options
     * @returns {Object} Ragdoll physics configuration
     */
    async generateRagdollPhysics(options = {}) {
        const {
            characterType = 'humanoid',
            mass = 75, // kg
            height = 1.8, // meters
            behavior = 'balanced',
            strength = 'normal',
        } = options;

        const prompt = `Generate Natural Motion Euphoria-style ragdoll physics parameters for a ${characterType} character.

Character Specifications:
- Type: ${characterType}
- Mass: ${mass} kg
- Height: ${height} meters
- Behavior: ${behavior} (options: passive, balanced, reactive, aggressive)
- Strength: ${strength} (options: weak, normal, strong, superhuman)

Generate a comprehensive ragdoll physics configuration with:
1. Joint hierarchy (bones and their connections)
2. Joint limits (min/max rotation angles for each axis)
3. Mass distribution across body parts
4. Stiffness and damping values for each joint
5. Balance controller parameters
6. Reaction strength for different body parts
7. Center of mass location
8. Ground contact points (feet, hands if applicable)

Return the configuration as a structured JSON object with the following format:
{
  "skeleton": {
    "joints": [
      {
        "name": "pelvis",
        "parent": null,
        "position": {"x": 0, "y": 1.0, "z": 0},
        "mass": 15,
        "limits": {
          "x": {"min": -30, "max": 30},
          "y": {"min": -45, "max": 45},
          "z": {"min": -30, "max": 30}
        },
        "stiffness": 0.8,
        "damping": 0.1
      }
    ]
  },
  "balance": {
    "centerOfMass": {"x": 0, "y": 0.9, "z": 0},
    "balanceStrength": 0.7,
    "recoverySpeed": 0.5,
    "maxLeanAngle": 25
  },
  "reactions": {
    "reactionStrength": 0.6,
    "limbs": {
      "arms": 0.8,
      "legs": 0.9,
      "spine": 0.7
    }
  },
  "groundContact": {
    "points": [
      {"name": "leftFoot", "position": {"x": -0.15, "y": 0, "z": 0}},
      {"name": "rightFoot", "position": {"x": 0.15, "y": 0, "z": 0}}
    ],
    "friction": 0.8
  }
}

Ensure all values are realistic for the character type and follow biomechanical principles.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract JSON from AI response');
            }

            const physicsConfig = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated Euphoria ragdoll configuration for ${characterType}`);
            return {
                success: true,
                characterType,
                config: physicsConfig,
                metadata: {
                    mass,
                    height,
                    behavior,
                    strength,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating ragdoll physics:', error);
            return {
                success: false,
                error: error.message,
                fallback: this.getDefaultRagdollConfig(characterType)
            };
        }
    }

    /**
     * Generate procedural animation for a character action
     * @param {Object} options - Animation options
     * @returns {Object} Animation keyframes and curves
     */
    async generateProceduralAnimation(options = {}) {
        const {
            action = 'walk',
            duration = 2.0, // seconds
            fps = 30,
            characterRig,
            style = 'natural',
        } = options;

        const prompt = `Generate procedural animation keyframes for a character performing: ${action}

Animation Parameters:
- Action: ${action}
- Duration: ${duration} seconds
- FPS: ${fps}
- Style: ${style} (natural, exaggerated, robotic, fluid)

Generate keyframe data for the following joints:
- Pelvis (root)
- Spine, Chest, Neck, Head
- Left/Right Shoulder, Elbow, Wrist
- Left/Right Hip, Knee, Ankle

For each keyframe, provide:
- Frame number
- Joint rotations (Euler angles in degrees)
- Joint positions (for root/pelvis only)
- Easing function

Return as JSON array of keyframes with format:
{
  "animation": {
    "name": "${action}",
    "duration": ${duration},
    "fps": ${fps},
    "keyframes": [
      {
        "frame": 0,
        "joints": {
          "pelvis": {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}},
          "spine": {"rotation": {"x": 0, "y": 0, "z": 0}},
          ...
        },
        "easing": "linear"
      }
    ],
    "loops": true
  }
}`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract animation JSON');
            }

            const animationData = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated procedural animation: ${action}`);
            return {
                success: true,
                animation: animationData.animation,
                metadata: {
                    action,
                    duration,
                    fps,
                    style,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating animation:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Generate balance behavior parameters
     * @param {Object} options - Balance options
     * @returns {Object} Balance controller configuration
     */
    async generateBalanceBehavior(options = {}) {
        const {
            surfaceType = 'flat',
            difficulty = 'normal',
            environmentFactors = [],
        } = options;

        const prompt = `Generate Natural Motion Euphoria balance behavior parameters.

Environment:
- Surface Type: ${surfaceType} (flat, slope, uneven, ice, etc.)
- Difficulty: ${difficulty}
- Factors: ${environmentFactors.join(', ')}

Generate balance controller parameters including:
- Ankle strategy strength
- Hip strategy strength
- Step strategy threshold
- Arm counterbalance strength
- Recovery reactions
- Maximum lean angles

Return as JSON with realistic biomechanical values.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const balanceConfig = JSON.parse(jsonMatch[0]);

            return {
                success: true,
                config: balanceConfig,
            };

        } catch (error) {
            console.error('❌ Error generating balance behavior:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Default ragdoll configuration (minimal fallback)
     * NOTE: This is only used if AI generation fails
     */
    getDefaultRagdollConfig(characterType) {
        return {
            skeleton: {
                joints: [
                    {
                        name: 'pelvis',
                        parent: null,
                        position: { x: 0, y: 1.0, z: 0 },
                        mass: 15,
                        limits: { x: { min: -30, max: 30 }, y: { min: -45, max: 45 }, z: { min: -30, max: 30 } },
                        stiffness: 0.8,
                        damping: 0.1,
                    },
                ],
            },
            balance: {
                centerOfMass: { x: 0, y: 0.9, z: 0 },
                balanceStrength: 0.7,
                recoverySpeed: 0.5,
                maxLeanAngle: 25,
            },
            reactions: {
                reactionStrength: 0.6,
                limbs: { arms: 0.8, legs: 0.9, spine: 0.7 },
            },
            groundContact: {
                points: [
                    { name: 'leftFoot', position: { x: -0.15, y: 0, z: 0 } },
                    { name: 'rightFoot', position: { x: 0.15, y: 0, z: 0 } },
                ],
                friction: 0.8,
            },
        };
    }
}

module.exports = new EuphoriaService();
