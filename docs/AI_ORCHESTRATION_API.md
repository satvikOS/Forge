# AI Orchestration API Documentation

## Overview

The AI Orchestration API orchestrates all CAD services from a natural language prompt to final rendering. Each step in the workflow is controlled by AI and feeds into the next step, creating a complete automated design pipeline.

## Orchestration Endpoint

### POST /api/mechanical/orchestrate

Starts a complete design workflow from a natural language prompt.

**Request:**
```json
{
  "prompt": "Design a lightweight aluminum bracket with 4 mounting holes, 100mm x 50mm x 25mm",
  "workflowType": "fullDesignCycle",
  "options": {}
}
```

**Response:**
```json
{
  "success": true,
  "workflowId": "workflow_1234567890",
  "status": "completed",
  "totalSteps": 10,
  "duration": 8542,
  "results": {
    "parsedIntent": {...},
    "designConcepts": {...},
    "sketch": {...},
    "features3D": {...},
    "materials": {...},
    "analysis": {...},
    "optimization": {...},
    "manufacturing": {...},
    "documentation": {...},
    "rendering": {...}
  },
  "rendering": "/renders/1234567890.png"
}
```

## Workflow Steps

### Step 1: Parse Natural Language Prompt

**API Internal Call:** `parsePrompt()`

**What it does:**
- Extracts part type (bracket, housing, cover, etc.)
- Identifies dimensions from prompt
- Determines material from context
- Lists required features (holes, fillets, etc.)
- Identifies design constraints (lightweight, strong, etc.)

**Output:**
```json
{
  "partType": "bracket",
  "dimensions": {
    "length": 100,
    "width": 50,
    "height": 25,
    "volume": 125000
  },
  "material": "Aluminum 6061-T6",
  "features": ["extrude", "holes"],
  "constraints": [
    { "type": "mass", "target": "minimize" }
  ]
}
```

**API Routes Used:**
- None (internal AI parsing)

---

### Step 2: Generate Design Concepts

**API Internal Call:** `generateDesign()`

**What it does:**
- Uses AI generative design to create multiple design variants
- Evaluates each variant based on constraints
- Selects best variant for implementation

**Output:**
```json
{
  "variants": [
    {
      "id": "variant_1",
      "approach": "lightweight",
      "mass": 250,
      "score": 0.92
    },
    {
      "id": "variant_2",
      "approach": "balanced",
      "mass": 350,
      "score": 0.88
    }
  ],
  "bestVariant": "variant_1"
}
```

**API Routes Used:**
- POST /api/mechanical/peak/generative-design
- POST /api/mechanical/variants/generate-conceptual

---

### Step 3: Create Parametric Sketch

**API Internal Call:** `createSketch()`

**What it does:**
- Creates 2D sketch on specified plane
- Adds geometric entities (lines, circles, arcs)
- Applies parametric constraints
- Prepares sketch for 3D extrusion

**Output:**
```json
{
  "sketchId": "sketch_1234567890",
  "plane": "XY",
  "entities": [
    { "type": "rectangle", "center": [0, 0], "width": 100, "height": 50 },
    { "type": "circle", "center": [20, 20], "radius": 5 },
    { "type": "circle", "center": [80, 20], "radius": 5 }
  ],
  "constraints": [
    { "type": "horizontal", "entities": [0] },
    { "type": "equal", "entities": [1, 2] }
  ]
}
```

**API Routes Used:**
- POST /api/mechanical/sketch/create
- POST /api/mechanical/sketch/line
- POST /api/mechanical/sketch/circle
- POST /api/mechanical/sketch/constraint

---

### Step 4: Create 3D Features

**API Internal Call:** `create3DFeatures()`

**What it does:**
- Extrudes sketch to create base solid
- Adds fillets for stress relief
- Creates holes for mounting
- Calculates volume and surface area

**Output:**
```json
{
  "featureTree": [
    { "type": "extrude", "sketch": "sketch_1234567890", "depth": 25 },
    { "type": "fillet", "edges": [1, 2, 3, 4], "radius": 2 },
    { "type": "hole", "center": [20, 20, 0], "diameter": 10, "depth": 25 },
    { "type": "hole", "center": [80, 20, 0], "diameter": 10, "depth": 25 }
  ],
  "volume": 115000,
  "surfaceArea": 14500
}
```

**API Routes Used:**
- POST /api/mechanical/features/extrude
- POST /api/mechanical/features/fillet
- POST /api/mechanical/features/hole

---

### Step 5: Apply Materials and Appearance

**API Internal Call:** `applyMaterials()`

**What it does:**
- Assigns material properties from library
- Calculates mass based on volume and density
- Sets visual appearance for rendering

**Output:**
```json
{
  "body": {
    "material": "Aluminum 6061-T6",
    "density": 2700,
    "youngsModulus": 69e9,
    "poissonsRatio": 0.33,
    "yieldStrength": 276e6,
    "appearance": {
      "color": [0.7, 0.7, 0.7],
      "metalness": 0.9,
      "roughness": 0.3
    }
  },
  "mass": 310.5
}
```

**API Routes Used:**
- POST /api/mechanical/material/assign
- GET /api/mechanical/material/library

---

### Step 6: Run Structural Analysis (FEA)

**API Internal Call:** `runAnalysis()`

**What it does:**
- Creates finite element mesh
- Applies boundary conditions and loads
- Solves for stress, strain, deflection
- Calculates safety factor

**Output:**
```json
{
  "analysisType": "fea-static",
  "meshElements": 15420,
  "maxStress": 45.2e6,
  "maxDeflection": 0.032,
  "safetyFactor": 6.1,
  "passed": true,
  "vonMisesStress": {
    "max": 45.2e6,
    "min": 0.1e6,
    "average": 12.5e6
  }
}
```

**API Routes Used:**
- POST /api/mechanical/simulation/prepare
- POST /api/mechanical/analysis/fea-static
- GET /api/mechanical/analysis/results/:analysisId

---

### Step 7: AI Optimization

**API Internal Call:** `optimizeDesign()`

**What it does:**
- Runs topology optimization to minimize mass
- Removes material from low stress regions
- Maintains strength requirements
- Generates optimized geometry

**Output:**
```json
{
  "optimizationType": "topology",
  "massReduction": 0.35,
  "originalMass": 310.5,
  "optimizedMass": 201.8,
  "stressImprovement": 0.12,
  "iterations": 50,
  "improvements": [
    "Removed material in low stress regions",
    "Added ribbing for stiffness",
    "Optimized hole placement"
  ]
}
```

**API Routes Used:**
- POST /api/mechanical/ai-optimization/topology
- POST /api/mechanical/peak/generative-design

---

### Step 8: Generate Manufacturing Data

**API Internal Call:** `generateManufacturing()`

**What it does:**
- Creates CAM setup with workpiece and fixtures
- Generates toolpaths for milling operations
- Calculates machining time and cost
- Exports G-code for CNC machines

**Output:**
```json
{
  "operations": [
    { "type": "2d-face-milling", "tool": "12mm end mill", "time": 8.5, "passes": 3 },
    { "type": "drilling", "tool": "10mm drill", "time": 2.3, "holes": 2 },
    { "type": "finish-milling", "tool": "6mm ball end", "time": 12.7, "passes": 5 }
  ],
  "totalTime": 23.5,
  "toolChanges": 3,
  "estimatedCost": 145.50,
  "gCodeGenerated": true
}
```

**API Routes Used:**
- POST /api/mechanical/cam/setup
- POST /api/mechanical/cam/2d-pocket
- POST /api/mechanical/cam/generate-toolpath
- POST /api/mechanical/cost/estimate

---

### Step 9: Create Technical Documentation

**API Internal Call:** `createDocumentation()`

**What it does:**
- Generates engineering drawings with dimensions
- Creates bill of materials (BOM)
- Adds GD&T annotations
- Exports to PDF format

**Output:**
```json
{
  "drawing": {
    "views": ["front", "top", "right", "isometric"],
    "dimensions": 45,
    "notes": 12,
    "gdtSymbols": 8
  },
  "bom": {
    "parts": 1,
    "fasteners": 0,
    "totalCost": 145.50
  },
  "technicalSpecs": {
    "mass": "201.8g",
    "volume": "115000mm³",
    "material": "Aluminum 6061-T6",
    "safetyFactor": 6.1
  }
}
```

**API Routes Used:**
- POST /api/mechanical/drawing/create
- POST /api/mechanical/bom/generate
- POST /api/mechanical/gdt/add-annotation
- POST /api/mechanical/manual/export

---

### Step 10: Final Rendering and Visualization

**API Internal Call:** `renderVisualization()`

**What it does:**
- Creates photorealistic rendering scene
- Generates multiple camera views
- Applies lighting and materials
- Exports high-resolution images

**Output:**
```json
{
  "renderJobId": "render_1234567890",
  "resolution": "1920x1080",
  "quality": "high",
  "samples": 256,
  "renderTime": 45.2,
  "imageUrl": "/renders/1234567890.png",
  "views": [
    { "type": "isometric", "angle": [45, 35, 0] },
    { "type": "exploded", "spacing": 1.5 },
    { "type": "cutaway", "plane": "XZ" }
  ]
}
```

**API Routes Used:**
- POST /api/mechanical/rendering/scene
- POST /api/mechanical/rendering/image
- POST /api/mechanical/rendering/exploded
- GET /api/mechanical/rendering/status/:renderJobId

---

## Workflow Status Monitoring

### GET /api/mechanical/orchestrate/:workflowId

Check the status of a running workflow.

**Response:**
```json
{
  "success": true,
  "workflowId": "workflow_1234567890",
  "status": "running",
  "currentStep": 5,
  "totalSteps": 10,
  "steps": [
    {
      "name": "parsePrompt",
      "description": "Parsing natural language prompt",
      "status": "completed",
      "startTime": "2026-01-05T10:00:00.000Z",
      "endTime": "2026-01-05T10:00:01.234Z"
    },
    {
      "name": "generateDesign",
      "description": "Generating design concepts with AI",
      "status": "completed",
      "startTime": "2026-01-05T10:00:01.234Z",
      "endTime": "2026-01-05T10:00:03.567Z"
    },
    {
      "name": "runAnalysis",
      "description": "Running FEA structural analysis",
      "status": "running",
      "startTime": "2026-01-05T10:00:08.123Z",
      "endTime": null
    }
  ]
}
```

## Complete API Route Map

### Orchestration
- POST /api/mechanical/orchestrate
- GET /api/mechanical/orchestrate/:workflowId

### Design Generation
- POST /api/mechanical/generate
- GET /api/mechanical/generate/:jobId
- POST /api/mechanical/parametric/generate-from-prompt

### Sketch Operations
- POST /api/mechanical/sketch/create
- POST /api/mechanical/sketch/line
- POST /api/mechanical/sketch/circle
- POST /api/mechanical/sketch/constraint

### 3D Features
- POST /api/mechanical/features/extrude
- POST /api/mechanical/features/revolve
- POST /api/mechanical/features/fillet
- POST /api/mechanical/features/hole

### Materials
- POST /api/mechanical/material/assign
- GET /api/mechanical/material/library

### Analysis
- POST /api/mechanical/simulation/prepare
- POST /api/mechanical/analysis/fea-static
- POST /api/mechanical/analysis/fea-thermal
- POST /api/mechanical/analysis/cfd-external

### AI Optimization
- POST /api/mechanical/ai-optimization/topology
- POST /api/mechanical/ai-optimization/dfm-analysis
- POST /api/mechanical/peak/generative-design

### Manufacturing
- POST /api/mechanical/cam/setup
- POST /api/mechanical/cam/2d-pocket
- POST /api/mechanical/cam/generate-toolpath
- POST /api/mechanical/cost/estimate

### Documentation
- POST /api/mechanical/drawing/create
- POST /api/mechanical/bom/generate
- POST /api/mechanical/gdt/add-annotation
- POST /api/mechanical/manual/export

### Rendering
- POST /api/mechanical/rendering/scene
- POST /api/mechanical/rendering/image
- POST /api/mechanical/rendering/exploded
- GET /api/mechanical/rendering/status/:renderJobId

### Cloud Sync
- POST /api/mechanical/cloud/upload
- POST /api/mechanical/cloud/sync

### Standard Parts
- POST /api/mechanical/parts/search
- POST /api/mechanical/parts/insert

### Kinematics
- POST /api/mechanical/kinematics/simulate

### Routing
- POST /api/mechanical/routing/create

### Inspection
- POST /api/mechanical/inspection/cmm
- POST /api/mechanical/inspection/gdt

### PDM/PLM
- POST /api/mechanical/pdm/connect
- POST /api/mechanical/pdm/checkout

### Automation
- POST /api/mechanical/automation/macro
- POST /api/mechanical/automation/run

## Example Usage

### Simple Prompt Example

```javascript
const response = await fetch('/api/mechanical/orchestrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Design a lightweight aluminum bracket with 4 mounting holes, 100mm x 50mm x 25mm'
  })
});

const result = await response.json();
console.log('Workflow ID:', result.workflowId);
console.log('Final rendering:', result.rendering);
```

### Complex Prompt Example

```javascript
const response = await fetch('/api/mechanical/orchestrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Design a titanium gear housing for aerospace application with 200mm diameter, optimize for minimum mass while maintaining safety factor of 3.0, include thermal analysis for 300°C operating temperature',
    options: {
      material: 'Titanium Ti-6Al-4V',
      manufacturingMethod: 'additive',
      analysisTypes: ['fea-static', 'fea-thermal'],
      optimizationTarget: 'minimize-mass'
    }
  })
});

const result = await response.json();
```

### Monitoring Workflow Progress

```javascript
const workflowId = 'workflow_1234567890';

const checkStatus = async () => {
  const response = await fetch(`/api/mechanical/orchestrate/${workflowId}`);
  const status = await response.json();

  console.log(`Progress: ${status.currentStep}/${status.totalSteps}`);
  console.log(`Status: ${status.status}`);

  if (status.status === 'running') {
    setTimeout(checkStatus, 2000);
  } else {
    console.log('Workflow completed!');
    console.log('Results:', status.results);
  }
};

checkStatus();
```

## AI Control and Orchestration

The AI orchestration system controls the entire workflow by:

1. **Intelligent Parsing**: Understands design intent from natural language
2. **Automatic Decision Making**: Selects best design variant, materials, and processes
3. **Adaptive Optimization**: Adjusts design based on analysis results
4. **Quality Assurance**: Validates each step before proceeding to next
5. **Error Recovery**: Handles failures gracefully and retries when appropriate
6. **Result Integration**: Each step's output becomes input for the next step

## Benefits

- **End to End Automation**: Complete workflow from idea to rendering
- **AI Powered**: Intelligent decisions at each step
- **Step by Step Validation**: Each step validated before proceeding
- **Real Time Monitoring**: Track progress through API
- **Comprehensive Output**: Full design package (CAD, analysis, manufacturing, docs)
- **Production Ready**: Generated files ready for manufacturing

## Conclusion

The AI Orchestration API provides a complete automated design pipeline that transforms natural language prompts into production ready designs with full documentation and manufacturing data. All 129 CAD services work together seamlessly under AI control to deliver professional grade results.
