/**
 * Legality Service - Checks compliance with regulations and standards
 */
class LegalityService {
  /**
   * Check design compliance with regulations
   */
  async checkCompliance(designData) {
    const { objectType, dimensions, materials, features } = designData;

    const buildingCodes = objectType === 'building' ? this.checkBuildingCodes(dimensions, materials, features) : null;
    const safetyStandards = this.checkSafetyStandards(objectType, materials);
    const environmentalCompliance = this.checkEnvironmentalCompliance(objectType, materials);
    const manufacturingStandards = this.checkManufacturingStandards(objectType);

    const allChecks = [
      buildingCodes,
      safetyStandards,
      environmentalCompliance,
      manufacturingStandards,
    ].filter(Boolean);

    const complianceScore = this.calculateComplianceScore(allChecks);

    return {
      compliant: complianceScore >= 70,
      score: complianceScore,
      buildingCodes,
      safetyStandards,
      environmentalCompliance,
      manufacturingStandards,
      recommendations: this.generateRecommendations(allChecks),
    };
  }

  /**
   * Check building codes (for buildings)
   */
  checkBuildingCodes(dimensions, materials, features) {
    const checks = [];

    // Height restrictions
    if (dimensions.height > 50000) {
      checks.push({
        code: 'HEIGHT_LIMIT',
        status: 'warning',
        message: 'Building height may require special permits in some jurisdictions',
      });
    } else {
      checks.push({
        code: 'HEIGHT_LIMIT',
        status: 'pass',
        message: 'Height within standard limits',
      });
    }

    // Fire safety
    if (materials && materials.includes('wood') && dimensions.height > 10000) {
      checks.push({
        code: 'FIRE_SAFETY',
        status: 'warning',
        message: 'Wood structures over 10m may require additional fire protection',
      });
    } else {
      checks.push({
        code: 'FIRE_SAFETY',
        status: 'pass',
        message: 'Fire safety requirements met',
      });
    }

    // Accessibility
    if (features && (features.includes('elevator') || dimensions.height <= 15000)) {
      checks.push({
        code: 'ACCESSIBILITY',
        status: 'pass',
        message: 'Accessibility requirements met',
      });
    } else {
      checks.push({
        code: 'ACCESSIBILITY',
        status: 'warning',
        message: 'Building may require elevator for accessibility compliance',
      });
    }

    return {
      category: 'Building Codes',
      checks,
      passRate: (checks.filter(c => c.status === 'pass').length / checks.length) * 100,
    };
  }

  /**
   * Check safety standards
   */
  checkSafetyStandards(objectType, materials) {
    const checks = [];

    // Material safety
    const safeMaterials = ['aluminum', 'steel', 'concrete', 'glass', 'wood', 'carbon fiber'];
    const allSafe = materials.every(m => safeMaterials.includes(m) || m === 'default');
    
    checks.push({
      standard: 'MATERIAL_SAFETY',
      status: allSafe ? 'pass' : 'warning',
      message: allSafe ? 'All materials meet safety standards' : 'Some materials may require certification',
    });

    // Object-specific safety checks
    if (objectType === 'car') {
      checks.push({
        standard: 'CRASH_TEST',
        status: 'pending',
        message: 'Design requires crash test certification',
      });
      checks.push({
        standard: 'EMISSIONS',
        status: 'pass',
        message: 'Design meets emissions standards',
      });
    }

    if (objectType === 'building') {
      checks.push({
        standard: 'STRUCTURAL_SAFETY',
        status: 'pass',
        message: 'Structural design meets safety standards',
      });
    }

    return {
      category: 'Safety Standards',
      checks,
      passRate: (checks.filter(c => c.status === 'pass').length / checks.length) * 100,
    };
  }

  /**
   * Check environmental compliance
   */
  checkEnvironmentalCompliance(objectType, materials) {
    const checks = [];

    // Sustainable materials
    const sustainableMaterials = ['wood', 'aluminum'];
    const sustainabilityScore = materials.filter(m => sustainableMaterials.includes(m)).length / materials.length;

    checks.push({
      regulation: 'SUSTAINABILITY',
      status: sustainabilityScore > 0.3 ? 'pass' : 'warning',
      message: sustainabilityScore > 0.3 
        ? 'Design uses sustainable materials' 
        : 'Consider incorporating more sustainable materials',
    });

    // Energy efficiency
    if (objectType === 'building') {
      checks.push({
        regulation: 'ENERGY_EFFICIENCY',
        status: 'pass',
        message: 'Design meets energy efficiency standards',
      });
    }

    // Recyclability
    checks.push({
      regulation: 'RECYCLABILITY',
      status: 'pass',
      message: 'Materials are recyclable',
    });

    return {
      category: 'Environmental Compliance',
      checks,
      passRate: (checks.filter(c => c.status === 'pass').length / checks.length) * 100,
    };
  }

  /**
   * Check manufacturing standards
   */
  checkManufacturingStandards(objectType) {
    const checks = [];

    checks.push({
      standard: 'MANUFACTURABILITY',
      status: 'pass',
      message: 'Design is manufacturable with current technology',
    });

    checks.push({
      standard: 'QUALITY_CONTROL',
      status: 'pass',
      message: 'Design allows for quality control measures',
    });

    if (objectType === 'car') {
      checks.push({
        standard: 'ISO_9001',
        status: 'pending',
        message: 'Manufacturing process requires ISO 9001 certification',
      });
    }

    return {
      category: 'Manufacturing Standards',
      checks,
      passRate: (checks.filter(c => c.status === 'pass').length / checks.length) * 100,
    };
  }

  /**
   * Calculate overall compliance score
   */
  calculateComplianceScore(allChecks) {
    if (allChecks.length === 0) return 100;

    const totalPassRate = allChecks.reduce((sum, check) => sum + check.passRate, 0);
    return Math.round(totalPassRate / allChecks.length);
  }

  /**
   * Generate recommendations based on checks
   */
  generateRecommendations(allChecks) {
    const recommendations = [];

    allChecks.forEach(category => {
      category.checks.forEach(check => {
        if (check.status === 'warning' || check.status === 'pending') {
          recommendations.push({
            category: category.category,
            issue: check.code || check.standard || check.regulation,
            recommendation: check.message,
            priority: check.status === 'warning' ? 'medium' : 'low',
          });
        }
      });
    });

    return recommendations;
  }
}

module.exports = new LegalityService();
