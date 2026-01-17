/**
 * 2D Drawing Generation Service
 * Auto-generate engineering drawings from 3D CAD models
 * Views: orthographic, section, detail, isometric
 * Dimensions, GD&T, annotations, BOM tables, title blocks
 * Export: DWG, DXF, PDF
 */

class DrawingGenerationService {
    constructor() {
        this.drawings = new Map();
        this.templates = this.initializeTemplates();
        this.dimensionStandards = this.initializeDimensionStandards();
    }

    /**
     * Generate 2D drawing from 3D model
     */
    async generateDrawing(spec) {
        const {
            modelId,
            model3D,
            drawingName,
            standard = 'ISO',  // 'ISO', 'ANSI', 'DIN', 'JIS'
            sheetSize = 'A3',  // 'A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Tabloid'
            scale = '1:1',
            units = 'mm',
            views = [],  // Array of view specifications
            autoGenerateViews = true,
            includeBOM = false,
            includeGDT = false  // Geometric Dimensioning & Tolerancing
        } = spec;

        console.log(`📐 Drawing Generation: Creating "${drawingName}"...`);

        const drawingId = `dwg_${Date.now()}`;

        // Create drawing sheet
        const drawing = {
            drawingId,
            drawingName,
            modelId,
            standard,
            sheetSize,
            sheetDimensions: this.getSheetDimensions(sheetSize),
            scale,
            units,
            views: [],
            dimensions: [],
            annotations: [],
            bomTable: null,
            titleBlock: this.createTitleBlock(drawingName, standard, sheetSize),
            createdAt: Date.now()
        };

        // Auto-generate standard views if requested
        if (autoGenerateViews && views.length === 0) {
            views.push(
                { type: 'front', position: { x: 50, y: 150 }, scale },
                { type: 'top', position: { x: 50, y: 50 }, scale },
                { type: 'right', position: { x: 200, y: 150 }, scale },
                { type: 'isometric', position: { x: 300, y: 50 }, scale: '1:2' }
            );
        }

        // Generate views
        for (const viewSpec of views) {
            const view = await this.generateView(model3D, viewSpec, drawing);
            drawing.views.push(view);
        }

        // Auto-dimension views
        for (const view of drawing.views) {
            if (view.type !== 'isometric') {
                const dims = await this.autoDimension(view, model3D, standard);
                drawing.dimensions.push(...dims);
            }
        }

        // Add GD&T if requested
        if (includeGDT) {
            const gdtAnnotations = await this.generateGDT(model3D, drawing, standard);
            drawing.annotations.push(...gdtAnnotations);
        }

        // Generate BOM table if requested
        if (includeBOM) {
            drawing.bomTable = await this.generateBOMTable(model3D, drawing);
        }

        this.drawings.set(drawingId, drawing);

        return {
            success: true,
            operation: 'generate-drawing',
            drawing,
            previewUrl: `/api/mechanical/drawings/${drawingId}/preview.png`,
            exportFormats: ['DWG', 'DXF', 'PDF', 'SVG']
        };
    }

    /**
     * Generate a single view
     */
    async generateView(model3D, viewSpec, drawing) {
        const {
            type,  // 'front', 'top', 'right', 'left', 'bottom', 'back', 'isometric', 'section', 'detail', 'auxiliary'
            position,
            scale,
            sectionPlane = null,  // For section views
            detailCenter = null,  // For detail views
            detailScale = '2:1',  // For detail views
            hiddenLines = 'dashed',  // 'show', 'hide', 'dashed'
            centerlines = true
        } = viewSpec;

        console.log(`  📷 Generating ${type} view at scale ${scale}...`);

        const view = {
            viewId: `view_${drawing.views.length}`,
            type,
            position,
            scale,
            projection: this.getProjectionDirection(type),
            edges: [],
            hiddenEdges: [],
            centerlines: [],
            hatching: [],  // For section views
            boundingBox: { width: 0, height: 0 },
            createdAt: Date.now()
        };

        // Project 3D model to 2D
        const projectedGeometry = this.projectTo2D(model3D, view.projection);

        // Extract visible edges
        view.edges = this.extractVisibleEdges(projectedGeometry, view.projection);

        // Extract hidden edges
        if (hiddenLines !== 'hide') {
            view.hiddenEdges = this.extractHiddenEdges(projectedGeometry, view.projection);
        }

        // Add centerlines for cylindrical features
        if (centerlines) {
            view.centerlines = this.generateCenterlines(projectedGeometry);
        }

        // Section view specific
        if (type === 'section' && sectionPlane) {
            view.sectionPlane = sectionPlane;
            view.hatching = this.generateSectionHatching(model3D, sectionPlane, drawing.standard);
        }

        // Detail view specific
        if (type === 'detail' && detailCenter) {
            view.detailCenter = detailCenter;
            view.detailRadius = 20;  // mm
            view.scale = detailScale;
        }

        // Calculate bounding box
        view.boundingBox = this.calculateViewBoundingBox(view);

        console.log(`    ✅ ${type} view: ${view.edges.length} edges, ${view.hiddenEdges.length} hidden`);

        return view;
    }

    /**
     * Auto-dimension a view
     */
    async autoDimension(view, model3D, standard) {
        console.log(`  📏 Auto-dimensioning ${view.type} view...`);

        const dimensions = [];

        // Detect features to dimension
        const features = this.detectDimensionableFeatures(view, model3D);

        // Linear dimensions
        for (const feature of features.linearFeatures) {
            const dim = this.createLinearDimension(feature, view, standard);
            if (dim) dimensions.push(dim);
        }

        // Radial/diameter dimensions
        for (const feature of features.circularFeatures) {
            const dim = this.createRadialDimension(feature, view, standard);
            if (dim) dimensions.push(dim);
        }

        // Angular dimensions
        for (const feature of features.angularFeatures) {
            const dim = this.createAngularDimension(feature, view, standard);
            if (dim) dimensions.push(dim);
        }

        // Hole callouts
        for (const feature of features.holes) {
            const dim = this.createHoleCallout(feature, view, standard);
            if (dim) dimensions.push(dim);
        }

        // Chamfer dimensions
        for (const feature of features.chamfers) {
            const dim = this.createChamferDimension(feature, view, standard);
            if (dim) dimensions.push(dim);
        }

        console.log(`    ✅ Added ${dimensions.length} dimensions`);

        return dimensions;
    }

    /**
     * Create linear dimension
     */
    createLinearDimension(feature, view, standard) {
        const {
            startPoint,
            endPoint,
            direction,  // 'horizontal', 'vertical', 'aligned'
            value
        } = feature;

        return {
            dimensionId: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'linear',
            viewId: view.viewId,
            startPoint,
            endPoint,
            direction,
            value,
            text: this.formatDimensionText(value, standard),
            tolerance: null,  // Can be set later
            arrowStyle: standard === 'ISO' ? 'filled' : 'open',
            textPosition: 'above'  // 'above', 'centered', 'below'
        };
    }

    /**
     * Create radial/diameter dimension
     */
    createRadialDimension(feature, view, standard) {
        const {
            center,
            radius,
            diameter,
            isRadius  // true for R, false for Ø
        } = feature;

        const value = isRadius ? radius : diameter;
        const prefix = isRadius ? 'R' : (standard === 'ISO' ? 'Ø' : 'Dia ');

        return {
            dimensionId: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: isRadius ? 'radius' : 'diameter',
            viewId: view.viewId,
            center,
            value,
            text: `${prefix}${this.formatDimensionText(value, standard)}`,
            tolerance: null,
            arrowStyle: standard === 'ISO' ? 'filled' : 'open',
            leaderLine: true
        };
    }

    /**
     * Create angular dimension
     */
    createAngularDimension(feature, view, standard) {
        const {
            vertex,
            line1Start,
            line1End,
            line2Start,
            line2End,
            angle
        } = feature;

        return {
            dimensionId: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'angular',
            viewId: view.viewId,
            vertex,
            line1: { start: line1Start, end: line1End },
            line2: { start: line2Start, end: line2End },
            value: angle,
            text: `${angle.toFixed(1)}°`,
            arcRadius: 30  // mm (radius of dimension arc)
        };
    }

    /**
     * Create hole callout
     */
    createHoleCallout(feature, view, standard) {
        const {
            center,
            diameter,
            depth,
            thread = null,  // e.g., 'M6x1.0'
            counterbore = null,
            countersink = null
        } = feature;

        let calloutText = '';

        if (thread) {
            calloutText = thread;
        } else {
            const prefix = standard === 'ISO' ? 'Ø' : 'Dia ';
            calloutText = `${prefix}${diameter}`;
        }

        if (depth && depth !== 'through') {
            calloutText += ` ↧${depth}`;  // Depth symbol
        } else if (depth === 'through') {
            calloutText += ' THRU';
        }

        if (counterbore) {
            calloutText += `\n⌴${counterbore.diameter} ↧${counterbore.depth}`;  // Counterbore symbol
        }

        if (countersink) {
            calloutText += `\n⌵${countersink.diameter} × ${countersink.angle}°`;  // Countersink symbol
        }

        return {
            dimensionId: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'hole-callout',
            viewId: view.viewId,
            center,
            text: calloutText,
            leaderLine: true,
            leaderArrow: true
        };
    }

    /**
     * Create chamfer dimension
     */
    createChamferDimension(feature, view, standard) {
        const {
            edge,
            distance,
            angle = 45
        } = feature;

        let text = '';
        if (angle === 45) {
            text = `${distance} × 45°`;
        } else {
            text = `${distance} × ${angle}°`;
        }

        return {
            dimensionId: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'chamfer',
            viewId: view.viewId,
            edge,
            distance,
            angle,
            text,
            leaderLine: true
        };
    }

    /**
     * Generate GD&T annotations
     */
    async generateGDT(model3D, drawing, standard) {
        console.log(`  🎯 Generating GD&T annotations...`);

        const annotations = [];

        // Detect critical features that need GD&T
        const criticalFeatures = this.detectCriticalFeatures(model3D);

        for (const feature of criticalFeatures) {
            const annotation = this.createGDTAnnotation(feature, standard);
            if (annotation) annotations.push(annotation);
        }

        console.log(`    ✅ Added ${annotations.length} GD&T annotations`);

        return annotations;
    }

    /**
     * Create GD&T annotation
     */
    createGDTAnnotation(feature, standard) {
        const {
            featureType,  // 'surface', 'hole', 'bore', 'face'
            characteristic,  // 'flatness', 'perpendicularity', 'position', 'runout', etc.
            tolerance,
            datum = null,
            materialCondition = null  // 'MMC', 'LMC', 'RFS'
        } = feature;

        const symbol = this.getGDTSymbol(characteristic);

        let frameText = `${symbol} ${tolerance}`;

        if (materialCondition) {
            frameText += ` ${this.getMaterialConditionSymbol(materialCondition)}`;
        }

        if (datum) {
            frameText += ` | ${datum}`;
        }

        return {
            annotationId: `gdt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'gdt',
            characteristic,
            tolerance,
            datum,
            materialCondition,
            frameText,
            symbol,
            leaderLine: true,
            position: feature.position
        };
    }

    /**
     * Get GD&T symbol
     */
    getGDTSymbol(characteristic) {
        const symbols = {
            'flatness': '⏥',
            'straightness': '—',
            'circularity': '○',
            'cylindricity': '⌭',
            'perpendicularity': '⊥',
            'parallelism': '∥',
            'angularity': '∠',
            'position': '⊕',
            'concentricity': '◎',
            'symmetry': '≡',
            'circular-runout': '↗',
            'total-runout': '⤻',
            'profile-surface': '⌓',
            'profile-line': '⌒'
        };

        return symbols[characteristic] || characteristic;
    }

    /**
     * Get material condition symbol
     */
    getMaterialConditionSymbol(condition) {
        const symbols = {
            'MMC': 'Ⓜ',  // Maximum Material Condition
            'LMC': 'Ⓛ',  // Least Material Condition
            'RFS': ''    // Regardless of Feature Size (no symbol)
        };

        return symbols[condition] || '';
    }

    /**
     * Generate BOM table
     */
    async generateBOMTable(model3D, drawing) {
        console.log(`  📋 Generating BOM table...`);

        // Extract parts from model
        const parts = this.extractPartsFromModel(model3D);

        const bomTable = {
            tableId: `bom_${Date.now()}`,
            drawingId: drawing.drawingId,
            position: { x: 10, y: drawing.sheetDimensions.height - 150 },  // Bottom left
            columns: ['Item', 'Part Number', 'Description', 'Material', 'Qty'],
            rows: [],
            style: {
                headerHeight: 10,
                rowHeight: 8,
                fontSize: 3.5,
                columnWidths: [15, 40, 80, 40, 15]
            }
        };

        parts.forEach((part, index) => {
            bomTable.rows.push({
                item: index + 1,
                partNumber: part.partNumber || `PART-${index + 1}`,
                description: part.name || part.description,
                material: part.material || 'N/A',
                quantity: part.quantity || 1
            });
        });

        console.log(`    ✅ BOM table: ${bomTable.rows.length} items`);

        return bomTable;
    }

    /**
     * Create title block
     */
    createTitleBlock(drawingName, standard, sheetSize) {
        const titleBlock = {
            drawingTitle: drawingName,
            drawingNumber: `DWG-${Date.now()}`,
            scale: '1:1',
            sheet: '1 of 1',
            revision: 'A',
            drawnBy: 'AI CAD Assistant',
            checkedBy: '',
            approvedBy: '',
            date: new Date().toISOString().split('T')[0],
            company: 'ArchDisc AI CAD',
            projectNumber: '',
            standard,
            units: 'mm',
            thirdAngle: standard === 'ANSI' || standard === 'ASME'  // true for 3rd angle, false for 1st angle
        };

        return titleBlock;
    }

    /**
     * Export drawing to DWG/DXF
     */
    async exportToDWG(drawingId, format = 'DWG') {
        console.log(`📤 Exporting drawing to ${format}...`);

        const drawing = this.drawings.get(drawingId);
        if (!drawing) {
            throw new Error(`Drawing ${drawingId} not found`);
        }

        const dwg = {
            format,
            version: format === 'DWG' ? 'AutoCAD 2018' : 'R14',
            units: drawing.units,
            sheets: [
                {
                    name: drawing.drawingName,
                    size: drawing.sheetSize,
                    layers: this.generateDWGLayers(drawing)
                }
            ],
            metadata: {
                title: drawing.titleBlock.drawingTitle,
                subject: 'Engineering drawing',
                author: drawing.titleBlock.drawnBy,
                createdAt: drawing.createdAt,
                modifiedAt: Date.now()
            }
        };

        return {
            success: true,
            operation: `export-${format.toLowerCase()}`,
            dwg,
            downloadUrl: `/api/mechanical/drawings/${drawingId}.${format.toLowerCase()}`
        };
    }

    /**
     * Generate DWG layers
     */
    generateDWGLayers(drawing) {
        const layers = [];

        // Layer 0: Visible edges
        layers.push({
            name: 'VISIBLE',
            color: 'black',
            lineType: 'CONTINUOUS',
            lineWeight: 0.25,
            entities: this.convertViewsToEntities(drawing.views, 'edges')
        });

        // Layer 1: Hidden edges
        layers.push({
            name: 'HIDDEN',
            color: 'gray',
            lineType: 'DASHED',
            lineWeight: 0.18,
            entities: this.convertViewsToEntities(drawing.views, 'hiddenEdges')
        });

        // Layer 2: Centerlines
        layers.push({
            name: 'CENTERLINE',
            color: 'blue',
            lineType: 'CENTER',
            lineWeight: 0.13,
            entities: this.convertViewsToEntities(drawing.views, 'centerlines')
        });

        // Layer 3: Dimensions
        layers.push({
            name: 'DIMENSIONS',
            color: 'red',
            lineType: 'CONTINUOUS',
            lineWeight: 0.18,
            entities: this.convertDimensionsToEntities(drawing.dimensions)
        });

        // Layer 4: Hatching (section views)
        layers.push({
            name: 'HATCH',
            color: 'black',
            lineType: 'CONTINUOUS',
            lineWeight: 0.13,
            entities: this.convertHatchingToEntities(drawing.views)
        });

        // Layer 5: Text
        layers.push({
            name: 'TEXT',
            color: 'black',
            lineType: 'CONTINUOUS',
            lineWeight: 0.18,
            entities: this.convertAnnotationsToEntities(drawing.annotations)
        });

        return layers;
    }

    /**
     * Export drawing to PDF
     */
    async exportToPDF(drawingId) {
        console.log(`📤 Exporting drawing to PDF...`);

        const drawing = this.drawings.get(drawingId);
        if (!drawing) {
            throw new Error(`Drawing ${drawingId} not found`);
        }

        const pdf = {
            format: 'PDF',
            pageSize: drawing.sheetSize,
            orientation: drawing.sheetSize === 'A4' ? 'portrait' : 'landscape',
            margins: { top: 10, right: 10, bottom: 10, left: 10 },
            content: {
                views: drawing.views,
                dimensions: drawing.dimensions,
                annotations: drawing.annotations,
                bomTable: drawing.bomTable,
                titleBlock: drawing.titleBlock
            },
            printSettings: {
                colorMode: 'monochrome',
                lineWeights: true,
                quality: 'high'
            }
        };

        return {
            success: true,
            operation: 'export-pdf',
            pdf,
            downloadUrl: `/api/mechanical/drawings/${drawingId}.pdf`
        };
    }

    // ========== Helper Methods ==========

    getSheetDimensions(sheetSize) {
        const sizes = {
            'A0': { width: 841, height: 1189 },
            'A1': { width: 594, height: 841 },
            'A2': { width: 420, height: 594 },
            'A3': { width: 297, height: 420 },
            'A4': { width: 210, height: 297 },
            'Letter': { width: 215.9, height: 279.4 },
            'Tabloid': { width: 279.4, height: 431.8 }
        };

        return sizes[sheetSize] || sizes['A3'];
    }

    getProjectionDirection(viewType) {
        const projections = {
            'front': { x: 0, y: 0, z: 1 },
            'top': { x: 0, y: -1, z: 0 },
            'right': { x: 1, y: 0, z: 0 },
            'left': { x: -1, y: 0, z: 0 },
            'bottom': { x: 0, y: 1, z: 0 },
            'back': { x: 0, y: 0, z: -1 },
            'isometric': { x: 1, y: 1, z: 1 }
        };

        return projections[viewType] || projections['front'];
    }

    projectTo2D(model3D, projection) {
        // Simplified 2D projection
        // Real implementation would use proper projection matrices
        return {
            vertices: model3D.vertices || [],
            edges: model3D.edges || [],
            faces: model3D.faces || []
        };
    }

    extractVisibleEdges(geometry, projection) {
        // Simplified visible edge extraction
        return geometry.edges.map((edge, index) => ({
            edgeId: `edge_${index}`,
            start: edge.start || { x: 0, y: 0 },
            end: edge.end || { x: 100, y: 100 },
            type: 'visible'
        }));
    }

    extractHiddenEdges(geometry, projection) {
        // Simplified hidden edge extraction
        return [];
    }

    generateCenterlines(geometry) {
        // Detect circular features and add centerlines
        return [];
    }

    generateSectionHatching(model3D, sectionPlane, standard) {
        // Generate cross-hatching for section views
        const hatchAngle = standard === 'ISO' ? 45 : 45;
        const hatchSpacing = 3;  // mm

        return {
            angle: hatchAngle,
            spacing: hatchSpacing,
            pattern: 'ANSI31',
            areas: []  // Cut surfaces
        };
    }

    calculateViewBoundingBox(view) {
        // Calculate bounding box from edges
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        view.edges.forEach(edge => {
            minX = Math.min(minX, edge.start.x, edge.end.x);
            minY = Math.min(minY, edge.start.y, edge.end.y);
            maxX = Math.max(maxX, edge.start.x, edge.end.x);
            maxY = Math.max(maxY, edge.start.y, edge.end.y);
        });

        return {
            width: maxX - minX,
            height: maxY - minY,
            minX, minY, maxX, maxY
        };
    }

    detectDimensionableFeatures(view, model3D) {
        // Simplified feature detection
        return {
            linearFeatures: [],
            circularFeatures: [],
            angularFeatures: [],
            holes: [],
            chamfers: []
        };
    }

    formatDimensionText(value, standard) {
        // Format dimension value according to standard
        return value.toFixed(2);
    }

    detectCriticalFeatures(model3D) {
        // Detect features that need GD&T
        return [];
    }

    extractPartsFromModel(model3D) {
        // Extract parts/components from 3D model
        return model3D.parts || [];
    }

    convertViewsToEntities(views, edgeType) {
        const entities = [];

        views.forEach(view => {
            const edges = view[edgeType] || [];
            edges.forEach(edge => {
                entities.push({
                    type: 'line',
                    start: [edge.start.x + view.position.x, edge.start.y + view.position.y],
                    end: [edge.end.x + view.position.x, edge.end.y + view.position.y]
                });
            });
        });

        return entities;
    }

    convertDimensionsToEntities(dimensions) {
        return dimensions.map(dim => ({
            type: 'dimension',
            dimensionType: dim.type,
            text: dim.text,
            position: dim.startPoint || dim.center
        }));
    }

    convertHatchingToEntities(views) {
        const entities = [];

        views.forEach(view => {
            if (view.hatching && view.hatching.areas) {
                view.hatching.areas.forEach(area => {
                    entities.push({
                        type: 'hatch',
                        pattern: view.hatching.pattern,
                        angle: view.hatching.angle,
                        spacing: view.hatching.spacing,
                        boundary: area
                    });
                });
            }
        });

        return entities;
    }

    convertAnnotationsToEntities(annotations) {
        return annotations.map(annotation => ({
            type: 'text',
            text: annotation.frameText || annotation.text,
            position: annotation.position,
            height: 3.5
        }));
    }

    initializeTemplates() {
        return {
            'ISO-A3': {
                sheetSize: 'A3',
                titleBlockPosition: { x: 10, y: 410 },
                viewLayout: 'third-angle',
                dimensionStyle: 'ISO'
            },
            'ANSI-A': {
                sheetSize: 'Letter',
                titleBlockPosition: { x: 10, y: 270 },
                viewLayout: 'third-angle',
                dimensionStyle: 'ANSI'
            }
        };
    }

    initializeDimensionStandards() {
        return {
            'ISO': {
                decimalSeparator: ',',
                arrowStyle: 'filled',
                textPosition: 'above',
                toleranceFormat: '±'
            },
            'ANSI': {
                decimalSeparator: '.',
                arrowStyle: 'open',
                textPosition: 'centered',
                toleranceFormat: '±'
            }
        };
    }
}

module.exports = new DrawingGenerationService();
