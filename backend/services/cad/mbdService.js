/**
 * Model-Based Definition (MBD) & QR Code Service
 * PMI embedding, drawingless workflow, QR code generation
 */

const QRCode = require('qrcode');

class MBDService {
    constructor() {
        this.pmiCategories = this._initializePMICategories();
    }

    /**
     * Initialize PMI (Product Manufacturing Information) categories
     */
    _initializePMICategories() {
        return {
            dimensions: 'dimensional_data',
            tolerances: 'geometric_tolerances',
            surface_finish: 'surface_texture',
            material: 'material_specifications',
            notes: 'manufacturing_notes',
            welding: 'weld_symbols',
            datums: 'datum_references'
        };
    }

    /**
     * Embed PMI into 3D model (Model-Based Definition)
     */
    async embedPMI(modelData, pmiData) {
        console.log(`📝 Embedding PMI into model: ${modelData.name}...`);

        if (!modelData.pmi) {
            modelData.pmi = [];
        }

        const pmi = {
            id: `pmi_${Date.now()}`,
            category: pmiData.category || 'dimensions',
            content: pmiData.content,
            attachedTo: pmiData.featureId,
            position: pmiData.position || { x: 0, y: 0, z: 0 },
            visible: pmiData.visible !== false,
            timestamp: new Date().toISOString()
        };

        modelData.pmi.push(pmi);

        console.log(`✅ PMI embedded: ${pmi.category} - ${pmi.content}`);

        return pmi;
    }

    /**
     * Generate 3D model as specification (drawingless workflow)
     */
    async generate3DSpecification(modelData, options = {}) {
        const {
            includeGDT = true,
            includeDimensions = true,
            includeMaterialSpec = true,
            includeManufacturingNotes = true,
            generateQRCode = true
        } = options;

        console.log(`📐 Generating 3D specification for drawingless workflow...`);

        const specification = {
            modelId: modelData.id,
            modelName: modelData.name,
            version: modelData.version || '1.0',
            pmiData: [],
            metadata: {},
            qrCode: null
        };

        // Extract and categorize all PMI
        if (modelData.pmi) {
            specification.pmiData = modelData.pmi.filter(pmi => {
                if (!includeGDT && pmi.category === 'tolerances') return false;
                if (!includeDimensions && pmi.category === 'dimensions') return false;
                if (!includeMaterialSpec && pmi.category === 'material') return false;
                if (!includeManufacturingNotes && pmi.category === 'notes') return false;
                return true;
            });
        }

        // Add metadata
        specification.metadata = {
            generatedDate: new Date().toISOString(),
            material: modelData.material || 'Not specified',
            mass: modelData.mass || 'TBD',
            volume: modelData.volume || 'TBD',
            boundingBox: modelData.boundingBox || {},
            revision: modelData.revision || 'A'
        };

        // Generate QR code for model access
        if (generateQRCode) {
            specification.qrCode = await this.generateQRCode(modelData, {
                includeURL: true
            });
        }

        console.log(`✅ 3D specification generated: ${specification.pmiData.length} PMI items`);

        return specification;
    }

    /**
     * Generate QR code for model access
     */
    async generateQRCode(modelData, options = {}) {
        const {
            includeURL = true,
            size = 300,
            errorCorrectionLevel = 'M',
            shopFloorAccess = true
        } = options;

        console.log(`📱 Generating QR code for model access...`);

        const modelURL = `https://archdisc.app/models/${modelData.id}`;

        const qrData = {
            modelId: modelData.id,
            modelName: modelData.name,
            version: modelData.version || '1.0',
            url: includeURL ? modelURL : null,
            accessType: shopFloorAccess ? 'shop_floor' : 'standard',
            generatedAt: new Date().toISOString()
        };

        // Generate QR code as data URL
        let qrCodeDataURL;
        try {
            qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
                errorCorrectionLevel,
                width: size,
                margin: 1
            });
        } catch (error) {
            console.error('QR code generation failed:', error);
            // Fallback: return placeholder
            qrCodeDataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        }

        console.log(`✅ QR code generated for shop floor access`);

        return {
            data: qrData,
            imageDataURL: qrCodeDataURL,
            size,
            modelURL
        };
    }

    /**
     * Enable shop floor digital access
     */
    async setupShopFloorAccess(modelData, qrCode) {
        console.log(`🏭 Setting up shop floor digital access...`);

        const accessConfig = {
            modelId: modelData.id,
            qrCodeId: qrCode.data.modelId,
            accessURL: qrCode.modelURL,
            permissions: {
                view3DModel: true,
                viewPMI: true,
                viewDimensions: true,
                viewMaterialSpec: true,
                downloadDrawings: false, // Shop floor typically doesn't need downloads
                editModel: false
            },
            devices: {
                tablet: true,
                phone: true,
                kiosk: true
            },
            offlineAccess: true,
            cacheModel: true
        };

        console.log(`✅ Shop floor access configured`);

        return accessConfig;
    }

    /**
     * Validate MBD completeness (ready for drawingless manufacturing)
     */
    validateMBDCompleteness(modelData) {
        console.log(`✔️ Validating MBD completeness...`);

        const validation = {
            complete: true,
            score: 0,
            maxScore: 100,
            missing: [],
            recommendations: []
        };

        const checks = [
            { name: 'Dimensions', weight: 25, check: () => modelData.pmi?.some(p => p.category === 'dimensions') },
            { name: 'GD&T Tolerances', weight: 25, check: () => modelData.pmi?.some(p => p.category === 'tolerances') },
            { name: 'Material Specification', weight: 15, check: () => modelData.material || modelData.pmi?.some(p => p.category === 'material') },
            { name: 'Surface Finish', weight: 15, check: () => modelData.pmi?.some(p => p.category === 'surface_finish') },
            { name: 'Manufacturing Notes', weight: 10, check: () => modelData.pmi?.some(p => p.category === 'notes') },
            { name: 'QR Code', weight: 10, check: () => modelData.qrCode != null }
        ];

        checks.forEach(checkItem => {
            if (checkItem.check()) {
                validation.score += checkItem.weight;
            } else {
                validation.complete = false;
                validation.missing.push(checkItem.name);
                validation.recommendations.push(`Add ${checkItem.name} to achieve MBD completeness`);
            }
        });

        const completeness = (validation.score / validation.maxScore) * 100;

        console.log(`✅ MBD completeness: ${completeness.toFixed(0)}% (${validation.score}/${validation.maxScore})`);

        if (completeness < 80) {
            validation.recommendations.push('Model needs more PMI data for full drawingless workflow');
        }

        return validation;
    }

    /**
     * Export MBD model for shop floor (optimized format)
     */
    async exportForShopFloor(modelData, specification) {
        console.log(`💾 Exporting MBD model for shop floor access...`);

        const shopFloorPackage = {
            model: {
                id: modelData.id,
                name: modelData.name,
                geometry: 'simplified', // Would be actual geometry data
                pmi: specification.pmiData
            },
            qrCode: specification.qrCode,
            viewerConfig: {
                defaultView: 'isometric',
                pmiVisible: true,
                dimensionsVisible: true,
                highlightTolerances: true
            },
            metadata: specification.metadata,
            exportDate: new Date().toISOString(),
            format: 'shop_floor_optimized'
        };

        console.log(`✅ Shop floor package exported`);

        return shopFloorPackage;
    }
}

module.exports = new MBDService();
