/**
 * Procedural Generation API Routes
 * Handles terrain, building, vegetation, and world generation
 */

const express = require('express');
const router = express.Router();
const proceduralEngine = require('../services/ProceduralGenerationEngine');

/**
 * POST /api/procedural/generate-world
 * Generate a complete procedural world
 */
router.post('/generate-world', async (req, res) => {
    try {
        const {
            worldType = 'natural',
            size = { width: 200, depth: 200 },
            features = ['terrain', 'vegetation'],
            theme = 'temperate'
        } = req.body;

        console.log(`🌍 Generating procedural world: ${worldType} (${size.width}x${size.depth}m)`);

        const result = await proceduralEngine.generateWorld({
            worldType,
            size,
            features,
            theme
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate world'
            });
        }

        res.json({
            success: true,
            world: result.world,
            metadata: result.metadata
        });

    } catch (error) {
        console.error('❌ Error generating world:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/procedural/terrain
 * Generate procedural terrain
 */
router.post('/terrain', async (req, res) => {
    try {
        const {
            type = 'plains',
            size = { width: 100, depth: 100 },
            heightVariation = 'medium',
            features = [],
            biome = 'temperate'
        } = req.body;

        console.log(`⛰️ Generating terrain: ${type} (${size.width}x${size.depth}m)`);

        const result = await proceduralEngine.generateTerrain({
            type,
            size,
            heightVariation,
            features,
            biome
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate terrain'
            });
        }

        res.json({
            success: true,
            terrain: result.terrain,
            metadata: result.metadata
        });

    } catch (error) {
        console.error('❌ Error generating terrain:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/procedural/buildings
 * Generate procedural buildings
 */
router.post('/buildings', async (req, res) => {
    try {
        const {
            count = 5,
            area = { width: 100, depth: 100 },
            buildingType = 'mixed',
            density = 'medium',
            style = 'modern',
            maxHeight = 50
        } = req.body;

        console.log(`🏢 Generating ${count} buildings in ${area.width}x${area.depth}m area`);

        const result = await proceduralEngine.generateBuildings({
            count,
            area,
            buildingType,
            density,
            style,
            maxHeight
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate buildings'
            });
        }

        res.json({
            success: true,
            buildings: result.buildings,
            metadata: result.metadata
        });

    } catch (error) {
        console.error('❌ Error generating buildings:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/procedural/vegetation
 * Generate procedural vegetation
 */
router.post('/vegetation', async (req, res) => {
    try {
        const {
            area = { width: 100, depth: 100 },
            density = 'medium',
            biome = 'temperate forest',
            types = ['trees', 'bushes', 'grass'],
            terrainData = null
        } = req.body;

        console.log(`🌳 Generating vegetation for ${biome}`);

        const result = await proceduralEngine.generateVegetation({
            area,
            density,
            biome,
            types,
            terrainData
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate vegetation'
            });
        }

        res.json({
            success: true,
            vegetation: result.vegetation,
            metadata: result.metadata
        });

    } catch (error) {
        console.error('❌ Error generating vegetation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/procedural/props
 * Generate environmental props
 */
router.post('/props', async (req, res) => {
    try {
        const {
            area = { width: 50, depth: 50 },
            propTypes = ['rocks', 'debris'],
            density = 'sparse',
            theme = 'natural'
        } = req.body;

        console.log(`📦 Generating environmental props`);

        const result = await proceduralEngine.generateEnvironmentalProps({
            area,
            propTypes,
            density,
            theme
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to generate props'
            });
        }

        res.json({
            success: true,
            props: result.props
        });

    } catch (error) {
        console.error('❌ Error generating props:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
