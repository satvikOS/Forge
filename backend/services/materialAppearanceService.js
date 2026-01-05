/**
 * Material & Appearance Management Service
 * Material library (metals, plastics, composites, ceramics)
 * Physical properties, visual appearance, textures
 * Rendering properties (color, finish, transparency, reflectivity)
 */

class MaterialAppearanceService {
    constructor() {
        this.materials = this.initializeMaterialLibrary();
        this.appearances = new Map();
        this.customMaterials = new Map();
    }

    /**
     * Apply material to model or feature
     */
    async applyMaterial(spec) {
        const {
            modelId,
            featureIds = null,  // null = entire model
            materialId,
            appearance = null  // Optional visual overrides
        } = spec;

        const material = this.materials.get(materialId) || this.customMaterials.get(materialId);
        if (!material) {
            throw new Error(`Material ${materialId} not found`);
        }

        console.log(`🎨 Applying material: ${material.name}...`);

        const assignment = {
            assignmentId: `mat_${Date.now()}`,
            modelId,
            featureIds,
            material,
            appearance: appearance || material.defaultAppearance,
            appliedAt: Date.now()
        };

        // Calculate mass if geometry available
        if (spec.geometry) {
            assignment.mass = this.calculateMass(spec.geometry, material);
            assignment.volume = this.calculateVolume(spec.geometry);
        }

        console.log(`  ✅ Material applied: ${material.name}`);

        return {
            success: true,
            operation: 'apply-material',
            assignment,
            properties: {
                density: material.density,
                mass: assignment.mass
            }
        };
    }

    /**
     * Create custom material
     */
    async createCustomMaterial(spec) {
        const {
            name,
            category,  // 'metal', 'plastic', 'composite', 'ceramic', 'other'
            properties,  // Physical properties
            appearance,  // Visual properties
            cost = null
        } = spec;

        console.log(`✨ Creating custom material: "${name}"...`);

        const materialId = `custom_${Date.now()}`;

        const material = {
            materialId,
            name,
            category,
            isCustom: true,
            // Physical properties
            density: properties.density || 1.0,  // g/cm³
            elasticModulus: properties.elasticModulus || null,  // GPa
            yieldStrength: properties.yieldStrength || null,  // MPa
            tensileStrength: properties.tensileStrength || null,  // MPa
            thermalConductivity: properties.thermalConductivity || null,  // W/(m·K)
            thermalExpansion: properties.thermalExpansion || null,  // µm/(m·°C)
            specificHeat: properties.specificHeat || null,  // J/(g·°C)
            // Visual properties
            defaultAppearance: {
                color: appearance.color || '#808080',
                finish: appearance.finish || 'matte',  // 'matte', 'satin', 'glossy', 'polished', 'brushed'
                transparency: appearance.transparency || 0,  // 0-1
                reflectivity: appearance.reflectivity || 0.3,  // 0-1
                roughness: appearance.roughness || 0.5,  // 0-1
                metallic: appearance.metallic || 0  // 0-1
            },
            // Cost
            costPerKg: cost,
            createdAt: Date.now()
        };

        this.customMaterials.set(materialId, material);

        console.log(`  ✅ Custom material created`);

        return {
            success: true,
            operation: 'create-custom-material',
            material
        };
    }

    /**
     * Get material properties
     */
    async getMaterialProperties(materialId) {
        const material = this.materials.get(materialId) || this.customMaterials.get(materialId);
        if (!material) {
            throw new Error(`Material ${materialId} not found`);
        }

        return {
            success: true,
            operation: 'get-material-properties',
            material: {
                id: material.materialId,
                name: material.name,
                category: material.category,
                physical: {
                    density: material.density,
                    elasticModulus: material.elasticModulus,
                    yieldStrength: material.yieldStrength,
                    tensileStrength: material.tensileStrength,
                    thermalConductivity: material.thermalConductivity,
                    thermalExpansion: material.thermalExpansion
                },
                visual: material.defaultAppearance,
                cost: material.costPerKg
            }
        };
    }

    /**
     * Apply appearance (visual only, no material change)
     */
    async applyAppearance(spec) {
        const {
            modelId,
            featureIds = null,
            appearance
        } = spec;

        const appearanceId = `app_${Date.now()}`;

        const visualAppearance = {
            appearanceId,
            modelId,
            featureIds,
            color: appearance.color || '#808080',
            finish: appearance.finish || 'matte',
            transparency: appearance.transparency || 0,
            reflectivity: appearance.reflectivity || 0.3,
            roughness: appearance.roughness || 0.5,
            metallic: appearance.metallic || 0,
            texture: appearance.texture || null,  // Texture map URL
            bumpMap: appearance.bumpMap || null,  // Bump map URL
            normalMap: appearance.normalMap || null,  // Normal map URL
            appliedAt: Date.now()
        };

        this.appearances.set(appearanceId, visualAppearance);

        console.log(`🎨 Appearance applied: ${appearance.color}, ${appearance.finish}`);

        return {
            success: true,
            operation: 'apply-appearance',
            appearance: visualAppearance
        };
    }

    /**
     * Get material library
     */
    async getMaterialLibrary(options = {}) {
        const {
            category = null,
            search = null,
            limit = 100
        } = options;

        let materials = Array.from(this.materials.values());

        // Add custom materials
        materials.push(...Array.from(this.customMaterials.values()));

        // Filter by category
        if (category) {
            materials = materials.filter(m => m.category === category);
        }

        // Search
        if (search) {
            const query = search.toLowerCase();
            materials = materials.filter(m =>
                m.name.toLowerCase().includes(query) ||
                m.category.toLowerCase().includes(query)
            );
        }

        // Limit
        materials = materials.slice(0, limit);

        return {
            success: true,
            operation: 'get-material-library',
            materials: materials.map(m => ({
                id: m.materialId,
                name: m.name,
                category: m.category,
                density: m.density,
                color: m.defaultAppearance.color,
                isCustom: m.isCustom || false
            })),
            total: materials.length
        };
    }

    // ========== Helper Methods ==========

    calculateMass(geometry, material) {
        const volume = this.calculateVolume(geometry);  // mm³
        return (volume / 1000) * material.density;  // grams
    }

    calculateVolume(geometry) {
        // Simplified
        return 1000;  // mm³
    }

    // ========== Initialization ==========

    initializeMaterialLibrary() {
        const library = new Map();

        // Aluminum Alloys
        library.set('al-6061', {
            materialId: 'al-6061',
            name: 'Aluminum 6061-T6',
            category: 'metal',
            density: 2.70,
            elasticModulus: 68.9,
            yieldStrength: 276,
            tensileStrength: 310,
            thermalConductivity: 167,
            thermalExpansion: 23.6,
            specificHeat: 0.896,
            costPerKg: 3.00,
            defaultAppearance: {
                color: '#D4D4D4',
                finish: 'brushed',
                transparency: 0,
                reflectivity: 0.7,
                roughness: 0.3,
                metallic: 1.0
            }
        });

        library.set('al-7075', {
            materialId: 'al-7075',
            name: 'Aluminum 7075-T6',
            category: 'metal',
            density: 2.81,
            elasticModulus: 71.7,
            yieldStrength: 503,
            tensileStrength: 572,
            thermalConductivity: 130,
            thermalExpansion: 23.2,
            costPerKg: 4.50,
            defaultAppearance: {
                color: '#C8C8C8',
                finish: 'brushed',
                transparency: 0,
                reflectivity: 0.7,
                roughness: 0.3,
                metallic: 1.0
            }
        });

        // Steel
        library.set('steel-mild', {
            materialId: 'steel-mild',
            name: 'Mild Steel (1018)',
            category: 'metal',
            density: 7.87,
            elasticModulus: 205,
            yieldStrength: 370,
            tensileStrength: 440,
            thermalConductivity: 51.9,
            thermalExpansion: 11.7,
            costPerKg: 0.80,
            defaultAppearance: {
                color: '#8C8C8C',
                finish: 'matte',
                transparency: 0,
                reflectivity: 0.5,
                roughness: 0.5,
                metallic: 1.0
            }
        });

        library.set('steel-stainless-304', {
            materialId: 'steel-stainless-304',
            name: 'Stainless Steel 304',
            category: 'metal',
            density: 8.00,
            elasticModulus: 193,
            yieldStrength: 215,
            tensileStrength: 505,
            thermalConductivity: 16.2,
            thermalExpansion: 17.2,
            costPerKg: 3.50,
            defaultAppearance: {
                color: '#A8A8A8',
                finish: 'polished',
                transparency: 0,
                reflectivity: 0.8,
                roughness: 0.2,
                metallic: 1.0
            }
        });

        // Titanium
        library.set('titanium-ti64', {
            materialId: 'titanium-ti64',
            name: 'Titanium Ti-6Al-4V',
            category: 'metal',
            density: 4.43,
            elasticModulus: 113.8,
            yieldStrength: 880,
            tensileStrength: 950,
            thermalConductivity: 6.7,
            thermalExpansion: 8.6,
            costPerKg: 35.00,
            defaultAppearance: {
                color: '#B0B0B0',
                finish: 'brushed',
                transparency: 0,
                reflectivity: 0.6,
                roughness: 0.4,
                metallic: 1.0
            }
        });

        // Plastics
        library.set('abs', {
            materialId: 'abs',
            name: 'ABS Plastic',
            category: 'plastic',
            density: 1.05,
            elasticModulus: 2.3,
            tensileStrength: 46,
            thermalExpansion: 90,
            costPerKg: 2.50,
            defaultAppearance: {
                color: '#2C2C2C',
                finish: 'matte',
                transparency: 0,
                reflectivity: 0.2,
                roughness: 0.7,
                metallic: 0
            }
        });

        library.set('polycarbonate', {
            materialId: 'polycarbonate',
            name: 'Polycarbonate (PC)',
            category: 'plastic',
            density: 1.20,
            elasticModulus: 2.4,
            tensileStrength: 62,
            thermalExpansion: 65,
            costPerKg: 4.00,
            defaultAppearance: {
                color: '#FFFFFF',
                finish: 'glossy',
                transparency: 0.9,
                reflectivity: 0.4,
                roughness: 0.1,
                metallic: 0
            }
        });

        library.set('nylon', {
            materialId: 'nylon',
            name: 'Nylon 6/6 (PA66)',
            category: 'plastic',
            density: 1.14,
            elasticModulus: 2.9,
            tensileStrength: 82,
            thermalExpansion: 80,
            costPerKg: 3.20,
            defaultAppearance: {
                color: '#F5F5DC',
                finish: 'satin',
                transparency: 0,
                reflectivity: 0.3,
                roughness: 0.5,
                metallic: 0
            }
        });

        // Composites
        library.set('carbon-fiber', {
            materialId: 'carbon-fiber',
            name: 'Carbon Fiber Composite',
            category: 'composite',
            density: 1.55,
            elasticModulus: 150,
            tensileStrength: 600,
            thermalExpansion: -0.5,
            costPerKg: 50.00,
            defaultAppearance: {
                color: '#1A1A1A',
                finish: 'glossy',
                transparency: 0,
                reflectivity: 0.6,
                roughness: 0.2,
                metallic: 0.3,
                texture: '/textures/carbon-fiber-weave.jpg'
            }
        });

        return library;
    }
}

module.exports = new MaterialAppearanceService();
