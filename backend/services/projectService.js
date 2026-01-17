const aiService = require('./aiService');

class ProjectService {
  /**
   * Generate comprehensive project information including BOM, budget, blueprints, etc.
   */
  async generateProjectInfo(specifications) {
    try {
      // Generate BOM (Bill of Materials)
      const bom = this.generateBOM(specifications);
      
      // Generate budget estimate
      const budget = this.generateBudget(specifications, bom);
      
      // Generate regulations & compliance info
      const regulations = this.generateRegulations(specifications);
      
      // Generate DIY blueprint steps
      const blueprint = this.generateBlueprint(specifications);
      
      // Estimate duration
      const duration = this.estimateDuration(specifications);
      
      return {
        budget,
        bom,
        regulations,
        blueprint,
        duration,
        disclaimer: "⚠️ AI can make mistakes. Please consult with professionals before proceeding with construction.",
        tentative: true,
      };
    } catch (error) {
      console.error('Error generating project info:', error);
      throw error;
    }
  }

  /**
   * Generate Bill of Materials with real-world sources
   */
  generateBOM(specifications) {
    const { objectType, materials, dimensions } = specifications;
    
    const items = [];
    
    // Add materials based on object type
    if (objectType === 'building') {
      items.push(
        { item: 'Concrete', quantity: Math.ceil(dimensions.length * dimensions.width / 1000000) + ' cubic meters', source: 'Home Depot / Lowes', estimatedCost: '$150/m³' },
        { item: 'Steel Reinforcement', quantity: Math.ceil(dimensions.height / 3000) + ' tons', source: 'Metal Suppliers', estimatedCost: '$800/ton' },
        { item: 'Glass Panels', quantity: Math.ceil(dimensions.height * dimensions.length / 5000000) + ' panels', source: 'Commercial Glass Suppliers', estimatedCost: '$300/panel' },
        { item: 'Insulation', quantity: Math.ceil((dimensions.length * dimensions.height + dimensions.width * dimensions.height) * 2 / 10000) + ' rolls', source: 'Home Depot', estimatedCost: '$50/roll' }
      );
    } else if (objectType === 'car') {
      items.push(
        { item: 'Aluminum Body Panels', quantity: '15-20 panels', source: 'Automotive Suppliers', estimatedCost: '$500-800/panel' },
        { item: 'Glass (windows/windshield)', quantity: '6-8 pieces', source: 'Auto Glass Suppliers', estimatedCost: '$200-500/piece' },
        { item: 'Engine/Motor Components', quantity: '1 unit', source: 'Automotive Parts', estimatedCost: '$5,000-15,000' },
        { item: 'Tires & Wheels', quantity: '4 sets', source: 'Tire Retailers', estimatedCost: '$200-600/tire' }
      );
    } else if (objectType === 'furniture') {
      items.push(
        { item: 'Wood/Metal Frame', quantity: '1 unit', source: 'Home Depot / Lumber Yards', estimatedCost: '$50-200' },
        { item: 'Foam/Cushioning', quantity: '2-3 pieces', source: 'Fabric Stores', estimatedCost: '$30-80/piece' },
        { item: 'Fabric/Upholstery', quantity: '2-3 yards', source: 'Fabric Stores', estimatedCost: '$20-60/yard' },
        { item: 'Hardware (screws, bolts)', quantity: '1 set', source: 'Hardware Stores', estimatedCost: '$10-30' }
      );
    } else {
      items.push(
        { item: 'Primary Material', quantity: 'As needed', source: 'Various Suppliers', estimatedCost: 'TBD' },
        { item: 'Secondary Material', quantity: 'As needed', source: 'Various Suppliers', estimatedCost: 'TBD' },
        { item: 'Fasteners & Hardware', quantity: '1 set', source: 'Hardware Stores', estimatedCost: '$20-50' }
      );
    }
    
    return items;
  }

  /**
   * Generate budget estimate
   */
  generateBudget(specifications, bom) {
    const { objectType, dimensions } = specifications;
    
    let materialsCost = 0;
    let laborCost = 0;
    let equipmentCost = 0;
    let permitsCost = 0;
    
    if (objectType === 'building') {
      const volume = (dimensions.length * dimensions.width * dimensions.height) / 1000000000; // cubic meters
      materialsCost = volume * 300000; // $300k per cubic meter
      laborCost = materialsCost * 0.6;
      equipmentCost = materialsCost * 0.15;
      permitsCost = materialsCost * 0.05;
    } else if (objectType === 'car') {
      materialsCost = 15000;
      laborCost = 8000;
      equipmentCost = 5000;
      permitsCost = 500;
    } else if (objectType === 'furniture') {
      materialsCost = 300;
      laborCost = 150;
      equipmentCost = 50;
      permitsCost = 0;
    } else {
      materialsCost = 500;
      laborCost = 300;
      equipmentCost = 100;
      permitsCost = 50;
    }
    
    const totalCost = materialsCost + laborCost + equipmentCost + permitsCost;
    const contingency = totalCost * 0.15;
    
    return {
      currency: 'USD',
      breakdown: {
        materials: Math.round(materialsCost),
        labor: Math.round(laborCost),
        equipment: Math.round(equipmentCost),
        permits: Math.round(permitsCost),
        contingency: Math.round(contingency),
      },
      total: Math.round(totalCost + contingency),
      editable: true,
    };
  }

  /**
   * Generate regulations & compliance information
   */
  generateRegulations(specifications) {
    const { objectType } = specifications;
    
    const regulations = [];
    
    if (objectType === 'building') {
      regulations.push(
        {
          category: 'Building Codes',
          items: [
            'International Building Code (IBC) compliance required',
            'Local zoning regulations must be verified',
            'Fire safety standards (NFPA 101)',
            'ADA accessibility requirements',
          ],
        },
        {
          category: 'Structural Requirements',
          items: [
            'Structural engineer certification needed',
            'Foundation must meet local soil conditions',
            'Wind and seismic load calculations required',
          ],
        },
        {
          category: 'Permits Required',
          items: [
            'Building permit',
            'Electrical permit',
            'Plumbing permit',
            'Mechanical permit (HVAC)',
          ],
        }
      );
    } else if (objectType === 'car') {
      regulations.push(
        {
          category: 'Safety Standards',
          items: [
            'FMVSS (Federal Motor Vehicle Safety Standards)',
            'Crash test requirements',
            'Emissions standards (EPA)',
            'DOT certification',
          ],
        },
        {
          category: 'Manufacturing',
          items: [
            'ISO 9001 quality management',
            'Automotive industry standards (IATF 16949)',
          ],
        }
      );
    } else if (objectType === 'furniture') {
      regulations.push(
        {
          category: 'Safety Standards',
          items: [
            'ANSI/BIFMA standards for office furniture',
            'Consumer Product Safety Commission (CPSC) guidelines',
            'Flammability standards (CAL TB 117)',
          ],
        }
      );
    } else {
      regulations.push(
        {
          category: 'General Compliance',
          items: [
            'Product safety standards',
            'Material safety data sheets (MSDS)',
            'Local building/manufacturing codes',
          ],
        }
      );
    }
    
    return regulations;
  }

  /**
   * Generate step-by-step DIY blueprint
   */
  generateBlueprint(specifications) {
    const { objectType } = specifications;
    
    let steps = [];
    
    if (objectType === 'building') {
      steps = [
        { step: 1, title: 'Site Preparation', description: 'Clear and level the construction site. Obtain necessary permits.', duration: '1-2 weeks' },
        { step: 2, title: 'Foundation', description: 'Excavate and pour concrete foundation. Install footings and rebar.', duration: '2-3 weeks' },
        { step: 3, title: 'Structural Frame', description: 'Erect steel or concrete structural frame. Install floor systems.', duration: '4-6 weeks' },
        { step: 4, title: 'Exterior Walls', description: 'Install exterior walls, windows, and doors. Apply weatherproofing.', duration: '3-4 weeks' },
        { step: 5, title: 'Roofing', description: 'Install roof structure and covering. Add insulation and drainage.', duration: '2-3 weeks' },
        { step: 6, title: 'MEP Systems', description: 'Install mechanical, electrical, and plumbing systems.', duration: '4-6 weeks' },
        { step: 7, title: 'Interior Finishes', description: 'Install drywall, flooring, and interior finishes. Paint and trim.', duration: '6-8 weeks' },
        { step: 8, title: 'Final Inspection', description: 'Complete final walkthrough and obtain certificate of occupancy.', duration: '1-2 weeks' },
      ];
    } else if (objectType === 'car') {
      steps = [
        { step: 1, title: 'Design & CAD Modeling', description: 'Create detailed 3D models and engineering drawings.', duration: '2-4 weeks' },
        { step: 2, title: 'Chassis Fabrication', description: 'Build or modify the vehicle chassis/frame.', duration: '3-4 weeks' },
        { step: 3, title: 'Body Work', description: 'Fabricate and install body panels. Weld and bond components.', duration: '4-6 weeks' },
        { step: 4, title: 'Powertrain Installation', description: 'Install engine/motor, transmission, and drivetrain.', duration: '2-3 weeks' },
        { step: 5, title: 'Electrical & Electronics', description: 'Wire all electrical systems, install battery and electronics.', duration: '2-3 weeks' },
        { step: 6, title: 'Interior & Upholstery', description: 'Install seats, dashboard, and interior trim.', duration: '2-3 weeks' },
        { step: 7, title: 'Finishing & Paint', description: 'Sand, prime, and paint the vehicle. Apply protective coatings.', duration: '1-2 weeks' },
        { step: 8, title: 'Testing & Certification', description: 'Perform safety tests and obtain necessary certifications.', duration: '2-4 weeks' },
      ];
    } else if (objectType === 'furniture') {
      steps = [
        { step: 1, title: 'Material Selection', description: 'Purchase materials based on BOM. Verify quality and dimensions.', duration: '1-2 days' },
        { step: 2, title: 'Cutting & Preparation', description: 'Cut materials to size. Sand and prepare surfaces.', duration: '1-2 days' },
        { step: 3, title: 'Frame Assembly', description: 'Assemble the main frame structure. Use appropriate fasteners.', duration: '1 day' },
        { step: 4, title: 'Upholstery/Finishing', description: 'Add cushioning and upholstery. Apply stain or paint.', duration: '1-2 days' },
        { step: 5, title: 'Hardware Installation', description: 'Install hinges, handles, or other hardware.', duration: '0.5 days' },
        { step: 6, title: 'Quality Check', description: 'Inspect for defects. Test functionality and stability.', duration: '0.5 days' },
      ];
    } else {
      steps = [
        { step: 1, title: 'Planning', description: 'Review design specifications and gather materials.', duration: '1-2 days' },
        { step: 2, title: 'Preparation', description: 'Prepare workspace and tools. Cut materials to size.', duration: '1 day' },
        { step: 3, title: 'Assembly', description: 'Assemble components according to design.', duration: '2-3 days' },
        { step: 4, title: 'Finishing', description: 'Apply finishes and perform quality checks.', duration: '1 day' },
        { step: 5, title: 'Testing', description: 'Test functionality and make adjustments as needed.', duration: '0.5 days' },
      ];
    }
    
    return steps;
  }

  /**
   * Estimate duration to complete
   */
  estimateDuration(specifications) {
    const { objectType } = specifications;
    
    let duration = '';
    let complexity = 'medium';
    
    if (objectType === 'building') {
      duration = '6-12 months';
      complexity = 'high';
    } else if (objectType === 'car') {
      duration = '4-8 months';
      complexity = 'high';
    } else if (objectType === 'furniture') {
      duration = '1-2 weeks';
      complexity = 'low';
    } else {
      duration = '2-4 weeks';
      complexity = 'medium';
    }
    
    return {
      estimated: duration,
      complexity,
      note: 'Duration varies based on team size, experience, and resources available.',
    };
  }
}

module.exports = new ProjectService();
