/**
 * Detailed Engineering Prompt Templates
 *
 * Production-grade prompts with complex mathematics, matrix algebra,
 * and industry-standard engineering procedures.
 *
 * Covers ALL mechanical engineering domains:
 * - Structural mechanics
 * - Fluid dynamics
 * - Thermal systems
 * - Mechatronics
 * - Manufacturing processes
 * - Control systems
 * - Materials science
 */

// ================================================================
// PHASE 1: CONCEPT & STRATEGY PROMPTS
// ================================================================

/**
 * Product Requirements Document (PRD) Generation
 */
exports.buildPRDPrompt = (userPrompt, complexityTier) => {
    const tierContext = getTierContext(complexityTier);

    return `You are a SENIOR PRODUCT MANAGER at a top-tier engineering company (Boeing, Tesla, SpaceX, Dyson).

User Request: "${userPrompt}"

Project Complexity: ${complexityTier.toUpperCase()} (${tierContext.description})

Your task: Generate a PRODUCTION-GRADE Product Requirements Document (PRD).

REQUIREMENTS ENGINEERING METHODOLOGY:

1. **Functional Requirements (FRs)**: What the product MUST do
   - Use MoSCoW prioritization: Must-Have, Should-Have, Could-Have, Won't-Have
   - Quantify ALL requirements (not "fast" but "≥120 km/h")
   - Trace requirements to use cases

2. **Performance Requirements**: Measurable targets
   - Speed, acceleration, throughput, efficiency
   - Use engineering units: m/s, N, W, Pa, K
   - Include tolerance ranges (±5%, ±0.1mm, etc.)

3. **Constraints**: Hard limits that CANNOT be violated
   - Physical: Size (L×W×H), mass, volume
   - Environmental: Temperature range, humidity, shock resistance
   - Regulatory: Safety standards (ISO, ASME, OSHA), certifications
   - Cost: Target manufacturing cost per unit

4. **Quality Attributes (NFRs)**: Non-functional requirements
   - Reliability: MTBF (Mean Time Between Failures) in hours
   - Maintainability: MTTR (Mean Time To Repair)
   - Safety: Failure modes (FMEA), safety factors
   - Manufacturability: DFM score, production volume feasibility

DELIVERABLE FORMAT (JSON):

{
  "prd": {
    "product_name": "descriptive name",
    "classification": "${complexityTier}",
    "functional_requirements": [
      {"id": "FR-001", "priority": "must-have", "description": "...", "acceptance_criteria": "..."}
    ],
    "performance_targets": {
      "speed": {"value": 120, "unit": "km/h", "tolerance": "±5%"},
      "load_capacity": {"value": 500, "unit": "kg", "tolerance": "±10kg"},
      "efficiency": {"value": 0.85, "unit": "dimensionless", "target": "≥0.85"}
    },
    "constraints": {
      "physical": {"max_length": 1200, "max_mass": 150, "units": "mm, kg"},
      "environmental": {"operating_temp_range": "-20°C to +60°C"},
      "regulatory": ["ISO 9001", "ASME Y14.5"],
      "cost_target_usd": 5000
    },
    "quality_attributes": {
      "reliability_mtbf_hours": 10000,
      "safety_factor_min": 2.0,
      "production_volume_per_year": 1000
    },
    "use_cases": ["use case 1", "use case 2"],
    "stakeholders": ["engineering", "manufacturing", "quality", "procurement"]
  }
}

Generate the PRD now. Be specific and quantitative.`;
};

/**
 * Systems Architecture Generation
 */
exports.buildSystemsArchitecturePrompt = (userPrompt, prd, complexityTier) => {
    return `You are a SYSTEMS ARCHITECT at Boeing, Lockheed Martin, or SpaceX.

User Request: "${userPrompt}"

Product Requirements (PRD): ${JSON.stringify(prd, null, 2)}

Your task: Decompose the system into subsystems using V-Model methodology.

SYSTEMS ENGINEERING PROCESS:

1. **Functional Decomposition**: Break top-level function into subfunctions
   - Use IDEF0 methodology (Inputs, Controls, Outputs, Mechanisms)
   - Identify interfaces between subsystems (mechanical, electrical, data, thermal)

2. **System Architecture**: Define the physical/logical structure
   - Subsystem hierarchy (tree structure)
   - Interface Control Documents (ICDs) for each interface
   - Data flow diagrams

3. **Requirements Allocation**: Assign PRD requirements to subsystems
   - Traceability matrix: PRD-FR-001 → Subsystem A, B
   - Derived requirements: Child requirements from parent

4. **Trade Studies**: Compare architecture alternatives
   - Scoring criteria: Cost, performance, risk, complexity
   - Decision matrix with weighted scores

MATHEMATICAL FOUNDATION:

For load-bearing structures, apply:
- Stress tensor: σ = [σ_xx, σ_yy, σ_zz, τ_xy, τ_yz, τ_zx]^T
- Strain-displacement: ε = (∇u + ∇u^T) / 2
- Constitutive relation: σ = C : ε (where C is stiffness tensor)

For fluid systems:
- Continuity: ∂ρ/∂t + ∇·(ρv) = 0
- Momentum (Navier-Stokes): ρ(∂v/∂t + v·∇v) = -∇p + μ∇²v + f
- Energy: ρc_p(∂T/∂t + v·∇T) = k∇²T + Φ

For thermal systems:
- Heat equation: ρc_p ∂T/∂t = ∇·(k∇T) + Q̇
- Thermal resistance network: R_total = Σ R_i = Σ (L_i / k_i A_i)

DELIVERABLE FORMAT (JSON):

{
  "systems_architecture": {
    "system_name": "...",
    "subsystems": [
      {
        "name": "Primary Structure",
        "function": "Load-bearing frame",
        "requirements_allocated": ["FR-001", "FR-003"],
        "interfaces": [
          {"connects_to": "Propulsion", "type": "mechanical", "load_transfer": "500N axial"}
        ],
        "key_parameters": {
          "material": "6061-T6 Aluminum",
          "max_stress_mpa": 200,
          "safety_factor": 2.5
        }
      }
    ],
    "interface_control_documents": [
      {
        "icd_id": "ICD-001",
        "subsystem_a": "Structure",
        "subsystem_b": "Propulsion",
        "mechanical_interface": "4× M8 bolts, 25Nm torque",
        "data_interface": "none",
        "thermal_interface": "conduction, <100W heat flux"
      }
    ],
    "verification_plan": {
      "analysis": ["FEA", "CFD", "Thermal"],
      "test": ["Static load", "Vibration", "Thermal cycling"]
    }
  }
}

Generate the systems architecture now.`;
};

/**
 * Industrial Design Concept
 */
exports.buildIndustrialDesignPrompt = (userPrompt, systemsArch, complexityTier) => {
    return `You are an INDUSTRIAL DESIGNER at Ferrari, Dyson, or Apple.

User Request: "${userPrompt}"

Systems Architecture: ${JSON.stringify(systemsArch, null, 2)}

Your task: Create the visual and ergonomic design concept.

INDUSTRIAL DESIGN PRINCIPLES:

1. **Form Follows Function**: Aesthetics derived from engineering constraints
   - Airflow paths → surface curvature (Class-A surfaces)
   - Load paths → structural ribbing patterns
   - Heat dissipation → fin geometry, vent placement

2. **Ergonomics & Human Factors**: Design for the user
   - Anthropometric data: 5th percentile female to 95th percentile male
   - Reach envelopes, grip forces, visual angles
   - Accessibility (ADA compliance if applicable)

3. **CMF (Color, Material, Finish)**: Tactile and visual quality
   - Surface finish: Ra values (μm) for touch surfaces
   - Color psychology: Industrial gray (RAL 7035), safety yellow (RAL 1003)
   - Texture: Knurling (DIN 82), bead blasting, anodizing

4. **Design for Manufacturing (DFM)**: Ensure producibility
   - Draft angles for molding (1-3°)
   - Undercut avoidance
   - Parting line placement

DELIVERABLE FORMAT (JSON):

{
  "industrial_design": {
    "design_language": "Modern industrial, robust, high-performance",
    "form_factors": {
      "overall_dimensions": {"L": 1200, "W": 800, "H": 600, "units": "mm"},
      "surface_treatment": "Class-A surfaces on user-facing panels",
      "styling_features": ["Chamfered edges 2mm×45°", "Ventilation grilles", "Logo embossed"]
    },
    "ergonomics": {
      "handle_grip_diameter": {"value": 32, "unit": "mm", "rationale": "Optimal for 50th percentile hand"},
      "control_placement": "Within 500mm reach envelope from operator position",
      "visual_indicators": "LED status lights, 5mm diameter, green/red"
    },
    "cmf": {
      "primary_color": "RAL 7035 (Light Grey)",
      "accent_color": "RAL 5015 (Sky Blue)",
      "surface_finish": "Ra 1.6 μm on exposed surfaces, Ra 6.3 μm on hidden surfaces",
      "material_textures": "Powder-coated steel, anodized aluminum trim"
    },
    "sketches_description": "Isometric view showing overall proportions, side profile highlighting airflow channels"
  }
}

Generate the industrial design concept now.`;
};

// ================================================================
// PHASE 2: DESIGN & VALIDATION PROMPTS
// ================================================================

/**
 * CAD Geometry Generation (Main Design Prompt)
 */
exports.buildCADPrompt = (userPrompt, systemsArch, complexityTier, requirements) => {
    const tierContext = getTierContext(complexityTier);

    return `You are a SENIOR MECHANICAL DESIGN ENGINEER with 20+ years experience at Boeing, Tesla, SpaceX, or Siemens.

ENGINEERING SOFTWARE EXPERTISE:
- CATIA V6 (Part Design, Generative Shape Design, Assembly Design)
- Siemens NX (Parametric modeling, synchronous technology)
- SolidWorks (Weldments, Sheet Metal, Surfacing)
- Creo Parametric (Top-down design, flexible modeling)

User Request: "${userPrompt}"

Systems Architecture: ${JSON.stringify(systemsArch, null, 2)}

Complexity Tier: ${complexityTier.toUpperCase()}
Minimum Vertices Required: ${requirements.minVertices}
Maximum Generation Time: ${requirements.maxGenerationTime}s
Simulation Depth: ${requirements.simulationDepth}

═══════════════════════════════════════════════════════════════════
🚨 MANDATORY GEOMETRY REQUIREMENTS - ABSOLUTE ENFORCEMENT 🚨
═══════════════════════════════════════════════════════════════════

**MINIMUM VERTEX COUNTS BY COMPLEXITY:**
- Bachelor's projects: ${getTierContext('bachelors').minVertices}+ vertices
- Master's projects: ${getTierContext('masters').minVertices}+ vertices
- PhD projects: ${getTierContext('phd').minVertices}+ vertices
- Professional projects: ${getTierContext('professional').minVertices}+ vertices

**YOUR PROJECT REQUIRES: ${requirements.minVertices}+ VERTICES MINIMUM**

**GEOMETRY STRUCTURE RULES:**
1. GEOMETRY FIRST: Place "geometry" field IMMEDIATELY after "name" in JSON
2. NO PLACEHOLDERS: Generate ACTUAL numeric arrays, not "..." or ellipses
3. FULL ARRAYS: Every vertex [x,y,z] and face [i,j,k] must be complete
4. COUNT VERIFICATION: Your vertex count MUST be ≥ ${requirements.minVertices}

═══════════════════════════════════════════════════════════════════
⚙️ ENGINEERING CALCULATION METHODOLOGY ⚙️
═══════════════════════════════════════════════════════════════════

**1. STRUCTURAL ANALYSIS (for load-bearing components)**

Stress Analysis:
- Normal stress: σ = F/A = (Force in N) / (Cross-sectional area in m²)
- Bending stress: σ_bend = M*y/I = (Bending moment * distance from neutral axis) / (Second moment of area)
- von Mises stress: σ_vm = √(σ_x² - σ_x*σ_y + σ_y² + 3τ_xy²)
- Safety Factor: SF = σ_yield / σ_max ≥ 2.0 (static), ≥ 4.0 (fatigue)

Matrix Formulation (FEA):
- Stiffness matrix: [K]{u} = {F}
- Element stiffness: k_e = ∫∫∫ [B]^T [D] [B] dV
- Global assembly: K = Σ k_e (summation over all elements)

**2. FLUID DYNAMICS (for pneumatic, hydraulic, airflow systems)**

Bernoulli's Equation (incompressible flow):
- P₁ + ½ρv₁² + ρgh₁ = P₂ + ½ρv₂² + ρgh₂
- Pressure drop in pipe: ΔP = f * (L/D) * (ρv²/2), where f = Darcy friction factor

Reynolds Number (turbulence prediction):
- Re = ρvD/μ = (inertial forces)/(viscous forces)
- Re < 2300: Laminar flow
- Re > 4000: Turbulent flow

Navier-Stokes (momentum conservation):
- ρ(∂v/∂t + v·∇v) = -∇p + μ∇²v + ρg

**3. THERMAL ANALYSIS (for heat transfer systems)**

Heat Transfer Modes:
- Conduction: Q̇ = -kA(dT/dx) = kA(T₁-T₂)/L
- Convection: Q̇ = hA(T_surface - T_fluid), where h = convection coefficient
- Radiation: Q̇ = εσA(T₁⁴ - T₂⁴), where σ = 5.67×10⁻⁸ W/(m²·K⁴)

Thermal Resistance Network:
- R_total = R_cond + R_conv + R_rad
- For multi-layer: R_total = Σ(L_i / k_i*A_i)

**4. DYNAMICS & VIBRATION (for moving systems)**

Equation of Motion:
- [M]{ẍ} + [C]{ẋ} + [K]{x} = {F(t)}
- Natural frequency: ω_n = √(k/m)
- Damping ratio: ζ = c/(2√(km))

Modal Analysis:
- Eigenvalue problem: ([K] - ω²[M]){φ} = 0
- Mode shapes φ_i, natural frequencies ω_i

**5. MECHANISM KINEMATICS (for linkages, gears, cams)**

Position Analysis (for 4-bar linkage):
- Closure equation: r₁ + r₂ = r₃ + r₄
- Velocity: v = ω × r
- Acceleration: a = α × r + ω × (ω × r)

Gear Ratios:
- Speed ratio: n₁/n₂ = N₂/N₁ = (teeth on driven)/(teeth on driver)
- Torque ratio: T₂/T₁ = N₁/N₂ (inverse of speed ratio)

═══════════════════════════════════════════════════════════════════
📐 DETAILED CAD MODELING INSTRUCTIONS ⚙️
═══════════════════════════════════════════════════════════════════

**STEP 1: ANALYZE THE REQUEST**

Identify the primary engineering domain:
- Structural: Frames, brackets, housings → Use box/I-beam/truss geometry
- Rotational: Shafts, gears, pulleys → Use cylindrical geometry
- Fluid: Pumps, valves, pipes → Use toroidal/helical geometry
- Thermal: Heat sinks, exchangers → Use finned/channel geometry
- Mechatronic: Robots, actuators → Use multi-body assemblies

**STEP 2: CALCULATE KEY DIMENSIONS**

Use engineering formulas to determine sizes:

For load-bearing beams:
- Required section modulus: S = M / σ_allow
- For rectangular beam: S = (b*h²)/6
- Solve for dimensions b, h

For rotating shafts:
- Torsional stress: τ = T*r/J
- Polar moment: J = π*d⁴/32 (solid), J = π(d_o⁴-d_i⁴)/32 (hollow)
- Solve for diameter d

For pressure vessels:
- Hoop stress: σ_hoop = p*r/t
- Longitudinal stress: σ_long = p*r/(2t)
- Solve for wall thickness t

For heat sinks:
- Thermal resistance: R_th = 1/(h*A_total)
- Fin efficiency: η_fin = tanh(mL)/(mL), where m = √(h*P/(k*A_c))
- Solve for fin count, height, spacing

**STEP 3: GENERATE GEOMETRY WITH REQUIRED VERTEX COUNT**

${getGeometryGenerationInstructions(complexityTier, requirements)}

**STEP 4: APPLY ENGINEERING STANDARDS**

Tolerances (ISO 2768-m medium grade):
- 0.5-3mm: ±0.1mm
- 3-6mm: ±0.1mm
- 6-30mm: ±0.2mm
- 30-120mm: ±0.3mm
- 120-400mm: ±0.5mm

Feature Sizes (Manufacturability):
- Minimum wall thickness: 1.0mm (casting), 0.8mm (machining), 1.2mm (FDM 3D print)
- Minimum hole diameter: 0.5mm (drilling), 3.0mm (standard bolt clearance)
- Fillet radius: ≥0.5mm (sharp edges), ≥1.0mm (standard), ≥2mm (casting)

Surface Finish (ISO 1302):
- Ra 1.6μm: Precision machined surfaces, bearing seats
- Ra 3.2μm: Standard machined surfaces
- Ra 6.3μm: Rough machined, fine cast surfaces
- Ra 12.5μm: As-cast, hot-rolled steel

═══════════════════════════════════════════════════════════════════
📋 OUTPUT FORMAT (STRICT JSON STRUCTURE)
═══════════════════════════════════════════════════════════════════

{
  "design": {
    "type": "part",
    "name": "Descriptive Engineering Name (e.g., Load-Bearing Frame Assembly)",

    "geometry": {
      "vertices": [
        [x1, y1, z1], [x2, y2, z2], ..., [x_n, y_n, z_n]
      ],
      "faces": [
        [i1, j1, k1], [i2, j2, k2], ..., [i_m, j_m, k_m]
      ]
    },

    "materials": [
      {
        "component": "Main frame",
        "material": "AISI 4140 Steel, quenched & tempered",
        "properties": "σ_y=655MPa, ρ=7850kg/m³",
        "justification": "High strength for load-bearing"
      }
    ],

    "dimensions": {
      "overall": {"length": "1200 mm", "width": "800 mm", "height": "600 mm"},
      "critical_features": [
        {"name": "Mounting hole spacing", "value": "400 mm", "tolerance": "±0.2 mm"}
      ]
    },

    "manufacturing": {
      "primary_process": "CNC milling from billet",
      "secondary_processes": ["Heat treatment: Q&T to HRC 32", "Surface grinding Ra 1.6μm"],
      "estimated_machining_time": "8 hours",
      "tooling": "4-axis CNC mill, carbide endmills"
    },

    "standards": ["ISO 2768-m", "ASME Y14.5", "ISO 1302"]
  },

  "analysis": {
    "structural": {
      "max_stress_mpa": 220,
      "yield_strength_mpa": 655,
      "safety_factor": 2.98,
      "calculation": "SF = σ_yield / σ_max = 655 / 220 = 2.98 > 2.0 ✓"
    },
    "thermal": {
      "max_operating_temp_c": 85,
      "heat_dissipation_w": 150,
      "cooling_method": "Natural convection"
    }
  },

  "manufacturing": {
    "process_sequence": [
      "1. Material procurement: 4140 steel billet",
      "2. Rough milling: Envelope dimensions +2mm stock",
      "3. Heat treatment: Quench (oil) + Temper (400°C, 2hr)",
      "4. Finish milling: Final dimensions to tolerance",
      "5. Surface grinding: Critical mating surfaces Ra 1.6",
      "6. Deburr and clean",
      "7. Inspection: CMM verification of GD&T"
    ],
    "tolerances": {
      "general": "ISO 2768-m (±0.2mm for 6-30mm features)",
      "critical_bores": "H7 tolerance (±0.025mm for φ20mm hole)"
    },
    "surface_finish": "Ra 1.6μm on bearing seats, Ra 3.2μm general"
  }
}

═══════════════════════════════════════════════════════════════════
🔥 CRITICAL REMINDERS - YOUR RESPONSE WILL BE REJECTED IF YOU IGNORE THESE 🔥
═══════════════════════════════════════════════════════════════════

1. VERTEX COUNT: You MUST generate ≥ ${requirements.minVertices} vertices
2. COMPLETE ARRAYS: No "..." placeholders - every vertex must be a real [x,y,z] triplet
3. GEOMETRY FIRST: Place geometry immediately after "name" field
4. VALID INDICES: All face indices must be valid (0 ≤ index < vertex count)
5. ENGINEERING RIGOR: Use actual calculations, not placeholder values
6. MANUFACTURING REALITY: Design must be producible with standard processes

NOW GENERATE THE COMPLETE CAD MODEL WITH DETAILED GEOMETRY.
`;
};

// ================================================================
// PHASE 3: DETAILED ENGINEERING PROMPTS
// ================================================================

/**
 * GD&T (Geometric Dimensioning & Tolerancing) Generation
 */
exports.buildGDTPrompt = (design, complexityTier) => {
    return `You are a DIMENSIONAL ENGINEER certified in ASME Y14.5-2018 and ISO 1101.

Design to annotate: ${JSON.stringify(design, null, 2)}

Your task: Apply GD&T (Geometric Dimensioning & Tolerancing) to ensure functional assembly.

GD&T SYMBOL REFERENCE:

Form Controls (no datum reference):
- ⏤ Straightness: Controls line elements
- ⏥ Flatness: Controls surface elements
- ○ Circularity (Roundness): Controls circular elements
- ⌭ Cylindricity: Controls cylindrical surfaces

Orientation Controls (require datum):
- ⊥ Perpendicularity: 90° to datum
- ∠ Angularity: Specified angle to datum
- ∥ Parallelism: 0° to datum

Location Controls:
- ⌖ Position: Location of feature center
- ⊕ Concentricity: Coaxiality of circular features
- ⊙ Symmetry: Balance about datum plane

Profile Controls:
- ⌓ Profile of a Surface
- ⌒ Profile of a Line

Runout Controls:
- ↗ Circular Runout
- ↗↗ Total Runout

DATUM SELECTION STRATEGY:

Primary Datum (A): Largest, most stable surface
- Usually the mounting face or base
- Constrains 3 DOF (translation in Z, rotation in X, Y)

Secondary Datum (B): Feature perpendicular to A
- Constrains 2 DOF (translation in X or Y, rotation in Z)

Tertiary Datum (C): Feature perpendicular to both A and B
- Constrains 1 DOF (translation in remaining axis)

TOLERANCE STACK-UP ANALYSIS:

Worst-Case Method:
- Total tolerance = Σ |tol_i| (sum of absolute tolerances)
- Conservative, ensures 100% interchangeability

RSS (Root Sum Square) Method:
- Total tolerance = √(Σ tol_i²)
- Statistical, assumes normal distribution
- Allows tighter component tolerances

DELIVERABLE FORMAT (JSON):

{
  "gdt_annotations": {
    "datums": [
      {"label": "A", "feature": "Bottom mounting face", "type": "plane"},
      {"label": "B", "feature": "Rear vertical face", "type": "plane"},
      {"label": "C", "feature": "Left side face", "type": "plane"}
    ],
    "geometric_controls": [
      {
        "feature": "Mounting hole φ10mm",
        "control": "Position",
        "symbol": "⌖",
        "tolerance": "φ0.2",
        "modifier": "M (MMC)",
        "datums": ["A", "B", "C"],
        "interpretation": "Hole axis must lie within φ0.2mm tolerance zone at MMC, relative to datums A, B, C"
      },
      {
        "feature": "Top surface",
        "control": "Flatness",
        "symbol": "⏥",
        "tolerance": "0.1",
        "datums": [],
        "interpretation": "Surface must lie between two parallel planes 0.1mm apart"
      },
      {
        "feature": "Shaft diameter φ20h6",
        "control": "Circular Runout",
        "symbol": "↗",
        "tolerance": "0.03",
        "datums": ["A"],
        "interpretation": "Any circular element perpendicular to datum axis A must not vary more than 0.03mm FIM"
      }
    ],
    "dimensional_tolerances": [
      {"dimension": "Overall length", "nominal": "1200 mm", "tolerance": "+0.0/-0.5 mm"},
      {"dimension": "Hole diameter", "nominal": "10 mm", "tolerance": "H7 (+0.015/0)"}
    ],
    "tolerance_stack_analysis": {
      "critical_dimension": "Gap between mating parts",
      "worst_case_stack": "0.8 mm max gap",
      "rss_stack": "0.4 mm typical gap",
      "recommendation": "Use RSS method, cost reduction of 30%"
    }
  }
}

Generate the complete GD&T specification now.`;
};

/**
 * DFM/DFA (Design for Manufacturing/Assembly) Analysis
 */
exports.buildDFMPrompt = (design, gdt, complexityTier) => {
    return `You are a MANUFACTURING ENGINEER at a world-class production facility (Toyota, Boeing, SpaceX).

Design: ${JSON.stringify(design, null, 2)}
GD&T: ${JSON.stringify(gdt, null, 2)}

Your task: Perform DFM/DFA analysis and recommend design changes for producibility.

DFM ANALYSIS CRITERIA:

1. **Material Selection Validation**
   - Is the material readily available? (Standard vs. exotic)
   - Is there a supplier base? (Single source risk)
   - Can it be worked with standard tooling?

2. **Process Capability Analysis**
   - Can we hold the specified tolerances?
   - Process capability index: Cp = (USL - LSL) / (6σ)
   - Cp < 1.0: Process incapable (reject design or loosen tolerances)
   - Cp > 1.33: Process capable
   - Cp > 1.67: Process highly capable

3. **Tool Access & Clearance**
   - Can the cutting tool reach all features?
   - Are there trapped pockets that require special end mills?
   - Minimum internal radius = tool radius (typically 3mm for standard endmill)

4. **Setup & Fixturing**
   - How many setups required? (Each setup adds cost & error)
   - Are there adequate clamping surfaces?
   - Is there reference for workpiece locating (3-2-1 principle)?

DFA ANALYSIS (Boothroyd-Dewhurst Method):

Assembly Efficiency Metric:
- E_asm = (T_min / T_actual) × 100%
- T_min = 3 seconds × N_parts (theoretical minimum)
- T_actual = measured assembly time

Part Count Reduction Questions (ask for each part):
1. Does it move relative to other parts? → If no, consider combining
2. Must it be different material? → If no, consider combining
3. Must it be separate for assembly/disassembly? → If no, consider combining

Target: E_asm > 60% for good design

DELIVERABLE FORMAT (JSON):

{
  "dfm_analysis": {
    "manufacturability_score": 75,
    "issues": [
      {
        "severity": "high",
        "feature": "Internal pocket with 90° corners",
        "problem": "Cannot machine with standard endmill (tool can't create sharp internal corners)",
        "recommendation": "Add R3mm fillet to internal corners",
        "cost_impact": "Reduces machining time by 30 minutes, saves $45/unit"
      },
      {
        "severity": "medium",
        "feature": "Tolerance of ±0.01mm on 500mm dimension",
        "problem": "Exceeds machine capability (Cp=0.8)",
        "recommendation": "Relax to ±0.05mm or specify local tolerance only where needed",
        "cost_impact": "Avoids 100% inspection requirement, saves $20/unit"
      }
    ],
    "process_capability": {
      "critical_dimension_analysis": [
        {
          "feature": "Bore diameter φ20H7",
          "process": "Reaming after drilling",
          "tolerance": "±0.021mm",
          "process_sigma": "0.005mm",
          "cp_index": 1.4,
          "verdict": "Capable"
        }
      ]
    },
    "tool_access_check": [
      {"feature": "Bottom hole array", "tool": "Drill φ8mm, length 100mm", "access": "OK"},
      {"feature": "Side slot", "tool": "Endmill φ6mm", "access": "BLOCKED - recommend redesign or 5-axis machining"}
    ]
  },

  "dfa_analysis": {
    "current_part_count": 12,
    "recommended_part_count": 8,
    "assembly_time_current_sec": 480,
    "assembly_time_optimized_sec": 300,
    "assembly_efficiency_current": "7.5%",
    "assembly_efficiency_optimized": "8.0%",
    "consolidation_opportunities": [
      {
        "current": "Frame (3 parts: left, right, top - bolted together)",
        "recommended": "Single welded frame assembly",
        "rationale": "No relative motion, same material, eliminates 6 bolts",
        "savings": "180 seconds assembly time, $12 in fasteners"
      }
    ]
  },

  "recommended_changes": [
    {"change": "Add R3mm fillet to all internal corners", "justification": "Tool access"},
    {"change": "Combine 3 frame parts into single weldment", "justification": "Reduce part count"},
    {"change": "Relax general tolerance from ±0.1mm to ±0.2mm", "justification": "Match process capability"}
  ]
}

Generate the complete DFM/DFA analysis now.`;
};

/**
 * Mechatronics & Control Systems Design
 */
exports.buildMechatronicsPrompt = (design, complexityTier) => {
    return `You are a MECHATRONICS ENGINEER specializing in electromechanical system integration.

Design: ${JSON.stringify(design, null, 2)}

Your task: Design the control system, sensors, actuators, and embedded control logic.

CONTROL SYSTEMS THEORY:

**1. System Modeling**

Transfer Function (Laplace domain):
- G(s) = Y(s)/U(s) = output/input
- For mass-spring-damper: G(s) = 1/(ms² + cs + k)

State-Space Representation:
- ẋ = Ax + Bu
- y = Cx + Du
- Where x = state vector, u = input, y = output
- A = system matrix, B = input matrix, C = output matrix, D = feedthrough

**2. PID Control**

PID Equation:
- u(t) = K_p*e(t) + K_i*∫e(τ)dτ + K_d*de(t)/dt

Transfer function:
- C(s) = K_p + K_i/s + K_d*s

Tuning Methods:
- Ziegler-Nichols: Find ultimate gain K_u, period T_u
  - K_p = 0.6*K_u
  - K_i = 1.2*K_u/T_u
  - K_d = 0.075*K_u*T_u

**3. Actuator Selection**

Torque Requirement (for rotary actuator):
- τ = I*α + τ_friction + τ_load
- Where I = moment of inertia, α = angular acceleration

Power Requirement:
- P = τ*ω (mechanical power in Watts)
- Select motor with 1.5× safety margin

Servo Motor Sizing:
- RMS torque: τ_rms = √((Σ τ_i²*t_i) / Σ t_i)
- Must be < continuous rated torque

**4. Sensor Selection**

Position Sensors:
- Encoder resolution: R = 360° / (CPR × 4) [for quadrature]
- Absolute vs incremental tradeoff

Force/Torque Sensors:
- Sensitivity: S = ΔV / ΔF (mV/N)
- Resolution limited by ADC: F_min = V_noise / S

Accelerometer Selection:
- Bandwidth requirement: f_bw > 5 × f_highest_frequency
- Full-scale range: ±2g, ±4g, ±8g, ±16g

DELIVERABLE FORMAT (JSON):

{
  "mechatronics_design": {
    "control_architecture": {
      "type": "Closed-loop PID position control",
      "control_frequency_hz": 1000,
      "communication_protocol": "CANbus 500 kbps"
    },

    "actuators": [
      {
        "name": "Linear actuator X-axis",
        "type": "Ball screw driven by servo motor",
        "motor_model": "Kollmorgen AKM23E",
        "specs": {
          "continuous_torque_nm": 0.48,
          "peak_torque_nm": 1.44,
          "rated_speed_rpm": 6000,
          "inertia_kgm2": "1.2e-5"
        },
        "sizing_calculation": {
          "load_inertia_kgm2": "8.0e-6",
          "inertia_ratio": 1.5,
          "verdict": "Acceptable (ratio < 10:1)"
        },
        "driver": "Kollmorgen AKD servo drive"
      }
    ],

    "sensors": [
      {
        "name": "Position feedback",
        "type": "Incremental rotary encoder",
        "model": "Heidenhain ROD 426",
        "resolution_ppr": 5000,
        "angular_resolution_arcsec": 2.59,
        "linear_resolution_um": 1.0,
        "interface": "EnDat 2.2"
      },
      {
        "name": "Force sensor",
        "type": "Load cell",
        "model": "Futek LCM300",
        "capacity_n": 500,
        "sensitivity_mv_v": 2.0,
        "nonlinearity_percent": 0.03,
        "output_signal": "0-5V via signal conditioner"
      }
    ],

    "control_logic": {
      "controller": "PLC: Siemens S7-1200",
      "pid_parameters": {
        "kp": 1.5,
        "ki": 0.02,
        "kd": 0.08,
        "tuning_method": "Ziegler-Nichols",
        "anti_windup": "Conditional integration"
      },
      "state_machine": [
        "INIT → HOMING → READY → RUNNING → STOPPING → FAULT"
      ],
      "safety_interlocks": [
        "E-stop: Immediate motor disable",
        "Soft limit: Position > 500mm → Decelerate to stop",
        "Force limit: Load > 450N → Fault state"
      ]
    },

    "power_electronics": {
      "power_supply": "24VDC, 10A regulated",
      "motor_drivers": ["Servo drive: 48VDC bus, 5A continuous"],
      "signal_conditioning": "5V for sensors, isolated from motor power"
    },

    "embedded_code_structure": "State machine in Structured Text (IEC 61131-3), 1ms cycle time"
  }
}

Generate the complete mechatronics system design now.`;
};

// ================================================================
// PHASE 4: MANUFACTURING PROMPTS
// ================================================================

/**
 * Tooling & Mold Design
 */
exports.buildToolingPrompt = (design, complexityTier) => {
    return `You are a TOOLING ENGINEER designing production tooling for high-volume manufacturing.

Design: ${JSON.stringify(design, null, 2)}

Your task: Design the tooling (molds, dies, jigs, fixtures) required for production.

TOOLING DESIGN PRINCIPLES:

**1. Injection Molding (for plastic parts)**

Mold Design Elements:
- Parting line: Must allow part ejection (no undercuts perpendicular to pull direction)
- Draft angles: 1-3° on all vertical walls for easy ejection
- Gate location: Balance fill pattern, minimize weld lines, hide gate vestige
- Ejector pin placement: Adequate support to prevent part distortion
- Cooling channels: Conformal cooling for uniform temperature (cycle time reduction)

Moldflow Analysis Parameters:
- Injection pressure: P_inj = ΔP_runner + ΔP_gate + ΔP_cavity
- Fill time: t_fill = V_part / Q_flow (part volume / flow rate)
- Cooling time: t_cool = s²/(π²α) × ln(4/π × (T_eject - T_mold)/(T_melt - T_mold))
  - Where s = wall thickness, α = thermal diffusivity

**2. Stamping Dies (for sheet metal parts)**

Die Clearance:
- c = (material thickness) × (clearance factor)
- For steel: c = 0.075t (7.5% clearance)
- For aluminum: c = 0.06t (6% clearance)

Bend Allowance:
- BA = (π/180) × (R + K×t) × θ
- Where R = bend radius, t = thickness, θ = bend angle, K = k-factor (0.33 for soft, 0.5 for hard)

Springback Compensation:
- θ_final = θ_tool + Δθ
- Δθ ≈ (σ_y / E) × (1/R) × (180/π)

**3. CNC Fixtures (for machining operations)**

3-2-1 Locating Principle:
- Primary surface (3 points): Constrains Z translation, X and Y rotation
- Secondary surface (2 points): Constrains X translation, Z rotation
- Tertiary surface (1 point): Constrains Y translation
- Total: 6 DOF constrained

Clamping Force Calculation:
- F_clamp ≥ (F_cutting / μ) × SF
- Where μ = coefficient of friction (≈0.3 for steel-on-steel), SF = safety factor (≈3)

DELIVERABLE FORMAT (JSON):

{
  "tooling_design": {
    "tooling_type": "Injection mold (or stamping die, fixture, etc.)",
    "mold_specifications": {
      "mold_base": "DME standard base, 400×400mm",
      "cavity_count": 2,
      "parting_line": "Midplane of part, z=50mm",
      "gate_type": "Side gate, 2mm diameter, location: x=-30mm",
      "ejection_system": "12× φ4mm ejector pins + 1× stripper plate",
      "cooling_system": {
        "type": "Conformal cooling channels",
        "channel_diameter": "8mm",
        "coolant": "Water at 15°C",
        "flow_rate_lpm": 10,
        "cooling_time_sec": 18
      },
      "draft_angles": "2° on all vertical walls"
    },

    "material_selection": {
      "cavity_core_material": "P20 tool steel, pre-hardened to HRC 30",
      "slides_material": "H13 tool steel, hardened to HRC 48-52",
      "inserts_material": "Beryllium copper for conformal cooling regions"
    },

    "moldflow_analysis": {
      "fill_time_sec": 1.2,
      "pack_pressure_bar": 850,
      "clamp_force_tons": 120,
      "weld_line_locations": ["Top center where two flow fronts meet"],
      "shrinkage_percent": 0.5,
      "warpage_mm": 0.08
    },

    "manufacturing_cost": {
      "mold_fabrication_cost_usd": 25000,
      "lead_time_weeks": 8,
      "cycle_time_sec": 22,
      "annual_production_volume": 50000,
      "part_cost_breakdown": {
        "material": 0.45,
        "molding": 0.32,
        "tooling_amortized": 0.50,
        "total_per_part": 1.27
      }
    }
  }
}

Generate the complete tooling design now.`;
};

/**
 * Bill of Materials (BOM) Generation
 */
exports.buildBOMPrompt = (design, complexityTier) => {
    return `You are a MATERIALS MANAGER creating a production BOM for procurement.

Design: ${JSON.stringify(design, null, 2)}

Your task: Generate a complete Bill of Materials with sourcing information.

BOM STRUCTURE TYPES:

**1. Engineering BOM (EBOM)**: Design perspective
- Reflects how the product is designed
- Organized by functional subsystems

**2. Manufacturing BOM (MBOM)**: Production perspective
- Reflects how the product is built
- Organized by assembly sequence
- Includes consumables (fasteners, adhesives, packaging)

**3. Service BOM (SBOM)**: Maintenance perspective
- Reflects field-replaceable units

MAKE vs. BUY DECISION MATRIX:

For each component, evaluate:
- Core competency: Is this a differentiating technology? → Make
- Volume: High volume (>10,000/yr) → Make; Low volume → Buy
- Capability: Do we have the equipment? → If no, Buy
- Risk: Strategic supply risk? → Make; Commodity? → Buy

DELIVERABLE FORMAT (JSON):

{
  "bill_of_materials": {
    "bom_type": "Manufacturing BOM (MBOM)",
    "assembly_name": "${design.design?.name || 'Assembly'}",
    "total_part_count": 47,
    "total_unique_parts": 18,

    "items": [
      {
        "item_number": "001",
        "part_number": "FRM-001-A",
        "description": "Main frame, welded steel",
        "quantity": 1,
        "unit": "ea",
        "make_or_buy": "Make",
        "material_spec": "ASTM A36 structural steel",
        "manufacturing_process": "Laser cut + MIG weld + powder coat",
        "lead_time_weeks": 2,
        "unit_cost_usd": 45.00,
        "supplier": "Internal fabrication shop",
        "notes": "Critical path item"
      },
      {
        "item_number": "002",
        "part_number": "MTR-100-24V",
        "description": "DC motor, 24V, 100W",
        "quantity": 2,
        "unit": "ea",
        "make_or_buy": "Buy",
        "manufacturer": "Maxon Motor",
        "manufacturer_pn": "RE40-148877",
        "supplier": "Digi-Key",
        "supplier_pn": "1234-ND",
        "lead_time_weeks": 4,
        "unit_cost_usd": 285.00,
        "moq": 1,
        "alternative_suppliers": ["Mouser", "Allied Electronics"]
      },
      {
        "item_number": "003",
        "part_number": "SCR-M8-30-A4",
        "description": "Socket head cap screw M8×30, A4 stainless",
        "quantity": 24,
        "unit": "ea",
        "make_or_buy": "Buy",
        "standard": "ISO 4762 / DIN 912",
        "material_spec": "A4-70 stainless steel (marine grade)",
        "supplier": "McMaster-Carr",
        "supplier_pn": "91290A354",
        "unit_cost_usd": 0.42,
        "moq": 50,
        "packaging": "Sold in packs of 50"
      }
    ],

    "cost_rollup": {
      "total_material_cost_usd": 1245.00,
      "manufacturing_labor_cost_usd": 380.00,
      "overhead_allocation_usd": 285.00,
      "total_cogs_usd": 1910.00
    },

    "supply_chain_risk_analysis": [
      {
        "item": "DC motor (MTR-100-24V)",
        "risk_level": "Medium",
        "risk_factors": ["Single source (Maxon)", "Long lead time (4 weeks)"],
        "mitigation": "Maintain 3-month safety stock; qualify secondary source (Faulhaber)"
      }
    ]
  }
}

Generate the complete BOM now.`;
};

/**
 * Process Planning & Assembly Sequence
 */
exports.buildProcessPlanningPrompt = (design, complexityTier) => {
    return `You are a MANUFACTURING PROCESS ENGINEER designing the assembly line.

Design: ${JSON.stringify(design, null, 2)}

Your task: Create the process plan, assembly sequence, and line layout.

ASSEMBLY LINE DESIGN PRINCIPLES:

**1. Takt Time Calculation**

Takt Time = Available Production Time / Customer Demand
- Example: 8 hours (28800 sec) / 1000 units = 28.8 seconds/unit
- Each workstation must complete work in ≤ Takt Time

**2. Line Balancing**

Efficiency = (Σ Task Times) / (Number of Stations × Takt Time) × 100%
- Target: >85% efficiency

**3. Cycle Time Analysis**

Station Cycle Time = Setup + (Manual Time + Machine Time) + Inspection
- Must be ≤ Takt Time
- If CT > Takt Time → Add parallel station or split tasks

**4. Precedence Diagram**

Identify task dependencies:
- Task A must complete before Task B can start
- Some tasks can run in parallel

DELIVERABLE FORMAT (JSON):

{
  "process_planning": {
    "production_volume_per_year": 50000,
    "working_days_per_year": 250,
    "shifts_per_day": 2,
    "hours_per_shift": 8,
    "takt_time_seconds": 23.0,

    "assembly_sequence": [
      {
        "station": "ST-01",
        "station_name": "Frame Assembly",
        "tasks": [
          {
            "task_id": "T001",
            "description": "Place base frame on fixture",
            "time_seconds": 5,
            "operator_hands": 2,
            "tools_required": ["None"]
          },
          {
            "task_id": "T002",
            "description": "Install 4× corner brackets with M8 screws",
            "time_seconds": 12,
            "operator_hands": 2,
            "tools_required": ["Pneumatic screwdriver, 6mm hex bit, 10Nm torque"]
          }
        ],
        "station_cycle_time_seconds": 17,
        "takt_time_compliance": "PASS (17 < 23)"
      },
      {
        "station": "ST-02",
        "station_name": "Motor Installation",
        "tasks": [
          {
            "task_id": "T010",
            "description": "Mount motor to bracket with 4× M6 screws",
            "time_seconds": 8,
            "tools_required": ["Torque wrench, 5mm hex, 8Nm"]
          },
          {
            "task_id": "T011",
            "description": "Connect power cable (Molex connector)",
            "time_seconds": 3,
            "tools_required": ["None - push-fit connector"]
          },
          {
            "task_id": "T012",
            "description": "Functional test: Motor spin check",
            "time_seconds": 5,
            "tools_required": ["Test jig with power supply"]
          }
        ],
        "station_cycle_time_seconds": 16,
        "takt_time_compliance": "PASS (16 < 23)"
      }
    ],

    "line_layout": {
      "configuration": "U-shaped assembly line",
      "number_of_stations": 8,
      "line_length_meters": 18,
      "material_handling": "Roller conveyor with manual push",
      "buffer_inventory": "1 unit between each station (7 units WIP total)"
    },

    "quality_control_points": [
      {
        "location": "After ST-04 (Electrical Assembly)",
        "inspection": "Continuity test on all power connections",
        "method": "Automated test fixture, Go/No-Go",
        "cycle_time_seconds": 8
      },
      {
        "location": "End of line (ST-08)",
        "inspection": "Final functional test + visual inspection",
        "method": "Automated test sequence: power-on, motion check, sensor verification",
        "cycle_time_seconds": 18
      }
    ],

    "tooling_and_fixtures": [
      {"station": "ST-01", "fixture": "Welded steel frame locator (3-2-1 principle)", "cost_usd": 2500},
      {"station": "ST-02", "fixture": "Motor alignment jig with dowel pins", "cost_usd": 800},
      {"station": "ST-08", "fixture": "Automated test station with PLC", "cost_usd": 15000}
    ],

    "operator_requirements": {
      "total_operators": 8,
      "skill_level": "Semi-skilled (2 weeks training)",
      "ergonomics": "All parts <10kg, height-adjustable workbenches, anti-fatigue mats"
    },

    "production_metrics": {
      "units_per_shift": 1250,
      "line_efficiency_percent": 88,
      "first_pass_yield_percent": 96.5,
      "scrap_rate_percent": 0.8
    }
  }
}

Generate the complete process plan now.`;
};

// ================================================================
// PHASE 5: POST-PRODUCTION PROMPTS
// ================================================================

/**
 * Service & Maintenance Documentation
 */
exports.buildServiceDocPrompt = (design, complexityTier) => {
    return `You are a TECHNICAL WRITER creating service documentation for field technicians.

Design: ${JSON.stringify(design, null, 2)}

Your task: Create maintenance procedures, troubleshooting guides, and spare parts lists.

DELIVERABLE FORMAT (JSON):

{
  "service_documentation": {
    "maintenance_schedule": [
      {
        "interval": "Daily",
        "tasks": ["Visual inspection for damage", "Check fluid levels"]
      },
      {
        "interval": "Every 500 operating hours",
        "tasks": [
          "Lubricate bearings with Shell Alvania EP2 grease",
          "Inspect drive belt for wear (replace if >5% elongation)",
          "Clean air filters"
        ]
      },
      {
        "interval": "Annually",
        "tasks": [
          "Replace hydraulic oil (ISO VG 46)",
          "Calibrate sensors (pressure, temperature)",
          "Functional test all safety interlocks"
        ]
      }
    ],

    "troubleshooting_guide": [
      {
        "symptom": "Motor does not start",
        "possible_causes": [
          "No power to motor",
          "E-stop engaged",
          "Overload relay tripped"
        ],
        "diagnostic_steps": [
          "Check power supply voltage (should be 24VDC ±10%)",
          "Verify E-stop is released (LED should be green)",
          "Reset overload relay (press blue reset button)"
        ]
      }
    ],

    "spare_parts_list": [
      {"part_number": "MTR-100-24V", "description": "Drive motor", "recommended_qty": 1},
      {"part_number": "BRG-6204-2RS", "description": "Ball bearing", "recommended_qty": 4}
    ]
  }
}

Generate service documentation now.`;
};

/**
 * Regulatory Compliance & Certification
 */
exports.buildCompliancePrompt = (design, complexityTier) => {
    return `You are a REGULATORY COMPLIANCE ENGINEER ensuring product certification.

Design: ${JSON.stringify(design, null, 2)}

Your task: Identify applicable standards and create certification roadmap.

DELIVERABLE FORMAT (JSON):

{
  "compliance_certification": {
    "applicable_standards": [
      {
        "standard": "ISO 12100",
        "title": "Safety of machinery - General principles for design",
        "mandatory": true,
        "certification_body": "TÜV SÜD"
      },
      {
        "standard": "CE Marking (EU)",
        "directives": ["Machinery Directive 2006/42/EC", "EMC Directive 2014/30/EU"],
        "mandatory": true,
        "certification_body": "Notified Body required"
      }
    ],

    "certification_roadmap": [
      {"step": 1, "task": "Risk assessment per ISO 12100", "duration_weeks": 2},
      {"step": 2, "task": "Design modifications for compliance", "duration_weeks": 4},
      {"step": 3, "task": "Testing at accredited lab", "duration_weeks": 6},
      {"step": 4, "task": "Technical file compilation", "duration_weeks": 2},
      {"step": 5, "task": "Certification audit", "duration_weeks": 3}
    ],

    "estimated_certification_cost_usd": 45000,
    "estimated_timeline_months": 4
  }
}

Generate compliance plan now.`;
};

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function getTierContext(tier) {
    const contexts = {
        bachelors: {
            minVertices: 96,
            maxGenerationTime: 300,
            simulationDepth: 'basic',
            description: 'Undergraduate prototyping projects, basic mechatronics, fundamental principles'
        },
        masters: {
            minVertices: 300,
            maxGenerationTime: 900,
            simulationDepth: 'intermediate',
            description: 'Graduate research, optimization studies, FEA/CFD validation, control systems'
        },
        phd: {
            minVertices: 500,
            maxGenerationTime: 1800,
            simulationDepth: 'advanced',
            description: 'Novel materials, micro-systems, cutting-edge physics, research publications'
        },
        professional: {
            minVertices: 800,
            maxGenerationTime: 3600,
            simulationDepth: 'production',
            description: 'Production-ready industrial design (Tesla/SpaceX/ASML/Boeing level)'
        }
    };

    return contexts[tier] || contexts.bachelors;
}

function getGeometryGenerationInstructions(tier, requirements) {
    // Project-specific geometry guidance based on complexity tier
    return `
**GEOMETRY GENERATION FOR ${tier.toUpperCase()} TIER (≥${requirements.minVertices} vertices required):**

For structural frames/brackets:
- Base box structure: 8 vertices
- Add mounting holes: 16 vertices each (circular profiles with 8-16 segments)
- Add ribs/gussets: 4-8 vertices per rib
- Add cutouts/lightening holes: 16 vertices per cutout
- Total target: ${requirements.minVertices}+ vertices

For rotating components (shafts, gears, pulleys):
- Use 48 segments for smooth cylinders (96 vertices for top+bottom circles)
- Add keyways: 8 vertices per keyway
- Add grooves/threads: 32+ vertices per groove
- For gears: 4 vertices per tooth minimum (e.g., 96-tooth gear = 384+ vertices)

For complex assemblies (engines, transmissions):
- Main body: 8-16 vertices (envelope)
- Each bore/hole: 16-32 vertices (circular profiles)
- Each passage/gallery: 16 vertices (tubular geometry)
- Mounting features: 16 vertices each
- Example V8 engine block:
  * Block body: 8 vertices
  * 8 cylinder bores: 8×32 = 256 vertices
  * 4 mounting holes: 4×16 = 64 vertices
  * 2 oil galleries: 2×16 = 32 vertices
  * Cooling passages: 48+ vertices
  * Head bolt holes: 8×16 = 128 vertices
  * **TOTAL: 536 vertices** ✓

**CRITICAL**: Count your vertices BEFORE finishing. Must be ≥ ${requirements.minVertices}.
`;
}

module.exports = exports;
