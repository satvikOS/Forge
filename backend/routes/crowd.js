/**
 * Crowd Generation API Routes
 * Handles NPC crowd generation requests using AI
 */

const express = require('express');
const router = express.Router();
const crowdService = require('../services/crowdService');

/**
 * POST /api/crowd/generate
 * Generate an NPC crowd with AI-powered placement and behaviors
 */
router.post('/generate', async (req, res) => {
    try {
        const {
            count = 10,
            area = { width: 50, depth: 50 },
            behavior = 'mixed',
            density = 'medium',
            characterTypes = ['adult', 'child', 'elderly'],
            scenario = 'urban street',
            applyPhysics = false
        } = req.body;

        console.log(`🎯 Generating crowd: ${count} NPCs in ${area.width}x${area.depth}m area`);

        // Generate crowd using AI service
        const result = await crowdService.generateCrowd({
            count,
            area,
            behavior,
            density,
            characterTypes,
            scenario
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate crowd'
            });
        }

        // Optionally apply Euphoria physics to NPCs
        let crowd = result.crowd;
        if (applyPhysics && result.crowd.npcs) {
            console.log('⚡ Applying Euphoria physics to NPCs...');
            const npcsWithPhysics = await crowdService.applyEuphoriaToNPCs(result.crowd.npcs);
            crowd = {
                ...result.crowd,
                npcs: npcsWithPhysics
            };
        }

        res.json({
            success: true,
            crowd,
            metadata: {
                count: crowd.npcs?.length || 0,
                area,
                scenario,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error generating crowd:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/crowd/behavior
 * Generate crowd behavior patterns for a scenario
 */
router.post('/behavior', async (req, res) => {
    try {
        const {
            scenario = 'busy street',
            timeOfDay = 'afternoon',
            event = null,
            weatherConditions = 'clear'
        } = req.body;

        console.log(`🎭 Generating crowd behavior for: ${scenario}`);

        const result = await crowdService.generateCrowdBehavior({
            scenario,
            timeOfDay,
            event,
            weatherConditions
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate crowd behavior'
            });
        }

        res.json({
            success: true,
            rules: result.rules
        });

    } catch (error) {
        console.error('❌ Error generating crowd behavior:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/crowd/characters
 * Generate character variations for diversity
 */
router.post('/characters', async (req, res) => {
    try {
        const { count = 10 } = req.body;

        console.log(`👥 Generating ${count} character variations`);

        const result = await crowdService.generateCharacterVariations(count);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate character variations'
            });
        }

        res.json({
            success: true,
            variations: result.variations,
            count: result.variations?.length || 0
        });

    } catch (error) {
        console.error('❌ Error generating character variations:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
