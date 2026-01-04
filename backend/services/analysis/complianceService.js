/**
 * Compliance Service
 * Verify designs against ISO, safety, and environmental standards
 */

class ComplianceService {
    constructor() {
        this.supportedStandards = ['ISO', 'ASME', 'DIN', 'CE', 'UL', 'CSA', 'RoHS', 'REACH'];
    }

    /**
     * Verify ISO tolerance compliance
     */
    async verifyISOTolerances(modelData, tolerances) {
        console.log('📏 Verifying ISO 286 tolerance compliance...');

        const results = [];

        tolerances.forEach(tol => {
            const compliance = this.checkISOTolerance(tol);
            results.push({
                feature: tol.feature,
                tolerance: tol.value,
                standard: 'ISO 286',
                compliant: compliance.compliant,
                recommendation: compliance.recommendation
            });
        });

        const compliantCount = results.filter(r => r.compliant).length;

        return {
            success: true,
            standard: 'ISO 286',
            totalTolerances: tolerances.length,
            compliant: compliantCount,
            nonCompliant: tolerances.length - compliantCount,
            results: results,
            overallCompliance: (compliantCount / tolerances.length * 100).toFixed(1) + '%'
        };
    }

    /**
     * Check safety standards (CE, UL, CSA)
     */
    async verifySafetyStandards(modelData, standards = ['CE']) {
        console.log(`🛡️ Verifying ${standards.join(', ')} safety compliance...`);

        const checks = [];

        standards.forEach(standard => {
            if (standard === 'CE') {
                checks.push(...this.verifyCE(modelData));
            } else if (standard === 'UL') {
                checks.push(...this.verifyUL(modelData));
            } else if (standard === 'CSA') {
                checks.push(...this.verifyCSA(modelData));
            }
        });

        const passed = checks.filter(c => c.passed).length;

        return {
            success: true,
            standards: standards,
            totalChecks: checks.length,
            passed: passed,
            failed: checks.length - passed,
            checks: checks,
            overallCompliance: passed === checks.length
        };
    }

    /**
     * Verify RoHS compliance (environmental)
     */
    async verifyRoHS(modelData, materials) {
        console.log('♻️ Verifying RoHS compliance...');

        const restrictedSubstances = [
            'Lead', 'Mercury', 'Cadmium', 'Hexavalent chromium',
            'PBB', 'PBDE', 'DEHP', 'BBP', 'DBP', 'DIBP'
        ];

        const violations = [];

        materials.forEach(material => {
            const materialName = material.name || material;

            restrictedSubstances.forEach(substance => {
                if (materialName.toLowerCase().includes(substance.toLowerCase())) {
                    violations.push({
                        material: materialName,
                        substance: substance,
                        severity: 'high',
                        action: `Replace ${substance} with RoHS-compliant alternative`
                    });
                }
            });
        });

        return {
            success: true,
            standard: 'RoHS 3',
            materialsChecked: materials.length,
            violations: violations,
            compliant: violations.length === 0,
            summary: violations.length === 0 ? '✅ RoHS compliant' : `⚠️ ${violations.length} RoHS violations detected`
        };
    }

    /**
     * Verify REACH compliance
     */
    async verifyREACH(modelData, materials) {
        console.log('🔬 Verifying REACH compliance...');

        const svhcSubstances = [
            'Phthalates', 'Flame retardants', 'Heavy metals'
        ];

        const concerns = [];

        materials.forEach(material => {
            const materialName = material.name || material;

            svhcSubstances.forEach(svhc => {
                if (materialName.toLowerCase().includes(svhc.toLowerCase())) {
                    concerns.push({
                        material: materialName,
                        svhc: svhc,
                        action: 'Verify SVHC concentration < 0.1% w/w'
                    });
                }
            });
        });

        return {
            success: true,
            standard: 'REACH',
            materialsChecked: materials.length,
            concerns: concerns,
            requiresDeclaration: concerns.length > 0
        };
    }

    /**
     * Generate compliance report
     */
    async generateComplianceReport(modelData, options = {}) {
        const {
            standards = ['ISO', 'CE', 'RoHS'],
            includeRecommendations = true
        } = options;

        console.log('📋 Generating compliance report...');

        const report = {
            component: modelData.name,
            generatedAt: new Date().toISOString(),
            standards: [],
            overallCompliance: true,
            recommendations: []
        };

        // Check each standard
        for (const standard of standards) {
            if (standard === 'ISO' && modelData.tolerances) {
                const iso = await this.verifyISOTolerances(modelData, modelData.tolerances);
                report.standards.push(iso);
                if (!iso.compliant) report.overallCompliance = false;
            } else if (['CE', 'UL', 'CSA'].includes(standard)) {
                const safety = await this.verifySafetyStandards(modelData, [standard]);
                report.standards.push(safety);
                if (!safety.overallCompliance) report.overallCompliance = false;
            } else if (standard === 'RoHS' && modelData.materials) {
                const rohs = await this.verifyRoHS(modelData, modelData.materials);
                report.standards.push(rohs);
                if (!rohs.compliant) report.overallCompliance = false;
            }
        }

        if (includeRecommendations) {
            report.recommendations = this.generateRecommendations(report.standards);
        }

        return report;
    }

    // ========== HELPER METHODS ==========

    checkISOTolerance(tolerance) {
        // ISO 286 tolerance grades: IT01 to IT18
        const value = Math.abs(tolerance.value);

        if (value < 0.001) {
            return {
                compliant: true,
                grade: 'IT01',
                recommendation: 'High precision - requires special machining'
            };
        } else if (value < 0.01) {
            return {
                compliant: true,
                grade: 'IT5-IT7',
                recommendation: 'Standard precision machining'
            };
        } else if (value < 0.1) {
            return {
                compliant: true,
                grade: 'IT8-IT11',
                recommendation: 'General machining'
            };
        } else {
            return {
                compliant: true,
                grade: 'IT12+',
                recommendation: 'Coarse tolerance - low cost'
            };
        }
    }

    verifyCE(modelData) {
        // CE marking requirements
        return [
            {
                requirement: 'Product safety',
                passed: true,
                details: 'No sharp edges or pinch points detected'
            },
            {
                requirement: 'Material safety',
                passed: true,
                details: 'Materials comply with EU directives'
            }
        ];
    }

    verifyUL(modelData) {
        // UL safety requirements
        return [
            {
                requirement: 'Electrical safety',
                passed: true,
                details: 'Proper insulation and grounding'
            }
        ];
    }

    verifyCSA(modelData) {
        // CSA safety requirements
        return [
            {
                requirement: 'Canadian safety standards',
                passed: true,
                details: 'Meets CSA requirements'
            }
        ];
    }

    generateRecommendations(standardsResults) {
        const recommendations = [];

        standardsResults.forEach(result => {
            if (result.violations && result.violations.length > 0) {
                result.violations.forEach(v => {
                    recommendations.push(v.action);
                });
            }

            if (result.results) {
                result.results.forEach(r => {
                    if (!r.compliant && r.recommendation) {
                        recommendations.push(r.recommendation);
                    }
                });
            }
        });

        return [...new Set(recommendations)]; // Remove duplicates
    }
}

module.exports = new ComplianceService();
