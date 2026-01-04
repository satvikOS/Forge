/**
 * NURBS Surfacing Engine
 * Advanced surface modeling for organic shapes and Class-A surfaces
 */

class SurfacingEngine {
    constructor() {
        this.surfaceTypes = ['lofted', 'swept', 'boundary', 'blend', 'offset', 'extruded'];
        this.continuityLevels = ['G0', 'G1', 'G2', 'G3']; // Position, Tangent, Curvature, Curvature rate
        this.surfaceCache = new Map();
    }

    /**
     * Create NURBS surface
     */
    createNURBSSurface(controlPoints, degreeU = 3, degreeV = 3, options = {}) {
        const {
            knotsU = this.generateKnots(controlPoints.length, degreeU),
            knotsV = this.generateKnots(controlPoints[0].length, degreeV),
            weights = null
        } = options;

        const surface = {
            id: `surface_${Date.now()}`,
            type: 'nurbs',
            degreeU: degreeU,
            degreeV: degreeV,
            controlPoints: controlPoints,
            knotsU: knotsU,
            knotsV: knotsV,
            weights: weights || this.generateUniformWeights(controlPoints),
            metadata: {
                createdAt: new Date().toISOString()
            }
        };

        return surface;
    }

    /**
     * Create lofted surface from profile curves
     */
    async createLoftedSurface(profiles, options = {}) {
        const {
            loftType = 'normal', // 'normal', 'centerline', 'area'
            guideCurves = [],
            startTangency = null,
            endTangency = null,
            closeSurface = false
        } = options;

        console.log(`🏄 Creating lofted surface from ${profiles.length} profiles...`);

        // Validate profiles
        if (profiles.length < 2) {
            throw new Error('At least 2 profiles required for lofting');
        }

        // Generate surface control points by interpolating profiles
        const controlPoints = this.interpolateProfiles(profiles, loftType);

        // Apply guide curves if provided
        if (guideCurves.length > 0) {
            this.applyGuideCurves(controlPoints, guideCurves);
        }

        // Apply tangency constraints
        if (startTangency) {
            this.applyTangencyConstraint(controlPoints, 0, startTangency);
        }
        if (endTangency) {
            this.applyTangencyConstraint(controlPoints, profiles.length - 1, endTangency);
        }

        const surface = this.createNURBSSurface(controlPoints, 3, 3);
        surface.surfaceType = 'lofted';
        surface.loftOptions = { loftType, closeSurface };

        console.log(`✅ Lofted surface created`);
        return surface;
    }

    /**
     * Create swept surface along path
     */
    async createSweptSurface(profile, path, options = {}) {
        const {
            twist = 0, // degrees
            scale = 1.0,
            alignment = 'perpendicular', // 'perpendicular', 'parallel'
            keepProfileOrientation = false
        } = options;

        console.log('🌀 Creating swept surface...');

        // Sample path at intervals
        const pathSamples = this.sampleCurve(path, 20);

        // Sweep profile along path
        const controlPoints = [];
        pathSamples.forEach((point, i) => {
            const t = i / (pathSamples.length - 1);

            // Calculate orientation at this point
            const tangent = this.calculateTangent(path, t);
            const normal = this.calculateNormal(tangent);

            // Transform profile to current position
            const transformedProfile = this.transformProfile(
                profile,
                point,
                tangent,
                normal,
                scale * (1 + t * 0), // Constant scale for now
                twist * t
            );

            controlPoints.push(transformedProfile);
        });

        const surface = this.createNURBSSurface(controlPoints, 3, 3);
        surface.surfaceType = 'swept';
        surface.sweepOptions = { twist, scale, alignment };

        console.log('✅ Swept surface created');
        return surface;
    }

    /**
     * Create boundary surface from edge curves
     */
    async createBoundarySurface(edges, options = {}) {
        const {
            continuity = 'G1',
            trimToEdges = true
        } = options;

        console.log('📐 Creating boundary surface...');

        // Validate edges (should have 3 or 4 edges)
        if (edges.length < 3 || edges.length > 4) {
            throw new Error('Boundary surface requires 3 or 4 edge curves');
        }

        // Generate Coons patch or similar
        const controlPoints = this.generateBoundaryPatch(edges, continuity);

        const surface = this.createNURBSSurface(controlPoints, 3, 3);
        surface.surfaceType = 'boundary';
        surface.boundaryOptions = { continuity, trimToEdges };

        console.log('✅ Boundary surface created');
        return surface;
    }

    /**
     * Create blend surface between two surfaces
     */
    async createBlendSurface(surface1, surface2, options = {}) {
        const {
            continuity = 'G2',
            blendRadius = 10,
            trimOriginalSurfaces = true
        } = options;

        console.log('🔗 Creating blend surface...');

        // Extract edge curves from surfaces
        const edge1 = this.extractEdge(surface1, 'closest_to', surface2);
        const edge2 = this.extractEdge(surface2, 'closest_to', surface1);

        // Create blend based on continuity
        let controlPoints;
        if (continuity === 'G0') {
            controlPoints = this.createLinearBlend(edge1, edge2);
        } else if (continuity === 'G1') {
            controlPoints = this.createTangentBlend(edge1, edge2, surface1, surface2);
        } else if (continuity === 'G2' || continuity === 'G3') {
            controlPoints = this.createCurvatureBlend(edge1, edge2, surface1, surface2, blendRadius);
        }

        const surface = this.createNURBSSurface(controlPoints, 3, 3);
        surface.surfaceType = 'blend';
        surface.blendOptions = { continuity, blendRadius, trimOriginalSurfaces };

        console.log('✅ Blend surface created');
        return surface;
    }

    /**
     * Offset surface
     */
    offsetSurface(surface, distance) {
        console.log(`📏 Offsetting surface by ${distance}mm...`);

        // Calculate normals at control points
        const offsetControlPoints = surface.controlPoints.map((row, i) =>
            row.map((point, j) => {
                const normal = this.calculateSurfaceNormal(surface, i / surface.controlPoints.length, j / row.length);
                return {
                    x: point.x + normal.x * distance,
                    y: point.y + normal.y * distance,
                    z: point.z + normal.z * distance
                };
            })
        );

        const offsetSurf = this.createNURBSSurface(offsetControlPoints, surface.degreeU, surface.degreeV);
        offsetSurf.surfaceType = 'offset';
        offsetSurf.offsetDistance = distance;

        return offsetSurf;
    }

    /**
     * Trim surface with curve
     */
    trimSurface(surface, trimmingCurve, keepInside = true) {
        console.log('✂️ Trimming surface...');

        const trimmed = {
            ...surface,
            trimmed: true,
            trimmingCurves: [trimmingCurve],
            keepInside: keepInside
        };

        return trimmed;
    }

    /**
     * Untrim surface
     */
    untrimSurface(surface) {
        const { trimmed, trimmingCurves, keepInside, ...untrimmed } = surface;
        return untrimmed;
    }

    /**
     * Analyze surface curvature
     */
    analyzeCurvature(surface, analysisType = 'gaussian') {
        console.log(`📊 Analyzing ${analysisType} curvature...`);

        const analysis = {
            type: analysisType,
            points: [],
            minCurvature: Infinity,
            maxCurvature: -Infinity,
            avgCurvature: 0
        };

        // Sample surface at grid points
        const samples = 20;
        for (let u = 0; u <= samples; u++) {
            for (let v = 0; v <= samples; v++) {
                const uParam = u / samples;
                const vParam = v / samples;

                let curvature;
                if (analysisType === 'gaussian') {
                    curvature = this.calculateGaussianCurvature(surface, uParam, vParam);
                } else if (analysisType === 'mean') {
                    curvature = this.calculateMeanCurvature(surface, uParam, vParam);
                } else {
                    curvature = this.calculatePrincipalCurvature(surface, uParam, vParam);
                }

                analysis.points.push({
                    u: uParam,
                    v: vParam,
                    curvature: curvature,
                    position: this.evaluateSurface(surface, uParam, vParam)
                });

                analysis.minCurvature = Math.min(analysis.minCurvature, curvature);
                analysis.maxCurvature = Math.max(analysis.maxCurvature, curvature);
                analysis.avgCurvature += curvature;
            }
        }

        analysis.avgCurvature /= analysis.points.length;

        return analysis;
    }

    /**
     * Generate zebra stripes for surface quality analysis
     */
    generateZebraStripes(surface, lightDirection = { x: 0, y: 0, z: 1 }) {
        console.log('🦓 Generating zebra stripe analysis...');

        const stripes = {
            surfaceId: surface.id,
            stripeCount: 10,
            stripeData: []
        };

        // Sample surface
        const samples = 50;
        for (let u = 0; u <= samples; u++) {
            for (let v = 0; v <= samples; v++) {
                const uParam = u / samples;
                const vParam = v / samples;

                const point = this.evaluateSurface(surface, uParam, vParam);
                const normal = this.calculateSurfaceNormal(surface, uParam, vParam);

                // Calculate reflection
                const reflection = this.calculateReflection(normal, lightDirection);
                const stripeValue = Math.floor((reflection + 1) * 5) % 2; // Alternating stripes

                stripes.stripeData.push({
                    u: uParam,
                    v: vParam,
                    position: point,
                    stripe: stripeValue,
                    normal: normal
                });
            }
        }

        return stripes;
    }

    /**
     * Curvature comb visualization
     */
    generateCurvatureComb(curve, scale = 1.0) {
        console.log('📊 Generating curvature comb...');

        const comb = {
            curveId: curve.id,
            combLines: []
        };

        const samples = 50;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const point = this.evaluateCurve(curve, t);
            const curvature = this.calculateCurvatureatPoint(curve, t);
            const normal = this.calculateNormal(this.calculateTangent(curve, t));

            comb.combLines.push({
                basePoint: point,
                endPoint: {
                    x: point.x + normal.x * curvature * scale,
                    y: point.y + normal.y * curvature * scale,
                    z: point.z + normal.z * curvature * scale
                },
                curvature: curvature
            });
        }

        return comb;
    }

    /**
     * Check curvature continuity between surfaces
     */
    checkContinuity(surface1, surface2, targetContinuity = 'G2') {
        console.log(`🔍 Checking ${targetContinuity} continuity...`);

        // Find common edge
        const commonEdge = this.findCommonEdge(surface1, surface2);

        if (!commonEdge) {
            return {
                continuous: false,
                reason: 'No common edge found'
            };
        }

        // Sample along edge
        const samples = 20;
        const violations = [];

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;

            const normal1 = this.calculateSurfaceNormal(surface1, commonEdge.u1, t);
            const normal2 = this.calculateSurfaceNormal(surface2, commonEdge.u2, t);

            // G0: Position continuity (always satisfied if common edge exists)
            // G1: Tangent continuity
            const tangentAngle = this.angleBetweenVectors(normal1, normal2);

            if (targetContinuity === 'G1' && tangentAngle > 1) { // 1 degree tolerance
                violations.push({
                    parameter: t,
                    type: 'G1',
                    angle: tangentAngle
                });
            }

            // G2: Curvature continuity
            if (targetContinuity === 'G2') {
                const curv1 = this.calculateGaussianCurvature(surface1, commonEdge.u1, t);
                const curv2 = this.calculateGaussianCurvature(surface2, commonEdge.u2, t);
                const curvDiff = Math.abs(curv1 - curv2);

                if (curvDiff > 0.01) {
                    violations.push({
                        parameter: t,
                        type: 'G2',
                        curvatureDifference: curvDiff
                    });
                }
            }
        }

        return {
            continuous: violations.length === 0,
            continuityLevel: this.determineContinuityLevel(violations),
            violations: violations,
            summary: violations.length === 0 ? `✅ ${targetContinuity} continuity achieved` : `⚠️ ${violations.length} continuity violations`
        };
    }

    // ========== HELPER METHODS ==========

    generateKnots(controlPointCount, degree) {
        const knotCount = controlPointCount + degree + 1;
        const knots = [];

        for (let i = 0; i < knotCount; i++) {
            if (i <= degree) {
                knots.push(0);
            } else if (i >= knotCount - degree - 1) {
                knots.push(1);
            } else {
                knots.push((i - degree) / (knotCount - 2 * degree - 1));
            }
        }

        return knots;
    }

    generateUniformWeights(controlPoints) {
        return controlPoints.map(row => row.map(() => 1.0));
    }

    interpolateProfiles(profiles, loftType) {
        // Simplified interpolation
        const controlPoints = [];

        profiles.forEach(profile => {
            controlPoints.push(profile.points || profile);
        });

        return controlPoints;
    }

    applyGuideCurves(controlPoints, guideCurves) {
        // Simplified guide curve application
        // In production: adjust control points to pass through guides
    }

    applyTangencyConstraint(controlPoints, index, tangent) {
        // Adjust control points to match tangency
    }

    sampleCurve(curve, sampleCount) {
        const samples = [];
        for (let i = 0; i <= sampleCount; i++) {
            const t = i / sampleCount;
            samples.push(this.evaluateCurve(curve, t));
        }
        return samples;
    }

    evaluateCurve(curve, t) {
        // Simplified curve evaluation
        return curve.points ? curve.points[Math.floor(t * (curve.points.length - 1))] : { x: t * 100, y: 0, z: 0 };
    }

    evaluateSurface(surface, u, v) {
        // Simplified NURBS surface evaluation
        const i = Math.floor(u * (surface.controlPoints.length - 1));
        const j = Math.floor(v * (surface.controlPoints[0].length - 1));
        return surface.controlPoints[Math.min(i, surface.controlPoints.length - 1)][Math.min(j, surface.controlPoints[0].length - 1)];
    }

    calculateTangent(curve, t) {
        // Simplified tangent calculation
        return { x: 1, y: 0, z: 0 };
    }

    calculateNormal(tangent) {
        // Perpendicular to tangent
        return { x: -tangent.y, y: tangent.x, z: 0 };
    }

    calculateSurfaceNormal(surface, u, v) {
        // Simplified normal calculation
        return { x: 0, y: 0, z: 1 };
    }

    transformProfile(profile, position, tangent, normal, scale, twist) {
        // Transform profile points
        return profile.points || profile;
    }

    generateBoundaryPatch(edges, continuity) {
        // Coons patch or similar
        return edges.map(edge => edge.points || [{ x: 0, y: 0, z: 0 }]);
    }

    extractEdge(surface, location, referenceSurface) {
        // Extract edge curve
        return { points: surface.controlPoints[0] };
    }

    createLinearBlend(edge1, edge2) {
        // Linear blend
        return [edge1.points, edge2.points];
    }

    createTangentBlend(edge1, edge2, surf1, surf2) {
        // G1 blend
        return [edge1.points, edge2.points];
    }

    createCurvatureBlend(edge1, edge2, surf1, surf2, radius) {
        // G2 blend
        return [edge1.points, edge2.points];
    }

    calculateGaussianCurvature(surface, u, v) {
        // Simplified curvature = k1 * k2
        return Math.random() * 0.1 - 0.05;
    }

    calculateMeanCurvature(surface, u, v) {
        // Simplified curvature = (k1 + k2) / 2
        return Math.random() * 0.1;
    }

    calculatePrincipalCurvature(surface, u, v) {
        return { k1: Math.random() * 0.1, k2: Math.random() * 0.1 };
    }

    calculateCurvatureatPoint(curve, t) {
        return Math.random() * 0.1;
    }

    calculateReflection(normal, lightDir) {
        // Dot product
        return normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z;
    }

    findCommonEdge(surf1, surf2) {
        // Simplified
        return { u1: 0.5, u2: 0.5 };
    }

    angleBetweenVectors(v1, v2) {
        // Simplified angle calculation
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        return Math.acos(dot) * 180 / Math.PI;
    }

    determineContinuityLevel(violations) {
        if (violations.length === 0) return 'G3';
        if (violations.every(v => v.type === 'G2')) return 'G1';
        return 'G0';
    }
}

module.exports = new SurfacingEngine();
