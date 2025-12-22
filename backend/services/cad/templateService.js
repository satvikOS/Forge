/**
 * Template Service
 * Manages industry-standard templates, company templates, and starting models
 */

class TemplateService {
    constructor() {
        this.templates = this.initializeTemplates();
    }

    /**
     * Initialize industry-standard templates
     */
    initializeTemplates() {
        return {
            // Part templates
            parts: {
                'ANSI_Bracket': {
                    id: 'tmp_ansi_bracket',
                    name: 'ANSI Bracket Template',
                    standard: 'ANSI',
                    type: 'part',
                    description: 'Standard mounting bracket with ANSI dimensions',
                    parameters: {
                        width: 50,
                        height: 75,
                        thickness: 3,
                        holeSize: 6.5, // M6 clearance
                        material: 'Steel_1045'
                    },
                    features: ['base_plate', 'mounting_holes', 'ribs']
                },
                'ISO_Shaft': {
                    id: 'tmp_iso_shaft',
                    name: 'ISO Shaft Template',
                    standard: 'ISO',
                    type: 'part',
                    description: 'Standard shaft with ISO tolerances',
                    parameters: {
                        diameter: 20,
                        length: 100,
                        shoulderDiameter: 25,
                        keyway: 'DIN_6885',
                        toleranceClass: 'h7'
                    }
                },
                'DIN_Fastener': {
                    id: 'tmp_din_fastener',
                    name: 'DIN Fastener Template',
                    standard: 'DIN',
                    type: 'part',
                    description: 'DIN standard bolt/screw template',
                    parameters: {
                        threadSize: 'M8',
                        length: 30,
                        headType: 'hex', // hex, socket, flat
                        threadPitch: 1.25
                    }
                }
            },

            // Assembly templates
            assemblies: {
                'ANSI_Frame': {
                    id: 'tmp_ansi_frame',
                    name: 'ANSI Frame Assembly',
                    standard: 'ANSI',
                    type: 'assembly',
                    description: 'Structural frame with ANSI profiles',
                    components: ['frame_members', 'corner_plates', 'fasteners'],
                    mates: ['planar', 'concentric']
                },
                'ISO_Module': {
                    id: 'tmp_iso_module',
                    name: 'ISO Modular System',
                    standard: 'ISO',
                    type: 'assembly',
                    description: 'ISO modular assembly template',
                    gridSize: 25, // ISO modular grid
                    components: ['base', 'modules', 'connectors']
                }
            },

            // Drawing templates
            drawings: {
                'ANSI_A_Landscape': {
                    id: 'tmp_draw_ansi_a',
                    name: 'ANSI A Size (Landscape)',
                    standard: 'ANSI',
                    type: 'drawing',
                    size: 'A',
                    orientation: 'landscape',
                    dimensions: { width: 11, height: 8.5, unit: 'in' },
                    titleBlock: {
                        company: '{COMPANY_NAME}',
                        title: '{PART_NAME}',
                        number: '{PART_NUMBER}',
                        revision: 'A',
                        scale: '1:1',
                        units: 'inches'
                    }
                },
                'ISO_A3_Landscape': {
                    id: 'tmp_draw_iso_a3',
                    name: 'ISO A3 (Landscape)',
                    standard: 'ISO',
                    type: 'drawing',
                    size: 'A3',
                    orientation: 'landscape',
                    dimensions: { width: 420, height: 297, unit: 'mm' },
                    titleBlock: {
                        company: '{COMPANY_NAME}',
                        title: '{PART_NAME}',
                        number: '{PART_NUMBER}',
                        revision: '01',
                        scale: '1:1',
                        units: 'mm'
                    }
                },
                'DIN_A1_Portrait': {
                    id: 'tmp_draw_din_a1',
                    name: 'DIN A1 (Portrait)',
                    standard: 'DIN',
                    type: 'drawing',
                    size: 'A1',
                    orientation: 'portrait',
                    dimensions: { width: 594, height: 841, unit: 'mm' }
                }
            }
        };
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId) {
        // Search all template categories
        for (const category of Object.values(this.templates)) {
            for (const template of Object.values(category)) {
                if (template.id === templateId) {
                    return template;
                }
            }
        }

        throw new Error(`Template ${templateId} not found`);
    }

    /**
     * List templates by type
     */
    listTemplates(type = null, standard = null) {
        if (type && this.templates[type]) {
            let templates = Object.values(this.templates[type]);

            if (standard) {
                templates = templates.filter(t => t.standard === standard);
            }

            return templates;
        }

        // Return all templates
        const all = [];
        for (const category of Object.values(this.templates)) {
            all.push(...Object.values(category));
        }

        return all;
    }

    /**
     * Create model from template
     */
    createFromTemplate(templateId, customParameters = {}) {
        const template = this.getTemplate(templateId);

        const model = {
            id: `model_${Date.now()}`,
            templateId: templateId,
            name: template.name.replace(' Template', ''),
            type: template.type,
            standard: template.standard,
            parameters: { ...template.parameters, ...customParameters },
            features: template.features || [],
            components: template.components || [],
            createdAt: new Date().toISOString(),
            fromTemplate: true
        };

        return model;
    }

    /**
     * Create company-specific template
     */
    createCustomTemplate(name, baseTemplateId, customizations = {}) {
        const baseTemplate = baseTemplateId ? this.getTemplate(baseTemplateId) : {};

        const customTemplate = {
            id: `custom_${Date.now()}`,
            name: name,
            baseTemplate: baseTemplateId,
            type: customizations.type || baseTemplate.type || 'part',
            standard: 'Company',
            parameters: { ...baseTemplate.parameters, ...customizations.parameters },
            features: customizations.features || baseTemplate.features || [],
            metadata: {
                createdBy: customizations.createdBy || 'User',
                createdAt: new Date().toISOString(),
                description: customizations.description || ''
            }
        };

        return customTemplate;
    }

    /**
     * Get template preview
     */
    getTemplatePreview(templateId) {
        const template = this.getTemplate(templateId);

        return {
            id: template.id,
            name: template.name,
            thumbnail: template.thumbnail || null,
            description: template.description || '',
            parameters: Object.keys(template.parameters || {}),
            estimatedComplexity: this.estimateComplexity(template)
        };
    }

    /**
     * Estimate template complexity
     */
    estimateComplexity(template) {
        const featureCount = (template.features || []).length;
        const componentCount = (template.components || []).length;

        if (featureCount + componentCount < 5) return 'Simple';
        if (featureCount + componentCount < 15) return 'Medium';
        return 'Complex';
    }

    /**
     * Save template to library
     */
    saveToLibrary(template, category = 'parts') {
        if (!this.templates[category]) {
            this.templates[category] = {};
        }

        this.templates[category][template.id] = template;

        return {
            success: true,
            message: 'Template saved to library'
        };
    }
}

module.exports = TemplateService;
