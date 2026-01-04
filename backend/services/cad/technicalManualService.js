/**
 * Technical Package & Manuals Service
 * Exploded views, assembly instructions, PDF booklets, service manuals
 */

const bedrockService = require('../bedrockService');

class TechnicalManualService {
    constructor() {
        this.manualTemplates = this._initializeTemplates();
    }

    /**
     * Initialize manual templates
     */
    _initializeTemplates() {
        return {
            assemblyInstructions: {
                sections: ['parts_list', 'tools_required', 'step_by_step', 'safety_warnings', 'diagrams'],
                format: 'step_based'
            },
            serviceManual: {
                sections: ['specifications', 'maintenance_schedule', 'troubleshooting', 'parts_catalog', 'warranty'],
                format: 'chapter_based'
            },
            userManual: {
                sections: ['introduction', 'safety', 'operation', 'maintenance', 'specifications'],
                format: 'chapter_based'
            }
        };
    }

    /**
     * Generate exploded view diagrams with callouts
     */
    async generateExplodedView(assemblyData, options = {}) {
        const {
            explosionDistance = 100, // mm
            includeCallouts = true,
            includePartNumbers = true,
            viewAngle = 'isometric'
        } = options;

        console.log(`💥 Generating exploded view for ${assemblyData.name}...`);

        const explodedView = {
            assemblyName: assemblyData.name,
            parts: [],
            callouts: [],
            explosionFactor: explosionDistance,
            viewAngle
        };

        // Calculate explosion vectors for each part
        assemblyData.parts?.forEach((part, index) => {
            const explosionVector = this._calculateExplosionVector(part, assemblyData.center || { x: 0, y: 0, z: 0 }, explosionDistance);

            const explodedPart = {
                partId: part.id,
                partNumber: part.partNumber || `P${index + 1}`,
                partName: part.name,
                originalPosition: part.position || { x: 0, y: 0, z: 0 },
                explodedPosition: {
                    x: (part.position?.x || 0) + explosionVector.x,
                    y: (part.position?.y || 0) + explosionVector.y,
                    z: (part.position?.z || 0) + explosionVector.z
                },
                calloutNumber: index + 1
            };

            explodedView.parts.push(explodedPart);

            // Generate callout
            if (includeCallouts) {
                explodedView.callouts.push({
                    number: index + 1,
                    partNumber: includePartNumbers ? explodedPart.partNumber : null,
                    description: part.description || part.name,
                    quantity: part.quantity || 1,
                    position: explodedPart.explodedPosition
                });
            }
        });

        console.log(`✅ Exploded view generated: ${explodedView.parts.length} parts`);

        return explodedView;
    }

    /**
     * Generate step-by-step assembly instructions
     */
    async generateAssemblyInstructions(assemblyData, options = {}) {
        const {
            includeImages = true,
            includeToolList = true,
            includeSafetyWarnings = true,
            language = 'en'
        } = options;

        console.log(`📖 Generating assembly instructions...`);

        const instructions = {
            assemblyName: assemblyData.name,
            sections: [],
            totalSteps: 0,
            estimatedTime: 0
        };

        // Parts list section
        instructions.sections.push({
            title: 'Parts List',
            type: 'parts_list',
            content: assemblyData.parts?.map((part, index) => ({
                item: index + 1,
                partNumber: part.partNumber,
                description: part.description || part.name,
                quantity: part.quantity || 1
            })) || []
        });

        // Tools required section
        if (includeToolList) {
            const tools = this._identifyRequiredTools(assemblyData);
            instructions.sections.push({
                title: 'Tools Required',
                type: 'tools_list',
                content: tools
            });
        }

        // Safety warnings
        if (includeSafetyWarnings) {
            instructions.sections.push({
                title: 'Safety Warnings',
                type: 'safety',
                content: [
                    'Wear appropriate safety equipment (gloves, safety glasses)',
                    'Ensure workspace is clean and well-lit',
                    'Keep children and pets away from work area',
                    'Follow all torque specifications carefully'
                ]
            });
        }

        // Step-by-step instructions
        const steps = await this._generateAssemblySteps(assemblyData);
        instructions.totalSteps = steps.length;
        instructions.estimatedTime = steps.reduce((sum, step) => sum + (step.estimatedTime || 0), 0);

        instructions.sections.push({
            title: 'Assembly Steps',
            type: 'step_by_step',
            content: steps
        });

        console.log(`✅ Assembly instructions generated: ${instructions.totalSteps} steps, ${instructions.estimatedTime} min`);

        return instructions;
    }

    /**
     * Generate PDF booklet
     */
    async generatePDFBooklet(content, options = {}) {
        const {
            title = 'Technical Manual',
            includeTableOfContents = true,
            includePageNumbers = true,
            pageSize = 'A4',
            orientation = 'portrait'
        } = options;

        console.log(`📄 Generating PDF booklet: ${title}...`);

        const pdf = {
            title,
            pageSize,
            orientation,
            pages: [],
            metadata: {
                author: 'ArchDisc CAD',
                createdDate: new Date().toISOString(),
                version: '1.0'
            }
        };

        // Cover page
        pdf.pages.push({
            pageNumber: 1,
            type: 'cover',
            content: {
                title,
                subtitle: content.subtitle || '',
                logo: 'archdisc_logo.png'
            }
        });

        // Table of contents
        if (includeTableOfContents) {
            pdf.pages.push({
                pageNumber: 2,
                type: 'toc',
                content: this._generateTableOfContents(content)
            });
        }

        // Content pages
        let pageNum = includeTableOfContents ? 3 : 2;
        content.sections?.forEach(section => {
            pdf.pages.push({
                pageNumber: pageNum++,
                type: 'content',
                section: section.title,
                content: section.content
            });
        });

        console.log(`✅ PDF booklet generated: ${pdf.pages.length} pages`);

        return pdf;
    }

    /**
     * Auto-update manuals on design changes
     */
    async updateManualOnChange(manual, assemblyData, changes) {
        console.log(`🔄 Updating manual based on ${changes.length} design changes...`);

        const updates = {
            sectionsUpdated: [],
            stepsAffected: [],
            newSteps: []
        };

        changes.forEach(change => {
            if (change.type === 'part_added') {
                // Add new step for new part
                updates.newSteps.push({
                    step: `Install ${change.partName}`,
                    partId: change.partId
                });
                updates.sectionsUpdated.push('Parts List');
                updates.sectionsUpdated.push('Assembly Steps');
            } else if (change.type === 'part_removed') {
                updates.stepsAffected.push({
                    action: 'remove',
                    partId: change.partId
                });
                updates.sectionsUpdated.push('Parts List');
            }
        });

        // Regenerate affected sections
        const updatedManual = await this.generateAssemblyInstructions(assemblyData);

        console.log(`✅ Manual updated: ${updates.sectionsUpdated.length} sections, ${updates.newSteps.length} new steps`);

        return {
            manual: updatedManual,
            updates
        };
    }

    /**
     * Generate service manual
     */
    async generateServiceManual(productData) {
        console.log(`🔧 Generating service manual for ${productData.name}...`);

        const serviceManual = {
            productName: productData.name,
            modelNumber: productData.modelNumber,
            sections: []
        };

        // Specifications section
        serviceManual.sections.push({
            title: 'Specifications',
            content: {
                dimensions: productData.dimensions || 'N/A',
                weight: productData.mass || 'N/A',
                material: productData.material || 'N/A',
                operatingTemperature: productData.operatingTemp || '-20°C to 60°C',
                power: productData.power || 'N/A'
            }
        });

        // Maintenance schedule
        serviceManual.sections.push({
            title: 'Maintenance Schedule',
            content: [
                { interval: 'Daily', task: 'Visual inspection' },
                { interval: 'Weekly', task: 'Clean and lubricate moving parts' },
                { interval: 'Monthly', task: 'Check fastener torque' },
                { interval: 'Annually', task: 'Replace wear components' }
            ]
        });

        // Troubleshooting
        serviceManual.sections.push({
            title: 'Troubleshooting',
            content: [
                { problem: 'Excessive vibration', cause: 'Loose fasteners', solution: 'Tighten all bolts to specified torque' },
                { problem: 'Overheating', cause: 'Insufficient lubrication', solution: 'Apply recommended lubricant' }
            ]
        });

        // Parts catalog
        const partsCatalog = productData.parts?.map((part, index) => ({
            item: index + 1,
            partNumber: part.partNumber,
            description: part.description || part.name,
            replacementInterval: part.serviceLife || 'As needed'
        }));

        serviceManual.sections.push({
            title: 'Parts Catalog',
            content: partsCatalog
        });

        console.log(`✅ Service manual generated: ${serviceManual.sections.length} sections`);

        return serviceManual;
    }

    // Helper methods

    _calculateExplosionVector(part, center, distance) {
        const partCenter = part.position || { x: 0, y: 0, z: 0 };

        // Vector from assembly center to part
        const dx = partCenter.x - center.x;
        const dy = partCenter.y - center.y;
        const dz = partCenter.z - center.z;

        const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

        // Normalize and scale by explosion distance
        return {
            x: (dx / magnitude) * distance,
            y: (dy / magnitude) * distance,
            z: (dz / magnitude) * distance
        };
    }

    _identifyRequiredTools(assemblyData) {
        const tools = new Set();

        assemblyData.parts?.forEach(part => {
            if (part.fasteners && part.fasteners.length > 0) {
                tools.add('Wrench set');
                tools.add('Socket set');
            }
            if (part.requiresTorque) {
                tools.add('Torque wrench');
            }
        });

        return Array.from(tools);
    }

    async _generateAssemblySteps(assemblyData) {
        const steps = [];

        assemblyData.parts?.forEach((part, index) => {
            steps.push({
                stepNumber: index + 1,
                title: `Install ${part.name}`,
                description: `Position ${part.name} and secure with fasteners`,
                partNumber: part.partNumber,
                tools: this._getToolsForPart(part),
                estimatedTime: 5, // minutes
                imageRef: `step_${index + 1}.png`,
                warnings: part.safetyWarnings || []
            });
        });

        return steps;
    }

    _getToolsForPart(part) {
        const tools = [];
        if (part.fasteners) {
            tools.push('Wrench');
        }
        if (part.requiresTorque) {
            tools.push('Torque wrench');
        }
        return tools;
    }

    _generateTableOfContents(content) {
        return content.sections?.map((section, index) => ({
            chapter: index + 1,
            title: section.title,
            pageNumber: index + 3 // Accounting for cover and TOC
        })) || [];
    }
}

module.exports = new TechnicalManualService();
